import type { FastifyError, FastifyInstance } from "fastify"
import { AppError } from "./app-error.js"

interface ValidationIssue {
  instancePath?: string
  message?: string
  keyword?: string
  params?: {
    missingProperty?: string
    limit?: number
    format?: string
  }
}

const messages: Record<string, string> = {
  NOT_FOUND: "O recurso solicitado não foi encontrado.",
  UNAUTHORIZED: "Autenticação ausente, inválida ou expirada.",
  FORBIDDEN: "Você não tem permissão para realizar esta ação.",
  VALIDATION_ERROR: "A solicitação contém campos inválidos.",
  RESOURCE_CONFLICT: "O recurso entra em conflito com dados existentes.",
  RESOURCE_IN_USE: "O recurso está sendo usado por dados existentes.",
  PAYLOAD_TOO_LARGE: "O corpo da solicitação excede o tamanho permitido.",
  REQUEST_ERROR: "A solicitação não pôde ser processada.",
  INTERNAL_ERROR: "Ocorreu um erro inesperado.",
  STALE_VERSION: "O registro foi alterado. Atualize a página e tente novamente.",
  IDEMPOTENCY_KEY_REUSED: "A chave de idempotência já foi usada com dados diferentes.",
  IDEMPOTENCY_RESULT_UNAVAILABLE: "O resultado da solicitação anterior não está disponível.",
  COLUMN_REORDER_CONFLICT: "As colunas foram alteradas. Atualize o quadro e tente novamente.",
  SERVICE_ORDER_ALREADY_BILLED: "Esta ordem já foi vendida e não pode ser alterada.",
}

function publicMessage(code: string): string {
  return messages[code] ?? "Não foi possível concluir a solicitação."
}

function validationMessage(issue: ValidationIssue): string {
  const limit = issue.params?.limit
  switch (issue.keyword) {
    case "required": return "é obrigatório."
    case "additionalProperties": return "não é permitido."
    case "minLength": return limit === undefined
      ? "está menor do que o permitido."
      : `deve ter no mínimo ${String(limit)} caracteres.`
    case "maxLength": return limit === undefined
      ? "está maior do que o permitido."
      : `deve ter no máximo ${String(limit)} caracteres.`
    case "minimum": return limit === undefined
      ? "está abaixo do mínimo permitido."
      : `deve ser maior ou igual a ${String(limit)}.`
    case "maximum": return limit === undefined
      ? "está acima do máximo permitido."
      : `deve ser menor ou igual a ${String(limit)}.`
    case "format": return issue.params?.format === "email"
      ? "deve ter o formato de e-mail."
      : "deve estar no formato esperado."
    case "enum": return "deve ser um dos valores permitidos."
    case "type": return "deve ter o tipo de valor esperado."
    default: return "valor inválido."
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
      message: messages.NOT_FOUND,
      requestId: request.correlationId || request.id,
    })
  })

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      request.errorClass = error.code
      return reply.status(error.statusCode).send({
        code: error.code,
        message: messages[error.code] ?? error.message,
        requestId: request.correlationId || request.id,
        ...(error.details === undefined ? {} : { details: error.details }),
      })
    }

    if (error.validation) {
      request.errorClass = "VALIDATION_ERROR"
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: messages.VALIDATION_ERROR,
        fieldErrors: error.validation.map((issue) => ({
          field: validationField(issue),
          message: validationMessage(issue),
        })),
        requestId: request.correlationId || request.id,
      })
    }

    if (error.code === "23505") {
      request.errorClass = "RESOURCE_CONFLICT"
      return reply.status(409).send({
        code: "RESOURCE_CONFLICT",
        message: messages.RESOURCE_CONFLICT,
        requestId: request.correlationId || request.id,
      })
    }

    if (error.code === "23503") {
      request.errorClass = "RESOURCE_IN_USE"
      return reply.status(409).send({
        code: "RESOURCE_IN_USE",
        message: messages.RESOURCE_IN_USE,
        requestId: request.correlationId || request.id,
      })
    }

    if (error.statusCode === 413) {
      request.errorClass = "PAYLOAD_TOO_LARGE"
      return reply.status(413).send({
        code: "PAYLOAD_TOO_LARGE",
        message: messages.PAYLOAD_TOO_LARGE,
        requestId: request.correlationId || request.id,
      })
    }

    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      request.errorClass = error.code || "REQUEST_ERROR"
      return reply.status(error.statusCode).send({
        code: error.code || "REQUEST_ERROR",
        message: publicMessage(error.code || "REQUEST_ERROR"),
        requestId: request.correlationId || request.id,
      })
    }

    request.log.error({ err: error }, "Unhandled request error")
    request.errorClass = "INTERNAL_ERROR"

    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: messages.INTERNAL_ERROR,
      requestId: request.correlationId || request.id,
    })
  })
}
