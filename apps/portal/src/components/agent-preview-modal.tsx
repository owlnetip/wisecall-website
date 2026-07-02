"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Loader2, Mic, MicOff, PhoneOff, X } from "lucide-react";
import { startAgentPreview } from "@/app/actions/preview";

type CallState = "connecting" | "live" | "ended" | "error";

type TranscriptTurn = { role: "caller" | "agent"; text: string };

export function AgentPreviewModal({
  agentId,
  agentLabel,
  onClose,
}: {
  agentId: string;
  agentLabel: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<CallState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);

  function cleanup() {
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  }

  function hangUp() {
    cleanup();
    setState("ended");
  }

  function closeModal() {
    cleanup();
    onClose();
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    (async () => {
      const session = await startAgentPreview(agentId);
      if (cancelled) return;
      if (!session.ok) {
        setError(session.error);
        setState("error");
        return;
      }

      let mic: MediaStream;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError("Microphone access is needed. Allow it in your browser and try again.");
        setState("error");
        return;
      }
      if (cancelled) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      micRef.current = mic;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (audioRef.current) {
          audioRef.current.srcObject = event.streams[0];
          audioRef.current.play().catch(() => {});
        }
      };
      mic.getTracks().forEach((track) => pc.addTrack(track, mic));

      const channel = pc.createDataChannel("oai-events");
      channel.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "output_audio_buffer.started") setAgentSpeaking(true);
          if (msg.type === "output_audio_buffer.stopped" || msg.type === "output_audio_buffer.cleared") {
            setAgentSpeaking(false);
          }
          if (msg.type === "response.output_audio_transcript.done" && msg.transcript) {
            setTranscript((prev) => [...prev, { role: "agent", text: msg.transcript }]);
          }
          if (
            msg.type === "conversation.item.input_audio_transcription.completed" &&
            msg.transcript?.trim()
          ) {
            setTranscript((prev) => [...prev, { role: "caller", text: msg.transcript.trim() }]);
          }
        } catch {
          // ignore non-JSON events
        }
      };
      channel.onopen = () => {
        channel.send(JSON.stringify({ type: "response.create" }));
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") setState("live");
        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          setState((s) => (s === "live" || s === "connecting" ? "ended" : s));
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls?model=gpt-realtime", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        });
        if (!sdpRes.ok) throw new Error(`Connection failed (${sdpRes.status})`);
        const answer = await sdpRes.text();
        if (cancelled) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't connect the preview call.");
          setState("error");
          cleanup();
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useEffect(() => {
    if (state !== "live") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript]);

  function toggleMute() {
    const next = !muted;
    micRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMuted(next);
  }

  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");

  const statusLabel =
    state === "connecting"
      ? "Connecting…"
      : state === "live"
        ? `${mins}:${secs}${agentSpeaking ? " · speaking" : ""}`
        : state === "ended"
          ? "Call ended"
          : "Couldn't connect";

  // Portal to document.body so fixed positioning isn't trapped by anim-rise/transform
  // ancestors inside the scrollable workspace layout.
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 max-sm:items-end max-sm:p-0">
      <div className="absolute inset-0 bg-[#0e1b1b]/60 backdrop-blur-sm" onClick={closeModal} />
      <div className="relative z-10 flex max-h-[min(92vh,720px)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-float max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:rounded-t-3xl">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={audioRef} autoPlay />

        <div className="bg-gradient-to-b from-[#172929] to-[#0e1b1b] px-5 pb-5 pt-4 text-white">
          <div className="mb-4 flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#7de8eb]/80">
                Browser preview
              </p>
              <p className="truncate text-lg font-black">{agentLabel}</p>
              <p className="text-xs text-white/60">{statusLabel}</p>
            </div>
            <button
              type="button"
              onClick={closeModal}
              aria-label="Close"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col items-center py-2">
            <div className="relative flex h-20 w-20 items-center justify-center">
              {(state === "connecting" || agentSpeaking) && (
                <span
                  className={`absolute inset-0 rounded-full ${
                    state === "connecting"
                      ? "animate-ping bg-[#7de8eb]/20"
                      : "animate-pulse bg-[#7de8eb]/30"
                  }`}
                />
              )}
              <span
                className={`relative flex h-16 w-16 items-center justify-center rounded-full text-xl font-black transition ${
                  agentSpeaking
                    ? "bg-[#7de8eb] text-[#0e1b1b]"
                    : state === "live"
                      ? "bg-white/15 text-[#7de8eb]"
                      : "bg-white/10 text-white/70"
                }`}
              >
                {(agentLabel || "A").charAt(0).toUpperCase()}
              </span>
            </div>
            <p className="mt-3 text-center text-sm text-white/80">
              {state === "connecting" && "Waiting for your agent to answer…"}
              {state === "live" && (agentSpeaking ? "Agent is speaking" : "Listening — say something")}
              {state === "ended" && "Preview ended"}
              {state === "error" && "Preview unavailable"}
            </p>
          </div>

          <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-white/50">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            Close-match browser voice — wording and knowledge match the live agent, not the exact phone voice.
          </p>
        </div>

        <div ref={scrollRef} className="min-h-[160px] flex-1 space-y-2.5 overflow-y-auto bg-[#f7fafa] px-4 py-4">
          {state === "connecting" && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-soft">
              <Loader2 className="h-4 w-4 animate-spin text-teal" />
              Setting up audio…
            </div>
          )}

          {state === "error" && (
            <div className="rounded-xl border border-danger/20 bg-danger-wash px-4 py-3 text-center text-sm text-danger">
              {error}
            </div>
          )}

          {(state === "live" || state === "ended") && transcript.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-faint">
              Your conversation will appear here as you talk.
            </p>
          )}

          {transcript.map((turn, i) => (
            <div key={i} className={`flex ${turn.role === "caller" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  turn.role === "caller"
                    ? "rounded-br-md bg-[#172929] text-white"
                    : "rounded-bl-md border border-line bg-white text-ink shadow-sm"
                }`}
              >
                {turn.text}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-3 border-t border-line bg-white px-4 py-3">
          {state === "live" && (
            <>
              <button
                type="button"
                onClick={toggleMute}
                className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
                  muted
                    ? "border-danger/30 bg-danger-wash text-danger"
                    : "border-line bg-white text-ink hover:bg-card-tint"
                }`}
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={hangUp}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-danger px-5 text-sm font-bold text-white transition hover:bg-[#a5301f]"
              >
                <PhoneOff className="h-4 w-4" />
                End
              </button>
            </>
          )}
          {(state === "ended" || state === "error") && (
            <button
              type="button"
              onClick={closeModal}
              className="inline-flex h-10 items-center rounded-lg bg-ink px-5 text-sm font-bold text-white transition hover:bg-[#263130]"
            >
              Done
            </button>
          )}
          {state === "connecting" && (
            <button
              type="button"
              onClick={closeModal}
              className="inline-flex h-10 items-center rounded-lg border border-line px-5 text-sm font-bold text-ink-soft transition hover:bg-card-tint"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
