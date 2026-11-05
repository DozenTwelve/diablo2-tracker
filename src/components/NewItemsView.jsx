import { useEffect, useState } from "react";
import { imageOf, labelOf } from "../lib/gameData";
import { ownerLabel, ownersOf, placeLabel } from "../lib/inventory";
import { t } from "../lib/i18n";
import { findsOf, KINDS } from "../lib/newItems";
import { Link } from "../lib/router";
import { useLoadoutIds } from "../lib/useLoadoutIds";
import { useStoredState } from "../lib/useStoredState";
import PageTitle from "./PageTitle";
import { colorOf, Tooltip, tipHandlers, useTip } from "./StashGrid";

// Kinds whose reason differs per find: the group says how to read the row (these strings), each row its numbers
// (findRow_*). Every other kind's reason (findWhy_*) is the same for each find, so it is said once under the heading.
const VARIES = { upgrade: ["findNote_upgrade"], needed: ["findNote_needed", "findLegend"], extra: ["findLegend"] };

// /new: what the finds dropped on the inbox pages of the shared stash are worth (src/lib/newItems.js), read only,
// so it can be checked with the game still running. The inbox pages are picked here, per shared stash, and the
// Organize page uses the same choice.
export default function NewItemsView({ saveData, keep, lang }) {
  const [inboxes, setInboxes] = useStoredState("inbox", {}); // mode -> page numbers
  const [roles] = useStoredState("roles", {});
  const picked = (mode) => (Array.isArray(inboxes[mode]) ? inboxes[mode] : []);
  const [tip, setTip] = useTip();
  const loadouts = useLoadoutIds(); // their pieces count as kept, as organizing takes them
  const pagesOf = (stash) => {
    const used = saveData.items.filter((r) => r.owner === stash.name && /^shared\d+$/.test(r.place)).map((r) => Number(r.place.slice(6)));
    const last = Math.max(stash.pages ?? 0, ...used, ...picked(stash.mode));
    return Array.from({ length: last }, (_, i) => ({ page: i + 1, count: used.filter((p) => p === i + 1).length }));
  };
  // Shared stashes the game reads, empty ones too
  const stashes = ownersOf(saveData).filter((o) => !o.cls && o.mode);
  const toggle = (mode, page) => {
    const now = picked(mode);
    setInboxes({ ...inboxes, [mode]: now.includes(page) ? now.filter((p) => p !== page) : [...now, page].sort((a, b) => a - b) });
  };

  const finds = findsOf(saveData, inboxes, roles, [...keep, ...(loadouts.ids ?? [])]);
  const chosen = Object.keys(inboxes).some((mode) => picked(mode).length);
  const onePage = new Set(finds.map((f) => f.r.place)).size < 2; // the page label would be the same on every row
  // What the page is for: open on the first visit only
  const [introSeen, setIntroSeen] = useStoredState("newIntroSeen", false);
  const [introOpen] = useState(!introSeen);
  useEffect(() => setIntroSeen(true), [setIntroSeen]);

  return (
    <>
      <PageTitle
        label={t("new", lang)}
        sub={
          <details className="text-sm gothic-text-muted" open={introOpen}>
            <summary className="cursor-pointer">{t("newItemsHow", lang)}</summary>
            <p className="mt-1">{t("newItemsAbout", lang)}</p>
          </details>
        }
      />
      <div className="max-w-3xl space-y-8">
        {saveData.skipped > 0 && <p className="text-sm gothic-text-muted">{t("skippedSubfolders", lang, saveData.skipped)}</p>}
        <section className="space-y-3">
          <div className="section-head">
            <h2>{t("inboxPagesShort", lang)}</h2>
          </div>
          {stashes.length === 0 && <p className="gothic-text-muted">{t("noStash", lang)}</p>}
          {stashes.map((stash) => (
            <div key={stash.name} className="flex flex-wrap items-center gap-2">
              <span className="text-sm mr-2">{ownerLabel(stash.name, lang)}</span>
              {pagesOf(stash).map(({ page, count }) => {
                const on = picked(stash.mode).includes(page);
                return (
                  <button
                    key={page}
                    className={`gothic-btn gothic-btn-small ${on ? "" : "gothic-btn-secondary"}`}
                    aria-pressed={on}
                    onClick={() => toggle(stash.mode, page)}
                  >
                    {t("sharedPage", lang, page)} · {count}
                  </button>
                );
              })}
            </div>
          ))}
          {!chosen && stashes.length > 0 && <p className="text-sm">{t("pickInboxPages", lang)}</p>}
        </section>

        {chosen && finds.length === 0 && <p className="gothic-text-muted">{t("inboxEmpty", lang)}</p>}
        {KINDS.map((kind) => {
          const list = finds.filter((f) => f.verdict.kind === kind);
          if (!list.length) return null;
          return (
            <section key={kind}>
              <div className="section-head">
                <h2>{t(`find_${kind}`, lang)}</h2>
                <span className="gothic-text-muted">{list.length}</span>
              </div>
              <p className="text-sm gothic-text-muted mb-1">{(VARIES[kind] ?? [`findWhy_${kind}`]).map((k) => t(k, lang, {})).join("")}</p>
              <div className="rows">
                {list.map(({ r, verdict }, i) => {
                  const show = (e) => setTip({ item: r, rect: e.currentTarget.getBoundingClientRect() });
                  return (
                    <button
                      type="button"
                      key={i}
                      className="flex gap-4 py-2 w-full text-left items-center"
                      {...tipHandlers(show, setTip)}
                      onClick={show}
                    >
                      <img src={imageOf(r)} alt="" loading="lazy" className="w-10 h-10 object-contain shrink-0" style={r.ethereal ? { opacity: 0.6 } : undefined} />
                      <span className="min-w-0 flex-1">
                        <span className="flex justify-between gap-4">
                          <span style={{ color: colorOf(r) }}>
                            {labelOf(r.key, lang)}
                            {r.ethereal && <span className="gothic-text-muted"> · {t("ethereal", lang)}</span>}
                          </span>
                          {!onePage && <span className="text-sm gothic-text-muted shrink-0">{placeLabel(r.place, lang)}</span>}
                        </span>
                        {VARIES[kind] && <span className="block text-sm gothic-text-muted">{t(`findRow_${kind}`, lang, verdict)}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {finds.length > 0 && (
          <p className="text-sm">
            <Link to="/organize" className="gothic-text-gold">
              {t("newItemsOrganize", lang)}
            </Link>
          </p>
        )}
      </div>
      {tip && <Tooltip tip={tip} lang={lang} />}
    </>
  );
}
