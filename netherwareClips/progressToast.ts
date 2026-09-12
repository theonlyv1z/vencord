/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Clip, formatSize, thumbUrl } from "./api";

const CONTAINER_ID = "vc-nwc-toasts";

function container() {
    let el = document.getElementById(CONTAINER_ID);
    if (!el) {
        el = document.createElement("div");
        el.id = CONTAINER_ID;
        document.body.appendChild(el);
    }
    return el;
}

export interface ProgressToast {
    stage(label: string): void;
    progress(received: number, total: number): void;
    success(label?: string): void;
    fail(label: string): void;
    cancelled(): void;
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

    container().appendChild(root);
    requestAnimationFrame(() => root.classList.add("vc-nwc-toast-in"));

    let closeTimer: number | undefined;
    const close = (delay: number) => {
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(() => {
            root.classList.remove("vc-nwc-toast-in");
            root.classList.add("vc-nwc-toast-out");
            window.setTimeout(() => root.remove(), 320);
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
        cancelled() {
            settle("vc-nwc-toast-cancelled", "Cancelled", 1400);
            status.textContent = "";
            fill.style.width = "0%";
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
