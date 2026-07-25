import { sql, type Kysely } from "kysely"
import type { Database } from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import {
  recordDomainEvent,
  replayedEntityId,
  saveEntityIdempotency,
} from "../../shared/persistence/commands.js"
import { nextTenantSequence } from "../../shared/persistence/tenant-sequence.js"
import type { AuthenticatedUser } from "../auth/types.js"
import { recordInventoryTracking } from "../inventory/inventory-tracking.js"
import type {
  GoodsReceipt,
  ProductSupplier,
  PurchaseOrder,
  Supplier,
  SupplyPage,
} from "./types.js"

export interface SupplierWrite {
  legalName: string
  tradeName: string | null
  taxId: string | null
  email: string | null
  phone: string | null
  contactName: string | null
  notes: string
  active: boolean
}

export interface ProductSupplierWrite {
  productId: string
  supplierSku: string | null
  active: boolean
  leadTimeDays: number
  minimumOrderQuantity: number
  packMultiple: number
}

export interface PreparedPurchaseOrder {
  supplierId: string
  expectedAt: Date | null
  notes: string
  items: Array<{
    productId: string
    productName: string
    unitAbbreviation: string
    quantity: number
    agreedUnitCostCents: number
    supplierSku: string | null
    packMultiple: number
    minimumOrderQuantity: number
  }>
}

export interface SupplyRepository {
  listSuppliers(tenantId: string, page: number, pageSize: number, search?: string):
    Promise<SupplyPage<Supplier>>
  getSupplier(tenantId: string, id: string): Promise<Supplier | null>
  createSupplier(user: AuthenticatedUser, values: SupplierWrite, key: string, hash: string):
    Promise<Supplier>
  updateSupplier(
    user: AuthenticatedUser,
    id: string,
    version: number,
    values: SupplierWrite,
    before: Supplier,
    key: string,
    hash: string,
  ): Promise<Supplier | null>
  listProductSuppliers(tenantId: string, supplierId: string, history: boolean):
    Promise<ProductSupplier[]>
  getProductSupplier(tenantId: string, supplierId: string, relationId: string):
    Promise<ProductSupplier | null>
  createProductSupplier(
    user: AuthenticatedUser,
    supplierId: string,
    values: ProductSupplierWrite,
    key: string,
    hash: string,
  ): Promise<ProductSupplier>
  replaceProductSupplier(
    user: AuthenticatedUser,
    supplierId: string,
    relationId: string,
    values: ProductSupplierWrite,
    key: string,
    hash: string,
  ): Promise<ProductSupplier | null>
  closeProductSupplier(
    user: AuthenticatedUser,
    supplierId: string,
    relationId: string,
    key: string,
    hash: string,
  ): Promise<boolean>
  findCurrentProductSuppliers(
    tenantId: string,
    supplierId: string,
    productIds: string[],
  ): Promise<ProductSupplier[]>
  getProductMeta(tenantId: string, productId: string): Promise<{
    id: string
    type: string
    active: boolean
    name: string
    unitAbbreviation: string
    quantityScale: number
  } | null>
  createPurchaseOrder(
    user: AuthenticatedUser,
    values: PreparedPurchaseOrder,
    key: string,
    hash: string,
  ): Promise<PurchaseOrder>
  getPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrder | null>
  listPurchaseOrders(tenantId: string, page: number, pageSize: number):
    Promise<SupplyPage<PurchaseOrder>>
  submitPurchaseOrder(user: AuthenticatedUser, id: string, version: number, key: string, hash: string):
    Promise<PurchaseOrder | null>
  cancelPurchaseOrder(
    user: AuthenticatedUser,
    id: string,
    version: number,
    reason: string,
    key: string,
    hash: string,
  ): Promise<PurchaseOrder | null>
  createGoodsReceipt(
    user: AuthenticatedUser,
    input: {
      purchaseOrderId: string
      supplierDocumentReference: string | null
      items: Array<{
        purchaseOrderItemId: string
        quantity: number
        acceptedUnitCostCents: number
        lotReference: string | null
      }>
    },
    key: string,
    hash: string,
  ): Promise<GoodsReceipt>
  getGoodsReceipt(tenantId: string, id: string): Promise<GoodsReceipt | null>
  reverseGoodsReceipt(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    key: string,
    hash: string,
  ): Promise<GoodsReceipt>
}

