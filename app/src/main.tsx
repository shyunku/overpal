import React from "react";
import ReactDOM from "react-dom/client";

const VIEWS = ["menubar", "items", "minimap", "settings", "tooltip"] as const;
type View = (typeof VIEWS)[number];

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const view = new URLSearchParams(window.location.search).get("view") as View | null;

// Each window loads only what it needs; the debug screen's CSS must not reach the transparent overlay windows.
const GUI_VIEWS = ["launcher", "home"] as const;
type GuiView = (typeof GUI_VIEWS)[number];
const gui = new URLSearchParams(window.location.search).get("view") as GuiView | null;

if (gui && GUI_VIEWS.includes(gui)) {
  import("./gui/GuiApp").then(({ GuiApp }) =>
    root.render(
      <React.StrictMode>
        <GuiApp view={gui} />
      </React.StrictMode>,
    ),
  );
} else if (view && VIEWS.includes(view)) {
  import("./overlay/OverlayApp").then(({ OverlayApp }) =>
    root.render(
      <React.StrictMode>
        <OverlayApp view={view} />
      </React.StrictMode>,
    ),
  );
} else {
  import("./App").then(({ default: App }) =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
}
