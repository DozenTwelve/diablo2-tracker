// Which runewords the player can make with the loose runes and empty bases of one game mode, and which they
// almost can. No Horadric Cube rune upgrades. Each runeword is checked on its own: one rune or base counts for all.
import items from "../data/items.json";
import itemTypes from "../data/itemtypes.json";
import { runewords } from "./gameData";

// A type is its own and every parent's (itemtypes.txt Equiv1/Equiv2): a Phase Blade's "swor" is also "mele", "weap"
const isA = (type, target) => type === target || (itemTypes[type]?.equiv ?? []).some((parent) => isA(parent, target));

// The most sockets a base can get at its item level: its type's limit for the level band, at most the base's own.
// Larzuk's quest gives a plain base exactly this many; the cube's socket recipes a random 1 to this many.
export function maxSocketsOf(code, ilvl) {
  const [upTo1, threshold1, upTo2, threshold2, above] = itemTypes[items[code]?.type]?.sockets ?? [0, 0, 0, 0, 0];
  return Math.min(items[code]?.maxSockets ?? 0, ilvl <= threshold1 ? upTo1 : ilvl <= threshold2 ? upTo2 : above);
}

// How a base can take the runeword: "ready" (exactly as many sockets as runes, all empty, so not a runeword yet),
// "larzuk" (no sockets, and Larzuk's quest gives exactly as many), "cube" (no sockets, normal quality, and the cube's
// socket recipes can roll that many), or null. Only plain bases (normal or superior, ethereal or not) of a type the
// runeword takes. Records from saves read before `filled` and `ilvl` were kept never fit until read again.
export function fitOf(w, r) {
  const type = items[r.code]?.type;
  const n = w.runes.length;
  if (!["Normal", "Superior"].includes(r.quality) || !w.types.some((t) => isA(type, t)) || w.exclude?.some((t) => isA(type, t))) return null;
  if (r.sockets === n && r.filled === 0) return "ready";
  if (r.sockets !== 0 || r.ilvl == null) return null;
  const max = maxSocketsOf(r.code, r.ilvl);
  return max === n ? "larzuk" : max > n && r.quality === "Normal" ? "cube" : null;
}

// records: one mode's items (parseSaves). Per runeword: its recipe as [{ code, need, have }] (each rune once),
// how many runes are short, and the bases that fit by kind (fitOf). Only loose runes count, not socketed ones.
export function runewordOptions(records) {
  const runes = new Map();
  for (const r of records) if (r.key.startsWith("r:") && r.place !== "socketed") runes.set(r.code, (runes.get(r.code) ?? 0) + r.count);
  return runewords.map((w) => {
    const need = new Map();
    for (const code of w.runes) need.set(code, (need.get(code) ?? 0) + 1);
    const recipe = [...need].map(([code, n]) => ({ code, need: n, have: runes.get(code) ?? 0 }));
    const short = recipe.reduce((n, x) => n + Math.max(0, x.need - x.have), 0);
    const bases = { ready: [], larzuk: [], cube: [] };
    for (const r of records) bases[fitOf(w, r)]?.push(r);
    return { w, recipe, short, bases };
  });
}

// A base it surely goes in, now or after Larzuk's socket; the cube's random sockets don't count as one
const sureBase = (o) => o.bases.ready.length + o.bases.larzuk.length > 0;

// The filter groups: can make now, every rune but no sure base, short 1 rune, short 2
export const GROUPS = {
  rwCanMake: (o) => !o.short && sureBase(o),
  rwNeedBase: (o) => !o.short && !sureBase(o),
  rwShort1: (o) => o.short === 1,
  rwShort2: (o) => o.short === 2,
};
