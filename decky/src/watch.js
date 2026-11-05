// Pickup alerts: while D2R runs, the game saves a few seconds after an item is picked up. Every 2 s ask the backend
// which saves changed (a stat of each, nothing parsed); once a change has settled, parse the changed saves with the
// web app's code and toast each new unique, set item or rune (src/lib/pickups.js).
// The web page's main/mule choices and inbox pages live in its own localStorage (another origin), out of reach
// here: roles are the defaults (roleOf: level 1 characters are mules).
import { callable, toaster } from "@decky/api";
import { parseSaveFiles } from "../../src/lib/parseSaves.js";
import { pickupToasts, takeChange } from "../../src/lib/pickups.js";
import { t } from "../../src/lib/i18n.js";
import init from "../../wasm/pkg/d2_parser.js";
import wasmBase64 from "../../wasm/pkg/d2_parser_bg.wasm";

const saveChanges = callable("save_changes");
export const lang = /^zh-(cn|sg|hans)/i.test(navigator.language) ? "zh" : navigator.language.startsWith("zh") ? "zh_tw" : navigator.language.startsWith("ko") ? "ko" : "en";
const MANY = 5; // more pickups than this in one change: one toast that says how many

let timer = null;
let gen = 0; // bumped by start and stop: a look still in flight from before drops what it found
let files = null; // name -> { mtime, data?: base64 not parsed yet, parsed?: saveData of that file }; null before the first look
let pending = null; // a change seen but maybe not finished: { changed: Map(name -> { mtime, data }), gone: Set }
let wasmReady = null;
const tries = new Map(); // name -> { mtime, n }: changed saves that did not read yet (takeChange)
let last = null; // { files, ms, wasm? }: the last check that parsed something, for the panel
const listeners = new Set();

export const lastCheck = () => last;
export const onCheck = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function startWatching() {
  if (timer) return;
  gen++;
  files = null; // a fresh, silent first look: what changed while not watching is not a pickup
  pending = null;
  tries.clear();
  timer = setInterval(tick, 2000);
  tick();
}

export function stopWatching() {
  clearInterval(timer);
  timer = null;
  gen++;
}

function bytesOf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); // Uint8Array.from with a callback: 20× slower
  return bytes;
}

function loadWasm() {
  wasmReady ??= init({ module_or_path: bytesOf(wasmBase64) }).catch((e) => {
    wasmReady = null; // tried again next time
    throw e;
  });
  return wasmReady;
}

let parsedNow = 0;
async function parse(name, data) {
  parsedNow++;
  return parseSaveFiles([new File([bytesOf(data)], name)]);
}

async function parsedOf(name, file) {
  if (!file.parsed) {
    file.parsed = await parse(name, file.data);
    file.data = undefined;
  }
  return file.parsed;
}

let running = false;
let lastError = null; // logged once, not every 2 s
async function tick() {
  if (running) return; // a slow parse: skip a tick rather than overlap
  running = true;
  try {
    await look(gen);
    lastError = null;
  } catch (e) {
    if (String(e) !== lastError) console.error("D2R pickup alerts", e);
    lastError = String(e);
  } finally {
    running = false;
  }
}

async function look(g) {
  const known = Object.fromEntries([...(files ?? [])].map(([name, f]) => [name, f.mtime]));
  for (const [name, f] of pending?.changed ?? []) known[name] = f.mtime;
  for (const name of pending?.gone ?? []) delete known[name];
  const { changed, gone, busy } = await saveChanges(known);
  if (g !== gen) return;
  if (!files || busy) {
    // The first look, or the collection page is open (organizing or restoring there): take the saves as they are
    files ??= new Map();
    for (const name of [...(pending?.gone ?? []), ...gone]) files.delete(name);
    for (const [name, f] of pending?.changed ?? []) files.set(name, { mtime: f.mtime, data: f.data });
    for (const f of changed) files.set(f.name, { mtime: f.mtime, data: f.data });
    pending = null;
    return;
  }
  if (changed.length || gone.length) {
    // The game may write the character and then the stash: wait for a look that finds nothing new
    pending ??= { changed: new Map(), gone: new Set() };
    for (const f of changed) pending.changed.set(f.name, f), pending.gone.delete(f.name);
    for (const name of gone) pending.gone.add(name), pending.changed.delete(name);
    return;
  }
  if (pending) await settle(g);
}

async function settle(g) {
  const change = pending;
  pending = null;
  const start = performance.now();
  parsedNow = 0;
  let wasmMs;
  if (!wasmReady) {
    await loadWasm();
    if (g !== gen) return;
    wasmMs = Math.round(performance.now() - start);
  }
  const before = new Map(await Promise.all([...files].map(async ([name, f]) => [name, await parsedOf(name, f)])));
  const changed = new Map(await Promise.all([...change.changed].map(async ([name, f]) => [name, { mtime: f.mtime, data: await parse(name, f.data) }])));
  if (g !== gen) return;
  const { taken, wait, picks, saves } = takeChange(before, changed, change.gone, tries);
  // waiting: files stays as it was, so the next look reports the whole change again
  if (!wait) for (const name of change.gone) files.delete(name);
  for (const name of taken) files.set(name, { mtime: changed.get(name).mtime, parsed: changed.get(name).data });
  last = { files: parsedNow, ms: Math.round(performance.now() - start), wasm: wasmMs };
  listeners.forEach((fn) => fn(last));
  if (picks.length > MANY) return toaster.toast({ title: "D2R", body: t("pickupMany", lang, picks.length) });
  for (const { title, body } of pickupToasts(picks, saves, lang)) toaster.toast({ title, body });
}
