import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AuthenticatedUser } from "../src/modules/auth/types.js"
import { createCsv } from "../src/modules/exports/csv.js"
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
  void it("blocks aggregate exports for an employee", () => {
    const service = new ExportService(new ExportRepositoryStub())

    assert.throws(
      () => service.create(employee, { source: "sales_kpis" }, "key"),
      { statusCode: 403, code: "FORBIDDEN" },
    )
  })

  void it("hides another user's export from an employee", async () => {
    const repository = new ExportRepositoryStub()
    repository.stored = job({
      requestedBy: "6b798a76-eaf3-4a79-b006-c88cb78f348f",
    })

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

  void it("reports a completed export without an artifact as expired", async () => {
    const repository = new ExportRepositoryStub()
    repository.stored = job({
      downloadReady: false,
      filename: null,
      expiresAt: null,
    })

    await assert.rejects(
      new ExportService(repository).download(employee, repository.stored.id),
      { statusCode: 410, code: "EXPORT_EXPIRED" },
    )
  })
})
