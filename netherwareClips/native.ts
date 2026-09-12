/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CspPolicies, ImageAndMediaSrc } from "@main/csp";
import { app, IpcMainInvokeEvent } from "electron";

CspPolicies["netherware.xyz"] = ImageAndMediaSrc;
CspPolicies["*.netherware.xyz"] = ImageAndMediaSrc;
CspPolicies["fonts.gstatic.com"] = ["font-src"];

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

interface Download {
    received: number;
    total: number;
    chunks: Uint8Array[];
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

function cacheGet(url: string): Uint8Array | null {
    const file = cachePath(url);
    if (!existsSync(file)) return null;
    try {
        const bytes = new Uint8Array(readFileSync(file));
        const now = new Date();
        utimesSync(file, now, now);
        return bytes;
    } catch {
        return null;
    }
}

function cachePut(url: string, bytes: Uint8Array) {
    try {
        writeFileSync(cachePath(url), bytes);
        trimCache();
    } catch { }
}

function trimCache() {
    try {
        const d = getCacheDir();
        const files = readdirSync(d).map(name => {
            const full = join(d, name);
            const st = statSync(full);
            return { full, size: st.size, atime: st.mtimeMs };
        });
        let total = files.reduce((n, f) => n + f.size, 0);
        if (total <= CACHE_LIMIT) return;
        files.sort((a, b) => a.atime - b.atime);
        for (const f of files) {
            if (total <= CACHE_LIMIT) break;
            try { unlinkSync(f.full); total -= f.size; } catch { }
        }
    } catch { }
}

function joinChunks(dl: Download) {
    const bytes = new Uint8Array(dl.received);
    let off = 0;
    for (const c of dl.chunks) { bytes.set(c, off); off += c.byteLength; }
    return bytes;
}

function runDownload(u: URL, dl: Download, onDone?: () => void) {
    (async () => {
        try {
            const res = await fetch(u, { signal: AbortSignal.any([dl.abort.signal, AbortSignal.timeout(180_000)]) });
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
            dl.total = Number(res.headers.get("content-length")) || 0;
            dl.type = res.headers.get("content-type") ?? dl.type;
            const reader = res.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                dl.chunks.push(value);
                dl.received += value.byteLength;
            }
            if (!dl.total || dl.received === dl.total) cachePut(u.toString(), joinChunks(dl));
        } catch (e) {
            dl.error = String((e as Error)?.message ?? e);
        } finally {
            dl.done = true;
            onDone?.();
        }
    })();
}

export function prefetch(_: IpcMainInvokeEvent, url: string) {
    const u = assertAllowed(url);
    const key = u.toString();
    if (prefetching.has(key) || existsSync(cachePath(key))) return;
    const dl: Download = { received: 0, total: 0, chunks: [], done: false, type: "video/mp4", abort: new AbortController() };
    prefetching.set(key, dl);
    runDownload(u, dl, () => { prefetching.delete(key); });
}

export function isCached(_: IpcMainInvokeEvent, url: string) {
    return existsSync(cachePath(assertAllowed(url).toString()));
}

export function startDownload(_: IpcMainInvokeEvent, url: string) {
    const u = assertAllowed(url);
    const key = u.toString();
    const id = String(++nextId);

    const cached = cacheGet(key);
    if (cached) {
        downloads.set(id, { received: cached.byteLength, total: cached.byteLength, chunks: [cached], done: true, type: "video/mp4", abort: new AbortController() });
        return id;
    }

    const inflight = prefetching.get(key);
    if (inflight) {
        downloads.set(id, inflight);
        return id;
    }

    const dl: Download = { received: 0, total: 0, chunks: [], done: false, type: "video/mp4", abort: new AbortController() };
    downloads.set(id, dl);
    runDownload(u, dl);
    return id;
}

export function downloadProgress(_: IpcMainInvokeEvent, id: string) {
    const dl = downloads.get(id);
    if (!dl) return { received: 0, total: 0, done: true, error: "unknown download" };
    return { received: dl.received, total: dl.total, done: dl.done, error: dl.error };
}

export function takeDownload(_: IpcMainInvokeEvent, id: string) {
    const dl = downloads.get(id);
    downloads.delete(id);
    if (!dl) return { ok: false, error: "unknown download" };
    if (dl.error) return { ok: false, error: dl.error };
    return { ok: true, type: dl.type, bytes: dl.chunks.length === 1 ? dl.chunks[0] : joinChunks(dl) };
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
