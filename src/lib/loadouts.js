// Loadouts: what a main character wears, what its mercenary wears and the charms in its inventory, saved by name to
// put on again in one write. A loadout is { id, name, character, merc (a mercenary was hired), pieces }; a piece is one
// copy (idOf) with where it goes: { id, key, code, gfx (its look), place: "equipped" | "merc", slot } or { ..., place: "inventory", x, y }.
// mercClass: the kind of mercenary it was saved with (mercClassOf; none in loadouts saved before it was kept).
// The plugin keeps them (src/lib/deck.js), so they exist on the Steam Deck only.
import { codeOfNumber, idOf, keyOf, mercClassOf } from "./gameData";
import { roleOf } from "./inventory";
import { modeOfCharacter, modeOfStash } from "./modes";
import { organize, readSaves, sameBytes } from "./organize";
import items from "../data/items.json";

const CHARMS = ["scha", "mcha", "lcha", "csch"]; // small, large, grand (and the other grand charm base)
export const isCharm = (code) => CHARMS.includes(items[code]?.type);
// A quest item (the game's quest flag, items.json): a loadout never moves it, nor what is beside it in its weapon set
export const isQuest = (code) => Boolean(items[code]?.quest);

// Every piece of every saved loadout counts as kept, as the player's keep list does: organizing never puts one in TRASH,
// cleaning TRASH never deletes one. doc: { loadouts } as the plugin keeps it
export const loadoutIds = (doc) => (doc?.loadouts ?? []).flatMap((l) => l.pieces.map((p) => p.id));

// The loadout the character wears now, from parseSaves records. Of identical twins (copies sharing an id) worn or
// carried at once only the first is a piece: a piece is found by its id.
export function loadoutOf(saveData, character) {
  const owner = saveData.owners.find((o) => o.name === character);
  const records = saveData.items.filter((r) => r.owner === character);
  const pieces = records
    .filter((r) => r.place === "equipped" || r.place === "merc" || (r.place === "inventory" && isCharm(r.code)))
    .filter((r, i, all) => all.findIndex((o) => idOf(o) === idOf(r)) === i)
    .map((r) => ({ id: idOf(r), key: r.key, code: r.code, gfx: r.gfx, place: r.place, ...(r.place === "inventory" ? { x: r.x, y: r.y } : { slot: r.slot }) }));
  return { character, merc: owner?.merc ?? records.some((r) => r.place === "merc"), mercClass: owner?.mercClass, pieces };
}

// Whether a record is where the piece goes on the loadout's character
export const inPlace = (piece, r, character) =>
  r.owner === character && r.place === piece.place && (piece.place === "inventory" ? r.x === piece.x && r.y === piece.y : r.slot === piece.slot);

// Where a piece is now, as applyLoadout sees it: { kind: "on" } (in place), "self" (elsewhere on the character),
// "main" (another main character has it), "mule" (a mule or a shared stash), "corpse" (on a corpse) or "golem" (an
// Iron Golem made from it: neither is taken), with { owner, place }; or { kind: "missing" }: nowhere in the character's
// mode (another mode's saves, a dead hardcore hero's and the stackable tab count as nowhere). Of identical twins
// (copies sharing the id) the one in place, then one on the character, then one in a mule or shared stash, then one
// on another main, as applyLoadout picks them.
export function whereIs(piece, character, saveData, roles) {
  const ownerOf = (name) => saveData.owners.find((o) => o.name === name);
  const mode = ownerOf(character)?.mode;
  const records = saveData.items.filter((r) => idOf(r) === piece.id && r.place !== "socketed" && r.place !== "advanced" && ownerOf(r.owner)?.mode === mode);
  const kindOf = (r) => (r.owner === character ? "self" : ownerOf(r.owner)?.cls && roleOf(ownerOf(r.owner), roles) === "main" ? "main" : "mule");
  const live = records.filter((r) => r.place !== "corpse" && r.place !== "golem");
  const r = live.find((r) => inPlace(piece, r, character)) ?? live.find((r) => kindOf(r) === "self") ?? live.find((r) => kindOf(r) === "mule") ?? live[0];
  if (!r) {
    const held = records.find((r) => r.place === "corpse") ?? records[0];
    return held ? { kind: held.place, owner: held.owner, place: held.place } : { kind: "missing" };
  }
  if (inPlace(piece, r, character)) return { kind: "on" };
  return { kind: kindOf(r), owner: r.owner, place: r.place };
}

