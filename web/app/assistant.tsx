"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";

type AgentItem =
  | { type: "user"; text: string; author?: string; queued?: boolean }
  | { type: "assistant"; text: string; live?: boolean }
  | { type: "tool"; name: string; args?: unknown; status: string; output: string }
  | { type: "note"; text: string };

type AgentState = {
  busy: boolean;
  model: string;
  items: AgentItem[];
};

export const Assistant = () => {
  const [state, setState] = useState<AgentState | null>(null);
  const [connected, setConnected] = useState(false);
  const messages = useMemo(() => toMessages(state), [state]);

  useEffect(() => {
    const events = new EventSource("/api/agent/events");
    events.onopen = () => setConnected(true);
    events.onmessage = (event) => {
      setConnected(true);
      setState(JSON.parse(event.data) as AgentState);
    };
    events.onerror = () => setConnected(false);
    return () => events.close();
  }, []);

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: state?.busy ?? false,
    convertMessage: (message) => message,
    onNew: async (message) => {
      const text = textOf(message);
      const response = await fetch("/api/agent/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, requestId: crypto.randomUUID() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? response.statusText);
      }
    },
    onCancel: async () => {
      await fetch("/api/agent/stop", { method: "POST" });
    },
  });

  const status = !connected ? "reconnecting" : state?.busy ? "working" : "idle";

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <span className="font-medium">AIE</span>
          <span className="text-muted-foreground text-sm">
            {state?.model || "OpenRouter"} · {status}
          </span>
        </header>
        <div className="min-h-0 flex-1">
          <Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
};

function textOf(message: AppendMessage) {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

function toMessages(state: AgentState | null): ThreadMessageLike[] {
  if (!state) return [];
  const messages: ThreadMessageLike[] = [];
  let draft: { parts: ThreadMessageLike["content"]; live: boolean } | null = null;
  const flush = () => {
    if (!draft || !Array.isArray(draft.parts) || draft.parts.length === 0) {
      draft = null;
      return;
    }
    messages.push({
      role: "assistant",
      id: `assistant-${messages.length}`,
      content: draft.parts,
      status: draft.live ? { type: "running" } : { type: "complete", reason: "stop" },
    });
    draft = null;
  };

  state.items.forEach((item, index) => {
    if (item.type === "user") {
      flush();
      messages.push({
        role: "user",
        id: `user-${index}`,
        content: [{ type: "text", text: item.text }],
      });
      return;
    }
    draft ??= { parts: [], live: false };
    if (!Array.isArray(draft.parts)) return;
    if (item.type === "assistant") {
      draft.live = Boolean(item.live);
      draft.parts.push({ type: "text", text: item.text });
    } else if (item.type === "tool") {
      draft.live = item.status === "pending" || item.status === "running";
      const args =
        item.args && typeof item.args === "object"
          ? (item.args as Record<string, unknown>)
          : { value: item.args ?? null };
      draft.parts.push({
        type: "tool-call",
        toolCallId: `tool-${index}`,
        toolName: item.name,
        args,
        result: item.output,
        isError: item.status === "error",
      });
    } else {
      draft.parts.push({ type: "text", text: item.text });
    }
  });
  flush();

  if (state.busy && messages.at(-1)?.role !== "assistant") {
    messages.push({
      role: "assistant",
      id: "pending",
      content: [{ type: "text", text: "" }],
      status: { type: "running" },
    });
  }
  return messages;
}
