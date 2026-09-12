/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { PluginNative } from "@utils/types";
import { CloudUpload as TCloudUpload } from "@vencord/discord-types";
import { CloudUploadPlatform } from "@vencord/discord-types/enums";
import { findLazy } from "@webpack";
import { Constants, FluxDispatcher, MessageActions, PendingReplyStore, RestAPI, SnowflakeUtils } from "@webpack/common";

import { settings } from "./settings";

const CloudUpload: typeof TCloudUpload = findLazy(m => m.prototype?.trackUploadFinished);

const Native = VencordNative.pluginHelpers.NetherwareClips as PluginNative<typeof import("./native")>;

export interface Clip {
    id: string;
    file: string;
    caption: string;
    author: string;
    sourceUrl?: string;
    width: number;
    height: number;
    durationSec: number;
    genre: string;
    pinned: boolean;
    characters: string[];
    quality?: string;
    size: number;
    addedAt: number;
    v?: string;
}

export interface Genre {
    id: string;
    label: string;
}

export interface Library {
    clips: Clip[];
    genres: Genre[];
    coverVersions: Record<string, number>;
    fetchedAt: number;
}

type Listener = (lib: Library) => void;

const STORE_KEY = "NetherwareClips_library";
const PRELOAD_THUMBS = 30;

let cache: Library | null = null;
let cacheSig = "";

function signature(lib: Library) {
    let sig = String(lib.clips.length);
    for (const c of lib.clips) sig += c.id + (c.v ?? "") + (c.pinned ? "p" : "");
    for (const g of lib.genres) sig += g.id + (lib.coverVersions[g.id] ?? "");
    return sig;
}
let inflight: Promise<Library> | null = null;
let hydrated: Promise<void> | null = null;
const listeners = new Set<Listener>();
const preloaded = new Set<string>();

function preload(url: string) {
    if (preloaded.has(url)) return;
    preloaded.add(url);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
}

function preloadImages(lib: Library) {
    for (const g of lib.genres) preload(genreCoverUrl(g, lib.coverVersions[g.id]));
    preload(logoUrl());
    const first = [...lib.clips].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.addedAt - a.addedAt).slice(0, PRELOAD_THUMBS);
    for (const c of first) preload(thumbUrl(c));
}

export function hydrate() {
    hydrated ??= DataStore.get<Library>(STORE_KEY).then(saved => {
        if (saved && !cache && Array.isArray(saved.clips)) {
            cache = saved;
            cacheSig = signature(saved);
            preloadImages(saved);
            for (const fn of listeners) fn(saved);
        }
    }).catch(() => { });
    return hydrated;
}

export function baseUrl() {
    return settings.store.baseUrl.replace(/\/+$/, "");
}

export const thumbUrl = (clip: Clip) => `${baseUrl()}/tiktok/thumb/${encodeURIComponent(clip.file)}`;
export const mediaUrl = (clip: Clip) => `${baseUrl()}/tiktok/media/${encodeURIComponent(clip.file)}`;
export const shareUrl = (clip: Clip) => `${baseUrl()}/${clip.id}`;
export const genreCoverUrl = (genre: Genre, version?: number) =>
    `${baseUrl()}/tiktok/genre-cover/${encodeURIComponent(genre.id)}${version ? `?v=${version}` : ""}`;
export const logoUrl = () => `${baseUrl()}/icons/netherware.png`;

export function linkFor(clip: Clip) {
    const url = shareUrl(clip);
    return settings.store.invisibleLink ? `[⠀](${url})` : url;
}

export function cachedLibrary() {
    return cache;
}

export function subscribe(fn: Listener) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

export function fetchLibrary(): Promise<Library> {
    if (inflight) return inflight;

    inflight = (async () => {
        const res = await Native.fetchJson(`${baseUrl()}/api/tiktok`);
        if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);

        const { data } = res;
        if (!data?.ok || !Array.isArray(data.clips)) throw new Error("Unexpected library response");

        const next: Library = {
            clips: data.clips,
            genres: Array.isArray(data.genres) ? data.genres : [],
            coverVersions: data.coverVersions && typeof data.coverVersions === "object" ? data.coverVersions : {},
            fetchedAt: Date.now()
        };
        const sig = signature(next);
        if (sig === cacheSig && cache) {
            cache.fetchedAt = next.fetchedAt;
            return cache;
        }
        cache = next;
        cacheSig = sig;
        for (const fn of listeners) fn(cache);
        DataStore.set(STORE_KEY, cache).catch(() => { });
        preloadImages(cache);
        return cache;
    })().finally(() => { inflight = null; });

    return inflight;
}

