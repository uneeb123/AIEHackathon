import { existsSync, readFileSync, watch } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import {
  AssistantEntry,
  createRegistry,
  defineExtension,
  Harness,
  section,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const dir = import.meta.dirname;
loadEnv(join(dir, "agent.env"));

const workspace = join(dir, "workspace");
const extensionsDir = join(dir, "extensions");
const model = {
  provider: "openrouter",
  modelId: "meta/muse-spark-1.3-contributor",
};
const context = BACKGROUND_CONTEXT;
let ready = false;

await mkdir(join(dir, "data"), { recursive: true });
await mkdir(workspace, { recursive: true });
await mkdir(extensionsDir, { recursive: true });

const server = createServer((req, res) =>
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent)
      send(res, 500, { error: String(error?.message ?? error) });
  }),
);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(Number(process.env.PORT ?? 8000), "0.0.0.0", () =>
    resolve(undefined),
  );
});

const models = createModels();
models.setProvider(openRouter());

const registry = createRegistry();
registry.install(
  defineExtension({
    name: "agent",
    sections: [
      section(
        "preamble",
        () =>
          [
            "You are a helpful assistant. Your conversation is durable: if this process restarts, continue the same work.",
            "Models are served through OpenRouter.",
            "Keep replies short unless the user asks for detail.",
          ].join("\n"),
        { tag: false },
      ),
    ],
  }),
);

const loaded = new Map();
async function load(file) {
  const path = join(extensionsDir, file);
  try {
    if (!existsSync(path)) {
      if (loaded.has(file)) registry.uninstall(loaded.get(file));
      loaded.delete(file);
      return;
    }
    const { default: extension } = await import(
      `${pathToFileURL(path)}?v=${Date.now()}`
    );
    registry.install(extension);
    loaded.set(file, extension);
  } catch (error) {
    console.error(`extensions/${file}:`, error);
  }
}
for (const file of await readdir(extensionsDir)) {
  if (file.endsWith(".ts")) await load(file);
}
const pending = new Map();
const extensionsWatch = watch(extensionsDir, (_, file) => {
  if (!file?.endsWith(".ts")) return;
  clearTimeout(pending.get(file));
  pending.set(
    file,
    setTimeout(() => load(file), 300),
  );
});
extensionsWatch.on("error", (error) =>
  console.error("extensions watch:", error),
);

const harness = await Harness.open(
  await openNodeSqliteStorage(join(dir, "data", "agent.sqlite")),
  {
    models,
    registry,
    env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? workspace }),
    onReport: (error) => console.error("pi-durable:", error),
  },
  context,
);
const root = await harness.root(context, { agent: { model, cwd: workspace } });
const view = await root.viewState(context);
const stored = view.value.docs["pi.agent"]?.model;
const current =
  stored && typeof stored === "object" && !Array.isArray(stored)
    ? stored
    : undefined;
if (
  current?.provider !== model.provider ||
  current?.modelId !== model.modelId
) {
  await root.configure({ model }, context);
}
harness.resume();
ready = true;
const address = server.address();
const port = address && typeof address === "object" ? address.port : address;
console.log(
  `pi-durable listening on ${port}, model ${model.provider}/${model.modelId}`,
);

const textOf = (content) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");

function summarize(value) {
  const items = [];
  const tools = new Map();
  const assistant = (message, live) => {
    for (const part of message.content ?? []) {
      if (part.type === "text" && part.text)
        items.push({ type: "assistant", text: part.text, live });
      if (part.type === "toolCall") {
        const tool = {
          type: "tool",
          name: part.name,
          args: part.arguments,
          status: "pending",
          output: "",
        };
        tools.set(part.id, tool);
        items.push(tool);
      }
    }
    if (message.stopReason === "error" && message.errorMessage) {
      items.push({
        type: "note",
        text: `Model error: ${message.errorMessage}`,
      });
    }
  };
  const resetAt = value.entries.findLastIndex(
    (entry) => entry.kind === "pi.reset",
  );
  const visible =
    resetAt < 0 ? value.entries : value.entries.slice(resetAt + 1);
  for (const entry of visible) {
    const message = entry.model?.[0];
    if (entry.kind === "chat.input")
      items.push({ type: "user", ...entry.data });
    else if (entry.kind === "pi.user")
      items.push({ type: "user", author: "", text: textOf(message?.content) });
    else if (entry.kind === "pi.assistant" && message)
      assistant(message, false);
    else if (entry.kind === "pi.tool-result" && message) {
      const tool = tools.get(message.toolCallId);
      if (tool)
        Object.assign(tool, {
          status: message.isError ? "error" : "done",
          output: textOf(message.content),
        });
    } else if (entry.kind === "pi.compaction")
      items.push({ type: "note", text: "Older messages were summarized." });
  }
  const live = value.docs["pi.live"] ?? {};
  if (live.generation?.message) assistant(live.generation.message, true);
  for (const running of live.tools ?? []) {
    const tool = tools.get(running.callId);
    if (tool && running.status !== "done")
      Object.assign(tool, {
        status: running.status,
        output: running.output ?? "",
      });
  }
  for (const tool of tools.values())
    tool.output = String(tool.output).slice(-4000);
  for (const queued of value.docs["pi.inbox"]?.items ?? []) {
    if (queued.entry?.kind === "chat.input")
      items.push({ type: "user", ...queued.entry.data, queued: true });
  }
  const agent = value.docs["pi.agent"]?.model;
  return {
    busy: live.run !== undefined,
    model: agent ? `${agent.provider}/${agent.modelId}` : "",
    items: items.slice(-300),
  };
}

