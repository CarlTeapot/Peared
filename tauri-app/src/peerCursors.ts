import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { editor } from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { peerColor } from "./lib/peerColor";
import type { RoomState } from "./hooks/useRoomState";

/** Mirrors the backend's PeerCursorPayload (session://peer-cursor). */
export interface PeerCursorEvent {
  client_id: string;
  sel_start: number;
  sel_end: number;
}

interface TrackedCursor {
  collection: editor.IEditorDecorationsCollection;
}

const STYLE_ELEMENT_ID = "peer-cursor-styles";
const SEND_THROTTLE_MS = 100;

function cssEscapeLabel(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Throttled (trailing-edge) sender for the local cursor/selection. Presence is
 * best-effort: failures are swallowed, the next cursor move re-sends anyway.
 */
export function createCursorSender(
  shouldSend: () => boolean,
): (selStart: number, selEnd: number) => void {
  let timer: number | null = null;
  let pending: { selStart: number; selEnd: number } | null = null;

  const flush = () => {
    timer = null;
    if (!pending) return;
    const payload = pending;
    pending = null;
    void invoke("send_cursor", payload).catch(() => undefined);
  };

  return (selStart, selEnd) => {
    if (!shouldSend()) return;
    pending = { selStart, selEnd };
    if (timer === null) timer = window.setTimeout(flush, SEND_THROTTLE_MS);
  };
}

/**
 * Renders remote peers' cursors and selections as Monaco decorations, colored
 * with the same peerColor() the avatars use and labeled with the username from
 * the roster. Decorations track edits automatically (Monaco shifts them), so a
 * cursor stays visually anchored between presence updates. Cursors for peers
 * that leave the room (or the whole session ending) are cleared via roomState.
 */
export function usePeerCursors({
  editorRef,
  monacoRef,
  roomState,
}: {
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  monacoRef: RefObject<Monaco | null>;
  roomState: RoomState | null;
}) {
  const cursorsRef = useRef<Map<string, TrackedCursor>>(new Map());
  const roomStateRef = useRef<RoomState | null>(null);
  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  // One injected stylesheet holds the per-peer color/label rules; client ids
  // are decimal digits, so they are safe to embed in class names.
  const rebuildStyles = useCallback(() => {
    let el = document.getElementById(
      STYLE_ELEMENT_ID,
    ) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ELEMENT_ID;
      document.head.appendChild(el);
    }
    const rules: string[] = [];
    for (const id of cursorsRef.current.keys()) {
      const color = peerColor(id);
      const peer = roomStateRef.current?.peers.find((p) => p.client_id === id);
      const label = cssEscapeLabel(peer?.username || `#${id.slice(-4)}`);
      rules.push(
        `.peer-sel-${id} { background: color-mix(in srgb, ${color} 25%, transparent); }`,
        `.peer-caret-${id} { border-left: 2px solid ${color}; }`,
        `.peer-caret-${id}::after { content: "${label}"; background: ${color}; }`,
      );
    }
    el.textContent = rules.join("\n");
  }, []);

  useTauriEvents(
    useCallback(
      (on) => {
        on<PeerCursorEvent>("session://peer-cursor", (ev) => {
          const ed = editorRef.current;
          const monaco = monacoRef.current;
          const model = ed?.getModel();
          if (!ed || !monaco || !model) return;

          let entry = cursorsRef.current.get(ev.client_id);
          if (!entry) {
            entry = { collection: ed.createDecorationsCollection() };
            cursorsRef.current.set(ev.client_id, entry);
            rebuildStyles();
          }

          // Offsets may be slightly stale relative to concurrent edits; clamp
          // so they always resolve to a valid model position.
          const max = model.getValueLength();
          const start = model.getPositionAt(Math.min(ev.sel_start, max));
          const end = model.getPositionAt(Math.min(ev.sel_end, max));

          const decorations: editor.IModelDeltaDecoration[] = [];
          if (ev.sel_start !== ev.sel_end) {
            decorations.push({
              range: monaco.Range.fromPositions(start, end),
              options: {
                className: `peer-remote-selection peer-sel-${ev.client_id}`,
                stickiness:
                  monaco.editor.TrackedRangeStickiness
                    .NeverGrowsWhenTypingAtEdges,
              },
            });
          }
          decorations.push({
            range: monaco.Range.fromPositions(end, end),
            options: {
              beforeContentClassName: `peer-remote-cursor peer-caret-${ev.client_id}`,
              stickiness:
                monaco.editor.TrackedRangeStickiness
                  .NeverGrowsWhenTypingAtEdges,
            },
          });
          entry.collection.set(decorations);
        });
      },
      [editorRef, monacoRef, rebuildStyles],
    ),
  );

  // Drop cursors of peers that left; clear everything when the session ends.
  useEffect(() => {
    const tracked = cursorsRef.current;
    if (!roomState) {
      for (const entry of tracked.values()) entry.collection.clear();
      tracked.clear();
      rebuildStyles();
      return;
    }
    const present = new Set(roomState.peers.map((p) => p.client_id));
    for (const [id, entry] of tracked) {
      if (!present.has(id)) {
        entry.collection.clear();
        tracked.delete(id);
      }
    }
    // Usernames can arrive after the first cursor frame; refresh labels.
    rebuildStyles();
  }, [roomState, rebuildStyles]);

  useEffect(() => {
    const tracked = cursorsRef.current;
    return () => {
      for (const entry of tracked.values()) entry.collection.clear();
      tracked.clear();
    };
  }, []);
}