export function prefetchClip(clip: Clip) {
    if (!settings.store.prefetchOnHover) return;
    Native.prefetch(mediaUrl(clip)).catch(() => { });
}

export function cancelPrefetchClip(clip: Clip) {
    Native.cancelPrefetch(mediaUrl(clip)).catch(() => { });
}

export function warmEmbed(clip: Clip) {
    Native.post(`${baseUrl()}/library/warm/${encodeURIComponent(clip.id)}?force=1`).catch(() => { });
}

export type ProgressFn = (received: number, total: number) => void;

export class CancelledError extends Error {
    constructor() { super("Cancelled"); this.name = "CancelledError"; }
}

export class CancelToken {
    cancelled = false;
    private handlers: (() => void)[] = [];
    onCancel(fn: () => void) { this.handlers.push(fn); }
    cancel() {
        if (this.cancelled) return;
        this.cancelled = true;
        for (const fn of this.handlers) { try { fn(); } catch { } }
    }
    throwIfCancelled() { if (this.cancelled) throw new CancelledError(); }
}

export async function downloadClipFile(clip: Clip, onProgress?: ProgressFn, token?: CancelToken): Promise<File> {
    token?.throwIfCancelled();
    const id = await Native.startDownload(mediaUrl(clip));
    token?.onCancel(() => { Native.cancelDownload(id); });
    while (true) {
        token?.throwIfCancelled();
        const p = await Native.downloadProgress(id);
        onProgress?.(p.received, p.total || clip.size);
        if (p.done) {
            if (p.error) { Native.cancelDownload(id); token?.throwIfCancelled(); throw new Error(p.error); }
            break;
        }
        await new Promise(r => setTimeout(r, 80));
    }
    token?.throwIfCancelled();
    const res = await Native.takeDownload(id);
    if (!res.ok) throw new Error(res.error);
    return new File([res.bytes as unknown as BlobPart], clip.file, { type: res.type || "video/mp4" });
}

export async function sendClipFile(clip: Clip, channelId: string, onDownload?: ProgressFn, onUpload?: ProgressFn, token?: CancelToken) {
    const file = await downloadClipFile(clip, onDownload, token);
    token?.throwIfCancelled();

    const reply = PendingReplyStore.getPendingReply(channelId);
    if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });

    const upload = new CloudUpload({
        file,
        isThumbnail: false,
        platform: CloudUploadPlatform.WEB
    }, channelId);

    await new Promise<void>((resolve, reject) => {
        const { size } = file;
        let posted = false;
        token?.onCancel(() => {
            if (posted) return;
            try { upload.cancel(); } catch { }
            reject(new CancelledError());
        });
        let loaded = 0;
        const report = () => onUpload?.(Math.min(loaded, size), size);
        upload.on("progress", (n: number, total: number) => {
            loaded = typeof n === "number" ? n : upload.loaded ?? 0;
            onUpload?.(Math.min(loaded, total || size), total || size);
        });
        const tick = setInterval(() => { loaded = Math.max(loaded, upload.loaded ?? 0); report(); }, 120);
        const stop = () => clearInterval(tick);
        upload.on("complete", () => {
            stop();
            if (token?.cancelled) return;
            posted = true;
            onUpload?.(size, size);
            RestAPI.post({
                url: Constants.Endpoints.MESSAGES(channelId),
                body: {
                    channel_id: channelId,
                    content: "",
                    nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                    sticker_ids: [],
                    type: 0,
                    attachments: [{
                        id: "0",
                        filename: upload.filename,
                        uploaded_filename: upload.uploadedFilename
                    }],
                    message_reference: reply ? MessageActions.getSendMessageOptionsForReply(reply)?.messageReference : null
                }
            }).then(() => resolve(), reject);
        });
        upload.on("error", () => { stop(); reject(new Error("Upload failed")); });
        upload.upload();
    });
}

export function formatDuration(sec: number) {
    if (!sec || !isFinite(sec)) return "";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatSize(bytes: number) {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
