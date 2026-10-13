import { useEffect, useMemo, useRef, useState } from "react";
import { fetchGuilds, fetchInventory, fetchModStatus, fetchPlayers, loadClientConfig } from "../api";
import type { PdGuilds, PdInventory, PdPlayers } from "../data/paldefender";
import { baseAt, buildSnapshot, inventoryOnly, inventoryStorage, withInventory, type BaseView, type GuildView, type PlayerView, type Snapshot } from "../data/snapshot";
import type { BaseStorage, ClientConfig, ModStatus } from "../types";
import { streamStorage, type LivePosition } from "./storageStream";

/** player positions */
const PLAYERS_MS = 500;
/** player positions in the minimap window, which draws the movement in between (2-3 ms a call) */
export const MINIMAP_PLAYERS_MS = 100;
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

/** while the mod sends positions, PalDefender is asked for the player list only this often */
const PLAYERS_WITH_LIVE_MS = 3000;
/** live positions newer than this count as flowing (the mod writes only on change) */
const LIVE_FRESH_MS = 5000;

/** PalDefender map coordinates of a world position (its MapLocation, see mapcoords.ts) */
const mapOf = (p: LivePosition) => ({ x: (p.y - 158000) / 459, y: (p.x + 123888) / 459, z: p.z });

/**
 * `livePositionsMs`: how often live positions (mod, 0.1 s) reach this window; the minimap takes
 * every one (0), other windows only need the player's place now and then.
 */
export function useOverlayData(playersMs = PLAYERS_MS, livePositionsMs = 1000): OverlayData {
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
  const [live, setLive] = useState<Map<string, LivePosition> | null>(null);
  const liveAt = useRef(0);
  const livePending = useRef<LivePosition[] | null>(null);

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
      (list) => {
        // applied at most every livePositionsMs (the latest one wins)
        const first = livePending.current === null;
        livePending.current = list;
        const apply = () => {
          const l = livePending.current;
          livePending.current = null;
          if (l && !abort.signal.aborted) setLive(new Map(l.map((p) => [p.uid, p])));
        };
        if (!livePositionsMs) apply();
        else if (first) window.setTimeout(apply, livePositionsMs);
        liveAt.current = Date.now();
      },
    );
    let playersAt = 0;
    const stops = [
      // PalDefender is optional; while the mod sends positions only the list (names, online) is needed
      every(playersMs, async () => {
        if (Date.now() - liveAt.current < LIVE_FRESH_MS && Date.now() - playersAt < PLAYERS_WITH_LIVE_MS) return;
        playersAt = Date.now();
        await fetchPlayers(cfg).then(setPlayers);
      }),
      every(GUILDS_MS, () => fetchGuilds(cfg).then(setGuilds)),
      every(STATUS_MS, () => fetchModStatus(cfg).then(setStatus)),
      // keeps the "n seconds ago" text and the stale check moving
      every(1000, async () => setNow(Date.now())),
    ];
    return () => {
      abort.abort();
      stops.forEach((f) => f());
    };
  }, [cfg, playersMs]);

  const built = useMemo(() => (storage ? buildSnapshot(storage, guilds, players) : null), [storage, guilds, players]);
  // live positions over the ones from PalDefender (cheap: the snapshot is not rebuilt for them)
  const snapshot = useMemo(() => {
    if (!built || !live) return built;
    const players = built.players.map((p) => {
      const l = live.get(p.uid);
      return l ? { ...p, worldPos: { x: l.x, y: l.y, z: l.z }, mapPos: mapOf(l), yaw: l.yaw } : p;
    });
    return { ...built, players };
  }, [built, live]);
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
