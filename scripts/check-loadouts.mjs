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
  const { applyLoadoutFiles, loadoutOf, whereIs } = await load("/src/lib/loadouts.js");
  const wasm = await load("/wasm/pkg/d2_parser.js");
  const items = (await load("/src/data/items.json")).default;
  const { codeOfNumber } = await load("/src/lib/gameData.js");

  for (const dir of dirs) {
    console.log(dir);
    const check = (what, fn) => (fn(), console.log(`ok  ${what}`));
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

    check(`a loadout saved from ${a.character} as it is: every piece is on it`, () => {
      assert(a.pieces.some((p) => p.place === "equipped"));
      for (const p of a.pieces) assert.deepEqual(whereIs(p, a.character, saveData, roles), { kind: "on" }, p.id);
      const worn = saveData.items.filter((r) => r.owner === a.character && (r.place === "equipped" || r.place === "merc"));
      assert.deepEqual(ids(worn).sort(), a.pieces.filter((p) => p.place !== "inventory").map((p) => p.id).sort());
    });

    const mule = saveData.owners.find((o) => o.cls && o.level === 1 && o.mode === saveData.owners.find((x) => x.name === a.character).mode);
    const piece = a.pieces.find((p) => p.place === "inventory") ?? a.pieces[0];
    const moved = (to) => ({ ...saveData, items: saveData.items.map((r) => (idOf(r) === piece.id && r.place !== "socketed" ? { ...r, ...to } : r)) });
    check("a piece moved shows where it is now: a mule, another main, elsewhere on the character, gone", () => {
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

    check("applying the loadout as it is changes nothing", () => assert.deepEqual(apply(base, a).files, []));

    for (const p of [a.pieces.find((p) => p.place === "inventory"), a.pieces.find((p) => p.slot === "Neck")].filter(Boolean)) {
      check(`${p.slot ?? "a charm"} moved into a mule comes back, the mule loses it, nothing else on ${a.character} changes`, () => {
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
      check(`an amulet worn by ${b.name} is taken from it, and only that; ${a.character}'s own goes into a mule`, () => {
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
      check(`unticked, it stays on ${b.name} and ${a.character} keeps what it wears there`, () => {
        const { files, report } = apply(swapped, a, [neck.id]);
        assert.equal(report.pieces.find((r) => r.piece.id === neck.id).status, "left");
        assert.deepEqual(files, []);
      });
    } else console.log("--  no second main with an amulet in this mode");

    const charm = a.pieces.find((p) => p.place === "inventory" && items[p.code].w === 1 && items[p.code].h === 1);
    const blocker = json(base, aFile).items.find((i) => i.position.store_page === "Inventory" && i.position.mode === "Stored" && !/^cm|^cs/.test(codeOfNumber(i.code)) && items[codeOfNumber(i.code)].w === 1 && items[codeOfNumber(i.code)].h === 1);
    if (charm && blocker) {
      check("a charm cell held by something that stays is refused, nothing written", () => {
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
      check("without a mercenary its pieces are skipped, said so, and nothing else happens", () => {
        const noMerc = edit(base, { [aFile]: (j) => ({ ...j, character: { ...j.character, merc: { ...j.character.merc, seed: 0 } } }) });
        const { files, report } = apply(noMerc, a);
        assert(report.pieces.filter((r) => r.piece.place === "merc").every((r) => r.status === "noMerc"));
        assert.deepEqual(files, []);
      });
    }
  }
});
