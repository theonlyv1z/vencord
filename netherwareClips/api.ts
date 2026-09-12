/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { PluginNative } from "@utils/types";
import { CloudUpload as TCloudUpload } from "@vencord/discord-types";
import { CloudUploadPlatform } from "@vencord/discord-types/enums";
import { findByPropsLazy, findLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, GuildStore, MessageActions, PendingReplyStore, UserStore } from "@webpack/common";

import { settings } from "./settings";

const PremiumUtils = findByPropsLazy("getUserMaxFileSize");
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

export function pendingReplyTarget(channelId: string): { name: string; } | null {
    const reply = PendingReplyStore.getPendingReply(channelId);
    const author = reply?.message?.author;
    if (!author) return null;
    return { name: author.globalName || author.username || "user" };
}

export function maxUploadSize(channelId?: string): number {
    const FALLBACK = 10 * 1024 * 1024;
    try {
        const user = UserStore.getCurrentUser();
        const guildId = channelId ? ChannelStore.getChannel(channelId)?.getGuildId?.() : null;
        const guild = guildId ? GuildStore.getGuild(guildId) : null;
        // getUserMaxFileSize returns the effective limit: the higher of the
        // user's Nitro tier and the guild's boost tier. In a DM guild is null.
        const size = guild
            ? PremiumUtils.getUserMaxFileSize(user, guild)
            : PremiumUtils.getUserMaxFileSize(user);
        return Number(size) || FALLBACK;
    } catch {
        return FALLBACK;
    }
}

let hideUploadRefs = 0;
function setUploadHidden(on: boolean) {
    hideUploadRefs = Math.max(0, hideUploadRefs + (on ? 1 : -1));
    document.documentElement.classList.toggle("vc-nwc-hide-upload", hideUploadRefs > 0);
}

export async function sendClipFile(clip: Clip, channelId: string, _draftType: number, onDownload?: ProgressFn, onUpload?: ProgressFn, token?: CancelToken, onPosted?: () => void) {
    token?.throwIfCancelled();
    onDownload?.(0, clip.size);
    const file = await downloadClipFile(clip, onDownload, token);
    token?.throwIfCancelled();

    const { size } = file;
    const upload = new CloudUpload({ file, isThumbnail: false, platform: CloudUploadPlatform.WEB }, channelId);

    let done = false;
    token?.onCancel(() => {
        if (done) return;
        try { upload.cancel(); } catch { }
    });

    upload.on("progress", (loaded: number, total: number) => {
        onUpload?.(Math.min(loaded, total || size), total || size);
    });
    let hidden = false;
    const hide = () => { if (!hidden) { hidden = true; setUploadHidden(true); } };
    const unhide = () => { if (hidden) { hidden = false; setUploadHidden(false); } };
    // keep the composer preview hidden until well after the message posts
    upload.on("complete", () => { done = true; onPosted?.(); setTimeout(unhide, 1500); });
    upload.on("error", () => { done = true; unhide(); });
    token?.onCancel(unhide);
    hide();

    onUpload?.(0, size);

    const reply = PendingReplyStore.getPendingReply(channelId);
    const replyOptions = reply ? MessageActions.getSendMessageOptionsForReply(reply) : {};
    if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });

    await MessageActions.sendMessage(
        channelId,
        { content: "", tts: false, invalidEmojis: [], validNonShortcutEmojis: [] },
        true,
        { ...replyOptions, attachmentsToUpload: [upload] }
    );
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
