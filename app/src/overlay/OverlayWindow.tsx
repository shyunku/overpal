import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { anchoredAt, cssZoom, getScreen, placeWindow, type MonitorRect, type ScreenInfo } from "./geometry";
import { loadLayout, onLayoutChanged, saveLayout, type Layout, type ViewId } from "./layout";

/** Layout shared by all overlay windows; updates are saved and broadcast to the others. */
export function useSharedLayout(): [Layout | null, (next: Layout) => void] {
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    loadLayout().then(setLayout);
    const un = onLayoutChanged(setLayout);
    return () => {
      un.then((f) => f());
    };
  }, []);
  const update = (next: Layout) => {
    setLayout(next);
    saveLayout(next).catch((e) => console.error("layout save failed", e));
  };
  return [layout, update];
}

interface OverlayState {
  /** decided from the game window: in front, minimized, or behind another window on its monitor */
  visible: boolean;
  /** the game shows a cursor, so the overlay takes the mouse */
  interactive: boolean;
  /** monitor of the game window */
  monitor: MonitorRect | null;
}

/** Foreground/cursor state decided by the Rust side (overlay_watch.rs). */
export function useOverlayState(): OverlayState {
  const [state, setState] = useState<OverlayState>({ visible: false, interactive: false, monitor: null });
  useEffect(() => {
    invoke<OverlayState>("overlay_state").then(setState);
    const un = listen<OverlayState>("overlay-state", (e) => setState(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);
  return state;
}

interface Props {
  view: ViewId;
  layout: Layout;
  onLayout: (next: Layout) => void;
  /** content size relative to the stage design (the item window is drawn smaller) */
  scale?: number;
  className?: string;
  /**
   * Never takes the mouse and is hidden while the game shows a cursor (the minimap).
   * In edit mode it shows and takes the mouse so it can be moved.
   */
  passive?: boolean;
  /** while the game shows a cursor, dragging this part (a selector) moves the window also outside edit mode */
  dragHandle?: string;
  /** after a drag, anchor to the screen edge (left or right) of the half the window's middle is in */
  sideAnchor?: boolean;
  children: ReactNode;
}

/**
 * Hosts one overlay window: zooms the content to the screen, fits the native window around it,
 * keeps it at its anchored place, shows/hides it, and lets the user drag it in edit mode.
 */
export function OverlayWindow({ view, layout, onLayout, scale = 1, className = "", passive = false, dragHandle, sideAnchor = false, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<ScreenInfo | null>(null);
  const dragging = useRef(false);
  const latest = useRef(layout);
  latest.current = layout;
  const win = layout.windows[view];
  const { visible, interactive, monitor } = useOverlayState();
  const shown = win.open && visible && !(passive && interactive && !layout.editMode);
  const takesMouse = layout.editMode && interactive;

  // overlay_watch.rs leaves passive windows alone
  useEffect(() => {
    // not setIgnoreCursorEvents: it brings back the window caption (overlay.rs, set_click_through)
    if (passive) invoke("click_through", { on: !takesMouse });
  }, [passive, takesMouse]);

  useEffect(() => {
    getScreen(monitor).then(setScreen);
  }, [monitor?.x, monitor?.y, monitor?.w, monitor?.h]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !screen) return;
    if (!shown) {
      // not native.hide()/show(): they bring back the window caption (overlay.rs, set_shown)
      invoke("set_shown", { on: false });
      return;
    }
    let revealed = false;
    const fit = () => {
      if (dragging.current) return;
      const r = el.getBoundingClientRect();
      placeWindow(screen, win, r.width * screen.dpr, r.height * screen.dpr).then(() => {
        // clip the window (and the blur behind it) to the panel's corner radius; a circle
        // (the minimap, given as a percentage) has no blur and is left alone
        const radius = getComputedStyle(el).borderTopLeftRadius;
        if (radius.endsWith("px") && parseFloat(radius) > 0) {
          invoke("round_corners", { radius: parseFloat(radius) * cssZoom(screen, scale) * screen.dpr });
        }
        if (!revealed) {
          revealed = true;
          invoke("set_shown", { on: true });
        }
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [screen, shown, win.ax, win.dx, win.ay, win.dy, scale]);

  // never stay minimized (e.g. by "minimize all"): a minimized overlay window shows as a title bar stub
  useEffect(() => {
    const native = getCurrentWindow();
    const un = native.onResized(async () => {
      if (await native.isMinimized()) native.unminimize();
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // dragged here (not the system's move loop) so the window can snap while it moves; on release
  // the new place is stored relative to the window's anchors
  const onPointerDown = async (e: PointerEvent) => {
    if (e.button !== 0 || !screen || dragging.current) return;
    const target = e.target as HTMLElement;
    const byHandle = interactive && !!dragHandle && !!target.closest(dragHandle);
    if (!layout.editMode && !byHandle) return;
    if (target.closest("button, input, [data-nodrag]")) return;
    const el = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    el.setPointerCapture(pointerId);
    dragging.current = true;
    const dpr = window.devicePixelRatio || 1;
    let mouse = { x: e.screenX * dpr, y: e.screenY * dpr };
    const native = getCurrentWindow();
    const [inner, outer, size, others] = await Promise.all([native.innerPosition(), native.outerPosition(), native.innerSize(), invoke<[number, number, number, number][]>("overlay_rects")]);
    const start = { x: inner.x, y: inner.y, mx: mouse.x, my: mouse.y };
    const at = { x: inner.x, y: inner.y };
    let frame = 0;
    const place = () => {
      frame = 0;
      const p = snap(screen, others, start.x + mouse.x - start.mx, start.y + mouse.y - start.my, size.width, size.height);
      if (p.x === at.x && p.y === at.y) return;
      Object.assign(at, p);
      native.setPosition(new PhysicalPosition(p.x - (inner.x - outer.x), p.y - (inner.y - outer.y)));
    };
    const move = (m: globalThis.PointerEvent) => {
      mouse = { x: m.screenX * dpr, y: m.screenY * dpr };
      if (!frame) frame = requestAnimationFrame(place);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (frame) cancelAnimationFrame(frame);
      place();
      const cur = latest.current;
      const win = cur.windows[view];
      const ax = sideAnchor ? (at.x + size.width / 2 < screen.x + screen.w / 2 ? "left" : "right") : win.ax;
      const moved = anchoredAt(screen, { ...win, ax }, at.x, at.y, size.width, size.height);
      dragging.current = false;
      onLayout({ ...cur, windows: { ...cur.windows, [view]: moved } });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const style = {
    zoom: screen ? cssZoom(screen, scale) : 1,
    visibility: screen ? "visible" : "hidden",
    "--glass-alpha": layout.opacity,
    // Windows rounds the window (and its blur) by 8 px times the display scale (DWMWCP_ROUND);
    // in this window's zoomed CSS px that is 8 / zoom, which keeps the panel corners on that curve
    "--win-radius": screen ? `${8 / cssZoom(screen, scale)}px` : "8px",
  } as CSSProperties;

  return (
    <div ref={ref} className={`ow ${className} ${layout.editMode ? "editing" : ""} ${interactive ? "live" : ""}`} style={style} onPointerDown={onPointerDown}>
      {children}
    </div>
  );
}

/** gap kept to the screen edges and to other overlay windows, and how far from it a window snaps (physical px) */
const SNAP_GAP = 15;
const SNAP_RANGE = 15;

/** Where a window dragged to (x, y) lands: snapped to the screen edges and beside other windows. */
function snap(screen: ScreenInfo, others: [number, number, number, number][], x: number, y: number, w: number, h: number) {
  const nearest = (v: number, targets: number[]) => {
    let best = v;
    let dist = SNAP_RANGE + 1;
    for (const t of targets) {
      if (Math.abs(t - v) < dist) {
        dist = Math.abs(t - v);
        best = t;
      }
    }
    return Math.round(best);
  };
  const xs = [screen.x + SNAP_GAP, screen.x + screen.w - SNAP_GAP - w];
  const ys = [screen.y + SNAP_GAP, screen.y + screen.h - SNAP_GAP - h];
  for (const [ox, oy, ow, oh] of others) {
    // beside another window only where the two overlap on the other axis
    if (oy < y + h && oy + oh > y) xs.push(ox + ow + SNAP_GAP, ox - SNAP_GAP - w);
    if (ox < x + w && ox + ow > x) ys.push(oy + oh + SNAP_GAP, oy - SNAP_GAP - h);
  }
  return { x: nearest(x, xs), y: nearest(y, ys) };
}

