import { useEffect, useState } from "react";
import { imageOf, labelOf } from "../lib/gameData";
import { SLOT_OF } from "../lib/builds";
import { deckLoadouts, saveDeckLoadouts } from "../lib/deck";
import { ownerLabel, placeLabel } from "../lib/inventory";
import { t } from "../lib/i18n";
import { loadoutOf, whereIs } from "../lib/loadouts";
import { useStoredState } from "../lib/useStoredState";
import { ConfirmButton } from "./OrganizeView";
import { colorOf } from "./StashGrid";

const PLACES = ["equipped", "merc", "inventory"];

// A piece's spot in its loadout: "Helm", "Mercenary Helm", "Charms"
const spotOf = (p, lang) =>
  p.place === "inventory" ? t("slot_charm", lang) : `${p.place === "merc" ? `${t("merc", lang)} ` : ""}${t(`slot_${SLOT_OF[p.slot]}`, lang)}`;

function whereText(w, lang) {
  if (w.kind === "on" || w.kind === "missing") return t(`where_${w.kind}`, lang);
  return w.kind === "self" ? t("where_self", lang, placeLabel(w.place, lang)) : t(`where_${w.kind}`, lang, ownerLabel(w.owner, lang), placeLabel(w.place, lang));
}

// A loadout's pieces, equipment first, each with where it is now
function Pieces({ loadout, saveData, roles, lang }) {
  const pieces = loadout.pieces.toSorted((a, b) => PLACES.indexOf(a.place) - PLACES.indexOf(b.place));
  return (
    <ul className="grid md:grid-cols-2 gap-x-8 gap-y-1 text-sm">
      {pieces.map((p) => {
        const w = whereIs(p, loadout.character, saveData, roles);
        return (
          <li key={p.id} className="flex items-center gap-2">
            <img src={imageOf(p)} alt="" loading="lazy" className="w-6 h-6 object-contain shrink-0" />
            <span className="min-w-0">
              <span style={{ color: colorOf({ key: p.key, quality: p.id.split(":").at(-1) }) }}>{labelOf(p.key, lang)}</span>
              <span className="gothic-text-muted"> · {spotOf(p, lang)} · </span>
              <span className={w.kind === "on" ? "gothic-text-gold" : w.kind === "missing" ? "text-red-400" : ""}>{whereText(w, lang)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// A main character's loadouts on its page (the Deck only: the plugin keeps them): save what it wears now under a
// name, rename, delete, and see where every piece is.
export default function Loadouts({ owner, saveData, lang }) {
  const [roles] = useStoredState("roles", {});
  const [doc, setDoc] = useState(null); // { loadouts } as the plugin keeps it
  const [name, setName] = useState("");
  const [state, setState] = useState({}); // { error, busy, confirm: { id, at }, renaming: { id, name } }
  useEffect(() => {
    deckLoadouts().then(setDoc, (e) => setState({ error: e.message ?? String(e) }));
  }, []);

  // The whole document, as it should be now; shown only once kept
  const store = async (next) => {
    setState({ busy: true });
    try {
      const response = await saveDeckLoadouts(next);
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? response.status);
      setDoc(next);
      setState({});
      return true;
    } catch (e) {
      setState({ error: e.message ?? String(e) });
    }
  };
  const update = (id, change) => store({ ...doc, loadouts: doc.loadouts.flatMap((l) => (l.id === id ? change(l) : [l])) });
  const add = async () => {
    const loadout = { id: crypto.randomUUID(), name: name.trim(), ...loadoutOf(saveData, owner.name) };
    if (await store({ ...doc, loadouts: [...doc.loadouts, loadout] })) setName("");
  };
  const mine = doc?.loadouts.filter((l) => l.character === owner.name) ?? [];

  return (
    <section className="max-w-4xl space-y-4">
      <div className="section-head">
        <h2>{t("loadouts", lang)}</h2>
        <span className="section-count">{mine.length}</span>
      </div>
      <p className="text-sm gothic-text-muted">{t("loadoutsAbout", lang)}</p>
      {state.error && <p className="text-red-400">{t("loadoutsFailed", lang, state.error)}</p>}
      {doc && (
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            className="gothic-input text-sm"
            style={{ width: "14rem", padding: "0.4rem 0.7rem" }}
            maxLength={40}
            placeholder={t("loadoutName", lang)}
            aria-label={t("loadoutName", lang)}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="gothic-btn gothic-btn-small" disabled={!name.trim() || state.busy}>
            {t("saveLoadout", lang)}
          </button>
        </form>
      )}
      {doc && !mine.length && <p className="text-sm gothic-text-muted">{t("loadoutsNone", lang)}</p>}
      {mine.map((l) => (
        <div key={l.id} className="panel space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {state.renaming?.id === l.id ? (
              <form
                className="flex flex-wrap items-center gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  update(l.id, (x) => [{ ...x, name: state.renaming.name.trim() }]);
                }}
              >
                <input
                  className="gothic-input text-sm"
                  style={{ width: "14rem", padding: "0.4rem 0.7rem" }}
                  maxLength={40}
                  aria-label={t("loadoutName", lang)}
                  autoFocus
                  value={state.renaming.name}
                  onChange={(e) => setState({ ...state, renaming: { id: l.id, name: e.target.value } })}
                />
                <button className="gothic-btn gothic-btn-small" disabled={!state.renaming.name.trim() || state.busy}>
                  {t("save", lang)}
                </button>
                <button type="button" className="text-sm gothic-text-muted" onClick={() => setState({})}>
                  {t("cancel", lang)}
                </button>
              </form>
            ) : (
              <>
                <h3 className="gothic-text-gold text-lg">{l.name}</h3>
                <span className="text-sm gothic-text-muted">{t("itemCount", lang, l.pieces.length)}</span>
                <button className="text-sm gothic-text-muted" onClick={() => setState({ renaming: { id: l.id, name: l.name } })}>
                  {t("rename", lang)}
                </button>
                {state.confirm?.id === l.id ? (
                  <ConfirmButton
                    warn={t("deleteLoadoutWarn", lang)}
                    at={state.confirm.at}
                    busy={state.busy}
                    onConfirm={() => update(l.id, () => [])}
                    onCancel={() => setState({})}
                    lang={lang}
                  >
                    {t("confirmDeleteBackup", lang)}
                  </ConfirmButton>
                ) : (
                  <button className="text-sm gothic-text-muted" onClick={() => setState({ confirm: { id: l.id, at: Date.now() } })}>
                    {t("deleteBackup", lang)}
                  </button>
                )}
              </>
            )}
          </div>
          <Pieces loadout={l} saveData={saveData} roles={roles} lang={lang} />
        </div>
      ))}
    </section>
  );
}
