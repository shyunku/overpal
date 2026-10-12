import { useState } from "react";
import type { ItemTotal } from "../data/snapshot";
import { itemIconUrl, itemName, matchesItem, missingItems, placesOf } from "./labels";
import { resetPositions, type ItemMode, type Layout, type ViewId } from "./layout";
import { MAP_SIZE, mapPx } from "./mapcoords";
import type { OverlayData } from "./useOverlayData";
import { OverlayWindow } from "./OverlayWindow";

interface ViewProps {
  layout: Layout;
  onLayout: (next: Layout) => void;
  data: OverlayData;
}

const ICONS = {
  map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />,
  box: <path d="M21 8 12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  mini: <path d="M6 4h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 18h8" />,
  grid: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
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
      {btn("items", "box", "아이템 수량")}
      <span className="sep" />
      {btn("settings", "gear", "설정")}
    </OverlayWindow>
  );
}

// ---------------------------------------------------------------- items

// 0.6 with the narrower widths felt cramped; shrink everything instead (340 / 420 of 0.6)
const ITEM_SCALE = 0.49;

export function ItemsWindow({ layout, onLayout, data }: ViewProps) {
  const [tab, setTab] = useState<"total" | "where">("total");
  const [query, setQuery] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [place, setPlace] = useState("all");
  const mode = layout.itemMode;
  const places = placesOf(data.base?.storages ?? []);
  const totals = data.base?.totals ?? [];
  const placeOf = (containerId: string) => places.find((p) => p.storages.some((s) => s.containerId === containerId))?.name ?? "?";
  // while searching, items the base does not have are listed too, with a count of 0
  const found: ItemTotal[] = [
    ...totals.filter((t) => matchesItem(t.item, query)),
    ...missingItems(query, new Set(totals.map((t) => t.item))).map((item) => ({ item, count: 0, sources: [] })),
  ];

  const setMode = (m: ItemMode) => onLayout({ ...layout, itemMode: m });
  const title = data.guild ? `${data.guild.name || "길드"} · 거점 1` : "거점 없음";

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

  const modeBtn = (m: ItemMode, icon: keyof typeof ICONS, label: string) => (
    <button className={mode === m ? "on" : ""} title={label} onClick={() => setMode(m)}>
      <Icon name={icon} />
    </button>
  );

  return (
    <OverlayWindow view="items" layout={layout} onLayout={onLayout} scale={ITEM_SCALE} className={`glass win items mode-${mode}`}>
      <div className="wtitle">
        <div>
          <div className="t">아이템 수량</div>
          <div className="sub">{mode === "hud" ? statusText(data) : `${title} · ${statusText(data)}`}</div>
        </div>
        <span className="grow" />
        <div className="modes">
          {modeBtn("side", "list", "사이드 패널")}
          {modeBtn("hud", "mini", "미니 HUD")}
          {modeBtn("full", "grid", "전체 격자")}
        </div>
      </div>
      {body}
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
