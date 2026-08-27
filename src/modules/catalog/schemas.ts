import { Type } from "@sinclair/typebox"

export const IdempotencyHeadersSchema = Type.Object({
  "idempotency-key": Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: true })

export const ProductTypeSchema = Type.Union([
  Type.Literal("raw_material"),
  Type.Literal("finished_product"),
  Type.Literal("packaging"),
  Type.Literal("service"),
])

export const CostSourceSchema = Type.Union([
  Type.Literal("manual"),
  Type.Literal("receipt"),
  Type.Literal("moving_average"),
  Type.Literal("estimated"),
])

export const CategorySchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  active: Type.Boolean(),
  version: Type.Integer(),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
})

export const UnitSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  abbreviation: Type.String(),
  allowsFractional: Type.Boolean(),
  quantityScale: Type.Integer(),
  active: Type.Boolean(),
  version: Type.Integer(),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
})

export const ProductSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  sku: Type.Union([Type.String(), Type.Null()]),
  barcode: Type.Union([Type.String(), Type.Null()]),
  type: ProductTypeSchema,
  name: Type.String(),
  description: Type.String(),
  active: Type.Boolean(),
  minimumStock: Type.Number(),
  priceCents: Type.Integer(),
  costCents: Type.Union([Type.Integer(), Type.Null()]),
  costSource: Type.Union([CostSourceSchema, Type.Null()]),
  category: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
  }),
  unit: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
    abbreviation: Type.String(),
    allowsFractional: Type.Boolean(),
    quantityScale: Type.Integer(),
  }),
  version: Type.Integer(),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
})

export const ProductListSchema = Type.Object({
  data: Type.Array(ProductSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})

export const IdParamsSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
})

export const VersionQuerySchema = Type.Object({
  version: Type.String({ pattern: "^[1-9][0-9]*$" }),
})

export const IncludeArchivedQuerySchema = Type.Object({
  includeArchived: Type.Optional(Type.Union([
    Type.Literal("true"),
    Type.Literal("false"),
  ])),
})

export const CreateCategoryBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  active: Type.Optional(Type.Boolean({ default: true })),
})

export const VersionedCategoryBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    active: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

export const CreateUnitBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 80 }),
  abbreviation: Type.String({ minLength: 1, maxLength: 12 }),
  allowsFractional: Type.Optional(Type.Boolean({ default: false })),
  quantityScale: Type.Optional(Type.Integer({ minimum: 0, maximum: 3, default: 0 })),
  active: Type.Optional(Type.Boolean({ default: true })),
})

export const UpdateUnitBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    abbreviation: Type.Optional(Type.String({ minLength: 1, maxLength: 12 })),
    allowsFractional: Type.Optional(Type.Boolean()),
    quantityScale: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
    active: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

const NullableIdentifier = Type.Union([
  Type.String({ minLength: 1, maxLength: 80 }),
  Type.Null(),
])

export const CreateProductBodySchema = Type.Object({
  sku: Type.Optional(NullableIdentifier),
  barcode: Type.Optional(NullableIdentifier),
  type: ProductTypeSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.Optional(Type.String({ maxLength: 4_000, default: "" })),
  active: Type.Optional(Type.Boolean({ default: true })),
  minimumStock: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
  priceCents: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
  costCents: Type.Optional(
    Type.Union([
      Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
      Type.Null(),
    ]),
  ),
  costSource: Type.Optional(Type.Union([CostSourceSchema, Type.Null()])),
  categoryId: Type.String({ format: "uuid" }),
  unitId: Type.String({ format: "uuid" }),
})

export const UpdateProductBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    sku: Type.Optional(NullableIdentifier),
    barcode: Type.Optional(NullableIdentifier),
    type: Type.Optional(ProductTypeSchema),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    description: Type.Optional(Type.String({ maxLength: 4_000 })),
    active: Type.Optional(Type.Boolean()),
    minimumStock: Type.Optional(Type.Number({ minimum: 0 })),
    priceCents: Type.Optional(Type.Integer({ minimum: 0, maximum: 2_147_483_647 })),
    costCents: Type.Optional(Type.Union([
      Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
      Type.Null(),
    ])),
    costSource: Type.Optional(Type.Union([CostSourceSchema, Type.Null()])),
    categoryId: Type.Optional(Type.String({ format: "uuid" })),
    unitId: Type.Optional(Type.String({ format: "uuid" })),
    changeReason: Type.Optional(Type.String({ minLength: 3, maxLength: 500 })),
  },
  { additionalProperties: false },
)

export const ProductListQuerySchema = Type.Object({
  page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,8}$" })),
  pageSize: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|[1-4][0-9]{2}|500)$" })),
  search: Type.Optional(Type.String({ maxLength: 160 })),
  categoryId: Type.Optional(Type.String({ format: "uuid" })),
  type: Type.Optional(ProductTypeSchema),
  active: Type.Optional(Type.Union([
    Type.Literal("true"),
    Type.Literal("false"),
  ])),
})

export const PriceHistorySchema = Type.Array(Type.Object({
  id: Type.String({ format: "uuid" }),
  oldPriceCents: Type.Union([Type.Integer(), Type.Null()]),
  newPriceCents: Type.Integer(),
  reason: Type.String(),
  actorId: Type.String({ format: "uuid" }),
  effectiveAt: Type.String({ format: "date-time" }),
}))

export const CostHistorySchema = Type.Array(Type.Object({
  id: Type.String({ format: "uuid" }),
  oldCostCents: Type.Union([Type.Integer(), Type.Null()]),
  newCostCents: Type.Union([Type.Integer(), Type.Null()]),
  source: Type.Union([CostSourceSchema, Type.Null()]),
  reason: Type.String(),
  actorId: Type.String({ format: "uuid" }),
  effectiveAt: Type.String({ format: "date-time" }),
}))
