// Home's game server menu: state with start / stop, server info, and the server log as it is
// written. Mock: docs/designs/app-gui-mock.html (게임 서버)
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { showToast } from "./toast";
import { api, errorText, shortPath, type GameServerStatus } from "./session";

type Busy = "starting" | "stopping" | null;
/** an action not confirmed by the server's state after this long stops showing as in progress */
const BUSY_TIMEOUT_MS = 120_000;

export type GsState = "on" | "starting" | "stopping" | "off" | "norest";

/** The state shown for a status (and the action in progress). */
export function gsState(gs: GameServerStatus | null, busy: Busy = null): GsState | null {
  if (!gs) return null;
  if (busy === "stopping" && gs.running) return "stopping";
  if (!gs.running) return busy === "starting" ? "starting" : "off";
  if (!gs.restEnabled) return "norest";
  return gs.restOk ? "on" : "starting";
}

const fmtUptime = (secs: number) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
};

export function GameServerView({ gs, onChanged }: { gs: GameServerStatus | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<Busy>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = gsState(gs, busy);

  // an action ends when the server's state says so
  useEffect(() => {
    if (busy === "starting" && gs?.running && gs.restOk) setBusy(null);
    if (busy === "stopping" && gs && !gs.running) setBusy(null);
  }, [busy, gs]);
  useEffect(() => {
    if (!busy) return;
    const t = window.setTimeout(() => setBusy(null), BUSY_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [busy]);

  const start = async () => {
    setError(null);
    try {
      await api.gsStart();
      setBusy("starting");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const stop = async () => {
    setConfirm(false);
    setError(null);
    try {
      await api.gsStop();
      setBusy("stopping");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const big = { on: "켜짐", starting: "켜는 중…", stopping: "저장 후 끄는 중…", off: "꺼짐", norest: "켜짐" };
  const dot = state === "on" || state === "norest" ? "" : state === "off" ? "off" : "warn";
  const sub =
    state === "on" && gs
      ? [gs.uptime != null && `실행 시간 ${fmtUptime(gs.uptime)}`, gs.players != null && `접속 ${gs.players}명 / ${gs.maxPlayers ?? "?"}명`, gs.fps != null && `서버 FPS ${Math.round(gs.fps)}`].filter(Boolean).join(" · ")
      : state === "starting"
        ? "게임 서버를 시작했습니다. 접속을 받을 수 있게 되면 '켜짐'으로 바뀝니다."
        : state === "stopping"
          ? "월드를 저장했습니다. 서버가 종료되기를 기다리는 중입니다."
          : state === "norest"
            ? "서버 설정에서 관리 API(RESTAPIEnabled)가 꺼져 있어 상태를 읽거나 끌 수 없습니다."
            : "게임 서버가 꺼져 있습니다.";

  return (
    <>
      <h2>게임 서버</h2>
      <p className="lead">이 프로필의 게임 서버를 켜고 끄고, 서버 로그를 봅니다.</p>
      <div className="gscard">
        <div className="gsicon">
          <Icon name="server" className="lg" />
        </div>
        <div className="gsmain">
          <div className="gstitle">
            게임 서버{" "}
            <span className="gspath" title={gs?.dir}>
              {gs ? shortPath(gs.dir) : ""}
            </span>
          </div>
          <div className="big">
            <span className={`dot ${state ? dot : "off"}`} />
            {state ? big[state] : "확인 중"}
          </div>
          <div className="sub">{state ? sub : ""}</div>
        </div>
        <div className="gsact">
          {state === "on" || state === "norest" ? (
            <button className="btn danger" disabled={state === "norest"} onClick={() => setConfirm(true)}>
              <Icon name="power" />
              끄기
            </button>
          ) : state === "off" ? (
            <button className="btn primary" onClick={start}>
              <Icon name="play" />
              켜기
            </button>
          ) : (
            <button className="btn" disabled>
              <Icon name="refresh" />
              {state === "stopping" ? "끄는 중" : "켜는 중"}
            </button>
          )}
        </div>
      </div>
      {error && <div className="err" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="sec">
        <span>
          <Icon name="info" />
          서버 정보
        </span>
        <span />
      </div>
      <div className="gsinfo">
        {(
          [
            ["폴더", gs ? shortPath(gs.dir) : "-", gs?.dir],
            ["서버 이름", gs?.serverName ?? "-"],
            ["버전", gs?.version ?? "-"],
            ["실행 시간", gs?.uptime != null ? fmtUptime(gs.uptime) : "-"],
            ["접속", gs?.players != null ? `${gs.players}명 / ${gs.maxPlayers ?? "?"}명` : "-"],
            ["서버 FPS", gs?.fps != null ? String(Math.round(gs.fps)) : "-"],
          ] as [string, string, string?][]
        ).map(([k, v, title]) => (
          <span className="kvr" key={k}>
            <span>{k}</span>
            <b title={title}>{v}</b>
          </span>
        ))}
      </div>
      <Announce enabled={state === "on"} />
      <ServerLog />
      {confirm && (
        <div className="modal-back">
          <div className="modal">
            <h3>
              <Icon name="power" className="lg" />
              게임 서버 끄기
            </h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.6, color: "#c9d1d9" }}>
              월드를 저장한 뒤 게임 서버를 끕니다.
              {gs?.players ? (
                <>
                  <br />
                  접속 중인 플레이어 {gs.players}명의 연결이 끊깁니다.
                </>
              ) : null}
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirm(false)}>
                취소
              </button>
              <button className="btn danger-fill" onClick={stop}>
                <Icon name="power" />
                저장 후 끄기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const MAX_LINES = 1000;

/** The server log as it is written ("pd" = PalDefender, "mod" = UE4SS). */
/** longest announcement the field takes */
const ANNOUNCE_MAX = 200;

/**
 * Sends an announcement to every player on the server: the red server notice banner and a chat
 * line. How it went shows as a toast.
 * Mock: docs/designs/announce-mock.html (A).
 */
function Announce({ enabled }: { enabled: boolean }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    const message = text.trim();
    if (!enabled || sending || !message) return;
    setSending(true);
    try {
      const note = await api.gsAnnounce(message);
      setText("");
      if (note) showToast(`채팅에는 보냈지만 ${note}`, "bad");
      else showToast("공지를 보냈습니다.", "ok");
    } catch (e) {
      showToast(`공지를 보내지 못했습니다. ${errorText(e)}`, "bad");
    }
    setSending(false);
  };
  return (
    <>
      <div className="sec">
        <span>
          <Icon name="megaphone" />
          공지 보내기
        </span>
        <span>접속한 모든 플레이어의 채팅에 표시됩니다.</span>
      </div>
      <div className="row announce">
        <span className="field">
          <input
            value={text}
            maxLength={ANNOUNCE_MAX}
            disabled={!enabled}
            placeholder={enabled ? "보낼 문구 (예: 10분 뒤 서버를 재시작합니다)" : "게임 서버가 켜져 있을 때 보낼 수 있습니다."}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
            }}
          />
          <span className="count tabular">
            {text.length}/{ANNOUNCE_MAX}
          </span>
        </span>
        <button className="btn primary" disabled={!enabled || sending || !text.trim()} onClick={send}>
          <Icon name="send" />
          보내기
        </button>
      </div>
    </>
  );
}

function ServerLog() {
  const [source, setSource] = useState<"pd" | "mod">("pd");
  const [file, setFile] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  // follow the end only while the view is at the bottom
  const atBottom = useRef(true);

  useEffect(() => {
    setLines([]);
    setFile(null);
    const un = listen<{ source: string; file: string | null; reset: boolean; lines: string[] }>("gs-log", (e) => {
      if (e.payload.source !== source) return;
      setFile(e.payload.file);
      setLines((cur) => (e.payload.reset ? e.payload.lines : [...cur, ...e.payload.lines]).slice(-MAX_LINES));
    });
    api.gsLogFollow(source).catch(() => {});
    return () => {
      un.then((f) => f());
    };
  }, [source]);

  useEffect(() => {
    const el = box.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <>
      <div className="sec">
        <span>
          <Icon name="log" />
          서버 로그
        </span>
        <span />
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="switch small">
          <span className={source === "pd" ? "on" : ""} onClick={() => setSource("pd")}>
            서버 (PalDefender)
          </span>
          <span className={source === "mod" ? "on" : ""} onClick={() => setSource("mod")}>
            모드 (UE4SS)
          </span>
        </div>
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }} title={file ?? ""}>
          {file ? file.split("\\").slice(-2).join("\\") : "로그 파일 없음"}
        </span>
        <button className="btn small" onClick={() => api.gsLogDir(source).then(api.openPath)}>
          <Icon name="folder" />
          로그 폴더 열기
        </button>
      </div>
      <div
        className="log gslog"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {lines.map((l, i) => (
          <div key={i} className="info">
            {l}
          </div>
        ))}
        {!lines.length && <div className="empty">표시할 로그가 없습니다.</div>}
      </div>
    </>
  );
}
