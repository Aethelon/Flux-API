import { Type } from "@sinclair/typebox"

export const ErrorResponseSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  fieldErrors: Type.Optional(
    Type.Array(
      Type.Object({
        field: Type.String(),
        message: Type.String(),
      }),
    ),
  ),
  requestId: Type.String(),
  details: Type.Optional(Type.Unknown()),
})
