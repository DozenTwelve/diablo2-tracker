// Checks for src/lib/runewordMaker.js on hand-made items, then what a save folder can make (the folder is only read).
// Usage: node scripts/check-runewords.mjs [save dir]   (exit code 1 when a case fails)
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";

const dir = process.argv[2];
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
try {
  const { GROUPS, fitOf, maxSocketsOf, runewordOptions } = await vite.ssrLoadModule("/src/lib/runewordMaker.js");
  const { runewords, labelOf } = await vite.ssrLoadModule("/src/lib/gameData.js");
  const { ownersOf } = await vite.ssrLoadModule("/src/lib/inventory.js");
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
  console.log("hand-made cases ok");

  if (dir) {
    const wasm = await vite.ssrLoadModule("/wasm/pkg/d2_parser.js");
    wasm.initSync({ module: readFileSync(new URL("../wasm/pkg/d2_parser_bg.wasm", import.meta.url)) });
    const { parseSaveFiles } = await vite.ssrLoadModule("/src/lib/parseSaves.js");
    const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
    const data = await parseSaveFiles(names.map((name) => new File([readFileSync(join(dir, name))], name)));
    const modeOf = new Map(ownersOf(data).map((o) => [o.name, o.mode]));
    for (const mode of [...new Set(modeOf.values())].filter(Boolean).sort()) {
      const options = runewordOptions(data.items.filter((r) => modeOf.get(r.owner) === mode));
      console.log(mode);
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
} finally {
  await vite.close();
}