// Equipped items keep their body location in inv_x too, as the game writes them
const EQUIP_INDEX = { Head: 1, Neck: 2, Torso: 3, RightArm: 4, LeftArm: 5, RightRing: 6, LeftRing: 7, Belt: 8, Feet: 9, Gloves: 10, RightHand: 11, LeftHand: 12 };
const GRID_SIZES = { Inventory: [10, 4], Stash: [10, 10], Cube: [3, 4] };
const itemId = (item) => idOf(item, codeOfNumber(item.code));
const isWorn = (item) => item.position.mode === "Equipped";
const isInventoryCharm = (item) => item.position.mode === "Stored" && item.position.store_page === "Inventory" && isCharm(codeOfNumber(item.code));
const hasMerc = (json) => Boolean(json.character.merc?.seed);
const spotOfItem = ({ position: p }) => (p.mode === "Equipped" ? p.body_location : p.mode === "InBelt" ? "belt" : p.store_page.toLowerCase());
const at = (item, piece) => ({
  ...item,
  position:
    piece.place === "inventory"
      ? { ...item.position, mode: "Stored", body_location: "None", inv_x: piece.x, inv_y: piece.y, store_page: "Inventory" }
      : { ...item.position, mode: "Equipped", body_location: piece.slot, inv_x: EQUIP_INDEX[piece.slot], inv_y: 0, store_page: "Null" },
});
// list: "items", "merc" or a shared stash page's index
const placeOfItem = (list, item) =>
  list === "merc" ? "merc" : typeof list === "number" ? `shared${list + 1}` : item.position.mode === "Equipped" ? "equipped" : spotOfItem(item);
// A worn item's slot, and a piece's: "equipped:RightArm", "merc:Head"
const slotOf = (list, item) => `${list === "merc" ? "merc" : "equipped"}:${item.position.body_location}`;
const slotOfPiece = (piece) => `${piece.place}:${piece.slot}`;
// The other hand of a weapon set
const HANDS = { RightArm: "LeftArm", LeftArm: "RightArm", RightHand: "LeftHand", LeftHand: "RightHand" };
// Whether the loadout's mercenary pieces go on: it saved a mercenary, the character has one, of the kind the loadout
// kept. A loadout saved before the kind was kept (no mercClass) covers none: the player saves it again to keep it; a
// hireling id mercs.json doesn't know is of no kind.
const mercCovered = (loadout, json) =>
  Boolean(loadout.merc && hasMerc(json) && loadout.mercClass != null && mercClassOf(json.character.merc.hireling_id) === loadout.mercClass);

