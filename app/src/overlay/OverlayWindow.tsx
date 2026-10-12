import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  children: ReactNode;
}

/**
 * Hosts one overlay window: zooms the content to the screen, fits the native window around it,
 * keeps it at its anchored place, shows/hides it, and lets the user drag it in edit mode.
 */
export function OverlayWindow({ view, layout, onLayout, scale = 1, className = "", passive = false, children }: Props) {
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
    if (passive) getCurrentWindow().setIgnoreCursorEvents(!takesMouse);
  }, [passive, takesMouse]);

  useEffect(() => {
    getScreen(monitor).then(setScreen);
  }, [monitor?.x, monitor?.y, monitor?.w, monitor?.h]);

  useLayoutEffect(() => {
    const el = ref.current;
    const native = getCurrentWindow();
    if (!el || !screen) return;
    if (!shown) {
      native.hide();
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
          native.show();
        }
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [screen, shown, win.ax, win.dx, win.ay, win.dy, scale]);

  // after a drag, store the new place relative to the window's anchors
  useEffect(() => {
    if (!screen) return;
    const native = getCurrentWindow();
    let timer: number | undefined;
    const un = native.onMoved(() => {
      if (!dragging.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        dragging.current = false;
        const [pos, size] = await Promise.all([native.innerPosition(), native.innerSize()]);
        const cur = latest.current;
        const moved = anchoredAt(screen, cur.windows[view], pos.x, pos.y, size.width, size.height);
        onLayout({ ...cur, windows: { ...cur.windows, [view]: moved } });
      }, 400);
    });
    return () => {
      window.clearTimeout(timer);
      un.then((f) => f());
    };
  }, [screen]);

  const onMouseDown = (e: MouseEvent) => {
    if (!layout.editMode || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, [data-nodrag]")) return;
    dragging.current = true;
    getCurrentWindow().startDragging();
  };

  const style = {
    zoom: screen ? cssZoom(screen, scale) : 1,
    visibility: screen ? "visible" : "hidden",
    "--glass-alpha": layout.opacity,
  } as CSSProperties;

  return (
    <div ref={ref} className={`ow ${className} ${layout.editMode ? "editing" : ""}`} style={style} onMouseDown={onMouseDown}>
      {children}
    </div>
  );
}
