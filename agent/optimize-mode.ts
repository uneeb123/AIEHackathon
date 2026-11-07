import { defineDoc } from "@earendil-works/pi-durable";
import type { JsonObject } from "@earendil-works/pi-durable";
import {
  FINANCIAL_DATASETS_PREFIX,
  financialDatasetsEndpoints,
} from "./financial-datasets-catalog.ts";

export const DECISION_MODEL = "typesafe/jev-1.14-20261014";

// Probe on 2026-11-07: clear yes sat at 0.82–0.98 and clear no at 0.01–0.05.
// A false allow spends tokens. A false block drops information the answer needed.
const NEEDS_INFORMATION = 0.5;
const ALREADY_RETRIEVED = 0.5;

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

export type RecordedCall = {
  name: string;
  returns: string;
  arguments: JsonObject;
};

export type OptimizeState = {
  enabled: boolean;
  question: string;
  calls: RecordedCall[];
};

export const OptimizeMode = defineDoc<OptimizeState>({
  kind: "aie.optimize",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ enabled: false, question: "", calls: [] }),
});

const returnsByName = new Map<string, string>([
  ["tool_search", "Search deferred tools and load the ones that match a query."],
  ...financialDatasetsEndpoints.map(
    (endpoint) =>
      [`${FINANCIAL_DATASETS_PREFIX}${endpoint.name}`, endpoint.description] as const,
  ),
]);

export function recordedCall(name: string, args: JsonObject): RecordedCall {
  return {
    name,
    returns: returnsByName.get(name) ?? name,
    arguments: slimArguments(args),
  };
}

export function sameCall(left: RecordedCall, right: RecordedCall) {
  return left.name === right.name && stable(left.arguments) === stable(right.arguments);
}

export async function judgeCall(input: {
  question: string;
  call: RecordedCall;
  earlier_calls: readonly RecordedCall[];
}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key === "exe-llm-integration") {
    throw new Error("OPENROUTER_API_KEY is not available for decisions");
  }
  const response = await fetch(DECISIONS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: DECISION_MODEL,
      state: {
        question: input.question.slice(0, 2000),
        call: input.call,
        earlier_calls: input.earlier_calls.slice(-8),
      },
      questions: {
        needs_information: {
          type: "noul",
          instructions: "Does answering `question` require the information `call` retrieves?",
          criteria: {
            true: "The question asks for something this call returns.",
            false: "The question can be answered without what this call returns.",
          },
        },
        already_retrieved: {
          type: "noul",
          instructions: "Does an earlier call already retrieve the same information `call` would?",
          criteria: {
            true: "An entry in `earlier_calls` asks for the same information as `call`.",
            false: "`earlier_calls` is empty, or none of them ask for the same information.",
          },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Decisions API ${response.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as {
    model?: string;
    answers?: Record<string, { type?: string; noul?: number }>;
  };
  const needs = body.answers?.needs_information;
  const already = body.answers?.already_retrieved;
  if (needs?.type !== "noul" || typeof needs.noul !== "number") {
    throw new Error("needs_information was not a noul");
  }
  if (already?.type !== "noul" || typeof already.noul !== "number") {
    throw new Error("already_retrieved was not a noul");
  }
  const allow = needs.noul >= NEEDS_INFORMATION && already.noul < ALREADY_RETRIEVED;
  console.log(
    `optimize ${body.model ?? DECISION_MODEL} ${input.call.name} needs=${needs.noul.toFixed(2)} already=${already.noul.toFixed(2)} ${allow ? "allow" : "block"}`,
  );
  return allow;
}

function slimArguments(value: JsonObject): JsonObject {
  const text = JSON.stringify(value);
  if (text.length <= 600) return value;
  return { truncated: text.slice(0, 600) };
}

function stable(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}
