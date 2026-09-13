/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ChatBarButtonFactory } from "@api/ChatButtons";
import { showNotification } from "@api/Notifications";
import { classes } from "@utils/misc";
import { relaunch } from "@utils/native";
import definePlugin, { IconComponent } from "@utils/types";
import { findCssClassesLazy } from "@webpack";
import { Button, Clickable, Popout, useRef, useState } from "@webpack/common";

import { applyUpdate, checkForUpdate, fetchLibrary, hydrate } from "./api";
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
        fill="currentColor"
    >
        <path d="M16.6 2h-3.2v13.4a2.85 2.85 0 1 1-2.85-2.85c.3 0 .58.05.85.13V9.4a6.1 6.1 0 1 0 5.2 6V8.6a7.9 7.9 0 0 0 4.4 1.35V6.75A4.75 4.75 0 0 1 16.6 2Z" />
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
const UPDATE_CHECK_EVERY = 6 * 60 * 60_000;
let updateTimer: number | undefined;
let updateBusy = false;

async function runUpdateCheck(manual = false) {
    if (updateBusy || (!manual && !settings.store.autoUpdate)) return;
    updateBusy = true;
    try {
        const check = await checkForUpdate();
        if (!check.ok) { if (manual) showNotification({ title: "NetherwareClips", body: "Update check failed: " + check.error }); return; }
        if (!check.behind) { if (manual) showNotification({ title: "NetherwareClips", body: `Up to date (${check.local})` }); return; }
        const res = await applyUpdate();
        if (!res.ok) { showNotification({ title: "NetherwareClips update failed", body: res.error ?? "unknown error" }); return; }
        const summary = check.commits.slice(0, 3).map(c => "• " + c.message).join("\n");
        showNotification({
            title: `NetherwareClips updated (${check.behind} change${check.behind === 1 ? "" : "s"})`,
            body: summary + "\n\nRestart Discord to apply.",
            permanent: true,
            onClick: relaunch
        });
    } finally {
        updateBusy = false;
    }
}

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
        window.setTimeout(() => runUpdateCheck(), 25_000);
        updateTimer = window.setInterval(() => runUpdateCheck(), UPDATE_CHECK_EVERY);
    },

    stop() {
        document.getElementById(FONT_ID)?.remove();
        window.clearInterval(refreshTimer);
        window.clearInterval(updateTimer);
        document.removeEventListener("keydown", onHotkey, true);
    },

    checkForUpdatesNow: () => runUpdateCheck(true),

    settingsAboutComponent: () => (
        <Button size={Button.Sizes.SMALL} onClick={() => runUpdateCheck(true)}>
            Check for updates now
        </Button>
    )
});
