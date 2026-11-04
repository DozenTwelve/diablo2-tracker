// Checks for src/lib/pickups.js (the Deck plugin's pickup alerts) on a real save folder, read only: the saves as
// read are "after", and "before" is them with something taken out or moved. Prints how long parsing takes.
// Usage: node scripts/check-pickups.mjs <save dir>
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/check-pickups.mjs <save dir>");

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
try {
  const wasm = await vite.ssrLoadModule("/wasm/pkg/d2_parser.js");
  let start = performance.now();
  wasm.initSync({ module: readFileSync(new URL("../wasm/pkg/d2_parser_bg.wasm", import.meta.url)) });
  const wasmMs = performance.now() - start;
  const { parseSaveFiles } = await vite.ssrLoadModule("/src/lib/parseSaves.js");
  const { pickedUp, pickupToasts } = await vite.ssrLoadModule("/src/lib/pickups.js");
  const { labelOf } = await vite.ssrLoadModule("/src/lib/gameData.js");
  const check = (what, fn) => (fn(), console.log(`ok  ${what}`));

  const names = readdirSync(dir).filter((f) => /\.d2[si]$/.test(f));
  const files = names.map((name) => new File([readFileSync(join(dir, name))], name));
  await parseSaveFiles(files); // warm up
  start = performance.now();
  const after = await parseSaveFiles(files);
  const fullMs = performance.now() - start;
  const one = files.find((f) => f.name.endsWith(".d2s"));
  start = performance.now();
  await parseSaveFiles([one]);
  const oneMs = performance.now() - start;
  assert.deepEqual(after.errors, []);

  const without = (gone, change = (r) => r) => ({ ...after, items: after.items.filter((r) => r !== gone).map(change) });
  const isChar = (r) => after.owners.find((o) => o.name === r.owner)?.cls;
  const unique = after.items.find((r) => /^[us]:/.test(r.key) && isChar(r) && r.place !== "socketed");
  const rune = after.items.filter((r) => r.key.startsWith("r:")).sort((a, b) => b.count - a.count)[0]; // a stack, so one less still leaves some
  assert(unique && rune, "needs a unique or set item on a character and a rune");

  check("nothing changed: nothing picked up", () => assert.deepEqual(pickedUp(after, after), []));

  check("a unique or set item and a rune that no save had before are picked up", () => {
    // before: without the item, and with one rune less of that kind (a stack of the advanced stash one smaller)
    const before = without(unique, (r) => (r === rune ? { ...r, count: r.count - 1 } : r));
    const picks = pickedUp(before, after);
    assert.equal(picks.length, 2, JSON.stringify(picks.map((p) => p.r.key)));
    assert.equal(picks[0].r, unique);
    assert.equal(picks[1].r.key, rune.key);
    assert.equal(picks[1].runes.picked, 1);
  });

  check("moving an item from a character to the shared stash finds nothing", () => {
    const stash = after.owners.find((o) => !o.cls && o.mode === after.owners.find((c) => c.name === unique.owner).mode);
    assert(stash, "needs a shared stash in the item's mode");
    const moved = without(null, (r) => (r === unique ? { ...r, owner: stash.name, place: "shared1", x: 0, y: 0 } : r));
    assert.deepEqual(pickedUp(after, moved), []);
    assert.deepEqual(pickedUp(moved, after), []);
    // and a rune moved from a character's inventory into the advanced stash: the same count in its mode
    const charRune = after.items.find((r) => r.key.startsWith("r:") && isChar(r));
    if (charRune) {
      const out = without(charRune, (r) => (r.owner === stash.name && r.key === charRune.key ? { ...r, count: r.count + charRune.count } : r));
      if (out.items.some((r) => r.owner === stash.name && r.key === charRune.key)) assert.deepEqual(pickedUp(after, out), []);
    }
  });

  check("the toast for a new item and for one already owned", () => {
    const count = (key) => after.items.filter((r) => r.key === key).length;
    const lone = after.items.find((r) => /^[us]:/.test(r.key) && count(r.key) === 1);
    const owned = after.items.find((r) => /^[us]:/.test(r.key) && count(r.key) > 1 && isChar(r));
    assert(lone && owned, "needs an item owned once and one owned several times");
    const [fresh] = pickupToasts(pickedUp(without(lone), after), after, "zh_tw");
    console.log(`    ${fresh.title} / ${fresh.body}`);
    assert.equal(fresh.title, `新收藏：${labelOf(lone.key, "zh_tw")}`);
    const [again] = pickupToasts(pickedUp(without(owned), after), after, "zh_tw");
    console.log(`    ${again.title} / ${again.body}`);
    assert(again.title.endsWith(labelOf(owned.key, "zh_tw")) && !again.title.startsWith("新收藏"), again.title);
    const before = without(null, (r) => (r.key === rune.key ? { ...r, count: 0 } : r));
    const [first] = pickupToasts(pickedUp(before, after), after, "zh_tw");
    assert.deepEqual(first, { title: labelOf(rune.key, "zh_tw"), body: "新符文" });
    const [more] = pickupToasts(pickedUp(without(null, (r) => (r === rune ? { ...r, count: r.count - 1 } : r)), after), after, "en");
    console.log(`    ${more.title} / ${more.body}`);
    assert.match(more.body, /^You have \d+ already$/);
  });

  console.log(`wasm compile ${wasmMs.toFixed(1)} ms; parse all ${files.length} files ${fullMs.toFixed(1)} ms; one file (${one.name}) ${oneMs.toFixed(1)} ms`);
} finally {
  await vite.close();
}
