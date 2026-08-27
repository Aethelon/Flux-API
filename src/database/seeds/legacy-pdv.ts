import "dotenv/config"
import { createHash, randomBytes } from "node:crypto"
import { Client } from "pg"
import { hashPassword } from "../../modules/auth/password.js"

type SqlValue = string | number | boolean | Date | null | Record<string, unknown>
type PaymentMethod = "cash" | "credit" | "debit" | "pix"

interface LegacyUser {
  id: string
  user_name: string
  phone: string | null
  user_type: "ADMIN" | "OPERATOR"
  active: boolean
}

interface LegacyCustomer {
  id: string
  active: boolean
  name: string
  phone: string | null
  credit_limit: string
  debt_balance: string
}

interface LegacyProduct {
  id: string
  codigo_barras: string | null
  category: "CAMA" | "MESA" | "BANHO"
  description: string | null
  name: string
  price: string
  quantidade_estoque: number
}

interface LegacyPaymentMethod {
  id: string
  code: string
}

interface LegacyCashSession {
  id: string
  opened_at: Date
  closed_at: Date
  initial_value: string
  status: string
  user_id: string
  review_status: string | null
}

interface LegacyCashTransaction {
  id: string
  description: string | null
  timestamp: Date
  type: string
  value: string
  payment_method_id: string | null
  session_id: string
}

interface LegacyCashReview {
  id: string
  reported_amount: string
  verified_amount: string | null
  payment_method_id: string
  session_id: string
}

interface LegacySale {
  id: string
  customer_id: string
  date_sale: Date
  subtotal: string
  total: string
  cash_session_id: string | null
  created_at: Date
  updated_at: Date
  sale_status: "PENDING" | "PAID" | "CANCELED"
}

interface LegacySaleItem {
  id: string
  product_id: string | null
  quantity: number
  embroidery_id: string | null
  sale_id: string
  description: string
  subtotal: string
  unit_price: string
  is_manual_item: boolean
}

interface LegacyPayment {
  id: string
  amount_paid: string
  change_amount: string
  payment_date: Date
  payment_method_id: string
  sale_id: string
}

interface LegacyEmbroidery {
  id: string
  created_at: Date
  delivery_date: string | null
  description: string
  file_data: number | null
  file_name: string | null
  price: string
  status: "PENDING" | "IN_PRODUCTION" | "PROCESSING" | "COMPLETED" | "CANCELED"
  customer_id: string
  sale_id: string | null
  delivered_at: Date | null
}

interface LegacyLedgerEntry {
  id: string
  customer_id: string
  type: string
  amount: string
  sale_id: string | null
  payment_method_id: string | null
  operator_id: string
  note: string | null
  created_at: Date
  payment_group_id: string | null
  change_amount: string
}

interface LegacyData {
  users: LegacyUser[]
  customers: LegacyCustomer[]
  products: LegacyProduct[]
  paymentMethods: LegacyPaymentMethod[]
  cashSessions: LegacyCashSession[]
  cashTransactions: LegacyCashTransaction[]
  cashReviews: LegacyCashReview[]
  sales: LegacySale[]
  saleItems: LegacySaleItem[]
  payments: LegacyPayment[]
  embroideries: LegacyEmbroidery[]
  ledgerEntries: LegacyLedgerEntry[]
}

interface TargetContext {
  tenantId: string
  adminId: string
  adminName: string
  administratorRoleId: string
  operatorRoleId: string
}

interface PreparedSaleItem {
  source: LegacySaleItem
  productId: string | null
  serviceOrderId: string | null
  serviceOrderPreviousColumnId: string | null
  productType: "finished_product" | "service"
  grossCents: number
  allocatedDiscountCents: number
}

const SOURCE_NAME = "pdv_db_qua"
const IMPORT_ID = deterministicUuid(`${SOURCE_NAME}:import`)
const BATCH_SIZE = 200

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x50
  bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80
  const hex = bytes.toString("hex")
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-")
}

function entityId(entity: string, sourceId: string): string {
  return deterministicUuid(`${SOURCE_NAME}:${entity}:${sourceId}`)
}

function cents(value: string | number | null): number {
  if (value === null) return 0
  const normalized = String(value).trim()
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized)
  if (!match) throw new Error(`Invalid monetary value: ${normalized}`)
  const sign = match[1] === "-" ? -1 : 1
  const whole = Number(match[2])
  const fraction = Number((match[3] ?? "").padEnd(2, "0").slice(0, 2))
  const result = sign * (whole * 100 + fraction)
  if (!Number.isSafeInteger(result)) throw new Error(`Unsafe monetary value: ${normalized}`)
  return result
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR")
}

function manualProductKey(item: LegacySaleItem): string {
  return `${normalized(item.description)}|${String(cents(item.unit_price))}`
}

function paymentMethod(code: string): PaymentMethod {
  switch (code) {
    case "DINHEIRO": return "cash"
    case "CARTAO_DE_CREDITO":
    case "A_PRAZO":
    case "FIADO": return "credit"
    case "CARTAO_DE_DEBITO": return "debit"
    case "PIX": return "pix"
    default: throw new Error(`Unsupported legacy payment method: ${code}`)
  }
}

function businessDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Recife",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  const year = byType.get("year")
  const month = byType.get("month")
  const day = byType.get("day")
  if (!year || !month || !day) throw new Error("Could not derive the business date")
  return [year, month, day].join("-")
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`)
  return `"${value}"`
}

async function insertRows(
  client: Client,
  table: string,
  columns: string[],
  rows: SqlValue[][],
  conflict = "ON CONFLICT DO NOTHING",
): Promise<void> {
  if (rows.length === 0) return
  const tableSql = quoteIdentifier(table)
  const columnsSql = columns.map(quoteIdentifier).join(", ")
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE)
    const values: SqlValue[] = []
    const tuples = batch.map((row) => {
      if (row.length !== columns.length) throw new Error(`Invalid row width for ${table}`)
      const tuple = row.map((value) => {
        values.push(value)
        return `$${String(values.length)}`
      })
      return `(${tuple.join(", ")})`
    })
    await client.query(
      `INSERT INTO ${tableSql} (${columnsSql}) VALUES ${tuples.join(", ")} ${conflict}`,
      values,
    )
  }
}

async function rows<T>(client: Client, query: string): Promise<T[]> {
  return (await client.query(query)).rows as T[]
}

async function loadLegacyData(source: Client): Promise<LegacyData> {
  const users = await rows<LegacyUser>(source, "SELECT id, user_name, phone, user_type, active FROM users ORDER BY id")
  const customers = await rows<LegacyCustomer>(source, "SELECT id, active, name, phone, credit_limit, debt_balance FROM customers ORDER BY id")
  const products = await rows<LegacyProduct>(source, "SELECT id, codigo_barras, category, description, name, price, quantidade_estoque FROM products ORDER BY id")
  const paymentMethods = await rows<LegacyPaymentMethod>(source, "SELECT id, code FROM payment_methods ORDER BY id")
  const cashSessions = await rows<LegacyCashSession>(source, "SELECT id, opened_at, closed_at, initial_value, status, user_id, review_status FROM cash_sessions ORDER BY id")
  const cashTransactions = await rows<LegacyCashTransaction>(source, "SELECT id, description, timestamp, type, value, payment_method_id, session_id FROM cash_transactions ORDER BY id")
  const cashReviews = await rows<LegacyCashReview>(source, "SELECT id, reported_amount, verified_amount, payment_method_id, session_id FROM cash_session_method_reviews ORDER BY id")
  const sales = await rows<LegacySale>(source, "SELECT id, customer_id, date_sale, subtotal, total, cash_session_id, created_at, updated_at, sale_status FROM sales ORDER BY id")
  const saleItems = await rows<LegacySaleItem>(source, "SELECT id, product_id, quantity, embroidery_id, sale_id, description, subtotal, unit_price, is_manual_item FROM sale_item ORDER BY id")
  const payments = await rows<LegacyPayment>(source, "SELECT id, amount_paid, change_amount, payment_date, payment_method_id, sale_id FROM payments ORDER BY id")
  const embroideries = await rows<LegacyEmbroidery>(source, "SELECT id, created_at, delivery_date, description, file_data, file_name, price, status, customer_id, sale_id, delivered_at FROM embroidery ORDER BY id")
  const ledgerEntries = await rows<LegacyLedgerEntry>(source, "SELECT id, customer_id, type, amount, sale_id, payment_method_id, operator_id, note, created_at, payment_group_id, change_amount FROM customer_ledger_entries ORDER BY id")
  return {
    users, customers, products, paymentMethods, cashSessions, cashTransactions,
    cashReviews, sales, saleItems, payments, embroideries, ledgerEntries,
  }
}

async function loadTargetContext(target: Client, tenantSlug: string): Promise<TargetContext> {
  const result = await target.query<{
    tenant_id: string
    admin_id: string
    admin_name: string
    administrator_role_id: string
    operator_role_id: string
  }>(`
    SELECT tenant.id AS tenant_id,
           administrator.id AS admin_id,
           administrator.name AS admin_name,
           administrator_role.id AS administrator_role_id,
           operator_role.id AS operator_role_id
    FROM tenants tenant
    JOIN LATERAL (
      SELECT id, name FROM users
      WHERE tenant_id = tenant.id AND role = 'admin' AND status = 'active'
        AND archived_at IS NULL
      ORDER BY created_at, id LIMIT 1
    ) administrator ON true
    JOIN job_roles administrator_role
      ON administrator_role.tenant_id = tenant.id
      AND administrator_role.system_key = 'administrator'
      AND administrator_role.archived_at IS NULL
    JOIN job_roles operator_role
      ON operator_role.tenant_id = tenant.id
      AND operator_role.system_key = 'operator'
      AND operator_role.archived_at IS NULL
    WHERE tenant.slug = $1 AND tenant.archived_at IS NULL
  `, [tenantSlug])
  const row = result.rows[0]
  if (!row) throw new Error(`Tenant ${tenantSlug} or its administrator/job roles were not found`)
  return {
    tenantId: row.tenant_id,
    adminId: row.admin_id,
    adminName: row.admin_name,
    administratorRoleId: row.administrator_role_id,
    operatorRoleId: row.operator_role_id,
  }
}

async function ensureEmptyTarget(target: Client, context: TargetContext): Promise<void> {
  const marker = await target.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM audit_events WHERE tenant_id = $1 AND action = 'legacy_pdv.import.completed' AND entity_id = $2) AS exists",
    [context.tenantId, IMPORT_ID],
  )
  if (marker.rows[0]?.exists) throw new Error("This legacy dump was already imported")

  const counts = await target.query<Record<string, number>>(`
    SELECT
      (SELECT count(*)::int FROM categories WHERE tenant_id = $1) AS categories,
      (SELECT count(*)::int FROM units WHERE tenant_id = $1) AS units,
      (SELECT count(*)::int FROM products WHERE tenant_id = $1) AS products,
      (SELECT count(*)::int FROM customers WHERE tenant_id = $1) AS customers,
      (SELECT count(*)::int FROM cash_registers WHERE tenant_id = $1) AS cash_registers,
      (SELECT count(*)::int FROM cash_sessions WHERE tenant_id = $1) AS cash_sessions,
      (SELECT count(*)::int FROM sales WHERE tenant_id = $1) AS sales,
      (SELECT count(*)::int FROM service_orders WHERE tenant_id = $1) AS service_orders
  `, [context.tenantId])
  const nonEmpty = Object.entries(counts.rows[0] ?? {}).filter(([, count]) => count !== 0)
  if (nonEmpty.length > 0) {
    throw new Error(`Target tenant is not empty: ${nonEmpty.map(([name, count]) => `${name}=${String(count)}`).join(", ")}`)
  }
}

function allocateDiscount(items: LegacySaleItem[], discountCents: number): Map<string, number> {
  const result = new Map<string, number>()
  const grossCents = items.map((item) => cents(item.subtotal))
  const totalGross = grossCents.reduce((sum, value) => sum + value, 0)
  if (discountCents < 0 || discountCents > totalGross) {
    throw new Error(`Invalid discount allocation: ${String(discountCents)}/${String(totalGross)}`)
  }
  let remaining = discountCents
  items.forEach((item, index) => {
    const gross = grossCents[index] ?? 0
    const allocation = index === items.length - 1
      ? remaining
      : totalGross === 0 ? 0 : Math.min(gross, Math.floor(discountCents * gross / totalGross))
    result.set(item.id, allocation)
    remaining -= allocation
  })
  if (remaining !== 0) throw new Error(`Unallocated discount: ${String(remaining)}`)
  return result
}

async function importLegacy(
  target: Client,
  data: LegacyData,
  context: TargetContext,
): Promise<Record<string, number>> {
  await ensureEmptyTarget(target, context)
  await target.query("BEGIN")
  try {
    const paymentCodeById = new Map(data.paymentMethods.map((method) => [method.id, method.code]))
    const customerId = new Map(data.customers.map((customer) => [customer.id, entityId("customer", customer.id)]))
    const productId = new Map(data.products.map((product) => [product.id, entityId("product", product.id)]))
    const sessionId = new Map(data.cashSessions.map((session) => [session.id, entityId("cash-session", session.id)]))
    const saleId = new Map(data.sales.map((sale) => [sale.id, entityId("sale", sale.id)]))
    const orderId = new Map(data.embroideries.map((order) => [order.id, entityId("service-order", order.id)]))

    const legacyUserId = new Map<string, string>()
    const importedUsers: LegacyUser[] = []
    for (const user of data.users) {
      if (user.user_type === "ADMIN" && normalized(user.user_name) === normalized(context.adminName)) {
        legacyUserId.set(user.id, context.adminId)
      } else {
        const id = entityId("user", user.id)
        legacyUserId.set(user.id, id)
        importedUsers.push(user)
      }
    }
    const lockedPasswordHash = await hashPassword(randomBytes(32).toString("hex"))
    await insertRows(target, "users", [
      "id", "tenant_id", "name", "email", "phone", "password_hash", "role",
      "job_role_id", "status", "created_at", "updated_at", "archived_at",
    ], importedUsers.map((user) => [
      legacyUserId.get(user.id) ?? entityId("user", user.id), context.tenantId,
      user.user_name, `legacy-user-${user.id}@import.invalid`, user.phone,
      lockedPasswordHash, "funcionario", context.operatorRoleId, "inactive",
      new Date(), new Date(), null,
    ]))

    const columns = [
      ["pending", "Pendente", "open", "--color-warning", 0, false],
      ["in-progress", "Em Andamento", "open", "--color-accent", 1, false],
      ["waiting-parts", "Aguardando Peças", "open", "--color-info", 2, false],
      ["completed", "Concluído", "completed", "--color-success", 3, true],
      ["cancelled", "Cancelado", "cancelled", "--color-danger", 4, true],
    ] as const
    const columnId = new Map(columns.map(([key]) => [key, entityId("service-column", key)]))
    await insertRows(target, "service_order_columns", [
      "id", "tenant_id", "label", "semantic_type", "color_token", "display_position",
      "protected", "created_by", "updated_by",
    ], columns.map(([key, label, semanticType, colorToken, position, isProtected]) => [
      columnId.get(key) ?? entityId("service-column", key), context.tenantId, label,
      semanticType, colorToken, position, isProtected, context.adminId, context.adminId,
    ]))

    const categoryDefinitions = [
      ["CAMA", "Cama"], ["MESA", "Mesa"], ["BANHO", "Banho"],
      ["MANUAL", "Itens avulsos importados"],
    ] as const
    const categoryId = new Map(categoryDefinitions.map(([key]) => [key, entityId("category", key)]))
    await insertRows(target, "categories", [
      "id", "tenant_id", "parent_id", "name", "active", "created_by", "updated_by",
    ], categoryDefinitions.map(([key, name]) => [
      categoryId.get(key) ?? entityId("category", key), context.tenantId, null, name,
      true, context.adminId, context.adminId,
    ]))

    const unitId = entityId("unit", "UN")
    await insertRows(target, "units", [
      "id", "tenant_id", "name", "abbreviation", "allows_fractional", "quantity_scale",
      "active", "created_by", "updated_by",
    ], [[unitId, context.tenantId, "Unidade", "UN", false, 0, true, context.adminId, context.adminId]])

    await insertRows(target, "products", [
      "id", "tenant_id", "category_id", "unit_id", "sku", "barcode", "type", "name",
      "description", "active", "minimum_stock", "current_price_cents", "current_cost_cents",
      "cost_source", "created_by", "updated_by",
    ], data.products.map((product) => [
      productId.get(product.id) ?? entityId("product", product.id), context.tenantId,
      categoryId.get(product.category) ?? entityId("category", product.category), unitId,
      `LEGACY-P-${product.id}`, product.codigo_barras?.trim() || null, "finished_product",
      product.name, product.description ?? "", true, 0, cents(product.price), null, null,
      context.adminId, context.adminId,
    ]))

    const manualItemsByKey = new Map<string, LegacySaleItem>()
    for (const item of data.saleItems.filter((candidate) => candidate.is_manual_item)) {
      manualItemsByKey.set(manualProductKey(item), item)
    }
    const manualProductId = new Map(
      [...manualItemsByKey.keys()].map((key) => [key, entityId("manual-product", key)]),
    )
    await insertRows(target, "products", [
      "id", "tenant_id", "category_id", "unit_id", "sku", "barcode", "type", "name",
      "description", "active", "minimum_stock", "current_price_cents", "current_cost_cents",
      "cost_source", "created_by", "updated_by",
    ], [...manualItemsByKey.entries()].map(([key, item]) => [
      manualProductId.get(key) ?? entityId("manual-product", key), context.tenantId,
      categoryId.get("MANUAL") ?? entityId("category", "MANUAL"), unitId,
      `LEGACY-M-${createHash("sha1").update(key).digest("hex").slice(0, 16)}`, null,
      "finished_product", item.description, `Item avulso importado do PDV legado.`, false,
      0, cents(item.unit_price), null, null, context.adminId, context.adminId,
    ]))

    const allProductIds = [
      ...data.products.map((product) => productId.get(product.id) ?? entityId("product", product.id)),
      ...manualProductId.values(),
    ]
    await insertRows(target, "inventory_balances", [
      "tenant_id", "product_id", "on_hand", "reserved", "average_unit_cost_cents",
    ], [
      ...data.products.map((product) => [
        context.tenantId, productId.get(product.id) ?? entityId("product", product.id),
        product.quantidade_estoque, 0, null,
      ] as SqlValue[]),
      ...[...manualProductId.values()].map((id) => [context.tenantId, id, 0, 0, null] as SqlValue[]),
    ])
    await insertRows(target, "product_price_history", [
      "id", "tenant_id", "product_id", "old_price_cents", "new_price_cents", "actor_id", "reason",
    ], [
      ...data.products.map((product) => [
        entityId("product-price", product.id), context.tenantId,
        productId.get(product.id) ?? entityId("product", product.id), null,
        cents(product.price), context.adminId, "Preço importado do PDV legado.",
      ] as SqlValue[]),
      ...[...manualItemsByKey.entries()].map(([key, item]) => [
        entityId("manual-product-price", key), context.tenantId,
        manualProductId.get(key) ?? entityId("manual-product", key), null,
        cents(item.unit_price), context.adminId, "Preço importado de item avulso do PDV legado.",
      ] as SqlValue[]),
    ])
    await insertRows(target, "stock_movements", [
      "id", "tenant_id", "product_id", "movement_type", "quantity", "resulting_on_hand",
      "resulting_reserved", "unit_cost_snapshot_cents", "source_type", "source_id",
      "source_reference", "reason", "actor_user_id", "occurred_at", "reversal_of_id",
    ], data.products.filter((product) => product.quantidade_estoque > 0).map((product) => [
      entityId("stock-opening", product.id), context.tenantId,
      productId.get(product.id) ?? entityId("product", product.id), "positive_adjustment",
      product.quantidade_estoque, product.quantidade_estoque, 0, null, "legacy_import", null,
      product.id, "Saldo inicial importado do PDV legado.", context.adminId, new Date(), null,
    ]))

    await insertRows(target, "customers", [
      "id", "tenant_id", "name", "email", "phone", "notes", "status", "consent_at",
      "anonymized_at", "created_by", "updated_by",
    ], data.customers.map((customer) => [
      customerId.get(customer.id) ?? entityId("customer", customer.id), context.tenantId,
      customer.name, null, customer.phone,
      `Importado do PDV legado (ID ${customer.id}). Limite original: R$ ${customer.credit_limit}; saldo devedor original: R$ ${customer.debt_balance}.`,
      customer.active ? "active" : "inactive", null, null, context.adminId, context.adminId,
    ]))

    const registerId = entityId("cash-register", "legacy")
    const syntheticRegisterId = entityId("cash-register", "missing-session")
    await insertRows(target, "cash_registers", [
      "id", "tenant_id", "code", "name", "active", "created_by", "updated_by",
    ], [
      [registerId, context.tenantId, "LEGADO", "Caixa legado", false, context.adminId, context.adminId],
      [syntheticRegisterId, context.tenantId, "LEGADO-SEM-SESSAO", "Importação sem sessão de caixa", false, context.adminId, context.adminId],
    ])

    await insertRows(target, "cash_sessions", [
      "id", "tenant_id", "cash_register_id", "opening_operator_id", "opened_at",
      "opening_amount_cents", "status", "closing_operator_id", "closed_at", "closing_note",
      "created_at", "updated_at",
    ], data.cashSessions.map((session) => {
      const operator = legacyUserId.get(session.user_id) ?? context.adminId
      return [
        sessionId.get(session.id) ?? entityId("cash-session", session.id), context.tenantId,
        registerId, operator, session.opened_at, cents(session.initial_value), "closed", operator,
        session.closed_at, `Importado do PDV legado; status original: ${session.status}/${session.review_status ?? "sem revisão"}.`,
        session.opened_at, session.closed_at,
      ]
    }))

    const salesWithoutSession = data.sales.filter((sale) => sale.cash_session_id === null)
    const syntheticSessionId = entityId("cash-session", "missing-session")
    if (salesWithoutSession.length > 0) {
      const timestamps = salesWithoutSession.map((sale) => sale.date_sale.getTime())
      const openedAt = new Date(Math.min(...timestamps))
      const closedAt = new Date(Math.max(...timestamps) + 1_000)
      await insertRows(target, "cash_sessions", [
        "id", "tenant_id", "cash_register_id", "opening_operator_id", "opened_at",
        "opening_amount_cents", "status", "closing_operator_id", "closed_at", "closing_note",
        "created_at", "updated_at",
      ], [[
        syntheticSessionId, context.tenantId, syntheticRegisterId, context.adminId, openedAt,
        0, "closed", context.adminId, closedAt,
        `${String(salesWithoutSession.length)} vendas legadas não possuíam sessão de caixa.`,
        openedAt, closedAt,
      ]])
    }

    const statusColumn = (order: LegacyEmbroidery): { id: string; status: "open" | "completed" | "cancelled" } => {
      if (order.status === "COMPLETED") return { id: columnId.get("completed") ?? entityId("service-column", "completed"), status: "completed" }
      if (order.status === "CANCELED") return { id: columnId.get("cancelled") ?? entityId("service-column", "cancelled"), status: "cancelled" }
      if (order.status === "IN_PRODUCTION" || order.status === "PROCESSING") return { id: columnId.get("in-progress") ?? entityId("service-column", "in-progress"), status: "open" }
      return { id: columnId.get("pending") ?? entityId("service-column", "pending"), status: "open" }
    }
    await insertRows(target, "service_orders", [
      "id", "tenant_id", "business_number", "customer_id", "customer_name_snapshot",
      "title", "description", "priority", "due_at", "estimated_value_cents", "final_sale_id",
      "current_column_id", "current_status", "responsible_user_id", "completed_at",
      "cancelled_at", "created_by", "updated_by", "created_at", "updated_at",
    ], data.embroideries.map((order) => {
      const column = statusColumn(order)
      const customer = data.customers.find((candidate) => candidate.id === order.customer_id)
      if (!customer) throw new Error(`Missing customer for embroidery ${order.id}`)
      const description = order.file_name
        ? `${order.description}\nArquivo legado não importado: ${order.file_name}`
        : order.description
      const terminalAt = order.delivered_at ?? order.created_at
      return [
        orderId.get(order.id) ?? entityId("service-order", order.id), context.tenantId,
        Number(order.id), customerId.get(order.customer_id) ?? entityId("customer", order.customer_id),
        customer.name, `Bordado #${order.id}`, description, "medium",
        order.delivery_date, cents(order.price), null, column.id, column.status, null,
        column.status === "completed" ? terminalAt : null,
        column.status === "cancelled" ? terminalAt : null,
        context.adminId, context.adminId, order.created_at, terminalAt,
      ]
    }))
    await insertRows(target, "service_order_status_history", [
      "id", "tenant_id", "service_order_id", "previous_column_id", "new_column_id",
      "previous_status", "new_status", "actor_user_id", "occurred_at", "reason", "metadata",
      "created_at",
    ], data.embroideries.map((order) => {
      const column = statusColumn(order)
      const occurredAt = order.delivered_at ?? order.created_at
      return [
        entityId("service-order-history", order.id), context.tenantId,
        orderId.get(order.id) ?? entityId("service-order", order.id), null, column.id, null,
        column.status, context.adminId, occurredAt, "Status importado do PDV legado.",
        { legacyId: order.id, legacyStatus: order.status }, occurredAt,
      ]
    }))

    const saleItemsBySale = new Map<string, LegacySaleItem[]>()
    for (const item of data.saleItems) {
      const current = saleItemsBySale.get(item.sale_id) ?? []
      current.push(item)
      saleItemsBySale.set(item.sale_id, current)
    }
    const preparedItems = new Map<string, PreparedSaleItem[]>()
    for (const sale of data.sales.filter((candidate) => candidate.sale_status !== "PENDING")) {
      const items = saleItemsBySale.get(sale.id) ?? []
      const grossCents = items.reduce((sum, item) => sum + cents(item.subtotal), 0)
      const discount = grossCents - cents(sale.total)
      const allocations = allocateDiscount(items, discount)
      preparedItems.set(sale.id, items.map((item) => {
        const linkedOrderId = item.embroidery_id ? orderId.get(item.embroidery_id) ?? null : null
        const linkedProductId = item.is_manual_item
          ? manualProductId.get(manualProductKey(item)) ?? null
          : item.product_id ? productId.get(item.product_id) ?? null : null
        if (!linkedProductId && !linkedOrderId) throw new Error(`Unmapped sale item ${item.id}`)
        return {
          source: item,
          productId: linkedProductId,
          serviceOrderId: linkedOrderId,
          serviceOrderPreviousColumnId: linkedOrderId
            ? columnId.get("completed") ?? entityId("service-column", "completed")
            : null,
          productType: linkedOrderId ? "service" : "finished_product",
          grossCents: cents(item.subtotal),
          allocatedDiscountCents: allocations.get(item.id) ?? 0,
        }
      }))
    }

    const cashSessionById = new Map(data.cashSessions.map((session) => [session.id, session]))
    const paymentsBySale = new Map<string, LegacyPayment[]>()
    for (const payment of data.payments) {
      const current = paymentsBySale.get(payment.sale_id) ?? []
      current.push(payment)
      paymentsBySale.set(payment.sale_id, current)
    }
    const importedSales = data.sales.filter((sale) => sale.sale_status !== "PENDING")
    await insertRows(target, "sales", [
      "id", "tenant_id", "business_number", "status", "customer_id", "customer_name_snapshot",
      "operator_id", "cash_session_id", "gross_amount_cents", "discount_amount_cents",
      "net_amount_cents", "returned_amount_cents", "change_amount_cents", "business_date",
      "completed_at", "cancelled_by", "cancelled_at", "cancellation_reason", "created_at", "updated_at",
    ], importedSales.map((sale) => {
      const items = preparedItems.get(sale.id) ?? []
      const gross = items.reduce((sum, item) => sum + item.grossCents, 0)
      const net = cents(sale.total)
      const sourceSession = sale.cash_session_id ? cashSessionById.get(sale.cash_session_id) : null
      const operator = sourceSession ? legacyUserId.get(sourceSession.user_id) ?? context.adminId : context.adminId
      const customer = data.customers.find((candidate) => candidate.id === sale.customer_id)
      const cancelled = sale.sale_status === "CANCELED"
      return [
        saleId.get(sale.id) ?? entityId("sale", sale.id), context.tenantId, Number(sale.id),
        cancelled ? "cancelled" : "completed",
        customerId.get(sale.customer_id) ?? entityId("customer", sale.customer_id),
        customer?.name ?? null, operator,
        sale.cash_session_id ? sessionId.get(sale.cash_session_id) ?? syntheticSessionId : syntheticSessionId,
        gross, gross - net, net, 0,
        (paymentsBySale.get(sale.id) ?? []).reduce((sum, payment) => sum + cents(payment.change_amount), 0),
        businessDate(sale.date_sale), sale.date_sale, cancelled ? operator : null,
        cancelled ? sale.updated_at : null,
        cancelled ? "Cancelada no PDV legado." : null, sale.created_at, sale.updated_at,
      ]
    }))

    await insertRows(target, "sale_items", [
      "id", "tenant_id", "sale_id", "product_id", "product_name_snapshot",
      "product_type_snapshot", "unit_abbreviation_snapshot", "quantity", "unit_price_cents",
      "gross_amount_cents", "allocated_discount_cents", "net_amount_cents",
      "unit_cost_snapshot_cents", "returned_quantity", "returned_net_amount_cents",
      "service_order_id", "service_order_previous_column_id", "created_at",
    ], importedSales.flatMap((sale) => (preparedItems.get(sale.id) ?? []).map((item) => [
      entityId("sale-item", item.source.id), context.tenantId,
      saleId.get(sale.id) ?? entityId("sale", sale.id), item.productId,
      item.source.description, item.productType, "UN", item.source.quantity,
      cents(item.source.unit_price), item.grossCents, item.allocatedDiscountCents,
      item.grossCents - item.allocatedDiscountCents, null, 0, 0,
      item.serviceOrderId, item.serviceOrderPreviousColumnId, sale.created_at,
    ])))

    await insertRows(target, "payments", [
      "id", "tenant_id", "sale_id", "payment_method", "amount_cents",
      "effective_amount_cents", "installments", "status", "external_reference", "created_at",
    ], data.payments.flatMap((payment) => {
      const sale = data.sales.find((candidate) => candidate.id === payment.sale_id)
      if (!sale || sale.sale_status === "PENDING") return []
      const code = paymentCodeById.get(payment.payment_method_id)
      if (!code) throw new Error(`Missing payment method ${payment.payment_method_id}`)
      const method = paymentMethod(code)
      const cancelled = sale.sale_status === "CANCELED"
      return [[
        entityId("payment", payment.id), context.tenantId,
        saleId.get(payment.sale_id) ?? entityId("sale", payment.sale_id), method,
        cents(payment.amount_paid), cancelled ? 0 : cents(payment.amount_paid) - cents(payment.change_amount),
        method === "credit" ? 1 : null, cancelled ? "reversed" : "completed",
        `PDV legado: ${code}`, payment.payment_date,
      ]]
    }))

    for (const order of data.embroideries.filter((candidate) => candidate.sale_id !== null)) {
      const linkedSale = order.sale_id ? data.sales.find((sale) => sale.id === order.sale_id) : null
      if (!linkedSale || linkedSale.sale_status === "PENDING") continue
      await target.query(
        "UPDATE service_orders SET final_sale_id = $1, updated_at = GREATEST(updated_at, $2) WHERE tenant_id = $3 AND id = $4",
        [saleId.get(linkedSale.id), linkedSale.updated_at, context.tenantId, orderId.get(order.id)],
      )
    }

    const mappedReviews = new Map<string, { session: string; method: PaymentMethod; expected: number; counted: number; actor: string; at: Date }>()
    for (const review of data.cashReviews) {
      const code = paymentCodeById.get(review.payment_method_id)
      if (!code) throw new Error(`Missing review payment method ${review.payment_method_id}`)
      const method = paymentMethod(code)
      const session = cashSessionById.get(review.session_id)
      if (!session) throw new Error(`Missing reviewed cash session ${review.session_id}`)
      const key = `${review.session_id}:${method}`
      const current = mappedReviews.get(key)
      const reported = cents(review.reported_amount)
      const verified = review.verified_amount === null ? reported : cents(review.verified_amount)
      mappedReviews.set(key, {
        session: review.session_id,
        method,
        expected: (current?.expected ?? 0) + reported,
        counted: (current?.counted ?? 0) + verified,
        actor: legacyUserId.get(session.user_id) ?? context.adminId,
        at: session.closed_at,
      })
    }
    await insertRows(target, "cash_close_counts", [
      "id", "tenant_id", "cash_session_id", "payment_method", "expected_amount_cents",
      "counted_amount_cents", "difference_cents", "actor_user_id", "counted_at",
    ], [...mappedReviews.entries()].map(([key, review]) => [
      entityId("cash-close-count", key), context.tenantId,
      sessionId.get(review.session) ?? entityId("cash-session", review.session), review.method,
      review.expected, review.counted, review.counted - review.expected, review.actor, review.at,
    ]))

    const movementType = (type: string): string => {
      switch (type) {
        case "OPENING": return "opening"
        case "SALE":
        case "RECEIVABLE_PAYMENT": return "sale"
        case "SUPPLEMENT": return "supply"
        case "SANGRIA":
        case "CHANGE": return "withdrawal"
        case "REFUND":
        case "EXCHANGE_RETURN": return "return"
        default: throw new Error(`Unsupported cash transaction type: ${type}`)
      }
    }
    await insertRows(target, "cash_movements", [
      "id", "tenant_id", "cash_session_id", "movement_type", "payment_method",
      "amount_cents", "source_type", "source_id", "actor_user_id", "reason",
      "occurred_at", "reversal_of_id", "created_at",
    ], data.cashTransactions.filter((movement) => cents(movement.value) !== 0).map((movement) => {
      const session = cashSessionById.get(movement.session_id)
      if (!session) throw new Error(`Missing cash session ${movement.session_id}`)
      const code = movement.payment_method_id ? paymentCodeById.get(movement.payment_method_id) : "DINHEIRO"
      if (!code) throw new Error(`Missing movement payment method ${String(movement.payment_method_id)}`)
      return [
        entityId("cash-movement", movement.id), context.tenantId,
        sessionId.get(movement.session_id) ?? entityId("cash-session", movement.session_id),
        movementType(movement.type), paymentMethod(code), cents(movement.value), "legacy_import",
        null, legacyUserId.get(session.user_id) ?? context.adminId,
        movement.description ?? `Movimento ${movement.type} importado do PDV legado.`,
        movement.timestamp, null, movement.timestamp,
      ]
    }))

    await insertRows(target, "audit_events", [
      "id", "tenant_id", "occurred_at", "actor_type", "actor_id", "action",
      "entity_type", "entity_id", "request_id", "correlation_id", "source", "reason",
      "before_json", "after_json", "ip_address", "user_agent",
    ], data.ledgerEntries.map((entry) => {
      const code = entry.payment_method_id ? paymentCodeById.get(entry.payment_method_id) ?? null : null
      return [
        entityId("ledger-audit", entry.id), context.tenantId, entry.created_at, "user",
        legacyUserId.get(entry.operator_id) ?? context.adminId,
        "legacy.customer_ledger_entry.imported", "customer_ledger_entry",
        entityId("ledger", entry.id), null, null, "migration",
        "Lançamento de crediário preservado do PDV legado.", null,
        {
          legacyId: entry.id,
          customerId: customerId.get(entry.customer_id) ?? null,
          type: entry.type,
          amountCents: cents(entry.amount),
          changeAmountCents: cents(entry.change_amount),
          legacySaleId: entry.sale_id,
          paymentMethod: code,
          paymentGroupId: entry.payment_group_id,
          note: entry.note,
        }, null, null,
      ]
    }))

    const maxSaleNumber = Math.max(0, ...importedSales.map((sale) => Number(sale.id)))
    const maxOrderNumber = Math.max(0, ...data.embroideries.map((order) => Number(order.id)))
    await insertRows(target, "tenant_sequences", [
      "tenant_id", "sequence_name", "current_value", "updated_at",
    ], [
      [context.tenantId, "sale", maxSaleNumber, new Date()],
      [context.tenantId, "sale_return", 0, new Date()],
      [context.tenantId, "service_order", maxOrderNumber, new Date()],
    ], "ON CONFLICT (tenant_id, sequence_name) DO UPDATE SET current_value = EXCLUDED.current_value, updated_at = EXCLUDED.updated_at")

    const summary: Record<string, number> = {
      users: importedUsers.length,
      customers: data.customers.length,
      catalogProducts: data.products.length,
      manualProducts: manualProductId.size,
      inventoryBalances: allProductIds.length,
      cashSessions: data.cashSessions.length + (salesWithoutSession.length > 0 ? 1 : 0),
      cashMovements: data.cashTransactions.filter((movement) => cents(movement.value) !== 0).length,
      cashCloseCounts: mappedReviews.size,
      sales: importedSales.length,
      skippedPendingSales: data.sales.length - importedSales.length,
      saleItems: importedSales.reduce((sum, sale) => sum + (preparedItems.get(sale.id)?.length ?? 0), 0),
      payments: data.payments.filter((payment) => data.sales.some((sale) => sale.id === payment.sale_id && sale.sale_status !== "PENDING")).length,
      serviceOrders: data.embroideries.length,
      ledgerAuditEvents: data.ledgerEntries.length,
      skippedAttachments: data.embroideries.filter((order) => order.file_data !== null).length,
    }
    await insertRows(target, "audit_events", [
      "id", "tenant_id", "occurred_at", "actor_type", "actor_id", "action",
      "entity_type", "entity_id", "request_id", "correlation_id", "source", "reason",
      "before_json", "after_json", "ip_address", "user_agent",
    ], [[
      entityId("audit", "completed"), context.tenantId, new Date(), "system", null,
      "legacy_pdv.import.completed", "legacy_pdv_import", IMPORT_ID, null, null, "migration",
      "Importação transacional do PDV legado concluída.", null, summary, null, null,
    ]])

    await target.query("COMMIT")
    return summary
  } catch (error) {
    await target.query("ROLLBACK")
    throw error
  }
}

