// The item tooltip, in its own overlay window so it can sit outside the main window (to its right)
// without covering the list. The main window sends what to show and where with emitTip().
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { cssZoom, getScreen, type ScreenInfo } from "./geometry";

const ITEM_TIP = "item-tip";

export interface TipPayload {
  name: string;
  /** where the item is stored: place and count */
  lines: { label: string; count: number; tone: "inventory" | "production" | null }[];
  /** physical px: left edge and the top of the hovered row */
  x: number;
  y: number;
  /** scale of the window that sent it, so the text has the same size */
  scale: number;
}

/** Shows (payload) or hides (null) the tooltip window. */
export function emitTip(tip: TipPayload | null): void {
  emitTo("tooltip", ITEM_TIP, tip);
}

export function TooltipWindow() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipPayload | null>(null);
  const [screen, setScreen] = useState<ScreenInfo | null>(null);

  useEffect(() => {
    invoke("click_through", { on: true });
    getScreen().then(setScreen);
    const un = listen<TipPayload | null>(ITEM_TIP, (e) => setTip(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // size the window to the content, keep it on the monitor, then show it
  useLayoutEffect(() => {
    const native = getCurrentWindow();
    const el = ref.current;
    if (!tip || !el || !screen) {
      invoke("set_shown", { on: false });
      return;
    }
    // a newer tip (or a hide) while this one was being placed cancels its show
    let cancelled = false;
    const r = el.getBoundingClientRect();
    const w = Math.ceil(r.width * screen.dpr);
    const h = Math.ceil(r.height * screen.dpr);
    const y = Math.min(tip.y, screen.y + screen.h - h - 8);
    Promise.all([native.setSize(new PhysicalSize(w, h)), native.setPosition(new PhysicalPosition(Math.round(tip.x), Math.round(y)))]).then(() => {
      if (cancelled) return;
      const radius = getComputedStyle(el).borderTopLeftRadius;
      if (radius.endsWith("px")) invoke("round_corners", { radius: parseFloat(radius) * cssZoom(screen, tip.scale) * screen.dpr });
      invoke("set_shown", { on: true });
    });
    return () => {
      cancelled = true;
    };
  }, [tip, screen]);

  const zoom = screen && tip ? cssZoom(screen, tip.scale) : 1;
  return (
    <div ref={ref} className="glass tip-win" style={{ zoom, "--win-radius": `${8 / zoom}px` } as React.CSSProperties}>
      {tip && (
        <>
          <b>{tip.name}</b>
          {tip.lines.map((l) => (
            <div className={`tip-line ${l.tone ? `tone-${l.tone}` : ""}`} key={l.label}>
              <span>{l.label}</span>
              <span className="tabular">{l.count}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
