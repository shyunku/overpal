// The game server's settings (PalWorldSettings.ini) on the game server tab: the common ones with
// Korean names, the rest under 'advanced' by their own names. Values start from the server's
// defaults, or what its settings file has. Written while the server is off; used at the next start.
// Mock: docs/designs/server-settings-mock.html (B).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { api, errorText, type ServerSettings, type ServerOpt } from "./session";
import { ADV_DESC, GROUPS, isBool, isLong, isNumber, shown, type CommonOpt } from "./serverOptions";
import { showToast } from "./toast";

interface Tip {
  desc: string;
  keyName: string;
  def: string;
  left: number;
  top: number;
}

const COMMON_KEYS = new Set(GROUPS.flatMap(([, opts]) => opts.map((o) => o.key)));
const boolText = (v: string) => (/^true$/i.test(v) ? "켬" : "끔");

export function ServerSettingsView({ locked }: { locked: boolean }) {
  const [data, setData] = useState<ServerSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [advOpen, setAdvOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);

  const load = () =>
    api.gsSettingsRead().then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError(errorText(e)),
    );
  // the tooltip stays where it was put: it goes when the page scrolls
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [tip]);
  // read again when the server starts or stops (it may have written its settings)
  useEffect(() => {
    load();
  }, [locked]);

  const byKey = useMemo(() => new Map((data?.options ?? []).map((o) => [o.key, o])), [data]);
  const base = (o: ServerOpt) => shown(o.value ?? o.default);
  const cur = (o: ServerOpt) => edits[o.key] ?? base(o);
  const same = (a: string, b: string) => (isBool(a) && isBool(b) ? a.toLowerCase() === b.toLowerCase() : a === b);
  const dirtyKeys = Object.keys(edits).filter((k) => {
    const o = byKey.get(k);
    return o && !same(edits[k], base(o));
  });
  const set = (key: string, v: string) => setEdits((e) => ({ ...e, [key]: v }));

  if (error) return <div className="err">{error}</div>;
  if (!data) return null;
  const managed = new Set(data.managed);
  const rawDefault = (o: ServerOpt) => o.default ?? o.value ?? "";

  const showTip = (el: HTMLElement, desc: string, keyName: string, def: string) => {
    const r = el.getBoundingClientRect();
    const width = 300;
    let top = r.bottom + 6;
    if (top + 110 > window.innerHeight) top = r.top - 110;
    setTip({
      desc,
      keyName,
      def,
      left: Math.max(8, Math.min(r.left - 8, window.innerWidth - width - 12)),
      top,
    });
  };
  const info = (desc: string, keyName: string, def: string) => (
    <i className="tipi" onMouseEnter={(e) => showTip(e.currentTarget, desc, keyName, def)} onMouseLeave={() => setTip(null)}>
      i
    </i>
  );
  const row = (o: ServerOpt, name: string, mono: boolean, note: string | undefined, desc: string, def: string, control: ReactNode, wide: boolean) => {
    const changed = o.default != null && !same(cur(o), shown(o.default));
    return (
      <div key={o.key} className={`opt ${wide ? "wide" : ""} ${changed ? "changed" : ""}`}>
        <div className="lbl">
          <div className="nmrow">
            <span className={`nm ${mono ? "mono" : ""}`}>{name}</span>
            {info(desc, o.key, def)}
          </div>
          {note && <div className="ds">{note}</div>}
        </div>
        {control}
      </div>
    );
  };
  const toggle = (o: ServerOpt) => {
    const on = /^true$/i.test(cur(o));
    return <button className={`tog ${on ? "on" : ""}`} disabled={locked} onClick={() => set(o.key, on ? "False" : "True")} />;
  };
  const input = (o: ServerOpt, cls = "") => <input className={cls} value={cur(o)} disabled={locked} onChange={(e) => set(o.key, e.target.value)} spellCheck={false} />;

  const commonControl = (c: CommonOpt, o: ServerOpt) => {
    switch (c.kind) {
      case "tog":
        return toggle(o);
      case "num":
        return (
          <div className="num">
            {input(o, "n")}
            <span>{c.unit}</span>
          </div>
        );
      case "sel": {
        const v = cur(o);
        const choices = c.choices!.some(([k]) => k === v) ? c.choices! : [...c.choices!, [v, v] as [string, string]];
        return (
          <select value={v} disabled={locked} onChange={(e) => set(o.key, e.target.value)}>
            {choices.map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
        );
      }
      case "pw":
        return (
          <div className="pw">
            <input type={showPw ? "text" : "password"} value={cur(o)} disabled={locked} onChange={(e) => set(o.key, e.target.value)} spellCheck={false} />
            <button className="btn small" onClick={() => setShowPw(!showPw)}>
              {showPw ? "숨기기" : "보기"}
            </button>
          </div>
        );
      default:
        return input(o);
    }
  };
  const commonDef = (c: CommonOpt, o: ServerOpt) => {
    const d = shown(o.default);
    if (c.kind === "tog") return boolText(d);
    if (c.kind === "sel") return c.choices!.find(([k]) => k === d)?.[1] ?? d;
    if (c.kind === "pw" || d === "") return "(빈 값)";
    return c.unit ? `${d}${c.unit}` : d;
  };

  const advanced = data.options.filter((o) => !COMMON_KEYS.has(o.key) && !managed.has(o.key));
  const advShown = advanced.filter((o) => !query || o.key.toLowerCase().includes(query.trim().toLowerCase()));
  const advRow = (o: ServerOpt) => {
    const raw = rawDefault(o);
    const control = isBool(raw) ? toggle(o) : input(o, isNumber(raw) ? "n" : "");
    const def = o.default == null ? "(없음)" : isBool(o.default) ? boolText(o.default) : shown(o.default) || "(빈 값)";
    return row(o, o.key, true, undefined, ADV_DESC[o.key] ?? "설명이 없는 항목입니다.", def, control, isLong(raw));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.gsSettingsWrite(dirtyKeys.map((k) => [k, edits[k]] as [string, string]));
      showToast("서버 설정을 저장했습니다. 다음에 켤 때 적용됩니다.", "ok");
      setEdits({});
      await load();
    } catch (e) {
      showToast(`저장하지 못했습니다. ${errorText(e)}`, "bad");
    }
    setSaving(false);
  };

  return (
    <div className="ss">
      {locked && (
        <div className="banner info">
          <Icon name="info" />
          <span>서버가 켜져 있는 동안에는 설정을 바꿀 수 없습니다. 서버를 끈 뒤 바꾸면 다음에 켤 때 적용됩니다.</span>
        </div>
      )}
      {data.worldOption && (
        <div className="banner warn">
          <Icon name="alert" />
          <span>
            이 월드에는 <b>WorldOption.sav</b>가 있어 게임 배율·규칙은 이 설정 대신 그 파일을 따릅니다. 서버 이름·비밀번호·인원은 여기 값이 쓰입니다.
            <br />
            월드 설정을 여기로 옮기려면 WorldOption.sav를 지워야 합니다(되돌릴 수 없으니 백업 후).
          </span>
        </div>
      )}
      {!data.hasFile && (
        <div className="banner info">
          <Icon name="info" />
          <span>이 서버에는 아직 설정 파일이 없어 기본값을 보여 드립니다. 저장하면 설정 파일을 만듭니다.</span>
        </div>
      )}
      {GROUPS.map(([g, opts]) => {
        const rows = opts.filter((c) => byKey.has(c.key));
        if (rows.length === 0) return null;
        return (
          <div className="grp" key={g}>
            <h4>{g}</h4>
            <div className="grid">
              {rows.map((c) => {
                const o = byKey.get(c.key)!;
                return row(o, c.name, false, c.note, c.desc, commonDef(c, o), commonControl(c, o), !!c.wide);
              })}
            </div>
          </div>
        );
      })}
      <div className="grp adv">
        <div className="adv-head" onClick={() => setAdvOpen(!advOpen)}>
          <span>{advOpen ? "▾" : "▸"} 고급</span>
          <span className="what">나머지 {advanced.length}개 · 원래 이름 그대로 · 포트와 관리 API는 설정 탭에서</span>
        </div>
        {advOpen && (
          <>
            <div className="adv-tools">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름으로 찾기 (예: Respawn)" spellCheck={false} />
            </div>
            <div className="grid">
              {advShown.filter((o) => !isLong(rawDefault(o))).map(advRow)}
              {advShown.filter((o) => isLong(rawDefault(o))).map(advRow)}
            </div>
          </>
        )}
      </div>
      {dirtyKeys.length > 0 && (
        <div className="savebar">
          <span className="msg">
            바꾼 설정 <b>{dirtyKeys.length}개</b> · 저장하면 다음에 켤 때 적용됩니다.
          </span>
          <button className="btn" onClick={() => setEdits({})}>
            되돌리기
          </button>
          <button className="btn primary" disabled={saving || locked} onClick={save}>
            <Icon name="save" />
            저장
          </button>
        </div>
      )}
      {tip && (
        <div className="ss-tip" style={{ left: tip.left, top: tip.top }}>
          {tip.desc}
          <code>{tip.keyName}</code>
          <span className="def">기본값: {tip.def}</span>
        </div>
      )}
    </div>
  );
}
