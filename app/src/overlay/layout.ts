// Overlay layout shared by all overlay windows. Stored by the Rust side (layout.json)
// and broadcast to every window on change.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// "items" is the main window (items, pals, structures, places); the id predates the other tabs
export type ViewId = "menubar" | "items" | "minimap" | "settings";
/** main window layouts: compact (hud), normal (side), wide (full) */
export type ItemMode = "side" | "hud" | "full";
export type MainTab = "items" | "pals" | "structs" | "places";
/** what the pals, structures and places tabs show: this server's ("mine") or game data ("dex") */
export type MainSub = "mine" | "dex";

/**
 * Window position in stage units (1 unit = screen height / 1080), measured from a screen edge
 * so the window keeps its place on other resolutions and aspect ratios.
 */
export interface WinLayout {
  open: boolean;
  ax: "left" | "right";
  dx: number;
  ay: "top" | "bottom";
  dy: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Layout {
  version: 3;
  windows: Record<ViewId, WinLayout>;
  /** tab shown in the main window */
  mainTab: MainTab;
  /** layout of each main window tab */
  modes: Record<MainTab, ItemMode>;
  subs: Record<Exclude<MainTab, "items">, MainSub>;
  /** alpha of the dark tint over the blurred background */
  opacity: number;
  /** minimap magnification (MINIMAP_ZOOMS), changed with the - and = keys */
  minimapZoom: number;
  /** main window size per layout set by dragging its edges (CSS px before zoom); natural size if unset */
  itemSizes: Partial<Record<ItemMode, Size>>;
  /** windows can be dragged only while this is on; never persisted as on */
  editMode: boolean;
}

// Defaults were fitted to the in-game HUD (docs/designs/overlay-mock.html):
// minimap in the lower right left of the weapon panel, main window above the pal slots,
// menu bar in the top-right corner, 5 QHD px (~4 units) from both edges.
export const DEFAULT_LAYOUT: Layout = {
  version: 3,
  windows: {
    menubar: { open: true, ax: "right", dx: 4, ay: "top", dy: 4 },
    // above the pal slots; top-anchored so a layout switch keeps the top left corner in place
    // (the window converts any other anchor on load, OverlayWindow sideAnchor)
    items: { open: true, ax: "left", dx: 40, ay: "bottom", dy: 338.75 },
    // lower right, left of the weapon panel
    minimap: { open: true, ax: "right", dx: 400, ay: "bottom", dy: 26 },
    settings: { open: false, ax: "left", dx: 760, ay: "top", dy: 200 },
  },
  mainTab: "items",
  modes: { items: "side", pals: "side", structs: "side", places: "side" },
  subs: { pals: "mine", structs: "mine", places: "mine" },
  opacity: 0.25,
  minimapZoom: 1,
  itemSizes: {},
  editMode: false,
};

const LAYOUT_CHANGED = "layout-changed";

/** Version 2 had one item window with a single `itemMode`; keep positions and that mode. */
function migrate(s: Record<string, unknown>): Partial<Layout> {
  if (s.version !== 2) return s as Partial<Layout>;
  const { itemMode, ...rest } = s;
  return { ...(rest as Partial<Layout>), version: 3, modes: { ...DEFAULT_LAYOUT.modes, items: (itemMode as ItemMode) ?? "side" } };
}

function merge(stored: unknown): Layout {
  const s = migrate((stored ?? {}) as Record<string, unknown>);
  if (s.version !== DEFAULT_LAYOUT.version) return structuredClone(DEFAULT_LAYOUT);
  return {
    ...DEFAULT_LAYOUT,
    ...s,
    windows: { ...DEFAULT_LAYOUT.windows, ...s.windows },
    modes: { ...DEFAULT_LAYOUT.modes, ...s.modes },
    subs: { ...DEFAULT_LAYOUT.subs, ...s.subs },
  };
}

export async function loadLayout(): Promise<Layout> {
  const l = merge(await invoke("layout_get"));
  // edit mode always starts off
  return { ...l, editMode: false };
}

export function saveLayout(layout: Layout): Promise<void> {
  return invoke("layout_set", { layout });
}

export function onLayoutChanged(cb: (l: Layout) => void): Promise<UnlistenFn> {
  return listen<unknown>(LAYOUT_CHANGED, (e) => cb(merge(e.payload)));
}

export function resetPositions(l: Layout): Layout {
  const windows = { ...DEFAULT_LAYOUT.windows };
  for (const id of Object.keys(windows) as ViewId[]) windows[id] = { ...windows[id], open: l.windows[id].open };
  return { ...l, windows };
}
