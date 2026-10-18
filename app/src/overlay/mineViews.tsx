// The main window's "내 것" (mine) views for pals, structures and places: this server's data in
// the compact, normal and wide layouts, and the detail shown in place of the list.
// Mock: docs/designs/mine-mock.html
import { recipeOf } from "../data/goals";
import { workShare } from "../data/production";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchPlayerPals, loadClientConfig } from "../api";
import { dexIconUrl, type Dex, type DexPal, type DexStruct } from "../data/dex";
import type { PdPal } from "../data/paldefender";
import type { BaseView, PlayerView } from "../data/snapshot";
import type { Building } from "../types";
import type { DexTab } from "./dexViews";
import { buildingName, itemIconUrl, itemName, textMatches } from "./labels";
import type { ItemMode } from "./layout";
import { mapPx, WORLD_PER_PX } from "./mapcoords";
import type { OverlayData } from "./useOverlayData";

/** PalDefender /pals is about 400 KB, so it is polled slower than the player positions */
const PALS_MS = 5000;
/** pal box rows shown before "더 보기" */
const PALBOX_ROWS = 8;
const COMPACT_ROWS = 6;
const NEAR_FAST = 5;
const WIDE_FAST = 20;
/** SAN under this shows a mark next to the name */
const SAN_LOW = 30;
/** hunger under this share counts as needing care in the compact layout (no mark, the gauge shows it) */
const HUNGRY = 0.25;

export interface MinePal {
  /** PalDefender's key of the pal, unique per player */
  key: string;
  /** dex code without the alpha prefix */
  code: string;
  alpha: boolean;
  nick: string;
  lv: number;
  hp: number;
  hunger: number;
  maxHunger: number;
  san: number;
  health: string;
  sick: string;
}

export interface MinePals {
  team: MinePal[];
  palbox: MinePal[];
  /** workers by camp id */
  workers: Map<string, MinePal[]>;
}

const num = (v: string | number | undefined) => Number(v) || 0;

function toPal(key: string, p: PdPal): MinePal {
  const alpha = /^boss_/i.test(p.PalID);
  return {
    key,
    code: p.PalID.replace(/^boss_/i, ""),
    alpha,
    nick: p.Nickname ?? "",
    lv: num(p.Level),
    hp: num(p.HP),
    hunger: num(p.Hunger),
    maxHunger: num(p.MaxHunger),
    san: num(p.SAN),
    health: p.PhysicalHealth ?? "",
    sick: p.WorkerSick ?? "",
  };
}