async function main(): Promise<void> {
  const legacyDatabaseUrl = required("LEGACY_DATABASE_URL")
  const targetDatabaseUrl = required("DATABASE_URL")
  if (legacyDatabaseUrl === targetDatabaseUrl) throw new Error("Source and target databases must differ")
  const tenantSlug = process.env.LEGACY_IMPORT_TENANT_SLUG?.trim() || "dlara"
  const apply = process.env.LEGACY_IMPORT_APPLY === "true"
  const source = new Client({ connectionString: legacyDatabaseUrl, application_name: "flux-legacy-source" })
  const target = new Client({ connectionString: targetDatabaseUrl, application_name: "flux-legacy-target" })
  try {
    await Promise.all([source.connect(), target.connect()])
    const [data, context] = await Promise.all([
      loadLegacyData(source),
      loadTargetContext(target, tenantSlug),
    ])
    const analysis = {
      mode: apply ? "apply" : "dry-run",
      tenantSlug,
      users: data.users.length,
      customers: data.customers.length,
      products: data.products.length,
      manualProductVariants: new Set(data.saleItems.filter((item) => item.is_manual_item).map(manualProductKey)).size,
      cashSessions: data.cashSessions.length,
      sales: data.sales.length,
      pendingSalesSkipped: data.sales.filter((sale) => sale.sale_status === "PENDING").length,
      saleItems: data.saleItems.length,
      payments: data.payments.length,
      serviceOrders: data.embroideries.length,
      ledgerEntriesPreservedAsAudit: data.ledgerEntries.length,
      attachmentsWithoutTargetEquivalent: data.embroideries.filter((order) => order.file_data !== null).length,
      deferredPaymentsMappedToCredit: data.payments.filter((payment) => {
        const code = data.paymentMethods.find((method) => method.id === payment.payment_method_id)?.code
        return code === "A_PRAZO" || code === "FIADO"
      }).length,
      salesWithoutCashSessionUsingSyntheticSession: data.sales.filter((sale) => sale.cash_session_id === null).length,
    }
    console.info(JSON.stringify(analysis, null, 2))
    if (!apply) {
      console.info("Dry-run only. Set LEGACY_IMPORT_APPLY=true to import in one transaction.")
      return
    }
    const summary = await importLegacy(target, data, context)
    console.info(JSON.stringify({ imported: true, summary }, null, 2))
  } finally {
    await Promise.all([source.end().catch(() => {}), target.end().catch(() => {})])
  }
}

await main()
