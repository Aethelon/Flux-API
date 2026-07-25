import { Type } from "@sinclair/typebox"

export const IdempotencyHeadersSchema = Type.Object({
  "idempotency-key": Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: true })

export const IdParamsSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
})

export const SupplierProductParamsSchema = Type.Object({
  supplierId: Type.String({ format: "uuid" }),
  relationId: Type.String({ format: "uuid" }),
})

export const PageQuerySchema = Type.Object({
  page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,8}$" })),
  pageSize: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" })),
  search: Type.Optional(Type.String({ maxLength: 160 })),
})

export const VersionBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })

export const SupplierSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  legalName: Type.String(),
  tradeName: Type.Union([Type.String(), Type.Null()]),
  taxId: Type.Union([Type.String(), Type.Null()]),
  email: Type.Union([Type.String(), Type.Null()]),
  phone: Type.Union([Type.String(), Type.Null()]),
  contactName: Type.Union([Type.String(), Type.Null()]),
  notes: Type.String(),
  active: Type.Boolean(),
  version: Type.Integer(),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
})

export const SupplierPageSchema = Type.Object({
  data: Type.Array(SupplierSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})

const NullableText = Type.Union([Type.String(), Type.Null()])

export const CreateSupplierBodySchema = Type.Object({
  legalName: Type.String({ minLength: 1, maxLength: 200 }),
  tradeName: Type.Optional(NullableText),
  taxId: Type.Optional(NullableText),
  email: Type.Optional(Type.Union([
    Type.String({ format: "email", maxLength: 320 }),
    Type.Null(),
  ])),
  phone: Type.Optional(NullableText),
  contactName: Type.Optional(NullableText),
  notes: Type.Optional(Type.String({ maxLength: 4_000 })),
  active: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

export const UpdateSupplierBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  legalName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  tradeName: Type.Optional(NullableText),
  taxId: Type.Optional(NullableText),
  email: Type.Optional(Type.Union([
    Type.String({ format: "email", maxLength: 320 }),
    Type.Null(),
  ])),
  phone: Type.Optional(NullableText),
  contactName: Type.Optional(NullableText),
  notes: Type.Optional(Type.String({ maxLength: 4_000 })),
  active: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

export const ProductSupplierSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  supplierId: Type.String({ format: "uuid" }),
  product: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
    sku: Type.Union([Type.String(), Type.Null()]),
    unitAbbreviation: Type.String(),
    quantityScale: Type.Integer(),
  }),
  supplierSku: Type.Union([Type.String(), Type.Null()]),
  active: Type.Boolean(),
  leadTimeDays: Type.Integer(),
  minimumOrderQuantity: Type.Number(),
  packMultiple: Type.Number(),
  validFrom: Type.String({ format: "date-time" }),
  validUntil: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
})

export const ProductSupplierBodySchema = Type.Object({
  productId: Type.String({ format: "uuid" }),
  supplierSku: Type.Optional(NullableText),
  active: Type.Optional(Type.Boolean()),
  leadTimeDays: Type.Integer({ minimum: 0, maximum: 3_650 }),
  minimumOrderQuantity: Type.Number({ exclusiveMinimum: 0 }),
  packMultiple: Type.Number({ exclusiveMinimum: 0 }),
}, { additionalProperties: false })

export const PurchaseOrderStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("submitted"),
  Type.Literal("partially_received"),
  Type.Literal("received"),
  Type.Literal("cancelled"),
])

const PurchaseOrderItemSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  productId: Type.String({ format: "uuid" }),
  productName: Type.String(),
  unitAbbreviation: Type.String(),
  orderedQuantity: Type.Number(),
  receivedQuantity: Type.Number(),
  agreedUnitCostCents: Type.Number(),
  supplierSku: Type.Union([Type.String(), Type.Null()]),
  packMultiple: Type.Number(),
  minimumOrderQuantity: Type.Number(),
})

export const PurchaseOrderSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  businessNumber: Type.Integer(),
  supplier: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
  }),
  status: PurchaseOrderStatusSchema,
  orderedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  expectedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  notes: Type.String(),
  cancellationReason: Type.Union([Type.String(), Type.Null()]),
  version: Type.Integer(),
  createdAt: Type.String({ format: "date-time" }),
  items: Type.Array(PurchaseOrderItemSchema),
})

export const PurchaseOrderPageSchema = Type.Object({
  data: Type.Array(PurchaseOrderSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})

export const CreatePurchaseOrderBodySchema = Type.Object({
  supplierId: Type.String({ format: "uuid" }),
  expectedAt: Type.Optional(Type.Union([
    Type.String({ format: "date-time" }),
    Type.Null(),
  ])),
  notes: Type.Optional(Type.String({ maxLength: 4_000 })),
  items: Type.Array(Type.Object({
    productId: Type.String({ format: "uuid" }),
    quantity: Type.Number({ exclusiveMinimum: 0 }),
    agreedUnitCostCents: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 500 }),
}, { additionalProperties: false })

export const CancelPurchaseOrderBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })

const ReceiptItemSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  purchaseOrderItemId: Type.String({ format: "uuid" }),
  productId: Type.String({ format: "uuid" }),
  receivedQuantity: Type.Number(),
  acceptedUnitCostCents: Type.Number(),
  lotReference: Type.Union([Type.String(), Type.Null()]),
  stockMovementId: Type.String({ format: "uuid" }),
})

export const GoodsReceiptSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  businessNumber: Type.Integer(),
  purchaseOrderId: Type.String({ format: "uuid" }),
  status: Type.Union([Type.Literal("completed"), Type.Literal("reversed")]),
  supplierDocumentReference: Type.Union([Type.String(), Type.Null()]),
  receivedBy: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
  }),
  receivedAt: Type.String({ format: "date-time" }),
  reversedBy: Type.Union([
    Type.Object({ id: Type.String({ format: "uuid" }), name: Type.String() }),
    Type.Null(),
  ]),
  reversedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  reversalReason: Type.Union([Type.String(), Type.Null()]),
  items: Type.Array(ReceiptItemSchema),
})

export const CreateGoodsReceiptBodySchema = Type.Object({
  purchaseOrderId: Type.String({ format: "uuid" }),
  supplierDocumentReference: Type.Optional(NullableText),
  items: Type.Array(Type.Object({
    purchaseOrderItemId: Type.String({ format: "uuid" }),
    quantity: Type.Number({ exclusiveMinimum: 0 }),
    acceptedUnitCostCents: Type.Integer({ minimum: 0 }),
    lotReference: Type.Optional(NullableText),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 500 }),
}, { additionalProperties: false })

export const ReverseGoodsReceiptBodySchema = Type.Object({
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })
