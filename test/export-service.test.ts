import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AuthenticatedUser } from "../src/modules/auth/types.js"
import { createCsv } from "../src/modules/exports/csv.js"
import { createSalesHistoryCsv } from "../src/modules/exports/sales-history-csv.js"
import type { ExportRepository } from "../src/modules/exports/export-repository.js"
import { ExportService } from "../src/modules/exports/export-service.js"
import type {
  ExportArtifact,
  ExportJob,
} from "../src/modules/exports/types.js"

const employee: AuthenticatedUser = {
  id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
  tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
  sessionId: "483dece1-5925-407c-a830-a1d498862be0",
  name: "Employee",
  email: "employee@dlara.test",
  role: "funcionario",
}

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: "3df7468a-2616-4335-962a-6570218138bd",
    source: "sales_history",
    status: "completed",
    requestedBy: employee.id,
    processedCount: 1,
    totalCount: 1,
    attempts: 1,
    errorCode: null,
    createdAt: "2026-07-25T10:00:00.000Z",
    startedAt: "2026-07-25T10:00:01.000Z",
    finishedAt: "2026-07-25T10:00:02.000Z",
    downloadReady: true,
    filename: "history.csv",
    expiresAt: "2026-07-26T10:00:02.000Z",
    ...overrides,
  }
}

class ExportRepositoryStub implements ExportRepository {
  stored = job()

  create(): Promise<ExportJob> {
    return Promise.resolve(this.stored)
  }

  get(): Promise<ExportJob | null> {
    return Promise.resolve(this.stored)
  }

  getArtifact(): Promise<ExportArtifact | null> {
    return Promise.resolve({
      filename: "history.csv",
      contentType: "text/csv; charset=utf-8",
      content: "content",
      sha256: "hash",
    })
  }
}

void describe("export business rules", () => {
  void it("blocks every export for an employee", () => {
    const service = new ExportService(new ExportRepositoryStub())

    assert.throws(
      () => service.create(employee, { source: "sales_history" }, "key"),
      { statusCode: 403, code: "FORBIDDEN" },
    )
  })

  void it("hides exports from an employee", async () => {
    const repository = new ExportRepositoryStub()

    await assert.rejects(
      new ExportService(repository).get(employee, repository.stored.id),
      { statusCode: 404, code: "EXPORT_NOT_FOUND" },
    )
  })

  void it("protects CSV cells from spreadsheet formulas", () => {
    const csv = createCsv(["name"], [["=1+1"], ["+SUM(A1:A2)"], ["safe"], [-900]])

    assert.match(csv, /"'=1\+1"/)
    assert.match(csv, /"'\+SUM\(A1:A2\)"/)
    assert.match(csv, /"safe"/)
    assert.match(csv, /"-900"/)
    assert.doesNotMatch(csv, /"'-900"/)
  })

  void it("formats sales history for Brazilian spreadsheets", () => {
    const csv = createSalesHistoryCsv([{
      id: "sale-1",
      businessNumber: 80,
      status: "partially_returned",
      businessDate: "2026-08-23",
      completedAt: "2026-08-23T18:30:00.000Z",
      cancelledAt: null,
      customer: null,
      operator: { id: "operator-1", name: "Ana Silva" },
      itemCount: 2,
      itemNames: ["Jogo de Cama", "Bordado"],
      paymentMethods: ["credit", "pix"],
      hasReturns: true,
      financial: {
        grossAmountCents: 8990,
        discountAmountCents: 450,
        returnedAmountCents: 1000,
        netRevenueCents: 7540,
        cogsCents: 4200,
        grossProfitCents: 3340,
        grossMarginRate: 0.4429708223,
        costComplete: true,
      },
    }], { currency: "BRL", timeZone: "America/Recife" })

    const [headers, row] = csv.slice(1).trim().split("\r\n")
    assert.ok(headers)
    assert.ok(row)
    assert.match(headers, /^"ID da venda";"Nº da venda"/)
    assert.match(headers, /"Valor bruto \(BRL\)"/)
    assert.match(row, /"Parcialmente devolvida"/)
    assert.match(row, /"23\/08\/2026 15:30:00"/)
    assert.match(row, /"Consumidor não identificado"/)
    assert.match(row, /"Crédito \| Pix"/)
    assert.match(row, /"Sim";"89,90";"4,50";"10,00";"75,40"/)
    assert.match(row, /"44,30";"Sim"$/)
  })

  void it("keeps sales history columns aligned without financial data", () => {
    const csv = createSalesHistoryCsv([{
      id: "sale-without-financials",
      businessNumber: 81,
      status: "completed",
      businessDate: "2026-08-23",
      completedAt: "2026-08-23T18:30:00.000Z",
      cancelledAt: null,
      customer: { id: "customer-1", name: "Rafael Ribeiro" },
      operator: { id: "operator-1", name: "Ana Silva" },
      itemCount: 1,
      itemNames: ["Bordado"],
      paymentMethods: ["cash"],
      hasReturns: false,
    }], { currency: "BRL", timeZone: "America/Recife" })

    const [headers, row] = csv.slice(1).trim().split("\r\n")
    assert.ok(headers)
    assert.ok(row)
    assert.equal(headers.split(";").length, 20)
    assert.equal(row.split(";").length, 20)
    assert.match(row, /;"";"";"";"";"";"";"";""$/)
  })

  void it("reports a completed export without an artifact as expired", async () => {
    const repository = new ExportRepositoryStub()
    repository.stored = job({
      downloadReady: false,
      filename: null,
      expiresAt: null,
    })

    await assert.rejects(
      new ExportService(repository).download(
        { ...employee, role: "admin" },
        repository.stored.id,
      ),
      { statusCode: 410, code: "EXPORT_EXPIRED" },
    )
  })
})
