/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readdir, readFile, rename, stat, unlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { CspPolicies, ImageAndMediaSrc } from "@main/csp";
import { app, IpcMainInvokeEvent } from "electron";

CspPolicies["netherware.xyz"] = ImageAndMediaSrc;
CspPolicies["*.netherware.xyz"] = ImageAndMediaSrc;
CspPolicies["fonts.gstatic.com"] = ["font-src"];

const execFileP = promisify(execFile);

const ALLOWED_HOST = /^([a-z0-9-]+\.)*netherware\.xyz$/i;

function assertAllowed(url: string) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !ALLOWED_HOST.test(u.hostname)) {
        throw new Error("Refusing to fetch from " + u.origin);
    }
    return u;
}

export async function fetchJson(_: IpcMainInvokeEvent, url: string) {
    const u = assertAllowed(url);
    try {
        const res = await fetch(u, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(20_000)
        });
        if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
        return { ok: true, status: res.status, data: await res.json() };
    } catch (e) {
        return { ok: false, status: -1, error: String((e as Error)?.message ?? e) };
    }
}

export async function fetchBytes(_: IpcMainInvokeEvent, url: string) {
    const u = assertAllowed(url);
    try {
        const res = await fetch(u, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { ok: true, status: res.status, type: res.headers.get("content-type") ?? "video/mp4", bytes };
    } catch (e) {
        return { ok: false, status: -1, error: String((e as Error)?.message ?? e) };
    }
}

// Downloads stream straight to the on-disk cache: nothing is buffered in RAM
// beyond the chunk in flight. Bytes are read back from disk only when taken.
interface Download {
    key: string;
    received: number;
    total: number;
    done: boolean;
    error?: string;
    type: string;
    abort: AbortController;
}

const downloads = new Map<string, Download>();
const prefetching = new Map<string, Download>();
let nextId = 0;

const CACHE_LIMIT = 1.5 * 1024 * 1024 * 1024;
let cacheDir: string | null = null;

function getCacheDir() {
    if (cacheDir) return cacheDir;
    cacheDir = join(app.getPath("userData"), "netherwareClips-cache");
    try { mkdirSync(cacheDir, { recursive: true }); } catch { }
    return cacheDir;
}

function cachePath(url: string) {
    return join(getCacheDir(), createHash("sha1").update(url).digest("hex") + ".mp4");
}

async function discardPart(key: string) {
    await unlink(cachePath(key) + ".part").catch(() => { });
}

async function trimCache() {
    try {
        const d = getCacheDir();
        const names = await readdir(d);
        const files: { full: string; size: number; atime: number; }[] = [];
        for (const name of names) {
            const full = join(d, name);
            const st = await stat(full).catch(() => null);
            if (st) files.push({ full, size: st.size, atime: st.mtimeMs });
        }
        let total = files.reduce((n, f) => n + f.size, 0);
        if (total <= CACHE_LIMIT) return;
        files.sort((a, b) => a.atime - b.atime);
        for (const f of files) {
            if (total <= CACHE_LIMIT) break;
            await unlink(f.full).then(() => { total -= f.size; }, () => { });
        }
    } catch { }
}

function runDownload(u: URL, dl: Download, onDone?: () => void) {
    (async () => {
        const final = cachePath(dl.key);
        const part = final + ".part";
        let out: ReturnType<typeof createWriteStream> | null = null;
        let streamError: unknown = null;
        const aborted = () => dl.abort.signal.aborted;
        try {
            const res = await fetch(u, { signal: AbortSignal.any([dl.abort.signal, AbortSignal.timeout(180_000)]) });
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
            dl.total = Number(res.headers.get("content-length")) || 0;
            dl.type = res.headers.get("content-type") ?? dl.type;
            out = createWriteStream(part);
            // A write that lands after the stream is torn down (abort mid-flight)
            // emits "error" asynchronously; without a listener that's an uncaught
            // main-process exception, so always swallow it here.
            out.on("error", e => { streamError = e; });
            const reader = res.body.getReader();
            while (true) {
                if (aborted() || out.destroyed || streamError) break;
                const { done, value } = await reader.read();
                if (done) break;
                if (aborted() || out.destroyed || streamError) break;
                dl.received += value.byteLength;
                if (!out.write(value)) {
                    await new Promise<void>(r => {
                        const onDrain = () => { cleanup(); r(); };
                        const onAbort = () => { cleanup(); r(); };
                        const cleanup = () => {
                            out!.off("drain", onDrain);
                            out!.off("close", onAbort);
                            dl.abort.signal.removeEventListener("abort", onAbort);
                        };
                        out!.once("drain", onDrain);
                        out!.once("close", onAbort);
                        dl.abort.signal.addEventListener("abort", onAbort, { once: true });
                    });
                }
            }
            if (aborted()) throw new Error("aborted");
            if (streamError) throw streamError;
            await new Promise<void>((r, j) => out!.end((e: unknown) => e ? j(e) : r()));
            out = null;
            if (dl.total && dl.received !== dl.total) throw new Error("incomplete download");
            await rename(part, final);
            trimCache().catch(() => { });
        } catch (e) {
            dl.error = String((e as Error)?.message ?? e);
            if (out && !out.destroyed) { try { out.destroy(); } catch { } }
            await discardPart(dl.key);
        } finally {
            dl.done = true;
            onDone?.();
        }
    })();
}

let activePrefetch: { key: string; dl: Download; } | null = null;

function isClaimed(dl: Download) {
    for (const d of downloads.values()) if (d === dl) return true;
    return false;
}

export function prefetch(_: IpcMainInvokeEvent, url: string) {
    const u = assertAllowed(url);
    const key = u.toString();
    if (prefetching.has(key) || existsSync(cachePath(key))) return;

    if (activePrefetch && !activePrefetch.dl.done && !isClaimed(activePrefetch.dl)) {
        activePrefetch.dl.abort.abort();
        prefetching.delete(activePrefetch.key);
    }

    const dl: Download = { key, received: 0, total: 0, done: false, type: "video/mp4", abort: new AbortController() };
    prefetching.set(key, dl);
    activePrefetch = { key, dl };
    runDownload(u, dl, () => {
        prefetching.delete(key);
        if (activePrefetch?.dl === dl) activePrefetch = null;
    });
}

export function cancelPrefetch(_: IpcMainInvokeEvent, url: string) {
    const key = assertAllowed(url).toString();
    const dl = prefetching.get(key);
    if (!dl || dl.done || isClaimed(dl)) return;
    dl.abort.abort();
    prefetching.delete(key);
    if (activePrefetch?.dl === dl) activePrefetch = null;
}

export function isCached(_: IpcMainInvokeEvent, url: string) {
    return existsSync(cachePath(assertAllowed(url).toString()));
}

export async function startDownload(_: IpcMainInvokeEvent, url: string) {
    const u = assertAllowed(url);
    const key = u.toString();
    const id = String(++nextId);

    const final = cachePath(key);
    if (existsSync(final)) {
        const size = (await stat(final).catch(() => null))?.size ?? 0;
        utimes(final, new Date(), new Date()).catch(() => { });
        downloads.set(id, { key, received: size, total: size, done: true, type: "video/mp4", abort: new AbortController() });
        return id;
    }

    const inflight = prefetching.get(key);
    if (inflight) {
        downloads.set(id, inflight);
        return id;
    }

    const dl: Download = { key, received: 0, total: 0, done: false, type: "video/mp4", abort: new AbortController() };
    downloads.set(id, dl);
    runDownload(u, dl);
    return id;
}

export function downloadProgress(_: IpcMainInvokeEvent, id: string) {
    const dl = downloads.get(id);
    if (!dl) return { received: 0, total: 0, done: true, error: "unknown download" };
    return { received: dl.received, total: dl.total, done: dl.done, error: dl.error };
}

export async function takeDownload(_: IpcMainInvokeEvent, id: string) {
    const dl = downloads.get(id);
    downloads.delete(id);
    if (!dl) return { ok: false, error: "unknown download" };
    if (dl.error) return { ok: false, error: dl.error };
    try {
        const bytes = new Uint8Array(await readFile(cachePath(dl.key)));
        return { ok: true, type: dl.type, bytes };
    } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
    }
}

