// The app windows' own title bar (they have no Windows frame): drag to move, double-click to
// maximize (Home), minimize / maximize / close.
import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar({ resizable, version, profile }: { resizable: boolean; version?: string | null; profile?: string | null }) {
  const win = getCurrentWindow();
  return (
    <div className="titlebar" data-tauri-drag-region>
      <img className="tlogo" src="/app-icon.png" alt="" draggable={false} data-tauri-drag-region />
      <span className="ttext" data-tauri-drag-region>
        Overpal{version ? ` v${version}` : ""}
        {profile ? ` (Profile: ${profile})` : ""}
      </span>
      <span className="sp" data-tauri-drag-region />
      <button className="wb" title="최소화" onClick={() => win.minimize()}>
        <svg viewBox="0 0 10 10">
          <path d="M1 5h8" />
        </svg>
      </button>
      {resizable && (
        <button className="wb" title="최대화" onClick={() => win.toggleMaximize()}>
          <svg viewBox="0 0 10 10">
            <rect x="1.5" y="1.5" width="7" height="7" />
          </svg>
        </button>
      )}
      <button className="wb close" title="닫기" onClick={() => win.close()}>
        <svg viewBox="0 0 10 10">
          <path d="m1.5 1.5 7 7M8.5 1.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}
