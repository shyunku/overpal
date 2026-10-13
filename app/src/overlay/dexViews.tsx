// The main window's "도감" (dex) views for pals, structures and places: lists for the normal
// and wide layouts, and the detail shown in place of the list. Mock: docs/designs/main-window-mock.html
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { dexIconUrl, loadDex, type Dex, type DexPal, type DexStruct, type DexWork } from "../data/dex";
import { fetchProgression, loadClientConfig } from "../api";
import { itemIconUrl, itemName, textMatches } from "./labels";
import type { ItemMode, SubTab } from "./layout";

export type DexTab = SubTab;
type MarkerKey = keyof Dex["markers"];
const MARKER_KEYS: MarkerKey[] = ["fast", "tower", "dungeon", "alpha"];

/** captures that still give a bonus, per pal (the game counts up to this many) */
export const CAPTURE_BONUS_MAX = 5;
const CAPTURE_POLL_MS = 3000;

/**
 * Capture bonus count per pal for the player (PalDefender progression), keyed by the pal's
 * internal name in lower case (PalDefender writes e.g. "Sheepball" for SheepBall).
 */
export function useCaptureBonus(playerUid: string | undefined): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!playerUid) return;
    let stopped = false;
    let timer: number | undefined;
    const run = async () => {
      try {
        const cfg = await loadClientConfig();
        const r = await fetchProgression(cfg, playerUid);
        const raw = r.Progression?.Captures?.palCaptureBonusCounts ?? {};
        if (!stopped) setCounts(new Map(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), Number(v) || 0])));
      } catch {
        // PalDefender is optional; keep what we had
      }
      if (!stopped) timer = window.setTimeout(run, CAPTURE_POLL_MS);
    };
    run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [playerUid]);
  return counts;
}

export function useDex(): Dex | null {
  const [dex, setDex] = useState<Dex | null>(null);
  useEffect(() => {
    loadDex().then(setDex, () => setDex(null));
  }, []);
  return dex;
}

function DexIcon({ name, className = "dx-ico" }: { name: string | null | undefined; className?: string }) {
  const url = dexIconUrl(name);
  return url ? <img className={className} src={url} alt="" draggable={false} /> : <span className={className} />;
}

function ItemChip({ id, text }: { id: string; text: string }) {
  const url = itemIconUrl(id);
  return (
    <span className="dx-chip">
      {url ? <img src={url} alt="" draggable={false} /> : <span />}
      {text}
    </span>
  );
}

function WorkChips({ works }: { works: DexWork[] }) {
  return (
    <div className="dx-chips">
      {works.map((w) => (
        <span className="dx-chip" key={w.icon + w.lv}>
          <DexIcon name={w.icon} className="" />
          {w.name ? `${w.name} ${w.lv}` : `Lv ${w.lv}`}
        </span>
      ))}
    </div>
  );
}

const Box = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="dx-box">
    <h4>{title}</h4>
    {children}
  </div>
);

const Section = ({ label, count, children }: { label: string; count: number; children: ReactNode }) => (
  <>
    <div className="dx-sec">
      <span>{label}</span>
      <span>{count}</span>
    </div>
    {children}
  </>
);

/** Groups items by a key, keeping first-seen order. */
function groupBy<T>(list: T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return [...m];
}

const palMatches = (p: DexPal, q: string) => !q || textMatches(p.name, q) || p.no.includes(q) || p.works.some((w) => textMatches(w.name, q));
const structMatches = (s: DexStruct, q: string) => !q || textMatches(s.name, q) || textMatches(s.cat ?? "", q);

// ---------------------------------------------------------------- lists

interface ListProps {
  dex: Dex;
  /** capture bonus per pal (useCaptureBonus) */
  captures: Map<string, number>;
  tab: DexTab;
  mode: ItemMode;
  query: string;
  onOpen: (id: string) => void;
}

/** Filter column for the wide layout. */
function Filters({ items, value, onChange }: { items: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="filters">
      {["전체", ...items].map((f) => (
        <div key={f} className={value === f ? "on" : ""} onClick={() => onChange(f)}>
          {f}
        </div>
      ))}
    </div>
  );
}

