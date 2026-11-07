export const FINANCIAL_DATASETS_PREFIX = "financial_datasets__";

export type FinancialDatasetsField = {
  name: string;
  description: string;
  required?: boolean;
  kind: "string" | "integer" | "boolean" | "string[]";
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
};

export type FinancialDatasetsEndpoint = {
  name: string;
  description: string;
  method: "GET" | "POST";
  path: string;
  query?: readonly FinancialDatasetsField[];
  body?: "screener" | "line-items" | "search";
};

const ticker = (required = false): FinancialDatasetsField => ({
  name: "ticker",
  description: "Ticker symbol, for example AAPL.",
  required,
  kind: "string",
});

const cik = (): FinancialDatasetsField => ({
  name: "cik",
  description: "SEC Central Index Key. Leading zeros are optional.",
  kind: "string",
});

const limit = (maximum = 20): FinancialDatasetsField => ({
  name: "limit",
  description: `Maximum number of rows to return, from 1 to ${maximum}.`,
  kind: "integer",
  minimum: 1,
  maximum,
});

const cursor = (): FinancialDatasetsField => ({
  name: "cursor",
  description: "Cursor from a previous page. Omit it for the first page.",
  kind: "string",
});

const market = (): FinancialDatasetsField => ({
  name: "market",
  description: "Listing market. Defaults to US.",
  kind: "string",
  enum: ["US", "UK", "FR"],
});

const period = (ttm: boolean): FinancialDatasetsField => ({
  name: "period",
  description: ttm
    ? "Statement period: annual, quarterly, or ttm."
    : "Statement period: annual or quarterly.",
  required: true,
  kind: "string",
  enum: ttm ? ["annual", "quarterly", "ttm"] : ["annual", "quarterly"],
});

const dates = (): FinancialDatasetsField[] => [
  {
    name: "start_date",
    description: "First day to include, YYYY-MM-DD. Omit for the latest values.",
    kind: "string",
  },
  {
    name: "end_date",
    description: "Last day to include, YYYY-MM-DD.",
    kind: "string",
  },
];

const statements = (
  name: string,
  description: string,
  path: string,
  ttm: boolean,
): FinancialDatasetsEndpoint => ({
  name,
  description,
  method: "GET",
  path,
  query: [ticker(), cik(), market(), period(ttm), limit(12), cursor()],
});

const kpi = (
  name: string,
  description: string,
  path: string,
): FinancialDatasetsEndpoint => ({
  name,
  description,
  method: "GET",
  path,
  query: [
    ticker(true),
    {
      name: "metric_name",
      description: "Metric name to filter on, such as subscribers or adjusted_ebitda.",
      kind: "string",
    },
    {
      name: "period",
      description: "quarterly or annual.",
      kind: "string",
      enum: ["quarterly", "annual"],
    },
    {
      name: "report_period_gte",
      description: "Earliest report period, YYYY-MM-DD.",
      kind: "string",
    },
    {
      name: "report_period_lte",
      description: "Latest report period, YYYY-MM-DD.",
      kind: "string",
    },
    limit(12),
    cursor(),
  ],
});

