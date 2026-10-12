import { invoke } from "@tauri-apps/api/core";
import type { PdGuilds, PdInventory, PdPlayerPals, PdPlayers } from "./data/paldefender";
import type { BaseStorage, ClientConfig, ModStatus } from "./types";

export function loadClientConfig(): Promise<ClientConfig> {
  return invoke<ClientConfig>("client_config");
}

async function get<T>(cfg: ClientConfig, path: string): Promise<T> {
  const res = await fetch(`${cfg.serverUrl.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`${res.status} ${body?.error ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const fetchBaseStorage = (cfg: ClientConfig) => get<BaseStorage>(cfg, "/api/base-storage");
export const fetchModStatus = (cfg: ClientConfig) => get<ModStatus>(cfg, "/api/mod-status");
/** PalDefender /players, passed through unchanged */
export const fetchPlayers = (cfg: ClientConfig) => get<PdPlayers>(cfg, "/api/players");
/** PalDefender /guilds, passed through unchanged */
export const fetchGuilds = (cfg: ClientConfig) => get<PdGuilds>(cfg, "/api/guilds");
/** PalDefender /items/{PlayerUID}: the player's inventory, passed through unchanged */
export const fetchInventory = (cfg: ClientConfig, playerUid: string) =>
  get<PdInventory>(cfg, `/api/items/${encodeURIComponent(playerUid)}`);
/** PalDefender /progression/{PlayerUID}: only the capture bonus counts are typed */
export const fetchProgression = (cfg: ClientConfig, playerUid: string) =>
  get<{ Progression?: { Captures?: { palCaptureBonusCounts?: Record<string, number | string> } } }>(cfg, `/api/progression/${encodeURIComponent(playerUid)}`);
/** PalDefender /pals/{PlayerUID}: party, pal box and base workers (large, about 400 KB) */
export const fetchPlayerPals = (cfg: ClientConfig, playerUid: string) => get<PdPlayerPals>(cfg, `/api/pals/${encodeURIComponent(playerUid)}`);
