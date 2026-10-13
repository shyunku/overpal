// The Home window: picks the mode when the profile asks for it, then shows home (status), log,
// friends and settings, with the connection bar at the bottom. Mock: docs/designs/app-gui-mock.html
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PdPlayers } from "../data/paldefender";
import type { ClientConfig, ModStatus } from "../types";
import { Icon, type IconName } from "./icons";
import { GameServerView, gsState } from "./GameServer";
import { api, errorText, MODE_NAME, shortPath, type Detected, type FoundServer, type LogLine, type Mode, type Profile, type SessionView, type StartMode } from "./session";

// ---------------------------------------------------------------- data from the app server

interface HostStatus {
  listen: string;
  palDefender: { ok: boolean | null; online: number; total: number };
  stalls: { count: number; max: number | null; scan: number; recent: { at: string; ms: number; scan: boolean }[] };
  friends: { name: string | null; secondsAgo: number | null; connected: boolean }[];
}

async function getJson<T>(cfg: ClientConfig, path: string): Promise<T> {
  const res = await fetch(`${cfg.serverUrl.replace(/\/$/, "")}${path}`, { headers: { Authorization: `Bearer ${cfg.token}` } });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

/** Calls `fn` now and every `ms`; the latest result, or null after a failure. */
function usePoll<T>(fn: (() => Promise<T>) | null, ms: number): { value: T | null; failed: boolean } {
  const [state, setState] = useState<{ value: T | null; failed: boolean }>({ value: null, failed: false });
  const ref = useRef(fn);
  ref.current = fn;
  const on = fn !== null;
  useEffect(() => {
    if (!on) return;
    let stopped = false;
    let timer: number | undefined;
    const run = async () => {
      try {
        const v = await ref.current!();
        if (!stopped) setState({ value: v, failed: false });
      } catch {
        if (!stopped) setState((s) => ({ value: s.value, failed: true }));
      }
      if (!stopped) timer = window.setTimeout(run, ms);
    };
    run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [on, ms]);
  return state;
}

const hasServer = (m: Mode | null) => m === "server" || m === "both";
const hasOverlay = (m: Mode | null) => m === "client" || m === "both";

function ready(p: Profile, m: Mode): boolean {
  return m === "client" ? !!p.client?.serverUrl && !!p.client?.token : !!p.server?.gameServerDir;
}

// ---------------------------------------------------------------- root

type Stage = { kind: "loading" } | { kind: "mode" } | { kind: "settings"; mode: Mode } | { kind: "run" };

export function Home() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const s = await api.session();
    setSession(s);
    return s;
  };

  const startIn = async (mode: Mode) => {
    setError(null);
    try {
      await api.start(mode);
      await reload();
      setStage({ kind: "run" });
    } catch (e) {
      if (errorText(e) === "settings") setStage({ kind: "settings", mode });
      else setError(errorText(e));
    }
  };

  useEffect(() => {
    reload().then((s) => {
      if (s.started) setStage({ kind: "run" });
      else if (s.profile && s.profile.startMode !== "ask") startIn(s.profile.startMode);
      else setStage({ kind: "mode" });
    }, (e) => setError(errorText(e)));
  }, []);

  if (!session || stage.kind === "loading") return <div className="main">{error && <div className="err">{error}</div>}</div>;
  if (stage.kind === "mode" && session.profile) return <ModeSelect profile={session.profile} error={error} onStart={startIn} onSettings={(mode) => setStage({ kind: "settings", mode })} />;
  if (stage.kind === "settings" && session.profile) {
    return (
      <div className="main">
        <SettingsView
          session={session}
          mode={stage.mode}
          prestart
          onSaved={async (p) => {
            setSession({ ...session, profile: p });
            await startIn(stage.mode);
          }}
        />
        {error && <div className="err">{error}</div>}
      </div>
    );
  }
  return <Running session={session} setSession={setSession} />;
}

// ---------------------------------------------------------------- mode select

