// Receives the mod output from the app server as it changes (GET /api/events, server-sent events).
// EventSource cannot send the Authorization header, so the stream is read with fetch.

import type { BaseStorage, ClientConfig } from "../types";

const RETRY_MS = 2000;

/** Calls `onStorage` with every new version until `signal` aborts; reconnects on errors. */
export async function streamStorage(cfg: ClientConfig, onStorage: (s: BaseStorage) => void, onDown: (e: unknown) => void, signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      const res = await fetch(`${cfg.serverUrl.replace(/\/$/, "")}/api/events`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`events: ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        // events are separated by a blank line
        let end: number;
        while ((end = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, end);
          buf = buf.slice(end + 2);
          let event = "message";
          const data: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
          }
          if (event === "storage" && data.length) onStorage(JSON.parse(data.join("\n")) as BaseStorage);
        }
      }
      throw new Error("events stream ended");
    } catch (e) {
      if (signal.aborted) return;
      onDown(e);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
}