/** The player's party, pal box and base workers (PalDefender; only while the player is online). */
export function useMinePals(playerUid: string | undefined): MinePals | null {
  const [pals, setPals] = useState<MinePals | null>(null);
  useEffect(() => {
    if (!playerUid) return;
    let stopped = false;
    let timer: number | undefined;
    const run = async () => {
      try {
        const cfg = await loadClientConfig();
        const r = await fetchPlayerPals(cfg, playerUid);
        const list = (rec: Record<string, PdPal> | undefined) => Object.entries(rec ?? {}).map(([k, p]) => toPal(k, p));
        if (!stopped)
          setPals({
            team: list(r.Pals.Team),
            palbox: list(r.Pals.Palbox),
            workers: new Map((r.Pals.BaseCamps ?? []).map((c) => [c.id, list(c.pals)])),
          });
      } catch {
        // offline or PalDefender down; keep what we had
      }
      if (!stopped) timer = window.setTimeout(run, PALS_MS);
    };
    run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [playerUid]);
  return pals;
}

// ---------------------------------------------------------------- lookups

interface Lookups {
  pal: (code: string) => DexPal | undefined;
  struct: (buildObjectId: string) => DexStruct | undefined;
}

function useLookups(dex: Dex | null): Lookups {
  return useMemo(() => {
    const pals = new Map((dex?.pals ?? []).map((p) => [p.code.toLowerCase(), p]));
    // structure icons are named after the building id: T_icon_buildObject_<id>.webp
    const structs = new Map<string, DexStruct>();
    for (const s of dex?.structs ?? []) {
      const m = /^T_icon_buildObject_(.+)\.webp$/.exec(s.icon ?? "");
      if (m && !structs.has(m[1].toLowerCase())) structs.set(m[1].toLowerCase(), s);
    }
    return { pal: (code) => pals.get(code.toLowerCase()), struct: (id) => structs.get(id.toLowerCase()) };
  }, [dex]);
}

const speciesName = (L: Lookups, p: MinePal) => L.pal(p.code)?.name ?? p.code;
const palName = (L: Lookups, p: MinePal) => p.nick || speciesName(L, p);
const structName = (L: Lookups, id: string) => {
  const n = buildingName(id);
  return n !== id ? n : (L.struct(id)?.name ?? id);
};

/** Marks next to the name: sick, injured, low SAN (hunger has its own gauge). */
function issues(p: MinePal): string[] {
  const out: string[] = [];
  if (p.sick && p.sick !== "None") out.push("아픔");
  if (p.health && p.health !== "Healthful") out.push("부상");
  if (p.san < SAN_LOW) out.push(`SAN ${Math.round(p.san)}`);
  return out;
}
const hungry = (p: MinePal) => p.maxHunger > 0 && p.hunger / p.maxHunger < HUNGRY;
const needsCare = (p: MinePal) => issues(p).length > 0 || hungry(p);

const matchesPal = (L: Lookups, p: MinePal, q: string) => !q || textMatches(p.nick, q) || textMatches(speciesName(L, p), q);

function meters(cm: number): string {
  const m = cm / 100;
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------- pieces

function DexIcon({ name, className = "dx-ico" }: { name: string | null | undefined; className?: string }) {
  const url = dexIconUrl(name);
  return url ? <img className={className} src={url} alt="" draggable={false} /> : <span className={className} />;
}

function ItemIcon({ id }: { id: string }) {
  const url = itemIconUrl(id);
  return url ? <img className="dx-ico" src={url} alt="" draggable={false} /> : <span className="dx-ico" />;
}

/** Hunger gauge like the game's: filled bar with "current /max" centered in it. */
function Gauge({ v, max, big }: { v: number; max: number; big?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
  return (
    <span className={`mn-gauge${big ? " big" : ""}`}>
      <i style={{ width: `${pct}%` }} />
      <span className="tabular">
        {Math.round(v)} <em>/{Math.round(max)}</em>
      </span>
    </span>
  );
}

const Section = ({ label, count, children }: { label: string; count: ReactNode; children: ReactNode }) => (
  <>
    <div className="dx-sec">
      <span>{label}</span>
      <span>{count}</span>
    </div>
    <div className="rows">{children}</div>
  </>
);

function PalRow({ L, p, onOpen }: { L: Lookups; p: MinePal; onOpen: () => void }) {
  return (
    <div className="row mn-row two" onClick={onOpen}>
      <DexIcon name={L.pal(p.code)?.icon} />
      <span className="nm">
        <span className="line">
          <span className="n">
            {palName(L, p)}
            {issues(p).map((t) => (
              <span key={t} className="mn-badge">
                {t}
              </span>
            ))}
          </span>
          <span className="lv tabular">Lv {p.lv}</span>
        </span>
        <span className="line">
          <small>{p.nick ? speciesName(L, p) : ""}</small>
          <Gauge v={p.hunger} max={p.maxHunger} />
        </span>
      </span>
    </div>
  );
}

/**
 * A production order with what it made so far. The game keeps `requested` as first ordered also
 * after players take items out, so "made" is what still sits in the building (its production
 * storage) and the order is that plus what is left to make, as the game shows it.
 */
type Prod = Building & { made: number; /** the order's recipe row (production.recipe is its product) */ key: string };

function prodInfo(b: Prod) {
  const pr = b.production!;
  const on = pr.remain > 0;
  // the game counts what is left in crafts; one craft can make several (energy cartridges: 20)
  const per = recipeOf(b.key).n;
  const total = b.made + pr.remain * per;
  const part = on ? workShare(pr.work, pr.workRequired, pr.remain) * per : 0;
  return {
    made: b.made,
    total,
    on,
    // the item in progress counts with its share, so the bar moves between finished items
    share: total > 0 ? Math.min(100, ((b.made + part) / total) * 100) : 100,
  };
}

/** One production order: item, (made/requested), building, current item progress, bar. */
function ProdLines({ L, b, where }: { L: Lookups; b: Prod; where?: string }) {
  const pr = b.production!;
  const x = prodInfo(b);
  return (
    <>
      <span className="line">
        <span className="n">{itemName(pr.recipe)}</span>
        <span className="cnt tabular">
          <b>{x.made}</b>/{x.total}
        </span>
      </span>
      <span className="line">
        <small>
          {b.customName || structName(L, b.buildObjectId)}
          {where ? ` · ${where}` : ""}
        </small>
        <small className="tabular">{x.on ? `${x.share.toFixed(1)}%` : x.made > 0 ? "완료 · 꺼내기 대기" : "완료"}</small>
      </span>
      <span className={`mn-bar ${x.on ? "" : "done"}`}>
        <i style={{ width: `${x.share}%` }} />
      </span>
    </>
  );
}

function ProdRow({ L, b, onOpen }: { L: Lookups; b: Prod; onOpen: () => void }) {
  return (
    <div className="row mn-row two" onClick={onOpen}>
      <ItemIcon id={b.production!.recipe} />
      <span className="nm">
        <ProdLines L={L} b={b} />
      </span>
    </div>
  );
}

function ProdList({ L, list }: { L: Lookups; list: Prod[] }) {
  return (
    <div className="mn-plist">
      {list.map((b, i) => (
        <div className="pi" key={i}>
          <ItemIcon id={b.production!.recipe} />
          <span className="nm">
            <ProdLines L={L} b={b} />
          </span>
        </div>
      ))}
    </div>
  );
}

function Filters({ items, value, onChange }: { items: string[]; value: number; onChange: (i: number) => void }) {
  return (
    <div className="filters">
      {items.map((f, i) => (
        <div key={f} className={value === i ? "on" : ""} onClick={() => onChange(i)}>
          {f}
        </div>
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
const Kv = ({ k, children, center }: { k: string; children: ReactNode; center?: boolean }) => (
  <span className={`dx-kvrow${center ? " mid" : ""}`}>
    <span>{k}</span>
    <span>{children}</span>
  </span>
);

function groupBuildings(L: Lookups, list: Building[]): [string, { id: string; n: number }[]][] {
  const cats = new Map<string, Map<string, number>>();
  for (const b of list) {
    const cat = L.struct(b.buildObjectId)?.cat ?? "기타";
    const g = cats.get(cat) ?? new Map<string, number>();
    g.set(b.buildObjectId, (g.get(b.buildObjectId) ?? 0) + 1);
    cats.set(cat, g);
  }
  const total = (g: Map<string, number>) => [...g.values()].reduce((a, n) => a + n, 0);
  return [...cats]
    .sort((a, b) => total(b[1]) - total(a[1]))
    .map(([cat, g]) => [cat, [...g].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n)]);
}

const sameSpot = (a: { x: number; y: number; z: number } | undefined, b: { x: number; y: number; z: number }) => !!a && a.x === b.x && a.y === b.y && a.z === b.z;

/** Production orders of a base, each with the finished items still in its building. */
function productions(base: BaseView | null): Prod[] {
  return (base?.buildings ?? [])
    .filter((x) => x.production)
    .map((x) => {
      // the building's storage has the same actor location as the building
      const store = base!.storages.find((s) => s.kind === "production" && sameSpot(s.location, x.location));
      // the order names its recipe row; shown as the item it makes (CarbonFiber2 -> CarbonFiber)
      const key = x.production!.recipe;
      const { product } = recipeOf(key);
      // read by the mod together with what is left (made + remain stays the order); else from the
      // storage. The mod counts items named like the recipe row, which misses other ways' products.
      const fromMod = product === key ? x.production!.made : undefined;
      const made = fromMod ?? (store?.items ?? []).filter((it) => it.item === product).reduce((a, it) => a + it.count, 0);
      return { ...x, production: { ...x.production!, recipe: product }, key, made };
    });
}

// ---------------------------------------------------------------- views

export interface MineProps {
  tab: DexTab;
  mode: ItemMode;
  data: OverlayData;
  dex: Dex | null;
  pals: MinePals | null;
  /** base shown by the pal and structure tabs (picked, current or nearest) */
  base: BaseView | null;
  query: string;
  detail: string | null;
  onOpen: (id: string) => void;
  /** search box and sub tabs, placed above the list by the caller */
  head: ReactNode;
}

export function MineView(props: MineProps) {
  const { tab, mode, detail } = props;
  const L = useLookups(props.dex);
  if (detail && mode !== "hud") {
    return <div className="scroll dx-detail">{tab === "pals" ? <PalDetail {...props} L={L} /> : tab === "structs" ? <StructDetail {...props} L={L} /> : <PlaceDetail {...props} L={L} />}</div>;
  }
  if (tab === "pals") return <PalsList {...props} L={L} />;
  if (tab === "structs") return <StructsList {...props} L={L} />;
  return <PlacesList {...props} L={L} />;
}

type Props = MineProps & { L: Lookups };

const baseNo = (data: OverlayData, b: BaseView | null) => (b ? (data.guild?.bases.indexOf(b) ?? -1) + 1 : 0);

function PalsList({ mode, data, pals, base, query, onOpen, head, L }: Props) {
  const [more, setMore] = useState(false);
  const bases = data.guild?.bases ?? [];
  // the wide layout starts on the shown base
  const [filter, setFilter] = useState(() => Math.max(0, base ? bases.indexOf(base) : 0));
  useEffect(() => setFilter(Math.max(0, base ? bases.indexOf(base) : 0)), [base?.campId]);
  if (!pals) return <div className="empty">{data.me?.online === false ? "접속 중일 때만 볼 수 있음" : "팰 불러오는 중"}</div>;
  const workersOf = (b: BaseView) => pals.workers.get(b.campId) ?? [];

  if (mode === "hud") {
    const need = bases.flatMap((b, i) => workersOf(b).map((p) => ({ p, i }))).filter((x) => needsCare(x.p));
    const all = bases.reduce((a, b) => a + workersOf(b).length, 0);
    return (
      <div style={{ paddingBottom: 8 }}>
        {need.slice(0, COMPACT_ROWS).map(({ p, i }) => (
          <div className="hud-row" key={p.key}>
            <DexIcon name={L.pal(p.code)?.icon} />
            <span className="name">
              {palName(L, p)} <small className="mn-where">거점 {i + 1}</small>
            </span>
            <b className="mn-bad">{[...issues(p), ...(hungry(p) ? ["배고픔"] : [])].join(" · ")}</b>
          </div>
        ))}
        {!need.length && (
          <div className="hud-row">
            <span />
            <span className="name">일꾼 {all}마리 모두 정상</span>
            <b className="mn-ok">✓</b>
          </div>
        )}
      </div>
    );
  }

  const q = query;
  if (mode === "full") {
    const groups: [string, MinePal[]][] = [...bases.map((b, i): [string, MinePal[]] => [`거점 ${i + 1}`, workersOf(b)]), ["파티", pals.team], ["팰 상자", pals.palbox]];
    const f = Math.min(filter, groups.length - 1);
    const list = groups[f][1].filter((p) => matchesPal(L, p, q));
    return (
      <>
        {head}
        <div className="full-body">
          <Filters items={groups.map(([l, g]) => `${l} · ${g.length}`)} value={f} onChange={setFilter} />
          <div className="dx-tiles">
            {list.map((p) => (
              <div className="dx-tile" key={p.key} onClick={() => onOpen(p.key)}>
                {issues(p).length > 0 && <span className="mn-dot" />}
                <span className="cap">Lv {p.lv}</span>
                <DexIcon name={L.pal(p.code)?.icon} />
                <span className="tn">{palName(L, p)}</span>
              </div>
            ))}
            {!list.length && <div className="empty">{q ? "검색 결과 없음" : "팰 없음"}</div>}
          </div>
        </div>
      </>
    );
  }

  const workers = base ? workersOf(base).filter((p) => matchesPal(L, p, q)) : [];
  const team = pals.team.filter((p) => matchesPal(L, p, q));
  const box = pals.palbox.filter((p) => matchesPal(L, p, q));
  // while searching every match shows
  const boxShown = more || q ? box : box.slice(0, PALBOX_ROWS);
  const row = (p: MinePal) => <PalRow key={p.key} L={L} p={p} onOpen={() => onOpen(p.key)} />;
  return (
    <>
      {head}
      <div className="scroll">
        {base && workers.length > 0 && (
          <Section label={`거점 ${baseNo(data, base)} 일꾼`} count={workers.length}>
            {workers.map(row)}
          </Section>
        )}
        {team.length > 0 && (
          <Section label="파티" count={team.length}>
            {team.map(row)}
          </Section>
        )}
        {box.length > 0 && (
          <Section label="팰 상자" count={box.length}>
            {boxShown.map(row)}
            {boxShown.length < box.length && (
              <button className="mn-more" onClick={() => setMore(true)}>
                {box.length - boxShown.length}마리 더 보기
              </button>
            )}
          </Section>
        )}
        {!workers.length && !team.length && !box.length && <div className="empty">{q ? "검색 결과 없음" : "팰 없음"}</div>}
      </div>
    </>
  );
}

function findPal(pals: MinePals | null, bases: BaseView[], key: string): { p: MinePal; where: string } | null {
  if (!pals) return null;
  for (const [i, b] of bases.entries()) {
    const p = pals.workers.get(b.campId)?.find((x) => x.key === key);
    if (p) return { p, where: `거점 ${i + 1}` };
  }
  const t = pals.team.find((x) => x.key === key);
  if (t) return { p: t, where: "파티" };
  const b = pals.palbox.find((x) => x.key === key);
  return b ? { p: b, where: "팰 상자" } : null;
}

function PalDetail({ data, pals, detail, L }: Props) {
  const found = findPal(pals, data.guild?.bases ?? [], detail!);
  if (!found) return <div className="empty">찾을 수 없음</div>;
  const { p, where } = found;
  const info = L.pal(p.code);
  const health = [...(p.sick && p.sick !== "None" ? ["아픔"] : []), ...(p.health && p.health !== "Healthful" ? ["부상"] : [])];
  return (
    <>
      <div className="dx-head">
        <DexIcon name={info?.icon} />
        <div>
          <div className="dn">{palName(L, p)}</div>
          <div className="dm">
            {p.nick ? `${speciesName(L, p)} · ` : ""}Lv {p.lv} · {where}
            {p.alpha ? " · 알파" : ""}
          </div>
        </div>
      </div>
      <Box title="상태">
        <div className="dx-kv mn-kv">
          <Kv k="HP">
            <span className="tabular">{Math.round(p.hp)}</span>
          </Kv>
          <Kv k="공복" center>
            <Gauge v={p.hunger} max={p.maxHunger} big />
          </Kv>
          <Kv k="SAN">
            <span className="tabular">{Math.round(p.san)}/100</span>
          </Kv>
          <Kv k="건강">{health.join(", ") || "정상"}</Kv>
        </div>
      </Box>
      {info && info.works.length > 0 && (
        <Box title="작업 적성">
          <div className="dx-chips">
            {info.works.map((w) => (
              <span className="dx-chip" key={w.icon + w.lv}>
                <DexIcon name={w.icon} className="" />
                {w.name} {w.lv}
              </span>
            ))}
          </div>
        </Box>
      )}
    </>
  );
}

function StructsList({ mode, data, base, query, onOpen, head, L }: Props) {
  const [filter, setFilter] = useState(0);
  useEffect(() => setFilter(0), [base]);
  const bases = data.guild?.bases ?? [];

  if (mode === "hud") {
    const prods = bases.flatMap((b, i) => productions(b).map((x) => ({ b: x, i })));
    return (
      <div style={{ paddingBottom: 8 }}>
        {prods.slice(0, COMPACT_ROWS).map(({ b, i }, k) => (
          <div className="hud-row" key={k}>
            <ItemIcon id={b.production!.recipe} />
            <span className="name">
              {itemName(b.production!.recipe)} <small className="mn-where">거점 {i + 1}</small>
            </span>
            <b className="tabular">
              {prodInfo(b).made}/{prodInfo(b).total}
            </b>
          </div>
        ))}
        {!prods.length && <div className="empty">제작 중인 것 없음</div>}
      </div>
    );
  }
  if (!base) return <div className="empty">거점 없음</div>;

  const q = query;
  const match = (id: string) => textMatches(structName(L, id), q);
  const groups = groupBuildings(L, base.buildings.filter((b) => match(b.buildObjectId)));
  const prods = productions(base).filter((b) => !q || match(b.buildObjectId) || textMatches(itemName(b.production!.recipe), q));

  if (mode === "full") {
    const f = Math.min(filter, groups.length);
    const list = f === 0 ? groups.flatMap(([, l]) => l) : groups[f - 1][1];
    return (
      <>
        {head}
        <div className="full-body">
          <Filters items={[`전체 · ${groups.reduce((a, [, l]) => a + l.reduce((s, x) => s + x.n, 0), 0)}`, ...groups.map(([c, l]) => `${c} · ${l.reduce((s, x) => s + x.n, 0)}`)]} value={f} onChange={setFilter} />
          <div className="dx-tiles">
            {list.map((x) => {
              const pb = prods.find((b) => b.buildObjectId === x.id);
              return (
                <div className="dx-tile" key={x.id} onClick={() => onOpen(x.id)} data-goal={L.struct(x.id) ? `struct:${L.struct(x.id)!.id}` : undefined}>
                  <span className="cap">×{x.n}</span>
                  <DexIcon name={L.struct(x.id)?.icon} />
                  <span className="tn">{structName(L, x.id)}</span>
                  {pb && (
                    <span className={`mn-bar tile ${prodInfo(pb).on ? "" : "done"}`}>
                      <i style={{ width: `${prodInfo(pb).share}%` }} />
                    </span>
                  )}
                </div>
              );
            })}
            {!list.length && <div className="empty">{q ? "검색 결과 없음" : "건물 없음"}</div>}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      <div className="scroll">
        <Section label="제작" count={prods.length || "없음"}>
          {prods.map((b, i) => (
            <ProdRow key={i} L={L} b={b} onOpen={() => onOpen(b.buildObjectId)} />
          ))}
        </Section>
        {groups.map(([cat, list]) => (
          <Section key={cat} label={cat} count={list.reduce((a, x) => a + x.n, 0)}>
            {list.map((x) => (
              <div className="row mn-row one" key={x.id} onClick={() => onOpen(x.id)} data-goal={L.struct(x.id) ? `struct:${L.struct(x.id)!.id}` : undefined}>
                <DexIcon name={L.struct(x.id)?.icon} />
                <span className="n">{structName(L, x.id)}</span>
                <span className="count tabular">×{x.n}</span>
              </div>
            ))}
          </Section>
        ))}
        {q && !groups.length && !prods.length && <div className="empty">검색 결과 없음</div>}
      </div>
    </>
  );
}

function StructDetail({ data, base, detail, L }: Props) {
  if (!base) return <div className="empty">찾을 수 없음</div>;
  const id = detail!;
  const mine = base.buildings.filter((b) => b.buildObjectId === id);
  const info = L.struct(id);
  const prods = productions(base).filter((b) => b.buildObjectId === id);
  const named = mine.filter((b) => b.customName);
  return (
    <>
      <div className="dx-head">
        <DexIcon name={info?.icon} />
        <div>
          <div className="dn">{structName(L, id)}</div>
          <div className="dm">
            {info?.cat ?? "기타"} · 거점 {baseNo(data, base)}에 {mine.length}개
          </div>
        </div>
      </div>
      {prods.length > 0 && (
        <Box title="제작">
          <ProdList L={L} list={prods} />
        </Box>
      )}
      {named.length > 0 && (
        <Box title="붙인 이름">
          <div className="dx-kv">
            {named.map((b, i) => (
              <span className="dx-kvrow" key={i}>
                <span>{b.customName}</span>
              </span>
            ))}
          </div>
        </Box>
      )}
    </>
  );
}

interface FastPoint {
  i: number;
  name: string;
  /** distance from the player, world units */
  d: number;
  x: number;
  y: number;
}

function nearFast(dex: Dex | null, me: PlayerView | null): FastPoint[] {
  if (!dex || !me) return [];
  const [mx, my] = mapPx(me.mapPos.x, me.mapPos.y);
  return dex.markers.fast.points
    .map((p, i) => ({ i, name: p.n || dex.markers.fast.label, d: Math.hypot(p.x - mx, p.y - my) * WORLD_PER_PX, x: p.x, y: p.y }))
    .sort((a, b) => a.d - b.d);
}

const PalBoxIcon = ({ L }: { L: Lookups }) => <DexIcon name={L.struct("PalBoxV2")?.icon} />;
const PlayerMark = ({ p, me }: { p: PlayerView; me: PlayerView | null }) => <span className={`dx-ico mn-player ${p.uid === me?.uid ? "me" : p.online ? "on" : ""}`}>▲</span>;

function PlacesList({ mode, data, dex, pals, query, onOpen, head, L }: Props) {
  const [filter, setFilter] = useState(0);
  const bases = data.guild?.bases ?? [];
  const me = data.me;
  const members = (data.snapshot?.players ?? []).filter((p) => p.guildId === data.guild?.guildId);
  const fast = useMemo(() => nearFast(dex, me), [dex, me?.mapPos.x, me?.mapPos.y]);
  const away = (pos: { x: number; y: number }) => (me ? meters(dist(pos, me.worldPos)) : "");
  const baseAway = (i: number) => (i === data.baseIndex ? "여기" : away(bases[i].worldPos));
  const q = query;

  if (mode === "hud") {
    const near = bases.map((b, i) => ({ i, d: me ? dist(b.worldPos, me.worldPos) : 0 })).sort((a, b) => a.d - b.d)[0];
    const online = members.filter((p) => p.online && p.uid !== me?.uid);
    return (
      <div style={{ paddingBottom: 8 }}>
        {near && (
          <div className="hud-row">
            <PalBoxIcon L={L} />
            <span className="name">거점 {near.i + 1}</span>
            <b>{baseAway(near.i)}</b>
          </div>
        )}
        {fast[0] && (
          <div className="hud-row">
            <DexIcon name={dex?.markers.fast.icon} />
            <span className="name">{fast[0].name}</span>
            <b>{meters(fast[0].d)}</b>
          </div>
        )}
        {online.map((p) => (
          <div className="hud-row" key={p.uid}>
            <PlayerMark p={p} me={me} />
            <span className="name">{p.name}</span>
            <b>{away(p.worldPos)}</b>
          </div>
        ))}
        {!online.length && (
          <div className="hud-row">
            <span />
            <span className="name mn-muted">접속한 친구 없음</span>
            <b />
          </div>
        )}
      </div>
    );
  }

  const baseRows = bases
    .map((b, i) => ({ b, i }))
    .filter(({ i }) => textMatches(`거점 ${i + 1}`, q))
    .map(({ b, i }) => (
      <div className="row mn-row two" key={b.campId} onClick={() => onOpen(`c:${b.campId}`)}>
        <PalBoxIcon L={L} />
        <span className="nm">
          <span className="line">
            <span className="n">거점 {i + 1}</span>
            <span className="lv tabular">{baseAway(i)}</span>
          </span>
          <span className="line">
            <small>
              일꾼 {pals?.workers.get(b.campId)?.length ?? "-"} · 건물 {b.buildings.length}
              {productions(b).length ? ` · 제작 ${productions(b).length}` : ""}
            </small>
          </span>
        </span>
      </div>
    ));
  // offline players are left out
  const playerRows = members
    .filter((p) => p.online && textMatches(p.name, q))
    .map((p) => (
      <div className="row mn-row two" key={p.uid} onClick={() => onOpen(`u:${p.uid}`)}>
        <PlayerMark p={p} me={me} />
        <span className="nm">
          <span className="line">
            <span className="n">
              {p.name}
              {p.uid === me?.uid ? " (나)" : ""}
            </span>
            <span className="lv tabular">{p.uid === me?.uid ? "" : away(p.worldPos)}</span>
          </span>
          <span className="line">
            <small>{p.online ? "온라인" : "오프라인"}</small>
          </span>
        </span>
      </div>
    ));
  const fastRows = (n: number) =>
    fast
      .filter((p) => textMatches(p.name, q))
      .slice(0, n)
      .map((p) => (
        <div className="row mn-row one" key={p.i} onClick={() => onOpen(`f:${p.i}`)}>
          <DexIcon name={dex?.markers.fast.icon} />
          <span className="n">{p.name}</span>
          <span className="count tabular">{meters(p.d)}</span>
        </div>
      ));

  if (mode === "full") {
    const groups: [string, ReactNode[]][] = [
      ["거점", baseRows],
      ["플레이어", playerRows],
      ["빠른 이동", fastRows(WIDE_FAST)],
    ];
    const f = Math.min(filter, groups.length - 1);
    return (
      <>
        {head}
        <div className="full-body">
          <Filters items={groups.map(([l, r]) => `${l} · ${r.length}`)} value={f} onChange={setFilter} />
          <div className="dx-list">
            <div className="rows">{groups[f][1]}</div>
            {!groups[f][1].length && <div className="empty">{q ? "검색 결과 없음" : "없음"}</div>}
          </div>
        </div>
      </>
    );
  }
  const fr = fastRows(NEAR_FAST);
  return (
    <>
      {head}
      <div className="scroll">
        {baseRows.length > 0 && (
          <Section label="거점" count={baseRows.length}>
            {baseRows}
          </Section>
        )}
        {playerRows.length > 0 && (
          <Section label="플레이어" count={playerRows.length}>
            {playerRows}
          </Section>
        )}
        {fr.length > 0 && (
          <Section label="가까운 빠른 이동" count={fr.length}>
            {fr}
          </Section>
        )}
        {!baseRows.length && !playerRows.length && !fr.length && <div className="empty">{q ? "검색 결과 없음" : "없음"}</div>}
      </div>
    </>
  );
}

function PlaceDetail({ data, dex, pals, detail, L }: Props) {
  const [kind, id] = [detail!.slice(0, 1), detail!.slice(2)];
  const me = data.me;
  const bases = data.guild?.bases ?? [];
  const away = (pos: { x: number; y: number }) => (me ? meters(dist(pos, me.worldPos)) : "-");

  if (kind === "c") {
    const i = bases.findIndex((b) => b.campId === id);
    const b = bases[i];
    if (!b) return <div className="empty">찾을 수 없음</div>;
    const workers = pals?.workers.get(b.campId);
    const chests = b.storages.filter((s) => s.kind === "chest").length;
    const prods = productions(b);
    return (
      <>
        <div className="dx-head">
          <PalBoxIcon L={L} />
          <div>
            <div className="dn">거점 {i + 1}</div>
            <div className="dm">{i === data.baseIndex ? "지금 여기" : away(b.worldPos)}</div>
          </div>
        </div>
        <Box title="요약">
          <div className="dx-kv">
            <Kv k="일꾼">
              <span className="tabular">{workers?.length ?? "-"}</span>
            </Kv>
            <Kv k="건물">
              <span className="tabular">{b.buildings.length}</span>
            </Kv>
            <Kv k="보관함">
              <span className="tabular">{chests}</span>
            </Kv>
            <Kv k="문제 있는 일꾼">
              <span className="tabular">{workers ? workers.filter((p) => issues(p).length).length : "-"}</span>
            </Kv>
          </div>
        </Box>
        <Box title="제작 중">{prods.length ? <ProdList L={L} list={prods} /> : <div className="mn-muted">없음</div>}</Box>
      </>
    );
  }
  if (kind === "u") {
    const p = (data.snapshot?.players ?? []).find((x) => x.uid === id);
    if (!p) return <div className="empty">찾을 수 없음</div>;
    return (
      <>
        <div className="dx-head">
          <PlayerMark p={p} me={me} />
          <div>
            <div className="dn">{p.name}</div>
            <div className="dm">{p.online ? "온라인" : "오프라인"}</div>
          </div>
        </div>
        <Box title="위치">
          <div className="dx-kv">
            {p.uid !== me?.uid && <Kv k="거리">{away(p.worldPos)}</Kv>}
            <Kv k="지도 좌표">
              {Math.round(p.mapPos.x)}, {Math.round(p.mapPos.y)}
            </Kv>
          </div>
        </Box>
      </>
    );
  }
  const f = nearFast(dex, me).find((x) => x.i === Number(id));
  if (!f) return <div className="empty">찾을 수 없음</div>;
  return (
    <>
      <div className="dx-head">
        <DexIcon name={dex?.markers.fast.icon} />
        <div>
          <div className="dn">{f.name}</div>
          <div className="dm">{dex?.markers.fast.label}</div>
        </div>
      </div>
      <Box title="위치">
        <div className="dx-kv">
          <Kv k="거리">{meters(f.d)}</Kv>
          <Kv k="지도 좌표">
            {f.x}, {f.y}
          </Kv>
        </div>
      </Box>
    </>
  );
}