const MODE_CARD: Record<Mode, { icon: IconName; who: string; desc: string; points: string[] }> = {
  server: { icon: "modeServer", who: "서버 전용 PC", desc: "앱 서버만 실행합니다.", points: ["게임 서버와 같은 PC에서 실행", "친구들의 오버레이가 이 PC에 접속", "오버레이는 표시하지 않음"] },
  client: { icon: "modeClient", who: "친구 PC", desc: "다른 PC의 앱 서버에 접속해 게임 화면에 오버레이를 표시합니다.", points: ["앱 서버 주소와 접속 토큰 필요", "거점 아이템·팰·미니맵 표시", "게임 서버를 실행하지 않음"] },
  both: { icon: "modeBoth", who: "호스트 PC", desc: "앱 서버를 실행하고, 이 PC의 게임 화면에도 오버레이를 표시합니다.", points: ["게임 서버와 같은 PC에서 실행", "친구들의 오버레이가 이 PC에 접속", "이 PC 게임 화면에 오버레이 표시"] },
};

function ModeSelect({ profile, error, onStart, onSettings }: { profile: Profile; error: string | null; onStart: (m: Mode) => void; onSettings: (m: Mode) => void }) {
  const [pick, setPick] = useState<Mode>("both");
  const ok = ready(profile, pick);
  return (
    <div className="main">
      <div className="launch">
        <h2>
          모드 선택 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· {profile.name}</span>
        </h2>
        <p className="lead">
          실행할 모드를 선택해 주세요.
          <br />
          실행 중에는 모드를 변경할 수 없습니다.
        </p>
        <div className="mcards">
          {(["server", "client", "both"] as Mode[]).map((m) => {
            const c = MODE_CARD[m];
            const r = ready(profile, m);
            return (
              <div key={m} className={`mcard ${pick === m ? "on" : ""}`} onClick={() => setPick(m)}>
                <Icon name={c.icon} className="mico" />
                <div className="mname">{MODE_NAME[m]}</div>
                <div className="mwho">
                  {c.who} · {m}
                </div>
                <p className="mdesc">{c.desc}</p>
                <ul className="mpoints">
                  {c.points.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <div className={`mstate ${r ? "ok" : ""}`}>
                  <Icon name={r ? "check" : "sliders"} />
                  {r ? "설정 완료" : "설정 필요"}
                </div>
              </div>
            );
          })}
        </div>
        {error && <div className="err">{error}</div>}
        <div className="row launch-foot">
          <span className="muted" style={{ flex: 1, fontSize: 12 }}>
            {ok ? "저장된 설정으로 시작합니다." : "시작 전에 이 모드의 설정을 입력해야 합니다."}
          </span>
          {ok && (
            <button className="btn" onClick={() => onSettings(pick)}>
              <Icon name="sliders" />
              설정 확인
            </button>
          )}
          <button className="btn primary" onClick={() => (ok ? onStart(pick) : onSettings(pick))}>
            <Icon name="play" />
            {ok ? "시작" : "설정 후 시작"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- running

type Tab = "home" | "gameserver" | "log" | "friends" | "settings";

function Running({ session, setSession }: { session: SessionView; setSession: (s: SessionView) => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const mode = session.mode;
  const cfg = session.client;
  const host = usePoll(cfg && hasServer(mode) ? () => getJson<HostStatus>(cfg, "/api/host-status") : null, 2000);
  const mod = usePoll(cfg ? () => getJson<ModStatus>(cfg, "/api/mod-status") : null, 5000);
  const players = usePoll(cfg ? () => getJson<PdPlayers>(cfg, "/api/players") : null, 5000);
  const health = usePoll(cfg && mode === "client" ? () => getJson<{ ok: boolean }>(cfg, "/api/health") : null, 5000);
  const gsPoll = usePoll(hasServer(mode) ? () => api.gsStatus() : null, 2000);
  const gs = gsPoll.value;
  const tabs: [Tab, string, IconName][] = [
    ["home", "홈", "home"],
    ...(hasServer(mode) ? ([["gameserver", "게임 서버", "server"]] as [Tab, string, IconName][]) : []),
    ["log", "로그", "log"],
    ...(hasServer(mode) ? ([["friends", "친구", "users"]] as [Tab, string, IconName][]) : []),
    ["settings", "설정", "settings"],
  ];

  const appServer =
    mode === "client" ? (
      <span className="si">
        <Icon name="server" />
        <span className={`dot ${health.value ? "" : health.failed ? "bad" : "off"}`} />
        앱 서버 <b>{health.value ? "연결됨" : health.failed ? "연결 안 됨" : "확인 중"}</b> {cfg?.serverUrl.replace(/^https?:\/\//, "")}
      </span>
    ) : (
      <span className="si">
        <Icon name="server" />
        <span className={`dot ${host.value ? "" : host.failed ? "bad" : "off"}`} />
        앱 서버 <b>{host.value ? "실행 중" : host.failed ? "응답 없음" : "확인 중"}</b> {host.value?.listen}
      </span>
    );
  const pdOk = hasServer(mode) ? host.value?.palDefender.ok : players.value ? true : players.failed ? false : null;
  const online = hasServer(mode) ? host.value?.palDefender.online : players.value?.Players.filter((p) => p.Status === "Online").length;
  // server modes: the game server's own state first (off, starting, stopping)
  const gst = hasServer(mode) ? gsState(gs) : null;
  const game = gst && gst !== "on" && gst !== "norest" ? (
    <span className="si">
      <Icon name="game" />
      <span className={`dot ${gst === "off" ? "off" : "warn"}`} />
      게임 서버 <b>{gst === "off" ? "꺼짐" : gst === "starting" ? "켜는 중" : "끄는 중"}</b>
    </span>
  ) : (
    <span className="si">
      <Icon name="game" />
      <span className={`dot ${pdOk ? "" : pdOk === false ? "bad" : "off"}`} />
      게임 서버 <b>{pdOk ? "연결됨" : pdOk === false ? "연결 안 됨" : "확인 중"}</b>
      {pdOk ? ` 접속 ${online ?? 0}명` : ""}
    </span>
  );

  return (
    <div className="home">
      <div className="nav">
        {tabs.map(([t, label, icon]) => (
          <div key={t} className={`item ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            <Icon name={icon} />
            {label}
          </div>
        ))}
      </div>
      <div className="mainwrap">
        <div className={`main ${tab === "log" ? "fill" : ""}`}>
          {tab === "home" && <HomeView session={session} host={host.value} mod={mod.value} modFailed={mod.failed} players={players.value} pdOk={pdOk ?? null} onLog={() => setTab("log")} />}
          {tab === "gameserver" && <GameServerView gs={gs} onChanged={() => api.gsStatus().catch(() => null)} />}
          {tab === "log" && <LogView />}
          {tab === "friends" && <FriendsView session={session} host={host.value} players={players.value} onProfile={(p) => setSession({ ...session, profile: p })} />}
          {tab === "settings" && mode && <SettingsView session={session} mode={mode} onSaved={(p) => setSession({ ...session, profile: p })} />}
        </div>
        <div className="statusbar">
          {appServer}
          {game}
          <span className="sp" />
          <span className="si">
            <Icon name={mode === "server" ? "server" : mode === "client" ? "monitor" : "sliders"} />
            {mode} 모드
          </span>
        </div>
      </div>
    </div>
  );
}

const ago = (secs: number) => (secs < 60 ? `${Math.max(0, Math.round(secs))}초 전` : secs < 3600 ? `${Math.round(secs / 60)}분 전` : `${Math.round(secs / 3600)}시간 전`);

function Card({ icon, title, dot, big, children }: { icon: IconName; title: string; dot: "" | "warn" | "bad" | "off"; big: string; children?: ReactNode }) {
  return (
    <div className="card">
      <h4>
        <Icon name={icon} />
        {title}
      </h4>
      <div className="big">
        <span className={`dot ${dot}`} />
        {big}
      </div>
      {children && <div className="sub">{children}</div>}
    </div>
  );
}

function HomeView(props: { session: SessionView; host: HostStatus | null; mod: ModStatus | null; modFailed: boolean; players: PdPlayers | null; pdOk: boolean | null; onLog: () => void }) {
  const { session, host, mod, modFailed, players, pdOk, onLog } = props;
  const mode = session.mode;
  const me = session.client?.playerName ?? session.profile?.playerName ?? null;
  const modAge = mod ? Date.now() / 1000 - mod.updatedAt : null;
  const online = (players?.Players ?? []).filter((p) => p.Status === "Online");
  const friendOf = (name: string) => session.profile?.friends.find((f) => f.nickname === name);
  const friendState = (name: string) => host?.friends.find((f) => f.name === name);
  return (
    <>
      <h2>홈</h2>
      <p className="lead">
        {mode} 모드({MODE_NAME[mode as StartMode]})로 실행 중입니다.
        {session.legacyPath ? ` 설정 파일: ${session.legacyPath}` : ""}
      </p>
      {pdOk === false && (
        <div className="banner warn">
          <Icon name="alert" className="lg" />
          <span>
            게임 서버에 연결할 수 없습니다.
            <br />
            게임 서버가 켜지면 자동으로 다시 연결됩니다.
          </span>
        </div>
      )}
      <div className="cards">
        <Card icon="mod" title="모드 (OverpalMod)" dot={mod ? (mod.ok && modAge! < 30 ? "" : "warn") : modFailed ? "off" : "off"} big={mod ? (mod.ok ? (modAge! < 30 ? "정상" : "갱신 멈춤") : "오류") : "출력 없음"}>
          {mod ? (
            <>
              {ago(modAge!)} 갱신 · 스캔 {mod.elapsedMs}ms
            </>
          ) : (
            "모드 출력을 읽을 수 없습니다."
          )}
        </Card>
        {hasServer(mode) && (
          <Card icon="zap" title="서버 지연 (최근 10분)" dot={host ? (host.stalls.count ? "warn" : "") : "off"} big={host ? `${host.stalls.count}회` : "-"}>
            {host && host.stalls.count > 0 && (
              <>
                최대 {host.stalls.max}ms
                <br />
                모드 스캔 중 {host.stalls.scan}회 · 기타 {host.stalls.count - host.stalls.scan}회
              </>
            )}
          </Card>
        )}
        {hasOverlay(mode) && (
          <Card icon="monitor" title="오버레이" dot={pdOk ? "" : "warn"} big={pdOk ? "표시 중" : "데이터 없음"}>
            플레이어 {me ?? "-"}
            <br />
            {mode === "client" ? session.client?.serverUrl.replace(/^https?:\/\//, "") : "이 PC의 앱 서버"}
          </Card>
        )}
      </div>
      {pdOk && (
        <>
          <div className="sec">
            <span>
              <Icon name="users" />
              접속 중인 플레이어
            </span>
            <span>{online.length}명</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>닉네임</th>
                {hasServer(mode) && <th>친구 앱</th>}
              </tr>
            </thead>
            <tbody>
              {online.map((p) => {
                const f = friendOf(p.Name);
                const st = f ? friendState(f.name) : undefined;
                return (
                  <tr key={p.PlayerUID}>
                    <td>{p.Name}</td>
                    {hasServer(mode) && (
                      <td>
                        {p.Name === me ? (
                          <span className="tag on">이 PC</span>
                        ) : st?.connected ? (
                          <span className="tag on">접속 중</span>
                        ) : st?.secondsAgo != null ? (
                          <span className="tag">{ago(st.secondsAgo)}</span>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {!online.length && (
                <tr>
                  <td className="muted" colSpan={2}>
                    접속 중인 플레이어가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
      {host && host.stalls.recent.length > 0 && (
        <>
          <div className="sec">
            <span>
              <Icon name="alert" />
              최근 경고
            </span>
            <span style={{ cursor: "pointer" }} onClick={onLog}>
              전체 로그 →
            </span>
          </div>
          <div className="log">
            {host.stalls.recent.slice(0, 3).map((x, i) => (
              <div key={i} className="warn">
                <Icon name="zap" />
                {x.at} 게임 서버 지연 {x.ms}ms{x.scan ? " (모드 스캔 중)" : ""}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- log

function LogView() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState<"all" | "warn" | "conn">("all");
  useEffect(() => {
    api.logLines().then(setLines);
    const un = listen<LogLine>("app-log", (e) => setLines((l) => [...l.slice(-999), e.payload]));
    return () => {
      un.then((f) => f());
    };
  }, []);
  const shown = lines.filter((l) => filter === "all" || (filter === "warn" ? l.level !== "info" : l.kind === "conn" || l.kind === "friend"));
  return (
    <>
      <h2>로그</h2>
      <p className="lead">이번 실행의 기록입니다. 파일로도 저장됩니다.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="switch small">
          {(
            [
              ["all", "전체"],
              ["warn", "경고"],
              ["conn", "접속"],
            ] as const
          ).map(([f, l]) => (
            <span key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {l}
            </span>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={() => api.logDir().then((d) => (d ? api.openPath(d) : undefined))}>
          <Icon name="folder" />
          로그 폴더 열기
        </button>
      </div>
      <div className="log" style={{ flex: 1, overflow: "auto" }}>
        {shown.map((l, i) => (
          <div key={i} className={l.level}>
            <Icon name={l.level === "warn" ? "zap" : l.level === "error" ? "xcircle" : "info"} />
            {l.at}  {l.text}
          </div>
        ))}
        {!shown.length && <div className="empty">기록이 없습니다.</div>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- friends

function FriendsView({ session, host, players, onProfile }: { session: SessionView; host: HostStatus | null; players: PdPlayers | null; onProfile: (p: Profile) => void }) {
  const [ip, setIp] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const checkIp = () => api.publicIp().then(setIp, () => setIp(null));
  useEffect(() => {
    checkIp();
  }, []);
  const profile = session.profile;
  if (!profile) {
    return (
      <>
        <h2>친구</h2>
        <div className="banner info">
          <Icon name="info" className="lg" />
          <span>설정 파일로 실행 중입니다. 친구 관리는 프로필로 실행할 때 사용할 수 있습니다.</span>
        </div>
      </>
    );
  }
  const run = async (key: string, fn: () => Promise<Profile>) => {
    setBusy(key);
    setError(null);
    try {
      onProfile(await fn());
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
  };
  const state = (name: string) => host?.friends.find((f) => f.name === name);
  return (
    <>
      <h2>친구</h2>
      <p className="lead">
        친구마다 접속 토큰이 하나씩 발급됩니다.
        <br />
        친구 폴더(실행 파일 + 설정)를 전달하면 친구는 실행만 하면 됩니다.
      </p>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          친구 추가
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          <Icon name="globe" /> 공인 IP: {ip ?? "확인 중…"} (친구 설정의 서버 주소로 사용됩니다)
        </span>
        <button className="btn small" onClick={checkIp}>
          <Icon name="refresh" />
          다시 확인
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>이름</th>
            <th>토큰</th>
            <th>마지막 접속</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {profile.friends.map((f) => {
            const st = state(f.name);
            return (
              <tr key={f.name}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Icon name="user" className="lg" />
                    <div style={{ lineHeight: 1.3 }}>
                      {f.name}
                      <div className="muted" style={{ fontSize: 11 }}>
                        닉네임 {f.nickname || "-"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="mask">
                  <Icon name="key" /> ••••{f.token.slice(-4)}
                </td>
                <td>{st?.connected ? <span className="tag on">접속 중</span> : <span className="tag">{st?.secondsAgo != null ? ago(st.secondsAgo) : "기록 없음"}</span>}</td>
                <td className="r">
                  <button className="btn small" onClick={() => api.friendFolder(f.name)}>
                    <Icon name="folder" />
                    폴더 열기
                  </button>{" "}
                  <button className="btn small" disabled={busy !== null} onClick={() => window.confirm(`${f.name}의 토큰을 다시 발급할까요? 이전 토큰은 바로 사용할 수 없습니다.`) && run(`renew:${f.name}`, () => api.renewFriend(f.name))}>
                    <Icon name="refresh" />
                    토큰 재발급
                  </button>{" "}
                  <button className="btn small danger" disabled={busy !== null} onClick={() => window.confirm(`${f.name}을(를) 삭제할까요? 토큰은 바로 사용할 수 없고 친구 폴더는 남습니다.`) && run(`del:${f.name}`, () => api.removeFriend(f.name))}>
                    <Icon name="trash" />
                    삭제
                  </button>
                </td>
              </tr>
            );
          })}
          {!profile.friends.length && (
            <tr>
              <td className="muted" colSpan={4}>
                아직 친구가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {error && <div className="err" style={{ marginTop: 8 }}>{error}</div>}
      <div className="help">
        토큰 재발급: 새 토큰으로 친구 폴더의 설정을 갱신합니다. 이전 토큰은 즉시 사용할 수 없습니다.
        <br />
        삭제: 토큰을 사용할 수 없게 하고, 친구 폴더는 남겨 둡니다.
      </div>
      {adding && (
        <AddFriend
          names={(players?.Players ?? []).map((p) => p.Name)}
          busy={busy === "add"}
          onCancel={() => setAdding(false)}
          onAdd={async (name, nickname) => {
            await run("add", () => api.addFriend(name, nickname));
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

function AddFriend({ names, busy, onCancel, onAdd }: { names: string[]; busy: boolean; onCancel: () => void; onAdd: (name: string, nickname: string) => void }) {
  const [name, setName] = useState("");
  const [nick, setNick] = useState("");
  return (
    <div className="modal-back">
      <div className="modal">
        <h3>
          <Icon name="users" className="lg" />
          친구 추가
        </h3>
        <div className="form">
          <div className="field">
            <label>이름</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 친구 1" />
          </div>
          <div className="field">
            <label>게임 닉네임</label>
            <div>
              <input list="friend-nicks" value={nick} onChange={(e) => setNick(e.target.value)} placeholder="목록에서 고르거나 입력" />
              <datalist id="friend-nicks">
                {names.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <div className="help">서버에 접속한 적이 있는 플레이어 중에서 선택합니다.</div>
            </div>
          </div>
          <div className="field">
            <label>폴더</label>
            <div className="help" style={{ margin: "8px 0 0" }}>
              AppData의 friends\{name || "이름"}\ 에 실행 파일과 설정이 만들어집니다.
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={onCancel}>
              취소
            </button>
            <button className="btn primary" disabled={busy || !name.trim()} onClick={() => onAdd(name, nick)}>
              <Icon name="plus" />
              {busy ? "만드는 중…" : "만들기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- settings

/** Game servers found in the Steam libraries; picking one fills the folder. */
function Finder({ found, onPick, onClose }: { found: FoundServer[]; onPick: (path: string) => void; onClose: () => void }) {
  return (
    <div className="finder">
      <div className="fhead">
        <Icon name="search" />
        <span>찾은 게임 서버 {found.length}개</span>
        <span className="sp" />
        <span className="muted" style={{ fontSize: 11 }}>
          스팀 라이브러리에서 찾았습니다.
        </span>
        <span className="fx" onClick={onClose}>
          <Icon name="xcircle" />
        </span>
      </div>
      {found.map((f) => (
        <div key={f.path} className="fitem" onClick={() => onPick(f.path)}>
          <span className="fsrc">
            <Icon name="game" />
            스팀
          </span>
          <div className="fmain">
            <b>{f.path.split("\\").pop()}</b>
            <span className="muted" title={f.path}>
              {shortPath(f.path)}
            </span>
          </div>
          <div className="fchk">
            <span className={f.hasMod ? "ok" : "no"}>
              <Icon name={f.hasMod ? "check" : "xcircle"} />
              모드
            </span>
            <span className={f.hasPalDefender ? "ok" : "no"}>
              <Icon name={f.hasPalDefender ? "check" : "xcircle"} />
              PalDefender
            </span>
          </div>
          <button className="btn small">선택</button>
        </div>
      ))}
      {!found.length && (
        <div className="fitem" style={{ cursor: "default" }}>
          <span className="muted" style={{ gridColumn: "1 / -1", fontSize: 12 }}>
            스팀 라이브러리에서 게임 서버를 찾지 못했습니다. '찾아보기'로 폴더를 선택해 주세요.
          </span>
        </div>
      )}
    </div>
  );
}

function SettingsView({ session, mode, prestart, onSaved }: { session: SessionView; mode: Mode; prestart?: boolean; onSaved: (p: Profile) => void }) {
  const original = session.profile;
  const [p, setP] = useState<Profile | null>(original);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [check, setCheck] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // auto-find results (Steam libraries); null while the list is closed
  const [found, setFound] = useState<FoundServer[] | null>(null);
  const dirty = useMemo(() => JSON.stringify(p) !== JSON.stringify(original), [p, original]);
  const dir = p?.server?.gameServerDir ?? "";

  useEffect(() => {
    if (!hasServer(mode) || !dir) return setDetected(null);
    const t = window.setTimeout(() => {
      api.detect(dir).then(setDetected);
      api.playersIn(dir).then(setNames, () => setNames([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [dir, mode]);

  if (!p) {
    return (
      <>
        <h2>설정</h2>
        <div className="banner info">
          <Icon name="info" className="lg" />
          <span>
            설정 파일로 실행 중입니다.
            <br />
            설정은 {session.legacyPath}에서 바꿀 수 있습니다.
          </span>
        </div>
      </>
    );
  }
  const server = p.server ?? { gameServerDir: "", allowExternal: false, port: 17994 };
  const client = p.client ?? { serverUrl: "", token: "" };
  const setServer = (v: Partial<typeof server>) => setP({ ...p, server: { ...server, ...v } });
  const setClient = (v: Partial<typeof client>) => setP({ ...p, client: { ...client, ...v } });
  const canSave = (prestart || dirty) && ready(p, mode) && !saving;

  const testClient = async () => {
    setCheck("확인 중…");
    try {
      const cfg = { serverUrl: client.serverUrl, token: client.token, playerName: null } as ClientConfig;
      const players = await getJson<PdPlayers>(cfg, "/api/players");
      setNames(players.Players.map((x) => x.Name));
      setCheck("연결됨");
    } catch (e) {
      setCheck(errorText(e) === "401" ? "토큰이 맞지 않습니다." : "연결할 수 없습니다.");
    }
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const restarting = await api.save(p);
      if (!restarting) onSaved(p);
    } catch (e) {
      setError(errorText(e));
    }
    setSaving(false);
  };
  const modeIcon: IconName = mode === "server" ? "server" : mode === "client" ? "monitor" : "sliders";

  return (
    <>
      <h2>설정</h2>
      <p className="lead">{prestart ? "이 모드에 필요한 설정을 입력해 주세요." : "변경한 설정은 저장하면 앱이 다시 시작되며 적용됩니다."}</p>
      <div className="form">
        <div className="banner info" style={{ margin: 0 }}>
          <Icon name={modeIcon} className="lg" />
          <b>{mode}</b>
          <span>모드({MODE_NAME[mode]})</span>
          <span className="sp" />
          <span>모드는 앱을 다시 실행할 때 변경할 수 있습니다.</span>
        </div>
        <div className="field">
          <label>
            <Icon name="play" />
            시작 모드
          </label>
          <div>
            <div className="switch">
              {(["ask", "server", "client", "both"] as StartMode[]).map((m) => (
                <span key={m} className={p.startMode === m ? "on" : ""} onClick={() => setP({ ...p, startMode: m })}>
                  {MODE_NAME[m]}
                </span>
              ))}
            </div>
            <div className="help">
              정해 두면 이 프로필을 열 때 바로 시작합니다.
              <br />
              '매번 선택'이면 모드 선택 화면을 거칩니다.
            </div>
          </div>
        </div>
        {hasServer(mode) && (
          <>
            <div className="sec">
              <span>
                <Icon name="server" />
                앱 서버
              </span>
              <span />
            </div>
            <div className="field">
              <label>
                <Icon name="globe" />
                접속 허용
              </label>
              <div>
                <div className="switch">
                  <span className={server.allowExternal ? "" : "on"} onClick={() => setServer({ allowExternal: false })}>
                    이 PC만
                  </span>
                  <span className={server.allowExternal ? "on" : ""} onClick={() => setServer({ allowExternal: true })}>
                    외부 접속 허용
                  </span>
                </div>
                <div className="help">
                  외부 접속을 허용하면 친구 PC에서 접속할 수 있습니다.
                  <br />
                  공유기에서 이 포트(TCP)를 이 PC로 포트포워딩해야 합니다.
                </div>
              </div>
            </div>
            <div className="field">
              <label>
                <Icon name="hash" />
                포트
              </label>
              <div>
                <input style={{ width: 120 }} value={server.port} onChange={(e) => setServer({ port: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              </div>
            </div>
            <div className="field">
              <label>
                <Icon name="folder" />
                게임 서버 폴더
              </label>
              <div>
                <div className="row">
                  <input value={server.gameServerDir} onChange={(e) => setServer({ gameServerDir: e.target.value })} placeholder="PalServer.exe가 있는 폴더" />
                  <button className="btn" onClick={() => api.findServers().then(setFound)}>
                    <Icon name="search" />
                    자동 찾기
                  </button>
                  <button className="btn" onClick={() => api.pickFolder().then((d) => d && setServer({ gameServerDir: d }))}>
                    <Icon name="folder" />
                    찾아보기
                  </button>
                </div>
                {found && (
                  <Finder
                    found={found}
                    onPick={(path) => {
                      setServer({ gameServerDir: path });
                      setFound(null);
                    }}
                    onClose={() => setFound(null)}
                  />
                )}
                {!found && detected && (
                  <div className="help">
                    <span style={{ color: detected.hasServer ? "#7ee787" : "#ffa198" }}>{detected.hasServer ? "게임 서버 확인됨" : "PalServer.exe가 없습니다"}</span>
                    {" · "}
                    <span style={{ color: detected.hasMod ? "#7ee787" : "#f2cc60" }}>{detected.hasMod ? "모드 확인됨" : "모드 폴더가 없습니다"}</span>
                    {" · "}
                    <span style={{ color: detected.palDefenderUrl && detected.hasPalDefenderToken ? "#7ee787" : "#f2cc60" }}>
                      {detected.palDefenderUrl && detected.hasPalDefenderToken ? `PalDefender 확인됨 (${detected.palDefenderUrl.replace("http://", "")})` : "PalDefender REST 설정이 없습니다"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        {mode === "client" && (
          <>
            <div className="sec">
              <span>
                <Icon name="link" />
                접속할 앱 서버
              </span>
              <span />
            </div>
            <div className="field">
              <label>
                <Icon name="globe" />
                주소
              </label>
              <input value={client.serverUrl} onChange={(e) => setClient({ serverUrl: e.target.value.trim() })} placeholder="http://203.0.113.24:17994" />
            </div>
            <div className="field">
              <label>
                <Icon name="key" />
                토큰
              </label>
              <div>
                <div className="row">
                  <input type="password" value={client.token} onChange={(e) => setClient({ token: e.target.value.trim() })} />
                  <button className="btn" onClick={() => navigator.clipboard.readText().then((t) => setClient({ token: t.trim() }))}>
                    <Icon name="paste" />
                    붙여넣기
                  </button>
                  <button className="btn" disabled={!client.serverUrl || !client.token} onClick={testClient}>
                    <Icon name="check" />
                    연결 확인
                  </button>
                </div>
                {check && <div className="help">{check}</div>}
              </div>
            </div>
          </>
        )}
        {hasOverlay(mode) && (
          <>
            <div className="sec">
              <span>
                <Icon name="monitor" />
                오버레이
              </span>
              <span />
            </div>
            <div className="field">
              <label>
                <Icon name="user" />
                내 게임 닉네임
              </label>
              <div>
                <input list="my-nicks" value={p.playerName ?? ""} onChange={(e) => setP({ ...p, playerName: e.target.value || null })} placeholder="목록에서 고르거나 입력" />
                <datalist id="my-nicks">
                  {names.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <div className="help">미니맵과 '내 것' 화면이 이 플레이어를 기준으로 표시됩니다.</div>
              </div>
            </div>
          </>
        )}
      </div>
      {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}
      <div className="savebar">
        <span className="msg">{prestart ? "저장하면 이 설정으로 시작합니다." : dirty ? "변경사항이 있습니다. 저장하면 앱이 다시 시작됩니다." : "변경사항이 없습니다."}</span>
        {dirty && !prestart && (
          <button className="btn" onClick={() => setP(original)}>
            취소
          </button>
        )}
        <button className="btn primary" disabled={!canSave} onClick={save}>
          <Icon name={prestart ? "play" : "save"} />
          {prestart ? "저장 후 시작" : "저장 후 다시 시작"}
        </button>
      </div>
    </>
  );
}
