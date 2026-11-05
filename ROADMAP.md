# Roadmap

## Done

Details are in git history.

- Load speed: long cache headers (`public/_headers`), fonts cut to the characters the app uses (`scripts/gen-fonts.py`,
  rerun after new Chinese text, `--check` lists what is missing). Not split per page: every page needs the whole catalog.
- Getting saves in and out: [docs/saves.md](docs/saves.md). Organizing other players' stashes: the agent skill
  `.claude/skills/organize-stash`.
- Keeping it organized: `--inbox` pages, museum slots, `DUP` mules, `LOWCHARM`/`LOWJEWEL` mules for low-rolled magic
  charms and jewels, `TRASH` for extra copies past `copiesNeeded`. Nothing is deleted by organizing.
- Deployment: `npm run deploy` to Cloudflare Pages, live at https://d2r.diamonddoge.org.
- Steam Deck plugin ([decky/](decky/README.md)): on GitHub Releases ("Install Plugin from URL"); the Decky store
  turns away LLM-written plugins.
- New finds page, six tabs, Clean TRASH on the Deck, runewords to make.
- Pickup alerts on the Deck (`save_changes` in `decky/main.py`, `src/lib/pickups.js`). Not yet timed on a real Deck:
  the panel shows the last check's time for that.

## Saved loadouts (next, not started)

Like WoW's equipment manager. The player equips a character (and its mercenary) by hand, then saves it in the plugin
as that character's best setup. The plugin then shows, per main, which saved pieces are on it and where the others
went (another main, a mule), so shared items are easy to find. Items are told apart by their seed. Picked entirely by
hand, no recommendations. Moving pieces back with one click would be the first write to mains' saves: ask the user
before building it.
