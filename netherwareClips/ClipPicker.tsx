/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { copyWithToast, insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { Channel } from "@vencord/discord-types";
import { React, Toasts, Tooltip, UploadHandler, useCallback, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { baseUrl, cachedLibrary, CancelledError, cancelPrefetchClip, CancelToken, Clip, downloadClipFile, fetchLibrary, formatSize, Genre, genreCoverUrl, hydrate, Library, linkFor, logoUrl, mediaUrl, pendingReplyTarget, prefetchClip, sendClipFile, subscribe, thumbUrl, warmEmbed } from "./api";
import { showProgressToast } from "./progressToast";
import { settings } from "./settings";

export const cl = classNameFactory("vc-nwc-");

const REFRESH_EVERY = 60_000;
let lastGenre = "all";
let lastQuery = "";
let lastShown = 0;
let lastScroll = 0;

type SizeSort = "any" | "small" | "big";
type Category = "any" | "uncat";
interface Filters { size: SizeSort; cat: Category; chars: string[]; }
const DEFAULT_FILTERS: Filters = { size: "any", cat: "any", chars: [] };
let lastFilters: Filters = { ...DEFAULT_FILTERS };
let lastFiltersOpen = false;

const SIZE_SORTS: [SizeSort, string][] = [["any", "Default"], ["small", "↑\u00a0 Smallest first"], ["big", "↓\u00a0 Largest first"]];
const CATEGORIES: [Category, string][] = [["any", "All videos"], ["uncat", "Uncategorised"]];

type PickAction = "insert" | "send" | "upload" | "sendfile";

interface PickerProps {
    channel: Channel;
    draftType: number;
    close(): void;
}

const searchText = new WeakMap<Clip, string>();
function textOf(clip: Clip) {
    let t = searchText.get(clip);
    if (t === undefined) {
        t = `${clip.caption} ${clip.author} ${clip.genre} ${(clip.characters ?? []).join(" ")}`.toLowerCase();
        searchText.set(clip, t);
    }
    return t;
}

function matches(clip: Clip, terms: string[]) {
    if (!terms.length) return true;
    const hay = textOf(clip);
    return terms.every(term => hay.includes(term));
}

const SearchIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

const ExternalIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M14 4h6v6M20 4l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

const FilterIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 5h16l-6.5 8v5l-3 2v-7L4 5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
);

function FilterGroup<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange(v: T): void; }) {
    return (
        <div className={cl("fgroup")}>
            <div className={cl("flabel")}>{label}</div>
            <div className={cl("frows")}>
                {options.map(([v, text], i) => (
                    <button key={v} className={cl("frow", { on: value === v })} style={{ animationDelay: `${i * 30}ms` }} onClick={() => onChange(v)}>{text}</button>
                ))}
            </div>
        </div>
    );
}

function CharRows({ names, counts, picked, onToggle }: { names: string[]; counts: Record<string, number>; picked: string[]; onToggle(name: string): void; }) {
    const listRef = useRef<HTMLDivElement>(null);
    const prevRects = useRef(new Map<string, number>());

    React.useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const rows = [...list.querySelectorAll<HTMLElement>("[data-char]")];
        const before = prevRects.current;
        const after = new Map<string, number>();
        for (const el of rows) {
            const name = el.dataset.char!;
            const { top } = el.getBoundingClientRect();
            after.set(name, top);
            const prev = before.get(name);
            if (prev === undefined) {
                if (before.size) el.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
                continue;
            }
            const delta = prev - top;
            if (delta) el.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
        }
        prevRects.current = after;
    }, [names]);

    return (
        <div className={cl("frows")} ref={listRef}>
            {names.map((name, i) => (
                <button
                    key={name}
                    data-char={name}
                    className={cl("frow", "frow-char", { on: picked.includes(name) })}
                    style={{ animationDelay: `${Math.min(i, 14) * 22}ms` }}
                    onClick={() => onToggle(name)}
                    title={name}
                >
                    <span className={cl("cname")}>{name}</span>
                    <span className={cl("cnum")}>{counts[name]}</span>
                </button>
            ))}
        </div>
    );
}

const UpIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 19V6m0 0-6 6m6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const ChevronIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const PinIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M16 3a1 1 0 0 1 .7 1.7L15 6.4V11l3 3v2h-5v5l-1 1-1-1v-5H6v-2l3-3V6.4L7.3 4.7A1 1 0 0 1 8 3h8Z" />
    </svg>
);

const LinkIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
);

const SendIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3.4 3.6a1 1 0 0 1 1.1-.2l16 8a1 1 0 0 1 0 1.8l-16 8a1 1 0 0 1-1.4-1.1L4.9 13H11a1 1 0 1 0 0-2H4.9L3.1 4.6a1 1 0 0 1 .3-1Z" />
    </svg>
);

const FileIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.3 17a1.6 1.6 0 0 1-2.3-2.3L15 6.7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

function ActionButton({ label, icon, primary, onClick }: { label: string; icon: React.ReactNode; primary: boolean; onClick(): void; }) {
    return (
        <Tooltip text={label} position="top">
            {({ onMouseEnter, onMouseLeave }) => (
                <button
                    className={cl("action", { primary })}
                    aria-label={label}
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                    onClick={onClick}
                >
                    {icon}
                </button>
            )}
        </Tooltip>
    );
}

function GenreCardImpl({ id, label, count, cover, active, index, onClick }: {
    id: string; label: string; count: number; cover: string | null; active: boolean; index: number; onClick(id: string): void;
}) {
    return (
        <button
            className={cl("genre", { active, logo: id === "all", pin: id === "pinned" })}
            style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
            onClick={() => onClick(id)}
            title={label}
        >
            <div className={cl("genre-cover")}>
                {cover && id !== "all" && <img className={cl("genre-bg")} src={cover} alt="" loading="lazy" decoding="async" aria-hidden="true" />}
                {cover ? <img className={cl("genre-img")} src={cover} alt="" loading="lazy" decoding="async" /> : <PinIcon />}
                <div className={cl("genre-shade")} />
            </div>
            <div className={cl("genre-label")}>{label}</div>
            <div className={cl("genre-count")}>{count} {count === 1 ? "edit" : "edits"}</div>
        </button>
    );
}

let GenreCardMemo: typeof GenreCardImpl | undefined;
const getGenreCard = () => GenreCardMemo ??= React.memo(GenreCardImpl) as unknown as typeof GenreCardImpl;

function HoverPreview({ clip }: { clip: Clip; }) {
    const ref = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const sound = settings.store.previewSound;
        el.muted = !sound;
        el.defaultMuted = !sound;
        el.volume = sound ? settings.store.previewVolume / 100 : 0;
        const tryPlay = () => el.play().catch(() => {
            if (el.muted) return;
            el.muted = true;
            el.play().catch(() => { });
        });
        tryPlay();
        el.addEventListener("canplay", tryPlay);
        return () => {
            el.removeEventListener("canplay", tryPlay);
            el.pause();
            el.removeAttribute("src");
            el.load();
        };
    }, []);

    return (
        <video
            ref={ref}
            className={cl("preview", { playing })}
            src={mediaUrl(clip)}
            loop
            playsInline
            preload="auto"
            onPlaying={() => setPlaying(true)}
        />
    );
}

const HOVER_DELAY = 180;
const PREFETCH_DELAY = 900;
const TOP_THRESHOLD = 420;

