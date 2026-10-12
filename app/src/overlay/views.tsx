import { useState, type ReactNode } from "react";
import type { BaseView, ItemTotal } from "../data/snapshot";
import { itemIconUrl, itemName, matchesItem, missingItems, placesOf } from "./labels";
import { resetPositions, type ItemMode, type Layout, type MainTab, type ViewId } from "./layout";
import { MAP_SIZE, mapPx } from "./mapcoords";
import type { OverlayData } from "./useOverlayData";
import { OverlayWindow } from "./OverlayWindow";
import { DexDetail, DexList, dexSummary, useDex, type DexTab } from "./dexViews";
import type { Dex } from "../data/dex";

interface ViewProps {
  layout: Layout;
  onLayout: (next: Layout) => void;
  data: OverlayData;
}

const ICONS = {
  map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />,
  box: <path d="M21 8 12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" />,
  // cog (lucide "settings", ISC)
  gear: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  mini: <path d="M6 4h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 18h8" />,
  grid: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  bag: <path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  paw: (
    <>
      <circle cx="8" cy="7" r="2" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
      <path d="M8 18c0-3 2-5 4-5s4 2 4 5c0 2-8 2-8 0z" />
    </>
  ),
  house: <path d="M3 21h18M5 21V10l7-5 7 5v11M10 21v-6h4v6" />,
  pin: (
    <>
      <path d="M12 21s-7-6-7-12a7 7 0 0 1 14 0c0 6-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="ic" viewBox="0 0 24 24">
      {ICONS[name]}
    </svg>
  );
}

function ItemIcon({ id }: { id: string }) {
  const url = itemIconUrl(id);
  // items without an icon show the first letter of their name
  return url ? <img className="item-icon" src={url} alt="" draggable={false} /> : <span className="item-icon">{itemName(id).slice(0, 1)}</span>;
}

const statusText = (d: OverlayData) =>
  d.conn === "down" ? "연결 끊김 · 재시도 중" : d.ageSeconds === null ? "불러오는 중" : `${d.ageSeconds}초 전 갱신${d.conn === "stale" ? " · 모드 응답 없음" : ""}`;
const dotClass = (d: OverlayData) => (d.conn === "ok" ? "" : d.conn === "stale" ? "warn" : "bad");

function setOpen(layout: Layout, view: ViewId, open: boolean): Layout {
  return { ...layout, windows: { ...layout.windows, [view]: { ...layout.windows[view], open } } };
}

function CloseButton({ view, layout, onLayout }: { view: ViewId; layout: Layout; onLayout: (l: Layout) => void }) {
  return (
    <button className="wclose" title="닫기" onClick={() => onLayout(setOpen(layout, view, false))}>
      ×
    </button>
  );
}

// ---------------------------------------------------------------- menu bar

export function MenuBar({ layout, onLayout, data }: ViewProps) {
  const btn = (view: ViewId, icon: keyof typeof ICONS, label: string) => (
    <button className={`mbtn ${layout.windows[view].open ? "on" : ""}`} onClick={() => onLayout(setOpen(layout, view, !layout.windows[view].open))}>
      <Icon name={icon} />
      <span className="tip">{label}</span>
    </button>
  );
  return (
    <OverlayWindow view="menubar" layout={layout} onLayout={onLayout} className="glass menubar">
      <span className={`dot ${dotClass(data)}`} title={statusText(data)} />
      {btn("minimap", "map", "미니맵")}
      {btn("items", "box", "메인 창")}
      <span className="sep" />
      {btn("settings", "gear", "설정")}
    </OverlayWindow>
  );
}

// ---------------------------------------------------------------- items

// 0.49 was too small in game; 25% larger (text included), with the content widths cut to 0.92
// in overlay.css so the window grows 25% in height but only 15% in width
const ITEM_SCALE = 0.6125;

