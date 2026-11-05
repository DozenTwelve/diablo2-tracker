// Checks for src/lib/loadouts.js on real save folders, read only: each case changes a copy of the saves in memory.
// Usage: node scripts/check-loadouts.mjs <save dir> [<save dir>...]   (needs a main character with a charm or an
// amulet, a second main, and level 1 mules in its mode)
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { initParser, withApp } from "./load.mjs";

const dirs = process.argv.slice(2);
if (!dirs.length) throw new Error("usage: node scripts/check-loadouts.mjs <save dir> [<save dir>...]");

await withApp(async ({ load }) => {
  initParser(await load("/wasm/pkg/d2_parser.js"));

  const { parseSaveFiles } = await load("/src/lib/parseSaves.js");
  const { idOf } = await load("/src/lib/gameData.js");
  const { applyLoadoutFiles: applyFiles, loadoutIds, loadoutOf, whereIs } = await load("/src/lib/loadouts.js");
  const { groupOf, readSaves, trashMules } = await load("/src/lib/organize.js");
  const { loadoutsKnown } = await load("/src/lib/useLoadoutIds.js");
  const { modeOfStash } = await load("/src/lib/modes.js");
  const mercs = (await load("/src/data/mercs.json")).default;
  const wasm = await load("/wasm/pkg/d2_parser.js");
  const items = (await load("/src/data/items.json")).default;
  const { codeOfNumber, keyOf, mercClassOf } = await load("/src/lib/gameData.js");

  // Every apply here is checked for a write cut off after any of its files, in the order given: every item is still
  // on a save (twice is fine), as many copies as there are at the end
  const parsed = new WeakMap(); // bytes -> item fingerprints
  const fingerprints = (files) => {
    const m = new Map();
    for (const { name, bytes } of files) {
      if (!parsed.has(bytes)) {
        const j = JSON.parse(name.endsWith(".d2s") ? wasm.parseD2s(bytes) : wasm.parseD2i(bytes));
        const all = name.endsWith(".d2s") ? [...j.items, ...(j.merc_items?.items ?? [])] : j.flatMap((tab) => tab.items);
        parsed.set(bytes, all.map((i) => JSON.stringify({ ...i, position: undefined })));
      }
      for (const k of parsed.get(bytes)) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const applyLoadoutFiles = (files, parser, loadout, options) => {
    const result = applyFiles(files, parser, loadout, options);
    const state = new Map(files.map((f) => [f.name, f]));
    const end = fingerprints([...new Map([...state, ...result.files.map((f) => [f.name, f])]).values()]);
    result.files.forEach((f, k) => {
      state.set(f.name, f);
      const now = fingerprints([...state.values()]);
      for (const [fp, n] of end) assert((now.get(fp) ?? 0) >= n, `${loadout.character}: a write cut off after ${result.files.slice(0, k + 1).map((f) => f.name).join(" ")} leaves an item on no save`);
    });
    return result;
  };

  {
    // Every quest item is in items.json (Potion of Life and Book of Skill are named only in ui.json); an unknown code
    // is MISC to organizing, not a throw
    assert(items.xyz?.quest && items.ass?.quest, "Potion of Life or Book of Skill missing from items.json");
    assert.equal(groupOf("zzz", { quality: "Normal", stats: [] }, "zzz"), "MISC");
    // Loadouts the plugin couldn't give: organizing must not run as if there were none
    assert.equal(loadoutsKnown({ ids: null, failed: "x" }), false);
    assert.equal(loadoutsKnown({ ids: [] }), true);
    console.log("ok  quest items in items.json, an unknown code is MISC, unread loadouts stop organizing");
  }

  {
    // Chinese has its own words for charm and amulet: the loadout texts about charms use the charm one
    const { t } = await load("/src/lib/i18n.js");
    for (const lang of ["zh", "zh_tw"])
      for (const text of [t("loadoutsAbout", lang), t("loadoutBlocked", lang, "X", 1, 1)])
        assert(text.includes(t("slot_charm", lang)) && !text.includes(t("slot_amulet", lang)), `${lang} calls a charm an amulet: ${text}`);
    console.log("ok  the loadout texts say charm, not amulet");
  }

  for (const dir of dirs) {
    console.log(dir);
    // KEEP_GOING=1: report every failing check, not only the first
    const check = async (what, fn) => {
      try {
        await fn();
        console.log(`ok  ${what}`);
      } catch (e) {
        if (!process.env.KEEP_GOING) throw e;
        console.log(`FAIL  ${what}: ${e.message}`);
        process.exitCode = 1;
      }
    };
    const names = readdirSync(dir).filter((f) => /\.d2[si]$/.test(f));
    const saveData = await parseSaveFiles(names.map((name) => new File([readFileSync(join(dir, name))], name)));
    assert.deepEqual(saveData.errors, []);
    const roles = {};
    const mains = saveData.owners.filter((o) => o.cls && o.level > 1 && !o.dead);
    const ids = (records) => records.map((r) => idOf(r));
    // The main wearing the most, with no two of its pieces sharing an id
    const loadouts = mains.map((o) => loadoutOf(saveData, o.name)).filter((l) => new Set(l.pieces.map((p) => p.id)).size === l.pieces.length);
    const a = loadouts.sort((x, y) => y.pieces.length - x.pieces.length)[0];
    assert(a?.pieces.length, "needs a main character wearing something");

    await check(`a loadout saved from ${a.character} as it is: every piece is on it`, () => {
      assert(a.pieces.some((p) => p.place === "equipped"));
      for (const p of a.pieces) assert.deepEqual(whereIs(p, a.character, saveData, roles), { kind: "on" }, p.id);
      const worn = saveData.items.filter((r) => r.owner === a.character && (r.place === "equipped" || r.place === "merc"));
      assert.deepEqual(ids(worn).sort(), a.pieces.filter((p) => p.place !== "inventory").map((p) => p.id).sort());
    });

    const mule = saveData.owners.find((o) => o.cls && o.level === 1 && o.mode === saveData.owners.find((x) => x.name === a.character).mode);
    const piece = a.pieces.find((p) => p.place === "inventory") ?? a.pieces[0];
    const moved = (to) => ({ ...saveData, items: saveData.items.map((r) => (idOf(r) === piece.id && r.place !== "socketed" ? { ...r, ...to } : r)) });
    await check("a piece moved shows where it is now: a mule, another main, elsewhere on the character, gone", () => {
      assert.deepEqual(whereIs(piece, a.character, moved({ owner: mule.name, place: "stash" }), roles), { kind: "mule", owner: mule.name, place: "stash" });
      const b = mains.find((o) => o.name !== a.character);
      assert.deepEqual(whereIs(piece, a.character, moved({ owner: b.name, place: "inventory" }), roles), { kind: "main", owner: b.name, place: "inventory" });
      // A main marked as a mule is a mule
      assert.equal(whereIs(piece, a.character, moved({ owner: b.name, place: "inventory" }), { [b.name]: "mule" }).kind, "mule");
      assert.deepEqual(whereIs(piece, a.character, moved({ place: "cube" }), roles), { kind: "self", owner: a.character, place: "cube" });
      assert.deepEqual(whereIs(piece, a.character, { ...saveData, items: saveData.items.filter((r) => idOf(r) !== piece.id) }, roles), { kind: "missing" });
    });

    // Applying, on the save files: copies changed in memory
    const base = names.map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
    const parse = (name, bytes) => JSON.parse(name.endsWith(".d2s") ? wasm.parseD2s(bytes) : wasm.parseD2i(bytes));
    const write = (name, json) => (name.endsWith(".d2s") ? wasm.writeD2s : wasm.writeD2i)(JSON.stringify(json));
    const json = (files, name) => parse(name, files.find((f) => f.name === name).bytes);
    const edit = (files, changes) => files.map((f) => (changes[f.name] ? { name: f.name, bytes: write(f.name, changes[f.name](json(files, f.name))) } : f));
    const after = (files, out) => [...files.filter((f) => !out.some((o) => o.name === f.name)), ...out.map(({ name, bytes }) => ({ name, bytes }))];
    const mode = saveData.owners.find((o) => o.name === a.character).mode;
    const mules = saveData.owners.filter((o) => o.cls && o.mode === mode && o.level === 1).map((o) => o.name);
    const apply = (files, loadout, leave) => applyLoadoutFiles(files, wasm, loadout, { mules, keep: [], leave });
    const id = (item) => idOf(item, codeOfNumber(item.code));
    const holders = (files, pieceId) =>
      files.flatMap((f) => {
        const j = json(files, f.name);
        const all = f.name.endsWith(".d2s") ? [...j.items, ...(j.merc_items?.items ?? [])] : j.flatMap((tab) => tab.items);
        return all.filter((i) => id(i) === pieceId).map((i) => ({ file: f.name, item: i }));
      });
    const aFile = `${a.character}.d2s`;
    const sorted = (j) => [...j.items, ...j.merc_items.items].map((i) => JSON.stringify(i)).sort();
    const strip = (j) => JSON.stringify({ ...j, file_size: undefined, checksum: undefined, items: undefined, merc_items: { ...j.merc_items, items: undefined } });
    // A free spot of w x h in a mule's stash: [mule file, x, y]
    const freeSpot = (files, w, h) => {
      for (const m of mules) {
        const j = json(files, `${m}.d2s`);
        const used = new Set();
        for (const i of j.items.filter((i) => i.position.store_page === "Stash")) {
          const s = items[codeOfNumber(i.code)];
          for (let x = 0; x < s.w; x++) for (let y = 0; y < s.h; y++) used.add(`${i.position.inv_x + x},${i.position.inv_y + y}`);
        }
        for (let x = 0; x + w <= 10; x++)
          for (let y = 0; y + h <= 10; y++) {
            const cells = [];
            for (let i = 0; i < w; i++) for (let j2 = 0; j2 < h; j2++) cells.push(`${x + i},${y + j2}`);
            if (!cells.some((c) => used.has(c))) return [`${m}.d2s`, x, y];
          }
      }
      throw new Error("no free spot in the mules");
    };
    const toStash = (item, x, y) => ({ ...item, position: { ...item.position, mode: "Stored", body_location: "None", inv_x: x, inv_y: y, store_page: "Stash" } });

    await check("applying the loadout as it is changes nothing", () => assert.deepEqual(apply(base, a).files, []));

    for (const p of [a.pieces.find((p) => p.place === "inventory"), a.pieces.find((p) => p.slot === "Neck")].filter(Boolean)) {
      await check(`${p.slot ?? "a charm"} moved into a mule comes back, the mule loses it, nothing else on ${a.character} changes`, () => {
        const original = json(base, aFile);
        const item = original.items.find((i) => id(i) === p.id);
        const { w, h } = items[p.code];
        const [muleFile, x, y] = freeSpot(base, w, h);
        const moved = edit(base, {
          [aFile]: (j) => ({ ...j, items: j.items.filter((i) => id(i) !== p.id) }),
          [muleFile]: (j) => ({ ...j, items: [...j.items, toStash(item, x, y)] }),
        });
        const { files, report } = apply(moved, a);
        assert.equal(report.pieces.find((r) => r.piece.id === p.id).status, "take");
        assert.deepEqual(report.pieces.find((r) => r.piece.id === p.id).from, { owner: muleFile.slice(0, -4), place: "stash" });
        const done = after(moved, files);
        assert.deepEqual(holders(done, p.id).map((h) => h.file), [aFile]);
        const now = json(done, aFile);
        assert.equal(strip(now), strip(original));
        assert.deepEqual(sorted(now), sorted(original));
        assert(!files.some((f) => f.name !== aFile && saveData.owners.find((o) => `${o.name}.d2s` === f.name && o.level > 1)), "another main was written");
      });
    }

    const b = mains.find((o) => o.name !== a.character && o.mode === mode && !o.dead && json(base, `${o.name}.d2s`).items.some((i) => i.position.body_location === "Neck"));
    const neck = a.pieces.find((p) => p.slot === "Neck");
    if (b && neck) {
      const bFile = `${b.name}.d2s`;
      // Swapped: B wears A's amulet, A wears B's
      const theirs = json(base, bFile).items.find((i) => i.position.body_location === "Neck");
      const mine = json(base, aFile).items.find((i) => id(i) === neck.id);
      const swap = (j, from, to) => ({ ...j, items: j.items.map((i) => (i === undefined ? i : id(i) === id(from) ? { ...to, position: i.position } : i)) });
      const swapped = edit(base, { [aFile]: (j) => swap(j, mine, theirs), [bFile]: (j) => swap(j, theirs, mine) });
      await check(`an amulet worn by ${b.name} is taken from it, and only that; ${a.character}'s own goes into a mule`, () => {
        const { files, report } = apply(swapped, a);
        assert.deepEqual(report.pieces.find((r) => r.piece.id === neck.id).from, { owner: b.name, place: "equipped" });
        assert.deepEqual(report.off.map((o) => id(o.item)), [id(theirs)]);
        const done = after(swapped, files);
        assert.deepEqual(holders(done, neck.id).map((h) => h.file), [aFile]);
        const muleNow = holders(done, id(theirs));
        assert(muleNow.length === 1 && mules.includes(muleNow[0].file.slice(0, -4)), "the amulet taken off is not in a mule");
        const was = json(swapped, bFile);
        const now = json(done, bFile);
        assert.equal(strip(now), strip(was));
        assert.deepEqual(now.items.map((i) => JSON.stringify(i)), was.items.filter((i) => id(i) !== neck.id).map((i) => JSON.stringify(i)));
        assert.deepEqual(now.merc_items, was.merc_items);
      });
      await check(`unticked, it stays on ${b.name} and ${a.character} keeps what it wears there`, () => {
        const { files, report } = apply(swapped, a, [neck.id]);
        assert.equal(report.pieces.find((r) => r.piece.id === neck.id).status, "left");
        assert.deepEqual(files, []);
      });
    } else console.log("--  no second main with an amulet in this mode");

    const charm = a.pieces.find((p) => p.place === "inventory" && items[p.code].w === 1 && items[p.code].h === 1);
    const blocker = json(base, aFile).items.find((i) => i.position.store_page === "Inventory" && i.position.mode === "Stored" && !/^cm|^cs/.test(codeOfNumber(i.code)) && items[codeOfNumber(i.code)].w === 1 && items[codeOfNumber(i.code)].h === 1);
    if (charm && blocker) {
      await check("a charm cell held by something that stays is refused, nothing written", () => {
        const item = json(base, aFile).items.find((i) => id(i) === charm.id);
        const [muleFile, x, y] = freeSpot(base, 1, 1);
        const blocked = edit(base, {
          [aFile]: (j) => ({
            ...j,
            items: j.items.filter((i) => id(i) !== charm.id).map((i) => (i === blocker || id(i) === id(blocker) ? { ...i, position: { ...i.position, inv_x: charm.x, inv_y: charm.y } } : i)),
          }),
          [muleFile]: (j) => ({ ...j, items: [...j.items, toStash(item, x, y)] }),
        });
        assert.throws(() => apply(blocked, a), (e) => e.blocked?.x === charm.x && e.blocked?.y === charm.y && e.blocked.code === codeOfNumber(blocker.code));
      });
    } else console.log("--  no small charm and other 1x1 item in the inventory to block it with");

    const mercPieces = a.pieces.filter((p) => p.place === "merc");
    if (mercPieces.length) {
      await check("without a mercenary its pieces are skipped, said so, and nothing else happens", () => {
        const noMerc = edit(base, { [aFile]: (j) => ({ ...j, character: { ...j.character, merc: { ...j.character.merc, seed: 0 } } }) });
        const { files, report } = apply(noMerc, a);
        assert(report.pieces.filter((r) => r.piece.place === "merc").every((r) => r.status === "noMerc"));
        assert.deepEqual(files, []);
      });
    }

    // Write order: new mules first, the shared stash last; every save receiving what came off and giving no piece
    // before the character, every save giving a piece after it
    const assertOrder = (input, out, report) => {
      const names = new Set(input.map((f) => f.name));
      const isNew = out.map((f) => !names.has(f.name));
      assert.deepEqual(isNew, [...isNew].sort((x, y) => y - x), "new mules first");
      const stash = out.map((f) => f.name.endsWith(".d2i"));
      assert.deepEqual(stash, [...stash].sort((x, y) => x - y), "the shared stash last");
      const at = (name) => out.findIndex((f) => f.name === name);
      const last = (name) => out.findLastIndex((f) => f.name === name);
      const me = at(`${report.pieces[0] ? a.character : ""}.d2s`);
      const givers = new Set(report.pieces.filter((p) => p.status === "take" && p.from.owner !== a.character).map((p) => p.from.owner));
      // (a save written twice: holding both first, as it ends up last)
      const meLast = last(`${report.pieces[0] ? a.character : ""}.d2s`);
      for (const g of givers) if (at(`${g}.d2s`) >= 0) assert(last(`${g}.d2s`) > me, `${g} gives a piece but is written before ${a.character}`);
      for (const o of report.off) if (names.has(`${o.to.mule}.d2s`)) assert(at(`${o.to.mule}.d2s`) < meLast, `${o.to.mule} receives what came off but is written after ${a.character}`);
    };
    const applyChecked = (files, loadout, leave, keep = []) => {
      const result = applyLoadoutFiles(files, wasm, loadout, { mules, keep, leave });
      if (result.files.length) assertOrder(files, result.files, result.report);
      return result;
    };
    const worn = (j, slot, list = "items") => (list === "merc" ? j.merc_items.items : j.items).find((i) => i.position.mode === "Equipped" && i.position.body_location === slot);
    const sharedName = names.find((n) => n.endsWith(".d2i") && modeOfStash(n) === mode);
    // A free w x h spot on a shared stash page: [page index, x, y]
    const sharedSpot = (files, w, h) => {
      const tabs = json(files, sharedName);
      for (const [t, tab] of tabs.entries()) {
        if (tab.tab_type !== "Normal") continue;
        const used = new Set();
        for (const i of tab.items) {
          const s = items[codeOfNumber(i.code)];
          for (let x = 0; x < s.w; x++) for (let y = 0; y < s.h; y++) used.add(`${i.position.inv_x + x},${i.position.inv_y + y}`);
        }
        for (let x = 0; x + w <= 10; x++)
          for (let y = 0; y + h <= 10; y++) {
            const cells = [];
            for (let i = 0; i < w; i++) for (let j2 = 0; j2 < h; j2++) cells.push(`${x + i},${y + j2}`);
            if (!cells.some((c) => used.has(c))) return [t, x, y];
          }
      }
      throw new Error("no free spot in the shared stash");
    };

    if (neck && sharedName) {
      await check("a piece on a shared stash page comes from \"Shared page N\", the stash written last", () => {
        const item = json(base, aFile).items.find((i) => id(i) === neck.id);
        const [t, x, y] = sharedSpot(base, 1, 1);
        const moved = edit(base, {
          [aFile]: (j) => ({ ...j, items: j.items.filter((i) => id(i) !== neck.id) }),
          [sharedName]: (tabs) => tabs.map((tab, i) => (i === t ? { ...tab, items: [...tab.items, toStash(item, x, y)] } : tab)),
        });
        const { files, report } = applyChecked(moved, a);
        assert.deepEqual(report.pieces.find((r) => r.piece.id === neck.id).from, { owner: sharedName.slice(0, -4), place: `shared${t + 1}` });
        assert.equal(files.at(-1).name, sharedName);
        assert.deepEqual(holders(after(moved, files), neck.id).map((h) => h.file), [aFile]);
      });
    }

    // The mains' own loadouts without their unique and set gear: that comes off
    const without = mains
      .filter((o) => o.mode === mode)
      .map((o) => loadoutOf(saveData, o.name))
      .map((full) => [full, { ...full, pieces: full.pieces.filter((p) => !(p.place === "equipped" && /^[us]:/.test(p.key))) }])
      .filter(([full, lo]) => lo.pieces.length < full.pieces.length);
    await check("what a loadout takes off never goes to TRASH", () => {
      for (const [, lo] of without)
        for (const o of applyLoadoutFiles(base, wasm, lo, { mules, keep: [], leave: [] }).report.off) assert.notEqual(o.to?.group, "TRASH", `${lo.character}: ${o.key} taken off into TRASH`);
    });
    await check("every piece of a saved loadout counts as kept: a TRASH mule holding one is not cleaned", () => {
      for (const [full, lo] of without) {
        const keep = loadoutIds({ loadouts: [full, lo] });
        const { saves } = readSaves(after(base, applyLoadoutFiles(base, wasm, lo, { mules, keep, leave: [] }).files), wasm);
        for (const t of trashMules(saves, mode, keep)) if (t.items.some((i) => keep.includes(id(i)))) assert(t.refused, `${t.name} holds a loadout piece and would be cleaned`);
      }
    });
    if (!without.length) console.log("--  no main wearing unique or set gear");

    // The main with the most weapon slots filled: its sets swapped in the save, and one of them missing
    const armed = loadouts
      .map((l) => ({ l, hands: l.pieces.filter((p) => p.place === "equipped" && /Arm|Hand/.test(p.slot)) }))
      .sort((x, y) => y.hands.length - x.hands.length)[0];
    if (armed?.hands.length >= 3) {
      await check(`${armed.l.character}'s weapon sets swapped and one piece gone: both sets stay as they are, nothing taken off them`, () => {
        const lo = armed.l;
        const file = `${lo.character}.d2s`;
        const gone = armed.hands.find((p) => p.slot === "LeftHand") ?? armed.hands.find((p) => p.slot === "RightHand") ?? armed.hands[0];
        const SWAP = { RightArm: "RightHand", LeftArm: "LeftHand", RightHand: "RightArm", LeftHand: "LeftArm" };
        const INDEX = { RightArm: 4, LeftArm: 5, RightHand: 11, LeftHand: 12 };
        const swapped = edit(base, {
          [file]: (j) => ({
            ...j,
            items: j.items
              .filter((i) => id(i) !== gone.id)
              .map((i) => (i.position.mode === "Equipped" && SWAP[i.position.body_location] ? { ...i, position: { ...i.position, body_location: SWAP[i.position.body_location], inv_x: INDEX[SWAP[i.position.body_location]] } } : i)),
          }),
        });
        const was = json(swapped, file);
        const { files, report } = applyChecked(swapped, lo);
        const done = json(after(swapped, files), file);
        for (const slot of Object.keys(SWAP)) assert.deepEqual(worn(done, slot), worn(was, slot), slot);
        for (const p of armed.hands.filter((p) => p !== gone)) assert.equal(report.pieces.find((r) => r.piece.id === p.id).status, "hand", p.slot);
        assert(!report.off.some((o) => /Arm|Hand/.test(o.item.position.body_location)), "a weapon came off");
      });
    } else console.log("--  no main wearing three weapon slots");

    const right = a.pieces.find((p) => p.place === "equipped" && p.slot === "RightArm");
    if (right && sharedName) {
      await check("a quest item worn where a piece goes stays, with the other hand; the piece is not taken", () => {
        const hammerCode = [..."hfh "].reduce((n, ch, i) => n + (ch.charCodeAt(0) << (8 * i)), 0) >>> 0;
        assert(items.hfh.quest && items.box.quest && !items[right.code].quest);
        const weapon = json(base, aFile).items.find((i) => id(i) === right.id);
        // A plain weapon of any save made into the Hellforge Hammer, worn in the piece's slot
        const plain = names
          .filter((n) => n.endsWith(".d2s"))
          .flatMap((n) => json(base, n).items)
          .find((i) => items[codeOfNumber(i.code)]?.table === "weapons" && i.quality === "Normal" && !i.sockets.some(Boolean) && !i.flags.includes("SOCKETED"));
        const hammer = { ...structuredClone(plain), code: hammerCode, seed: 123456789, position: { ...weapon.position } };
        const { w, h } = items[right.code];
        const [t, x, y] = sharedSpot(base, w, h);
        const files = edit(base, {
          [aFile]: (j) => ({ ...j, items: j.items.map((i) => (id(i) === right.id ? hammer : i)) }),
          [sharedName]: (tabs) => tabs.map((tab, i) => (i === t ? { ...tab, items: [...tab.items, toStash(weapon, x, y)] } : tab)),
        });
        const was = json(files, aFile);
        const { files: out, report } = applyChecked(files, a);
        assert.equal(report.pieces.find((r) => r.piece.id === right.id).status, "quest");
        const done = json(after(files, out), aFile);
        assert.deepEqual(worn(done, "RightArm"), worn(was, "RightArm"));
        assert.deepEqual(worn(done, "LeftArm"), worn(was, "LeftArm"));
        assert.equal(holders(after(files, out), right.id)[0].file, sharedName);
      });
    } else console.log("--  no weapon in the right hand");

    if (neck && mule) {
      await check("an identical twin in a mule: no refusal, the one in place counts, nothing written; whereIs agrees", () => {
        const item = json(base, aFile).items.find((i) => id(i) === neck.id);
        const [muleFile, x, y] = freeSpot(base, 1, 1);
        const twin = edit(base, { [muleFile]: (j) => ({ ...j, items: [...j.items, toStash(item, x, y)] }) });
        const { files, report } = applyChecked(twin, a);
        assert.deepEqual(files, []);
        assert.equal(report.pieces.find((r) => r.piece.id === neck.id).twins, 2);
        return parseSaveFiles(twin.map((f) => new File([f.bytes], f.name))).then((data) => assert.deepEqual(whereIs(neck, a.character, data, roles), { kind: "on" }));
      });
      await check("an identical twin, the one in place gone: the mule's copy is taken", () => {
        const item = json(base, aFile).items.find((i) => id(i) === neck.id);
        const [muleFile, x, y] = freeSpot(base, 1, 1);
        const [m2, x2, y2] = freeSpot(edit(base, { [muleFile]: (j) => ({ ...j, items: [...j.items, toStash(item, x, y)] }) }), 1, 1);
        const twin = edit(base, {
          [aFile]: (j) => ({ ...j, items: j.items.filter((i) => id(i) !== neck.id) }),
          [muleFile]: (j) => ({ ...j, items: [...j.items, toStash(item, x, y), ...(m2 === muleFile ? [toStash(item, x2, y2)] : [])] }),
        });
        const { files, report } = applyChecked(twin, a);
        assert.equal(report.pieces.find((r) => r.piece.id === neck.id).status, "take");
        const now = holders(after(twin, files), neck.id);
        assert.equal(now.filter((h) => h.file === aFile).length, 1);
      });
    }

    if (neck) {
      await check("a piece on the character's corpse is \"on a corpse\" in both whereIs and the preview, and not taken", async () => {
        const item = json(base, aFile).items.find((i) => id(i) === neck.id);
        const dead = edit(base, { [aFile]: (j) => ({ ...j, items: j.items.filter((i) => id(i) !== neck.id), corpses: [{ unused: 0, x: 0, y: 0, items: [item] }] }) });
        const { files, report } = applyChecked(dead, a);
        assert.equal(report.pieces.find((r) => r.piece.id === neck.id).status, "corpse");
        assert.deepEqual(files, []);
        const data = await parseSaveFiles(dead.map((f) => new File([f.bytes], f.name)));
        assert.equal(whereIs(neck, a.character, data, roles).kind, "corpse");
      });
    }

    if (mercPieces.length) {
      const hiring = json(base, aFile).character.merc.hireling_id;
      await check("the loadout keeps its mercenary's kind; on another kind of mercenary its pieces are skipped", () => {
        assert.equal(a.mercClass, mercClassOf(hiring));
        const other = Object.keys(mercs).find((k) => mercs[k] !== mercs[hiring]);
        const p = mercPieces[0];
        const item = json(base, aFile).merc_items.items.find((i) => id(i) === p.id);
        const { w, h } = items[p.code];
        const [muleFile, x, y] = freeSpot(base, w, h);
        const rehired = edit(base, {
          [aFile]: (j) => ({ ...j, character: { ...j.character, merc: { ...j.character.merc, hireling_id: Number(other) } }, merc_items: { ...j.merc_items, items: j.merc_items.items.filter((i) => id(i) !== p.id) } }),
          [muleFile]: (j) => ({ ...j, items: [...j.items, toStash(item, x, y)] }),
        });
        const { files, report } = applyChecked(rehired, a);
        assert(report.pieces.filter((r) => r.piece.place === "merc").every((r) => r.status === "otherMerc"));
        assert.deepEqual(files, []);
      });
    }

    if (mercPieces.length) {
      await check("a loadout saved before the mercenary's kind was kept puts no mercenary piece on, whatever mercenary is hired", () => {
        const old = { ...a, mercClass: undefined };
        const p = mercPieces[0];
        const item = json(base, aFile).merc_items.items.find((i) => id(i) === p.id);
        const { w, h } = items[p.code];
        const [muleFile, x, y] = freeSpot(base, w, h);
        for (const hireling of [json(base, aFile).character.merc.hireling_id, 9999]) {
          const moved = edit(base, {
            [aFile]: (j) => ({ ...j, character: { ...j.character, merc: { ...j.character.merc, hireling_id: hireling } }, merc_items: { ...j.merc_items, items: j.merc_items.items.filter((i) => id(i) !== p.id) } }),
            [muleFile]: (j) => ({ ...j, items: [...j.items, toStash(item, x, y)] }),
          });
          const { files, report } = applyChecked(moved, old);
          assert(report.pieces.filter((r) => r.piece.place === "merc").every((r) => r.status === "mercUnknown"), `hireling ${hireling}`);
          assert.deepEqual(files, []);
        }
      });
    }

    // A like-for-like swap: the loadout wants another unique or set item of a kind from a mule, and what it wears
    // there now goes into that same mule (giving and receiving: written twice, around the character)
    await check("a mule giving a piece and receiving what came off is written before and after the character", () => {
      const typeOf = (c) => items[c]?.type;
      let found = 0;
      for (const piece of a.pieces.filter((p) => p.place === "equipped")) {
        for (const m of mules) {
          for (const it of json(base, `${m}.d2s`).items) {
            const c = codeOfNumber(it.code);
            if (found >= 3 || typeOf(c) !== typeOf(piece.code) || !/^[us]:/.test(keyOf(it, c)) || id(it) === piece.id) continue;
            const b = { ...a, pieces: a.pieces.map((p) => (p === piece ? { ...p, id: id(it), key: keyOf(it, c), code: c } : p)) };
            let r;
            try {
              r = applyChecked(base, b, [], loadoutIds({ loadouts: [a, b] }));
            } catch (e) {
              if (e.blocked) continue;
              throw e;
            }
            if (!r.report.off.some((o) => o.to?.mule === m)) continue;
            const order = r.files.map((f) => f.name);
            assert(order.indexOf(`${m}.d2s`) < order.indexOf(aFile) && order.lastIndexOf(`${m}.d2s`) > order.indexOf(aFile), order.join(" "));
            found++;
          }
        }
      }
      console.log(`    ${found} such swaps`);
    });
    await check("swapped in the saves: the character wears a mule's item, the mule holds the piece; a write cut off anywhere loses nothing", () => {
      let n = 0;
      const typeOf = (c) => items[c]?.type;
      for (const piece of a.pieces.filter((p) => p.place === "equipped" && /^[us]:/.test(p.key)))
        for (const m of mules) {
          const theirs = json(base, `${m}.d2s`).items.find((i) => typeOf(codeOfNumber(i.code)) === typeOf(piece.code) && i.position.mode === "Stored");
          if (!theirs) continue;
          const mine = json(base, aFile).items.find((i) => id(i) === piece.id);
          const files = edit(base, {
            [aFile]: (j) => ({ ...j, items: j.items.map((i) => (id(i) === piece.id ? { ...theirs, position: i.position } : i)) }),
            [`${m}.d2s`]: (j) => ({ ...j, items: j.items.map((i) => (id(i) === id(theirs) ? { ...mine, position: i.position } : i)) }),
          });
          try {
            applyChecked(files, a);
            n++;
          } catch (e) {
            if (!e.blocked) throw e;
          }
        }
      console.log(`    ${n} swaps`);
    });

    if (b && neck && mule) {
      await check(`identical twins on ${b.name} and in a mule: the mule's is taken, ${b.name} keeps its own; whereIs agrees`, async () => {
        const mine = json(base, aFile).items.find((i) => id(i) === neck.id);
        const [muleFile, x, y] = freeSpot(base, 1, 1);
        // The main's save read first: the order saves come in doesn't choose
        const files = edit(base, {
          [aFile]: (j) => ({ ...j, items: j.items.filter((i) => id(i) !== neck.id) }),
          [`${b.name}.d2s`]: (j) => ({ ...j, items: j.items.map((i) => (i.position.body_location === "Neck" ? { ...mine, position: i.position } : i)) }),
          [muleFile]: (j) => ({ ...j, items: [...j.items, toStash(mine, x, y)] }),
        }).toSorted((f, g) => (g.name === `${b.name}.d2s`) - (f.name === `${b.name}.d2s`));
        const { files: out, report } = applyChecked(files, a);
        assert.deepEqual(report.pieces.find((r) => r.piece.id === neck.id).from, { owner: muleFile.slice(0, -4), place: "stash" });
        assert(!out.some((f) => f.name === `${b.name}.d2s`), `${b.name} was written`);
        const data = await parseSaveFiles(files.map((f) => new File([f.bytes], f.name)));
        assert.deepEqual(whereIs(neck, a.character, data, roles), { kind: "mule", owner: muleFile.slice(0, -4), place: "stash" });
        // Unticked, the mule's stays where it is
        assert.equal(applyChecked(files, a, [neck.id]).report.pieces.find((r) => r.piece.id === neck.id).status, "left");
      });
    }

    if (neck) {
      await check("a piece in an Iron Golem, or only in another mode's saves: whereIs says what applying does", () => {
        const item = json(base, aFile).items.find((i) => id(i) === neck.id);
        const golem = edit(base, { [aFile]: (j) => ({ ...j, items: j.items.filter((i) => id(i) !== neck.id), iron_golem: { ...j.iron_golem, golem_item: item } }) });
        const { files, report } = applyChecked(golem, a);
        assert.equal(report.pieces.find((r) => r.piece.id === neck.id).status, "golem");
        assert.deepEqual(files, []);
        assert.deepEqual(whereIs(piece, a.character, moved({ place: "golem" }), roles), { kind: "golem", owner: a.character, place: "golem" });
        const other = { ...saveData, owners: [...saveData.owners, { name: "Elsewhere", mode: "HardCore:Classic", cls: "Barbarian", level: 1 }] };
        assert.deepEqual(whereIs(piece, a.character, { ...other, items: other.items.map((r) => (idOf(r) === piece.id && r.place !== "socketed" ? { ...r, owner: "Elsewhere", place: "stash" } : r)) }, roles), { kind: "missing" });
      });
    }

    await check("a loadout never holds two pieces of one id (identical twins worn at once)", () => {
      const record = saveData.items.find((r) => r.owner === a.character && r.place === "inventory" && items[r.code] && ["scha", "mcha", "lcha", "csch"].includes(items[r.code].type));
      if (!record) return;
      const twice = loadoutOf({ ...saveData, items: [...saveData.items, { ...record, x: 9, y: 3 }] }, a.character);
      assert.equal(new Set(twice.pieces.map((p) => p.id)).size, twice.pieces.length);
      assert.deepEqual(twice.pieces, loadoutOf(saveData, a.character).pieces);
    });

    if (neck && mules.length > 1) {
      await check("a mule with items on its corpse or in its Iron Golem: nothing to put into the mules applies; else a clear refusal", () => {
        const item = json(base, aFile).items.find((i) => id(i) === neck.id);
        const [muleFile, x, y] = freeSpot(base, 1, 1);
        const other = mules.find((m) => `${m}.d2s` !== muleFile);
        const junk = json(base, `${other}.d2s`).items[0] ?? item;
        const files = edit(base, {
          [aFile]: (j) => ({ ...j, items: j.items.filter((i) => id(i) !== neck.id) }),
          [muleFile]: (j) => ({ ...j, items: [...j.items, toStash(item, x, y)] }),
          [`${other}.d2s`]: (j) => ({ ...j, corpses: [{ unused: 0, x: 0, y: 0, items: [junk] }] }),
        });
        const { files: out } = applyChecked(files, a);
        assert.deepEqual(out.map((f) => f.name).sort(), [aFile, muleFile].sort());
        // No mules marked: the same
        const noMules = applyLoadoutFiles(files, wasm, a, { mules: [], keep: [], leave: [] });
        assert.deepEqual(noMules.files.map((f) => f.name).sort(), [aFile, muleFile].sort());
        // Something comes off (another amulet worn there): refused, naming the mule
        const theirs = b && json(base, `${b.name}.d2s`).items.find((i) => i.position.body_location === "Neck");
        if (theirs) {
          const worn = edit(files, { [aFile]: (j) => ({ ...j, items: [...j.items, { ...theirs, position: item.position }] }) });
          assert.throws(() => applyLoadoutFiles(worn, wasm, a, { mules, keep: [], leave: [] }), (e) => e.organize?.includes(other));
        }
      });
    }
  }
});
