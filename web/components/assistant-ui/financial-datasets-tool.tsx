"use client";

import { useState } from "react";
import { type ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  ToolFallbackArgs,
  ToolFallbackContent,
  ToolFallbackResult,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/elements/tool-fallback.aui";

const FINANCIAL_DATASETS_PREFIX = "financial_datasets__";

export function isFinancialDatasetsTool(toolName: string) {
  return toolName.startsWith(FINANCIAL_DATASETS_PREFIX);
}

function labelOf(toolName: string) {
  const raw = toolName.slice(FINANCIAL_DATASETS_PREFIX.length).replaceAll("_", " ");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function shownResult(result: unknown) {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result) as unknown;
  } catch {
    return result;
  }
}

export const FinancialDatasetsTool: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
  status,
  isError,
}) => {
  const running = status?.type === "running";
  const failed = Boolean(isError) || status?.type === "incomplete";
  const [open, setOpen] = useState(running || failed);
  const shownStatus =
    failed && status?.type === "complete"
      ? ({ type: "incomplete", reason: "error" } as const)
      : status;

  return (
    <ToolFallbackRoot open={open} onOpenChange={setOpen}>
      <ToolFallbackTrigger
        toolName={`Financial Datasets · ${labelOf(toolName)}`}
        status={shownStatus}
      />
      <ToolFallbackContent>
        <ToolFallbackArgs argsText={argsText} />
        {running ? null : <ToolFallbackResult result={shownResult(result)} />}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};
