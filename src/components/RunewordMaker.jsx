import { useMemo, useState } from "react";
import { groupByKey, locationLines, ownersOf } from "../lib/inventory";
import { imageOf, labelOf, runewordKey } from "../lib/gameData";
import { modeLabel } from "../lib/modes";
import { GROUPS, cubeRecipeOf, larzukOf, runewordOptions } from "../lib/runewordMaker";
import { t } from "../lib/i18n";
import Segmented from "./Segmented";

// What runewords the loose runes and empty bases of one game mode make, or nearly make (src/lib/runewordMaker.js).
// The mode as the Organize page picks it: Reign of the Warlock softcore when there, else the first.
export default function RunewordMaker({ saveData, lang }) {
  const owners = ownersOf(saveData);
  const modes = [...new Set(owners.map((o) => o.mode).filter(Boolean))].sort();
  const [picked, setPicked] = useState(null);
  const [group, setGroup] = useState("rwCanMake");
  const mode = modes.includes(picked) ? picked : modes.includes("SoftCore:Modern") ? "SoftCore:Modern" : modes[0];
  const options = useMemo(() => {
    const owners = ownersOf(saveData);
    const modeOf = new Map(owners.map((o) => [o.name, o.mode]));
    // Saves read before owners had modes: all items together
    return runewordOptions(mode ? saveData.items.filter((r) => modeOf.get(r.owner) === mode) : saveData.items, larzukOf(owners, mode));
  }, [saveData, mode]);
  const shown = options.filter(GROUPS[group]);

  return (
    <section className="mb-10">
      <div className="section-head">
        <h2>{t("rwMaker", lang)}</h2>
      </div>
      <div className="flex flex-wrap items-center gap-4 mb-3">
        {modes.length > 1 && (
          <Segmented label={t("gameMode", lang)} options={modes.map((m) => [m, modeLabel(m, lang)])} value={mode} onChange={setPicked} />
        )}
        <Segmented
          label={t("rwMaker", lang)}
          options={Object.entries(GROUPS).map(([g, test]) => [g, `${t(g, lang)} ${options.filter(test).length}`])}
          value={group}
          onChange={setGroup}
        />
      </div>
      <p className="text-sm gothic-text-muted mb-4 max-w-prose">{t("rwMakerNote", lang)}</p>
      {!shown.length && <p className="text-sm gothic-text-muted">{t("rwNone", lang)}</p>}
      <ul className="space-y-4">
        {shown.map((o) => (
          <Option key={o.w.id} option={o} lang={lang} />
        ))}
      </ul>
    </section>
  );
}

// "Spirit  Tal 1/1 + Thul 0/1 + Ort 2/1 + Amn 1/1", the runes short, and where the fitting bases are (src/lib/runewordMaker.js fitOf)
function Option({ option: { w, recipe, short, bases, larzuk }, lang }) {
  const sep = t("listSeparator", lang);
  // "Ral + Amn + 完美紫寶石": what the cube's socket recipe for this base uses up
  const cubeText = (code) => {
    const c = cubeRecipeOf(code);
    return [...c.runes.map((r) => labelOf(`r:${r}`, lang)), labelOf(`b:${c.gem}:Normal`, lang)].join(" + ");
  };
  const label = (kind, code) => (kind === "cube" ? t("rwCube", lang, cubeText(code)) : larzuk.length ? t("rwLarzuk", lang, larzuk.join(sep)) : t("rwLarzukUsed", lang));
  const missing = recipe.filter((x) => x.have < x.need).map((x) => `${labelOf(`r:${x.code}`, lang)}${x.need - x.have > 1 ? ` ×${x.need - x.have}` : ""}`);
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="gothic-text-gold">{labelOf(runewordKey(w), lang)}</span>
        {recipe.map((x) => (
          <span key={x.code} className={`text-sm inline-flex items-center gap-1 ${x.have < x.need ? "text-red-400" : ""}`}>
            <img src={imageOf({ key: `r:${x.code}`, code: x.code })} alt="" loading="lazy" style={{ width: 18, height: 18 }} />
            {labelOf(`r:${x.code}`, lang)} {x.have}/{x.need}
          </span>
        ))}
      </div>
      {short > 0 && <div className="text-sm text-red-400 pl-4">{t("rwMissing", lang, missing.join(sep))}</div>}
      {!bases.ready.length && !(larzuk.length && bases.larzuk.length) && <div className="text-sm gothic-text-muted pl-4">{t("rwNoBase", lang)}</div>}
      {/* Ready bases first, then those needing Larzuk's socket, then the cube's random one */}
      {["ready", "larzuk", "cube"].flatMap((kind) =>
        [...groupByKey(bases[kind])].flatMap(([key, records]) =>
          locationLines(records, lang).map((l, i) => (
            <div key={`${kind}:${key}:${i}`} className="text-sm pl-4">
              {labelOf(key, lang)} <span className="gothic-text-muted">· {l.text}</span>
              {l.count > 1 && <span className="gothic-text-gold"> ×{l.count}</span>}
              {kind !== "ready" && <span className={kind === "larzuk" && larzuk.length ? "gothic-text-gold" : "gothic-text-muted"}> · {label(kind, key.split(":")[1])}</span>}
            </div>
          )),
        ),
      )}
    </li>
  );
}
