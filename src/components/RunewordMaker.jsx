import { useMemo, useState } from "react";
import { groupByKey, locationLines, ownersOf } from "../lib/inventory";
import { imageOf, labelOf, runewordKey } from "../lib/gameData";
import { modeLabel } from "../lib/modes";
import { CUBE_SOCKETS, GROUPS, larzukOf, runewordOptions } from "../lib/runewordMaker";
import { t } from "../lib/i18n";
import { useStoredState } from "../lib/useStoredState";
import CollectionView from "./CollectionView";
import Segmented from "./Segmented";
import { Tooltip, tipHandlers, useTip } from "./StashGrid";

// The Runewords page with saves loaded: tabs for the runewords owned (the collection tiles) and for those the loose
// runes and empty bases of one game mode make or nearly make (src/lib/runewordMaker.js), one tab per GROUPS entry.
// The mode as the Organize page picks it: Reign of the Warlock softcore when there, else the first.
export default function RunewordMaker({ saveData, lang, ...collection }) {
  const owners = ownersOf(saveData);
  const modes = [...new Set(owners.map((o) => o.mode).filter(Boolean))].sort();
  const [picked, setPicked] = useState(null);
  const [stored, setTab] = useStoredState("runewordTab", "owned");
  const tab = Object.hasOwn(GROUPS, stored) ? stored : "owned";
  const [tip, setTip] = useTip();
  const mode = modes.includes(picked) ? picked : modes.includes("SoftCore:Modern") ? "SoftCore:Modern" : modes[0];
  const larzuk = larzukOf(owners, mode);
  const options = useMemo(() => {
    const owners = ownersOf(saveData);
    const modeOf = new Map(owners.map((o) => [o.name, o.mode]));
    // Saves read before owners had modes: all items together
    return runewordOptions(mode ? saveData.items.filter((r) => modeOf.get(r.owner) === mode) : saveData.items, larzukOf(owners, mode));
  }, [saveData, mode]);
  const shown = tab === "owned" ? [] : options.filter(GROUPS[tab]);
  const owned = collection.groups.flatMap((g) => g.keys).filter((k) => collection.owned.has(k)).length;
  const sep = t("listSeparator", lang);
  const typeLabel = { weap: "slot_weapon", tors: "slot_armor", helm: "slot_helm", shld: "shieldSlot" };
  const cube = CUBE_SOCKETS.map((c) => `${t(typeLabel[c.type], lang)} ${[...c.runes.map((r) => labelOf(`r:${r}`, lang)), labelOf(`b:${c.gem}:Normal`, lang)].join("+")}`);

  const tabs = (
    <nav className="flex flex-wrap gap-2 mb-6" aria-label={t("runewords", lang)}>
      {[["owned", `${t("rwOwned", lang)} ${owned}`], ...Object.entries(GROUPS).map(([g, test]) => [g, `${t(g, lang)} ${options.filter(test).length}`])].map(([v, text]) => (
        <button
          key={v}
          type="button"
          className={`gothic-btn gothic-btn-small ${v === tab ? "" : "gothic-btn-secondary"}`}
          aria-pressed={v === tab}
          onClick={() => setTab(v)}
        >
          {text}
        </button>
      ))}
    </nav>
  );

  return (
    <CollectionView {...collection} lang={lang} tabs={tabs}>
      {tab !== "owned" && (
        <section aria-label={t("rwMaker", lang)}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
            {modes.length > 1 && (
              <Segmented label={t("gameMode", lang)} options={modes.map((m) => [m, modeLabel(m, lang)])} value={mode} onChange={setPicked} />
            )}
            <details className="text-sm gothic-text-muted">
              <summary className="cursor-pointer">{t("rwAbout", lang)}</summary>
              <p className="mt-2 max-w-prose">{t("rwMakerNote", lang)}</p>
            </details>
          </div>
          <div className="text-sm gothic-text-muted mb-4 space-y-1">
            <div>
              <Tag kind="larzuk" larzuk={larzuk} lang={lang} /> {larzuk.length ? t("rwLegendLarzuk", lang, larzuk.join(sep)) : t("rwLarzukUsed", lang)}
            </div>
            <div>
              <Tag kind="cube" lang={lang} /> {t("rwLegendCube", lang, cube.join(sep))}
            </div>
          </div>
          {!shown.length && <p className="text-sm gothic-text-muted">{t("rwNone", lang)}</p>}
          <ul className="space-y-1">
            {shown.map((o) => (
              <Option key={o.w.id} option={o} setTip={setTip} lang={lang} />
            ))}
          </ul>
          {tip && <Tooltip tip={tip} lang={lang} />}
        </section>
      )}
    </CollectionView>
  );
}