// Put a loadout on its character in one go. Every piece is taken from where it is (a mule, the shared stash, another
// main character, elsewhere on the character), but those in leave (ids the player unticked: they stay where they are);
// what the character wore in the slots the loadout covers (every equipment slot, the mercenary's too when it saved one
// of the same kind) and the charms in its inventory that are not in the loadout come off and go into the mules as
// organizing puts them: organize() of the mode with those added (extra) and the pieces taken out of it, no shared stash
// page emptied, every piece of this loadout and what came off kept (never TRASH; the caller adds the other loadouts' pieces
// to keep, loadoutIds).
// Slots kept as they are: one whose piece isn't put on (missing, left where it is, on a corpse or an Iron Golem, a
// quest item, for a mercenary the character doesn't have, of another kind or of a kind the loadout didn't keep), one holding a quest item, and with either the other hand of
// that weapon set; a piece found but going into a kept slot stays where it is ("hand", "quest" in a quest item's slot),
// and where it is worn on the character is kept too, until nothing more is kept.
// Of identical twins (real saves hold copies sharing every byte but the position) the copy in place is taken, then one
// on the character, then one in a mule or a shared stash, then one on another main: conservation counts copies, so
// either keeps it, and another main keeps what it wears while a free twin is elsewhere.
// Nothing comes off: the mules are not organized (a mule with items on its corpse is no bother then). Something comes
// off but the mules can't be organized (no mules, items on a mule's corpse or Iron Golem): throws error.organize, the
// reason.
// saves: [{ name, ext, json }] (not changed); options: { mules, keep } as organize(), leave
// -> { saves: changed [{ name, ext, json, template? }], report: { pieces: [{ piece, status: "on" | "take" | "left" |
//   "missing" | "corpse" | "golem" | "quest" | "noMerc" | "mercUnknown" (the loadout kept no mercenary kind) |
//   "otherMerc" | "hand" (its weapon set stays as it is), from?: { owner,
//   place }, twins?: copies sharing its id }], kept: slots kept ("equipped:RightArm"), off: [{ item, key, to?: { mule,
//   group } }], organize?: organize's report } }
// Throws when a charm's cell is held by something that stays (error.blocked: { code, key, x, y }).
export function applyLoadout(saves, loadout, { mules = [], keep = [], leave = [] } = {}) {
  const target = saves.find((s) => s.ext === "d2s" && s.name === loadout.character);
  if (!target) throw new Error(`no character ${loadout.character}`);
  if (mules.some((n) => n.toLowerCase() === target.name.toLowerCase())) throw new Error(`${target.name} is a mule`);
  const mode = modeOfCharacter(target.json);
  const dead = (json) => json.character.flags.includes("HARDCORE") && json.character.flags.includes("DEAD");
  if (dead(target.json)) throw new Error(`${target.name} is dead`);
  const work = saves.map((s) => ({ ...s, json: structuredClone(s.json) }));
  const me = work.find((s) => s.name === target.name && s.ext === "d2s");
  // Every top level item of the mode, by id: [{ save, list: "items" | "merc" | stash tab number, item }]; and those
  // on a corpse or in an Iron Golem, by id: { owner, place: "corpse" | "golem" }
  const where = new Map();
  const corpse = new Map();
  for (const s of work) {
    const live = s.ext === "d2s" && modeOfCharacter(s.json) === mode && !dead(s.json);
    const lists =
      s.ext === "d2s"
        ? live ? [["items", s.json.items], ["merc", s.json.merc_items?.items ?? []]] : []
        : modeOfStash(`${s.name}.d2i`) === mode ? s.json.flatMap((tab, i) => (tab.tab_type === "Normal" ? [[i, tab.items]] : [])) : [];
    for (const [list, held] of lists) for (const item of held) where.set(itemId(item), [...(where.get(itemId(item)) ?? []), { save: s, list, item }]);
    if (live) for (const c of s.json.corpses ?? []) for (const item of c.items) corpse.set(itemId(item), { owner: s.name, place: "corpse" });
    const golem = live && s.json.iron_golem?.golem_item;
    if (golem && !corpse.has(itemId(golem))) corpse.set(itemId(golem), { owner: s.name, place: "golem" });
  }
  const merc = hasMerc(me.json);
  const coversMerc = mercCovered(loadout, me.json);
  const inPlaceNow = (f, piece) => f.save === me && (f.list === "merc") === (piece.place === "merc") && JSON.stringify(at(f.item, piece)) === JSON.stringify(f.item);
  // Each piece its own copy: in place first, then on the character, then in a mule or a shared stash, then any
  const isMule = (s) => s.ext === "d2i" || mules.some((n) => n.toLowerCase() === s.name.toLowerCase());
  const chosen = new Map();
  const used = new Set();
  for (const ok of [inPlaceNow, (f) => f.save === me, (f) => f.save !== me && isMule(f.save), () => true])
    for (const piece of loadout.pieces) {
      const f = !chosen.has(piece) && (where.get(piece.id) ?? []).find((f) => !used.has(f) && ok(f, piece));
      if (f) chosen.set(piece, f), used.add(f);
    }
  const pieces = loadout.pieces.map((piece) => {
    const f = chosen.get(piece);
    const twins = where.get(piece.id)?.length > 1 ? where.get(piece.id).length : undefined;
    const p = { piece, twins, f };
    if (piece.place === "merc" && !merc) return { ...p, status: "noMerc" };
    if (piece.place === "merc" && loadout.mercClass == null) return { ...p, status: "mercUnknown" };
    if (piece.place === "merc" && !coversMerc) return { ...p, status: "otherMerc" };
    if (!f) return corpse.has(piece.id) ? { ...p, status: corpse.get(piece.id).place, from: corpse.get(piece.id) } : { ...p, status: "missing" };
    const from = { owner: f.save.name, place: placeOfItem(f.list, f.item) };
    if (inPlaceNow(f, piece)) return { ...p, status: "on", from, found: f };
    if (isQuest(piece.code)) return { ...p, status: "quest", from };
    if (f.save !== me && leave.includes(piece.id)) return { ...p, status: "left", from };
    return { ...p, status: "take", from, found: f };
  });
  // Slots that keep what is in them, and with one the other hand of its weapon set (a shield must not go on beside the
  // two-handed weapon left there)
  const kept = new Set();
  const keepSlot = (slot) => {
    kept.add(slot);
    const [place, body] = slot.split(":");
    if (HANDS[body]) kept.add(`${place}:${HANDS[body]}`);
  };
  const worn = [...me.json.items.filter(isWorn).map((item) => ["items", item]), ...(me.json.merc_items?.items ?? []).map((item) => ["merc", item])];
  const questSlots = new Set(worn.filter(([, item]) => isQuest(codeOfNumber(item.code))).map(([list, item]) => slotOf(list, item)));
  questSlots.forEach(keepSlot);
  for (let size = -1; size !== kept.size; ) {
    size = kept.size;
    for (const p of pieces) {
      if (p.piece.place === "inventory") continue;
      const slot = slotOfPiece(p.piece);
      // Where it is worn on the character now, if it is
      const now = p.f?.save === me && (p.f.list === "merc" || isWorn(p.f.item)) ? slotOf(p.f.list, p.f.item) : null;
      if (p.found && p.status !== "on" && (kept.has(slot) || kept.has(now))) {
        p.status = questSlots.has(slot) ? "quest" : "hand";
        delete p.found;
      }
      if (!p.found) {
        keepSlot(slot);
        if (now) keepSlot(now);
      }
    }
  }
  const applied = pieces.filter((p) => p.found);
  const staying = new Set([...pieces.filter((p) => p.f?.save === me).map((p) => p.f.item)]); // put on, on, or left as it is
  const comesOff = (list, item) =>
    !staying.has(item) &&
    (list === "merc" ? coversMerc && !kept.has(slotOf(list, item)) : isWorn(item) ? !kept.has(slotOf(list, item)) : isInventoryCharm(item));
  const off = [
    ...me.json.items.filter((i) => comesOff("items", i)).map((item) => ({ item, from: `${me.name} ${placeOfItem("items", item)}` })),
    ...(me.json.merc_items?.items ?? []).filter((i) => comesOff("merc", i)).map((item) => ({ item, from: `${me.name} merc` })),
  ];
  const report = { pieces: pieces.map(({ piece, status, from, twins }) => ({ piece, status, from, twins })), kept: [...kept].sort(), off: [] };
  const taken = applied.filter((p) => p.status === "take");
  if (!taken.length && !off.length) return { saves: [], report };

  // Out of where they are, then onto the character
  const remove = new Set([...taken.map((p) => p.found.item), ...off.map((o) => o.item)]);
  for (const s of work) {
    if (s.ext === "d2s") {
      s.json.items = s.json.items.filter((i) => !remove.has(i));
      if (s.json.merc_items) s.json.merc_items = { ...s.json.merc_items, items: s.json.merc_items.items.filter((i) => !remove.has(i)) };
    } else s.json = s.json.map((tab) => ({ ...tab, items: tab.items.filter((i) => !remove.has(i)) }));
  }
  const placed = new Set();
  for (const { piece, found } of taken) {
    const item = at(found.item, piece);
    placed.add(item);
    if (piece.place === "merc") me.json.merc_items.items.push(item);
    else me.json.items.push(item);
  }
  // A charm's cells must be free: only charms come off the inventory, anything else there stays
  const cells = new Map();
  for (const item of me.json.items.filter((i) => i.position.mode === "Stored" && i.position.store_page === "Inventory")) {
    const code = codeOfNumber(item.code);
    const { w, h } = items[code];
    for (let a = 0; a < w; a++)
      for (let b = 0; b < h; b++) {
        const cell = `${item.position.inv_x + a},${item.position.inv_y + b}`;
        const other = cells.get(cell);
        if (other) {
          const [stays, charm] = placed.has(item) ? [other, item] : [item, other];
          const error = new Error(`the inventory cell ${cell} the loadout's charm needs holds ${codeOfNumber(stays.code)}, which stays: move it in the game first`);
          error.blocked = { code: codeOfNumber(stays.code), key: keyOf(stays, codeOfNumber(stays.code)), x: charm.position.inv_x, y: charm.position.inv_y };
          throw error;
        }
        cells.set(cell, item);
      }
  }

  // Never to TRASH: this loadout's pieces, nor what was just worn
  let sorted;
  if (off.length) {
    try {
      sorted = organize(work, { mode, mules, inbox: [], keep: [...keep, ...loadout.pieces.map((p) => p.id), ...off.map((o) => itemId(o.item))], extra: off });
    } catch (e) {
      const error = new Error(`what comes off goes into the mules, but they can't be organized: ${e.message}`);
      error.organize = e.message;
      throw error;
    }
  }
  const changed = new Map((sorted?.saves ?? []).map((s) => [`${s.name}.${s.ext}`.toLowerCase(), s]));
  const touched = new Set([me, ...taken.map((p) => p.found.save)]);
  for (const s of touched) if (!changed.has(`${s.name}.${s.ext}`.toLowerCase())) changed.set(`${s.name}.${s.ext}`.toLowerCase(), s);
  const moveOf = (item) => sorted?.report.moves.find((m) => m.item === item);
  report.off = off.map(({ item }) => ({ item, key: keyOf(item, codeOfNumber(item.code)), to: moveOf(item) && { mule: moveOf(item).to, group: moveOf(item).group } }));
  report.organize = sorted?.report;
  return { saves: [...changed.values()], report };
}

