import { useEffect, useRef, useState } from "react";
import { fetchBaseStorage, fetchGuilds, fetchModStatus, fetchPlayers, loadClientConfig } from "../api";
import { buildSnapshot, type BaseView, type GuildView, type PlayerView, type Snapshot } from "../data/snapshot";
import type { ClientConfig, ModStatus } from "../types";

const REFRESH_MS = 5000;
/** a change stays in the "recent" list this long */
const RECENT_MS = 120_000;
/** the mod writes every 10 s; older output means the mod or the server stopped */
const STALE_AFTER_S = 30;

export type ConnState = "ok" | "stale" | "down";

export interface RecentChange {
  item: string;
  delta: number;
  at: number;
}

export interface OverlayData {
  conn: ConnState;
  /** seconds since the mod last wrote its output */
  ageSeconds: number | null;
  error: string | null;
  snapshot: Snapshot | null;
  guild: GuildView | null;
  base: BaseView | null;
  me: PlayerView | null;
  recent: RecentChange[];
}

function pickMe(players: PlayerView[], cfg: ClientConfig | null): PlayerView | null {
  if (cfg?.playerName) return players.find((p) => p.name === cfg.playerName) ?? null;
  return players.find((p) => p.online) ?? players[0] ?? null;
}

export function useOverlayData(): OverlayData {
  const [state, setState] = useState<OverlayData>({
    conn: "ok", ageSeconds: null, error: null, snapshot: null, guild: null, base: null, me: null, recent: [],
  });
  const prevTotals = useRef<Map<string, number> | null>(null);
  const recent = useRef<RecentChange[]>([]);

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    let cfg: ClientConfig | null = null;

    async function refresh() {
      try {
        cfg ??= await loadClientConfig();
        const [storage, status] = await Promise.all([fetchBaseStorage(cfg), fetchModStatus(cfg)]);
        // PalDefender is optional
        const [guilds, players] = await Promise.all([fetchGuilds(cfg).catch(() => null), fetchPlayers(cfg).catch(() => null)]);
        if (cancelled) return;

        const snapshot = buildSnapshot(storage, guilds, players);
        const me = pickMe(snapshot.players, cfg);
        const guild = snapshot.guilds.find((g) => g.guildId === me?.guildId) ?? snapshot.guilds[0] ?? null;
        const base = guild?.bases[0] ?? null;

        trackChanges(base, prevTotals, recent);
        const ageSeconds = Math.max(0, Math.round(Date.now() / 1000 - (status as ModStatus).updatedAt));
        setState({
          conn: ageSeconds > STALE_AFTER_S || !status.ok ? "stale" : "ok",
          ageSeconds,
          error: null,
          snapshot,
          guild,
          base,
          me,
          recent: [...recent.current],
        });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, conn: "down", error: String(e) }));
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

  return state;
}

function trackChanges(
  base: BaseView | null,
  prevTotals: { current: Map<string, number> | null },
  recent: { current: RecentChange[] },
) {
  const now = Date.now();
  const totals = new Map((base?.totals ?? []).map((t) => [t.item, t.count]));
  const prev = prevTotals.current;
  if (prev) {
    for (const item of new Set([...prev.keys(), ...totals.keys()])) {
      const delta = (totals.get(item) ?? 0) - (prev.get(item) ?? 0);
      if (delta !== 0) {
        const old = recent.current.find((r) => r.item === item && now - r.at < RECENT_MS);
        recent.current = recent.current.filter((r) => r.item !== item);
        recent.current.unshift({ item, delta: delta + (old?.delta ?? 0), at: now });
      }
    }
  }
  recent.current = recent.current.filter((r) => now - r.at < RECENT_MS);
  prevTotals.current = totals;
}
