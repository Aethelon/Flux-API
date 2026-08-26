import { Type } from "@sinclair/typebox"

const StatusSchema = Type.Union([Type.Literal("active"), Type.Literal("inactive")])
const SystemKeySchema = Type.Union([
  Type.Literal("administrator"), Type.Literal("operator"), Type.Null(),
])

export const JobRoleSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  description: Type.String(),
  status: StatusSchema,
  systemKey: SystemKeySchema,
  permissions: Type.Array(Type.String()),
  employeeCount: Type.Integer(),
  version: Type.Integer(),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
})

export const CreateJobRoleBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 80 }),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  permissions: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
}, { additionalProperties: false })

export const UpdateJobRoleBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  status: Type.Optional(StatusSchema),
  permissions: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
}, { additionalProperties: false })

export const IdParamsSchema = Type.Object({ id: Type.String({ format: "uuid" }) })
export const VersionQuerySchema = Type.Object({ version: Type.String({ pattern: "^[1-9][0-9]*$" }) })
export const IdempotencyHeadersSchema = Type.Object({
  "idempotency-key": Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: true })