function mapSupplier(row: {
  id: string
  legal_name: string
  trade_name: string | null
  tax_id: string | null
  email: string | null
  phone: string | null
  contact_name: string | null
  notes: string
  active: boolean
  version: number
  created_at: Date
  updated_at: Date
}): Supplier {
  return {
    id: row.id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    taxId: row.tax_id,
    email: row.email,
    phone: row.phone,
    contactName: row.contact_name,
    notes: row.notes,
    active: row.active,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function supplierSelection() {
  return [
    "id", "legal_name", "trade_name", "tax_id", "email", "phone",
    "contact_name", "notes", "active", "version", "created_at", "updated_at",
  ] as const
}

function mapRelation(row: {
  id: string
  supplier_id: string
  product_id: string
  product_name: string
  product_sku: string | null
  unit_abbreviation: string
  quantity_scale: number
  supplier_sku: string | null
  active: boolean
  lead_time_days: number
  minimum_order_quantity: string
  pack_multiple: string
  valid_from: Date
  valid_until: Date | null
}): ProductSupplier {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    product: {
      id: row.product_id,
      name: row.product_name,
      sku: row.product_sku,
      unitAbbreviation: row.unit_abbreviation,
      quantityScale: row.quantity_scale,
    },
    supplierSku: row.supplier_sku,
    active: row.active,
    leadTimeDays: row.lead_time_days,
    minimumOrderQuantity: Number(row.minimum_order_quantity),
    packMultiple: Number(row.pack_multiple),
    validFrom: row.valid_from.toISOString(),
    validUntil: row.valid_until?.toISOString() ?? null,
  }
}

function relationQuery(database: Kysely<Database>) {
  return database.selectFrom("product_suppliers as relation")
    .innerJoin("products as product", "product.id", "relation.product_id")
    .innerJoin("units as unit", "unit.id", "product.unit_id")
    .select([
      "relation.id",
      "relation.supplier_id",
      "product.id as product_id",
      "product.name as product_name",
      "product.sku as product_sku",
      "unit.abbreviation as unit_abbreviation",
      "unit.quantity_scale",
      "relation.supplier_sku",
      "relation.active",
      "relation.lead_time_days",
      "relation.minimum_order_quantity",
      "relation.pack_multiple",
      "relation.valid_from",
      "relation.valid_until",
    ])
}

export class KyselySupplyRepository implements SupplyRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async listSuppliers(
    tenantId: string,
    page: number,
    pageSize: number,
    search?: string,
  ): Promise<SupplyPage<Supplier>> {
    let query = this.database.selectFrom("suppliers").select(supplierSelection())
      .where("tenant_id", "=", tenantId).where("archived_at", "is", null)
    let count = this.database.selectFrom("suppliers")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId).where("archived_at", "is", null)
    if (search) {
      const pattern = `%${search}%`
      query = query.where((expression) => expression.or([
        expression("legal_name", "ilike", pattern),
        expression("trade_name", "ilike", pattern),
        expression("tax_id", "ilike", pattern),
      ]))
      count = count.where((expression) => expression.or([
        expression("legal_name", "ilike", pattern),
        expression("trade_name", "ilike", pattern),
        expression("tax_id", "ilike", pattern),
      ]))
    }
    const [rows, total] = await Promise.all([
      query.orderBy("legal_name").orderBy("id").limit(pageSize)
        .offset((page - 1) * pageSize).execute(),
      count.executeTakeFirstOrThrow(),
    ])
    return { data: rows.map(mapSupplier), page, pageSize, total: Number(total.count) }
  }

  async getSupplier(tenantId: string, id: string): Promise<Supplier | null> {
    const row = await this.database.selectFrom("suppliers").select(supplierSelection())
      .where("tenant_id", "=", tenantId).where("id", "=", id)
      .where("archived_at", "is", null).executeTakeFirst()
    return row ? mapSupplier(row) : null
  }

  async createSupplier(
    user: AuthenticatedUser,
    values: SupplierWrite,
    key: string,
    hash: string,
  ): Promise<Supplier> {
    const route = "POST /api/v1/suppliers"
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.insertInto("suppliers").values({
        tenant_id: user.tenantId,
        legal_name: values.legalName,
        trade_name: values.tradeName,
        tax_id: values.taxId,
        email: values.email,
        phone: values.phone,
        contact_name: values.contactName,
        notes: values.notes,
        active: values.active,
        created_by: user.id,
        updated_by: user.id,
        archived_at: null,
      }).returning("id").executeTakeFirstOrThrow()
      await recordDomainEvent(transaction, user, {
        action: "supplier.created", entityType: "supplier", entityId: row.id, after: values,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, row.id, 201)
      return row.id
    })
    const supplier = await this.getSupplier(user.tenantId, id)
    if (!supplier) throw new Error("Created supplier could not be reloaded")
    return supplier
  }

  async updateSupplier(
    user: AuthenticatedUser,
    id: string,
    version: number,
    values: SupplierWrite,
    before: Supplier,
    key: string,
    hash: string,
  ): Promise<Supplier | null> {
    const route = `PATCH /api/v1/suppliers/${id}`
    const result = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.updateTable("suppliers").set({
        legal_name: values.legalName,
        trade_name: values.tradeName,
        tax_id: values.taxId,
        email: values.email,
        phone: values.phone,
        contact_name: values.contactName,
        notes: values.notes,
        active: values.active,
        updated_by: user.id,
        updated_at: new Date(),
        version: sql`version + 1`,
      }).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .where("version", "=", version).where("archived_at", "is", null)
        .returning("id").executeTakeFirst()
      if (!row) return null
      await recordDomainEvent(transaction, user, {
        action: "supplier.updated", entityType: "supplier", entityId: id,
        before, after: values,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return id
    })
    return result ? this.getSupplier(user.tenantId, result) : null
  }

  async listProductSuppliers(
    tenantId: string,
    supplierId: string,
    history: boolean,
  ): Promise<ProductSupplier[]> {
    let query = relationQuery(this.database)
      .where("relation.tenant_id", "=", tenantId)
      .where("relation.supplier_id", "=", supplierId)
    if (!history) query = query.where("relation.valid_until", "is", null)
    return (await query.orderBy("product.name").orderBy("relation.valid_from", "desc")
      .execute()).map(mapRelation)
  }

  async getProductSupplier(
    tenantId: string,
    supplierId: string,
    relationId: string,
  ): Promise<ProductSupplier | null> {
    const row = await relationQuery(this.database)
      .where("relation.tenant_id", "=", tenantId)
      .where("relation.supplier_id", "=", supplierId)
      .where("relation.id", "=", relationId).executeTakeFirst()
    return row ? mapRelation(row) : null
  }

  async createProductSupplier(
    user: AuthenticatedUser,
    supplierId: string,
    values: ProductSupplierWrite,
    key: string,
    hash: string,
  ): Promise<ProductSupplier> {
    const route = `POST /api/v1/suppliers/${supplierId}/products`
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.insertInto("product_suppliers").values({
        tenant_id: user.tenantId,
        supplier_id: supplierId,
        product_id: values.productId,
        supplier_sku: values.supplierSku,
        active: values.active,
        lead_time_days: values.leadTimeDays,
        minimum_order_quantity: values.minimumOrderQuantity,
        pack_multiple: values.packMultiple,
        valid_until: null,
        created_by: user.id,
      }).returning("id").executeTakeFirstOrThrow()
      await recordDomainEvent(transaction, user, {
        action: "supplier.product_linked", entityType: "product_supplier",
        entityId: row.id, after: values,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, row.id, 201)
      return row.id
    })
    const relation = await this.getProductSupplier(user.tenantId, supplierId, id)
    if (!relation) throw new Error("Created product supplier could not be reloaded")
    return relation
  }

  async replaceProductSupplier(
    user: AuthenticatedUser,
    supplierId: string,
    relationId: string,
    values: ProductSupplierWrite,
    key: string,
    hash: string,
  ): Promise<ProductSupplier | null> {
    const route = `PATCH /api/v1/suppliers/${supplierId}/products/${relationId}`
    const newId = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const closed = await transaction.updateTable("product_suppliers")
        .set({ valid_until: new Date() })
        .where("tenant_id", "=", user.tenantId).where("supplier_id", "=", supplierId)
        .where("id", "=", relationId).where("valid_until", "is", null)
        .returning("id").executeTakeFirst()
      if (!closed) return null
      const row = await transaction.insertInto("product_suppliers").values({
        tenant_id: user.tenantId,
        supplier_id: supplierId,
        product_id: values.productId,
        supplier_sku: values.supplierSku,
        active: values.active,
        lead_time_days: values.leadTimeDays,
        minimum_order_quantity: values.minimumOrderQuantity,
        pack_multiple: values.packMultiple,
        valid_until: null,
        created_by: user.id,
      }).returning("id").executeTakeFirstOrThrow()
      await recordDomainEvent(transaction, user, {
        action: "supplier.product_link_changed", entityType: "product_supplier",
        entityId: row.id, before: { relationId }, after: values,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, row.id, 200)
      return row.id
    })
    return newId ? this.getProductSupplier(user.tenantId, supplierId, newId) : null
  }

  async closeProductSupplier(
    user: AuthenticatedUser,
    supplierId: string,
    relationId: string,
    key: string,
    hash: string,
  ): Promise<boolean> {
    const route = `DELETE /api/v1/suppliers/${supplierId}/products/${relationId}`
    return this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return true
      const row = await transaction.updateTable("product_suppliers")
        .set({ valid_until: new Date(), active: false })
        .where("tenant_id", "=", user.tenantId).where("supplier_id", "=", supplierId)
        .where("id", "=", relationId).where("valid_until", "is", null)
        .returning("id").executeTakeFirst()
      if (!row) return false
      await recordDomainEvent(transaction, user, {
        action: "supplier.product_unlinked", entityType: "product_supplier",
        entityId: relationId,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, relationId, 204)
      return true
    })
  }

  async findCurrentProductSuppliers(
    tenantId: string,
    supplierId: string,
    productIds: string[],
  ): Promise<ProductSupplier[]> {
    const rows = await relationQuery(this.database)
      .where("relation.tenant_id", "=", tenantId)
      .where("relation.supplier_id", "=", supplierId)
      .where("relation.product_id", "in", productIds)
      .where("relation.valid_until", "is", null)
      .where("relation.active", "=", true).execute()
    return rows.map(mapRelation)
  }

  async getProductMeta(tenantId: string, productId: string) {
    const row = await this.database.selectFrom("products as product")
      .innerJoin("units as unit", "unit.id", "product.unit_id")
      .select([
        "product.id", "product.type", "product.active", "product.name",
        "unit.abbreviation", "unit.quantity_scale",
      ])
      .where("product.tenant_id", "=", tenantId).where("product.id", "=", productId)
      .where("product.archived_at", "is", null).executeTakeFirst()
    return row ? {
      id: row.id,
      type: row.type,
      active: row.active,
      name: row.name,
      unitAbbreviation: row.abbreviation,
      quantityScale: row.quantity_scale,
    } : null
  }

  async createPurchaseOrder(
    user: AuthenticatedUser,
    values: PreparedPurchaseOrder,
    key: string,
    hash: string,
  ): Promise<PurchaseOrder> {
    const route = "POST /api/v1/purchase-orders"
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const number = await nextTenantSequence(transaction, user.tenantId, "purchase_order")
      const row = await transaction.insertInto("purchase_orders").values({
        tenant_id: user.tenantId,
        business_number: number,
        supplier_id: values.supplierId,
        status: "draft",
        ordered_at: null,
        expected_at: values.expectedAt,
        created_by: user.id,
        approved_by: null,
        approved_at: null,
        cancellation_reason: null,
        recommendation_id: null,
        notes: values.notes,
      }).returning("id").executeTakeFirstOrThrow()
      await transaction.insertInto("purchase_order_items").values(values.items.map((item) => ({
        tenant_id: user.tenantId,
        purchase_order_id: row.id,
        product_id: item.productId,
        product_name_snapshot: item.productName,
        unit_abbreviation_snapshot: item.unitAbbreviation,
        ordered_quantity: item.quantity,
        received_quantity: 0,
        agreed_unit_cost_cents: item.agreedUnitCostCents,
        supplier_sku_snapshot: item.supplierSku,
        pack_multiple_snapshot: item.packMultiple,
        minimum_order_quantity_snapshot: item.minimumOrderQuantity,
      }))).execute()
      await recordDomainEvent(transaction, user, {
        action: "purchase_order.created", entityType: "purchase_order",
        entityId: row.id, after: { businessNumber: number, ...values },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, row.id, 201)
      return row.id
    })
    const order = await this.getPurchaseOrder(user.tenantId, id)
    if (!order) throw new Error("Created purchase order could not be reloaded")
    return order
  }

  async getPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrder | null> {
    const row = await this.database.selectFrom("purchase_orders as order")
      .innerJoin("suppliers as supplier", "supplier.id", "order.supplier_id")
      .select([
        "order.id", "order.business_number", "supplier.id as supplier_id",
        "supplier.legal_name as supplier_name", "order.status", "order.ordered_at",
        "order.expected_at", "order.notes", "order.cancellation_reason",
        "order.version", "order.created_at",
      ]).where("order.tenant_id", "=", tenantId).where("order.id", "=", id)
      .executeTakeFirst()
    if (!row) return null
    const items = await this.database.selectFrom("purchase_order_items")
      .selectAll().where("tenant_id", "=", tenantId).where("purchase_order_id", "=", id)
      .orderBy("product_name_snapshot").orderBy("id").execute()
    return {
      id: row.id,
      businessNumber: Number(row.business_number),
      supplier: { id: row.supplier_id, name: row.supplier_name },
      status: row.status,
      orderedAt: row.ordered_at?.toISOString() ?? null,
      expectedAt: row.expected_at?.toISOString() ?? null,
      notes: row.notes,
      cancellationReason: row.cancellation_reason,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      items: items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name_snapshot,
        unitAbbreviation: item.unit_abbreviation_snapshot,
        orderedQuantity: Number(item.ordered_quantity),
        receivedQuantity: Number(item.received_quantity),
        agreedUnitCostCents: Number(item.agreed_unit_cost_cents),
        supplierSku: item.supplier_sku_snapshot,
        packMultiple: Number(item.pack_multiple_snapshot),
        minimumOrderQuantity: Number(item.minimum_order_quantity_snapshot),
      })),
    }
  }

  async listPurchaseOrders(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<SupplyPage<PurchaseOrder>> {
    const [ids, total] = await Promise.all([
      this.database.selectFrom("purchase_orders").select("id")
        .where("tenant_id", "=", tenantId).orderBy("created_at", "desc").orderBy("id", "desc")
        .limit(pageSize).offset((page - 1) * pageSize).execute(),
      this.database.selectFrom("purchase_orders")
        .select((expression) => expression.fn.countAll<string>().as("count"))
        .where("tenant_id", "=", tenantId).executeTakeFirstOrThrow(),
    ])
    const orders = await Promise.all(ids.map(async (row) => {
      const order = await this.getPurchaseOrder(tenantId, row.id)
      if (!order) throw new Error("Purchase order disappeared during listing")
      return order
    }))
    return { data: orders, page, pageSize, total: Number(total.count) }
  }

  async submitPurchaseOrder(
    user: AuthenticatedUser,
    id: string,
    version: number,
    key: string,
    hash: string,
  ): Promise<PurchaseOrder | null> {
    const route = `POST /api/v1/purchase-orders/${id}/submit`
    const result = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const now = new Date()
      const row = await transaction.updateTable("purchase_orders").set({
        status: "submitted",
        ordered_at: now,
        approved_by: user.id,
        approved_at: now,
        updated_at: now,
        version: sql`version + 1`,
      }).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .where("status", "=", "draft").where("version", "=", version)
        .returning("id").executeTakeFirst()
      if (!row) return null
      await recordDomainEvent(transaction, user, {
        action: "purchase_order.submitted", entityType: "purchase_order", entityId: id,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return id
    })
    return result ? this.getPurchaseOrder(user.tenantId, result) : null
  }

  async cancelPurchaseOrder(
    user: AuthenticatedUser,
    id: string,
    version: number,
    reason: string,
    key: string,
    hash: string,
  ): Promise<PurchaseOrder | null> {
    const route = `POST /api/v1/purchase-orders/${id}/cancel`
    const result = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.updateTable("purchase_orders").set({
        status: "cancelled",
        cancellation_reason: reason,
        updated_at: new Date(),
        version: sql`version + 1`,
      }).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .where("status", "in", ["draft", "submitted"]).where("version", "=", version)
        .returning("id").executeTakeFirst()
      if (!row) return null
      await recordDomainEvent(transaction, user, {
        action: "purchase_order.cancelled", entityType: "purchase_order",
        entityId: id, reason,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return id
    })
    return result ? this.getPurchaseOrder(user.tenantId, result) : null
  }

  async createGoodsReceipt(
    user: AuthenticatedUser,
    input: {
      purchaseOrderId: string
      supplierDocumentReference: string | null
      items: Array<{
        purchaseOrderItemId: string
        quantity: number
        acceptedUnitCostCents: number
        lotReference: string | null
      }>
    },
    key: string,
    hash: string,
  ): Promise<GoodsReceipt> {
    const route = "POST /api/v1/goods-receipts"
    const receiptId = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const order = await transaction.selectFrom("purchase_orders")
        .select(["id", "status"]).where("tenant_id", "=", user.tenantId)
        .where("id", "=", input.purchaseOrderId).forUpdate().executeTakeFirst()
      if (!order) throw new AppError(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found.")
      if (!["submitted", "partially_received"].includes(order.status)) {
        throw new AppError(409, "PURCHASE_ORDER_NOT_RECEIVABLE", "Purchase order cannot be received.")
      }
      const requested = new Map(input.items.map((item) => [item.purchaseOrderItemId, item]))
      if (requested.size !== input.items.length) {
        throw new AppError(400, "DUPLICATE_RECEIPT_ITEM", "Receipt items must be unique.")
      }
      const orderItems = await transaction.selectFrom("purchase_order_items as item")
        .innerJoin("products as product", "product.id", "item.product_id")
        .innerJoin("units as unit", "unit.id", "product.unit_id")
        .innerJoin("inventory_balances as balance", (join) => join
          .onRef("balance.product_id", "=", "item.product_id")
          .onRef("balance.tenant_id", "=", "item.tenant_id"))
        .select([
          "item.id", "item.product_id", "item.ordered_quantity", "item.received_quantity",
          "product.current_cost_cents", "balance.on_hand", "balance.reserved",
          "balance.average_unit_cost_cents", "unit.quantity_scale",
        ]).where("item.tenant_id", "=", user.tenantId)
        .where("item.purchase_order_id", "=", order.id)
        .where("item.id", "in", [...requested.keys()]).orderBy("item.product_id")
        .forUpdate().execute()
      if (orderItems.length !== requested.size) {
        throw new AppError(400, "INVALID_RECEIPT_ITEMS", "Receipt item does not belong to the order.")
      }

      const number = await nextTenantSequence(transaction, user.tenantId, "goods_receipt")
      const receipt = await transaction.insertInto("goods_receipts").values({
        tenant_id: user.tenantId,
        business_number: number,
        purchase_order_id: order.id,
        status: "completed",
        supplier_document_reference: input.supplierDocumentReference,
        received_by: user.id,
        reversed_by: null,
        reversed_at: null,
        reversal_reason: null,
      }).returning(["id", "received_at"]).executeTakeFirstOrThrow()

      for (const item of orderItems) {
        const request = requested.get(item.id)
        if (!request) throw new Error("Validated receipt item disappeared")
        const ordered = Number(item.ordered_quantity)
        const alreadyReceived = Number(item.received_quantity)
        const scaleFactor = 10 ** item.quantity_scale
        if (Math.abs((request.quantity * scaleFactor)
          - Math.round(request.quantity * scaleFactor)) > 1e-8) {
          throw new AppError(
            400,
            "INVALID_QUANTITY_SCALE",
            "Receipt quantity exceeds the product unit precision.",
          )
        }
        if (!Number.isSafeInteger(request.acceptedUnitCostCents)
          || request.acceptedUnitCostCents < 0) {
          throw new AppError(400, "INVALID_UNIT_COST", "Accepted unit cost is invalid.")
        }
        if (alreadyReceived + request.quantity > ordered) {
          throw new AppError(409, "RECEIPT_EXCEEDS_ORDER", "Receipt exceeds ordered quantity.")
        }
        const oldOnHand = Number(item.on_hand)
        const reserved = Number(item.reserved)
        const oldAverage = item.average_unit_cost_cents === null
          ? null : Number(item.average_unit_cost_cents)
        const newOnHand = oldOnHand + request.quantity
        const newAverage = oldOnHand > 0 && oldAverage !== null
          ? ((oldOnHand * oldAverage) + (request.quantity * request.acceptedUnitCostCents))
            / newOnHand
          : request.acceptedUnitCostCents
        const roundedAverage = Math.round(newAverage * 1_000_000) / 1_000_000

        await transaction.updateTable("inventory_balances").set({
          on_hand: newOnHand,
          average_unit_cost_cents: roundedAverage,
          version: sql`version + 1`,
          updated_at: receipt.received_at,
        }).where("tenant_id", "=", user.tenantId).where("product_id", "=", item.product_id)
          .execute()
        await transaction.updateTable("purchase_order_items").set({
          received_quantity: alreadyReceived + request.quantity,
        }).where("tenant_id", "=", user.tenantId).where("id", "=", item.id).execute()
        const movement = await transaction.insertInto("stock_movements").values({
          tenant_id: user.tenantId,
          product_id: item.product_id,
          movement_type: "receipt",
          quantity: request.quantity,
          resulting_on_hand: newOnHand,
          resulting_reserved: reserved,
          unit_cost_snapshot_cents: request.acceptedUnitCostCents,
          source_type: "goods_receipt",
          source_id: receipt.id,
          source_reference: input.supplierDocumentReference,
          reason: `Goods receipt ${String(number)}`,
          actor_user_id: user.id,
          occurred_at: receipt.received_at,
          reversal_of_id: null,
        }).returning("id").executeTakeFirstOrThrow()
        await transaction.insertInto("goods_receipt_items").values({
          tenant_id: user.tenantId,
          goods_receipt_id: receipt.id,
          purchase_order_item_id: item.id,
          product_id: item.product_id,
          received_quantity: request.quantity,
          accepted_unit_cost_cents: request.acceptedUnitCostCents,
          lot_reference: request.lotReference,
          stock_movement_id: movement.id,
        }).execute()
        await recordInventoryTracking(transaction, {
          tenantId: user.tenantId,
          productId: item.product_id,
          movementId: movement.id,
          movementType: "receipt",
          quantity: request.quantity,
          oldOnHand,
          newOnHand,
          reserved,
          occurredAt: receipt.received_at,
        })
        const roundedCost = Math.round(roundedAverage)
        if (roundedCost !== item.current_cost_cents) {
          await transaction.updateTable("products").set({
            current_cost_cents: roundedCost,
            cost_source: "moving_average",
            updated_by: user.id,
            updated_at: receipt.received_at,
            version: sql`version + 1`,
          }).where("tenant_id", "=", user.tenantId).where("id", "=", item.product_id).execute()
          await transaction.insertInto("product_cost_history").values({
            tenant_id: user.tenantId,
            product_id: item.product_id,
            old_cost_cents: item.current_cost_cents,
            new_cost_cents: roundedCost,
            source: "moving_average",
            actor_id: user.id,
            reason: `Goods receipt ${String(number)}`,
          }).execute()
        }
      }

      const incomplete = await transaction.selectFrom("purchase_order_items")
        .select("id").where("tenant_id", "=", user.tenantId)
        .where("purchase_order_id", "=", order.id)
        .whereRef("received_quantity", "<", "ordered_quantity").executeTakeFirst()
      await transaction.updateTable("purchase_orders").set({
        status: incomplete ? "partially_received" : "received",
        updated_at: receipt.received_at,
        version: sql`version + 1`,
      }).where("tenant_id", "=", user.tenantId).where("id", "=", order.id).execute()
      await recordDomainEvent(transaction, user, {
        action: "goods_receipt.completed", entityType: "goods_receipt",
        entityId: receipt.id, after: { businessNumber: number, ...input },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, receipt.id, 201)
      return receipt.id
    })
    const receipt = await this.getGoodsReceipt(user.tenantId, receiptId)
    if (!receipt) throw new Error("Created goods receipt could not be reloaded")
    return receipt
  }

  async reverseGoodsReceipt(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    key: string,
    hash: string,
  ): Promise<GoodsReceipt> {
    const route = `POST /api/v1/goods-receipts/${id}/reverse`
    const resultId = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const receipt = await transaction.selectFrom("goods_receipts").select([
        "id", "purchase_order_id", "business_number", "status",
      ]).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .forUpdate().executeTakeFirst()
      if (!receipt) {
        throw new AppError(404, "GOODS_RECEIPT_NOT_FOUND", "Goods receipt not found.")
      }
      if (receipt.status !== "completed") {
        throw new AppError(409, "GOODS_RECEIPT_ALREADY_REVERSED", "Goods receipt is reversed.")
      }
      const order = await transaction.selectFrom("purchase_orders").select("id")
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", receipt.purchase_order_id).forUpdate().executeTakeFirstOrThrow()
      const items = await transaction.selectFrom("goods_receipt_items as receipt_item")
        .innerJoin("purchase_order_items as order_item", "order_item.id",
          "receipt_item.purchase_order_item_id")
        .innerJoin("inventory_balances as balance", (join) => join
          .onRef("balance.tenant_id", "=", "receipt_item.tenant_id")
          .onRef("balance.product_id", "=", "receipt_item.product_id"))
        .innerJoin("products as product", "product.id", "receipt_item.product_id")
        .select([
          "receipt_item.product_id", "receipt_item.received_quantity",
          "receipt_item.accepted_unit_cost_cents", "receipt_item.stock_movement_id",
          "order_item.id as order_item_id", "order_item.received_quantity as order_received",
          "balance.on_hand", "balance.reserved", "balance.average_unit_cost_cents",
          "product.current_cost_cents",
        ]).where("receipt_item.tenant_id", "=", user.tenantId)
        .where("receipt_item.goods_receipt_id", "=", id)
        .orderBy("receipt_item.product_id").forUpdate().execute()
      const occurredAt = new Date()
      for (const item of items) {
        const latest = await transaction.selectFrom("stock_movements").select("id")
          .where("tenant_id", "=", user.tenantId)
          .where("product_id", "=", item.product_id)
          .orderBy("occurred_at", "desc").orderBy("id", "desc").executeTakeFirst()
        if (!latest || latest.id !== item.stock_movement_id) {
          throw new AppError(
            409,
            "RECEIPT_REVERSAL_HAS_LATER_MOVEMENTS",
            "A receipt cannot be reversed after later stock movements.",
            { productId: item.product_id },
          )
        }
        const quantity = Number(item.received_quantity)
        const currentOnHand = Number(item.on_hand)
        const reserved = Number(item.reserved)
        const newOnHand = currentOnHand - quantity
        if (newOnHand < reserved) {
          throw new AppError(
            409,
            "INSUFFICIENT_STOCK_FOR_RECEIPT_REVERSAL",
            "Current stock cannot support this receipt reversal.",
            { productId: item.product_id },
          )
        }
        const currentAverage = item.average_unit_cost_cents === null
          ? null : Number(item.average_unit_cost_cents)
        const acceptedCost = Number(item.accepted_unit_cost_cents)
        const restoredAverage = newOnHand === 0 || currentAverage === null
          ? null
          : ((currentOnHand * currentAverage) - (quantity * acceptedCost)) / newOnHand
        if (restoredAverage !== null && restoredAverage < -0.000001) {
          throw new AppError(
            409,
            "RECEIPT_REVERSAL_COST_CONFLICT",
            "Inventory cost cannot be restored safely.",
            { productId: item.product_id },
          )
        }
        const roundedAverage = restoredAverage === null
          ? null : Math.max(0, Math.round(restoredAverage * 1_000_000) / 1_000_000)
        await transaction.updateTable("inventory_balances").set({
          on_hand: newOnHand,
          average_unit_cost_cents: roundedAverage,
          version: sql`version + 1`,
          updated_at: occurredAt,
        }).where("tenant_id", "=", user.tenantId)
          .where("product_id", "=", item.product_id).execute()
        await transaction.updateTable("purchase_order_items").set({
          received_quantity: Number(item.order_received) - quantity,
        }).where("tenant_id", "=", user.tenantId)
          .where("id", "=", item.order_item_id).execute()
        const movement = await transaction.insertInto("stock_movements").values({
          tenant_id: user.tenantId,
          product_id: item.product_id,
          movement_type: "negative_adjustment",
          quantity: -quantity,
          resulting_on_hand: newOnHand,
          resulting_reserved: reserved,
          unit_cost_snapshot_cents: acceptedCost,
          source_type: "goods_receipt_reversal",
          source_id: id,
          source_reference: receipt.business_number,
          reason,
          actor_user_id: user.id,
          occurred_at: occurredAt,
          reversal_of_id: item.stock_movement_id,
        }).returning("id").executeTakeFirstOrThrow()
        await recordInventoryTracking(transaction, {
          tenantId: user.tenantId,
          productId: item.product_id,
          movementId: movement.id,
          movementType: "negative_adjustment",
          quantity: -quantity,
          oldOnHand: currentOnHand,
          newOnHand,
          reserved,
          occurredAt,
        })
        const restoredCost = roundedAverage === null ? null : Math.round(roundedAverage)
        if (restoredCost !== item.current_cost_cents) {
          await transaction.updateTable("products").set({
            current_cost_cents: restoredCost,
            cost_source: restoredCost === null ? null : "moving_average",
            updated_by: user.id,
            updated_at: occurredAt,
            version: sql`version + 1`,
          }).where("tenant_id", "=", user.tenantId)
            .where("id", "=", item.product_id).execute()
          await transaction.insertInto("product_cost_history").values({
            tenant_id: user.tenantId,
            product_id: item.product_id,
            old_cost_cents: item.current_cost_cents,
            new_cost_cents: restoredCost,
            source: restoredCost === null ? null : "moving_average",
            actor_id: user.id,
            reason,
            effective_at: occurredAt,
          }).execute()
        }
      }
      const remaining = await transaction.selectFrom("purchase_order_items")
        .select([
          (expression) => expression.fn.sum<string>("received_quantity").as("received"),
          (expression) => expression.fn.sum<string>("ordered_quantity").as("ordered"),
        ]).where("tenant_id", "=", user.tenantId)
        .where("purchase_order_id", "=", order.id).executeTakeFirstOrThrow()
      const received = Number(remaining.received)
      const ordered = Number(remaining.ordered)
      await transaction.updateTable("purchase_orders").set({
        status: received === 0
          ? "submitted" : received < ordered ? "partially_received" : "received",
        updated_at: occurredAt,
        version: sql`version + 1`,
      }).where("id", "=", order.id).execute()
      await transaction.updateTable("goods_receipts").set({
        status: "reversed",
        reversed_by: user.id,
        reversed_at: occurredAt,
        reversal_reason: reason,
      }).where("id", "=", id).execute()
      await recordDomainEvent(transaction, user, {
        action: "goods_receipt.reversed",
        entityType: "goods_receipt",
        entityId: id,
        reason,
        after: { status: "reversed" },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return id
    })
    const receipt = await this.getGoodsReceipt(user.tenantId, resultId)
    if (!receipt) throw new Error("Reversed goods receipt could not be reloaded")
    return receipt
  }

  async getGoodsReceipt(tenantId: string, id: string): Promise<GoodsReceipt | null> {
    const row = await this.database.selectFrom("goods_receipts as receipt")
      .innerJoin("users as actor", "actor.id", "receipt.received_by")
      .leftJoin("users as reverser", "reverser.id", "receipt.reversed_by")
      .select([
        "receipt.id", "receipt.business_number", "receipt.purchase_order_id",
        "receipt.status", "receipt.supplier_document_reference", "actor.id as actor_id",
        "actor.name as actor_name", "receipt.received_at", "reverser.id as reverser_id",
        "reverser.name as reverser_name", "receipt.reversed_at", "receipt.reversal_reason",
      ]).where("receipt.tenant_id", "=", tenantId).where("receipt.id", "=", id)
      .executeTakeFirst()
    if (!row) return null
    const items = await this.database.selectFrom("goods_receipt_items").selectAll()
      .where("tenant_id", "=", tenantId).where("goods_receipt_id", "=", id)
      .orderBy("id").execute()
    return {
      id: row.id,
      businessNumber: Number(row.business_number),
      purchaseOrderId: row.purchase_order_id,
      status: row.status,
      supplierDocumentReference: row.supplier_document_reference,
      receivedBy: { id: row.actor_id, name: row.actor_name },
      receivedAt: row.received_at.toISOString(),
      reversedBy: row.reverser_id && row.reverser_name
        ? { id: row.reverser_id, name: row.reverser_name }
        : null,
      reversedAt: row.reversed_at?.toISOString() ?? null,
      reversalReason: row.reversal_reason,
      items: items.map((item) => ({
        id: item.id,
        purchaseOrderItemId: item.purchase_order_item_id,
        productId: item.product_id,
        receivedQuantity: Number(item.received_quantity),
        acceptedUnitCostCents: Number(item.accepted_unit_cost_cents),
        lotReference: item.lot_reference,
        stockMovementId: item.stock_movement_id,
      })),
    }
  }
}
