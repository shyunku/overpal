// Game data for the main window's dex view (pals, structures, map markers).
// Built from palworld-helper by scripts/build_dex.py into public/data/dex.json;
// icons are in public/icons/dex. Item references use game item ids (itemTable.json).

export interface DexWork {
  /** work suitability, e.g. 수작업 */
  name: string;
  lv: number;
  icon: string;
}

export interface DexPal {
  id: string;
  /** internal name, e.g. SheepBall */
  code: string;
  /** dex number, e.g. "#1" */
  no: string;
  name: string;
  icon: string | null;
  elements: { name: string; icon: string }[];
  works: DexWork[];
  /** HP, 공격, 방어, 작업 속도, 식사량 */
  stats: Record<string, string | null>;
  partner: { name: string; desc: string } | null;
  drops: { item: string; qty: string; prob: string }[];
}

export interface DexStruct {
  id: string;
  name: string;
  icon: string | null;
  /** category, e.g. 생산, 수납, 건축 */
  cat: string | null;
  techLv: number | null;
  mats: { item: string; qty: number }[];
  /** work suitability needed to run it */
  works: DexWork[];
}

export interface DexMarkerLayer {
  label: string;
  /** null for watchtowers (drawn by the minimap) */
  icon: string | null;
  /** map pixel coordinates (same space as public/map/palpagos.webp), name and level */
  points: { x: number; y: number; n?: string; lv?: number }[];
}

export interface Dex {
  pals: DexPal[];
  structs: DexStruct[];
  /** watch: watchtowers (관측탑), no icon */
  markers: Record<"fast" | "tower" | "dungeon" | "alpha" | "watch", DexMarkerLayer>;
}

export const dexIconUrl = (name: string | null | undefined): string | null => (name ? `/icons/dex/${name}` : null);

let loading: Promise<Dex> | null = null;

/** Loads the dex once per window. */
export function loadDex(): Promise<Dex> {
  loading ??= fetch("/data/dex.json").then((r) => {
    if (!r.ok) throw new Error(`dex: ${r.status}`);
    return r.json() as Promise<Dex>;
  });
  return loading;
}

let descLoading: Promise<Record<string, string>> | null = null;

/** Item descriptions by game item id (public/data/itemDesc.json), loaded once per window. */
export function loadItemDesc(): Promise<Record<string, string>> {
  descLoading ??= fetch("/data/itemDesc.json").then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}));
  return descLoading;
}
