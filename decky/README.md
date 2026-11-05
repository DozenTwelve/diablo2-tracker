# Steam Deck plugin

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin: open the tracker from the quick access
menu in Game Mode, with the saves read straight from the Deck. Current version: 0.2.3 (`package.json`).

## Install and update

Decky (quick access menu) → settings → General → turn on Developer mode, then Developer → Install Plugin from URL:

```
https://github.com/DozenTwelve/diablo2-tracker/releases/latest/download/d2r-collection-tracker.zip
```

To update, install from the same URL again: it always points at the newest release. Backups, loadouts and icons
are in the data folder below, not in the plugin's own folder.

## The panel

- "Open collection" opens the tracker in Steam's browser; "Stop the server" closes it.
- "Get item icons from the game files" pulls the inventory icons out of your own game files, once, in about a
  minute.
- "Alert on pickups" turns the pickup alerts on or off. Once it has looked at changed saves, the line under it says
  how long that took: "Last check: parsed N files in N ms" (plus the time loading the parser, the first time).

## Where the data lives

In the plugin's runtime data folder on the Deck (Decky's `DECKY_PLUGIN_RUNTIME_DIR`, see `main.py`):

- `items/`: the item icons from "Get item icons";
- `backups/<time>`: a copy of the save folder before each write or restore, labelled organize, clean, loadout or
  restore (the newest 10 and the oldest kept per save folder, and interrupted ones and those from older plugin
  versions never deleted);
- `loadouts.json`: the saved loadouts.

The saves themselves stay where the game keeps them.

## How it works

- `main.py` and `py_modules/tracker.py`: the backend. It serves the web app (built with `VITE_DECK=1`), the save files
  and the item icons on `127.0.0.1:18565`, from "Open collection" until the page is left (its Close button, or a minute
  away from it after B or the Steam button) or the panel's "Stop the server". It runs as the `deck` user, not root.
- `src/index.tsx`: the quick access panel. "Open collection" opens the tracker in Steam's browser. "Get item icons"
  pulls the inventory icons out of the player's own game files with [casc-cli](https://github.com/ironsp4rk/casc-cli)
  (MIT) and turns them into PNGs in Decky's data folder; the plugin ships no game art.
- `src/watch.js`: pickup alerts. Every 2 s the panel asks `save_changes` which saves changed; once they settle it
  parses them with the web app's code (the parser's WebAssembly is in the bundle) and toasts each new unique, set
  item or rune. The panel's toggle turns it off.
- The app's "Organize" page sorts the mules and the ticked inbox pages of the shared stash and shows what would
  happen, like on the web; in the plugin, "Organize now" posts the checked saves to the backend instead of offering
  a zip; "Clean TRASH" posts a write that only deletes `TRASH` mules (backup labelled "clean"). The backend refuses
  while D2R is running or the saves differ from the hashes the page read, copies the whole save folder to Decky's
  data folder (`backups/<time>`), writes each file next to its target and renames it over, then reads everything
  back. Emptied characters the player ticks are deleted after the backup. A write cut off half way marks its backup
  (`.in-progress` in the backups folder): files receiving items are written before those giving them up, and nothing
  more is written until that backup is restored or dismissed. The page lists the backups; restoring one backs up the
  folder as it is first, so a restore can be undone the same way.
- Loadouts: a main character's page saves what it wears as a named loadout, kept in Decky's data folder
  (`loadouts.json`, `GET`/`POST /api/loadouts`, the whole document, never the saves). Putting one on goes through the
  same write as organizing (backup labelled "loadout"): the page checks that on every main only the covered slots,
  the inventory charms and the pieces taken changed, and that no item was lost or duplicated, before posting.

## Build and install

```bash
npm install                               # the web app, built into the plugin
cd decky && npm install && ./pack.sh     # -> decky/out/d2r-collection-tracker.zip
```

Copy the zip to the Deck. In Game Mode: Decky (quick access menu) → settings → General → enable Developer mode,
then Developer → Install Plugin from ZIP file, and pick the zip (players install from the URL,
see above). Open the plugin and press "Get item icons from the game files" once (about a minute), then "Open
collection".

`python3 test_tracker.py [sprite dir]` checks the backend on any computer.
