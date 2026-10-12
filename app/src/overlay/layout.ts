// Overlay layout shared by all overlay windows. Stored by the Rust side (layout.json)
// and broadcast to every window on change.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ViewId = "menubar" | "items" | "minimap" | "settings";
export type ItemMode = "side" | "hud" | "full";

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

export interface Layout {
  version: 2;
  windows: Record<ViewId, WinLayout>;
  itemMode: ItemMode;
  /** alpha of the dark tint over the blurred background */
  opacity: number;
  /** windows can be dragged only while this is on; never persisted as on */
  editMode: boolean;
}

// Defaults were fitted to the in-game HUD (docs/designs/overlay-mock.html):
// minimap right below the top-right quest/base panels, item window above the pal slots,
// menu bar in the top-right corner, 5 QHD px (~4 units) from both edges.
export const DEFAULT_LAYOUT: Layout = {
  version: 2,
  windows: {
    menubar: { open: true, ax: "right", dx: 4, ay: "top", dy: 4 },
    items: { open: true, ax: "left", dx: 40, ay: "bottom", dy: 380 },
    minimap: { open: true, ax: "right", dx: 58, ay: "top", dy: 367 },
    settings: { open: false, ax: "left", dx: 760, ay: "top", dy: 200 },
  },
  itemMode: "side",
  opacity: 0.25,
  editMode: false,
};

const LAYOUT_CHANGED = "layout-changed";

function merge(stored: unknown): Layout {
  const s = (stored ?? {}) as Partial<Layout>;
  if (s.version !== DEFAULT_LAYOUT.version) return structuredClone(DEFAULT_LAYOUT);
  return {
    ...DEFAULT_LAYOUT,
    ...s,
    windows: { ...DEFAULT_LAYOUT.windows, ...s.windows },
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
