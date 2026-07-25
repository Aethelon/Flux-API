import type { FastifyError, FastifyInstance } from "fastify"
import { AppError } from "./app-error.js"

interface ValidationIssue {
  instancePath?: string
  message?: string
  params?: {
    missingProperty?: string
  }
}

function validationField(issue: ValidationIssue): string {
  return issue.instancePath?.replace(/^\//, "").replaceAll("/", ".")
    || issue.params?.missingProperty
    || "request"
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => reply.status(404).send({
    code: "NOT_FOUND",
    message: "The requested resource was not found.",
    requestId: request.id,
  }))

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        requestId: request.id,
        ...(error.details === undefined ? {} : { details: error.details }),
      })
    }

    if (error.validation) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "The request contains invalid fields.",
        fieldErrors: error.validation.map((issue) => ({
          field: validationField(issue),
          message: issue.message ?? "Invalid value.",
        })),
        requestId: request.id,
      })
    }

    if (error.code === "23505") {
      return reply.status(409).send({
        code: "RESOURCE_CONFLICT",
        message: "The resource conflicts with existing data.",
        requestId: request.id,
      })
    }

    if (error.code === "23503") {
      return reply.status(409).send({
        code: "RESOURCE_IN_USE",
        message: "The resource is referenced by existing business data.",
        requestId: request.id,
      })
    }

    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        code: error.code || "REQUEST_ERROR",
        message: error.message,
        requestId: request.id,
      })
    }

    request.log.error({ err: error }, "Unhandled request error")

    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId: request.id,
    })
  })
}