// applyLoadout on save files, checked before anything is returned (a throw: nothing to write): no item lost or added
// over all files (only starting kit an emptied mule held is dropped, as organizing does), gold stays, and on every main
// character only what the loadout covers changed: everything else in its save (other items where they were, belt, stash,
// cube, quests, stats, the mercenary itself) is as it was; on the loadout's character the covered slots and inventory
// charms hold only loadout pieces in their places or what was there already, its kept slots hold what they held, every
// piece but those taken is where it was (position too), what left it is exactly what came off and nothing else left a
// covered slot; another main only lost the pieces taken; no main's quest item moved. Shared stash pages only lost pieces
// taken. Every written character's items are inside their grids, not overlapping, one
// per equipment slot.
// files: [{ name, bytes }]; wasm: the parser -> { files: [{ name, bytes, template? }] (only saves whose bytes change, in the
// order to write them; one may come twice, see below), report }
export function applyLoadoutFiles(files, wasm, loadout, options) {
  const { saves, parse, write } = readSaves(files, wasm);
  const { saves: changed, report } = applyLoadout(saves, loadout, options);
  const out = changed.map((s) => ({ name: `${s.name}.${s.ext}`, bytes: write(s.ext, s.json), template: s.template }));
  const written = new Map(out.map((f, i) => [f.name, parse(changed[i].ext, f.bytes)]));
  const input = new Map(saves.map((s) => [`${s.name}.${s.ext}`, s.json]));
  const fail = (why) => {
    throw new Error(`loadout check failed: ${why}`);
  };
  const held = (json, ext) => (ext === "d2s" ? [...json.items, ...(json.merc_items?.items ?? [])] : json.flatMap((tab) => tab.items));
  const fingerprint = (item) => JSON.stringify({ ...item, position: undefined });
  const count = (list) => {
    const m = new Map();
    for (const f of list.map(fingerprint)) m.set(f, (m.get(f) ?? 0) + 1);
    return m;
  };
  const before = count(saves.flatMap((s) => held(s.json, s.ext)));
  const afterSaves = [...saves.filter((s) => !written.has(`${s.name}.${s.ext}`)).map((s) => [s.json, s.ext]), ...changed.map((s) => [written.get(`${s.name}.${s.ext}`), s.ext])];
  const after = count([...afterSaves.flatMap(([json, ext]) => held(json, ext)), ...(report.organize?.dropped ?? [])]);
  for (const [f, n] of before) if (after.get(f) !== n) fail(after.get(f) > n ? "an item was duplicated" : "an item was lost");
  for (const [f, n] of after) if (before.get(f) !== n) fail("an item was added");
  for (const item of report.organize?.dropped ?? []) if (!item.flags.includes("STARTER_ITEM") || item.flags.includes("SOCKETED") || item.quality !== "Normal") fail("dropped something that is not starting kit");
  const gold = (list) => list.filter(([, ext]) => ext === "d2s").reduce((n, [json]) => n + json.stats.filter((s) => s.id === 14 || s.id === 15).reduce((m, s) => m + s.value, 0), 0);
  if (gold(saves.map((s) => [s.json, s.ext])) !== gold(afterSaves)) fail("gold was lost or added");

  const mode = modeOfCharacter(input.get(`${loadout.character}.d2s`));
  const mules = new Set(report.organize?.mules.map((n) => n.toLowerCase()) ?? []);
  // The pieces taken from a save, by id: how many (identical twins share one), and a filter dropping that many of them,
  // first first as applyLoadout picks them
  const takenFrom = (name) => {
    const n = new Map();
    for (const p of report.pieces.filter((p) => p.status === "take" && p.from.owner === name)) n.set(p.piece.id, (n.get(p.piece.id) ?? 0) + 1);
    return (i) => (n.get(itemId(i)) ? (n.set(itemId(i), n.get(itemId(i)) - 1), false) : true);
  };
  const target = loadout.character;
  const coversMerc = mercCovered(loadout, input.get(`${target}.d2s`));
  const covered = (list, item) => (list === "merc" ? coversMerc : isWorn(item) || isInventoryCharm(item));
  const lists = (json) => [["items", json.items], ["merc", json.merc_items?.items ?? []]];
  const string = (x) => JSON.stringify(x);
  for (const s of changed) {
    const name = `${s.name}.${s.ext}`;
    const was = input.get(name);
    const now = written.get(name);
    if (s.ext === "d2i") {
      if (modeOfStash(name) !== mode) fail(`${name} is another mode's`);
      const gone = takenFrom(s.name);
      was.forEach((tab, i) => {
        if (string({ ...tab, items: tab.items.filter(gone) }) !== string(now[i])) fail(`${name} page ${i + 1} changed`);
      });
      if (was.length !== now.length) fail(`${name} changed`);
      continue;
    }
    const used = new Set();
    for (const [list, held] of lists(now))
      for (const i of held) {
        const { w, h } = items[codeOfNumber(i.code)];
        const { mode: m, store_page: page, inv_x: x, inv_y: y, body_location: slot } = i.position;
        if (m === "Equipped") {
          if (used.has(`${list}:${slot}`) || !(slot in EQUIP_INDEX)) fail(`${name}: two items in ${list} ${slot}`);
          used.add(`${list}:${slot}`);
          continue;
        }
        if (m !== "Stored") continue; // the belt: never written by this
        const [W, H] = GRID_SIZES[page] ?? [0, 0];
        if (list === "merc" || x + w > W || y + h > H) fail(`${name}: item outside its grid at ${page} ${x},${y}`);
        for (let a = 0; a < w; a++)
          for (let b = 0; b < h; b++) {
            if (used.has(`${page}:${x + a}:${y + b}`)) fail(`${name}: items overlap at ${page} ${x + a},${y + b}`);
            used.add(`${page}:${x + a}:${y + b}`);
          }
      }
    if (!was) {
      if (!s.template) fail(`${name} is new and not a mule`);
      continue;
    }
    if (modeOfCharacter(was) !== mode) fail(`${name} is another mode's`);
    if (mules.has(s.name.toLowerCase())) continue; // a mule, emptied and filled by organize()
    // A main character: only its items may change, and only as said
    // (the file's own size and checksum follow from the rest)
    const strip = (json) => string({ ...json, file_size: undefined, checksum: undefined, items: undefined, merc_items: json.merc_items && { ...json.merc_items, items: undefined } });
    if (strip(was) !== strip(now)) fail(`${name}: something other than its items changed`);
    const isTarget = s.name === target;
    const rest = (json, side) => {
      const gone = side === "before" ? takenFrom(s.name) : () => true;
      return lists(json).map(([list, held]) => held.filter((i) => gone(i) && !(isTarget && covered(list, i))).map(string));
    };
    if (string(rest(was, "before")) !== string(rest(now, "after"))) fail(`${name}: items the loadout doesn't cover changed`);
    // A quest item never moves (on any main: a piece taken from one can't be one)
    const strings = (json) => lists(json).flatMap(([list, held]) => held.map((i) => `${list}\n${string(i)}`));
    const nowStrings = new Set(strings(now));
    for (const [list, held] of lists(was)) for (const i of held) if (isQuest(codeOfNumber(i.code)) && !nowStrings.has(`${list}\n${string(i)}`)) fail(`${name}: the quest item ${codeOfNumber(i.code)} moved`);
    if (!isTarget) continue;
    // A mercenary piece goes only on a mercenary of the kind the loadout kept
    const mercOk = loadout.mercClass != null && hasMerc(was) && mercClassOf(was.character.merc.hireling_id) === loadout.mercClass;
    if (!mercOk && string(was.merc_items?.items ?? []) !== string(now.merc_items?.items ?? [])) fail(`${name}: the mercenary's items changed, but it is not of the kind the loadout kept`);
    const wanted = new Map(loadout.pieces.map((p) => [p.id, p]));
    const old = new Set(lists(was).flatMap(([list, held]) => held.map((i) => `${list}\n${string(i)}`)));
    for (const [list, held] of lists(now))
      for (const i of held.filter((i) => covered(list, i))) {
        const p = wanted.get(itemId(i));
        const placed = p && (p.place === "merc") === (list === "merc") && string(at(i, p)) === string(i);
        if (!placed && !old.has(`${list}\n${string(i)}`)) fail(`${name}: ${codeOfNumber(i.code)} put where the loadout doesn't say`);
      }
    // Kept slots hold what they held, every piece but those taken is where it was (position too), what left the
    // character is exactly what came off, and nothing else left a covered slot
    const entries = (json) => lists(json).flatMap(([list, held]) => held.map((i) => ({ list, i, s: `${list}\n${string(i)}` })));
    const [was_, now_] = [entries(was), entries(now)];
    const wornIn = (list, slot) => list.filter((e) => isWorn(e.i) && slotOf(e.list, e.i) === slot).map((e) => e.s);
    for (const slot of report.kept) if (string(wornIn(was_, slot)) !== string(wornIn(now_, slot))) fail(`${name}: ${slot} is kept but changed`);
    const taken = new Set(report.pieces.filter((p) => p.status === "take").map((p) => p.piece.id));
    for (const p of report.pieces.filter((p) => !taken.has(p.piece.id)))
      for (const e of was_.filter((e) => itemId(e.i) === p.piece.id)) if (!nowStrings.has(e.s)) fail(`${name}: ${p.piece.code} moved though it stays (${p.status})`);
    const [wasCount, nowCount, offCount] = [count(was_.map((e) => e.i)), count(now_.map((e) => e.i)), count(report.off.map((o) => o.item))];
    for (const f of new Set([...wasCount.keys(), ...offCount.keys()]))
      if (Math.max(0, (wasCount.get(f) ?? 0) - (nowCount.get(f) ?? 0)) !== (offCount.get(f) ?? 0)) fail(`${name}: what left it is not what came off`);
    const offIds = new Set(report.off.map((o) => itemId(o.item)));
    for (const e of was_.filter((e) => covered(e.list, e.i) && !nowStrings.has(e.s)))
      if (!offIds.has(itemId(e.i)) && !(taken.has(itemId(e.i)) && report.pieces.some((p) => p.piece.id === itemId(e.i) && p.from?.owner === target)))
        fail(`${name}: ${codeOfNumber(e.i.code)} left a covered slot without coming off`);
  }
  // In the order to write them, so a write cut off between two files leaves every item on a save (twice at worst,
  // never on none): a save that gives an item is written only once every save receiving one like it is (new mules
  // and mules receiving what comes off or what organizing moves, the loadout's character receiving its pieces). Where
  // two saves give each other (a mule gives a piece and receives what comes off), the mule is written twice: first
  // holding both what it receives and still what it gives, at the end as it ends up; with no room in the mule, the
  // character instead (what comes off in its stash or inventory until it is written as it ends up). New mules first, the shared
  // stash (it only gives) last, as write_saves (decky/py_modules/tracker.py) sorts them too, keeping this order
  // within, and writing a save that comes twice twice.
  const names = new Set(files.map((f) => f.name));
  const handed = out.filter((f) => !(names.has(f.name) && sameBytes(files.find((o) => o.name === f.name).bytes, f.bytes)));
  const counts = new Map(handed.map((f) => [f.name, [count(names.has(f.name) ? held(input.get(f.name), f.name.slice(-3)) : []), count(held(written.get(f.name), f.name.slice(-3)))]]));
  const changes = (name, more) => [...new Set([...counts.get(name)[0].keys(), ...counts.get(name)[1].keys()])].filter((fp) => more(counts.get(name)[1].get(fp) ?? 0, counts.get(name)[0].get(fp) ?? 0));
  const gains = new Map(handed.map((f) => [f.name, new Set(changes(f.name, (now, was) => now > was))]));
  // The saves receiving what each gives
  const to = new Map(handed.map((f) => [f.name, handed.filter((g) => changes(f.name, (now, was) => now < was).some((fp) => gains.get(g.name).has(fp))).map((g) => g.name)]));
  const order = [];
  const received = new Set();
  const twice = new Set();
  for (let left = [...handed]; left.length; ) {
    const ready = left.find((f) => to.get(f.name).every((n) => received.has(n)));
    // A mule first, else the character (what comes off in its stash or inventory a while)
    let both, first;
    const isTarget = (f) => f.name === `${target}.d2s`;
    for (const f of ready ? [] : left.toSorted((a, b) => isTarget(a) - isTarget(b)))
      if (f.name.endsWith(".d2s") && names.has(f.name) && !twice.has(f.name) && gains.get(f.name).size && (first = holdingBoth(input.get(f.name), written.get(f.name)))) {
        both = f;
        break;
      }
    if (!both) {
      // ponytail: stuck with no save that has room to hold both (full mules and a full character): written as it ends
      // up, what it gives is then on no save until its receiver is written; the backup (PENDING) is the way back
      const f = ready ?? left[0];
      order.push(f);
      received.add(f.name);
      left = left.filter((g) => g !== f);
    } else {
      order.push({ name: both.name, bytes: write("d2s", first) });
      received.add(both.name);
      twice.add(both.name);
    }
  }
  const late = (f) => (!names.has(f.name) ? 0 : f.name.endsWith(".d2i") ? 2 : 1);
  return { files: order.sort((a, b) => late(a) - late(b)), report };
}

