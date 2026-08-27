import { Type } from "@sinclair/typebox"

export const InventoryStatusSchema = Type.Union([
  Type.Literal("inactive"),
  Type.Literal("sold_out"),
  Type.Literal("low_stock"),
  Type.Literal("available"),
])

export const StockMovementTypeSchema = Type.Union([
  Type.Literal("receipt"),
  Type.Literal("sale"),
  Type.Literal("sale_reversal"),
  Type.Literal("return"),
  Type.Literal("reservation"),
  Type.Literal("reservation_release"),
  Type.Literal("positive_adjustment"),
  Type.Literal("negative_adjustment"),
  Type.Literal("stock_count_adjustment"),
])

export const InventoryBalanceSchema = Type.Object({
  product: Type.Object({
    id: Type.String({ format: "uuid" }),
    sku: Type.Union([Type.String(), Type.Null()]),
    barcode: Type.Union([Type.String(), Type.Null()]),
    type: Type.Union([
      Type.Literal("raw_material"),
      Type.Literal("finished_product"),
      Type.Literal("packaging"),
    ]),
    name: Type.String(),
    active: Type.Boolean(),
    minimumStock: Type.Number(),
    category: Type.Object({
      id: Type.String({ format: "uuid" }),
      name: Type.String(),
    }),
    unit: Type.Object({
      id: Type.String({ format: "uuid" }),
      name: Type.String(),
      abbreviation: Type.String(),
      quantityScale: Type.Integer(),
    }),
  }),
  onHand: Type.Number(),
  reserved: Type.Number(),
  available: Type.Number(),
  averageUnitCostCents: Type.Union([Type.Number(), Type.Null()]),
  inventoryValueCents: Type.Union([Type.Number(), Type.Null()]),
  status: InventoryStatusSchema,
  version: Type.Integer(),
  updatedAt: Type.String({ format: "date-time" }),
})

export const InventoryBalanceListSchema = Type.Object({
  data: Type.Array(InventoryBalanceSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})

export const StockMovementSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  product: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
    sku: Type.Union([Type.String(), Type.Null()]),
    unitAbbreviation: Type.String(),
  }),
  type: StockMovementTypeSchema,
  quantity: Type.Number(),
  resultingOnHand: Type.Number(),
  resultingReserved: Type.Number(),
  unitCostSnapshotCents: Type.Union([Type.Number(), Type.Null()]),
  sourceType: Type.String(),
  sourceId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  sourceReference: Type.Union([Type.String(), Type.Null()]),
  reason: Type.String(),
  actor: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
  }),
  occurredAt: Type.String({ format: "date-time" }),
  reversalOfId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
})

export const StockMovementListSchema = Type.Object({
  data: Type.Array(StockMovementSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})

const PageQueryProperties = {
  page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,8}$" })),
  pageSize: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|[1-4][0-9]{2}|500)$" })),
}

export const BalanceListQuerySchema = Type.Object({
  ...PageQueryProperties,
  search: Type.Optional(Type.String({ maxLength: 160 })),
  status: Type.Optional(InventoryStatusSchema),
})

export const MovementListQuerySchema = Type.Object({
  limit: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  productId: Type.Optional(Type.String({ format: "uuid" })),
  type: Type.Optional(StockMovementTypeSchema),
})

export const ProductIdParamsSchema = Type.Object({
  productId: Type.String({ format: "uuid" }),
})

export const IdempotencyHeadersSchema = Type.Object(
  {
    "idempotency-key": Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: true },
)

export const CreateManualMovementBodySchema = Type.Object(
  {
    productId: Type.String({ format: "uuid" }),
    type: Type.Union([
      Type.Literal("receipt"),
      Type.Literal("positive_adjustment"),
      Type.Literal("negative_adjustment"),
    ]),
    quantity: Type.Number({ exclusiveMinimum: 0 }),
    unitCostCents: Type.Optional(
      Type.Number({ minimum: 0, maximum: 2_147_483_647 }),
    ),
    sourceReference: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    reason: Type.String({ minLength: 3, maxLength: 500 }),
  },
  { additionalProperties: false },
)

export const StockCountStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("confirmed"),
  Type.Literal("cancelled"),
])

export const StockCountItemSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  product: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
    sku: Type.Union([Type.String(), Type.Null()]),
    unitAbbreviation: Type.String(),
    quantityScale: Type.Integer(),
  }),
  expectedQuantity: Type.Number(),
  countedQuantity: Type.Union([Type.Number(), Type.Null()]),
  difference: Type.Union([Type.Number(), Type.Null()]),
  unitCostSnapshotCents: Type.Union([Type.Number(), Type.Null()]),
  movementId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
})

const UserReferenceSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
})

export const StockCountSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  status: StockCountStatusSchema,
  reason: Type.String(),
  startedBy: UserReferenceSchema,
  startedAt: Type.String({ format: "date-time" }),
  confirmedBy: Type.Union([UserReferenceSchema, Type.Null()]),
  confirmedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  cancelledBy: Type.Union([UserReferenceSchema, Type.Null()]),
  cancelledAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  cancellationReason: Type.Union([Type.String(), Type.Null()]),
  version: Type.Integer(),
  items: Type.Array(StockCountItemSchema),
})

export const StockCountListSchema = Type.Object({
  data: Type.Array(Type.Object({
    id: Type.String({ format: "uuid" }),
    status: StockCountStatusSchema,
    reason: Type.String(),
    startedBy: UserReferenceSchema,
    startedAt: Type.String({ format: "date-time" }),
    confirmedBy: Type.Union([UserReferenceSchema, Type.Null()]),
    confirmedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    cancelledBy: Type.Union([UserReferenceSchema, Type.Null()]),
    cancelledAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    cancellationReason: Type.Union([Type.String(), Type.Null()]),
    version: Type.Integer(),
    itemCount: Type.Integer(),
  })),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})

export const StockCountListQuerySchema = Type.Object({
  ...PageQueryProperties,
  status: Type.Optional(StockCountStatusSchema),
})

export const StockCountIdParamsSchema = Type.Object({
  countId: Type.String({ format: "uuid" }),
})

export const CreateStockCountBodySchema = Type.Object(
  {
    reason: Type.String({ minLength: 3, maxLength: 500 }),
    productIds: Type.Array(
      Type.String({ format: "uuid" }),
      { minItems: 1, maxItems: 500, uniqueItems: true },
    ),
  },
  { additionalProperties: false },
)

export const ConfirmStockCountBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    items: Type.Array(
      Type.Object(
        {
          productId: Type.String({ format: "uuid" }),
          countedQuantity: Type.Number({ minimum: 0 }),
          unitCostCents: Type.Optional(Type.Number({
            minimum: 0,
            maximum: 2_147_483_647,
          })),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 500 },
    ),
  },
  { additionalProperties: false },
)

export const CancelStockCountBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 3, maxLength: 500 }),
  },
  { additionalProperties: false },
)
