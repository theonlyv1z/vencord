/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CspPolicies, ImageAndMediaSrc } from "@main/csp";
import { IpcMainInvokeEvent } from "electron";

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
let nextId = 0;

export function startDownload(_: IpcMainInvokeEvent, url: string) {
    const u = assertAllowed(url);
    const id = String(++nextId);
    const dl: Download = { received: 0, total: 0, chunks: [], done: false, type: "video/mp4", abort: new AbortController() };
    downloads.set(id, dl);

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
        } catch (e) {
            dl.error = String((e as Error)?.message ?? e);
        } finally {
            dl.done = true;
        }
    })();

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
    const bytes = new Uint8Array(dl.received);
    let off = 0;
    for (const c of dl.chunks) { bytes.set(c, off); off += c.byteLength; }
    return { ok: true, type: dl.type, bytes };
}

export function cancelDownload(_: IpcMainInvokeEvent, id: string) {
    const dl = downloads.get(id);
    downloads.delete(id);
    if (dl && !dl.done) dl.abort.abort();
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
