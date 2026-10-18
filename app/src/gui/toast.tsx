// Short notices at the top right of the app window (how an action went), gone on their own.
import { useEffect, useState } from "react";
import { Icon } from "./icons";

export type ToastKind = "ok" | "bad" | "info";
interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

/** how long a notice stays */
const TOAST_MS = 3000;

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((f) => f(toasts));

/** Shows a notice at the top right for a few seconds. */
export function showToast(text: string, kind: ToastKind = "info") {
  const t = { id: nextId++, text, kind };
  toasts = [...toasts, t];
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, TOAST_MS);
}

/** The notices; rendered once in the window. */
export function Toasts() {
  const [list, setList] = useState(toasts);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return (
    <div className="toasts">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === "ok" ? "check" : t.kind === "bad" ? "xcircle" : "info"} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
