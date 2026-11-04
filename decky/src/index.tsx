// Quick access panel: open the tracker in Steam's browser (the server runs until the page is left, by its close
// button, B or the Steam button, or "Stop"), and pull the item icons out of the game files once.
import { ButtonItem, Navigation, PanelSection, PanelSectionRow, ToggleField, staticClasses } from "@decky/ui";
import { addEventListener, callable, definePlugin, removeEventListener, toaster } from "@decky/api";
import { useEffect, useState } from "react";
import { lastCheck, onCheck, startWatching, stopWatching, type Check } from "./watch";

type Status = { saves: number; game: boolean; icons: boolean; running: boolean; extracting: boolean };
const status = callable<[], Status>("status");
const start = callable<[], string>("start");
const stop = callable<[], void>("stop");
const extractIcons = callable<[], { count?: number; error?: string }>("extract_icons");

const zh = navigator.language.startsWith("zh");
const TEXT = {
  open: zh ? "打開收藏" : "Open collection",
  stop: zh ? "停止服務（收藏頁不再能打開）" : "Stop the server (the collection page goes away)",
  saves: (n: number) => (zh ? `找到 ${n} 個存檔` : `${n} saves found`),
  noSaves: zh ? "找不到存檔，先在這台 Deck 上玩一次 D2R 單機角色" : "No saves found; play an offline D2R character on this Deck first",
  extract: zh ? "從遊戲檔案提取物品圖標" : "Get item icons from the game files",
  again: zh ? "重新提取物品圖標（遊戲更新後）" : "Get item icons again (after a game update)",
  extracting: zh ? "提取中，約一分鐘…" : "Getting icons, about a minute…",
  noGame: zh ? "找不到 D2R 遊戲檔案，無法提取圖標" : "D2R game files not found, can't get icons",
  done: (n: number) => (zh ? `已提取 ${n} 個圖標` : `${n} icons ready`),
  failed: zh ? "提取圖標失敗" : "Getting icons failed",
  openFailed: zh ? "打不開收藏" : "Can't open the collection",
  alerts: zh ? "撿到物品時提醒" : "Alert on pickups",
  alertsAbout: zh ? "撿到暗金、套裝或符文時，說是不是新收藏" : "Says whether a unique, set item or rune you pick up is new",
  checked: (c: Check) =>
    (zh ? `上次檢查：解析 ${c.files} 個檔案 ${c.ms} ms` : `Last check: parsed ${c.files} files in ${c.ms} ms`) +
    (c.wasm != null ? (zh ? `（含載入解析器 ${c.wasm} ms）` : ` (${c.wasm} ms loading the parser)`) : ""),
};

// On unless turned off; kept in the Steam UI's own storage
const ALERTS = "d2r-tracker-pickup-alerts";
const alertsOn = () => {
  try {
    return localStorage.getItem(ALERTS) !== "off";
  } catch {
    return true;
  }
};
const toast = (body: string) => toaster.toast({ title: "D2R", body });

function Content() {
  const [info, setInfo] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [alerts, setAlerts] = useState(alertsOn);
  const [check, setCheck] = useState(lastCheck);
  useEffect(() => {
    status().then(setInfo, (e) => toast(String(e)));
    return onCheck(setCheck);
  }, []);

  const extract = async () => {
    setBusy(true);
    try {
      const result = await extractIcons();
      toast(result.error ? `${TEXT.failed}: ${result.error}` : TEXT.done(result.count ?? 0));
    } catch (e) {
      toast(`${TEXT.failed}: ${e}`);
    } finally {
      setBusy(false);
      setInfo(await status());
    }
  };
  // Reopened while icons are being extracted (by an earlier panel): look again until it is done
  useEffect(() => {
    if (!info?.extracting || busy) return;
    const timer = setInterval(() => status().then(setInfo), 3000);
    return () => clearInterval(timer);
  }, [info?.extracting, busy]);
  const extracting = busy || info?.extracting;

  if (!info) return null;
  return (
    <PanelSection>
      <PanelSectionRow>
        <div>{info.saves ? TEXT.saves(info.saves) : TEXT.noSaves}</div>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={!info.saves}
          onClick={async () => {
            try {
              Navigation.NavigateToExternalWeb(await start());
            } catch (e) {
              toast(`${TEXT.openFailed}: ${e}`);
              return;
            }
            Navigation.CloseSideMenus();
            stopWhenLeft();
          }}
        >
          {TEXT.open}
        </ButtonItem>
      </PanelSectionRow>
      {info.running && (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={async () => (await stop(), setInfo(await status()))}>
            {TEXT.stop}
          </ButtonItem>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        {info.game ? (
          <ButtonItem layout="below" disabled={extracting} onClick={extract}>
            {extracting ? TEXT.extracting : info.icons ? TEXT.again : TEXT.extract}
          </ButtonItem>
        ) : (
          <div>{TEXT.noGame}</div>
        )}
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label={TEXT.alerts}
          description={check ? TEXT.checked(check) : TEXT.alertsAbout}
          checked={alerts}
          onChange={(on) => {
            setAlerts(on);
            try {
              localStorage.setItem(ALERTS, on ? "on" : "off");
            } catch {
              // not kept: on again after a restart
            }
            on ? startWatching() : stopWatching();
          }}
        />
      </PanelSectionRow>
    </PanelSection>
  );
}

// The page's close button: leave Steam's browser (the server stops itself). Back can be swallowed (once it only
// closed the on-screen keyboard), so if Steam is still on the browser half a second later, go to the library.
// Left Steam's browser some other way (B, the Steam button) for a minute: stop the server too; "Open collection"
// starts it again. Not at once: a look at the Steam menu or a profile and B back must find the page still working
const inBrowser = () => location.pathname.includes("externalweb");
function stopWhenLeft() {
  let seen = false; // the browser opens asynchronously: only a route change after it counts
  let waited = 0;
  let away = 0;
  const timer = setInterval(() => {
    if (inBrowser()) (seen = true), (away = 0);
    else if (seen) ++away >= 60 && (clearInterval(timer), stop());
    else if (++waited > 30) clearInterval(timer); // the browser never showed up: nothing to watch
  }, 1000);
}

const leave = () => {
  Navigation.NavigateBack();
  setTimeout(() => inBrowser() && Navigation.NavigateToLibraryTab(), 500);
};

export default definePlugin(() => {
  addEventListener("closed", leave);
  if (alertsOn()) startWatching(); // here, not in the panel: it is closed nearly all the time
  return {
    name: "D2R Collection Tracker",
    titleView: <div className={staticClasses.Title}>D2R Collection Tracker</div>,
    content: <Content />,
    icon: (
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
        <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm0 4 4 1.5V11c0 2.9-1.7 5.6-4 6.9-2.3-1.3-4-4-4-6.9V7.5L12 6Z" />
      </svg>
    ),
    onDismount: () => {
      removeEventListener("closed", leave);
      stopWatching();
    },
  };
});
