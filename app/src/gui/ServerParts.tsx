// What a game server folder has of what Overpal needs, and installing what is missing (UE4SS,
// PalDefender, its REST), one after the other. Mock: docs/designs/server-setup-mock.html (②).
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { api, errorText, type Detected } from "./session";
import { showToast } from "./toast";

type Part = "ue4ss" | "paldefender" | "pdrest";
interface Progress {
  part: Part;
  text: string;
  pct: number | null;
}

const ORDER: Part[] = ["ue4ss", "paldefender", "pdrest"];
const NAMES: Record<Part, string> = { ue4ss: "UE4SS", paldefender: "PalDefender", pdrest: "PalDefender REST" };

export function ServerParts({ dir, detected, onChanged }: { dir: string; detected: Detected; onChanged: () => void }) {
  const [busy, setBusy] = useState<Part[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    const un = listen<Progress>("install-progress", (e) => setProgress(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const has: Record<Part, boolean> = { ue4ss: detected.hasUe4ss, paldefender: detected.hasPalDefender, pdrest: detected.pdRestEnabled && detected.hasPalDefenderToken };
  const missing = ORDER.filter((p) => !has[p]);
  const install = async (parts: Part[]) => {
    if (busy) return;
    setBusy(parts);
    setProgress(null);
    try {
      const done = await api.installServerParts(dir, parts);
      showToast(`${done.map((p) => NAMES[p as Part]).join(", ")} 설치를 마쳤습니다.`, "ok");
    } catch (e) {
      showToast(`설치하지 못했습니다. ${errorText(e)}`, "bad");
    }
    setBusy(null);
    setProgress(null);
    onChanged();
  };

  const row = (key: string, name: string, what: string, ok: boolean, action: React.ReactNode, running = false, pct: number | null = null) => (
    <div className="part" key={key}>
      <span className={`st ${running ? "run" : ok ? "ok" : "no"}`}>{running ? "" : ok ? "✓" : "!"}</span>
      <span>{name}</span>
      <span className="what">
        {what}
        {running && pct !== null && (
          <span className="bar">
            <i style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
      {action}
    </div>
  );
  const partRow = (p: Part, what: string) => {
    const running = !!busy && progress?.part === p;
    const action = running ? (
      <span className="what">{progress?.pct != null ? `${progress.pct.toFixed(0)}%` : ""}</span>
    ) : has[p] ? (
      <span className="what">확인됨</span>
    ) : (
      <button className="btn small" disabled={!!busy || !detected.hasServer} onClick={() => install([p])}>
        설치
      </button>
    );
    return row(p, NAMES[p], what, has[p], action, running, running ? (progress?.pct ?? null) : null);
  };

  return (
    <div className="parts">
      {row("server", "게임 서버", detected.hasServer ? "PalServer" : "PalServer.exe가 없습니다.", detected.hasServer, <span className="what">{detected.hasServer ? "확인됨" : ""}</span>)}
      {partRow("ue4ss", "팰월드용 2281fa31")}
      {partRow("paldefender", "v1.9.3")}
      {partRow("pdrest", "Overpal이 플레이어·길드 정보를 읽는 데 씁니다.")}
      {row("mod", "Overpal 모드", "서버를 켤 때 자동으로 넣습니다.", detected.hasMod, <span className="what">{detected.hasMod ? "확인됨" : "켤 때 설치됩니다"}</span>)}
      {(missing.length > 0 || busy) && detected.hasServer && (
        <div className="partsfoot">
          <span className="what">{busy ? (progress?.text ?? "준비 중...") : `빠진 것 ${missing.length}개`}</span>
          <button className="btn primary" disabled={!!busy} onClick={() => install(missing)}>
            {busy ? "설치 중" : "한 번에 설치"}
          </button>
        </div>
      )}
    </div>
  );
}
