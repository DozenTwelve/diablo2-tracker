import { useMemo, useState } from "react";
import items from "../data/items.json";
import { imageOf, labelOf } from "../lib/gameData";
import { locationLines, statLines } from "../lib/inventory";
import { nameOf, t } from "../lib/i18n";
import { ATTACK, RESISTS, SKILLS, isJunk, purpose } from "../lib/organize";
import PageTitle from "./PageTitle";
import Segmented from "./Segmented";
import { STAT_COLOR, Tooltip, colorOf, tipHandlers, useTip } from "./StashGrid";

// Charm sizes, largest first: the group's named base and the base types in it
const SIZES = [["cm3", ["lcha", "csch"]], ["cm2", ["mcha"]], ["cm1", ["scha"]]];
// Purpose filters: charms with any of these stats (null: all)
const FILTERS = { all: null, skills: SKILLS, mf: [80], life: [7], resist: RESISTS, attack: ATTACK, attributes: [0, 1, 2, 3] };
// A charm only works in a character's own inventory; ones in a socket or on a mercenary or golem aren't charms here
const ELSEWHERE = new Set(["socketed", "merc", "golem"]);
// A record as organize.js reads a save item
const asItem = (r) => ({ quality: r.quality, stats: r.stats.map(([id, layer, value]) => ({ id, layer, value })) });

// Every charm the player owns, by size, uniques first, then by purpose as organizing sorts them (skills,
// resistances, life, attack, attributes, magic find, rest; value high to low). With a purpose picked: only charms
// with that stat, most of it first. Low rolls (organizing's LOWCHARM) are dimmed, or hidden.
export default function CharmsView({ saveData, lang }) {
  const [filter, setFilter] = useState("all");
  const [hideLow, setHideLow] = useState(false);
  const [tip, setTip] = useTip();
  const charms = useMemo(
    () =>
      saveData.items
        .filter((r) => !ELSEWHERE.has(r.place) && SIZES.some(([, types]) => types.includes(items[r.code]?.type)))
        .map((r) => ({ r, rank: purpose("CHARM", asItem(r)), junk: isJunk(asItem(r), r.code) })),
    [saveData],
  );

  const ids = FILTERS[filter];
  const amount = (r) => r.stats.reduce((n, [id, , value]) => n + (ids.includes(id) ? value : 0), 0);
  const shown = charms
    .filter((c) => (!ids || c.r.stats.some(([id]) => ids.includes(id))) && !(hideLow && c.junk))
    .sort(
      (a, b) =>
        b.r.key.startsWith("u:") - a.r.key.startsWith("u:") ||
        (ids && amount(b.r) - amount(a.r)) ||
        a.rank[0] - b.rank[0] ||
        a.rank[1] - b.rank[1] ||
        b.rank[2] - a.rank[2],
    );

  const show = (r) => (e) => setTip({ item: r, extra: locationLines([r], lang).map((l) => l.text), rect: e.currentTarget.getBoundingClientRect() });
  return (
    <>
      <PageTitle label={`${t("charms", lang)} ${charms.length}`}>
        <label className="gothic-checkbox text-sm">
          <input type="checkbox" checked={hideLow} onChange={(e) => setHideLow(e.target.checked)} />
          <span>{t("hideLowRolls", lang)}</span>
        </label>
      </PageTitle>
      <div className="mb-8">
        <Segmented label={t("charmPurpose", lang)} options={Object.keys(FILTERS).map((f) => [f, t(`charm_${f}`, lang)])} value={filter} onChange={setFilter} />
      </div>
      <div className="space-y-10">
        {SIZES.map(([code, types]) => {
          const group = shown.filter((c) => types.includes(items[c.r.code].type));
          return (
            <section key={code}>
              <div className="section-head">
                <h2>{nameOf(items[code], lang)}</h2>
                <span className="section-count">{group.length}</span>
              </div>
              {!group.length && <p className="gothic-text-muted text-sm">{t("noCharms", lang)}</p>}
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                {group.map(({ r, junk }, i) => (
                  <button
                    type="button"
                    key={i}
                    {...tipHandlers(show(r), setTip)}
                    onClick={show(r)}
                    className="flex items-center gap-2 p-1 text-left cursor-pointer"
                    style={{ background: "rgba(0, 0, 0, 0.45)", border: "1px solid var(--color-border-metal)", opacity: junk ? 0.45 : undefined }}
                  >
                    <img src={imageOf(r)} alt="" loading="lazy" className="shrink-0 object-contain" style={{ width: 28, height: 28 * items[r.code].h }} />
                    <span className="text-xs leading-tight" style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {r.key.startsWith("u:") && <span style={{ color: colorOf(r) }}>{labelOf(r.key, lang)} · </span>}
                      <span style={{ color: STAT_COLOR }}>{statLines(r, lang).join(" · ")}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {tip && <Tooltip tip={tip} lang={lang} />}
    </>
  );
}
