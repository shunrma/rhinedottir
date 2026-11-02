# Rhinedottir

A Windows launcher for our Minecraft 1.21.1 NeoForge modpacks, plus the packs themselves.

- `src/`: the launcher (Electron).
- `packs.json` and `packs/`: the packs the launcher shows and installs. See [packs/README.md](packs/README.md).
- `tools/publish.bat`: publishes a new version of a pack from a CurseForge instance.

The repo is public, so the launcher needs no key: it reads packs and downloads their files straight from here,
and updates itself from this repo's releases.

## Releasing a launcher update

Bump `version` in `package.json` and push to `main`. The **Launcher** workflow builds
`Rhinedottir-Setup-<version>.exe` and publishes it as release `v<version>`. Installed launchers find it in the
background when they start and show a small "ready" popup; it installs on restart.

For now builds have no Microsoft sign-in: players launch offline under their Windows user name.

## Developing

```
npm install
npm start          # run the launcher
npm test
npm run dist:dev   # build a local installer into dist/
```
