import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { anchoredAt, cssZoom, getScreen, placeWindow, type MonitorRect, type ScreenInfo } from "./geometry";
import { loadLayout, onLayoutChanged, saveLayout, type Layout, type Size, type ViewId, type WinLayout } from "./layout";

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
  /**
   * Anchored to the top and to the screen edge (left or right) of the half the window's middle is
   * in, so a change of size (layout switch) keeps the top corner on that side in place.
   */
  sideAnchor?: boolean;
  /** edges and corners resize the window while the game shows a cursor; size in CSS px before zoom */
  resize?: { size: Size | null; min: Size; onDone: (size: Size, win: WinLayout) => void };
  children: ReactNode;
}

/**
 * Hosts one overlay window: zooms the content to the screen, fits the native window around it,
 * keeps it at its anchored place, shows/hides it, and lets the user drag it in edit mode.
 */
export function OverlayWindow({ view, layout, onLayout, scale = 1, className = "", passive = false, dragHandle, sideAnchor = false, resize, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<ScreenInfo | null>(null);
  const dragging = useRef(false);
  const latest = useRef(layout);
  latest.current = layout;
  // size and place while an edge is being dragged, stored when it is let go
  const [live, setLive] = useState<{ size: Size; win: WinLayout } | null>(null);
  const win = live?.win ?? layout.windows[view];
  const size = live?.size ?? resize?.size ?? null;
  const { visible, interactive, monitor } = useOverlayState();
  const shown = win.open && visible && !(passive && interactive && !layout.editMode);
  const takesMouse = layout.editMode && interactive;

  // overlay_watch.rs leaves passive windows alone
  useEffect(() => {
    // not setIgnoreCursorEvents: it brings back the window caption (overlay.rs, set_click_through)
    if (passive) invoke("click_through", { on: !takesMouse });
  }, [passive, takesMouse]);

  // gaining or losing focus brings a caption backdrop from the compositor at the window's top;
  // recomputing the frame clears it (overlay.rs, refresh_frame), done twice should it come late
  useEffect(() => {
    const timers: number[] = [];
    const un = getCurrentWindow().onFocusChanged(() => {
      for (const ms of [150, 500]) timers.push(window.setTimeout(() => invoke("refresh_frame"), ms));
    });
    return () => {
      un.then((f) => f());
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

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
      const pw = r.width * screen.dpr;
      const ph = r.height * screen.dpr;
      // sideAnchor: also a layout stored before this rule (or moved by a change of size) gets the
      // top corner of its side as anchor, keeping where it is now
      if (sideAnchor && !live) {
        const x = win.ax === "left" ? screen.x + win.dx * screen.unit : screen.x + screen.w - win.dx * screen.unit - pw;
        const y = win.ay === "top" ? screen.y + win.dy * screen.unit : screen.y + screen.h - win.dy * screen.unit - ph;
        const ax = x + pw / 2 < screen.x + screen.w / 2 ? "left" : "right";
        if (ax !== win.ax || win.ay !== "top") {
          const cur = latest.current;
          onLayout({ ...cur, windows: { ...cur.windows, [view]: anchoredAt(screen, { ...win, ax, ay: "top" }, x, y, pw, ph) } });
          return;
        }
      }
      placeWindow(screen, win, pw, ph).then(() => {
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

  // no text selection (also by double click or Ctrl+A) outside inputs
  useEffect(() => {
    const block = (e: Event) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    };
    document.addEventListener("selectstart", block);
    return () => document.removeEventListener("selectstart", block);
  }, []);

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
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !screen || dragging.current) return;
    const target = e.target as HTMLElement;
    const byHandle = interactive && !!dragHandle && !!target.closest(dragHandle);
    if (!layout.editMode && !byHandle) return;
    if (target.closest("button, input, [data-nodrag]")) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    dragging.current = true;
    const dpr = window.devicePixelRatio || 1;
    const startMouse = { x: e.screenX * dpr, y: e.screenY * dpr };
    let mouse = startMouse;
    const native = getCurrentWindow();
    // the listeners go on right away (a quick release must not be missed); the window's place and
    // the other windows arrive a moment later and moving starts then
    const info = Promise.all([native.innerPosition(), native.outerPosition(), native.innerSize(), invoke<[number, number, number, number][]>("overlay_rects")]).then(
      ([inner, outer, size, others]) => ({ inner, outer, size, others, at: { x: inner.x, y: inner.y } }),
    );
    let ready: Awaited<typeof info> | null = null;
    let frame = 0;
    const place = () => {
      frame = 0;
      if (!ready) return;
      const { inner, outer, size, others, at } = ready;
      const p = snap(screen, others, inner.x + mouse.x - startMouse.x, inner.y + mouse.y - startMouse.y, size.width, size.height);
      if (p.x === at.x && p.y === at.y) return;
      Object.assign(at, p);
      native.setPosition(new PhysicalPosition(p.x - (inner.x - outer.x), p.y - (inner.y - outer.y)));
    };
    info.then((i) => {
      ready = i;
      if (moved && !done) place();
    });
    // a click that does not move (e.g. on the title) leaves the window where it is, unsnapped
    let moved = false;
    let done = false;
    const move = (m: globalThis.PointerEvent) => {
      mouse = { x: m.screenX * dpr, y: m.screenY * dpr };
      if (!moved && Math.hypot(mouse.x - startMouse.x, mouse.y - startMouse.y) < DRAG_START_PX * dpr) return;
      moved = true;
      if (!frame) frame = requestAnimationFrame(place);
    };
    const up = async () => {
      done = true;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (frame) cancelAnimationFrame(frame);
      if (!moved) {
        dragging.current = false;
        return;
      }
      const i = await info;
      ready = i;
      place();
      const cur = latest.current;
      const win = cur.windows[view];
      const ax = sideAnchor ? (i.at.x + i.size.width / 2 < screen.x + screen.w / 2 ? "left" : "right") : win.ax;
      const ay = sideAnchor ? "top" : win.ay;
      const next = anchoredAt(screen, { ...win, ax, ay }, i.at.x, i.at.y, i.size.width, i.size.height);
      dragging.current = false;
      onLayout({ ...cur, windows: { ...cur.windows, [view]: next } });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const onResizeDown = (e: PointerEvent, dir: string) => {
    if (e.button !== 0 || !screen || !resize) return;
    e.stopPropagation();
    const el = ref.current!;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const dpr = window.devicePixelRatio || 1;
    const z = cssZoom(screen, scale);
    // physical px per CSS px of this window, and the largest size that fits on the screen
    const k = dpr * z;
    const r = el.getBoundingClientRect();
    const start = { w: r.width / z, h: r.height / z, mx: e.screenX * dpr, my: e.screenY * dpr };
    const max = { w: screen.w / k, h: screen.h / k };
    const base = layout.windows[view];
    let last = { size: { w: start.w, h: start.h }, win: base };
    const move = (m: globalThis.PointerEvent) => {
      const dx = (m.screenX * dpr - start.mx) / k;
      const dy = (m.screenY * dpr - start.my) / k;
      const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
      const w = dir.includes("e") ? clamp(start.w + dx, resize.min.w, max.w) : dir.includes("w") ? clamp(start.w - dx, resize.min.w, max.w) : start.w;
      const h = dir.includes("s") ? clamp(start.h + dy, resize.min.h, max.h) : dir.includes("n") ? clamp(start.h - dy, resize.min.h, max.h) : start.h;
      // the anchored edge stays put, so growing toward it moves the window by the change
      const gw = ((w - start.w) * k) / screen.unit;
      const gh = ((h - start.h) * k) / screen.unit;
      const next = { ...base };
      if ((dir.includes("w") && base.ax === "left") || (dir.includes("e") && base.ax === "right")) next.dx = Math.max(0, base.dx - gw);
      if ((dir.includes("n") && base.ay === "top") || (dir.includes("s") && base.ay === "bottom")) next.dy = Math.max(0, base.dy - gh);
      last = { size: { w, h }, win: next };
      setLive(last);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setLive(null);
      if (last.size.w !== start.w || last.size.h !== start.h) resize.onDone(last.size, last.win);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const canResize = !!resize && interactive;

  const style = {
    zoom: screen ? cssZoom(screen, scale) : 1,
    ...(size ? { "--win-w": `${size.w}px`, "--win-h": `${size.h}px` } : {}),
    visibility: screen ? "visible" : "hidden",
    "--glass-alpha": layout.opacity,
    // Windows rounds the window (and its blur) by 8 px times the display scale (DWMWCP_ROUND);
    // in this window's zoomed CSS px that is 8 / zoom, which keeps the panel corners on that curve
    "--win-radius": screen ? `${8 / cssZoom(screen, scale)}px` : "8px",
  } as CSSProperties;

  return (
    <div ref={ref} className={`ow ${className} ${layout.editMode ? "editing" : ""} ${interactive ? "live" : ""} ${size ? "sized" : ""}`} style={style} onPointerDown={onPointerDown}>
      {children}
      {canResize && (
        <>
          <span className="corner" />
          {["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((d) => (
            <span key={d} className={`rz ${d}`} onPointerDown={(e) => onResizeDown(e, d)} />
          ))}
        </>
      )}
    </div>
  );
}

/** gap kept to the screen edges and to other overlay windows, and how far from it a window snaps (physical px) */
const SNAP_GAP = 8;
/** pointer travel (CSS px) before a press on a drag handle becomes a drag */
const DRAG_START_PX = 4;
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

