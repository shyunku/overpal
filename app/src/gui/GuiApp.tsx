// The app's own windows: the profile window ("launcher") and Home ("home").
import "@fontsource/oxanium/400.css";
import "@fontsource/oxanium/500.css";
import "@fontsource/oxanium/600.css";
import "@fontsource/oxanium/700.css";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/700.css";
import "./gui.css";
import { Home } from "./Home";
import { Launcher } from "./Launcher";

export function GuiApp({ view }: { view: "launcher" | "home" }) {
  return view === "launcher" ? <Launcher /> : <Home />;
}
