import type { PaymentMethod } from "../../database/types.js"

export interface CashRegister {
  id: string
  code: string
  name: string
  active: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export interface CashAssignment {
  id: string
  user: { id: string; name: string }
  register: { id: string; code: string; name: string }
  validFrom: string
  validUntil: string | null
  reason: string
}

export interface CashMovement {
  id: string
  type: "opening" | "sale" | "sale_reversal" | "return" | "supply" | "withdrawal"
    | "closing_adjustment"
  paymentMethod: PaymentMethod
  amountCents: number
  reason: string
  actor: { id: string; name: string }
  occurredAt: string
  sourceType: string
  sourceId: string | null
}

export interface CashSession {
  id: string
  register: { id: string; code: string; name: string }
  openingOperator: { id: string; name: string }
  openedAt: string
  openingAmountCents: number
  status: "open" | "closed"
  closingOperator: { id: string; name: string } | null
  closedAt: string | null
  closingNote: string | null
  version: number
  expectedByMethod: Record<PaymentMethod, number>
  closeCounts: Array<{
    paymentMethod: PaymentMethod
    expectedAmountCents: number
    countedAmountCents: number
    differenceCents: number
  }>
  movements: CashMovement[]
}
