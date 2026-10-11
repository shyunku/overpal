import { useEffect, useState } from "react";
import { fetchBaseStorage, fetchModStatus, fetchPlayers, loadClientConfig } from "./api";
import type { BaseStorage, ModStatus } from "./types";
import "./App.css";

const REFRESH_MS = 5000;

// Temporary connection check screen. The overlay UI is designed separately (task #7).
function App() {
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<BaseStorage | null>(null);
  const [status, setStatus] = useState<ModStatus | null>(null);
  const [players, setPlayers] = useState<string[]>([]);

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;

    async function refresh() {
      try {
        const cfg = await loadClientConfig();
        const [s, st] = await Promise.all([fetchBaseStorage(cfg), fetchModStatus(cfg)]);
        if (cancelled) return;
        setStorage(s);
        setStatus(st);
        setError(null);
        const p = await fetchPlayers(cfg).catch(() => null);
        if (!cancelled && p) setPlayers(p.Players.map((x) => `${x.Name} (${x.Status})`));
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

  const chests = storage?.storages.filter((s) => s.kind !== "dropped") ?? [];

  return (
    <main className="debug">
      <h1>PalHelper connection check</h1>
      {error && <p className="error">{error}</p>}
      {status && (
        <p>
          mod: {status.ok ? "ok" : "error"}, {status.elapsedMs} ms, updated {new Date(status.updatedAt * 1000).toLocaleTimeString()}
        </p>
      )}
      <p>players: {players.join(", ") || "-"}</p>
      <p>storages: {storage?.storages.length ?? "-"}</p>
      <ul>
        {chests.map((s) => (
          <li key={s.containerId}>
            <b>
              {s.kind} {s.buildObjectId ?? ""}
            </b>
            : {s.items.map((i) => `${i.item} x${i.count}`).join(", ") || "(empty)"}
          </li>
        ))}
      </ul>
    </main>
  );
}

export default App;
