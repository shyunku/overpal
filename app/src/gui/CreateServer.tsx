// Making a new game server from Overpal: SteamCMD downloads the server, its settings are filled in,
// then UE4SS, PalDefender and the Overpal mod go in, one step after the other.
// Mock: docs/designs/server-setup-mock.html (③).
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { api, errorText } from "./session";
import { showToast } from "./toast";

interface Progress {
  step: number;
  text: string;
  pct: number | null;
}
interface InstallProgress {
  part: string;
  text: string;
  pct: number | null;
}

const STEPS: [string, string][] = [
  ["SteamCMD 받기", "Steam 서버 설치 도구"],
  ["팰월드 서버 받기", "app 2394010"],
  ["설정 파일 만들기", "서버의 기본 설정에서"],
  ["설정 채우기", "서버 이름, 비밀번호, 관리 API(REST)"],
  ["UE4SS 설치", "팰월드용 2281fa31"],
  ["PalDefender 설치", "v1.9.3, REST와 토큰"],
  ["Overpal 모드 설치", ""],
];

/** a password of letters and digits, from the browser's random source */
function newPassword(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(r, (n) => abc[n % abc.length]).join("");
}

export function CreateServer({ gamePort, onCreated, onClose }: { gamePort: number; onCreated: (dir: string) => void; onClose: () => void }) {
  const [dir, setDir] = useState("");
  const [name, setName] = useState("");
  const [adminPassword, setAdminPassword] = useState(newPassword);
  const [serverPassword, setServerPassword] = useState("");
  const [phase, setPhase] = useState<"form" | "making" | "failed" | "made">("form");
  const [error, setError] = useState<string | null>(null);
  // the step being worked on (STEPS.length when all are done), and its progress
  const [at, setAt] = useState(0);
  const [now, setNow] = useState<{ text: string; pct: number | null }>({ text: "", pct: null });

  useEffect(() => {
    const un = listen<Progress>("create-progress", ({ payload: p }) => {
      if (p.pct === 100) {
        setAt(p.step + 1);
        setNow({ text: "", pct: null });
      } else {
        setAt(p.step);
        setNow({ text: p.text, pct: p.pct });
      }
    });
    // UE4SS and PalDefender report their own downloads
    const un2 = listen<InstallProgress>("install-progress", ({ payload: p }) => {
      if (p.pct !== 100 && p.pct !== null) setNow({ text: `${p.pct.toFixed(0)}%`, pct: p.pct });
    });
    return () => {
      un.then((f) => f());
      un2.then((f) => f());
    };
  }, []);

  const canMake = dir.trim() !== "" && name.trim() !== "" && adminPassword.trim() !== "";
  const make = async () => {
    setPhase("making");
    setError(null);
    setAt(0);
    setNow({ text: "", pct: null });
    try {
      await api.createServer(dir.trim(), name.trim(), adminPassword.trim(), serverPassword.trim());
      setAt(STEPS.length);
      setPhase("made");
      onCreated(dir.trim());
      showToast("새 게임 서버를 만들었습니다.", "ok");
    } catch (e) {
      setError(errorText(e));
      setPhase("failed");
    }
  };

  return (
    <div className="modal-back">
      <div className="modal create">
        <h3>
          <Icon name="plus" className="lg" />
          새 게임 서버 만들기
        </h3>
        <p className="lead">Steam의 서버 설치 도구(SteamCMD)로 팰월드 전용 서버를 받고, Overpal에 필요한 것까지 설치합니다.</p>
        {phase === "form" ? (
          <>
            <div className="field">
              <label>설치할 폴더</label>
              <div className="row">
                <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="서버를 설치할 빈 폴더" />
                <button className="btn" onClick={() => api.pickFolder().then((d) => d && setDir(d))}>
                  <Icon name="folder" />
                </button>
              </div>
            </div>
            <div className="field">
              <label>서버 이름</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="우리 팰월드 서버" />
            </div>
            <div className="field">
              <label>관리자 비밀번호</label>
              <div>
                <div className="row">
                  <input value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
                  <button className="btn small" onClick={() => setAdminPassword(newPassword())}>
                    새로 만들기
                  </button>
                </div>
                <div className="help">서버 관리에 쓰입니다. 자동으로 만든 값을 그대로 써도 됩니다.</div>
              </div>
            </div>
            <div className="field">
              <label>접속 비밀번호</label>
              <div>
                <input value={serverPassword} onChange={(e) => setServerPassword(e.target.value)} placeholder="없으면 누구나 접속" />
                <div className="help">친구들이 서버에 들어올 때 입력하는 비밀번호입니다.</div>
              </div>
            </div>
            <div className="help">약 5~8GB를 받습니다. 몇 분 걸릴 수 있습니다.</div>
          </>
        ) : (
          <div className="steps">
            {STEPS.map(([n, sub], i) => {
              const running = i === at && phase === "making";
              const failed = i === at && phase === "failed";
              const st = i < at ? "ok" : running ? "run" : failed ? "no" : "wait";
              return (
                <div key={n} className={`step ${i > at ? "wait" : ""}`}>
                  <span className={`st ${st}`}>{st === "ok" ? "✓" : st === "no" ? "!" : ""}</span>
                  <div>
                    {n} <span className="sub">{sub}</span>
                    {running && now.pct !== null && (
                      <span className="bar">
                        <i style={{ width: `${now.pct}%` }} />
                      </span>
                    )}
                  </div>
                  <span className="sub">{running ? [now.text, now.pct !== null && !now.text.endsWith("%") ? `${now.pct.toFixed(0)}%` : ""].filter(Boolean).join(" · ") : ""}</span>
                </div>
              );
            })}
          </div>
        )}
        {error && <div className="err">{error}</div>}
        <div className="mrow">
          {phase === "form" && (
            <>
              <button className="btn" onClick={onClose}>
                취소
              </button>
              <button className="btn primary" disabled={!canMake} onClick={make}>
                만들기
              </button>
            </>
          )}
          {phase === "making" && (
            <button className="btn" onClick={() => api.cancelCreateServer()}>
              취소
            </button>
          )}
          {phase === "failed" && (
            <>
              <button className="btn" onClick={onClose}>
                닫기
              </button>
              <button className="btn primary" onClick={make}>
                다시 시도
              </button>
            </>
          )}
          {phase === "made" && (
            <>
              <span className="help grow">친구들이 들어오려면 공유기에서 UDP {gamePort}을 이 PC로 포트포워딩해야 합니다.</span>
              <button className="btn primary" onClick={onClose}>
                닫기
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
