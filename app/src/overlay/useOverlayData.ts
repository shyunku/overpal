import { useEffect, useMemo, useRef, useState } from "react";
import { fetchGuilds, fetchInventory, fetchModStatus, fetchPlayers, loadClientConfig } from "../api";
import type { PdGuilds, PdInventory, PdPlayers } from "../data/paldefender";
import { baseAt, buildSnapshot, inventoryOnly, inventoryStorage, withInventory, type BaseView, type GuildView, type PlayerView, type Snapshot } from "../data/snapshot";
import type { BaseStorage, ClientConfig, ModStatus } from "../types";
import { streamStorage } from "./storageStream";

/** player positions (minimap) */
const PLAYERS_MS = 500;
/** own inventory (PalDefender has no push) */
const INVENTORY_MS = 2000;
/** guilds and camps change rarely */
const GUILDS_MS = 15000;
const STATUS_MS = 10000;
/** a change stays in the "recent" list this long */
const RECENT_MS = 120_000;
/** the mod writes its status every 10 s; older status means the mod or the server stopped */
const STALE_AFTER_S = 30;

export type ConnState = "ok" | "stale" | "down";

export interface RecentChange {
  item: string;
  delta: number;
  at: number;
}

export interface OverlayData {
  conn: ConnState;
  /** seconds since the mod last reported its status */
  ageSeconds: number | null;
  error: string | null;
  snapshot: Snapshot | null;
  guild: GuildView | null;
  /** items at hand: the base the player is in plus the inventory, or only the inventory outside bases */
  base: BaseView | null;
  /** index of the base the player is in within guild.bases, -1 outside every base */
  baseIndex: number;
  me: PlayerView | null;
  recent: RecentChange[];
}

function pickMe(players: PlayerView[], cfg: ClientConfig | null): PlayerView | null {
  if (cfg?.playerName) return players.find((p) => p.name === cfg.playerName) ?? null;
  return players.find((p) => p.online) ?? players[0] ?? null;
}

/** Repeats `fn` every `ms` until the returned cleanup runs. */
function every(ms: number, fn: () => Promise<void>): () => void {
  let timer: number | undefined;
  let stopped = false;
  const run = async () => {
    await fn().catch(() => {});
    if (!stopped) timer = window.setTimeout(run, ms);
  };
  run();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

export function useOverlayData(): OverlayData {
  const [cfg, setCfg] = useState<ClientConfig | null>(null);
  const [storage, setStorage] = useState<BaseStorage | null>(null);
  const [status, setStatus] = useState<ModStatus | null>(null);
  const [guilds, setGuilds] = useState<PdGuilds | null>(null);
  const [players, setPlayers] = useState<PdPlayers | null>(null);
  const [inventory, setInventory] = useState<PdInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamDown, setStreamDown] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** the viewing player's uid, read by the stream callback */
  const meUidRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    loadClientConfig().then(setCfg, (e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!cfg) return;
    const abort = new AbortController();
    let latest = 0;
    streamStorage(
      cfg,
      async (s) => {
        // a chest change is often a move to or from the inventory; fetch the inventory now and apply
        // both together, otherwise the moved items vanish from the totals until the next inventory poll
        const n = ++latest;
        const uid = meUidRef.current;
        const inv = uid ? await fetchInventory(cfg, uid).catch(() => null) : null;
        // a newer version arrived while waiting
        if (abort.signal.aborted || n !== latest) return;
        if (inv) setInventory(inv);
        setStorage(s);
        setStreamDown(false);
        setError(null);
      },
      (e) => {
        setStreamDown(true);
        setError(String(e));
      },
      abort.signal,
    );
    const stops = [
      // PalDefender is optional
      every(PLAYERS_MS, () => fetchPlayers(cfg).then(setPlayers)),
      every(GUILDS_MS, () => fetchGuilds(cfg).then(setGuilds)),
      every(STATUS_MS, () => fetchModStatus(cfg).then(setStatus)),
      // keeps the "n seconds ago" text and the stale check moving
      every(1000, async () => setNow(Date.now())),
    ];
    return () => {
      abort.abort();
      stops.forEach((f) => f());
    };
  }, [cfg]);

  const snapshot = useMemo(() => (storage ? buildSnapshot(storage, guilds, players) : null), [storage, guilds, players]);
  const me = snapshot ? pickMe(snapshot.players, cfg) : null;
  const guild = snapshot ? (snapshot.guilds.find((g) => g.guildId === me?.guildId) ?? snapshot.guilds[0] ?? null) : null;
  const meUid = me?.uid;
  meUidRef.current = meUid;

  useEffect(() => {
    if (!cfg || !meUid) return;
    return every(INVENTORY_MS, () => fetchInventory(cfg, meUid).then(setInventory));
  }, [cfg, meUid]);

  // the base the player stands in; other bases are not counted
  const current = guild ? baseAt(guild.bases, me?.worldPos) : null;
  const baseIndex = current && guild ? guild.bases.indexOf(current) : -1;
  // the player's own items count with the base
  const base = useMemo(() => {
    const inv = guild && inventory && inventory.Meta.PlayerUID === meUid ? inventoryStorage(inventory, guild.guildId) : null;
    if (current) return inv ? withInventory(current, inv) : current;
    return inv ? inventoryOnly(inv) : null;
  }, [current, guild, inventory, meUid]);

  const recent = useRecentChanges(base);

  // "updated n seconds ago" follows the last storage version; staleness follows the mod status
  const ageSeconds = storage ? Math.max(0, Math.round(now / 1000 - storage.updatedAt)) : null;
  const statusAge = status ? now / 1000 - status.updatedAt : null;
  const conn: ConnState = streamDown || (!storage && error) ? "down" : statusAge !== null && (statusAge > STALE_AFTER_S || !status?.ok) ? "stale" : "ok";

  return { conn, ageSeconds, error, snapshot, guild, base, baseIndex, me, recent };
}

function useRecentChanges(base: BaseView | null): RecentChange[] {
  const prev = useRef<Map<string, number> | null>(null);
  const [recent, setRecent] = useState<RecentChange[]>([]);
  useEffect(() => {
    const now = Date.now();
    const totals = new Map((base?.totals ?? []).map((t) => [t.item, t.count]));
    const before = prev.current;
    prev.current = totals;
    setRecent((cur) => {
      let next = cur.filter((r) => now - r.at < RECENT_MS);
      if (before) {
        for (const item of new Set([...before.keys(), ...totals.keys()])) {
          const delta = (totals.get(item) ?? 0) - (before.get(item) ?? 0);
          if (delta === 0) continue;
          const old = next.find((r) => r.item === item);
          next = [{ item, delta: delta + (old?.delta ?? 0), at: now }, ...next.filter((r) => r.item !== item)];
        }
      }
      return next;
    });
  }, [base]);
  return recent;
}
