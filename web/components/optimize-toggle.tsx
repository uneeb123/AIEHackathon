"use client";

import { createContext, useContext, type ReactNode } from "react";

const OptimizeContext = createContext({
  enabled: false,
  setEnabled: (_enabled: boolean) => {},
});

export function OptimizeModeProvider({
  enabled,
  setEnabled,
  children,
}: {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return <OptimizeContext.Provider value={{ enabled, setEnabled }}>{children}</OptimizeContext.Provider>;
}

export function OptimizeToggle() {
  const { enabled, setEnabled } = useContext(OptimizeContext);
  return (
    <button
      type="button"
      aria-pressed={enabled}
      onClick={() => setEnabled(!enabled)}
      className={
        enabled
          ? "bg-primary text-primary-foreground h-7 rounded-full px-2.5 text-xs font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground h-7 rounded-full px-2.5 text-xs font-medium"
      }
    >
      Optimize
    </button>
  );
}
