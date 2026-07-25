import { Type } from "@sinclair/typebox"

const StatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("inactive"),
])

const RoleSchema = Type.Union([
  Type.Literal("admin"),
  Type.Literal("funcionario"),
])

const NullableEmailSchema = Type.Union([
  Type.String({ format: "email", maxLength: 320 }),
  Type.Null(),
])

const NullablePhoneSchema = Type.Union([
  Type.String({ minLength: 3, maxLength: 40 }),
  Type.Null(),
])

export const CustomerSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  email: Type.Union([Type.String(), Type.Null()]),
  phone: Type.Union([Type.String(), Type.Null()]),
  notes: Type.String(),
  status: StatusSchema,
  consentAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  anonymizedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  version: Type.Integer(),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
})

export const EmployeeSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  email: Type.String(),
  phone: Type.Union([Type.String(), Type.Null()]),
  role: RoleSchema,
  status: StatusSchema,
  version: Type.Integer(),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
})

function pageSchema(item: typeof CustomerSchema | typeof EmployeeSchema) {
  return Type.Object({
    data: Type.Array(item),
    page: Type.Integer(),
    pageSize: Type.Integer(),
    total: Type.Integer(),
  })
}

export const CustomerPageSchema = pageSchema(CustomerSchema)
export const EmployeePageSchema = pageSchema(EmployeeSchema)

export const PeopleListQuerySchema = Type.Object({
  page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,8}$" })),
  pageSize: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" })),
  search: Type.Optional(Type.String({ maxLength: 160 })),
  status: Type.Optional(StatusSchema),
})

export const PersonIdParamsSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
})

export const VersionQuerySchema = Type.Object({
  version: Type.String({ pattern: "^[1-9][0-9]*$" }),
})

export const IdempotencyHeadersSchema = Type.Object(
  {
    "idempotency-key": Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: true },
)

export const CreateCustomerBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  email: Type.Optional(NullableEmailSchema),
  phone: Type.Optional(NullablePhoneSchema),
  notes: Type.Optional(Type.String({ maxLength: 4_000 })),
  status: Type.Optional(StatusSchema),
  consentAt: Type.Optional(Type.Union([
    Type.String({ format: "date-time" }),
    Type.Null(),
  ])),
}, { additionalProperties: false })

export const UpdateCustomerBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  email: Type.Optional(NullableEmailSchema),
  phone: Type.Optional(NullablePhoneSchema),
  notes: Type.Optional(Type.String({ maxLength: 4_000 })),
  status: Type.Optional(StatusSchema),
  consentAt: Type.Optional(Type.Union([
    Type.String({ format: "date-time" }),
    Type.Null(),
  ])),
}, { additionalProperties: false })

export const CreateEmployeeBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  email: Type.String({ format: "email", maxLength: 320 }),
  phone: Type.Optional(NullablePhoneSchema),
  role: RoleSchema,
  status: Type.Optional(StatusSchema),
  password: Type.String({ minLength: 12, maxLength: 200 }),
}, { additionalProperties: false })

export const UpdateEmployeeBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  email: Type.Optional(Type.String({ format: "email", maxLength: 320 })),
  phone: Type.Optional(NullablePhoneSchema),
  role: Type.Optional(RoleSchema),
  status: Type.Optional(StatusSchema),
  password: Type.Optional(Type.String({ minLength: 12, maxLength: 200 })),
}, { additionalProperties: false })