const pages = new Set();
let latest = JSON.stringify(summarize(view.value));
let timer;
view.subscribe(() => {
  timer ??= setTimeout(() => {
    timer = undefined;
    const next = JSON.stringify(summarize(view.value));
    if (next === latest) return;
    latest = next;
    for (const page of pages) page.write(`data: ${latest}\n\n`);
  }, 100);
});
setInterval(() => {
  for (const page of pages) page.write(": ping\n\n");
}, 25_000).unref();

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function caller(req) {
  const email = req.headers["x-exedev-email"];
  if (typeof email === "string" && email) return email;
  const token = process.env.AGENT_TOKEN;
  const header = req.headers.authorization;
  if (token && header === `Bearer ${token}`) return "web";
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
    req.socket.remoteAddress ?? "",
  );
  return local && !req.headers["x-forwarded-for"] ? "local" : undefined;
}

async function handle(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    });
    return res.end();
  }
  const who = caller(req);
  if (!who) return send(res, 401, { error: "unauthorized" });
  if (!ready) return send(res, 503, { error: "starting" });
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/api/state")
    return send(res, 200, JSON.parse(latest));
  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    });
    res.write(`data: ${latest}\n\n`);
    pages.add(res);
    return req.on("close", () => pages.delete(res));
  }
  if (req.method === "POST" && url.pathname === "/api/stop") {
    await root.abort(context);
    return send(res, 200, { stopped: true });
  }
  if (req.method === "POST" && url.pathname === "/api/reset") {
    await root.abort(context);
    await root.reset(undefined, context);
    return send(res, 200, { reset: true });
  }
  if (req.method === "POST" && url.pathname === "/api/messages") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { text, requestId, wait } = JSON.parse(body || "{}");
    if (typeof text !== "string" || !text.trim())
      return send(res, 400, { error: "text is required" });
    const submission = await root.submit(
      {
        type: "input",
        content: text,
        requestId: typeof requestId === "string" ? requestId : undefined,
        whenBusy: "steer",
        entry: {
          kind: "chat.input",
          data: { author: who.split("@")[0], text },
        },
      },
      context,
    );
    if (!wait) return send(res, 202, { id: submission.id });
    const settled = await submission.wait(context);
    if (settled.status !== "done" || settled.type !== "input")
      return send(res, 200, { id: submission.id, ...settled });
    const answer = await root.commit(
      (tx) => tx.entry(AssistantEntry, settled.answer),
      context,
    );
    return send(res, 200, {
      id: submission.id,
      status: "done",
      answer: textOf(answer?.model?.[0]?.content),
    });
  }
  send(res, 404, { error: "not found" });
}

process.once("SIGTERM", async () => {
  for (const page of pages) page.end();
  server.close();
  await harness.close(context);
  process.exit(0);
});

function openRouter() {
  const base = openrouterProvider();
  const baseUrl = process.env.OPENROUTER_BASE_URL;
  if (!baseUrl) {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error(
        "Set OPENROUTER_API_KEY, or OPENROUTER_BASE_URL for an exe.dev LLM integration",
      );
    }
    return base;
  }
  return {
    ...base,
    baseUrl,
    auth: {
      apiKey: {
        name: "OpenRouter",
        resolve: async () => ({
          auth: {
            apiKey: process.env.OPENROUTER_API_KEY || "exe-llm-integration",
            baseUrl,
          },
        }),
      },
    },
  };
}

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq);
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
