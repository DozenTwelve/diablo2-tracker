// What a save change picked up, for the Deck plugin's pickup alerts (decky/src/watch.js). before and after are
// saveData ({ items, owners }, src/lib/parseSaves.js) of every save, before and after the game wrote some of them.
// Only unique and set items and runes. A unique or set item is picked up when no save had it before, told by its
// own random seed: moving it between the character and the stash, equipping it or the game rewriting a file finds
// nothing. Runes have no seed of their own: one is picked up when a mode's runes of that kind add up to more.
import { labelOf } from "./gameData";
import { t } from "./i18n";
import { ownersOf } from "./inventory";
import { verdictsOf } from "./newItems";

const idOf = (r) => `${r.code}:${r.seed}:${r.quality}`;
const isUniqueOrSet = (r) => /^[us]:/.test(r.key);

function runeCounts(data) {
  const modeOf = new Map(ownersOf(data).map((o) => [o.name, o.mode]));
  const counts = new Map(); // "mode|key" -> count
  for (const r of data.items.filter((r) => r.key.startsWith("r:"))) {
    const k = `${modeOf.get(r.owner)}|${r.key}`;
    counts.set(k, (counts.get(k) ?? 0) + r.count);
  }
  return { counts, modeOf };
}

// [{ r, runes? }]: r a record of after; for runes, runes = { picked, had } of that kind in its mode
export function pickedUp(before, after) {
  const had = new Set(before.items.filter(isUniqueOrSet).map(idOf));
  const found = after.items.filter((r) => isUniqueOrSet(r) && !had.has(idOf(r))).map((r) => ({ r }));
  const was = runeCounts(before).counts;
  const { counts, modeOf } = runeCounts(after);
  for (const [k, n] of counts) {
    const [mode, key] = k.split("|");
    const old = was.get(k) ?? 0;
    if (n > old) found.push({ r: after.items.find((r) => r.key === key && String(modeOf.get(r.owner)) === mode), runes: { picked: n - old, had: old } });
  }
  return found;
}

// Each pickup as a toast { title, body } in lang. Uniques and set items say what organizing would do with them
// (the New finds page's verdict). roles: the Characters page's main/mule choice; the plugin has none to pass
export function pickupToasts(picks, after, lang, roles = {}) {
  const items = picks.filter((p) => !p.runes).map((p) => p.r);
  const verdicts = new Map(verdictsOf(after, items, roles).map(({ r, verdict }) => [r, verdict]));
  return picks.map(({ r, runes }) => {
    const name = labelOf(r.key, lang);
    if (runes) return { title: name, body: runes.had ? t("pickupHaveRunes", lang, runes.had) : t("find_newRune", lang) };
    const verdict = verdicts.get(r);
    return { title: `${t(`find_${verdict.kind}`, lang)}${lang.startsWith("zh") ? "：" : ": "}${name}`, body: t(`findWhy_${verdict.kind}`, lang, verdict) };
  });
}
