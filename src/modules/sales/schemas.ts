import { Type } from "@sinclair/typebox"

export const IdParamsSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
})

export const IdempotencyHeadersSchema = Type.Object({
  "idempotency-key": Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: true })

const PaymentMethodSchema = Type.Union([
  Type.Literal("cash"),
  Type.Literal("credit"),
  Type.Literal("debit"),
  Type.Literal("pix"),
])

const ReturnItemSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  saleItemId: Type.String({ format: "uuid" }),
  quantity: Type.Number({ exclusiveMinimum: 0 }),
  amountCents: Type.Integer({ minimum: 0 }),
  restock: Type.Boolean(),
  unitCostSnapshotCents: Type.Union([Type.Number(), Type.Null()]),
  stockMovementId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
})

export const SaleReturnSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  businessNumber: Type.Integer({ minimum: 1 }),
  reason: Type.String(),
  totalAmountCents: Type.Integer({ minimum: 0 }),
  operator: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
  }),
  cashSessionId: Type.String({ format: "uuid" }),
  completedAt: Type.String({ format: "date-time" }),
  items: Type.Array(ReturnItemSchema),
  refunds: Type.Array(Type.Object({
    method: PaymentMethodSchema,
    amountCents: Type.Integer({ minimum: 1 }),
    externalReference: Type.Union([Type.String(), Type.Null()]),
  })),
})

export const SaleSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  businessNumber: Type.Integer({ minimum: 1 }),
  status: Type.Union([
    Type.Literal("completed"),
    Type.Literal("partially_returned"),
    Type.Literal("returned"),
    Type.Literal("cancelled"),
  ]),
  customer: Type.Union([
    Type.Object({ id: Type.String({ format: "uuid" }), name: Type.String() }),
    Type.Null(),
  ]),
  operator: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
  }),
  cashSessionId: Type.String({ format: "uuid" }),
  grossAmountCents: Type.Integer({ minimum: 0 }),
  discountAmountCents: Type.Integer({ minimum: 0 }),
  netAmountCents: Type.Integer({ minimum: 0 }),
  returnedAmountCents: Type.Integer({ minimum: 0 }),
  changeAmountCents: Type.Integer({ minimum: 0 }),
  businessDate: Type.String({ format: "date" }),
  completedAt: Type.String({ format: "date-time" }),
  cancelledAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  cancellationReason: Type.Union([Type.String(), Type.Null()]),
  version: Type.Integer({ minimum: 1 }),
  items: Type.Array(Type.Object({
    id: Type.String({ format: "uuid" }),
    productId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    serviceOrderId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    productName: Type.String(),
    productType: Type.Union([
      Type.Literal("raw_material"),
      Type.Literal("finished_product"),
      Type.Literal("packaging"),
      Type.Literal("service"),
    ]),
    unitAbbreviation: Type.String(),
    quantity: Type.Number({ exclusiveMinimum: 0 }),
    unitPriceCents: Type.Integer({ minimum: 0 }),
    grossAmountCents: Type.Integer({ minimum: 0 }),
    allocatedDiscountCents: Type.Integer({ minimum: 0 }),
    netAmountCents: Type.Integer({ minimum: 0 }),
    unitCostSnapshotCents: Type.Union([Type.Number(), Type.Null()]),
    returnedQuantity: Type.Number({ minimum: 0 }),
    returnedNetAmountCents: Type.Integer({ minimum: 0 }),
  })),
  payments: Type.Array(Type.Object({
    id: Type.String({ format: "uuid" }),
    method: PaymentMethodSchema,
    amountCents: Type.Integer({ minimum: 1 }),
    effectiveAmountCents: Type.Integer({ minimum: 0 }),
    installments: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    status: Type.Union([
      Type.Literal("completed"),
      Type.Literal("reversed"),
      Type.Literal("partially_refunded"),
      Type.Literal("refunded"),
    ]),
    externalReference: Type.Union([Type.String(), Type.Null()]),
  })),
  returns: Type.Array(SaleReturnSchema),
})

export const CreateSaleBodySchema = Type.Object({
  customerId: Type.Optional(Type.Union([
    Type.String({ format: "uuid" }),
    Type.Null(),
  ])),
  discountAmountCents: Type.Optional(Type.Integer({ minimum: 0 })),
  changeAmountCents: Type.Optional(Type.Integer({ minimum: 0 })),
  items: Type.Array(Type.Union([
    Type.Object({
      productId: Type.String({ format: "uuid" }),
      quantity: Type.Number({ exclusiveMinimum: 0 }),
    }, { additionalProperties: false }),
    Type.Object({
      serviceOrderId: Type.String({ format: "uuid" }),
    }, { additionalProperties: false }),
  ]), { minItems: 1, maxItems: 500 }),
  payments: Type.Array(Type.Object({
    method: PaymentMethodSchema,
    amountCents: Type.Integer({ minimum: 1 }),
    installments: Type.Optional(Type.Integer({ minimum: 1, maximum: 120 })),
    externalReference: Type.Optional(Type.Union([
      Type.String({ maxLength: 200 }),
      Type.Null(),
    ])),
  }, { additionalProperties: false }), { maxItems: 20 }),
}, { additionalProperties: false })

export const CancelSaleBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })

export const CreateReturnBodySchema = Type.Object({
  reason: Type.String({ minLength: 3, maxLength: 500 }),
  items: Type.Array(Type.Object({
    saleItemId: Type.String({ format: "uuid" }),
    quantity: Type.Number({ exclusiveMinimum: 0 }),
    restock: Type.Boolean(),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 500 }),
  refunds: Type.Array(Type.Object({
    method: PaymentMethodSchema,
    amountCents: Type.Integer({ minimum: 1 }),
    externalReference: Type.Optional(Type.Union([
      Type.String({ maxLength: 200 }),
      Type.Null(),
    ])),
  }, { additionalProperties: false }), { maxItems: 20 }),
}, { additionalProperties: false })
