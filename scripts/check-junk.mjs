// Check the likely-junk rules in src/lib/organize.js on made-up items.
import assert from "node:assert/strict";
import { withApp } from "./load.mjs";

await withApp(async ({ load }) => {
  const { isJunk } = await load("/src/lib/organize.js");
  // stats as in the save JSON; life (7) is stored shifted by 8
  const item = (quality, ...stats) => ({ quality, stats: stats.map(([id, value]) => ({ id, layer: 0, value })) });
  const life = (n) => [7, n << 8];
  assert.equal(isJunk(item("Magic", life(10)), "cm1"), true, "small charm, low life");
  assert.equal(isJunk(item("Magic", life(20)), "cm1"), false, "small charm, good life");
  assert.equal(isJunk(item("Magic", life(10), [39, 11]), "cm1"), false, "one good stat keeps it");
  assert.equal(isJunk(item("Magic", [39, 5], [41, 5], [43, 5], [45, 5]), "cm1"), false, "all resistances +5");
  assert.equal(isJunk(item("Magic", [107, 1]), "cm3"), false, "unlisted stat (skills) keeps it");
  assert.equal(isJunk(item("Rare", life(1)), "cm1"), false, "only magic items");
  assert.equal(isJunk(item("Magic", [79, 20]), "jew"), true, "jewel, gold find only");
  assert.equal(isJunk(item("Magic", [79, 20]), "rin"), false, "not rings");
  // "+N min damage" is stored as 21, 23 and 159, "+N max damage" as 22, 24 and 160
  const min = (n) => [[21, n], [23, n], [159, n]];
  const max = (n) => [[22, n], [24, n], [160, n]];
  assert.equal(isJunk(item("Magic", ...min(1)), "jew"), true, "jewel, +1 min damage");
  assert.equal(isJunk(item("Magic", ...max(9)), "jew"), true, "jewel, +9 max damage");
  assert.equal(isJunk(item("Magic", ...max(15)), "jew"), false, "jewel, +15 max damage");
  assert.equal(isJunk(item("Magic", life(20), [54, 1], [55, 5], [56, 50]), "cm3"), true, "grand charm, low life and cold damage");
  console.log("junk rules ok");
});
