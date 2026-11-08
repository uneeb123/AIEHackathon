import { defineExtension, defineTool, hook, GenerationTask, ToolTask } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { judgeRelevance, OPTIMIZE_NOTE, rankFinancials } from "../optimize-mode.ts";
import { readOptimize } from "../optimize-bridge.ts";

const FILING_TOOLS = new Set([
  "financial_datasets__get_filing_items",
  "financial_datasets__search_documents",
  "financial_datasets__list_filing_item_types",
]);

const company = Type.Object({
  ticker: Type.String({ description: "US ticker, such as NVDA.", minLength: 1, maxLength: 10 }),
  business: Type.String({
    description: "One line from company facts: what the company sells. Not a filing excerpt.",
    minLength: 1,
    maxLength: 400,
  }),
});

const judgeRelevanceTool = defineTool({
  name: "judge_relevance",
  description:
    "Decide which companies fit a business criterion. Uses Jev, one yes-or-no per company. Returns the matches and the tickers that were dropped. Does not retrieve financials.",
  parameters: Type.Object({
    criterion: Type.String({
      description: "What the company must sell. For example, products or services used to build or operate AI data centers.",
      minLength: 1,
      maxLength: 500,
    }),
    companies: Type.Array(company, {
      minItems: 1,
      maxItems: 12,
      description: "Companies to judge. At most 12.",
    }),
  }),
  execute: async (args) => {
    const result = await judgeRelevance(args.criterion, args.companies);
    return { output: [{ type: "text", text: JSON.stringify(result) }] };
  },
});

const rankFinancialsTool = defineTool({
  name: "rank_financials",
  description:
    "Keep companies with revenue growth above a cutoff and positive free cash flow, then rank them by revenue growth. This is arithmetic. It does not call a model.",
  parameters: Type.Object({
    min_growth_percent: Type.Optional(
      Type.Number({ description: "Keep growth strictly above this percent. Defaults to 15." }),
    ),
    require_positive_free_cash_flow: Type.Optional(
      Type.Boolean({ description: "Drop non-positive free cash flow. Defaults to true." }),
    ),
    limit: Type.Optional(Type.Integer({ description: "Maximum rows to return, from 1 to 5. Defaults to 5.", minimum: 1, maximum: 5 })),
    rows: Type.Array(
      Type.Object({
        ticker: Type.String({ minLength: 1, maxLength: 10 }),
        revenue_growth: Type.Union([Type.Number(), Type.String()], {
          description: "Annual revenue growth as a percent. 18.4 means 18.4%.",
        }),
        free_cash_flow: Type.Union([Type.Number(), Type.String()], {
          description: "Latest reported annual free cash flow.",
        }),
        source: Type.Optional(Type.String({ description: "Where the figures came from.", maxLength: 300 })),
        relevance: Type.Optional(Type.String({ description: "Why the company fits the criterion.", maxLength: 300 })),
      }),
      { minItems: 1, maxItems: 12 },
    ),
  }),
  execute: async (args) => ({
    output: [
      {
        type: "text",
        text: JSON.stringify(
          rankFinancials(args.rows, {
            minGrowthPercent: args.min_growth_percent,
            requirePositiveFreeCashFlow: args.require_positive_free_cash_flow,
            limit: args.limit,
          }),
        ),
      },
    ],
  }),
});

export default defineExtension({
  name: "optimize",
  tools: [judgeRelevanceTool, rankFinancialsTool],
  hooks: [
    hook(GenerationTask, {
      beforeRequest: async (request) => {
        const mode = await readOptimize();
        if (!mode.enabled) return undefined;
        const messages = [...request.messages];
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index];
          if (message.role !== "user" || typeof message.content !== "string") continue;
          if (message.content.includes(OPTIMIZE_NOTE)) return undefined;
          messages[index] = { ...message, content: `${message.content}\n\n${OPTIMIZE_NOTE}` };
          return { messages };
        }
        return undefined;
      },
    }),
    hook(ToolTask, {
      beforeTool: async (call) => {
        const mode = await readOptimize();
        if (call.name === "judge_relevance" && !mode.enabled) {
          return { block: "judge_relevance runs only in Optimize mode." };
        }
        if (!mode.enabled) return undefined;
        if (FILING_TOOLS.has(call.name)) {
          return {
            block: "Optimize mode uses company facts, line items, and rank_financials. Do not pull filing text.",
          };
        }
        return undefined;
      },
    }),
  ],
});
