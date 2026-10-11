import { invoke } from "@tauri-apps/api/core";
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
export const fetchPlayers = (cfg: ClientConfig) => get<{ Players: { Name: string; Status: string }[] }>(cfg, "/api/players");
