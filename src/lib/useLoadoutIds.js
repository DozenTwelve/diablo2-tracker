import { useEffect, useState } from "react";
import { deckLoadouts, onDeck } from "./deck";
import { loadoutIds } from "./loadouts";

// Every saved loadout's piece ids (loadoutIds), read from the plugin when the page opens: they count as kept, as the
// player's keep list does. { ids, failed }: ids null until read, and when the plugin couldn't give them (failed: why):
// callers delete nothing then rather than assume there are none. The web has no loadouts: [].
export function useLoadoutIds() {
  const [state, setState] = useState(onDeck ? { ids: null } : { ids: [] });
  useEffect(() => {
    if (!onDeck) return;
    let current = true;
    deckLoadouts().then(
      (doc) => current && setState({ ids: loadoutIds(doc) }),
      (e) => current && setState({ ids: null, failed: e.message ?? String(e) }),
    );
    return () => (current = false);
  }, []);
  return state;
}
