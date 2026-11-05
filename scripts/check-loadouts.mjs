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
  const { loadoutOf, whereIs } = await load("/src/lib/loadouts.js");

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
  }
});
