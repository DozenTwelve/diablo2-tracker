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
const STATUS_TEXT = { missing: "applyMissing", noMerc: "applyNoMerc", mercUnknown: "applyMercUnknown", otherMerc: "applyOtherMerc", hand: "applyHand", quest: "applyQuest" };
// A piece's own key in a list: its spot and id
const pieceKey = (p) => `${p.place}:${p.slot ?? `${p.x},${p.y}`}:${p.id}`;
// Saved before the mercenary's kind was kept: putting it on skips the mercenary's pieces until it is saved again
const mercUnknown = (l) => l.mercClass == null && l.pieces.some((p) => p.place === "merc");

// A piece's spot in its loadout: "Helm", "Mercenary Helm", "Charms"
const spotOf = (p, lang) =>
  p.place === "inventory" ? t("slot_charm", lang) : `${p.place === "merc" ? `${t("merc", lang)} ` : ""}${t(`slot_${SLOT_OF[p.slot]}`, lang)}`;

function whereText(w, lang) {
  if (w.kind === "on" || w.kind === "missing") return t(`where_${w.kind}`, lang);
  if (w.kind === "corpse" || w.kind === "golem") return t(`where_${w.kind}`, lang, w.owner === undefined ? "" : ownerLabel(w.owner, lang));
  return w.kind === "self" ? t("where_self", lang, placeLabel(w.place, lang)) : t(`where_${w.kind}`, lang, ownerLabel(w.owner, lang), placeLabel(w.place, lang));
}

// Rows grouped by what they share, the shared part said once as a small heading: [{ key, head, className, open, rows }]
function groupsOf(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const g = keyOf(row);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, rows: [] });
    groups.get(g.key).rows.push(row);
  }
  return [...groups.values()];
}

// One piece: icon, name and its spot
const PieceRow = ({ piece, lang, children }) => (
  <li className="flex items-center gap-2">
    {children}
    <Icon piece={piece} />
    <span className="min-w-0">
      <Name piece={piece} lang={lang} />
      <span className="gothic-text-muted"> · {spotOf(piece, lang)}</span>
    </span>
  </li>
);

// A group: its heading (with the count) once, then its rows; folded when nothing needs doing about them
function Group({ head, className, open, count, children }) {
  return (
    <details open={open} className="text-sm">
      <summary className="cursor-pointer">
        <span className={className}>{head}</span> <span className="gothic-text-muted">({count})</span>
      </summary>
      <ul className="grid md:grid-cols-2 gap-x-8 gap-y-1 pl-4 pt-1">{children}</ul>
    </details>
  );
}