function ClipCardImpl({ clip, index, onPick, onCopy }: { clip: Clip; index: number; onPick(clip: Clip, action?: PickAction): void; onCopy(clip: Clip): void; }) {
    const [hover, setHover] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [broken, setBroken] = useState(false);
    const hoverTimer = useRef<number | undefined>(undefined);
    const prefetchTimer = useRef<number | undefined>(undefined);
    const prefetched = useRef(false);

    const enter = () => {
        window.clearTimeout(hoverTimer.current);
        window.clearTimeout(prefetchTimer.current);
        hoverTimer.current = window.setTimeout(() => setHover(true), HOVER_DELAY);
        prefetchTimer.current = window.setTimeout(() => { prefetched.current = true; prefetchClip(clip); }, PREFETCH_DELAY);
    };
    const leave = () => {
        window.clearTimeout(hoverTimer.current);
        window.clearTimeout(prefetchTimer.current);
        setHover(false);
        if (prefetched.current) { prefetched.current = false; cancelPrefetchClip(clip); }
    };
    useEffect(() => () => { window.clearTimeout(hoverTimer.current); window.clearTimeout(prefetchTimer.current); }, []);

    return (
        <div
            className={cl("card", { pinned: clip.pinned, loaded })}
            style={{ animationDelay: `${Math.min(index % 30, 18) * 22}ms` }}
            onMouseEnter={enter}
            onMouseLeave={leave}
            onClick={() => { prefetched.current = false; onPick(clip); }}
            onContextMenu={e => { e.preventDefault(); onCopy(clip); }}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(clip); } }}
        >
            <div className={cl("thumb-wrap")}>
                {!broken && (
                    <img
                        className={cl("thumb")}
                        src={thumbUrl(clip)}
                        loading="lazy"
                        decoding="async"
                        alt=""
                        onLoad={() => setLoaded(true)}
                        onError={() => { setBroken(true); setLoaded(true); }}
                    />
                )}
                {hover && settings.store.hoverPreview && <HoverPreview clip={clip} />}
                <div className={cl("top")}>
                    {clip.pinned && <span className={cl("badge", "badge-pin")}>Pinned</span>}
                </div>
                <div className={cl("actions")} onClick={e => e.stopPropagation()}>
                    <ActionButton label="Insert link" icon={<LinkIcon />} primary={settings.store.clickAction === "insert"} onClick={() => onPick(clip, "insert")} />
                    <ActionButton label={`Send video · ${formatSize(clip.size)}`} icon={<SendIcon />} primary={settings.store.clickAction === "sendfile"} onClick={() => onPick(clip, "sendfile")} />
                    <ActionButton label="Attach file (review first)" icon={<FileIcon />} primary={settings.store.clickAction === "upload"} onClick={() => onPick(clip, "upload")} />
                </div>
            </div>
            <div className={cl("meta")}>
                <div className={cl("caption")}>{clip.caption || ""}</div>
                <div className={cl("author")}>@{clip.author || "unknown"}</div>
            </div>
        </div>
    );
}

let ClipCardMemo: typeof ClipCardImpl | undefined;
const getClipCard = () => ClipCardMemo ??= React.memo(
    ClipCardImpl,
    (a, b) => a.clip.id === b.clip.id && a.clip.v === b.clip.v && a.clip.pinned === b.clip.pinned && a.onPick === b.onPick && a.onCopy === b.onCopy
) as unknown as typeof ClipCardImpl;

const WHEEL_EASE = 0.11;
const WHEEL_STEP = 190;

