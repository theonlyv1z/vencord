/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Clip, formatSize, setUploadHidden, thumbUrl } from "./api";

const CONTAINER_ID = "vc-nwc-toasts";

// Mount our cards in-flow just above the message composer — the same slot
// Discord uses for its own upload preview — so they push the message list up
// instead of floating over it. Falls back to a fixed overlay if the composer
// isn't found. A MutationObserver re-inserts the container if React re-renders
// the bar while a card is showing.
function mountInfo(): { parent: HTMLElement; before: Element | null; } | null {
    // Above the input row (full width), inside channelTextArea but before the
    // input's scrollableContainer. Do NOT mount inside scrollableContainer — it
    // is React-managed and crashes Discord.
    const ta = document.querySelector<HTMLElement>('[class*="channelTextArea_"]');
    const sc = ta?.querySelector('[class*="scrollableContainer_"]') ?? null;
    if (ta && sc) return { parent: ta, before: sc };
    const bar = document.querySelector<HTMLElement>('[class*="channelBottomBarArea_"]');
    if (bar) return { parent: bar, before: bar.firstElementChild };
    return null;
}

let reinsertObserver: MutationObserver | null = null;

function ensureMounted(el: HTMLElement) {
    const info = mountInfo();
    if (info) {
        el.classList.remove("vc-nwc-toasts-floating");
        if (el.parentElement !== info.parent || el.nextElementSibling !== info.before) {
            info.parent.insertBefore(el, info.before);
        }
    } else if (!el.parentElement) {
        el.classList.add("vc-nwc-toasts-floating");
        document.body.appendChild(el);
    }
}

function container() {
    let el = document.getElementById(CONTAINER_ID);
    if (!el) {
        el = document.createElement("div");
        el.id = CONTAINER_ID;
    }
    ensureMounted(el);

    if (!reinsertObserver) {
        // Discord churns the DOM constantly; coalesce to one check per frame and
        // bail early unless our container actually got detached.
        let pending = 0;
        reinsertObserver = new MutationObserver(() => {
            if (pending) return;
            pending = requestAnimationFrame(() => {
                pending = 0;
                const c = document.getElementById(CONTAINER_ID);
                if (!c || c.childElementCount === 0) return;
                const info = mountInfo();
                if (info && c.parentElement !== info.parent) ensureMounted(c);
            });
        });
        reinsertObserver.observe(document.body, { childList: true, subtree: true });
    }
    return el;
}

export interface ProgressToast {
    stage(label: string): void;
    progress(received: number, total: number): void;
    success(label?: string): void;
    fail(label: string): void;
    cancelled(): void;
    dismiss(): void;
    onCancel(fn: () => void): void;
}

