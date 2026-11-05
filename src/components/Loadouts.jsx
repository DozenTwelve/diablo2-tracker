import { useEffect, useState } from "react";
import { imageOf, labelOf } from "../lib/gameData";
import { SLOT_OF } from "../lib/builds";
import { deckLoadouts, deckSaveFiles, hashes, saveDeckLoadouts, toBase64, writeDeck } from "../lib/deck";
import { ownerLabel, placeLabel, roleOf } from "../lib/inventory";
import { t } from "../lib/i18n";
import { applyLoadoutFiles, loadoutIds, loadoutOf, whereIs } from "../lib/loadouts";
import { byMuleName, sameBytes } from "../lib/organize";
import { loadParser, parseSaveFiles } from "../lib/parseSaves";
import { Link } from "../lib/router";
import { useStoredState } from "../lib/useStoredState";
import { ConfirmButton } from "./OrganizeView";
import { colorOf } from "./StashGrid";

const PLACES = ["equipped", "merc", "inventory"];

// A piece's spot in its loadout: "Helm", "Mercenary Helm", "Charms"
const spotOf = (p, lang) =>
  p.place === "inventory" ? t("slot_charm", lang) : `${p.place === "merc" ? `${t("merc", lang)} ` : ""}${t(`slot_${SLOT_OF[p.slot]}`, lang)}`;

function whereText(w, lang) {
  if (w.kind === "on" || w.kind === "missing") return t(`where_${w.kind}`, lang);
  if (w.kind === "corpse") return t("where_corpse", lang, w.owner === undefined ? "" : ownerLabel(w.owner, lang));
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
            <Icon piece={p} />
            <span className="min-w-0">
              <Name piece={p} lang={lang} />
              <span className="gothic-text-muted"> · {spotOf(p, lang)} · </span>
              <span className={w.kind === "on" ? "gothic-text-gold" : w.kind === "missing" || w.kind === "corpse" ? "text-red-400" : ""}>{whereText(w, lang)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const Icon = ({ piece }) => <img src={imageOf(piece)} alt="" loading="lazy" className="w-6 h-6 object-contain shrink-0" />;
const Name = ({ piece, lang }) => <span style={{ color: colorOf({ key: piece.key, quality: piece.id.split(":").at(-1) }) }}>{labelOf(piece.key, lang)}</span>;

const readFiles = async () => {
  const [list, wasm] = await Promise.all([deckSaveFiles(), loadParser()]);
  return { wasm, files: await Promise.all(list.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))) };
};

