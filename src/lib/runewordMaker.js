// Which runewords the player can make with the loose runes and empty bases of one game mode, and which they
// almost can. No Horadric Cube rune upgrades. Each runeword is checked on its own: one rune or base counts for all.
import items from "../data/items.json";
import itemTypes from "../data/itemtypes.json";
import { runewords } from "./gameData";

// A type is its own and every parent's (itemtypes.txt Equiv1/Equiv2): a Phase Blade's "swor" is also "mele", "weap"
const isA = (type, target) => type === target || (itemTypes[type] ?? []).some((parent) => isA(parent, target));

// A base the runeword goes in: plain (normal or superior, ethereal or not), exactly as many sockets as runes, all
// empty (so not a runeword yet), of a type the runeword takes. Records from saves read before `filled` was kept
// have it undefined and never fit until read again.
export function fits(w, r) {
  const type = items[r.code]?.type;
  return (
    ["Normal", "Superior"].includes(r.quality) &&
    r.sockets === w.runes.length &&
    r.filled === 0 &&
    w.types.some((t) => isA(type, t)) &&
    !w.exclude?.some((t) => isA(type, t))
  );
}

// records: one mode's items (parseSaves). Per runeword: its recipe as [{ code, need, have }] (each rune once),
// how many runes are short, and the bases that fit. Only loose runes count, not those socketed in an item.
export function runewordOptions(records) {
  const runes = new Map();
  for (const r of records) if (r.key.startsWith("r:") && r.place !== "socketed") runes.set(r.code, (runes.get(r.code) ?? 0) + r.count);
  return runewords.map((w) => {
    const need = new Map();
    for (const code of w.runes) need.set(code, (need.get(code) ?? 0) + 1);
    const recipe = [...need].map(([code, n]) => ({ code, need: n, have: runes.get(code) ?? 0 }));
    const short = recipe.reduce((n, x) => n + Math.max(0, x.need - x.have), 0);
    return { w, recipe, short, bases: records.filter((r) => fits(w, r)) };
  });
}

// The filter groups: can make now, every rune but no base, short 1 rune, short 2
export const GROUPS = {
  rwCanMake: (o) => !o.short && o.bases.length > 0,
  rwNeedBase: (o) => !o.short && !o.bases.length,
  rwShort1: (o) => o.short === 1,
  rwShort2: (o) => o.short === 2,
};
