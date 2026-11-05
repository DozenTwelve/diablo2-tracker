// Loadouts: what a main character wears, what its mercenary wears and the charms in its inventory, saved by name to
// put on again in one write. A loadout is { id, name, character, merc (a mercenary was hired), pieces }; a piece is one
// copy (idOf) with where it goes: { id, key, code, gfx (its look), place: "equipped" | "merc", slot } or { ..., place: "inventory", x, y }.
// The plugin keeps them (src/lib/deck.js), so they exist on the Steam Deck only.
import { idOf } from "./gameData";
import { roleOf } from "./inventory";
import items from "../data/items.json";

const CHARMS = ["scha", "mcha", "lcha", "csch"]; // small, large, grand (and the other grand charm base)
export const isCharm = (code) => CHARMS.includes(items[code]?.type);

// The loadout the character wears now, from parseSaves records
export function loadoutOf(saveData, character) {
  const owner = saveData.owners.find((o) => o.name === character);
  const records = saveData.items.filter((r) => r.owner === character);
  const pieces = records
    .filter((r) => r.place === "equipped" || r.place === "merc" || (r.place === "inventory" && isCharm(r.code)))
    .map((r) => ({ id: idOf(r), key: r.key, code: r.code, gfx: r.gfx, place: r.place, ...(r.place === "inventory" ? { x: r.x, y: r.y } : { slot: r.slot }) }));
  return { character, merc: owner?.merc ?? records.some((r) => r.place === "merc"), pieces };
}

// Whether a record is where the piece goes on the loadout's character
export const inPlace = (piece, r, character) =>
  r.owner === character && r.place === piece.place && (piece.place === "inventory" ? r.x === piece.x && r.y === piece.y : r.slot === piece.slot);

// Where a piece is now: { kind: "on" } (in place), "self" (elsewhere on the character), "main" (another main
// character has it), "mule" (a mule or a shared stash), with { owner, place }; or { kind: "missing" }
export function whereIs(piece, character, saveData, roles) {
  const r = saveData.items.find((r) => r.place !== "socketed" && idOf(r) === piece.id);
  if (!r) return { kind: "missing" };
  if (inPlace(piece, r, character)) return { kind: "on" };
  const owner = saveData.owners.find((o) => o.name === r.owner);
  const kind = r.owner === character ? "self" : owner?.cls && roleOf(owner, roles) === "main" ? "main" : "mule";
  return { kind, owner: r.owner, place: r.place };
}
