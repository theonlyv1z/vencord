# NetherwareClips

A [Vencord](https://vencord.dev) plugin that adds a button next to the Discord message bar which opens the
[netherware.xyz](https://netherware.xyz/tiktok) clip library as a sticker-style picker. Browse by genre,
search captions/creators, hover to preview (with sound), and click a clip to send it.

## Features

- Chat-bar button with a picker popout anchored to the message box (works at any window size)
- Genre cover strip (wheel / drag / arrow scrolling) + search
- Hover video previews with volume control
- One click sends the mp4 directly (or inserts an invisible embed link / attaches for review — configurable)
- Top-centre progress card showing download + upload progress
- Library is prefetched at startup, cached offline, and refreshed in the background

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
| Library origin | `https://netherware.xyz` |
| Click action | Send the video file immediately |
| Invisible link | on |
| Close picker after choosing | on |
| Hover preview / sound / volume | on / on / 60 |
| Pinned first | on |
| Clips per page | 60 |

## License

GPL-3.0-or-later, same as Vencord.
