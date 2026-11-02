# Packs

Everything the Rhinedottir launcher shows and installs comes from this folder and `packs.json` next to it.

## Layout

```
packs.json                     Which packs appear in the launcher, top to bottom
packs/<pack-id>/
  pack.json                    Name, Minecraft/NeoForge version, links, which folders to ship
  files.json                   Written by the publish tool. Don't edit by hand.
  files/                       The pack's mods, configs and so on. Written by the publish tool.
  icon.png                     Square icon for the left sidebar
  gallery/                     Images for the big preview carousel, shown in filename order
  posts/changes/               "Changes" tab
  posts/bugfixes/              "Bug Fixes" tab
  posts/news/                  "News" tab
```

## Writing a post

Add a file to one of the `posts` folders, either on github.com ("Add file" → "Create new file") or on your PC.
Name it `YYYY-MM-DD Title.md`, for example `2026-11-02 Added Create Steam n Rails.md`.
The file's text is the post body. The newest date is shown first.

## Gallery images

Upload images to `packs/<pack-id>/gallery/`. The big background behind the launcher is `packs/<pack-id>/background.png` (or .jpg); without one, the launcher slowly crossfades through the gallery images. Use 16:9 images (1280×720 or larger) so they fill the preview.
They are shown in filename order, so prefix them with `01-`, `02-`, … to control the order.

## Links on the right

Edit `links` in `pack.json`. Supported `type` values: `discord`, `youtube`, `x`, `reddit`, `twitch`, `website`.
Up to four links are shown. A link with an empty `url` still shows its button and says it's coming soon.

## Distant Horizons terrain

Players can download pre-generated Distant Horizons terrain from the pack menu, at Low, Medium or High quality.
For each quality, upload the server's `DistantHorizons.sqlite` (renamed per quality is fine) to a release in this repo.
**Tick "Set as a pre-release"** on those releases: the launcher's own updates are the repo's latest full release.
then list it in `pack.json`:

```json
"distantHorizons": {
  "folder": "the folder name your PC uses inside Distant_Horizons_server_data for the server",
  "levels": [
    { "id": "low", "label": "Low", "description": "Terrain about 4 km around spawn.", "release": "dh-low", "asset": "DistantHorizons.sqlite", "size": 184000000 },
    { "id": "medium", "label": "Medium", "description": "8 km, including the main rail lines.", "release": "dh-medium", "asset": "DistantHorizons.sqlite", "size": 642000000 },
    { "id": "high", "label": "High", "description": "The whole explored map.", "release": "dh-high", "asset": "DistantHorizons.sqlite", "size": 2100000000 }
  ]
}
```

`size` is in bytes and is only shown to players. An optional `sha1` makes the launcher check the download.
Without a `distantHorizons` section the menu item is hidden.

## Publishing a new version of a pack

You need [Node.js](https://nodejs.org) (the LTS version) installed once.

1. Make your changes in the CurseForge instance and test them.
2. Double-click `tools/publish.bat`.
3. Press Enter to accept the defaults, or type a version like `1.2.0`.
4. Answer **y** to "Include your options.txt" only if you want everyone's settings replaced with yours.
5. It shows what changed. Type **y** to publish.

The first time, it asks for a GitHub token. To avoid typing it every time, save it in `tools/.token`
(this file is never uploaded). Create one at github.com → Settings → Developer settings →
Fine-grained tokens, with access to only `rhinedottir` and **Contents: Read and write**.

### What gets shipped

The folders listed in `include` in `pack.json` (mods, config, defaultconfigs, kubejs, resourcepacks, shaderpacks).
Files matching `exclude` are skipped, so disabled mods (`*.disabled`) are never shipped.

### How players' files are treated on update

- Mods, configs and other shipped files are replaced when you change them, and deleted when you remove them.
- Anything a player added themselves (their own resource packs, extra mods) is left alone.
- `options.txt` is only replaced when you publish with options included **and** it differs from the last one you shipped.

### How the files are stored

The files are committed to `packs/<pack-id>/files/` in one commit per publish, and only files that
changed are uploaded. The launcher downloads them straight from the repo, no key needed.