/** Pal card: the capture bonus fills it from the bottom, N/5 in the top right once captured. */
function PalTile({ p, captures, onOpen }: { p: DexPal; captures: Map<string, number>; onOpen: (id: string) => void }) {
  const n = Math.min(captures.get(p.code.toLowerCase()) ?? 0, CAPTURE_BONUS_MAX);
  const fill = (n / CAPTURE_BONUS_MAX) * 100;
  return (
    <div
      className={`dx-tile ${n >= CAPTURE_BONUS_MAX ? "cap-full" : ""}`}
      style={n ? { background: `linear-gradient(to top, rgba(255, 214, 64, 0.28) ${fill}%, rgba(0, 0, 0, 0.22) ${fill}%)` } : undefined}
      onClick={() => onOpen(p.id)}
    >
      <span className="no">{p.no}</span>
      {n > 0 && (
        <span className="cap">
          {n}/{CAPTURE_BONUS_MAX}
        </span>
      )}
      <DexIcon name={p.icon} />
      <span className="tn">{p.name}</span>
    </div>
  );
}

export function DexList({ dex, captures, tab, mode, query, onOpen }: ListProps) {
  const [filter, setFilter] = useState("전체");
  useEffect(() => setFilter("전체"), [tab]);
  const wide = mode === "full";

  if (tab === "pals") {
    const elements = [...new Set(dex.pals.flatMap((p) => p.elements.map((e) => e.name)))];
    const list = dex.pals.filter((p) => palMatches(p, query) && (!wide || filter === "전체" || p.elements.some((e) => e.name === filter)));
    const grid = (
      <div className={wide ? "dx-tiles" : "dx-grid"}>
        {list.map((p) => (
          <PalTile key={p.id} p={p} captures={captures} onOpen={onOpen} />
        ))}
        {!list.length && <div className="empty">검색 결과 없음</div>}
      </div>
    );
    return wide ? (
      <div className="full-body">
        <Filters items={elements} value={filter} onChange={setFilter} />
        {grid}
      </div>
    ) : (
      <div className="scroll">{grid}</div>
    );
  }

  if (tab === "structs") {
    const cats = [...new Set(dex.structs.map((s) => s.cat ?? "기타"))];
    const list = dex.structs.filter((s) => structMatches(s, query) && (!wide || filter === "전체" || (s.cat ?? "기타") === filter));
    if (wide) {
      return (
        <div className="full-body">
          <Filters items={cats} value={filter} onChange={setFilter} />
          <div className="dx-tiles">
            {list.map((s) => (
              <div className="dx-tile" key={s.id} onClick={() => onOpen(s.id)} data-goal={`struct:${s.id}`}>
                <DexIcon name={s.icon} />
                <span className="tn">{s.name}</span>
              </div>
            ))}
            {!list.length && <div className="empty">검색 결과 없음</div>}
          </div>
        </div>
      );
    }
    return (
      <div className="scroll">
        {groupBy(list, (s) => s.cat ?? "기타").map(([cat, rows]) => (
          <Section key={cat} label={cat} count={rows.length}>
            <div className="rows">
              {rows.map((s) => (
                <div className="row dx-row lv" key={s.id} onClick={() => onOpen(s.id)} data-goal={tab === "structs" ? `struct:${s.id}` : undefined}>
                  <DexIcon name={s.icon} />
                  {/* name and tech level on one line, like the item name and count */}
                  <span className="name">{s.name}</span>
                  <span className="count tabular">Lv {s.techLv ?? "-"}</span>
                </div>
              ))}
            </div>
          </Section>
        ))}
        {!list.length && <div className="empty">검색 결과 없음</div>}
      </div>
    );
  }

  // places: map marker layers
  const layers = MARKER_KEYS.filter((k) => !wide || filter === "전체" || dex.markers[k].label === filter);
  const rows = layers.map((k) => {
    const layer = dex.markers[k];
    const points = layer.points.map((pt, i) => ({ ...pt, i })).filter((pt) => textMatches(pt.n ?? layer.label, query));
    return { k, layer, points };
  });
  const listView = (
    <>
      {rows.map(({ k, layer, points }) =>
        points.length ? (
          <Section key={k} label={layer.label} count={points.length}>
            <div className="rows">
              {points.map((pt) => (
                <div className="row dx-row" key={pt.i} onClick={() => onOpen(`${k}:${pt.i}`)}>
                  <DexIcon name={layer.icon} />
                  <span className="nm">
                    <span>{pt.n || layer.label}</span>
                    <small>
                      {pt.lv ? `Lv ${pt.lv} · ` : ""}좌표 {pt.x}, {pt.y}
                    </small>
                  </span>
                  <span />
                </div>
              ))}
            </div>
          </Section>
        ) : null,
      )}
      {!rows.some((r) => r.points.length) && <div className="empty">검색 결과 없음</div>}
    </>
  );
  return wide ? (
    <div className="full-body">
      <Filters items={MARKER_KEYS.map((k) => dex.markers[k].label)} value={filter} onChange={setFilter} />
      <div className="dx-list">{listView}</div>
    </div>
  ) : (
    <div className="scroll">{listView}</div>
  );
}

