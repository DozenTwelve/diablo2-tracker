// Loadouts: what a main character wears, what its mercenary wears and the charms in its inventory, saved by name to
// put on again in one write. A loadout is { id, name, character, merc (a mercenary was hired), pieces }; a piece is one
// copy (idOf) with where it goes: { id, key, code, gfx (its look), place: "equipped" | "merc", slot } or { ..., place: "inventory", x, y }.
// The plugin keeps them (src/lib/deck.js), so they exist on the Steam Deck only.
import { codeOfNumber, idOf, keyOf } from "./gameData";
import { roleOf } from "./inventory";
import { modeOfCharacter, modeOfStash } from "./modes";
import { organize, readSaves, sameBytes } from "./organize";
import items from "../data/items.json";

const CHARMS = ["scha", "mcha", "lcha", "csch"]; // small, large, grand (and the other grand charm base)
export const isCharm = (code) => CHARMS.includes(items[code]?.type);

// The loadout the character wears now, from parseSaves records
export function loadoutOf(saveData, character) {
  const owner = saveData.owners.find((o) => o.name === character);
  const records = saveData.items.filter((r) => r.owner === character);
  const pieces = records
    .filter((r) => r.place === "equipped" || r.place === "merc" || (r.place === "inventory" && isCharm(r.code)))
    .map((r) => ({ id: idOf(r), key: r.key, code: r.code, gfx: r.gfx, place: r.place, ...(r.place === "inventory" ? { x: r.x, y: r.y } : { slot: r.slot }) }));
  return { character, merc: owner?.merc ?? records.some((r) => r.place === "merc"), pieces };
}

// Whether a record is where the piece goes on the loadout's character
export const inPlace = (piece, r, character) =>
  r.owner === character && r.place === piece.place && (piece.place === "inventory" ? r.x === piece.x && r.y === piece.y : r.slot === piece.slot);

// Where a piece is now: { kind: "on" } (in place), "self" (elsewhere on the character), "main" (another main
// character has it), "mule" (a mule or a shared stash), with { owner, place }; or { kind: "missing" }
export function whereIs(piece, character, saveData, roles) {
  const r = saveData.items.find((r) => r.place !== "socketed" && idOf(r) === piece.id);
  if (!r) return { kind: "missing" };
  if (inPlace(piece, r, character)) return { kind: "on" };
  const owner = saveData.owners.find((o) => o.name === r.owner);
  const kind = r.owner === character ? "self" : owner?.cls && roleOf(owner, roles) === "main" ? "main" : "mule";
  return { kind, owner: r.owner, place: r.place };
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
const placeOfItem = (list, item) => (list === "merc" ? "merc" : item.position.mode === "Equipped" ? "equipped" : spotOfItem(item));

// Put a loadout on its character in one go. Every piece is taken from where it is (a mule, the shared stash, another
// main character, elsewhere on the character), but those in leave (ids the player unticked: they stay where they are);
// what the character wore in the slots the loadout covers (every equipment slot, the mercenary's too when it saved one)
// and the charms in its inventory that are not in the loadout come off and go into the mules as organizing puts them:
// organize() of the mode with those added (extra) and the pieces taken out of it, no shared stash page emptied.
// A piece missing, left where it is, or for a mercenary the character doesn't have keeps that slot as it is.
// saves: [{ name, ext, json }] (not changed); options: { mules, keep } as organize(), leave
// -> { saves: changed [{ name, ext, json, template? }], report: { pieces: [{ piece, status: "on" | "take" | "left" |
//   "missing" | "noMerc" | "hand" (its weapon set stays as it is), from?: { owner, place } }], off: [{ item, key, to?: { mule, group } }], organize?: organize's report } }
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
  // Every top level item of the mode, by id: { save, list: "items" | "merc" | stash tab number, item }
  const where = new Map();
  for (const s of work) {
    const lists =
      s.ext === "d2s"
        ? modeOfCharacter(s.json) === mode && !dead(s.json) ? [["items", s.json.items], ["merc", s.json.merc_items?.items ?? []]] : []
        : modeOfStash(`${s.name}.d2i`) === mode ? s.json.flatMap((tab, i) => (tab.tab_type === "Normal" ? [[i, tab.items]] : [])) : [];
    for (const [list, held] of lists) for (const item of held) where.set(itemId(item), [...(where.get(itemId(item)) ?? []), { save: s, list, item }]);
  }
  const merc = hasMerc(me.json);
  const pieces = loadout.pieces.map((piece) => {
    const found = where.get(piece.id) ?? [];
    if (found.length > 1) throw new Error(`${found.length} items share the id ${piece.id}`);
    const [f] = found;
    if (piece.place === "merc" && !merc) return { piece, status: "noMerc" };
    if (!f) return { piece, status: "missing" };
    const from = { owner: f.save.name, place: placeOfItem(f.list, f.item) };
    if (f.save === me && JSON.stringify(at(f.item, piece)) === JSON.stringify(f.item) && (f.list === "merc") === (piece.place === "merc")) return { piece, status: "on", from, found: f };
    if (f.save !== me && leave.includes(piece.id)) return { piece, status: "left", from };
    return { piece, status: "take", from, found: f };
  });
  // Slots that keep what is in them: one whose piece isn't put on, and then the other hand of that weapon set too (a
  // shield must not go on beside the two-handed weapon left there): its piece stays where it is ("hand")
  const kept = new Set(pieces.filter((p) => !p.found && p.piece.place !== "inventory").map((p) => `${p.piece.place}:${p.piece.slot}`));
  for (const place of ["equipped", "merc"])
    for (const hands of [["RightArm", "LeftArm"], ["RightHand", "LeftHand"]])
      if (hands.some((h) => kept.has(`${place}:${h}`))) hands.forEach((h) => kept.add(`${place}:${h}`));
  for (const p of pieces)
    if (p.found && p.status !== "on" && kept.has(`${p.piece.place}:${p.piece.slot}`)) {
      p.status = "hand";
      delete p.found;
    }
  const applied = pieces.filter((p) => p.found);
  const appliedIds = new Set(applied.map((p) => p.piece.id));
  const coversMerc = loadout.merc && merc;
  const comesOff = (list, item) =>
    !appliedIds.has(itemId(item)) &&
    (list === "merc" ? coversMerc && !kept.has(`merc:${item.position.body_location}`) : isWorn(item) ? !kept.has(`equipped:${item.position.body_location}`) : isInventoryCharm(item));
  const off = [
    ...me.json.items.filter((i) => comesOff("items", i)).map((item) => ({ item, from: `${me.name} ${placeOfItem("items", item)}` })),
    ...(me.json.merc_items?.items ?? []).filter((i) => comesOff("merc", i)).map((item) => ({ item, from: `${me.name} merc` })),
  ];
  const report = { pieces: pieces.map(({ piece, status, from }) => ({ piece, status, from })), off: [] };
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
  for (const { piece, found } of taken) {
    if (piece.place === "merc") me.json.merc_items.items.push(at(found.item, piece));
    else me.json.items.push(at(found.item, piece));
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
          const [stays, charm] = appliedIds.has(itemId(item)) ? [other, item] : [item, other];
          const error = new Error(`the inventory cell ${cell} the loadout's charm needs holds ${codeOfNumber(stays.code)}, which stays: move it in the game first`);
          error.blocked = { code: codeOfNumber(stays.code), key: keyOf(stays, codeOfNumber(stays.code)), x: charm.position.inv_x, y: charm.position.inv_y };
          throw error;
        }
        cells.set(cell, item);
      }
  }

  const sorted = organize(work, { mode, mules, inbox: [], keep, extra: off });
  const changed = new Map(sorted.saves.map((s) => [`${s.name}.${s.ext}`.toLowerCase(), s]));
  const touched = new Set([me, ...taken.map((p) => p.found.save)]);
  for (const s of touched) if (!changed.has(`${s.name}.${s.ext}`.toLowerCase())) changed.set(`${s.name}.${s.ext}`.toLowerCase(), s);
  const moveOf = (item) => sorted.report.moves.find((m) => m.item === item);
  report.off = off.map(({ item }) => ({ item, key: keyOf(item, codeOfNumber(item.code)), to: moveOf(item) && { mule: moveOf(item).to, group: moveOf(item).group } }));
  report.organize = sorted.report;
  return { saves: [...changed.values()], report };
}