function GenreStrip({ children }: { children: React.ReactNode; }) {
    const ref = useRef<HTMLDivElement>(null);
    const drag = useRef<{ x: number; left: number; moved: boolean; } | null>(null);
    const edgesRef = useRef({ left: false, right: false });
    const [edges, setEdges] = useState(edgesRef.current);
    const edgeRaf = useRef(0);

    const updateEdges = () => {
        if (edgeRaf.current) return;
        edgeRaf.current = requestAnimationFrame(() => {
            edgeRaf.current = 0;
            const el = ref.current;
            if (!el) return;
            const next = {
                left: el.scrollLeft > 4,
                right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4
            };
            if (next.left !== edgesRef.current.left || next.right !== edgesRef.current.right) {
                edgesRef.current = next;
                setEdges(next);
            }
        });
    };

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        updateEdges();
        const ro = new ResizeObserver(updateEdges);
        ro.observe(el);

        let target: number | null = null;
        let raf = 0;
        const chase = () => {
            if (target === null) { raf = 0; return; }
            const max = el.scrollWidth - el.clientWidth;
            target = Math.max(0, Math.min(max, target));
            const gap = target - el.scrollLeft;
            if (Math.abs(gap) < 0.35) {
                el.scrollLeft = target;
                target = null;
                raf = 0;
                return;
            }
            el.scrollLeft += gap * WHEEL_EASE;
            raf = requestAnimationFrame(chase);
        };
        const onWheel = (e: WheelEvent) => {
            if (el.scrollWidth <= el.clientWidth) return;
            e.preventDefault();
            e.stopPropagation();
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (!delta) return;
            const from = target ?? el.scrollLeft;
            target = from + Math.max(-WHEEL_STEP, Math.min(WHEEL_STEP, delta));
            if (!raf) raf = requestAnimationFrame(chase);
        };
        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            target = null;
            drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
        };
        const onMouseMove = (e: MouseEvent) => {
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.x;
            if (Math.abs(dx) > 4) d.moved = true;
            if (d.moved) el.scrollLeft = d.left - dx;
        };
        const endDrag = () => { drag.current = null; };

        el.addEventListener("wheel", onWheel, { passive: false });
        el.addEventListener("scroll", updateEdges, { passive: true });
        el.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove, { passive: true });
        window.addEventListener("mouseup", endDrag);
        return () => {
            ro.disconnect();
            cancelAnimationFrame(raf);
            cancelAnimationFrame(edgeRaf.current);
            el.removeEventListener("wheel", onWheel);
            el.removeEventListener("scroll", updateEdges);
            el.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", endDrag);
        };
    }, []);

    const scrollBy = (dx: number) => ref.current?.scrollBy({ left: dx, behavior: "smooth" });

    return (
        <div className={cl("strip", { "edge-left": edges.left, "edge-right": edges.right })}>
            <div
                ref={ref}
                className={cl("genres")}
                onClickCapture={e => {
                    if (drag.current?.moved) { e.stopPropagation(); e.preventDefault(); }
                }}
            >
                {children}
            </div>
            <button className={cl("arrow", "arrow-left")} aria-label="Scroll left" onClick={() => scrollBy(-300)}>‹</button>
            <button className={cl("arrow", "arrow-right")} aria-label="Scroll right" onClick={() => scrollBy(300)}>›</button>
        </div>
    );
}

function Skeleton() {
    return (
        <>
            <div className={cl("genres")}>
                {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className={cl("genre", "skeleton")} style={{ animationDelay: `${i * 60}ms` }}>
                        <div className={cl("genre-cover")} />
                        <div className={cl("skeleton-line")} />
                        <div className={cl("skeleton-line", "short")} />
                    </div>
                ))}
            </div>
            <div className={cl("grid")}>
                {Array.from({ length: 9 }, (_, i) => (
                    <div key={i} className={cl("card", "skeleton")} style={{ animationDelay: `${i * 40}ms` }} />
                ))}
            </div>
        </>
    );
}