// Putting a loadout on (applyLoadoutFiles): a preview from the saves as they are now, where the player may untick a
// piece to leave it where it is, then a confirmed write through the plugin, as organizing writes (backed up first,
// only if the saves are still the ones previewed, never while D2R runs). keep: the player's keep list and every saved
// loadout's pieces: organizing the mules again never puts one in TRASH.
function Apply({ loadout, saveData, roles, keep, onWritten, lang }) {
  const [state, setState] = useState(null); // { files, wasm, leave, plan?, error?, message?, confirm?, busy?, interrupted?, backup? }
  const owner = saveData.owners.find((o) => o.name === loadout.character);
  const mules = saveData.owners.filter((o) => o.cls && o.mode === owner.mode && roleOf(o, roles) === "mule").map((o) => o.name);
  const plan = (s) => {
    try {
      return { ...s, plan: applyLoadoutFiles(s.files, s.wasm, loadout, { mules, keep, leave: s.leave }), error: undefined };
    } catch (e) {
      return { ...s, plan: undefined, error: e };
    }
  };
  // Read again (after a write, or the saves changed) and preview again, saying why
  const again = async (s, message) => {
    setState(plan({ ...s, ...(await readFiles()), confirm: null, busy: false, message }));
    onWritten();
  };
  const preview = async () => {
    setState({ busy: true, leave: [] });
    try {
      setState(plan({ leave: [], ...(await readFiles()) }));
    } catch (e) {
      setState({ leave: [], message: t("readFailed", lang, e.message ?? e) });
    }
  };
  const write = async () => {
    setState({ ...state, busy: true });
    try {
      // The game may have saved since the preview (played in between): writing would undo that
      const now = await readFiles();
      const same = now.files.length === state.files.length && now.files.every((f) => state.files.some((o) => o.name === f.name && sameBytes(o.bytes, f.bytes)));
      if (!same) return await again(state, t("savesChanged", lang));
      const done = applyLoadoutFiles(state.files, state.wasm, loadout, { mules, keep, leave: state.leave });
      const response = await writeDeck({
        files: done.files.map((f) => ({ name: f.name, template: f.template, data: toBase64(f.bytes) })),
        delete: [],
        mules: (done.report.organize?.muleNames ?? []).toSorted(byMuleName), // put below the others in D2R's list
        expect: await hashes(state.files),
        reason: "loadout",
      });
      const result = await response.json();
      if (result.running) setState({ ...state, busy: false, confirm: null, message: t("gameRunning", lang) });
      else if (result.interrupted) setState({ ...state, busy: false, confirm: null, interrupted: result.interrupted });
      else if (result.changed) await again(state, t("savesChanged", lang));
      else if (!response.ok) setState({ ...state, busy: false, confirm: null, message: t("writeFailed", lang, result.error) });
      else {
        setState({ backup: result.backup });
        onWritten();
      }
    } catch (e) {
      setState({ ...state, busy: false, confirm: null, message: t("writeFailed", lang, e.message ?? e) });
    }
  };

  const kindOf = (name, place) => {
    const o = saveData.owners.find((o) => o.name === name);
    return place === "corpse" ? "corpse" : name === loadout.character ? "self" : o?.cls && roleOf(o, roles) === "main" ? "main" : "mule";
  };
  const from = (f) => whereText({ kind: kindOf(f.owner, f.place), ...f }, lang);
  const report = state?.plan?.report;
  const lines = report?.pieces.filter((p) => p.status !== "on") ?? [];
  const on = (report?.pieces.length ?? 0) - lines.length;
  const twins = report?.pieces.filter((p) => p.twins) ?? [];
  // The mules organizing writes again besides putting the loadout on
  const muleNames = new Set((report?.organize?.muleNames ?? []).map((n) => n.toLowerCase()));
  const muleFiles = state?.plan?.files.filter((f) => muleNames.has(f.name.slice(0, -4).toLowerCase())).map((f) => f.name.slice(0, -4)) ?? [];
  const tick = (id, ticked) => setState(plan({ ...state, confirm: null, message: undefined, leave: ticked ? state.leave.filter((x) => x !== id) : [...state.leave, id] }));
  const error = state?.error;
  return (
    <div className="space-y-2">
      {!state?.files ? (
        <>
          <button className="gothic-btn gothic-btn-small" disabled={state?.busy} onClick={preview}>
            {t("applyLoadout", lang)}
          </button>
          {state?.backup && <p className="gothic-text-gold break-all">{t("applied", lang, state.backup)}</p>}
          {state?.message && <p className="text-red-400">{state.message}</p>}
        </>
      ) : (
        <div className="space-y-2 pt-2" style={{ borderTop: "1px solid var(--color-border-metal)" }}>
          {error && (
            <p className="text-red-400">
              {error.blocked ? t("loadoutBlocked", lang, labelOf(error.blocked.key, lang), error.blocked.x + 1, error.blocked.y + 1) : t("notWritten", lang, error.message ?? error)}
            </p>
          )}
          {report && (
            <>
              <ul className="text-sm space-y-1">
                {lines.map(({ piece, status, from: f }) => (
                  <li key={piece.id} className="flex items-center gap-2">
                    {/* Ticked: taken. Unticked: left where it is; only from somewhere else than this character */}
                    {(status === "take" || status === "left") && f.owner !== loadout.character ? (
                      <input type="checkbox" checked={status === "take"} disabled={state.busy} onChange={(e) => tick(piece.id, e.target.checked)} aria-label={labelOf(piece.key, lang)} />
                    ) : (
                      <span className="w-[13px] shrink-0" />
                    )}
                    <Icon piece={piece} />
                    <span className="min-w-0">
                      <Name piece={piece} lang={lang} />
                      <span className="gothic-text-muted"> · {spotOf(piece, lang)} · </span>
                      <span className={status === "take" ? "" : "gothic-text-muted"}>
                        {status === "take"
                          ? t("applyFrom", lang, from(f))
                          : status === "left"
                            ? t("applyLeft", lang, from(f))
                            : status === "corpse"
                              ? t("applyCorpse", lang, ownerLabel(f.owner, lang))
                              : t({ missing: "applyMissing", noMerc: "applyNoMerc", otherMerc: "applyOtherMerc", hand: "applyHand", quest: "applyQuest" }[status], lang)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {on > 0 && <p className="text-sm gothic-text-muted">{t("applyOnCount", lang, on)}</p>}
              {twins.length > 0 && (
                <p className="text-sm gothic-text-muted">{t("applyTwins", lang, twins.map((p) => labelOf(p.piece.key, lang)).join(t("listSeparator", lang)))}</p>
              )}
              {report.off.length > 0 && (
                <>
                  <p className="text-sm">{t("applyOff", lang)}</p>
                  <ul className="text-sm space-y-1 pl-4">
                    {report.off.map(({ key, to }, i) => (
                      <li key={i}>
                        {labelOf(key, lang)} <span className="gothic-text-muted">→ {to?.mule}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {muleFiles.length > 0 && <p className="text-sm break-words">{t("applyReorganizes", lang, muleFiles.length, muleFiles.join(t("listSeparator", lang)))}</p>}
              {state.plan.files.length > 0 ? (
                <p className="text-sm gothic-text-muted break-words">
                  {t("applyFiles", lang, state.plan.files.map((f) => f.name.slice(0, -4)).join(t("listSeparator", lang)))}
                </p>
              ) : (
                <p className="text-sm gothic-text-gold">{t("applyNothing", lang)}</p>
              )}
            </>
          )}
          {state.message && <p className="text-red-400">{state.message}</p>}
          {state.interrupted && (
            <p className="text-red-400">
              {t("applyInterrupted", lang)}{" "}
              <Link to="/organize" className="gothic-text-gold">
                {t("organize", lang)} →
              </Link>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {state.plan?.files.length > 0 &&
              (state.confirm ? (
                <ConfirmButton warn={t("applyConfirmWarn", lang, state.plan.files.length)} at={state.confirm} busy={state.busy} onConfirm={write} onCancel={() => setState({ ...state, confirm: null })} lang={lang}>
                  {t(state.busy ? "writing" : "confirmApply", lang)}
                </ConfirmButton>
              ) : (
                <button className="gothic-btn gothic-btn-small" onClick={() => setState({ ...state, confirm: Date.now() })}>
                  {t("applyLoadout", lang)}
                </button>
              ))}
            {!state.confirm && (
              <button className="text-sm gothic-text-muted" disabled={state.busy} onClick={() => setState(null)}>
                {t("cancel", lang)}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// A main character's loadouts on its page (the Deck only: the plugin keeps them): save what it wears now under a
// name, rename, delete, see where every piece is, and put one on.
export default function Loadouts({ owner, saveData, keep, onWritten, lang }) {
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
  // From the saves as they are now (the game may have saved since this page read them), as putting one on reads them
  const add = async () => {
    setState({ busy: true });
    try {
      const now = await parseSaveFiles(await deckSaveFiles());
      const bad = [...now.errors, ...now.damaged].filter((e) => e.startsWith(`${owner.name}.d2s`));
      if (bad.length || !now.owners.some((o) => o.name === owner.name)) throw new Error(bad.join(", ") || `no character ${owner.name}`);
      const loadout = { id: crypto.randomUUID(), name: name.trim(), ...loadoutOf(now, owner.name) };
      if (await store({ ...doc, loadouts: [...doc.loadouts, loadout] })) setName("");
    } catch (e) {
      setState({ error: e.message ?? String(e) });
    }
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
          <Apply loadout={l} saveData={saveData} roles={roles} keep={[...keep, ...loadoutIds(doc)]} onWritten={onWritten} lang={lang} />
        </div>
      ))}
    </section>
  );
}
