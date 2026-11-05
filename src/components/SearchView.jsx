import { useMemo, useState } from "react";
import { catalog, iconOf, labelOf, searchTextOf } from "../lib/gameData";
import { statLines, totalCount } from "../lib/inventory";
import { t } from "../lib/i18n";
import { onDeck } from "../lib/deck";
import Locations from "./Locations";
import PageTitle from "./PageTitle";

const MAX_RESULTS = 100;

// Search everything owned plus every catalog entry, so missing items show up too.
// A query matching only stats ("+1 to Passive") lists just the copies with those stats.
export default function SearchView({ owned, lang }) {
  const [query, setQuery] = useState("");
  const keys = useMemo(() => {
    const collectible = [...catalog].filter(([, e]) => !e.legacy).map(([k]) => k);
    return [...new Set([...collectible, ...owned.keys()])];
  }, [owned]);

  const statText = useMemo(() => {
    const map = new Map();
    for (const records of owned.values()) for (const r of records) map.set(r, statLines(r, lang).join("\n").toLowerCase());
    return map;
  }, [owned, lang]);

  const q = query.trim().toLowerCase();
  const matches = !q
    ? []
    : keys
        .map((key) => {
          const records = owned.get(key);
          if (searchTextOf(key).includes(q)) return { key, records };
          const hits = records?.filter((r) => statText.get(r).includes(q));
          return hits?.length ? { key, records: hits } : null;
        })
        .filter(Boolean);
  // Owned first, then by name
  matches.sort((a, b) => !a.records - !b.records || labelOf(a.key, lang).localeCompare(labelOf(b.key, lang)));

  // How many of each owned item, once; its copies grouped by where they are (Locations); then what is missing, with the catalog's icon (a missing
  // runeword has none)
  const shown = matches.slice(0, MAX_RESULTS);
  const found = shown.filter((m) => m.records);
  const missing = shown.filter((m) => !m.records);
  return (
    <>
      <PageTitle label={t("search", lang)} />
      <input
        className="gothic-input max-w-2xl"
        style={{ fontSize: "1.1rem" }}
        placeholder={t("searchPlaceholder", lang)}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus={!onDeck} // on the Deck a focused field brings up the on-screen keyboard
      />
      <div className="mt-6 max-w-3xl">
        {q && matches.length === 0 && <p className="gothic-text-muted">{t("noResults", lang)}</p>}
        {matches.length > MAX_RESULTS && <p className="gothic-text-muted mb-3">{t("tooMany", lang, MAX_RESULTS)}</p>}
        {found.length > 0 && (
          <>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm mb-4">
              {found.map(({ key, records }) => (
                <li key={key} className="gothic-text-gold">
                  {labelOf(key, lang)} ×{totalCount(records)}
                </li>
              ))}
            </ul>
            <Locations records={found.flatMap((m) => m.records)} lang={lang} />
          </>
        )}
        {missing.length > 0 && (
          <section className="mt-8">
            <div className="section-head">
              <h2>{t("missing", lang)}</h2>
              <span className="section-count">{missing.length}</span>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm gothic-text-muted">
              {missing.map(({ key }) => {
                const icon = iconOf(key);
                return (
                  <li key={key} className="inline-flex items-center gap-2">
                    {icon && <img src={icon} alt="" loading="lazy" className="w-8 h-8 object-contain" style={{ opacity: 0.3, filter: "grayscale(1)" }} />}
                    {labelOf(key, lang)}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
