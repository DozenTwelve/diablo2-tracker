// Checks for src/lib/runewordMaker.js on hand-made items, then what a save folder can make (the folder is only read).
// Usage: node scripts/check-runewords.mjs [save dir]   (exit code 1 when a case fails)
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withApp } from "./load.mjs";

const dir = process.argv[2];
await withApp(async ({ load, parser }) => {
  const { GROUPS, cubeRecipeOf, fitOf, larzukOf, maxSocketsOf, runewordOptions } = await load("/src/lib/runewordMaker.js");
  const { runewords, labelOf } = await load("/src/lib/gameData.js");
  const { ownersOf } = await load("/src/lib/inventory.js");
  const { compareCopies, damageOf } = await load("/src/lib/props.js");
  const rw = (en) => runewords.find((w) => w.en === en);
  const fits = (w, r) => fitOf(w, r) === "ready";
  const base = (code, more) => ({ key: `b:${code}:Normal`, code, quality: "Normal", ilvl: 85, sockets: 4, filled: 0, place: "stash", owner: "M", count: 1, ...more });
  const rune = (code, more) => ({ key: `r:${code}`, code, quality: "Normal", sockets: 0, filled: 0, place: "stash", owner: "M", count: 1, ...more });
  const spirit = rw("Spirit"); // Tal Thul Ort Amn, swords and shields

  assert.ok(fits(spirit, base("crs")), "4 socket Crystal Sword");
  assert.ok(fits(spirit, base("crs", { quality: "Superior", ethereal: true })), "superior and ethereal are fine");
  assert.ok(!fits(spirit, base("crs", { sockets: 3 })) && !fits(spirit, base("crs", { sockets: 5 })), "socket count exactly the runes'");
  assert.ok(!fits(spirit, base("crs", { filled: 1 })), "a filled socket");
  assert.ok(!fits(spirit, base("crs", { quality: "Magic", key: "b:crs:Magic" })), "magic base");
  assert.ok(!fits(spirit, base("crs", { filled: undefined })), "saves read before filled was kept");
  assert.ok(!fits(rw("Insight"), base("crs")) && fits(rw("Insight"), base("7wc")), "Insight: polearms, not swords");
  assert.ok(fits(rw("Enigma"), base("uar", { sockets: 3 })) && !fits(rw("Enigma"), base("uap", { sockets: 3 })), "Enigma: body armor, not helms");

  // Larzuk: min(base gemsockets, type's limit for the ilvl band); Cryptic Axe has 5, polearms 3/4/6 by ilvl 25/40
  assert.deepEqual([10, 25, 26, 40, 41, 81].map((ilvl) => maxSocketsOf("7pa", ilvl)), [3, 3, 4, 4, 5, 5]);
  const cryptic = base("7pa", { ilvl: 81, sockets: 0 });
  assert.equal(fitOf(rw("Insight"), cryptic), "cube", "ilvl 81 Cryptic Axe gets 5 from Larzuk: Insight only by the cube's roll");
  assert.equal(fitOf(rw("Doom"), cryptic), "larzuk", "but fits a 5 rune polearm runeword");
  assert.equal(fitOf(rw("Insight"), base("7pa", { ilvl: 30, sockets: 0 })), "larzuk", "ilvl 26-40: Larzuk gives 4");
  assert.equal(fitOf(rw("Insight"), base("7pa", { sockets: 5 })), null, "5 sockets don't take 4 runes");
  assert.equal(fitOf(rw("Lore"), base("uap", { sockets: 0 })), "larzuk", "Shako: its own 2 caps helms' 3");
  // Crystal Sword gets 6 from Larzuk: Spirit's 4 only by the cube's random roll, and only on a normal one
  assert.equal(fitOf(rw("Spirit"), base("crs", { sockets: 0 })), "cube");
  assert.equal(fitOf(rw("Spirit"), base("crs", { sockets: 0, quality: "Superior" })), null);
  assert.equal(fitOf(rw("Spirit"), base("crs", { sockets: 0, ilvl: undefined })), null, "saves read before ilvl was kept");
  assert.equal(fitOf(rw("Doom"), base("uap", { sockets: 0 })), null, "a helm can't roll 5");

  const option = (en, records) => runewordOptions(records).find((o) => o.w === rw(en));
  const tal = ["r07", "r10", "r09", "r11"].map((c) => rune(c));
  assert.ok(GROUPS.rwCanMake(option("Spirit", [...tal, base("crs")])), "Spirit with runes and base");
  assert.ok(GROUPS.rwNeedBase(option("Spirit", tal)), "Spirit runes, no base");
  assert.ok(GROUPS.rwShort1(option("Spirit", [...tal.slice(1), rune("r07", { place: "socketed" })])), "socketed runes don't count");
  // Infinity is Ber Mal Ber Ist: one Ber is one short, two Bers (two copies or a stack of 2) none
  const infinity = [rune("r30"), rune("r23"), rune("r24"), base("7wc")];
  assert.equal(option("Infinity", infinity).short, 1);
  assert.equal(option("Infinity", [...infinity, rune("r30")]).short, 0);
  assert.equal(option("Infinity", [rune("r30", { count: 2, place: "advanced" }), ...infinity.slice(1)]).short, 0);
  assert.deepEqual(option("Infinity", infinity).recipe.find((x) => x.code === "r30"), { code: "r30", need: 2, have: 1 });
  // The cube's weapon recipe uses up Ral + Amn + Perfect Amethyst: a cube Crystal Sword for Spirit (Tal Thul Ort Amn)
  // needs a second Amn too, and the gem; it never makes a sure base
  const cubeSword = base("crs", { sockets: 0 });
  const recipeRunes = [rune("r08"), rune("r11"), rune("gpv", { key: "b:gpv:Normal" })];
  assert.equal(option("Spirit", [...tal, cubeSword]).bases.cube.length, 0, "no recipe runes");
  assert.equal(option("Spirit", [...tal, recipeRunes[0], recipeRunes[2], cubeSword]).bases.cube.length, 0, "the only Amn is Spirit's");
  assert.equal(option("Spirit", [...tal, ...recipeRunes.slice(0, 2), cubeSword]).bases.cube.length, 0, "no gem");
  const cubed = option("Spirit", [...tal, ...recipeRunes, cubeSword]);
  assert.equal(cubed.bases.cube.length, 1);
  assert.ok(GROUPS.rwNeedBase(cubed));
  // By type and its parents: a circlet or druid pelt is a helm, a paladin shield a shield
  assert.deepEqual(["crs", "uar", "ci0", "dr1", "pa1"].map((c) => cubeRecipeOf(c).gem), ["gpv", "gpy", "gpb", "gpb", "gpr"]);
  // Larzuk's socket: a sure base only while some character of the mode can still get it
  const lore = (larzuk) => runewordOptions([rune("r09"), rune("r12"), base("uap", { sockets: 0 })], larzuk).find((o) => o.w === rw("Lore"));
  assert.ok(GROUPS.rwCanMake(lore(["yzr"])) && GROUPS.rwNeedBase(lore([])));
  const hero = (name, socket, more) => ({ name, mode: "SoftCore:Modern", quests: { respec: [null, null, null], socket }, ...more });
  const owners = [
    hero("a", ["used", "available", null]), hero("b", ["used", "used", "used"]), hero("c", [null, null, null]),
    hero("d", ["available", null, null], { dead: true }), hero("e", ["available", null, null], { mode: "HardCore:Modern" }), { name: "stash" },
  ];
  assert.deepEqual(larzukOf(owners, "SoftCore:Modern"), ["a"]);
  console.log("hand-made cases ok");

  if (dir) {
    await parser(); // the shared instance parseSaves uses
    const { parseSaveFiles } = await load("/src/lib/parseSaves.js");
    const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
    const data = await parseSaveFiles(names.map((name) => new File([readFileSync(join(dir, name))], name)));
    const modeOf = new Map(ownersOf(data).map((o) => [o.name, o.mode]));
    // Copies of Insight best first: Meditation level, then average damage (Sol's +9 min included), then roll score
    const insight = data.items.filter((r) => r.key === "w:61").sort(compareCopies);
    const ranked = insight.map((r) => `${r.owner}/${r.place} ${r.code} ${r.stats.find(([i]) => i === 151)[2]}/${damageOf(r).join("-")}`);
    console.log("Insight copies:", ranked.join(", "));
    // Averages as worked out by hand without Sol, +4.5 with it: 291.5, 306, 306, 286, 281.5, 88.5, 306, 297, 297, 323.5
    if (dir.includes("D2R-snapshot-2026-11-03"))
      assert.deepEqual(ranked, [
        "sdw/merc 7vo 17/62-521", "RW-A/stash 7vo 16/65-547", "yzr/merc 7vo 16/65-547", "ModernSharedStashSoftCoreV2/shared1 7h7 16/158-414",
        "JavaZon/merc 7h7 16/156-407", "RW-A/stash wsc 16/58-119", "lqj/merc 7pa 14/117-495", "LastOne/merc 7pa 14/114-480",
        "ModernSharedStashSoftCoreV2/shared1 7pa 14/114-480", "Zanna/merc 7pa 12/124-523",
      ]);
    for (const mode of [...new Set(modeOf.values())].filter(Boolean).sort()) {
      const larzuk = larzukOf(ownersOf(data), mode);
      const options = runewordOptions(data.items.filter((r) => modeOf.get(r.owner) === mode), larzuk);
      console.log(mode, "Larzuk's socket still open for:", larzuk.join(", ") || "nobody");
      for (const [group, test] of Object.entries(GROUPS)) {
        const lines = options.filter(test).map((o) => {
          const missing = o.recipe.filter((x) => x.have < x.need).map((x) => `${x.code}×${x.need - x.have}`);
          const bases = Object.entries(o.bases).flatMap(([kind, list]) =>
            list.map((r) => `${labelOf(r.key, "en")}${r.ethereal ? " (eth)" : ""} @ ${r.owner}/${r.place}${kind === "ready" ? "" : ` [${kind}]`}`),
          );
          return `    ${o.w.en}${missing.length ? ` missing ${missing}` : ""}${bases.length ? `: ${bases.join(", ")}` : ""}`;
        });
        console.log(`  ${group} ${lines.length}`);
        lines.forEach((l) => console.log(l));
      }
    }
  }
});