export function showProgressToast(clip: Clip, opts: { replyTo?: string | null; } = {}): ProgressToast {
    const root = document.createElement("div");
    root.className = "vc-nwc-toast";
    root.innerHTML = `
        <div class="vc-nwc-toast-thumb"><img alt="" src="${thumbUrl(clip)}"><div class="vc-nwc-toast-ring"></div></div>
        <div class="vc-nwc-toast-body">
            <div class="vc-nwc-toast-row">
                <span class="vc-nwc-toast-title"></span>
                <span class="vc-nwc-toast-pct"></span>
            </div>
            <div class="vc-nwc-toast-sub"></div>
            <div class="vc-nwc-toast-reply" hidden><svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true"><path d="M9 7 4 12l5 5M4 12h9a6 6 0 0 1 6 6v1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span></div>
            <div class="vc-nwc-toast-bar"><div class="vc-nwc-toast-fill"></div></div>
        </div>
        <div class="vc-nwc-toast-end">
            <div class="vc-nwc-toast-status"></div>
            <button class="vc-nwc-toast-x" type="button" aria-label="Cancel" title="Cancel">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
            </button>
        </div>
    `;

    const title = root.querySelector<HTMLElement>(".vc-nwc-toast-title")!;
    const pct = root.querySelector<HTMLElement>(".vc-nwc-toast-pct")!;
    const sub = root.querySelector<HTMLElement>(".vc-nwc-toast-sub")!;
    const reply = root.querySelector<HTMLElement>(".vc-nwc-toast-reply")!;
    if (opts.replyTo) {
        reply.querySelector("span")!.textContent = `Replying to ${opts.replyTo}`;
        reply.hidden = false;
    }
    const fill = root.querySelector<HTMLElement>(".vc-nwc-toast-fill")!;
    const status = root.querySelector<HTMLElement>(".vc-nwc-toast-status")!;
    const xBtn = root.querySelector<HTMLButtonElement>(".vc-nwc-toast-x")!;
    let cancelHandler: (() => void) | null = null;
    xBtn.addEventListener("click", e => {
        e.stopPropagation();
        cancelHandler?.();
    });

    const caption = (clip.caption || clip.file).replace(/#\S+/g, "").replace(/\s+/g, " ").trim() || clip.file;
    sub.textContent = `@${clip.author || "unknown"} · ${caption}`;
    title.textContent = "Preparing";
    pct.textContent = "";
    root.classList.add("vc-nwc-toast-indeterminate");

    // Collapse Discord's own upload UI (spacer, composer preview, in-chat
    // uploading row) for exactly as long as this card is on screen — one
    // coordinated layout shift instead of several.
    setUploadHidden(true);
    container().appendChild(root);
    requestAnimationFrame(() => root.classList.add("vc-nwc-toast-in"));

    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        setUploadHidden(false);
        // Once our card is gone and the spacer is restored, make sure the
        // just-sent video is fully in view (a single scroll, no mid-upload jump).
        const scroller = document.querySelector<HTMLElement>('[class*="messagesWrapper_"] [class*="scroller_"]');
        if (scroller) {
            const pin = () => { scroller.scrollTop = scroller.scrollHeight; };
            // Pin repeatedly while the layout settles (card removed, spacer
            // restored, composer shrinks) so the just-sent video isn't left
            // cut off behind the composer.
            requestAnimationFrame(pin);
            [60, 150, 300, 500, 750].forEach(t => setTimeout(pin, t));
        }
    };

    let closeTimer: number | undefined;
    const close = (delay: number) => {
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(() => {
            root.classList.remove("vc-nwc-toast-in");
            root.classList.add("vc-nwc-toast-out");
            // Reveal the video, restore the spacer and scroll WHILE the card is
            // still fading out, so the layout is already settled by the time the
            // card is gone — no visible jump after it closes.
            release();
            window.setTimeout(() => {
                root.remove();
                const c = document.getElementById(CONTAINER_ID);
                if (c && c.childElementCount === 0) c.remove();
            }, 340);
        }, delay);
    };

    const settle = (cls: string, label: string, delay: number) => {
        root.classList.remove("vc-nwc-toast-indeterminate", "vc-nwc-toast-done", "vc-nwc-toast-error", "vc-nwc-toast-cancelled");
        root.classList.add(cls);
        title.textContent = label;
        pct.textContent = "";
        xBtn.remove();
        close(delay);
    };

    return {
        onCancel(fn) { cancelHandler = fn; },
        dismiss() { xBtn.remove(); close(0); },
        cancelled() {
            settle("vc-nwc-toast-cancelled", "Cancelled", 1600);
            status.innerHTML = '<span class="vc-nwc-toast-badge vc-nwc-toast-badge-x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span>';
            requestAnimationFrame(() => { fill.style.width = "0%"; });
        },
        stage(label) {
            title.textContent = label;
            fill.style.width = "0%";
            pct.textContent = "";
            root.classList.add("vc-nwc-toast-indeterminate");
        },
        progress(received, total) {
            if (!total) return;
            root.classList.remove("vc-nwc-toast-indeterminate");
            const ratio = Math.max(0, Math.min(1, received / total));
            fill.style.width = `${(ratio * 100).toFixed(1)}%`;
            pct.textContent = `${Math.round(ratio * 100)}%`;
            status.textContent = `${formatSize(received)} / ${formatSize(total)}`;
        },
        success(label = "Sent") {
            settle("vc-nwc-toast-done", label, 1800);
            fill.style.width = "100%";
            status.innerHTML = '<span class="vc-nwc-toast-check"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
        },
        fail(label) {
            settle("vc-nwc-toast-error", "Failed", 4000);
            status.textContent = label;
        }
    };
}
