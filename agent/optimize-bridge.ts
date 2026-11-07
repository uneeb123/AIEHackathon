import type { OptimizeState } from "./optimize-mode.ts";

type Bridge = {
  read(): Promise<OptimizeState>;
  remember(call: OptimizeState["calls"][number]): Promise<void>;
};

let bridge: Bridge | undefined;

export function bindOptimize(next: Bridge) {
  bridge = next;
}

export function readOptimize() {
  return bridge?.read() ?? Promise.resolve({ enabled: false, question: "", calls: [] });
}

export function rememberCall(call: OptimizeState["calls"][number]) {
  return bridge?.remember(call) ?? Promise.resolve();
}
