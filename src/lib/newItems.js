// What each new find on the inbox pages of the shared stash is worth, before organizing. Unique and set items are
// placed by organizing's own placeCopies over what organizing would take (the mode's mules and inbox pages), so the
// verdict is what organizing will do; charms and jewels by isJunk.
import { byMuleName, copiesNeeded, isCharmOrJewel, isJunk, modePrefix, museumSlots, placeCopies } from "./organize";
import { idOf } from "./gameData";
import { copyScore } from "./props";
import { ownersOf, roleOf } from "./inventory";
import items from "../data/items.json";


const pagesOf = (inboxes, mode) => (Array.isArray(inboxes?.[mode]) ? inboxes[mode] : []); // a stored value may be anything

// The inbox pages' items: records on those shared stash pages of a mode's stash. inboxes: { mode: [page numbers] }
export function inboxItems(saveData, inboxes) {
  const modeOf = new Map(ownersOf(saveData).map((o) => [o.name, o.mode]));
  return saveData.items.filter((r) => {
    const page = r.place.match(/^shared(\d+)$/)?.[1];
    return page && pagesOf(inboxes, modeOf.get(r.owner)).includes(Number(page));
  });
}

// Every find with its verdict: [{ r, verdict: { kind, ... } }], kind one of
//   new: nothing like it anywhere; museum: owned elsewhere but organizing puts this one in its empty museum slot;
//   upgrade: organizing swaps it into the museum { score, museum }; needed: a duplicate organizing keeps in DUP
//   { have, need, merc, charm: a charm or jewel kept past need, as every copy is }; extra: organizing puts it in TRASH
//   { have, need, merc }; junk / keep: a magic charm or jewel that is likely junk (to the LOWCHARM / LOWJEWEL mules) /
//   worth keeping; newRune: a rune type not owned yet; legacy: a unique or set item with no museum slot, every copy
//   kept in DUP; other: anything else.
// roles: the Characters page's main/mule choice (roleOf), keep: idOf ids of copies the player said are not junk, as the
// Organize page passes them.
export const findsOf = (saveData, inboxes, roles = {}, keep = []) => verdictsOf(saveData, inboxItems(saveData, inboxes), roles, keep);

// The same for any records of saveData (the inbox pages' items, or what was just picked up): each is taken as if
// organizing took it along with the mode's mules, like an inbox item
export function verdictsOf(saveData, finds, roles = {}, keep = []) {
  const owners = ownersOf(saveData);
  const verdicts = new Map();
  for (const mode of new Set(finds.map((r) => owners.find((o) => o.name === r.owner)?.mode))) {
    // What organizing this mode takes: its living mules and its inbox pages, not items inside other items
    const mules = new Set(owners.filter((o) => o.cls && o.mode === mode && !o.dead && roleOf(o, roles) === "mule").map((o) => o.name));
    const inbox = new Set(finds.filter((r) => owners.find((o) => o.name === r.owner)?.mode === mode));
    const slots = museumSlots(modePrefix(mode ?? "SoftCore:Modern"));
    // In organizing's order, which settles ties: the mules by name, each as read, then the inbox pages
    const index = new Map(saveData.items.map((r, i) => [r, i]));
    const copies = saveData.items
      .filter((r) => /^[us]:/.test(r.key) && r.place !== "socketed" && (mules.has(r.owner) || inbox.has(r)))
      .sort((a, b) => inbox.has(a) - inbox.has(b) || byMuleName(a.owner, b.owner) || index.get(a) - index.get(b))
      .map((r) => ({
        r,
        key: r.key,
        code: r.code,
        eth: r.ethereal,
        score: copyScore(r) ?? -1,
        home: r.owner === slots.get(r.key)?.mule,
        fixed: r.rolls != null || Boolean(r.personalized) || keep.includes(idOf(r)), // holds runes, gems or jewels (rollsOf), personalized, or kept
        version: r.variant ?? r.stats.find(([id]) => id === 83)?.[1],
      }));
    const where = placeCopies(copies, slots);
    const kept = (key, but) => copies.filter((c) => c.key === key && c.r !== but && where.get(c) !== "TRASH").length;
    for (const c of copies.filter((c) => inbox.has(c.r))) {
      const r = c.r;
      const elsewhere = saveData.items.some((o) => o !== r && o.key === r.key);
      const need = copiesNeeded(r.key);
      const group = where.get(c);
      let verdict;
      if (!slots.has(r.key)) verdict = { kind: "legacy" }; // no museum slot: placeCopies keeps every copy in DUP
      else if (group === "MUSEUM") {
        const now = copies.find((o) => o.key === r.key && o.home);
        verdict = !elsewhere ? { kind: "new" } : now ? { kind: "upgrade", score: c.score, museum: now.score } : { kind: "museum" };
      } else {
        const have = kept(r.key, r);
        verdict = { kind: group === "DUP" ? "needed" : "extra", have, need, merc: r.ethereal, charm: isCharmOrJewel(r.code) && have >= need };
      }
      verdicts.set(r, verdict);
    }
  }
  return finds.map((r) => ({ r, verdict: verdicts.get(r) ?? otherVerdict(r, saveData.items) }));
}

// Finds that are not unique or set items: runes, charms and jewels, the rest
function otherVerdict(record, all) {
  if (record.key.startsWith("r:")) return { kind: all.some((o) => o !== record && o.key === record.key) ? "other" : "newRune" };
  // isJunk reads a save item's quality and stats ({ id, value }); a record's stats are [id, layer, value]
  const asItem = { quality: record.quality, stats: record.stats.map(([id, , value]) => ({ id, value })) };
  if (record.quality === "Magic" && ["scha", "mcha", "lcha", "jewl"].includes(items[record.code]?.type))
    return { kind: isJunk(asItem, record.code) ? "junk" : "keep" };
  return { kind: "other" };
}

export const KINDS = ["new", "museum", "upgrade", "newRune", "needed", "legacy", "keep", "extra", "junk", "other"];