// A loadout's pieces, equipment first, grouped by where they are now: the ones missing or on a corpse first,
// the ones already on (folded) last
function Pieces({ loadout, saveData, roles, lang }) {
  const pieces = loadout.pieces.toSorted((a, b) => PLACES.indexOf(a.place) - PLACES.indexOf(b.place)).map((p) => ({ p, w: whereIs(p, loadout.character, saveData, roles) }));
  const rank = (w) => (w.kind === "missing" || w.kind === "corpse" || w.kind === "golem" ? 0 : w.kind === "on" ? 2 : 1);
  const groups = groupsOf(
    pieces.toSorted((a, b) => rank(a.w) - rank(b.w)),
    ({ w }) => ({ key: whereText(w, lang), open: w.kind !== "on", className: w.kind === "on" ? "gothic-text-gold" : rank(w) === 0 ? "text-red-400" : "" }),
  );
  return (
    <div className="space-y-1">
      {groups.map((g) => (
        <Group key={g.key} head={g.key} className={g.className} open={g.open} count={g.rows.length}>
          {g.rows.map(({ p }) => (
            <PieceRow key={pieceKey(p)} piece={p} lang={lang} />
          ))}
        </Group>
      ))}
    </div>
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
// children: the pieces list, hidden while the preview shows them instead
function Apply({ loadout, saveData, roles, keep, onWritten, lang, children }) {
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
    return place === "corpse" || place === "golem" ? place : name === loadout.character ? "self" : o?.cls && roleOf(o, roles) === "main" ? "main" : "mule";
  };
  const from = (f) => whereText({ kind: kindOf(f.owner, f.place), ...f }, lang);
  const report = state?.plan?.report;
  const lines = report?.pieces.filter((p) => p.status !== "on") ?? [];
  const on = (report?.pieces.length ?? 0) - lines.length;
  const twins = report?.pieces.filter((p) => p.twins) ?? [];
  // The mules organizing writes again besides putting the loadout on
  const muleNames = new Set((report?.organize?.muleNames ?? []).map((n) => n.toLowerCase()));
  // A save may be written twice (a mule giving a piece and receiving what comes off): each name once
  const fileNames = [...new Set(state?.plan?.files.map((f) => f.name.slice(0, -4)) ?? [])];
  const muleFiles = fileNames.filter((n) => muleNames.has(n.toLowerCase()));
  const tick = (id, ticked) => setState(plan({ ...state, confirm: null, message: undefined, leave: ticked ? state.leave.filter((x) => x !== id) : [...state.leave, id] }));
  const error = state?.error;
  const sep = t("listSeparator", lang);
  return (
    <div className="space-y-2">
      {!state?.files ? (
        <>
          {children}
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
              {error.blocked
                ? t("loadoutBlocked", lang, labelOf(error.blocked.key, lang), error.blocked.x + 1, error.blocked.y + 1)
                : error.organize
                  ? t("applyCantOrganize", lang, error.organize)
                  : t("notWritten", lang, error.message ?? error)}
            </p>
          )}
          {report && (
            <>
              {groupsOf(lines, ({ status, from: f }) => {
                const key =
                  status === "take" || status === "left"
                    ? from(f)
                    : status === "corpse" || status === "golem"
                      ? t(status === "corpse" ? "applyCorpse" : "applyGolem", lang, ownerLabel(f.owner, lang))
                      : t(STATUS_TEXT[status], lang);
                return { key, className: status === "take" || status === "left" ? "" : "gothic-text-muted" };
              }).map((g) => (
                <Group key={g.key} head={g.key} className={g.className} open count={g.rows.length}>
                  {g.rows.map(({ piece, status, from: f }) => (
                    <PieceRow key={pieceKey(piece)} piece={piece} lang={lang}>
                      {/* Ticked: taken. Unticked: left where it is; only from somewhere else than this character */}
                      {(status === "take" || status === "left") && f.owner !== loadout.character ? (
                        <input type="checkbox" checked={status === "take"} disabled={state.busy} onChange={(e) => tick(piece.id, e.target.checked)} aria-label={labelOf(piece.key, lang)} />
                      ) : (
                        <span className="w-[13px] shrink-0" />
                      )}
                    </PieceRow>
                  ))}
                </Group>
              ))}
              {lines.some((l) => l.status === "take" || l.status === "left") && <p className="text-sm gothic-text-muted">{t("applyTickAbout", lang)}</p>}
              {on > 0 && <p className="text-sm gothic-text-muted">{t("applyOnCount", lang, on)}</p>}
              {twins.length > 0 && (
                <details className="text-sm gothic-text-muted">
                  <summary className="cursor-pointer">
                    <span className="text-xs px-1 rounded-sm border border-gray-600">{t("applyTwinsTag", lang)}</span> {twins.map((p) => labelOf(p.piece.key, lang)).join(sep)}
                  </summary>
                  <p className="mt-1 max-w-prose">{t("applyTwinsAbout", lang)}</p>
                </details>
              )}
              {report.off.length > 0 && (
                <>
                  <p className="text-sm">{t("applyOff", lang)}</p>
                  <ul className="text-sm space-y-1 pl-4">
                    {groupsOf(report.off, ({ to }) => ({ key: to?.mule ?? "?" })).map((g) => (
                      <li key={g.key}>
                        <span className="gothic-text-gold">{g.key}</span>
                        {t("colon", lang)}
                        {groupsOf(g.rows, ({ key }) => ({ key }))
                          .map((k) => `${labelOf(k.key, lang)}${k.rows.length > 1 ? ` ×${k.rows.length}` : ""}`)
                          .join(sep)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {muleFiles.length > 0 && <p className="text-sm">{t("applyReorganizes", lang, muleFiles.length)}</p>}
              {fileNames.length > 0 ? (
                <details className="text-sm gothic-text-muted">
                  <summary className="cursor-pointer">{t("applyFiles", lang, fileNames.length)}</summary>
                  <p className="mt-1 break-words">{fileNames.join(sep)}</p>
                </details>
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
                <ConfirmButton warn={t("applyConfirmWarn", lang, fileNames.length)} at={state.confirm} busy={state.busy} onConfirm={write} onCancel={() => setState({ ...state, confirm: null })} lang={lang}>
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
  // What the character wears now, from the saves as they are now (the game may have saved since this page read
  // them), as putting one on reads them
  const wornNow = async () => {
    const now = await parseSaveFiles(await deckSaveFiles());
    const bad = [...now.errors, ...now.damaged].filter((e) => e.startsWith(`${owner.name}.d2s`));
    if (bad.length || !now.owners.some((o) => o.name === owner.name)) throw new Error(bad.join(", ") || `no character ${owner.name}`);
    return loadoutOf(now, owner.name);
  };
  const add = async () => {
    setState({ busy: true });
    try {
      const loadout = { id: crypto.randomUUID(), name: name.trim(), ...(await wornNow()) };
      if (await store({ ...doc, loadouts: [...doc.loadouts, loadout] })) setName("");
    } catch (e) {
      setState({ error: e.message ?? String(e) });
    }
  };
  // Saved again under its own id and name, from what the character and its mercenary wear now
  const resave = async (l) => {
    setState({ busy: true });
    try {
      const worn = await wornNow();
      await store({ ...doc, loadouts: doc.loadouts.map((x) => (x.id === l.id ? { id: l.id, name: l.name, ...worn } : x)) });
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
          {mercUnknown(l) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-sm text-red-400 max-w-prose">{t("loadoutResaveAbout", lang)}</p>
              <button className="gothic-btn gothic-btn-small" disabled={state.busy} onClick={() => resave(l)}>
                {t("loadoutResave", lang)}
              </button>
            </div>
          )}
          <Apply loadout={l} saveData={saveData} roles={roles} keep={[...keep, ...loadoutIds(doc)]} onWritten={onWritten} lang={lang}>
            <Pieces loadout={l} saveData={saveData} roles={roles} lang={lang} />
          </Apply>
        </div>
      ))}
    </section>
  );
}
