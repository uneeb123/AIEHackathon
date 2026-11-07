"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { ObserveTools, type ObservedTool } from "@/components/observe-tools";
import { RefreshCwIcon } from "lucide-react";

type AgentItem =
  | { type: "user"; text: string; author?: string; queued?: boolean }
  | { type: "assistant"; text: string; live?: boolean }
  | {
      type: "tool";
      id?: string;
      name: string;
      args?: unknown;
      status: string;
      output: string;
    }
  | { type: "note"; text: string };

type AgentState = {
  busy: boolean;
  model: string;
  items: AgentItem[];
  toolLog?: { id?: string; name: string; status: string }[];
};

export const Assistant = () => {
  const [state, setState] = useState<AgentState | null>(null);
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"ask" | "observe">("ask");
  const [tools, setTools] = useState<ObservedTool[]>([]);
  const messages = useMemo(() => toMessages(state), [state]);

  useEffect(() => {
    if (state?.toolLog) {
      setTools(state.toolLog);
      return;
    }
    const incoming = (state?.items ?? []).flatMap((item) =>
      item.type === "tool" ? [{ id: item.id, name: item.name, status: item.status }] : [],
    );
    if (incoming.length === 0) return;
    setTools((prev) => mergeTools(prev, incoming));
  }, [state]);

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

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/agent/reset", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? response.statusText);
      }
    } finally {
      setRefreshing(false);
    }
  }

  const status = !connected ? "reconnecting" : state?.busy ? "working" : "idle";

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <span className="font-medium">AIE</span>
          <div role="tablist" aria-label="Views" className="bg-muted flex items-center rounded-lg p-0.5">
            <TabButton selected={tab === "ask"} onClick={() => setTab("ask")}>
              Ask
            </TabButton>
            <TabButton selected={tab === "observe"} onClick={() => setTab("observe")}>
              Observe
            </TabButton>
          </div>
          <span className="text-muted-foreground ms-auto text-sm">
            {state?.model || "OpenRouter"} · {status}
          </span>
          <TooltipIconButton
            tooltip="Refresh"
            disabled={!connected || refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCwIcon />
          </TooltipIconButton>
        </header>
        <div className={tab === "ask" ? "min-h-0 flex-1" : "hidden"}>
          <Thread />
        </div>
        <div className={tab === "observe" ? "min-h-0 flex-1" : "hidden"}>
          <ObserveTools tools={tools} />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
};

function mergeTools(prev: ObservedTool[], incoming: ObservedTool[]) {
  const index = new Map(prev.map((tool, i) => [tool.id, i]));
  const next = prev.slice();
  let changed = false;
  for (const tool of incoming) {
    if (!tool.id) continue;
    const at = index.get(tool.id);
    if (at === undefined) {
      index.set(tool.id, next.length);
      next.push(tool);
      changed = true;
    } else if (next[at].status !== tool.status || next[at].name !== tool.name) {
      next[at] = tool;
      changed = true;
    }
  }
  return changed ? next : prev;
}

function TabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={
        selected
          ? "bg-background text-foreground rounded-md px-3 py-1 text-sm font-medium shadow-sm"
          : "text-muted-foreground hover:text-foreground rounded-md px-3 py-1 text-sm font-medium"
      }
    >
      {children}
    </button>
  );
}

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
      const running = item.status === "pending" || item.status === "running";
      draft.live = running;
      const args =
        item.args && typeof item.args === "object"
          ? (item.args as Record<string, unknown>)
          : { value: item.args ?? null };
      draft.parts.push({
        type: "tool-call",
        toolCallId: item.id ?? `tool-${index}`,
        toolName: item.name,
        args,
        ...(running
          ? { isPreliminary: true, ...(item.output ? { result: item.output } : {}) }
          : { result: item.output, isError: item.status === "error" }),
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
