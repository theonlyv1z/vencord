/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    baseUrl: {
        type: OptionType.STRING,
        description: "Library origin",
        default: "https://netherware.xyz",
        restartNeeded: false
    },
    hotkey: {
        type: OptionType.STRING,
        description: "Keyboard shortcut to open the picker (e.g. ctrl+shift+n, alt+n; blank to disable)",
        default: "ctrl+shift+n"
    },
    clickAction: {
        type: OptionType.SELECT,
        description: "What clicking a clip does",
        options: [
            { label: "Send the video file immediately", value: "sendfile", default: true },
            { label: "Attach the video file (review before sending)", value: "upload" },
            { label: "Insert link into the message box", value: "insert" },
            { label: "Send the link immediately", value: "send" }
        ]
    },
    invisibleLink: {
        type: OptionType.BOOLEAN,
        description: "Hide the link text so only the video embed shows (invis link)",
        default: true
    },
    closeOnPick: {
        type: OptionType.BOOLEAN,
        description: "Close the picker after choosing a clip",
        default: true
    },
    hoverPreview: {
        type: OptionType.BOOLEAN,
        description: "Play a muted preview when hovering a clip",
        default: true
    },
    previewSound: {
        type: OptionType.BOOLEAN,
        description: "Play the hover preview with sound",
        default: true
    },
    previewVolume: {
        type: OptionType.SLIDER,
        description: "Hover preview volume",
        default: 60,
        markers: [0, 20, 40, 60, 80, 100],
        stickToMarkers: false
    },
    pinnedFirst: {
        type: OptionType.BOOLEAN,
        description: "Show pinned clips before everything else",
        default: true
    },
    pageSize: {
        type: OptionType.SLIDER,
        description: "Clips rendered per page (scroll down for more)",
        default: 60,
        markers: [30, 60, 90, 120, 180],
        stickToMarkers: true
    }
});