// "拉蘇克" / "方塊": a base that takes the runeword only after Larzuk's or the cube's socketing (explained once above)
function Tag({ kind, larzuk, lang }) {
  if (kind === "ready") return null;
  const gold = kind === "larzuk" && larzuk.length;
  return (
    <span className={`text-xs px-1 rounded-sm border ${gold ? "gothic-text-gold border-current" : "gothic-text-muted border-gray-600"}`}>
      {t(kind === "larzuk" ? "rwLarzukTag" : "rwCubeTag", lang)}
    </span>
  );
}

// One runeword: a row with its runes (have/need, red when short) and its bases in short; tapping it lists every base
function Option({ option: { w, recipe, bases, larzuk }, setTip, lang }) {
  const [open, setOpen] = useState(false);
  const key = runewordKey(w);
  // Ready bases first, then Larzuk's while someone can still use it, then the cube's random one
  const kinds = larzuk.length ? ["ready", "larzuk", "cube"] : ["ready", "cube", "larzuk"];
  const first = kinds.find((k) => bases[k].length);
  const total = kinds.reduce((n, k) => n + bases[k].length, 0);
  const runes = w.runes.map((code) => labelOf(`r:${code}`, lang)).join(" + ");
  const show = (item, summary) => (e) => setTip({ item, summary, extra: summary ? [runes] : [], rect: e.currentTarget.getBoundingClientRect() });

  return (
    <li>
      <button
        type="button"
        aria-expanded={total ? open : undefined}
        {...tipHandlers(show({ key }, true), setTip)}
        onClick={total ? () => setOpen(!open) : show({ key }, true)}
        className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5"
        style={{ background: "rgba(0, 0, 0, 0.45)", border: "1px solid var(--color-border-steel)" }}
      >
        <span className="gothic-text-gold min-w-[5rem]">{labelOf(key, lang)}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {recipe.map((x) => (
            <span key={x.code} className="inline-flex items-center gap-1 text-sm">
              <img src={imageOf({ key: `r:${x.code}`, code: x.code })} alt="" loading="lazy" style={{ width: 20, height: 20 }} />
              {labelOf(`r:${x.code}`, lang)}
              <span className={`text-xs px-1 rounded-sm ${x.have < x.need ? "bg-red-900/70 text-red-200" : "bg-black/60 gothic-text-muted"}`}>
                {x.have}/{x.need}
              </span>
            </span>
          ))}
        </span>
        <span className="ml-auto inline-flex items-center gap-2 text-sm gothic-text-muted">
          {first ? (
            <>
              {labelOf(bases[first][0].key, lang)}
              {total > 1 && ` +${total - 1}`}
              <Tag kind={first} larzuk={larzuk} lang={lang} />
            </>
          ) : (
            t("rwNoBase", lang)
          )}
          {total > 0 && <span aria-hidden="true">{open ? "▾" : "▸"}</span>}
        </span>
      </button>
      {open && total > 0 && (
        <ul className="pl-4 py-1 text-sm">
          {kinds.flatMap((kind) =>
            linesOf(bases[kind], lang).map((l, i) => (
              <li key={`${kind}:${i}`}>
                <button type="button" {...tipHandlers(show(l.record), setTip)} onClick={show(l.record)} className="text-left py-0.5">
                  {labelOf(l.record.key, lang)} <span className="gothic-text-muted">· {l.text}</span>
                  {l.count > 1 && <span className="gothic-text-gold"> ×{l.count}</span>} <Tag kind={kind} larzuk={larzuk} lang={lang} />
                </button>
              </li>
            )),
          )}
        </ul>
      )}
    </li>
  );
}

// Bases as "龍皮甲 · BASE-A · 儲物箱 · 3孔 ×2": identical ones (same base, place and stats) on one line, with one of
// them for the tooltip
function linesOf(records, lang) {
  const lines = new Map();
  for (const record of [...groupByKey(records).values()].flat()) {
    const l = locationLines([record], lang)[0];
    const k = [record.key, l.text, ...l.stats].join("\n");
    lines.set(k, { ...l, record, count: (lines.get(k)?.count ?? 0) + record.count });
  }
  return [...lines.values()];
}
