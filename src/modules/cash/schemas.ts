import { Type } from "@sinclair/typebox"

export const IdempotencyHeadersSchema = Type.Object({
  "idempotency-key": Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: true })

export const IdParamsSchema = Type.Object({ id: Type.String({ format: "uuid" }) })

export const RegisterSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  code: Type.String(),
  name: Type.String(),
  active: Type.Boolean(),
  version: Type.Integer(),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
})

export const AssignmentSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  user: Type.Object({ id: Type.String({ format: "uuid" }), name: Type.String() }),
  register: Type.Object({
    id: Type.String({ format: "uuid" }), code: Type.String(), name: Type.String(),
  }),
  validFrom: Type.String({ format: "date-time" }),
  validUntil: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  reason: Type.String(),
})

const PaymentMethodSchema = Type.Union([
  Type.Literal("cash"), Type.Literal("credit"), Type.Literal("debit"), Type.Literal("pix"),
])

const MovementSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  type: Type.Union([
    Type.Literal("opening"), Type.Literal("sale"), Type.Literal("sale_reversal"),
    Type.Literal("return"), Type.Literal("supply"), Type.Literal("withdrawal"),
    Type.Literal("closing_adjustment"),
  ]),
  paymentMethod: PaymentMethodSchema,
  amountCents: Type.Integer(),
  reason: Type.String(),
  actor: Type.Object({ id: Type.String({ format: "uuid" }), name: Type.String() }),
  occurredAt: Type.String({ format: "date-time" }),
  sourceType: Type.String(),
  sourceId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
})

export const SessionSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  register: Type.Object({
    id: Type.String({ format: "uuid" }), code: Type.String(), name: Type.String(),
  }),
  openingOperator: Type.Object({
    id: Type.String({ format: "uuid" }), name: Type.String(),
  }),
  openedAt: Type.String({ format: "date-time" }),
  openingAmountCents: Type.Integer(),
  status: Type.Union([Type.Literal("open"), Type.Literal("closed")]),
  closingOperator: Type.Union([
    Type.Object({ id: Type.String({ format: "uuid" }), name: Type.String() }),
    Type.Null(),
  ]),
  closedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  closingNote: Type.Union([Type.String(), Type.Null()]),
  version: Type.Integer(),
  expectedByMethod: Type.Object({
    cash: Type.Integer(), credit: Type.Integer(), debit: Type.Integer(), pix: Type.Integer(),
  }),
  closeCounts: Type.Array(Type.Object({
    paymentMethod: PaymentMethodSchema,
    expectedAmountCents: Type.Integer(),
    countedAmountCents: Type.Integer(),
    differenceCents: Type.Integer(),
  })),
  movements: Type.Array(MovementSchema),
})

export const MyRegisterSchema = Type.Object({
  assignment: AssignmentSchema,
  session: Type.Union([SessionSchema, Type.Null()]),
})

export const CreateRegisterBodySchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 40 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
}, { additionalProperties: false })

export const UpdateRegisterBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  active: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

export const AssignmentBodySchema = Type.Object({
  userId: Type.String({ format: "uuid" }),
  registerId: Type.String({ format: "uuid" }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })

export const OpenSessionBodySchema = Type.Object({
  openingAmountCents: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })

export const ManualMovementBodySchema = Type.Object({
  type: Type.Union([Type.Literal("supply"), Type.Literal("withdrawal")]),
  amountCents: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })

export const CashAmountBodySchema = Type.Object({
  amountCents: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })

export const CloseSessionBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  countedByMethod: Type.Object({
    cash: Type.Integer({ minimum: 0 }),
    credit: Type.Integer({ minimum: 0 }),
    debit: Type.Integer({ minimum: 0 }),
    pix: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false }),
  note: Type.Optional(Type.String({ maxLength: 1_000 })),
}, { additionalProperties: false })

export const PageQuerySchema = Type.Object({
  page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,8}$" })),
  pageSize: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" })),
})