// A mule as it ends up (json) holding still what it gives (from was: its items not in json, matched by everything but
// their position), at free spots of its stash and inventory; null without room for them
function holdingBoth(was, json) {
  const fingerprint = (item) => JSON.stringify({ ...item, position: undefined });
  const now = new Map();
  for (const i of [...json.items, ...(json.merc_items?.items ?? [])]) now.set(fingerprint(i), (now.get(fingerprint(i)) ?? 0) + 1);
  const give = [...was.items, ...(was.merc_items?.items ?? [])].filter((i) => (now.get(fingerprint(i)) ? (now.set(fingerprint(i), now.get(fingerprint(i)) - 1), false) : true));
  const spots = freeSpots(json.items);
  const more = [];
  for (const item of give) {
    const spot = spots(items[codeOfNumber(item.code)]);
    if (!spot) return null;
    more.push({ ...item, position: { ...item.position, mode: "Stored", body_location: "None", inv_x: spot.x, inv_y: spot.y, store_page: spot.page } });
  }
  return { ...json, items: [...json.items, ...more] };
}

// The free spots of a save's stash and inventory as items are put in them: (w x h) -> { page, x, y } or null
function freeSpots(held) {
  const used = new Set();
  const take = (page, x, y, w, h) => {
    for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) used.add(`${page}:${x + a}:${y + b}`);
  };
  for (const i of held.filter((i) => i.position.mode === "Stored")) {
    const { w, h } = items[codeOfNumber(i.code)];
    take(i.position.store_page, i.position.inv_x, i.position.inv_y, w, h);
  }
  return ({ w, h }) => {
    for (const page of ["Stash", "Inventory"]) {
      const [W, H] = GRID_SIZES[page];
      for (let x = 0; x + w <= W; x++)
        for (let y = 0; y + h <= H; y++) {
          const cells = [];
          for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) cells.push(`${page}:${x + a}:${y + b}`);
          if (cells.some((c) => used.has(c))) continue;
          take(page, x, y, w, h);
          return { page, x, y };
        }
    }
    return null;
  };
}
