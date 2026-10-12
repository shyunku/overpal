import type { ViewId } from "./layout";
import { useSharedLayout } from "./OverlayWindow";
import { useOverlayData } from "./useOverlayData";
import { ItemsWindow, MenuBar, MinimapWindow, SettingsWindow } from "./views";
import "@fontsource/oxanium/400.css";
import "@fontsource/oxanium/600.css";
import "@fontsource/oxanium/700.css";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/700.css";
import "./overlay.css";

export function OverlayApp({ view }: { view: ViewId }) {
  const [layout, setLayout] = useSharedLayout();
  const data = useOverlayData();
  if (!layout) return null;
  const props = { layout, onLayout: setLayout, data };
  switch (view) {
    case "menubar":
      return <MenuBar {...props} />;
    case "items":
      return <ItemsWindow {...props} />;
    case "minimap":
      return <MinimapWindow {...props} />;
    case "settings":
      return <SettingsWindow {...props} />;
  }
}
