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
  app.setNotFoundHandler((request, reply) => {
    request.errorClass = "NOT_FOUND"
    return reply.status(404).send({
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
      requestId: request.correlationId || request.id,
    })
  })

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      request.errorClass = error.code
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        requestId: request.correlationId || request.id,
        ...(error.details === undefined ? {} : { details: error.details }),
      })
    }

    if (error.validation) {
      request.errorClass = "VALIDATION_ERROR"
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "The request contains invalid fields.",
        fieldErrors: error.validation.map((issue) => ({
          field: validationField(issue),
          message: issue.message ?? "Invalid value.",
        })),
        requestId: request.correlationId || request.id,
      })
    }

    if (error.code === "23505") {
      request.errorClass = "RESOURCE_CONFLICT"
      return reply.status(409).send({
        code: "RESOURCE_CONFLICT",
        message: "The resource conflicts with existing data.",
        requestId: request.correlationId || request.id,
      })
    }

    if (error.code === "23503") {
      request.errorClass = "RESOURCE_IN_USE"
      return reply.status(409).send({
        code: "RESOURCE_IN_USE",
        message: "The resource is referenced by existing business data.",
        requestId: request.correlationId || request.id,
      })
    }

    if (error.statusCode === 413) {
      request.errorClass = "PAYLOAD_TOO_LARGE"
      return reply.status(413).send({
        code: "PAYLOAD_TOO_LARGE",
        message: "The request body exceeds the allowed size.",
        requestId: request.correlationId || request.id,
      })
    }

    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      request.errorClass = error.code || "REQUEST_ERROR"
      return reply.status(error.statusCode).send({
        code: error.code || "REQUEST_ERROR",
        message: error.message,
        requestId: request.correlationId || request.id,
      })
    }

    request.log.error({ err: error }, "Unhandled request error")
    request.errorClass = "INTERNAL_ERROR"

    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId: request.correlationId || request.id,
    })
  })
}
