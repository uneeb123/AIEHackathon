import { defineExtension, hook, ToolTask } from "@earendil-works/pi-durable";
import { judgeCall, recordedCall, sameCall } from "../optimize-mode.ts";
import { readOptimize, rememberCall } from "../optimize-bridge.ts";

export default defineExtension({
  name: "optimize",
  hooks: [
    hook(ToolTask, {
      beforeTool: async (call) => {
        const mode = await readOptimize();
        if (!mode.enabled) return undefined;
        const next = recordedCall(call.name, call.arguments);
        if (mode.calls.some((earlier) => sameCall(earlier, next))) {
          return { block: "Skipped. This repeats a call already made for this question." };
        }
        try {
          const allow = await judgeCall({
            question: mode.question,
            call: next,
            earlier_calls: mode.calls,
          });
          if (!allow) {
            return { block: "Skipped. This call is not needed to answer the question." };
          }
        } catch (error) {
          console.error("optimize:", error instanceof Error ? error.message : error);
          return undefined;
        }
        await rememberCall(next);
        return undefined;
      },
    }),
  ],
});