export function ClipPicker({ channel, draftType, close }: PickerProps) {
    const ClipCard = getClipCard();
    const GenreCard = getGenreCard();
    const [library, setLibrary] = useState<Library | null>(cachedLibrary);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState(lastQuery);
    const [filters, setFiltersState] = useState<Filters>(lastFilters);
    const [filtersOpen, setFiltersOpenState] = useState(lastFiltersOpen);
    const setFiltersOpen = (v: boolean) => { lastFiltersOpen = v; setFiltersOpenState(v); };
    const setFilters = (patch: Partial<Filters>) => {
        lastFilters = { ...lastFilters, ...patch };
        setFiltersState(lastFilters);
    };
    const toggleChar = (name: string) => {
        const chars = filters.chars.includes(name) ? filters.chars.filter(c => c !== name) : [...filters.chars, name];
        setFilters({ chars, cat: "any" });
    };
    const setCategory = (cat: Category) => setFilters(cat === "uncat" ? { cat, chars: [] } : { cat });
    const filtersActive = filters.size !== "any" || filters.cat !== "any" || filters.chars.length > 0;
    const [genre, setGenreState] = useState<string>(lastGenre);
    const setGenre = useCallback((g: string) => {
        lastGenre = g;
        setGenreState(g);
        if (lastFilters.chars.length) { lastFilters = { ...lastFilters, chars: [] }; setFiltersState(lastFilters); }
    }, []);
    const deferredQuery = React.useDeferredValue(query);
    const [shown, setShown] = useState(Math.max(lastShown, settings.store.pageSize));
    const firstRender = useRef(true);
    const [busy, setBusyState] = useState(false);
    const busyRef = useRef(false);
    const setBusy = (v: boolean) => { busyRef.current = v; setBusyState(v); };
    const closeRef = useRef(close);
    closeRef.current = close;
    const scrollRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const refresh = () => fetchLibrary().then(() => setError(null)).catch(e => setError(String(e?.message ?? e)));
        const unsub = subscribe(setLibrary);
        hydrate().then(refresh);
        const timer = setInterval(refresh, REFRESH_EVERY);
        return () => { unsub(); clearInterval(timer); };
    }, []);

    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => {
        if (firstRender.current) {
            firstRender.current = false;
            return;
        }
        setShown(settings.store.pageSize);
        lastScroll = 0;
        scrollRef.current?.scrollTo({ top: 0 });
    }, [query, genre, filters]);

    React.useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el || !library || !lastScroll || restoringScroll.current) return;
        restoringScroll.current = true;
        const target = lastScroll;
        el.scrollTop = target;
        const raf = requestAnimationFrame(() => {
            el.scrollTop = target;
            restoringScroll.current = false;
        });
        return () => cancelAnimationFrame(raf);
    }, [library]);

    const [showTop, setShowTop] = useState(lastScroll > TOP_THRESHOLD);
    const onScroll = useCallback(() => {
        const top = scrollRef.current?.scrollTop ?? 0;
        setShowTop(top > TOP_THRESHOLD);
        if (restoringScroll.current) return;
        lastScroll = top;
    }, []);
    const scrollToTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });

    const restoringScroll = useRef(false);
    useEffect(() => { lastQuery = query; }, [query]);
    useEffect(() => { lastShown = shown; }, [shown]);

    const genreCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const c of library?.clips ?? []) counts[c.genre] = (counts[c.genre] ?? 0) + 1;
        return counts;
    }, [library]);

    const sorted = useMemo(() => {
        if (!library) return [];
        const pin = settings.store.pinnedFirst ? (a: Clip, b: Clip) => Number(b.pinned) - Number(a.pinned) : () => 0;
        const by: Record<SizeSort, (a: Clip, b: Clip) => number> = {
            any: (a, b) => b.addedAt - a.addedAt,
            small: (a, b) => (a.size || 0) - (b.size || 0) || b.addedAt - a.addedAt,
            big: (a, b) => (b.size || 0) - (a.size || 0) || b.addedAt - a.addedAt
        };
        const cmp = by[filters.size];
        return [...library.clips].sort((a, b) => pin(a, b) || cmp(a, b));
    }, [library, filters.size]);

    const charCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        if (!library || genre === "all" || genre === "pinned") return counts;
        for (const c of library.clips) {
            if (c.genre !== genre) continue;
            for (const name of c.characters ?? []) counts[name] = (counts[name] ?? 0) + 1;
        }
        return counts;
    }, [library, genre]);
    const charNames = useMemo(() => {
        const names = Object.keys(charCounts).sort((a, b) => charCounts[b] - charCounts[a]);
        const picked = new Set(filters.chars);
        return [...names.filter(n => picked.has(n)), ...names.filter(n => !picked.has(n))];
    }, [charCounts, filters.chars]);

    const filtered = useMemo(() => {
        const terms = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
        return sorted.filter(c =>
            (filters.cat === "uncat" ? c.genre === "other" : (genre === "all" || (genre === "pinned" ? c.pinned : c.genre === genre)))
            && (!filters.chars.length || (c.characters ?? []).some(n => filters.chars.includes(n)))
            && matches(c, terms)
        );
    }, [sorted, deferredQuery, genre, filters.cat, filters.chars]);

    const pinnedCount = useMemo(() => library?.clips.reduce((n, c) => n + Number(c.pinned), 0) ?? 0, [library]);

    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const obs = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) {
                setShown(n => Math.min(n + settings.store.pageSize, filtered.length));
            }
        }, { root: scrollRef.current, rootMargin: "400px" });
        obs.observe(el);
        return () => obs.disconnect();
    }, [filtered.length, shown]);

    const finish = () => {
        if (settings.store.closeOnPick) closeRef.current();
    };

    const onPick = useCallback(async (clip: Clip, action: PickAction = settings.store.clickAction as PickAction) => {
        if (busyRef.current) return;
        warmEmbed(clip);

        if (action === "insert") {
            insertTextIntoChatInputBox(linkFor(clip) + " ");
            finish();
            return;
        }

        if (action === "send") {
            setBusy(true);
            try {
                await sendMessage(channel.id, { content: linkFor(clip) });
                finish();
            } catch (e) {
                Toasts.show({ message: "Failed to send: " + String(e), type: Toasts.Type.FAILURE, id: Toasts.genId() });
            } finally {
                setBusy(false);
            }
            return;
        }

        if (action === "sendfile") {
            const tooBig = settings.store.largeClipAsLink && clip.size >= settings.store.largeClipThresholdMB * 1024 * 1024;
            if (tooBig) {
                finish();
                const toast = showProgressToast(clip, { replyTo: pendingReplyTarget(channel.id)?.name });
                toast.stage("Sending playable link");
                warmEmbed(clip);
                try {
                    await sendMessage(channel.id, { content: linkFor(clip) });
                    toast.success("Sent as link");
                } catch (e) {
                    toast.fail(String((e as Error)?.message ?? e));
                }
                return;
            }
            finish();
            const toast = showProgressToast(clip, { replyTo: pendingReplyTarget(channel.id)?.name });
            const token = new CancelToken();
            toast.onCancel(() => token.cancel());
            let stage = "";
            const setStage = (label: string) => { if (stage !== label) { stage = label; toast.stage(label); } };
            try {
                await sendClipFile(
                    clip,
                    channel.id,
                    (r, t) => { setStage("Fetching from netherware.xyz"); toast.progress(r, t); },
                    (r, t) => { setStage("Uploading to Discord"); toast.progress(r, t); },
                    token,
                    () => toast.success("Sent")
                );
            } catch (e) {
                if (e instanceof CancelledError || token.cancelled) toast.cancelled();
                else toast.fail(String((e as Error)?.message ?? e));
            }
            return;
        }

        finish();
        const toast = showProgressToast(clip);
        const token = new CancelToken();
        toast.onCancel(() => token.cancel());
        toast.stage("Fetching from netherware.xyz");
        try {
            const file = await downloadClipFile(clip, (r, t) => toast.progress(r, t), token);
            UploadHandler.promptToUpload([file], channel, draftType);
            toast.success("Attached");
        } catch (e) {
            if (e instanceof CancelledError || token.cancelled) toast.cancelled();
            else toast.fail(String((e as Error)?.message ?? e));
        }
    }, [channel, draftType]);

    const onCopy = useCallback((clip: Clip) => {
        warmEmbed(clip);
        copyWithToast(linkFor(clip), settings.store.invisibleLink ? "Invis link copied" : "Link copied");
    }, []);

    const genres: Genre[] = useMemo(
        () => [...(library?.genres ?? [])].sort((a, b) => (genreCounts[b.id] ?? 0) - (genreCounts[a.id] ?? 0)),
        [library, genreCounts]
    );
    const total = library?.clips.length ?? 0;
    const activeLabel = genre === "all" ? "All" : genre === "pinned" ? "Pinned" : genres.find(g => g.id === genre)?.label ?? genre;

    return (
        <div className={cl("popout", { busy, "drawer-open": filtersOpen })} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
            <div className={cl("header")}>
                <div className={cl("search-wrap")}>
                    <SearchIcon />
                    <input
                        ref={inputRef}
                        className={cl("search")}
                        type="text"
                        placeholder="Search captions or creators…"
                        value={query}
                        onChange={e => setQuery(e.currentTarget.value)}
                        onKeyDown={e => {
                            if (e.key === "Escape" && query) { e.stopPropagation(); setQuery(""); }
                            if (e.key === "Enter" && filtered.length) onPick(filtered[0]);
                        }}
                    />
                    {query && <button className={cl("clear")} onClick={() => setQuery("")} aria-label="Clear">×</button>}
                </div>
                <button className={cl("icon-btn")} title="Open netherware.xyz" onClick={() => VencordNative.native.openExternal(`${baseUrl()}/tiktok`)}>
                    <ExternalIcon />
                </button>
            </div>

            <div className={cl("body")}>
            <div className={cl("scroll")} ref={scrollRef} onScroll={onScroll}>
                {!library && !error && <Skeleton />}

                {library && (
                    <GenreStrip>
                        <GenreCard id="all" label="All" count={total} cover={logoUrl()} active={genre === "all"} index={0} onClick={setGenre} />
                        {pinnedCount > 0 && (
                            <GenreCard id="pinned" label="Pinned" count={pinnedCount} cover={null} active={genre === "pinned"} index={1} onClick={setGenre} />
                        )}
                        {genres.map((g, i) => (
                            <GenreCard
                                key={g.id}
                                id={g.id}
                                label={g.label}
                                count={genreCounts[g.id] ?? 0}
                                cover={genreCoverUrl(g, library.coverVersions[g.id])}
                                active={genre === g.id}
                                index={i + 2}
                                onClick={setGenre}
                            />
                        ))}
                    </GenreStrip>
                )}

                {library && (
                    <div className={cl("section")}>
                        <span className={cl("section-title")}>{query ? `Results for “${query}”` : activeLabel}</span>
                        <span className={cl("section-count")}>{filtered.length}</span>
                        <button
                            className={cl("filter-btn", { active: filtersActive, open: filtersOpen })}
                            onClick={() => setFiltersOpen(!filtersOpen)}
                            aria-expanded={filtersOpen}
                        >
                            <FilterIcon />
                            <span>Filter</span>
                            {filtersActive && <span className={cl("filter-dot")} />}
                        </button>
                    </div>
                )}



                {error && !library && (
                    <div className={cl("state", "state-error")}>
                        <span>Could not load the library: {error}</span>
                        <button className={cl("retry")} onClick={() => fetchLibrary().then(() => setError(null)).catch(e => setError(String(e?.message ?? e)))}>Retry</button>
                    </div>
                )}
                {library && !filtered.length && <div className={cl("state")}>No clips match.</div>}

                {library && (
                    <div className={cl("grid")} key={genre}>
                        {filtered.slice(0, shown).map((clip, i) => (
                            <ClipCard key={clip.id} clip={clip} index={i} onPick={onPick} onCopy={onCopy} />
                        ))}
                    </div>
                )}
                {shown < filtered.length && <div ref={sentinelRef} className={cl("sentinel")}><span className={cl("spinner")} /></div>}
            </div>
            <button className={cl("totop", { show: showTop })} onClick={scrollToTop} aria-label="Back to top" tabIndex={showTop ? 0 : -1}>
                <UpIcon />
            </button>
            </div>

            <aside className={cl("fside")} aria-hidden={!filtersOpen}>
                <div className={cl("fside-head")}>
                    <span>Filters</span>
                    <button className={cl("fside-close")} onClick={() => setFiltersOpen(false)} aria-label="Close filters"><ChevronIcon /></button>
                </div>
                <div className={cl("fside-body")}>
                    <FilterGroup label="Sort by size" options={SIZE_SORTS} value={filters.size} onChange={size => setFilters({ size })} />
                    <FilterGroup label="Category" options={CATEGORIES} value={filters.cat} onChange={setCategory} />
                    {charNames.length > 0 && filters.cat !== "uncat" && (
                        <div className={cl("fgroup")}>
                            <div className={cl("flabel")}>
                                {filters.chars.length ? `Characters · ${filters.chars.length} selected` : `Characters · ${charNames.length}`}
                            </div>
                            <CharRows names={charNames} counts={charCounts} picked={filters.chars} onToggle={toggleChar} />
                        </div>
                    )}
                    <button className={cl("fclear")} disabled={!filtersActive} onClick={() => setFilters({ ...DEFAULT_FILTERS })}>Reset all filters</button>
                </div>
            </aside>
        </div>
    );
}
