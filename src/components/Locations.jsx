import { imageOf, labelOf } from "../lib/gameData";
import { groupByKey, itemsByPlace, ownerLabel, placeLabel } from "../lib/inventory";
import { t } from "../lib/i18n";
import { STAT_COLOR } from "./StashGrid";

// Records grouped by where they are: "JavaZon · 背包" once as a small heading, the items there under it by name, each
// copy one line of its stats ("無形 · 4孔 · +1 所有技能 · ...", identical ones once with a count).
export default function Locations({ records, lang }) {
  const owners = [...new Set(records.map((r) => r.owner))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return (
    <div className="space-y-5">
      {owners.flatMap((owner) =>
        itemsByPlace(records, owner, lang).map(({ place, lines }) => (
          <section key={`${owner}\n${place}`}>
            <h3 className="text-sm gothic-text-muted pb-1 mb-1" style={{ borderBottom: "1px solid var(--color-border-steel)" }}>
              {ownerLabel(owner, lang)} · {placeLabel(place, lang)}
            </h3>
            <ul className="text-sm">
              {[...groupByKey(lines.map((l) => ({ ...l, key: l.record.key }))).values()].map((copies) => {
                const r = copies[0].record;
                return (
                  <li key={r.key} className="flex gap-3 py-1">
                    <img src={imageOf(r)} alt="" loading="lazy" className="w-8 h-8 object-contain shrink-0" />
                    <div className="min-w-0">
                      <span className="gothic-text-gold">{labelOf(r.key, lang)}</span>
                      {copies.map(({ record, stats, count }, i) => (
                        <div key={i}>
                          {[record.ethereal && t("ethereal", lang), record.sockets > 0 && t("sockets", lang, record.sockets)].filter(Boolean).map((d) => (
                            <span key={d} className="gothic-text-muted">{d} · </span>
                          ))}
                          <span style={{ color: STAT_COLOR }}>{stats.join(" · ")}</span>
                          {count > 1 && <span className="gothic-text-gold"> ×{count}</span>}
                        </div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )),
      )}
    </div>
  );
}