/** `base`: the storages shown (current base + inventory, or a base picked from the menu); `notice` goes under the search box. */
function ItemsTab({ data, mode, base, notice }: { data: OverlayData; mode: ItemMode; base: BaseView | null; notice?: ReactNode }) {
  const [tab, setTab] = useState<"total" | "where">("total");
  const [query, setQuery] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [place, setPlace] = useState("all");
  const places = placesOf(base?.storages ?? []);
  const totals = base?.totals ?? [];
  const placeOf = (containerId: string) => places.find((p) => p.storages.some((s) => s.containerId === containerId))?.name ?? "?";
  // while searching, items the base does not have are listed too, with a count of 0
  const found: ItemTotal[] = [
    ...totals.filter((t) => matchesItem(t.item, query)),
    ...missingItems(query, new Set(totals.map((t) => t.item))).map((item) => ({ item, count: 0, sources: [] })),
  ];

  let body;
  if (data.conn === "down" && !data.snapshot) {
    body = <div className="empty">앱 서버에 연결할 수 없음 · 재시도 중</div>;
  } else if (mode === "hud") {
    const rows = [...data.recent.map((r) => ({ item: r.item, delta: r.delta }))];
    for (const t of totals) if (rows.length < 4 && !rows.some((r) => r.item === t.item)) rows.push({ item: t.item, delta: 0 });
    body = (
      <div className={data.conn === "stale" ? "dim" : ""} style={{ paddingBottom: 8 }}>
        {rows.slice(0, 4).map((r) => (
          <div className="hud-row" key={r.item}>
            <ItemIcon id={r.item} />
            <span>{itemName(r.item)}</span>
            {r.delta ? <span className={`delta ${r.delta > 0 ? "up" : "down"}`}>{r.delta > 0 ? `+${r.delta}` : r.delta}</span> : <span />}
            <b className="tabular">{totals.find((t) => t.item === r.item)?.count ?? 0}</b>
          </div>
        ))}
        {!rows.length && <div className="empty">보관 중인 아이템 없음</div>}
      </div>
    );
  } else if (mode === "full") {
    const src = place === "all" ? places : places.filter((p) => p.key === place);
    const t = new Map<string, { item: string; count: number; sources: [string, number][] }>();
    for (const p of src)
      for (const s of p.storages)
        for (const it of s.items) {
          const e = t.get(it.item) ?? { item: it.item, count: 0, sources: [] };
          e.count += it.count;
          const prev = e.sources.find(([n]) => n === p.name);
          if (prev) prev[1] += it.count;
          else e.sources.push([p.name, it.count]);
          t.set(it.item, e);
        }
    const list = [
      ...[...t.values()].sort((a, b) => b.count - a.count).filter((x) => matchesItem(x.item, query)),
      ...missingItems(query, new Set(t.keys())).map((item) => ({ item, count: 0, sources: [] as [string, number][] })),
    ];
    body = (
      <>
        <input className="search" placeholder="아이템 검색" value={query} onChange={(e) => setQuery(e.target.value.trim())} />
        {notice}
        <div className={`full-body ${data.conn === "stale" ? "dim" : ""}`}>
          <div className="filters">
            {[{ key: "all", name: "전체" }, ...places].map((p) => (
              <div key={p.key} className={place === p.key ? "on" : ""} onClick={() => setPlace(p.key)}>
                {p.name}
              </div>
            ))}
          </div>
          <div className="tiles">
            {list.map((x) => (
              <div className="tile" key={x.item}>
                <span className="tn">{itemName(x.item)}</span>
                <ItemIcon id={x.item} />
                <span className={`n tabular ${x.count ? "" : "none"}`}>{x.count}</span>
                <div className="tt">
                  <b>
                    {itemName(x.item)} {x.count}
                  </b>
                  {x.sources.map(([n, v]) => (
                    <div key={n}>
                      <span>{n}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="tabs">
          <b className={tab === "total" ? "on" : ""} onClick={() => setTab("total")}>
            합계
          </b>
          <b className={tab === "where" ? "on" : ""} onClick={() => setTab("where")}>
            위치별
          </b>
        </div>
        {tab === "total" && <input className="search" placeholder="아이템 검색" value={query} onChange={(e) => setQuery(e.target.value.trim())} />}
        {notice}
        <div className={`scroll ${data.conn === "stale" ? "dim" : ""}`}>
          {tab === "where" ? (
            <div className="groups">
              {places
                .filter((p) => p.storages.some((s) => s.items.length))
                .map((p) => {
                  const items = new Map<string, number>();
                  for (const s of p.storages) for (const it of s.items) items.set(it.item, (items.get(it.item) ?? 0) + it.count);
                  return (
                    <div className="gbox" key={p.key}>
                      <div className="gname">
                        <span>{p.name}</span>
                        <span>{items.size}종</span>
                      </div>
                      <div className="chips">
                        {[...items].map(([id, n]) => (
                          <span className="chipitem" key={id}>
                            <ItemIcon id={id} />
                            <span>{itemName(id)}</span>
                            <b className="tabular">{n}</b>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <div className="rows">
              {found.map((t) => (
                <div key={t.item} className={`row ${openRow === t.item ? "open" : ""}`} onClick={() => setOpenRow(openRow === t.item ? null : t.item)}>
                  <ItemIcon id={t.item} />
                  <span>{itemName(t.item)}</span>
                  <span className={`count tabular ${t.count ? "" : "none"}`}>{t.count}</span>
                  {openRow === t.item && (
                    <div className="sources">
                      {t.sources.map((s) => (
                        <span key={s.containerId}>
                          {placeOf(s.containerId)} · {s.count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {!found.length && <div className="empty">{query ? "검색 결과 없음" : "보관 중인 아이템 없음"}</div>}
            </div>
          )}
        </div>
      </>
    );
  }

  return body;
}

// ---------------------------------------------------------------- main window

const TABS: { id: MainTab; icon: keyof typeof ICONS; label: string }[] = [
  { id: "items", icon: "bag", label: "아이템" },
  { id: "pals", icon: "paw", label: "팰" },
  { id: "structs", icon: "house", label: "구조물" },
  { id: "places", icon: "pin", label: "장소" },
];

interface OtherTabProps {
  tab: DexTab;
  mode: ItemMode;
  sub: "mine" | "dex";
  onSub: (s: "mine" | "dex") => void;
  query: string;
  onQuery: (q: string) => void;
  dex: Dex | null;
  detail: string | null;
  onOpen: (id: string) => void;
}

/**
 * Pals, structures and places: "mine" (this server) or "dex" (game data).
 * "mine" is filled in by 19.5 of #19; the compact layout shows only "mine".
 */
function OtherTab({ tab, mode, sub, onSub, query, onQuery, dex, detail, onOpen }: OtherTabProps) {
  if (mode === "hud") return <div className="empty">준비 중</div>;
  if (detail && sub === "dex" && dex) return <DexDetail dex={dex} tab={tab} id={detail} />;
  const subTabs = (
    <div className="tabs">
      <b className={sub === "mine" ? "on" : ""} onClick={() => onSub("mine")}>
        내 것
      </b>
      <b className={sub === "dex" ? "on" : ""} onClick={() => onSub("dex")}>
        도감
      </b>
    </div>
  );
  const search = <input className="search" placeholder="검색" value={query} onChange={(e) => onQuery(e.target.value.trim())} />;
  if (sub === "dex") {
    return (
      <>
        {subTabs}
        {search}
        {dex ? <DexList dex={dex} tab={tab} mode={mode} query={query} onOpen={onOpen} /> : <div className="empty">도감 불러오는 중</div>}
      </>
    );
  }
  if (mode === "full") {
    return (
      <>
        {subTabs}
        {search}
        <div className="full-body">
          <div className="filters">
            <div className="on">전체</div>
          </div>
          <div className="empty">준비 중</div>
        </div>
      </>
    );
  }
  return (
    <>
      {subTabs}
      {search}
      <div className="scroll">
        <div className="empty">준비 중</div>
      </div>
    </>
  );
}

function distanceText(a: { x: number; y: number } | null, b: { x: number; y: number }): string {
  if (!a) return "";
  // world units are cm
  const m = Math.hypot(a.x - b.x, a.y - b.y) / 100;
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

/** Drop-down under the base name: follow the player ("현재 위치") or look at one base. */
function BaseMenu(props: {
  bases: BaseView[];
  me: { x: number; y: number } | null;
  hereIndex: number;
  pickedIndex: number;
  hereLabel: string;
  onPick: (campId: string | null) => void;
  onClose: () => void;
}) {
  const { bases, me, hereIndex, pickedIndex, hereLabel, onPick, onClose } = props;
  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div className="basemenu">
        <div className={pickedIndex < 0 ? "on" : ""} onClick={() => onPick(null)}>
          <span>현재 위치 (자동)</span>
          <small>{hereLabel}</small>
        </div>
        <div className="sep" />
        {bases.map((b, i) => (
          <div key={b.campId} className={pickedIndex === i ? "on" : ""} onClick={() => onPick(b.campId)}>
            <span>거점 {i + 1}</span>
            <small>
              {i === hereIndex ? "여기" : distanceText(me, b.worldPos)} · {b.totals.reduce((a, t) => a + t.count, 0)}개
            </small>
          </div>
        ))}
      </div>
    </>
  );
}

export function MainWindow({ layout, onLayout, data }: ViewProps) {
  const tab = layout.mainTab;
  const mode = layout.modes[tab];
  const [queries, setQueries] = useState<Record<DexTab, string>>({ pals: "", structs: "", places: "" });
  // item shown in place of the list (opened from a list row); cleared when the tab changes
  const [detail, setDetail] = useState<string | null>(null);
  // a base picked from the menu instead of the one the player is in (campId); its items are shown
  // without the inventory until "현재로"
  const [picked, setPicked] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const dex = useDex();
  const bases = data.guild?.bases ?? [];
  const pickedIndex = picked ? bases.findIndex((b) => b.campId === picked) : -1;
  const shownBase = pickedIndex >= 0 ? bases[pickedIndex] : data.base;
  const setTab = (t: MainTab) => {
    setDetail(null);
    onLayout({ ...layout, mainTab: t });
  };
  const setMode = (m: ItemMode) => onLayout({ ...layout, modes: { ...layout.modes, [tab]: m } });
  const label = TABS.find((x) => x.id === tab)!.label;
  const hereLabel = data.baseIndex >= 0 ? `거점 ${data.baseIndex + 1}` : "거점 밖";
  const baseLabel = pickedIndex >= 0 ? `거점 ${pickedIndex + 1}` : hereLabel;
  const baseNote = pickedIndex >= 0 ? "보는 중" : data.baseIndex >= 0 ? "+ 내 인벤토리" : "내 인벤토리만";
  const subText =
    tab === "items" ? (
      mode === "hud" ? (
        statusText(data)
      ) : (
        <>
          <button className={`basebtn ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(!menuOpen)}>
            {baseLabel}
            <Icon name="chevron" />
          </button>
          <span className="rest">
            · {baseNote} · {statusText(data)}
          </span>
        </>
      )
    ) : layout.subs[tab] === "dex" && mode !== "hud" ? (
      dexSummary(dex, tab)
    ) : (
      "준비 중"
    );
  const pick = (campId: string | null) => {
    setPicked(campId);
    setMenuOpen(false);
  };
  const notice =
    pickedIndex >= 0 ? (
      <div className="base-notice">
        <span>거점 {pickedIndex + 1} 보는 중 · 내 인벤토리 미포함</span>
        <button onClick={() => pick(null)}>현재로 ↺</button>
      </div>
    ) : undefined;
  // a detail is always shown at the normal width, also when opened from the wide layout
  const shownMode = detail ? "side" : mode;

  const modeBtn = (m: ItemMode, icon: keyof typeof ICONS, title: string) => (
    <button className={mode === m ? "on" : ""} title={title} onClick={() => setMode(m)}>
      <Icon name={icon} />
    </button>
  );

  return (
    <OverlayWindow view="items" layout={layout} onLayout={onLayout} scale={ITEM_SCALE} className={`glass win items mode-${shownMode}${detail ? " is-detail" : ""}`}>
      <nav className="rail">
        {TABS.map((x) => (
          <button key={x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>
            <Icon name={x.icon} />
            <span className="tip">{x.label}</span>
          </button>
        ))}
      </nav>
      <div className="mainbody">
        <div className="wtitle">
          {detail && (
            <button className="back" title="목록으로" onClick={() => setDetail(null)}>
              ‹
            </button>
          )}
          <div className="ttl">
            <div className="t">{label}</div>
            <div className="sub">{subText}</div>
          </div>
          <div className="modes">
            {modeBtn("hud", "mini", "컴팩트")}
            {modeBtn("side", "list", "일반")}
            {modeBtn("full", "grid", "와이드")}
          </div>
        </div>
        {tab === "items" && menuOpen && mode !== "hud" && (
          <BaseMenu bases={bases} me={data.me?.worldPos ?? null} hereIndex={data.baseIndex} pickedIndex={pickedIndex} hereLabel={hereLabel} onPick={pick} onClose={() => setMenuOpen(false)} />
        )}
        {tab === "items" ? (
          <ItemsTab data={data} mode={mode} base={mode === "hud" ? data.base : shownBase} notice={notice} />
        ) : (
          <OtherTab
            tab={tab}
            mode={mode}
            sub={layout.subs[tab]}
            onSub={(s) => {
              setDetail(null);
              onLayout({ ...layout, subs: { ...layout.subs, [tab]: s } });
            }}
            query={queries[tab]}
            onQuery={(q) => setQueries({ ...queries, [tab]: q })}
            dex={dex}
            detail={detail}
            onOpen={setDetail}
          />
        )}
      </div>
    </OverlayWindow>
  );
}

// ---------------------------------------------------------------- minimap

const MINIMAP_SIZE = 169;
/** map pixels shown across the minimap */
const MINIMAP_SPAN = 160;

export function MinimapWindow({ layout, onLayout, data }: ViewProps) {
  const camps = data.guild?.bases ?? [];
  const center = data.me ? mapPx(data.me.mapPos.x, data.me.mapPos.y) : camps[0] ? mapPx(camps[0].mapPos.x, camps[0].mapPos.y) : null;
  const k = MINIMAP_SIZE / MINIMAP_SPAN;
  const toView = ([x, y]: [number, number]) => center && { left: (x - center[0]) * k + MINIMAP_SIZE / 2, top: (y - center[1]) * k + MINIMAP_SIZE / 2 };

  return (
    <OverlayWindow view="minimap" layout={layout} onLayout={onLayout} passive className="glass round minimap-win">
      <div className={`minimap ${data.conn !== "ok" ? "dim" : ""}`}>
        {center ? (
          <>
            <div
              className="map-img"
              style={{
                backgroundSize: `${MAP_SIZE * k}px`,
                backgroundPosition: `${-(center[0] * k - MINIMAP_SIZE / 2)}px ${-(center[1] * k - MINIMAP_SIZE / 2)}px`,
              }}
            />
            {camps.map((c) => (
              <span key={c.campId} className="mk base" style={toView(mapPx(c.mapPos.x, c.mapPos.y)) ?? undefined} />
            ))}
            {(data.snapshot?.players ?? [])
              .filter((p) => p.online || p.uid === data.me?.uid)
              .map((p) => (
                <span key={p.uid} className={`mk ${p.uid === data.me?.uid ? "me" : "friend"}`} style={toView(mapPx(p.mapPos.x, p.mapPos.y)) ?? undefined} title={p.name} />
              ))}
          </>
        ) : (
          <div className="empty">위치 정보 없음</div>
        )}
      </div>
    </OverlayWindow>
  );
}

// ---------------------------------------------------------------- settings

// about 25% larger than the item window
const SETTINGS_SCALE = ITEM_SCALE * 1.25;

export function SettingsWindow({ layout, onLayout }: ViewProps) {
  return (
    <OverlayWindow view="settings" layout={layout} onLayout={onLayout} scale={SETTINGS_SCALE} className="glass win settings">
      <div className="wtitle">
        <div className="t">설정</div>
        <span className="grow" />
        <CloseButton view="settings" layout={layout} onLayout={onLayout} />
      </div>
      <div className="set">
        <div className="r">
          <span>창 위치</span>
          <span>
            <button className={`btn ${layout.editMode ? "on" : ""}`} onClick={() => onLayout({ ...layout, editMode: !layout.editMode })}>
              {layout.editMode ? "편집 끝내기" : "편집"}
            </button>{" "}
            <button className="btn" onClick={() => onLayout(resetPositions(layout))}>
              초기화
            </button>
          </span>
        </div>
      </div>
    </OverlayWindow>
  );
}
