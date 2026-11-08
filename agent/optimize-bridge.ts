import type { OptimizeState } from "./optimize-mode.ts";

type Bridge = {
  read(): Promise<OptimizeState>;
};

let bridge: Bridge | undefined;

export function bindOptimize(next: Bridge) {
  bridge = next;
}

export function readOptimize() {
  return bridge?.read() ?? Promise.resolve({ enabled: false, question: "", calls: [] });
}
