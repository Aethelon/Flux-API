import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AuthenticatedUser } from "../src/modules/auth/types.js"
import type { HistoryRepository } from "../src/modules/history/history-repository.js"
import { HistoryService } from "../src/modules/history/history-service.js"
import type {
  HistoryKpis,
  ReportContext,
  SaleHistoryFilters,
  SaleHistoryRecord,
} from "../src/modules/history/types.js"

const employee: AuthenticatedUser = {
  id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
  tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
  sessionId: "483dece1-5925-407c-a830-a1d498862be0",
  name: "Employee",
  email: "employee@dlara.test",
  role: "funcionario",
}

class HistoryRepositoryStub implements HistoryRepository {
  includeFinancials: boolean | null = null

  listSales(
    _tenantId: string,
    _filters: SaleHistoryFilters,
    includeFinancials: boolean,
  ): Promise<{ data: SaleHistoryRecord[]; hasMore: boolean }> {
    this.includeFinancials = includeFinancials
    return Promise.resolve({
      data: [{
        id: "3df7468a-2616-4335-962a-6570218138bd",
        businessNumber: 1,
        status: "completed",
        businessDate: "2026-07-25",
        completedAt: "2026-07-25T10:00:00.000Z",
        cancelledAt: null,
        customer: null,
        operator: { id: employee.id, name: employee.name },
        itemCount: 1,
        itemNames: ["Produto"],
        paymentMethods: ["cash"],
        hasReturns: false,
      }],
      hasMore: false,
    })
  }

  getKpis(): Promise<HistoryKpis> {
    throw new Error("Not used")
  }

  resolveReportContext(): Promise<ReportContext> {
    throw new Error("Not used")
  }
}

void describe("history business rules", () => {
  void it("removes financial fields from employee history", async () => {
    const repository = new HistoryRepositoryStub()
    const result = await new HistoryService(repository).listSales(employee, {})

    assert.equal(repository.includeFinancials, false)
    assert.equal(result.data[0]?.financial, undefined)
  })

  void it("rejects an invalid opaque cursor", async () => {
    const service = new HistoryService(new HistoryRepositoryStub())

    await assert.rejects(
      service.listSales(employee, { cursor: "invalid" }),
      { statusCode: 400, code: "INVALID_CURSOR" },
    )
  })

  void it("rejects an inverted report range", async () => {
    const service = new HistoryService(new HistoryRepositoryStub())

    await assert.rejects(
      service.listSales(employee, {
        from: "2026-07-26T00:00:00.000Z",
        to: "2026-07-25T00:00:00.000Z",
      }),
      { statusCode: 400, code: "INVALID_DATE_RANGE" },
    )
  })
})
