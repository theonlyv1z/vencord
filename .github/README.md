# Netherware Vencord plugins

Our own [Vencord](https://vencord.dev) plugins. This repo is meant to be dropped in as the
`src/userplugins` folder of a Vencord dev build — every folder here is one plugin.

| Plugin | What it does |
| --- | --- |
| [netherwareClips](../netherwareClips/) | Chat-bar button that opens the netherware.xyz clip library as a sticker-style picker; click a clip to send it. |
| [downloadAssets](../downloadAssets/) | Right-click → Download for emojis & stickers (messages, reactions, picker), role icons, avatars, server icons and banners. |

## Install

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
git clone https://github.com/theonlyv1z/vencord src/userplugins
pnpm install --frozen-lockfile
pnpm build
pnpm inject
```

Restart Discord, then enable the plugins in Vencord → Plugins.

## Updating

```bash
cd Vencord/src/userplugins && git pull
cd ../.. && pnpm build
```

## License

[GPL-3.0-or-later](LICENSE), same as Vencord.
