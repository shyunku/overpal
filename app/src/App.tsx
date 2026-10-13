import { useEffect, useState } from "react";
import { fetchBaseStorage, fetchGuilds, fetchModStatus, fetchPlayers, loadClientConfig } from "./api";
import { buildSnapshot, type ItemTotal, type Snapshot } from "./data/snapshot";
import type { ModStatus } from "./types";
import "./App.css";

const REFRESH_MS = 5000;

const itemsText = (totals: ItemTotal[]) => totals.map((t) => `${t.item} x${t.count}`).join(", ") || "(empty)";

// Temporary connection check screen. The overlay UI is designed separately (task #7).
function App() {
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<ModStatus | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;

    async function refresh() {
      try {
        const cfg = await loadClientConfig();
        const [storage, st] = await Promise.all([fetchBaseStorage(cfg), fetchModStatus(cfg)]);
        // PalDefender is optional: without it storages are still grouped by guild
        const [guilds, players] = await Promise.all([
          fetchGuilds(cfg).catch(() => null),
          fetchPlayers(cfg).catch(() => null),
        ]);
        if (cancelled) return;
        setSnapshot(buildSnapshot(storage, guilds, players));
        setStatus(st);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) timer = window.setTimeout(refresh, REFRESH_MS);
      }
    }

    refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <main className="debug">
      <h1>Overpal connection check</h1>
      {error && <p className="error">{error}</p>}
      {status && (
        <p>
          mod: {status.ok ? "ok" : "error"}, {status.elapsedMs} ms, updated {new Date(status.updatedAt * 1000).toLocaleTimeString()}
        </p>
      )}
      <p>players: {snapshot?.players.map((p) => `${p.name} (${p.online ? "online" : "offline"})`).join(", ") || "-"}</p>
      {snapshot?.guilds.map((g) => (
        <section key={g.guildId}>
          <h2>{g.name || g.guildId}</h2>
          {g.bases.map((b, i) => (
            <p key={b.campId}>
              <b>base {i + 1}</b> ({b.storages.length} storages): {itemsText(b.totals)}
            </p>
          ))}
          <p>
            <b>guild total</b>: {itemsText(g.totals)}
          </p>
        </section>
      ))}
    </main>
  );
}

export default App;
