/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

const ALLOWED = /(^|\.)(discordapp\.com|discordapp\.net|discord\.com|netherware\.xyz)$/i;

export async function fetchAsset(_: IpcMainInvokeEvent, url: string) {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return { ok: false, error: "bad url" };
    }
    if (u.protocol !== "https:" || !ALLOWED.test(u.hostname)) {
        return { ok: false, error: "host not allowed: " + u.hostname };
    }
    try {
        const res = await fetch(u, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { ok: true, type: res.headers.get("content-type") ?? "application/octet-stream", bytes };
    } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
    }
}
