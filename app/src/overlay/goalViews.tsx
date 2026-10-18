// The main window's goals tab: items or structures to make, and the materials the base has for them.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { craftableNow, goalKey, goalMaterials, loadRecipes, materialTree, readyToCraft, treeProgress, type Goal, type MaterialNode, type Recipes } from "../data/goals";
import { dexIconUrl, type Dex, type DexStruct } from "../data/dex";
import type { BaseView } from "../data/snapshot";
import { itemIconUrl, itemName, matchRank } from "./labels";
import type { ItemMode } from "./layout";

export function useRecipes(): Recipes | null {
  const [recipes, setRecipes] = useState<Recipes | null>(null);
  useEffect(() => {
    loadRecipes().then(setRecipes, () => setRecipes({}));
  }, []);
  return recipes;
}

/** what a goal is called and shows, and its materials per one */
export interface GoalInfo {
  name: string;
  icon: string | null;
  bench: string[];
}

function structById(dex: Dex | null): Map<string, DexStruct> {
  return new Map((dex?.structs ?? []).map((s) => [s.id, s]));
}

export function goalInfo(g: { kind: string; id: string }, recipes: Recipes | null, structs: Map<string, DexStruct>): GoalInfo {
  if (g.kind === "struct") {
    const s = structs.get(g.id);
    return { name: s?.name ?? g.id, icon: dexIconUrl(s?.icon), bench: [] };
  }
  return { name: itemName(g.id), icon: itemIconUrl(g.id), bench: recipes?.[g.id]?.bench ?? [] };
}

const Ico = ({ url, className = "item-icon" }: { url: string | null; className?: string }) => (url ? <img className={className} src={url} alt="" draggable={false} /> : <span className={className} />);

const benchText = (b: string[]) => (b.length ? (b.length > 1 ? `${b[0]} 외 ${b.length - 1}곳` : b[0]) : "");

/** progress ring (0..1): orange, green when done */
function Ring({ v, done }: { v: number; done: boolean }) {
  const c = 2 * Math.PI * 10;
  const f = Math.max(0, Math.min(1, v));
  return (
    <svg className={`gl-ring ${done ? "done" : ""}`} viewBox="0 0 26 26">
      <circle className="bg" cx="13" cy="13" r="10" />
      {f > 0 && <circle className="fg" cx="13" cy="13" r="10" strokeDasharray={`${(c * f).toFixed(1)} ${c.toFixed(1)}`} />}
    </svg>
  );
}

interface Props {
  goals: Goal[];
  onGoals: (goals: Goal[]) => void;
  mode: ItemMode;
  /** the stock counted: the base shown (picked from the menu, else the one the player is in) + inventory */
  base: BaseView | null;
  dex: Dex | null;
  /** goal opened in place of the list (its key), or "add" for the search */
  detail: string | null;
  onOpen: (key: string | null) => void;
}