export const financialDatasetsEndpoints: readonly FinancialDatasetsEndpoint[] = [
  {
    name: "get_stock_price",
    description:
      "Latest price snapshot for one US stock: current price, open, high, low, close, volume, and the day's change.",
    method: "GET",
    path: "/prices/snapshot",
    query: [ticker(true)],
  },
  {
    name: "get_stock_prices",
    description:
      "Historical open, high, low, close, and volume for one US stock by day, week, month, or year.",
    method: "GET",
    path: "/prices",
    query: [
      ticker(true),
      {
        name: "interval",
        description: "Bar size: day, week, month, or year.",
        required: true,
        kind: "string",
        enum: ["day", "week", "month", "year"],
      },
      {
        name: "start_date",
        description: "Range start, YYYY-MM-DD.",
        required: true,
        kind: "string",
      },
      {
        name: "end_date",
        description: "Range end, YYYY-MM-DD.",
        required: true,
        kind: "string",
      },
      cursor(),
    ],
  },
  {
    name: "get_market_snapshot",
    description:
      "Latest price and day change for every actively traded US stock in one response.",
    method: "GET",
    path: "/prices/snapshot/market",
  },
  {
    name: "get_company_facts",
    description:
      "Company profile: name, CIK, sector, industry, exchange, location, employees, and SIC code.",
    method: "GET",
    path: "/company/facts",
    query: [ticker(), cik()],
  },
  statements(
    "get_income_statement",
    "Income statement: revenue, expenses, and net income. Annual, quarterly, or trailing twelve months.",
    "/financials/income-statements",
    true,
  ),
  statements(
    "get_balance_sheet",
    "Balance sheet: assets, liabilities, and shareholders' equity. Annual, quarterly, or trailing twelve months.",
    "/financials/balance-sheets",
    true,
  ),
  statements(
    "get_cash_flow_statement",
    "Cash flow statement: operating, investing, and financing cash flow. Annual, quarterly, or trailing twelve months.",
    "/financials/cash-flow-statements",
    true,
  ),
  statements(
    "get_financial_statements",
    "Income statement, balance sheet, and cash flow statement in one call.",
    "/financials",
    true,
  ),
  statements(
    "get_financial_metrics",
    "Historical ratios such as P/E, EV/EBITDA, margins, ROE, and growth. Annual, quarterly, or trailing twelve months.",
    "/financial-metrics",
    true,
  ),
  {
    name: "get_financial_metrics_snapshot",
    description:
      "Latest market cap, P/E, EV/EBITDA, dividend yield, margins, and other current ratios for one company.",
    method: "GET",
    path: "/financial-metrics/snapshot",
    query: [ticker(), cik(), market()],
  },
  statements(
    "get_as_reported_financials",
    "Income statement, balance sheet, and cash flow as the company filed them, with original line labels.",
    "/financials/as-reported",
    false,
  ),
  statements(
    "get_segmented_financials",
    "Revenue, operating income, assets, and capital expenditure by business segment.",
    "/financials/segments",
    false,
  ),
  {
    name: "get_filings",
    description:
      "List SEC filings for a company, including 10-K, 10-Q, 8-K, 20-F, and 6-K, newest first.",
    method: "GET",
    path: "/filings",
    query: [
      ticker(),
      cik(),
      {
        name: "filing_type",
        description: "Filing types to keep. Repeat to pass more than one.",
        kind: "string[]",
        enum: ["10-K", "10-Q", "8-K", "20-F", "6-K"],
      },
      limit(),
      cursor(),
    ],
  },
  {
    name: "get_filing_items",
    description:
      "Text of one section of a 10-K, 10-Q, or 8-K, such as Item 1A Risk Factors or Item 7 MD&A.",
    method: "GET",
    path: "/filings/items",
    query: [
      ticker(true),
      {
        name: "filing_type",
        description: "10-K, 10-Q, or 8-K.",
        required: true,
        kind: "string",
        enum: ["10-K", "10-Q", "8-K"],
      },
      {
        name: "year",
        description: "Filing year, for example 2024.",
        required: true,
        kind: "integer",
        minimum: 1994,
        maximum: 2100,
      },
      {
        name: "quarter",
        description: "Fiscal quarter, 1 through 4. Required for a 10-Q.",
        kind: "integer",
        minimum: 1,
        maximum: 4,
      },
      {
        name: "item",
        description:
          "Section identifier, such as Item-1A or Item-7. Call list_filing_item_types for the choices.",
        kind: "string",
      },
      {
        name: "accession_number",
        description: "SEC accession number, when a specific filing is required.",
        kind: "string",
      },
    ],
  },
  {
    name: "list_filing_item_types",
    description: "Section identifiers that get_filing_items can extract for 10-K, 10-Q, and 8-K filings.",
    method: "GET",
    path: "/filings/items/types",
    query: [
      {
        name: "filing_type",
        description: "Optional filing type to filter the section list.",
        kind: "string",
      },
    ],
  },
  {
    name: "get_insider_trades",
    description:
      "SEC Form 4 and Form 5 insider buys and sells by officers, directors, and major shareholders.",
    method: "GET",
    path: "/insider-trades",
    query: [
      ticker(true),
      {
        name: "name",
        description: "Filter by the insider's name.",
        kind: "string",
      },
      {
        name: "transaction_type",
        description: "Transaction code or label to filter on.",
        kind: "string",
      },
      limit(),
      cursor(),
    ],
  },
  {
    name: "get_insider_ownership",
    description:
      "What officers, directors, and 10% owners hold, from SEC Forms 3 and 5. Shares, options, and RSUs.",
    method: "GET",
    path: "/insider-ownership",
    query: [
      ticker(true),
      { name: "name", description: "Filter by the insider's name.", kind: "string" },
      {
        name: "form_type",
        description: "3 or 3/A for an initial statement, 5 or 5/A for an annual statement.",
        kind: "string",
        enum: ["3", "3/A", "5", "5/A"],
      },
      limit(),
      cursor(),
    ],
  },
  {
    name: "get_beneficial_ownership",
    description:
      "Holders of more than 5% of a company from SEC Schedules 13D and 13G. Query by ticker or by filer CIK.",
    method: "GET",
    path: "/beneficial-ownership",
    query: [
      ticker(),
      {
        name: "filer_cik",
        description: "CIK of the owner. Use get_institutional_investors only for 13F filers.",
        kind: "string",
      },
      {
        name: "type",
        description: "activist for Schedule 13D, passive for Schedule 13G.",
        kind: "string",
        enum: ["activist", "passive"],
      },
      {
        name: "history",
        description: "When true, return each stake's amendment chain instead of its current state.",
        kind: "boolean",
      },
      limit(),
      cursor(),
    ],
  },
  {
    name: "get_activist_ownership",
    description: "Schedule 13D activist stakes. Query by the company ticker or the activist's filer CIK.",
    method: "GET",
    path: "/activist-ownership",
    query: [
      ticker(),
      { name: "filer_cik", description: "CIK of the activist filer.", kind: "string" },
      {
        name: "history",
        description: "When true, return the amendment chain.",
        kind: "boolean",
      },
      limit(),
      cursor(),
    ],
  },
  {
    name: "get_institutional_holdings",
    description:
      "SEC Form 13F holdings. Pass filer_cik for one investor's portfolio, or ticker for who holds that stock.",
    method: "GET",
    path: "/institutional-holdings",
    query: [
      {
        name: "filer_cik",
        description: "CIK of the 13F filer. Find it with get_institutional_investors.",
        kind: "string",
      },
      ticker(),
      limit(25),
      cursor(),
    ],
  },
  {
    name: "get_institutional_investors",
    description: "Find a 13F filer's CIK and latest reported name. Filter with a name prefix.",
    method: "GET",
    path: "/institutional-holdings/investors",
    query: [
      {
        name: "name",
        description: "Case-insensitive name prefix, for example Berkshire.",
        kind: "string",
      },
    ],
  },
  {
    name: "get_index_fund",
    description:
      "ETF or index-fund holdings and weights. Pass ticker for one fund, or holding for funds that hold a stock.",
    method: "GET",
    path: "/index-funds",
    query: [
      {
        name: "ticker",
        description: "Fund ticker, for example SPY.",
        kind: "string",
      },
      {
        name: "holding",
        description: "Stock ticker, to list funds whose latest filing holds it.",
        kind: "string",
      },
      {
        name: "as_of",
        description: "Composition as of this date, YYYY-MM-DD. Omit for the latest filing.",
        kind: "string",
      },
      {
        name: "asset_class",
        description: "equity or bond.",
        kind: "string",
        enum: ["equity", "bond"],
      },
      limit(25),
      cursor(),
    ],
  },
  {
    name: "get_earnings",
    description:
      "Structured earnings from 8-K, 10-Q, and 10-K filings: revenue, EPS, margins, and the reported period.",
    method: "GET",
    path: "/earnings",
    query: [ticker(true), limit(8), cursor()],
  },
  {
    name: "get_news",
    description:
      "Recent news. Pass a ticker for one company, or omit it for market news.",
    method: "GET",
    path: "/news",
    query: [ticker(), limit(15), cursor()],
  },
  {
    name: "get_interest_rates",
    description:
      "Latest policy rate for major central banks. Pass bank, for example FED, ECB, BOE, or BOJ, or omit it for all of them.",
    method: "GET",
    path: "/macro/interest-rates/snapshot",
    query: [
      {
        name: "bank",
        description: "Central bank code, for example FED. Omit for the full snapshot.",
        kind: "string",
      },
    ],
  },
  {
    name: "get_interest_rate_history",
    description: "Historical policy rate for one central bank.",
    method: "GET",
    path: "/macro/interest-rates",
    query: [
      {
        name: "bank",
        description: "Central bank code, for example FED.",
        required: true,
        kind: "string",
      },
      ...dates(),
      cursor(),
    ],
  },
  {
    name: "get_yield_curve",
    description: "Latest US Treasury par yield curve, from 1 month to 30 years.",
    method: "GET",
    path: "/macro/yield-curve/snapshot",
  },
  {
    name: "get_yield_curve_history",
    description: "Daily US Treasury par yield curve.",
    method: "GET",
    path: "/macro/yield-curve",
    query: [...dates(), cursor()],
  },
  {
    name: "get_inflation",
    description: "Latest US CPI and PCE inflation series, with month-over-month and year-over-year changes.",
    method: "GET",
    path: "/macro/inflation/snapshot",
    query: [
      {
        name: "series",
        description: "One series id from list_inflation_series. Omit for every series.",
        kind: "string",
      },
    ],
  },
  {
    name: "get_inflation_history",
    description: "Historical US CPI or PCE for one series.",
    method: "GET",
    path: "/macro/inflation",
    query: [
      {
        name: "series",
        description: "Series id from list_inflation_series.",
        required: true,
        kind: "string",
      },
      ...dates(),
      cursor(),
    ],
  },
  {
    name: "list_inflation_series",
    description: "Ids and names of the CPI and PCE series get_inflation can return.",
    method: "GET",
    path: "/macro/inflation/series",
  },
  {
    name: "get_labor",
    description:
      "Latest US labor-market print: payrolls, unemployment, earnings, JOLTS, and jobless claims.",
    method: "GET",
    path: "/macro/labor/snapshot",
    query: [
      {
        name: "series",
        description: "One labor series id. Omit for every series.",
        kind: "string",
      },
    ],
  },
  {
    name: "get_labor_history",
    description: "Historical US labor-market series, such as payrolls or the unemployment rate.",
    method: "GET",
    path: "/macro/labor",
    query: [
      {
        name: "series",
        description: "Labor series id.",
        required: true,
        kind: "string",
      },
      ...dates(),
      cursor(),
    ],
  },
  kpi(
    "get_kpi_metrics",
    "Operating KPIs from filings and earnings releases, such as subscribers, ARPU, or units sold.",
    "/kpi/metrics",
  ),
  kpi(
    "get_kpi_guidance",
    "Forward guidance from earnings releases: ranges, point estimates, and directional outlooks.",
    "/kpi/guidance",
  ),
  kpi(
    "get_kpi_non_gaap",
    "Non-GAAP metrics such as adjusted EPS, adjusted EBITDA, and the company's free cash flow.",
    "/kpi/non-gaap",
  ),
  {
    name: "get_ipos",
    description:
      "Recent S-1, F-1, and 424B IPO filings, with the proposed ticker, exchange, and price when filed.",
    method: "GET",
    path: "/ipos",
    query: [
      ticker(),
      cik(),
      {
        name: "classification",
        description: "ipo, shell_company, spac, resale, or other.",
        kind: "string",
        enum: ["ipo", "shell_company", "spac", "resale", "other"],
      },
      limit(),
      cursor(),
    ],
  },
  {
    name: "get_gpu_prices",
    description:
      "Latest rental price in dollars per GPU hour for H100, H200, B200, and B300.",
    method: "GET",
    path: "/macro/gpu-prices/snapshot",
    query: [
      {
        name: "series",
        description: "GPU series, for example H100. Omit for every series.",
        kind: "string",
      },
    ],
  },
  {
    name: "list_screener_filters",
    description:
      "Fields and operators screen_stocks accepts, grouped by category. Call this before inventing a filter field.",
    method: "GET",
    path: "/financials/search/screener/filters",
  },
  {
    name: "screen_stocks",
    description:
      "Screen US stocks by statement and ratio filters, such as revenue, P/E, margins, sector, and industry.",
    method: "POST",
    path: "/financials/search/screener",
    body: "screener",
  },
  {
    name: "get_line_items",
    description:
      "Pull chosen statement lines, such as revenue or free cash flow, for several tickers in one call.",
    method: "POST",
    path: "/financials/search/line-items",
    body: "line-items",
  },
  {
    name: "search_documents",
    description:
      "Search filing and earnings-document text. Pass a question and, when useful, ticker or date filters.",
    method: "POST",
    path: "/search",
    body: "search",
  },
];

export const financialDatasetsToolNames = financialDatasetsEndpoints.map(
  (endpoint) => `${FINANCIAL_DATASETS_PREFIX}${endpoint.name}`,
);
