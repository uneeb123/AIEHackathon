import { defineDoc } from "@earendil-works/pi-durable";
import type { JsonObject } from "@earendil-works/pi-durable";

export const DECISION_MODEL = "typesafe/jev-1.14-20261014";

// Probe on 2026-11-07 against the AI data-center criterion, one noul per company.
// Suppliers landed at 0.95–0.99. Unrelated, negated, and adversarial companies landed at 0.02–0.20.
// A false keep spends one line-item call. A false drop leaves a supplier out of the table.
const RELEVANT = 0.5;

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

export type OptimizeState = {
  enabled: boolean;
  question: string;
  calls: JsonObject[];
};

export const OptimizeMode = defineDoc<OptimizeState>({
  kind: "aie.optimize",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ enabled: false, question: "", calls: [] }),
});

export const OPTIMIZE_NOTE =
  "Optimize mode is on. Use judge_relevance to decide which companies fit, passing a one-line business description from company facts. Then retrieve annual revenue and free cash flow with get_line_items for the matches only. Pass those figures to rank_financials as percents. Cite the line-item source. Do not call get_filing_items or search_documents.";

type Company = { ticker: string; business: string };

export async function judgeRelevance(criterion: string, companies: readonly Company[]) {
  const skipped: { ticker: string; reason: string }[] = [];
  const pending = new Map<string, Company>();
  for (const company of companies) {
    const ticker = company.ticker.trim().toUpperCase();
    const business = company.business.trim();
    if (!TICKER.test(ticker)) {
      skipped.push({ ticker: company.ticker, reason: "invalid ticker" });
      continue;
    }
    if (!business) {
      skipped.push({ ticker, reason: "no business description" });
      continue;
    }
    if (pending.has(ticker)) continue;
    pending.set(ticker, { ticker, business: business.slice(0, 400) });
  }
  const selected = [...pending.values()].slice(0, 12);
  for (const company of [...pending.values()].slice(12)) {
    skipped.push({ ticker: company.ticker, reason: "limit is 12 companies per check" });
  }
  if (selected.length === 0) return { model: DECISION_MODEL, matches: [], skipped };

  const state = {
    criterion: criterion.trim().slice(0, 500),
    companies: Object.fromEntries(
      selected.map((company) => [company.ticker, { ticker: company.ticker, business: company.business }]),
    ),
  };
  const questions = Object.fromEntries(selected.map((company) => [company.ticker, relevanceQuestion(company.ticker)]));
  const body = await decide(state, questions);
  const matches = [];
  for (const company of selected) {
    const answer = body.answers[company.ticker];
    if (answer?.type !== "noul" || typeof answer.noul !== "number") {
      throw new Error(`relevance answer for ${company.ticker} was not a noul`);
    }
    console.log(
      `optimize ${body.model} ${company.ticker} relevant=${answer.noul.toFixed(2)} ${answer.noul >= RELEVANT ? "keep" : "drop"}`,
    );
    if (answer.noul >= RELEVANT) matches.push({ ticker: company.ticker, relevance: answer.noul });
    else skipped.push({ ticker: company.ticker, reason: "not relevant" });
  }
  return { model: body.model, matches, skipped };
}

export type FinancialRow = {
  ticker: string;
  revenue_growth: number;
  free_cash_flow: number;
  source?: string;
  relevance?: string;
};

export function rankFinancials(
  rows: readonly {
    ticker: string;
    revenue_growth: unknown;
    free_cash_flow: unknown;
    source?: string;
    relevance?: string;
  }[],
  options: { minGrowthPercent?: number; requirePositiveFreeCashFlow?: boolean; limit?: number },
) {
  const minimum = options.minGrowthPercent ?? 15;
  const requireCash = options.requirePositiveFreeCashFlow !== false;
  const limit = Math.min(5, Math.max(1, options.limit ?? 5));
  const kept: FinancialRow[] = [];
  const dropped: { ticker: string; reason: string }[] = [];
  for (const row of rows) {
    const growth = percent(row.revenue_growth);
    const cash = money(row.free_cash_flow);
    if (growth === undefined) {
      dropped.push({ ticker: row.ticker, reason: "revenue growth missing" });
      continue;
    }
    if (growth <= minimum) {
      dropped.push({ ticker: row.ticker, reason: "revenue growth is not above the cutoff" });
      continue;
    }
    if (requireCash && (cash === undefined || cash <= 0)) {
      dropped.push({ ticker: row.ticker, reason: "free cash flow is not positive" });
      continue;
    }
    kept.push({
      ticker: row.ticker.trim().toUpperCase(),
      revenue_growth: growth,
      free_cash_flow: cash ?? 0,
      ...(row.source ? { source: row.source } : {}),
      ...(row.relevance ? { relevance: row.relevance } : {}),
    });
  }
  kept.sort((left, right) => right.revenue_growth - left.revenue_growth);
  return { rows: kept.slice(0, limit), dropped };
}

function relevanceQuestion(ticker: string) {
  return {
    type: "noul",
    instructions: `Does the company in \`companies.${ticker}\` sell a product or service that \`criterion\` is asking for?`,
    criteria: {
      true: "That company sells a product or service the criterion describes.",
      false:
        "That company is outside the criterion. A company that only buys or uses the product, or only mentions it, does not count.",
    },
  };
}

async function decide(state: unknown, questions: Record<string, unknown>) {
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
    body: JSON.stringify({ model: DECISION_MODEL, state, questions }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Decisions API ${response.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as {
    model?: string;
    answers?: Record<string, { type?: string; noul?: number }>;
  };
  if (!body.answers || typeof body.model !== "string") throw new Error("Decisions response was incomplete");
  return { model: body.model, answers: body.answers };
}

function percent(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.trim().replace(/[%$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function money(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const negative = value.includes("(") && value.includes(")");
  const parsed = Number(value.replace(/[$,()\s]/g, ""));
  if (!Number.isFinite(parsed)) return undefined;
  return negative ? -Math.abs(parsed) : parsed;
}
