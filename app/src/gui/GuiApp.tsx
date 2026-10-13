// The app's own windows: the profile window ("launcher") and Home ("home").
import "@fontsource/oxanium/400.css";
import "@fontsource/oxanium/500.css";
import "@fontsource/oxanium/600.css";
import "@fontsource/oxanium/700.css";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/700.css";
import "./gui.css";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { Home } from "./Home";
import { api } from "./session";
import { Launcher } from "./Launcher";
import { TitleBar } from "./TitleBar";

export function GuiApp({ view }: { view: "launcher" | "home" }) {
  // Home belongs to one profile for the whole run; its name goes in the title bar
  const [profile, setProfile] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion, () => setVersion(null));
    if (view === "home") api.session().then((s) => setProfile(s.profile?.name ?? null));
  }, [view]);
  return (
    <div className="appwin">
      <TitleBar resizable={view === "home"} version={version} profile={profile} />
      <div className="appbody">{view === "launcher" ? <Launcher /> : <Home />}</div>
    </div>
  );
}