// ---------------------------------------------------------------- details

function PalDetail({ p }: { p: DexPal }) {
  return (
    <>
      <div className="dx-head">
        <DexIcon name={p.icon} />
        <div>
          <div className="dn">{p.name}</div>
          <div className="dm">
            {p.no}
            {p.elements.map((e) => (
              <span key={e.name}>
                <DexIcon name={e.icon} className="" />
                {e.name}
              </span>
            ))}
          </div>
        </div>
      </div>
      <Box title="작업 적성">
        <WorkChips works={p.works} />
      </Box>
      <Box title="능력치">
        <div className="dx-kv">
          {Object.entries(p.stats).map(([k, v]) => (
            <span key={k} className="dx-kvrow">
              <span>{k}</span>
              <span>{v ?? "-"}</span>
            </span>
          ))}
        </div>
      </Box>
      {p.partner && (
        <Box title={`파트너 스킬 · ${p.partner.name}`}>
          <p className="dx-desc">{p.partner.desc}</p>
        </Box>
      )}
      {p.drops.length > 0 && (
        <Box title="드롭">
          <div className="dx-chips">
            {p.drops.map((d) => (
              <ItemChip key={d.item} id={d.item} text={`${itemName(d.item)} ${d.qty}`} />
            ))}
          </div>
        </Box>
      )}
    </>
  );
}

function StructDetail({ s }: { s: DexStruct }) {
  return (
    <>
      <div className="dx-head">
        <DexIcon name={s.icon} />
        <div>
          <div className="dn">{s.name}</div>
          <div className="dm">
            {s.cat ?? "기타"} · 기술 Lv {s.techLv ?? "-"}
          </div>
        </div>
      </div>
      {s.mats.length > 0 && (
        <Box title="재료">
          <div className="dx-chips">
            {s.mats.map((m) => (
              <ItemChip key={m.item} id={m.item} text={`${itemName(m.item)} ${m.qty}`} />
            ))}
          </div>
        </Box>
      )}
      {s.works.length > 0 && (
        <Box title="필요 작업 적성">
          <WorkChips works={s.works} />
        </Box>
      )}
    </>
  );
}

function PlaceDetail({ dex, id }: { dex: Dex; id: string }) {
  const [k, i] = id.split(":") as [MarkerKey, string];
  const layer = dex.markers[k];
  const pt = layer?.points[Number(i)];
  if (!pt) return <div className="empty">찾을 수 없음</div>;
  return (
    <>
      <div className="dx-head">
        <DexIcon name={layer.icon} />
        <div>
          <div className="dn">{pt.n || layer.label}</div>
          <div className="dm">{layer.label}</div>
        </div>
      </div>
      <Box title="정보">
        <div className="dx-kv">
          {pt.lv ? (
            <span className="dx-kvrow">
              <span>레벨</span>
              <span>{pt.lv}</span>
            </span>
          ) : null}
          <span className="dx-kvrow">
            <span>지도 좌표</span>
            <span>
              {pt.x}, {pt.y}
            </span>
          </span>
        </div>
      </Box>
    </>
  );
}

export function DexDetail({ dex, tab, id }: { dex: Dex; tab: DexTab; id: string }) {
  const body = useMemo(() => {
    if (tab === "pals") {
      const p = dex.pals.find((x) => x.id === id);
      return p ? <PalDetail p={p} /> : null;
    }
    if (tab === "structs") {
      const s = dex.structs.find((x) => x.id === id);
      return s ? <StructDetail s={s} /> : null;
    }
    return <PlaceDetail dex={dex} id={id} />;
  }, [dex, tab, id]);
  return <div className="scroll dx-detail">{body ?? <div className="empty">찾을 수 없음</div>}</div>;
}

/** Subtitle under the tab title. */
export function dexSummary(dex: Dex | null, tab: DexTab): string {
  if (!dex) return "도감 불러오는 중";
  if (tab === "pals") return `도감 · 팰 ${dex.pals.length}종`;
  if (tab === "structs") return `도감 · 구조물 ${dex.structs.length}개`;
  return `도감 · 장소 ${MARKER_KEYS.reduce((a, k) => a + dex.markers[k].points.length, 0)}곳`;
}