// applyLoadout on save files, checked before anything is returned (a throw: nothing to write): no item lost or added
// over all files (only starting kit an emptied mule held is dropped, as organizing does), gold stays, and on every main
// character only what the loadout covers changed: everything else in its save (other items where they were, belt, stash,
// cube, quests, stats, the mercenary itself) is as it was; on the loadout's character the covered slots and inventory
// charms hold only loadout pieces in their places or what was there already; another main only lost the pieces taken.
// Shared stash pages only lost pieces taken. Every written character's items are inside their grids, not overlapping, one
// per equipment slot.
// files: [{ name, bytes }]; wasm: the parser -> { files: [{ name, bytes, template? }] (only saves whose bytes change, in the
// order to write them), report }
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
  const takenFrom = (name) => new Set(report.pieces.filter((p) => p.status === "take" && p.from.owner === name).map((p) => p.piece.id));
  const target = loadout.character;
  const coversMerc = loadout.merc && hasMerc(input.get(`${target}.d2s`));
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
        if (string({ ...tab, items: tab.items.filter((it) => !gone.has(itemId(it))) }) !== string(now[i])) fail(`${name} page ${i + 1} changed`);
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
    const gone = takenFrom(s.name);
    const isTarget = s.name === target;
    const rest = (json, side) =>
      lists(json).map(([list, held]) => held.filter((i) => !(side === "before" && gone.has(itemId(i))) && !(isTarget && covered(list, i))).map(string));
    if (string(rest(was, "before")) !== string(rest(now, "after"))) fail(`${name}: items the loadout doesn't cover changed`);
    if (!isTarget) continue;
    const wanted = new Map(loadout.pieces.map((p) => [p.id, p]));
    const old = new Set(lists(was).flatMap(([list, held]) => held.map((i) => `${list}\n${string(i)}`)));
    for (const [list, held] of lists(now))
      for (const i of held.filter((i) => covered(list, i))) {
        const p = wanted.get(itemId(i));
        const placed = p && (p.place === "merc") === (list === "merc") && string(at(i, p)) === string(i);
        if (!placed && !old.has(`${list}\n${string(i)}`)) fail(`${name}: ${codeOfNumber(i.code)} put where the loadout doesn't say`);
      }
  }
  // In the order to write them (write_saves sorts the same way, keeping this order within existing saves): new mules,
  // the loadout's character, the others holding items, then those only emptied (a main a piece was taken from), the
  // shared stash last
  const names = new Set(files.map((f) => f.name));
  const rank = (f) => (!names.has(f.name) ? 0 : f.name === `${target}.d2s` ? 1 : f.name.endsWith(".d2i") ? 4 : takenFrom(f.name.slice(0, -4)).size || !held(written.get(f.name), "d2s").length ? 3 : 2);
  const handed = out.filter((f) => !(names.has(f.name) && sameBytes(files.find((o) => o.name === f.name).bytes, f.bytes)));
  return { files: handed.sort((a, b) => rank(a) - rank(b)), report };
}
