"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RECONNECT_DELAYS_MS, classifyClose } from "@/lib/close-codes";
import { WS_URL } from "@/lib/config";
import type { Envelope } from "@/lib/types";

export type SocketStatus = "idle" | "connecting" | "open" | "reconnecting" | "lost";

export interface SocketParams {
  name: string;
  userId?: string;
  passcode?: string;
  audio: boolean;
  video: boolean;
}

export type SendFn = (type: string, payload?: Record<string, unknown>, to?: string) => boolean;

interface Options {
  enabled: boolean;
  meetingId: string;
  clientId: string | null;
  /** Read at every (re)connect, so the audio/video seed is always current. */
  getParams: () => SocketParams;
  onMessage: (env: Envelope) => void;
  /** A close that retrying cannot fix (4001, 4003, 4004, 4005, 4008, 4009, 4400...). */
  onTerminal: (code: number, reason: string) => void;
}

const PING_EVERY_MS = 25_000;
const PONG_WITHIN_MS = 10_000;

/**
 * One WebSocket to /ws/meeting/{id}/{client_id}.
 *
 * Strict Mode / double-mount safety (this is what prevents spurious 4009 closes):
 *  1. The connect is deferred by a 0 ms timer that the effect cleanup cancels, so the
 *     throw-away first mount of Strict Mode never opens a socket.
 *  2. Every handler checks `wsRef.current === ws`; cleanup detaches the handlers and clears
 *     the ref BEFORE closing, so a late event from an old socket can never be mistaken for
 *     the current one (and a 4009 aimed at a superseded socket is ignored).
 */
export function useMeetingSocket(options: Options) {
  const { enabled, meetingId, clientId } = options;
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  const [status, setStatus] = useState<SocketStatus>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timers = useRef<{
    reconnect?: ReturnType<typeof setTimeout>;
    ping?: ReturnType<typeof setInterval>;
    pong?: ReturnType<typeof setTimeout>;
  }>({});
  const connectRef = useRef<() => void>(() => {});

  const clearTimers = useCallback(() => {
    clearTimeout(timers.current.reconnect);
    clearInterval(timers.current.ping);
    clearTimeout(timers.current.pong);
    timers.current = {};
  }, []);

  const detach = useCallback((ws: WebSocket) => {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  }, []);

  const handleClose = useCallback(
    (ws: WebSocket, code: number, reason: string) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      clearTimers();
      detach(ws);

      const outcome = classifyClose(code);
      if (outcome.kind !== "reconnect") {
        setStatus("idle");
        optsRef.current.onTerminal(code, reason);
        return;
      }
      const delay = RECONNECT_DELAYS_MS[attemptRef.current];
      if (delay === undefined) {
        setStatus("lost");
        return;
      }
      attemptRef.current += 1;
      setStatus("reconnecting");
      timers.current.reconnect = setTimeout(() => connectRef.current(), delay);
    },
    [clearTimers, detach],
  );

  const connect = useCallback(() => {
    const o = optsRef.current;
    if (!o.enabled || !o.clientId) return;

    const p = o.getParams();
    const query = new URLSearchParams({
      name: p.name.slice(0, 120),
      audio: p.audio ? "1" : "0",
      video: p.video ? "1" : "0",
    });
    if (p.userId) query.set("user_id", p.userId);
    if (p.passcode) query.set("passcode", p.passcode.slice(0, 64));

    const ws = new WebSocket(
      `${WS_URL}/ws/meeting/${encodeURIComponent(o.meetingId)}/${encodeURIComponent(o.clientId)}?${query}`,
    );
    wsRef.current = ws;
    setStatus(attemptRef.current === 0 ? "connecting" : "reconnecting");

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      attemptRef.current = 0;
      setStatus("open");
      timers.current.ping = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "ping" }));
        clearTimeout(timers.current.pong);
        timers.current.pong = setTimeout(() => {
          // No pong: the connection is dead even if the browser has not noticed yet.
          handleClose(ws, 1006, "Heartbeat timeout");
          try {
            ws.close();
          } catch {
            /* already closed */
          }
        }, PONG_WITHIN_MS);
      }, PING_EVERY_MS);
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws || typeof event.data !== "string") return;
      let env: Envelope;
      try {
        env = JSON.parse(event.data) as Envelope;
      } catch {
        return;
      }
      if (env.type === "pong") {
        clearTimeout(timers.current.pong);
        timers.current.pong = undefined;
        return;
      }
      optsRef.current.onMessage(env);
    };

    ws.onclose = (event) => handleClose(ws, event.code, event.reason);
    ws.onerror = () => {
      /* a close event always follows */
    };
  }, [handleClose]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (!enabled || !clientId) return;
    attemptRef.current = 0;
    const start = setTimeout(() => connectRef.current(), 0);
    return () => {
      clearTimeout(start);
      clearTimers();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        detach(ws);
        try {
          ws.close(1000, "leaving");
        } catch {
          /* ignore */
        }
      }
      setStatus("idle");
    };
  }, [enabled, clientId, meetingId, clearTimers, detach]);

  const send = useCallback<SendFn>((type, payload = {}, to) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type, ...(to ? { to } : {}), payload }));
    return true;
  }, []);

  /** Manual retry after status "lost" (the Rejoin button). */
  const reconnect = useCallback(() => {
    if (wsRef.current) return;
    attemptRef.current = 0;
    clearTimers();
    connectRef.current();
  }, [clearTimers]);

  return { status, send, reconnect };
}
