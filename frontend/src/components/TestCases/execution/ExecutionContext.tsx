import { createContext, useContext } from 'react';
import type { ExecutionController } from '@/hooks/useTestCaseExecution';

const ExecutionContext = createContext<ExecutionController | null>(null);

export function ExecutionProvider({
  value,
  children,
}: {
  value: ExecutionController;
  children: React.ReactNode;
}) {
  return <ExecutionContext.Provider value={value}>{children}</ExecutionContext.Provider>;
}

/** Access the shared execution controller. Throws if used outside the provider. */
export function useExecution(): ExecutionController {
  const ctx = useContext(ExecutionContext);
  if (!ctx) throw new Error('useExecution must be used within an ExecutionProvider');
  return ctx;
}
