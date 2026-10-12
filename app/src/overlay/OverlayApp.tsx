import type { ViewId } from "./layout";
import { TooltipWindow } from "./TooltipWindow";
import { useSharedLayout } from "./OverlayWindow";
import { MINIMAP_PLAYERS_MS, useOverlayData } from "./useOverlayData";
import { MainWindow, MenuBar, MinimapWindow, SettingsWindow } from "./views";
import "@fontsource/oxanium/400.css";
import "@fontsource/oxanium/500.css";
import "@fontsource/oxanium/600.css";
import "@fontsource/oxanium/700.css";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/700.css";
import "./overlay.css";

export function OverlayApp({ view }: { view: ViewId | "tooltip" }) {
  // the tooltip window only shows what the main window sends; it loads no data
  return view === "tooltip" ? <TooltipWindow /> : <Panel view={view} />;
}

function Panel({ view }: { view: ViewId }) {
  const [layout, setLayout] = useSharedLayout();
  const data = useOverlayData(view === "minimap" ? MINIMAP_PLAYERS_MS : undefined);
  if (!layout) return null;
  const props = { layout, onLayout: setLayout, data };
  switch (view) {
    case "menubar":
      return <MenuBar {...props} />;
    case "items":
      return <MainWindow {...props} />;
    case "minimap":
      return <MinimapWindow {...props} />;
    case "settings":
      return <SettingsWindow {...props} />;
  }
}
