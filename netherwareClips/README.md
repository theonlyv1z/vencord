# NetherwareClips

A [Vencord](https://vencord.dev) plugin that adds a button next to the Discord message bar which opens the
[netherware.xyz](https://netherware.xyz/tiktok) clip library as a sticker-style picker. Browse by genre,
search captions/creators, hover to preview (with sound), and click a clip to send it.

## Features

- Chat-bar button (or **Ctrl+Shift+N**) with a picker popout anchored to the message box (works at any window size)
- Genre cover strip (wheel / drag / arrow scrolling) + search
- Hover video previews with volume control
- One click sends the mp4 directly (or inserts an invisible embed link / attaches for review — configurable)
- **Fast upload**: the clip is relayed from netherware.xyz straight into Discord's upload slot, so the video never crosses your connection — sends finish in a second or two regardless of your upstream (falls back to a local download + upload if the relay is unavailable)
- Hover previews stream a lightweight 360p rendition, not the full-size file
- Clips over the current channel's upload limit are badged and dimmed
- Progress card in the composer showing upload → posting → sent, with cancel
- Library is prefetched at startup, cached offline, and refreshed in the background
- Auto-updates itself from this repo (git pull + rebuild, then prompts you to restart)

## Install

This plugin ships in the [theonlyv1z/vencord](https://github.com/theonlyv1z/vencord) plugin pack, which is cloned in as Vencord's `src/userplugins` folder:

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
git clone https://github.com/theonlyv1z/vencord src/userplugins
pnpm install --frozen-lockfile
pnpm build
pnpm inject
```

Restart Discord and enable **NetherwareClips** in Vencord → Plugins.

## Settings

| Setting | Default |
| --- | --- |
| Hotkey | `ctrl+shift+n` |
| Library origin | `https://netherware.xyz` |
| Click action | Send the video file immediately |
| Fast upload (relay via netherware.xyz) | on |
| Auto-update | on |
| Invisible link | on |
| Close picker after choosing | on |
| Hover preview / sound / volume | on / on / 60 |
| Pinned first | on |
| Clips per page | 60 |

## License

GPL-3.0-or-later, same as Vencord.
