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

### Requirements

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) 18 or newer
- pnpm — `npm install -g pnpm`
- Discord **fully closed** before `pnpm inject` (right-click the tray icon → Quit Discord)

### `pnpm inject` doesn't show Discord / nothing changes

The installer only lists Discord installs it can find in the default locations. If your copy is somewhere else, or you use PTB/Canary, tell it where to look:

```bash
pnpm inject --branch stable
pnpm inject --location "C:\Users\<you>\AppData\Local\Discord"
```

(`--branch` accepts `stable`, `ptb` or `canary`. The Microsoft Store version of Discord can't be patched — install Discord from discord.com instead.)

After it prints **Success**, quit Discord completely from the tray and start it again — a "Vencord" section appears in User Settings. If you already had Vencord from the official installer, `pnpm inject` replaces it with this dev build (run `pnpm uninject` to go back).

### Plugins are missing from Vencord → Plugins

Make sure the repo is cloned **into** `src/userplugins` (so `src/userplugins/netherwareClips/index.tsx` exists), then run `pnpm build` again and restart Discord. Anything left at the root of `src/userplugins` other than plugin folders will break the build.

## Updating

```bash
cd Vencord/src/userplugins && git pull
cd ../.. && pnpm build
```

## License

[GPL-3.0-or-later](LICENSE), same as Vencord.