export function GoalsTab({ goals, onGoals, mode, base, dex, detail, onOpen }: Props) {
  const recipes = useRecipes();
  const structs = useMemo(() => structById(dex), [dex]);
  const stock = useMemo(() => new Map((base?.totals ?? []).map((t) => [t.item, t.count])), [base]);
  const structMats = (id: string) => structs.get(id)?.mats.map((m) => [m.item, m.qty] as [string, number]);
  const view = (g: Goal) => {
    const mats = recipes ? goalMaterials(g, recipes, structMats) : [];
    const tree = recipes ? materialTree(recipes, mats, new Map(stock)) : [];
    const progress = recipes ? treeProgress(recipes, tree) : 0;
    // all base materials are there, but some direct material still has to be made first
    const direct = mats.every(([m, q]) => (stock.get(m) ?? 0) >= q);
    const now = g.kind === "item" ? craftableNow(recipes?.[g.id], undefined, stock) : craftableNow(undefined, structMats(g.id), stock);
    return { mats, tree, progress, direct, now };
  };

  if (!recipes) return <div className="empty">레시피 불러오는 중</div>;

  if (detail === "add" && mode !== "hud") {
    return <GoalSearch recipes={recipes} structs={structs} onAdd={(g) => onGoals(addGoal(goals, g))} onBack={() => onOpen(null)} />;
  }
  const opened = detail ? goals.find((g) => goalKey(g) === detail) : undefined;
  if (opened && mode !== "hud") {
    const info = goalInfo(opened, recipes, structs);
    const v = view(opened);
    const setQty = (qty: number) => onGoals(goals.map((g) => (g === opened ? { ...g, qty: Math.max(1, Math.min(99999, Math.round(qty) || 1)) } : g)));
    return (
      <>
        <div className="gl-head">
          <Ico url={info.icon} />
          <div className="gl-headr">
            <div className="gl-bench">{benchText(info.bench) ? `만드는 곳: ${benchText(info.bench)}` : opened.kind === "struct" ? "건축" : ""}</div>
            <div className="gl-qty">
              <button onClick={() => setQty(opened.qty - 1)}>−</button>
              <input className="tabular" value={opened.qty} onChange={(e) => setQty(Number(e.target.value.replace(/\D/g, "")))} />
              <button onClick={() => setQty(opened.qty + 1)}>+</button>
              <span className="grow" />
              <button
                className="gl-del"
                onClick={() => {
                  onGoals(goals.filter((g) => g !== opened));
                  onOpen(null);
                }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
        <div className="scroll">
          <div className="dx-sec">
            <span>재료</span>
            <span>보유 / 필요</span>
          </div>
          <div className="gl-total">
            <span className={`gl-bar ${v.direct ? "done" : ""}`}>
              <i style={{ width: `${Math.round(Math.min(1, v.progress) * 100)}%` }} />
            </span>
            <span className={`tabular ${v.direct ? "gl-ok" : ""}`}>{Math.floor(v.progress * 100)}%</span>
          </div>
          <MaterialLines nodes={v.tree} />
        </div>
      </>
    );
  }

  if (mode === "hud") {
    return (
      <div className="gl-hud">
        {goals.map((g) => {
          const info = goalInfo(g, recipes, structs);
          const lacks = view(g).tree.filter((n) => n.lack > 0);
          return (
            <div key={goalKey(g)}>
              <div className="dx-sec">
                <span>
                  {info.name} ×{g.qty}
                </span>
                <span>{lacks.length ? `부족 ${lacks.length}` : "완료"}</span>
              </div>
              {lacks.map((n) => (
                <div className="hud-row" key={n.key}>
                  <Ico url={itemIconUrl(n.id)} />
                  <span className="name">{itemName(n.id)}</span>
                  <b className="tabular">
                    {n.have}/{n.need}
                  </b>
                </div>
              ))}
            </div>
          );
        })}
        {!goals.length && <div className="empty">목표 없음</div>}
      </div>
    );
  }

  return (
    <>
      <div className="scroll">
        {goals.length ? (
          <>
            <div className="dx-sec">
              <span>목표</span>
              <span>{goals.length}</span>
            </div>
            {goals.map((g) => {
              const info = goalInfo(g, recipes, structs);
              const v = view(g);
              // green only when every direct material is there (else something is still to be made)
              const done = v.direct;
              return (
                <div className="row mn-row two gl-goal" key={goalKey(g)} onClick={() => onOpen(goalKey(g))}>
                  <Ico url={info.icon} />
                  <span className="nm">
                    <span className="line">
                      <span className="n">
                        {info.name} ×{g.qty}
                      </span>
                      <small className={done ? "gl-ok" : ""}>{done ? "재료 다 모임" : v.progress >= 1 ? "중간 재료 제작 필요" : `재료 ${Math.floor(v.progress * 100)}%`}</small>
                    </span>
                    <span className="line">
                      <small>{v.now > 0 ? `${v.now}개 제작 가능` : "재료 부족"}</small>
                      <small>{benchText(info.bench)}</small>
                    </span>
                    <span className={`gl-bar ${done ? "done" : ""}`}>
                      <i style={{ width: `${Math.round(Math.min(1, v.progress) * 100)}%` }} />
                    </span>
                  </span>
                </div>
              );
            })}
          </>
        ) : (
          <div className="empty gl-empty">
            목표가 없습니다.
            <br />
            아이템이나 구조물을 우클릭해 &apos;목표로 설정&apos;하거나
            <br />
            아래 &apos;+ 목표 추가&apos;로 검색해 추가합니다.
          </div>
        )}
      </div>
      <div className="gl-foot">
        <button className="gl-btn primary" onClick={() => onOpen("add")}>
          + 목표 추가
        </button>
      </div>
    </>
  );
}

/** a goal added again only gets its amount raised */
export function addGoal(goals: Goal[], g: Goal): Goal[] {
  const same = goals.find((x) => goalKey(x) === goalKey(g));
  return same ? goals.map((x) => (x === same ? { ...x, qty: x.qty + g.qty } : x)) : [...goals, g];
}

/**
 * Material lines: lacking ones open, filled ones closed by default; a line's own toggle holds
 * until it turns filled or lacking.
 */
function MaterialLines({ nodes }: { nodes: MaterialNode[] }) {
  const [own, setOwn] = useState<Record<string, { open: boolean; lack: boolean }>>({});
  const lines: ReactNode[] = [];
  const walk = (list: MaterialNode[], depth: number) => {
    for (const n of list) {
      const lacking = n.lack > 0;
      // lacking, but makeable from what is there (all the way down): closed like a filled line, in yellow
      const ready = readyToCraft(n);
      const o = own[n.key];
      const open = n.craftable && (o && o.lack === lacking ? o.open : lacking && !ready);
      lines.push(
        <div
          className={`gl-mat d${Math.min(depth, 3)} ${n.craftable ? "can" : ""}`}
          key={n.key}
          onClick={n.craftable ? () => setOwn({ ...own, [n.key]: { open: !open, lack: lacking } }) : undefined}
        >
          <span className={`gl-tw ${open ? "open" : ""}`}>
            {n.craftable && (
              <svg viewBox="0 0 24 24">
                <path d="m9 6 6 6-6 6" />
              </svg>
            )}
          </span>
          <Ico url={itemIconUrl(n.id)} />
          <span className="gl-nm">{itemName(n.id)}</span>
          <span className="gl-amt">
            <span className="tabular">
              {n.have}/{n.need}
            </span>
            <small className={ready ? "gl-ready" : lacking ? "gl-lack" : "gl-ok"}>{ready ? `${n.lack} 제작 가능` : lacking ? `${n.lack} 부족` : "완료"}</small>
          </span>
          {/* how much of this item itself is there (not what could be made of its materials) */}
          <Ring v={n.need ? n.have / n.need : 1} done={!lacking} />
        </div>,
      );
      // a filled line opened by hand shows what one would be made of
      if (open) walk(lacking ? n.children : n.recipeChildren, depth + 1);
    }
  };
  walk(nodes, 0);
  return <>{lines}</>;
}

/** search for an item or structure to add as a goal */
function GoalSearch({ recipes, structs, onAdd, onBack }: { recipes: Recipes; structs: Map<string, DexStruct>; onAdd: (g: Goal) => void; onBack: () => void }) {
  // the box keeps what is typed (spaces too); the search uses it trimmed
  const [typed, setQuery] = useState("");
  const query = typed.trim();
  const [picked, setPicked] = useState<{ kind: "item" | "struct"; id: string } | null>(null);
  const [qty, setQty] = useState(1);
  // items and structures together, best matches first (a name starting with the text, then a word)
  const hits = useMemo(() => {
    if (!query) return [];
    const all = [
      ...Object.keys(recipes)
        .filter((id) => itemName(id) !== id)
        .map((id) => ({ kind: "item" as const, id, name: itemName(id) })),
      ...[...structs.values()].filter((s) => s.mats.length).map((s) => ({ kind: "struct" as const, id: s.id, name: s.name })),
    ];
    return all
      .map((h) => ({ h, r: matchRank(h.name, query) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.h.name.localeCompare(b.h.name, "ko"))
      .slice(0, 80)
      .map(({ h }) => ({ kind: h.kind, id: h.id }));
  }, [query, recipes, structs]);
  const matsText = (h: { kind: string; id: string }) =>
    (h.kind === "struct" ? (structs.get(h.id)?.mats.map((m) => [m.item, m.qty] as [string, number]) ?? []) : (recipes[h.id]?.mats ?? []))
      .map(([m, q]) => `${itemName(m)} ${q}`)
      .join(" · ");
  return (
    <>
      <div className="gl-searchhead">
        <input className="search" autoFocus placeholder="아이템·구조물 검색" value={typed} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="scroll">
        {hits.map((h) => {
          const info = goalInfo(h, recipes, structs);
          const on = picked && goalKey(picked) === goalKey(h);
          return (
            <div className={`gl-pick ${on ? "on" : ""}`} key={goalKey(h)} onClick={() => setPicked(h)}>
              <Ico url={info.icon} />
              <span className="tx">
                <b>{info.name}</b>
                <small>{matsText(h)}</small>
              </span>
            </div>
          );
        })}
        {query && !hits.length && <div className="empty">검색 결과 없음</div>}
        {!query && <div className="empty">만들 아이템이나 구조물 이름을 입력하세요</div>}
      </div>
      <div className="gl-foot">
        <span className="gl-picked">{picked ? goalInfo(picked, recipes, structs).name : ""}</span>
        <div className="gl-qty">
          <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
          <input className="tabular" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))} />
          <button onClick={() => setQty(qty + 1)}>+</button>
        </div>
        <button
          className="gl-btn primary"
          disabled={!picked}
          onClick={() => {
            if (!picked) return;
            onAdd({ ...picked, qty });
            onBack();
          }}
        >
          추가
        </button>
      </div>
    </>
  );
}
