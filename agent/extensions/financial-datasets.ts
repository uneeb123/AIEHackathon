import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import {
  FINANCIAL_DATASETS_PREFIX,
  financialDatasetsEndpoints,
  type FinancialDatasetsEndpoint,
  type FinancialDatasetsField,
} from "../financial-datasets-catalog.ts";

const API = "https://api.financialdatasets.ai";

const text = (description: string, extra?: { minLength?: number; maxLength?: number }) =>
  Type.String({ description, ...extra });

const literals = (values: readonly string[], description: string) => {
  const options = values.map((value) => Type.Literal(value));
  return options.length === 1
    ? Type.Literal(values[0], { description })
    : Type.Union(options, { description });
};

function fieldSchema(field: FinancialDatasetsField) {
  const description = field.description;
  let schema;
  if (field.kind === "boolean") schema = Type.Boolean({ description });
  else if (field.kind === "integer") {
    schema = Type.Integer({
      description,
      ...(field.minimum !== undefined ? { minimum: field.minimum } : {}),
      ...(field.maximum !== undefined ? { maximum: field.maximum } : {}),
    });
  } else if (field.enum) {
    const enumerated = literals(field.enum, description);
    schema = field.kind === "string[]" ? Type.Array(enumerated, { description }) : enumerated;
  } else if (field.kind === "string[]") schema = Type.Array(Type.String(), { description });
  else schema = text(description);
  return field.required ? schema : Type.Optional(schema);
}

function querySchema(fields: readonly FinancialDatasetsField[] | undefined) {
  const properties: Record<string, ReturnType<typeof fieldSchema>> = {};
  for (const field of fields ?? []) properties[field.name] = fieldSchema(field);
  return Type.Object(properties);
}

const screenerBody = Type.Object({
  filters: Type.Array(
    Type.Object({
      field: text("Filter field. Call financial_datasets__list_screener_filters for the names."),
      operator: literals(["gt", "lt", "gte", "lte", "eq", "in"], "Comparison operator."),
      value: Type.Union([Type.Number(), Type.String(), Type.Array(Type.String())], {
        description: "Number or string for eq and comparisons. A list of strings for in.",
      }),
    }),
    { minItems: 1, description: "At least one filter." },
  ),
  limit: Type.Optional(Type.Integer({ description: "Rows to return, from 1 to 25.", minimum: 1, maximum: 25 })),
  currency: Type.Optional(text("Currency code. Defaults to USD.")),
  order_by: Type.Optional(
    Type.Object({
      field: text("Field to sort by."),
      direction: Type.Optional(literals(["asc", "desc"], "Sort direction. Defaults to desc.")),
    }),
  ),
  as_of: Type.Optional(text("Screen as of this date, YYYY-MM-DD. Omit for the latest data.")),
});

const lineItemsBody = Type.Object({
  tickers: Type.Array(Type.String(), {
    minItems: 1,
    description: "Tickers to compare, for example AAPL and MSFT.",
  }),
  line_items: Type.Array(Type.String(), {
    minItems: 1,
    description: "Statement lines, such as revenue, net_income, or free_cash_flow.",
  }),
  period: Type.Optional(literals(["annual", "quarterly", "ttm"], "Defaults to ttm.")),
  limit: Type.Optional(
    Type.Integer({ description: "Periods per ticker, from 1 to 12.", minimum: 1, maximum: 12 }),
  ),
});

const searchBody = Type.Object({
  query: text("Question or keywords to search in filings and earnings documents.", {
    minLength: 1,
    maxLength: 300,
  }),
  limit: Type.Optional(Type.Integer({ description: "Hits to return, from 1 to 20.", minimum: 1, maximum: 20 })),
  filters: Type.Optional(
    Type.Object({
      identifiers: Type.Optional(
        Type.Object({
          ticker: Type.Optional(Type.Array(Type.String(), { description: "Limit the search to these tickers." })),
          cik: Type.Optional(Type.Array(Type.String(), { description: "Limit the search to these CIKs." })),
        }),
      ),
      date: Type.Optional(
        Type.Object({
          after: Type.Optional(text("Only documents public on or after this day, YYYY-MM-DD.")),
          before: Type.Optional(text("Only documents public on or before this day, YYYY-MM-DD.")),
        }),
      ),
      document_type: Type.Optional(
        Type.Array(literals(["DEF 14A", "8-K"], "Document type."), {
          description: "Restrict the search to these document types.",
        }),
      ),
    }),
  ),
});

const bodies = {
  screener: screenerBody,
  "line-items": lineItemsBody,
  search: searchBody,
};

function parametersOf(endpoint: FinancialDatasetsEndpoint) {
  return endpoint.body ? bodies[endpoint.body] : querySchema(endpoint.query);
}

function queryString(fields: readonly FinancialDatasetsField[] | undefined, args: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const field of fields ?? []) {
    const value = args[field.name];
    if (value === undefined || value === null || value === "") continue;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      params.append(field.name, typeof item === "boolean" ? String(item) : String(item));
    }
  }
  return params;
}

async function callApi(endpoint: FinancialDatasetsEndpoint, args: Record<string, unknown>) {
  const key = process.env.FINANCIAL_DATASETS_API_KEY;
  if (!key) throw new Error("FINANCIAL_DATASETS_API_KEY is not set on the agent.");
  if (!endpoint.path.startsWith("/")) throw new Error("Invalid Financial Datasets path.");
  const url = new URL(endpoint.path, API);
  if (endpoint.method === "GET") {
    const params = queryString(endpoint.query, args);
    const query = params.toString();
    if (query) url.search = query;
  }
  const response = await fetch(url, {
    method: endpoint.method,
    headers: {
      accept: "application/json",
      "X-API-KEY": key,
      ...(endpoint.method === "POST" ? { "content-type": "application/json" } : {}),
    },
    body: endpoint.method === "POST" ? JSON.stringify(args) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Financial Datasets ${response.status} ${endpoint.path}: ${body.slice(0, 1500)}`);
  }
  return body;
}

const tools = financialDatasetsEndpoints.map((endpoint) =>
  defineTool({
    name: `${FINANCIAL_DATASETS_PREFIX}${endpoint.name}`,
    description: endpoint.description,
    parameters: parametersOf(endpoint),
    deferred: true,
    replay: "safe",
    outputLimits: { maxBytes: 48_000, retain: "head" },
    execute: async (args) => ({
      output: [{ type: "text", text: await callApi(endpoint, args) }],
    }),
  }),
);

export default defineExtension({
  name: "financial-datasets",
  sections: [
    section("financial-datasets", () =>
      [
        "Market, filing, and company figures come from Financial Datasets. The API key is already configured on this process. Never print it, and do not sign up for another key.",
        "Tools are deferred and named financial_datasets__*. Use tool_search to load the ones a question needs, then call them. Search for the tool name, such as get_line_items or screen_stocks.",
        "Discover companies with screen_stocks. Read identity with get_company_facts. Read annual revenue, free cash flow, and growth with get_line_items or get_financial_metrics. Use get_income_statement for the statement itself. Use get_stock_price for a latest price.",
        "Use get_filings and get_filing_items when the answer needs filing text or a citation that is not already on the statement row. Ask for one section, not a whole filing.",
        "Do not invent prices, filings, or statement figures. Cite the tool row you used, including the ticker, period, and accession number when it is present.",
        "A 401 means the key was rejected. Say so. A 402 means the account is not funded. Say so, and do not guess the number. A 403 that says historical data is limited means this plan only includes recent periods. Use the latest annual period inside that window. Do not treat the missing years as zero.",
      ].join("\n"),
    ),
  ],
  tools,
});
