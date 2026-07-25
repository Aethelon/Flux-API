import { AsyncLocalStorage } from "node:async_hooks"

interface RequestContext {
  correlationId: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export function enterRequestContext(correlationId: string): void {
  storage.enterWith({ correlationId })
}

export function currentCorrelationId(): string | null {
  return storage.getStore()?.correlationId ?? null
}
