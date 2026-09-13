/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ChatBarButtonFactory } from "@api/ChatButtons";
import { classes } from "@utils/misc";
import definePlugin, { IconComponent } from "@utils/types";
import { findCssClassesLazy } from "@webpack";
import { Clickable, Popout, useRef, useState } from "@webpack/common";

import { fetchLibrary, hydrate } from "./api";
import { cl, ClipPicker } from "./ClipPicker";
import { settings } from "./settings";

const ButtonWrapperClasses = findCssClassesLazy("button", "buttonWrapper", "notificationDot");
const ChannelTextAreaClasses = findCssClassesLazy("buttonContainer", "channelTextArea", "button");

const ClipsIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        aria-hidden="true"
        role="img"
        width={width}
        height={height}
        className={className}
        viewBox="0 0 24 24"
        fill="none"
    >
        <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M3 9h18M8 4v5M16 4v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M10.5 12.2v4.6a.5.5 0 0 0 .77.42l3.6-2.3a.5.5 0 0 0 0-.84l-3.6-2.3a.5.5 0 0 0-.77.42Z" fill="currentColor" />
    </svg>
);

const ClipsButton: ChatBarButtonFactory = ({ isAnyChat, channel, type }) => {
    const anchorRef = useRef<HTMLDivElement>(null);
    const targetRef = useRef<HTMLElement | null>(null);
    const [show, setShow] = useState(false);

    if (!isAnyChat) return null;

    const toggle = () => {
        const anchor = anchorRef.current;
        targetRef.current = anchor?.closest("form") ?? anchor?.closest("[class*=\"channelTextArea\"]") ?? anchor;
        setShow(v => !v);
    };

    return (
        <Popout
            position="top"
            align="right"
            nudgeAlignIntoViewport
            spacing={12}
            animation={Popout.Animation.TRANSLATE}
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={targetRef}
            renderPopout={() => (
                <ClipPicker channel={channel} draftType={type.drafts.type} close={() => setShow(false)} />
            )}
        >
            {(_, { isShown }) => (
                <div
                    ref={anchorRef}
                    className={classes("expression-picker-chat-input-button", ChannelTextAreaClasses?.buttonContainer, "vc-chatbar-button", cl("anchor", { open: isShown }))}
                >
                    <Clickable
                        aria-label="Netherware Clips"
                        aria-haspopup="dialog"
                        aria-expanded={isShown}
                        className={classes(ButtonWrapperClasses.button, ChannelTextAreaClasses?.button, cl("button"))}
                        onClick={toggle}
                    >
                        <div className={ButtonWrapperClasses.buttonWrapper}>
                            <ClipsIcon className={cl("icon")} />
                        </div>
                    </Clickable>
                </div>
            )}
        </Popout>
    );
};

const BACKGROUND_REFRESH = 5 * 60_000;

function matchesHotkey(e: KeyboardEvent, combo: string) {
    const parts = combo.toLowerCase().split("+").map(p => p.trim()).filter(Boolean);
    if (!parts.length) return false;
    const key = parts.pop()!;
    const want = { ctrl: parts.includes("ctrl"), shift: parts.includes("shift"), alt: parts.includes("alt"), meta: parts.includes("meta") || parts.includes("win") };
    return e.ctrlKey === want.ctrl && e.shiftKey === want.shift && e.altKey === want.alt && e.metaKey === want.meta
        && e.key.toLowerCase() === key;
}

function onHotkey(e: KeyboardEvent) {
    const combo = settings.store.hotkey?.trim();
    if (!combo || e.repeat || !matchesHotkey(e, combo)) return;
    const button = document.querySelector<HTMLElement>(".vc-nwc-button");
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    button.click();
}
let refreshTimer: number | undefined;

const FONT_ID = "vc-nwc-font";
const FONT_HREF = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200..800&display=swap";

export default definePlugin({
    name: "NetherwareClips",
    description: "Adds a chat bar button that opens the netherware.xyz clip library as a sticker-style picker: pick a genre, then drop a video into the message with one click.",
    authors: [{ name: "v1z", id: 1021857630068682772n }],
    tags: ["Chat", "Media"],
    settings,

    chatBarButton: {
        icon: ClipsIcon,
        render: ClipsButton
    },

    start() {
        if (!document.getElementById(FONT_ID)) {
            const link = document.createElement("link");
            link.id = FONT_ID;
            link.rel = "stylesheet";
            link.href = FONT_HREF;
            document.head.appendChild(link);
        }

        const warm = () => fetchLibrary().catch(() => { });
        hydrate().then(warm);
        refreshTimer = window.setInterval(warm, BACKGROUND_REFRESH);
        document.addEventListener("keydown", onHotkey, true);
    },

    stop() {
        document.getElementById(FONT_ID)?.remove();
        window.clearInterval(refreshTimer);
        document.removeEventListener("keydown", onHotkey, true);
    }
});