export function cancelDownload(_: IpcMainInvokeEvent, id: string) {
    const dl = downloads.get(id);
    downloads.delete(id);
    if (!dl || dl.done) return;
    for (const p of prefetching.values()) if (p === dl) return;
    dl.abort.abort();
}

export async function post(_: IpcMainInvokeEvent, url: string) {
    const u = assertAllowed(url);
    try {
        const res = await fetch(u, { method: "POST", signal: AbortSignal.timeout(10_000) });
        return { ok: res.ok, status: res.status };
    } catch (e) {
        return { ok: false, status: -1, error: String((e as Error)?.message ?? e) };
    }
}

// ── self-updater ───────────────────────────────────────────────────
// Mirrors Vencord's own updater: the plugins repo lives in
// <vencord>/src/userplugins; pull it fast-forward, rebuild Vencord, and let the
// renderer prompt for a restart. __dirname is <vencord>/dist for a dev build.
const VENCORD_DIR = join(__dirname, "..");
const PLUGINS_DIR = join(VENCORD_DIR, "src", "userplugins");

function git(...args: string[]) {
    return execFileP("git", ["-C", PLUGINS_DIR, ...args]);
}

export async function checkForUpdate(_: IpcMainInvokeEvent) {
    try {
        await git("fetch", "--quiet");
        const branch = (await git("branch", "--show-current")).stdout.trim() || "main";
        const log = (await git("log", `HEAD..origin/${branch}`, "--pretty=format:%h/%s")).stdout.trim();
        const commits = log ? log.split("\n").map(l => { const [hash, ...rest] = l.split("/"); return { hash, message: rest.join("/") }; }) : [];
        const local = (await git("rev-parse", "--short", "HEAD")).stdout.trim();
        return { ok: true, behind: commits.length, commits, local, branch };
    } catch (e) {
        return { ok: false, behind: 0, commits: [], error: String((e as Error)?.message ?? e) };
    }
}

export async function applyUpdate(_: IpcMainInvokeEvent) {
    try {
        const pull = await git("pull", "--ff-only", "--quiet");
        if (/error|fatal/i.test(pull.stderr)) throw new Error(pull.stderr.trim());
        const build = await execFileP("node", ["scripts/build/build.mjs"], { cwd: VENCORD_DIR, maxBuffer: 16 * 1024 * 1024 });
        if (/Build failed|error/i.test(build.stderr)) throw new Error(build.stderr.trim().slice(0, 400));
        const local = (await git("rev-parse", "--short", "HEAD")).stdout.trim();
        return { ok: true, local };
    } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
    }
}
