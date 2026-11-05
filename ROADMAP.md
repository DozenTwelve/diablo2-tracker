# Roadmap

## Done

Details are in git history.

- Load speed: long cache headers (`public/_headers`), fonts cut to the characters the app uses (`scripts/gen-fonts.py`,
  rerun after new Chinese text, `--check` lists what is missing). Not split per page: every page needs the whole catalog.
- Getting saves in and out: [docs/saves.md](docs/saves.md). Organizing other players' stashes: the agent skill
  `.claude/skills/organize-stash`.
- Keeping it organized: `--inbox` pages, museum slots, `DUP` mules, `LOWCHARM`/`LOWJEWEL` mules for low-rolled magic
  charms and jewels, `TRASH` for extra copies past `copiesNeeded`. Organizing never deletes items; emptied characters
  are deleted only when ticked, `TRASH` only by Clean TRASH.
- Deployment: `npm run deploy` to Cloudflare Pages, live at https://d2r.diamonddoge.org.
- Steam Deck plugin ([decky/](decky/README.md)): on GitHub Releases ("Install Plugin from URL"); the Decky store
  turns away LLM-written plugins.
- New finds page, six tabs, Clean TRASH on the Deck, runewords to make.
- Pickup alerts on the Deck (`save_changes` in `decky/main.py`, `src/lib/pickups.js`). No stutter reported on a real
  Deck; timing not recorded (the panel shows the last check's time).
- Loadouts (0.2.3): saved per main incl. mercenary, put on in one checked write; quest items never move.
- "Not junk" ticks on Clean TRASH's list: an unticked copy stays in `DUP` from then on.
- Item tooltips on the character grids and the item lists (New finds, charms, runewords, the organize preview, the
  `TRASH` list).
- Charms page: every charm owned, grouped by size, filtered by purpose, low rolls dimmed or hidden.
- Runeword tabs: owned, can make, only missing a base, 1 or 2 runes short.
