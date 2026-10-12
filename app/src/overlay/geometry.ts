// Screen geometry for the overlay windows.
// Sizes are designed in "stage units" for a 1920x1080 screen and scale with the screen height,
// so the overlay covers the same share of the screen on every resolution
// (QHD shows a 225-unit minimap as 300 physical px, FHD as 225 px).

import { PhysicalPosition, PhysicalSize, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import type { WinLayout } from "./layout";

export interface ScreenInfo {
  /** monitor origin and size in physical px */
  x: number;
  y: number;
  w: number;
  h: number;
  /** physical px per stage unit */
  unit: number;
  /** physical px per CSS px */
  dpr: number;
}

export const STAGE_HEIGHT = 1080;

export interface MonitorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The game's monitor when known (multi-monitor), otherwise the primary monitor. */
export async function getScreen(monitor?: MonitorRect | null): Promise<ScreenInfo> {
  const dpr = window.devicePixelRatio || 1;
  if (monitor) return { ...monitor, unit: monitor.h / STAGE_HEIGHT, dpr };
  const m = await primaryMonitor();
  if (!m) {
    const w = window.screen.width * dpr;
    const h = window.screen.height * dpr;
    return { x: 0, y: 0, w, h, unit: h / STAGE_HEIGHT, dpr };
  }
  return { x: m.position.x, y: m.position.y, w: m.size.width, h: m.size.height, unit: m.size.height / STAGE_HEIGHT, dpr };
}

/** CSS zoom that makes 1 CSS px of the content equal `scale` stage units. */
export function cssZoom(screen: ScreenInfo, scale = 1): number {
  return (scale * screen.unit) / screen.dpr;
}

/** Moves and resizes the current window to its anchored place. Size is in physical px. */
export async function placeWindow(screen: ScreenInfo, l: WinLayout, w: number, h: number): Promise<void> {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  const x = l.ax === "left" ? screen.x + l.dx * screen.unit : screen.x + screen.w - l.dx * screen.unit - width;
  const y = l.ay === "top" ? screen.y + l.dy * screen.unit : screen.y + screen.h - l.dy * screen.unit - height;
  const win = getCurrentWindow();
  await win.setSize(new PhysicalSize(width, height));
  // setPosition moves the outer frame, which on Windows includes an invisible border around
  // shadowed windows; shift by that border so the visible content lands on (x, y)
  const [inner, outer] = await Promise.all([win.innerPosition(), win.outerPosition()]);
  await win.setPosition(new PhysicalPosition(Math.round(x - (inner.x - outer.x)), Math.round(y - (inner.y - outer.y))));
}

/** New edge offsets for a window whose visible content was dragged to (x, y), keeping its anchors. */
export function anchoredAt(screen: ScreenInfo, l: WinLayout, x: number, y: number, w: number, h: number): WinLayout {
  const left = (x - screen.x) / screen.unit;
  const top = (y - screen.y) / screen.unit;
  const right = (screen.x + screen.w - x - w) / screen.unit;
  const bottom = (screen.y + screen.h - y - h) / screen.unit;
  return {
    ...l,
    dx: Math.max(0, Math.round(l.ax === "left" ? left : right)),
    dy: Math.max(0, Math.round(l.ay === "top" ? top : bottom)),
  };
}
