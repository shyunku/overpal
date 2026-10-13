// Calls into the app (src-tauri/src/gui.rs) and the shapes it returns.
import { invoke } from "@tauri-apps/api/core";
import type { ClientConfig } from "../types";

export type Mode = "server" | "client" | "both";
export type StartMode = "ask" | Mode;

export interface Friend {
  name: string;
  nickname: string;
  token: string;
}

export interface Profile {
  name: string;
  startMode: StartMode;
  lastUsed?: number | null;
  server?: { gameServerDir: string; allowExternal: boolean; port: number } | null;
  client?: { serverUrl: string; token: string } | null;
  playerName?: string | null;
  hostToken?: string | null;
  friends: Friend[];
}

export interface ProfileSummary {
  name: string;
  startMode: StartMode;
  lastUsed: number | null;
  target: string | null;
}

export interface SessionView {
  profile: Profile | null;
  legacyPath: string | null;
  mode: Mode | null;
  started: boolean;
  client: ClientConfig | null;
  version: string;
}

export interface Detected {
  hasServer: boolean;
  hasMod: boolean;
  palDefenderUrl: string | null;
  hasPalDefenderToken: boolean;
}

export interface FoundServer {
  path: string;
  hasMod: boolean;
  hasPalDefender: boolean;
}

export interface GameServerStatus {
  dir: string;
  running: boolean;
  restEnabled: boolean;
  restOk: boolean;
  version: string | null;
  serverName: string | null;
  fps: number | null;
  players: number | null;
  maxPlayers: number | null;
  uptime: number | null;
}

export interface LogLine {
  at: string;
  level: "info" | "warn" | "error";
  kind: "app" | "conn" | "stall" | "friend";
  text: string;
}

export const api = {
  profiles: () => invoke<ProfileSummary[]>("profiles_list"),
  deleteProfile: (name: string) => invoke<void>("profile_delete", { name }),
  open: (name: string, isNew: boolean) => invoke<void>("launcher_open", { name, isNew }),
  session: () => invoke<SessionView>("session_get"),
  start: (mode: Mode) => invoke<void>("session_start", { mode }),
  /** true when the app restarts to apply it */
  save: (profile: Profile) => invoke<boolean>("profile_update", { profile }),
  detect: (dir: string) => invoke<Detected>("detect_server_dir", { dir }),
  findServers: () => invoke<FoundServer[]>("find_game_servers"),
  gsStatus: () => invoke<GameServerStatus>("gs_status"),
  gsStart: () => invoke<void>("gs_start"),
  gsStop: () => invoke<void>("gs_stop"),
  gsLogFollow: (source: "pd" | "mod") => invoke<void>("gs_log_follow", { source }),
  gsLogDir: (source: "pd" | "mod") => invoke<string>("gs_log_dir", { source }),
  playersIn: (dir: string) => invoke<string[]>("players_in", { dir }),
  pickFolder: () => invoke<string | null>("pick_folder"),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  publicIp: () => invoke<string>("public_ip"),
  addFriend: (name: string, nickname: string) => invoke<Profile>("friend_add", { name, nickname }),
  renewFriend: (name: string) => invoke<Profile>("friend_renew", { name }),
  removeFriend: (name: string) => invoke<Profile>("friend_remove", { name }),
  friendFolder: (name: string) => invoke<void>("friend_folder", { name }),
  logLines: () => invoke<LogLine[]>("log_lines"),
  logDir: () => invoke<string | null>("log_dir"),
  quit: () => invoke<void>("app_quit"),
};

export const MODE_NAME: Record<StartMode, string> = { server: "서버", client: "오버레이", both: "서버+오버레이", ask: "매번 선택" };

/** "2026.10.13 오후 09:35" */
export function formatTime(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "-";
  const d = new Date(unixSeconds * 1000);
  const h = d.getHours();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())} ${h < 12 ? "오전" : "오후"} ${two(h % 12 || 12)}:${two(d.getMinutes())}`;
}

/** The last two folders of a long Windows path, e.g. "…\servers\Pyundle". */
export function shortPath(v: string): string {
  const parts = v.split("\\");
  return parts.length > 3 ? `…\\${parts.slice(-2).join("\\")}` : v;
}

export const errorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
