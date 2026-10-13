// The profile window: pick a saved profile or make a new one, then start (opens Home).
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";
import { api, errorText, formatTime, MODE_NAME, shortPath, type ProfileSummary, type StartMode } from "./session";

const MODE_ICON: Record<StartMode, IconName> = { server: "server", client: "monitor", both: "sliders", ask: "play" };

export function Launcher() {
  const [list, setList] = useState<ProfileSummary[] | null>(null);
  // index into list, -1 = New Profile (the default)
  const [pick, setPick] = useState(-1);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.profiles().then(setList, (e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, []);

  const cur = list && pick >= 0 ? list[pick] : null;
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.open(cur ? cur.name : name, !cur);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!cur || !window.confirm(`프로필 '${cur.name}'을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await api.deleteProfile(cur.name);
      setPick(-1);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const label = (p: ProfileSummary) => (
    <>
      <Icon name={MODE_ICON[p.startMode]} />
      <span className="ddname">{p.name}</span>
      <span className="ddmode">{MODE_NAME[p.startMode]}</span>
    </>
  );
  const count = list?.length ?? 0;

  return (
    <div className="pwin" onClick={() => open && setOpen(false)}>
      <div className="phead">
        <img className="plogo" src="/app-icon.png" alt="" draggable={false} />
        <div>
          <div className="ptitle">PalHelper</div>
          <div className="psub">{count ? "프로필을 선택해 주세요." : "처음 실행입니다. 새 프로필을 만들어 주세요."}</div>
        </div>
      </div>
      <div className="pfield">
        <label>프로필</label>
        <div className="dd">
          <button
            className="ddbtn"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          >
            {cur ? (
              label(cur)
            ) : (
              <>
                <Icon name="plus" />
                <span className="ddname">New Profile</span>
                {count > 0 && <span className="ddused">저장된 프로필 {count}개</span>}
              </>
            )}
            <Icon name="chevron" className="ddchev" />
          </button>
          {open && (
            <div className="ddmenu">
              <div className={`dditem ${pick < 0 ? "on" : ""}`} onClick={() => setPick(-1)}>
                <Icon name="plus" />
                <span className="ddname">New Profile</span>
              </div>
              {count > 0 && <div className="ddsep" />}
              {list?.map((p, i) => (
                <div key={p.name} className={`dditem ${i === pick ? "on" : ""}`} onClick={() => setPick(i)}>
                  {label(p)}
                  <span className="ddused">{formatTime(p.lastUsed)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {cur ? (
        <div className="pinfo">
          <div>
            <span>
              <Icon name="play" />
              시작 모드
            </span>
            <b>
              {MODE_NAME[cur.startMode]}
              {cur.startMode === "ask" ? " (모드 선택 화면을 거칩니다)" : ""}
            </b>
          </div>
          <div>
            <span>
              <Icon name={cur.startMode === "client" ? "globe" : "folder"} />
              {cur.startMode === "client" ? "앱 서버" : "게임 서버"}
            </span>
            <b className="path" title={cur.target ?? ""}>
              {cur.target ? shortPath(cur.target) : "설정 전"}
            </b>
          </div>
          <div>
            <span>
              <Icon name="refresh" />
              마지막 사용
            </span>
            <b>{formatTime(cur.lastUsed)}</b>
          </div>
        </div>
      ) : (
        <div className="pnew">
          <label>프로필 이름</label>
          <input autoFocus placeholder="예: 실제 서버" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} />
          <div className="help">
            시작하면 모드를 고르고 설정을 입력합니다.
            <br />
            설정은 이 이름으로 저장되어 다음부터 목록에서 바로 불러올 수 있습니다.
          </div>
        </div>
      )}
      {error && <div className="err">{error}</div>}
      <div className="pfoot">
        {cur && (
          <button className="btn big danger" onClick={remove}>
            <Icon name="trash" />
            삭제
          </button>
        )}
        <span className="sp" />
        <button className="btn primary big" disabled={busy || (!cur && !name.trim())} onClick={start}>
          <Icon name="play" />
          시작하기
        </button>
      </div>
    </div>
  );
}
