import { loadConfig } from "../../config/env.js"
import { sql } from "kysely"
import { hashPassword } from "../../modules/auth/password.js"
import { generateForecasts } from "../../modules/intelligence/forecast-engine.js"
import { generateRecommendations } from "../../modules/intelligence/recommendation-engine.js"
import type { PaymentMethod, ProductType } from "../types.js"
import { createDatabase } from "../client.js"

const DEMO_VERSION = "dlara-demo-v1"
const ANALYTICS_VERSION = "dlara-demo-analytics-v2"
const TENANT_SLUG = "dlara"

interface ProductSeed {
  key: string
  category: string
  unit: string
  sku: string
  barcode: string | null
  type: ProductType
  name: string
  description: string
  minimumStock: number
  priceCents: number
  costCents: number
  finalStock: number | null
}

interface SalePlan {
  monthIndex: number
  sequence: number
  completedAt: Date
  productKey: string
  quantity: number
  paymentMethod: PaymentMethod
  kind: "completed" | "cancelled" | "partially_returned"
}

function requiredPassword(): string {
  const value = process.env.SEED_DEMO_PASSWORD?.trim()
  if (!value) throw new Error("SEED_DEMO_PASSWORD is required")
  if (value.length < 12 || value.length > 128) {
    throw new Error("SEED_DEMO_PASSWORD must contain between 12 and 128 characters")
  }
  return value
}

function monthStart(offset: number): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1, 12))
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function daysInMonth(value: Date): number {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
  ).getUTCDate()
}

const productSeeds: ProductSeed[] = [
  {
    key: "jogo-cama",
    category: "Cama",
    unit: "Unidade",
    sku: "DEMO-CAMA-001",
    barcode: "7890000000011",
    type: "finished_product",
    name: "Jogo de Cama Casal",
    description: "Conjunto de cama casal com quatro peças.",
    minimumStock: 8,
    priceCents: 18_990,
    costCents: 9_500,
    finalStock: 35,
  },
  {
    key: "edredom",
    category: "Cama",
    unit: "Unidade",
    sku: "DEMO-CAMA-002",
    barcode: "7890000000028",
    type: "finished_product",
    name: "Edredom Queen",
    description: "Edredom queen dupla face.",
    minimumStock: 6,
    priceCents: 25_900,
    costCents: 14_000,
    finalStock: 18,
  },
  {
    key: "travesseiro",
    category: "Cama",
    unit: "Unidade",
    sku: "DEMO-CAMA-003",
    barcode: "7890000000035",
    type: "finished_product",
    name: "Travesseiro Nasa",
    description: "Travesseiro viscoelástico.",
    minimumStock: 8,
    priceCents: 8_990,
    costCents: 4_200,
    finalStock: 4,
  },
  {
    key: "protetor",
    category: "Cama",
    unit: "Unidade",
    sku: "DEMO-CAMA-004",
    barcode: "7890000000042",
    type: "finished_product",
    name: "Protetor de Colchão",
    description: "Protetor impermeável para colchão casal.",
    minimumStock: 5,
    priceCents: 7_990,
    costCents: 3_800,
    finalStock: 0,
  },
  {
    key: "toalhas",
    category: "Banho",
    unit: "Unidade",
    sku: "DEMO-BANHO-001",
    barcode: "7890000000059",
    type: "finished_product",
    name: "Kit Toalha de Banho 4 Peças",
    description: "Kit com duas toalhas de banho e duas de rosto.",
    minimumStock: 10,
    priceCents: 12_990,
    costCents: 6_500,
    finalStock: 25,
  },
  {
    key: "manta",
    category: "Cama",
    unit: "Unidade",
    sku: "DEMO-CAMA-005",
    barcode: "7890000000066",
    type: "finished_product",
    name: "Manta de Microfibra",
    description: "Manta leve de microfibra.",
    minimumStock: 12,
    priceCents: 6_990,
    costCents: 3_200,
    finalStock: 60,
  },
  {
    key: "tapete",
    category: "Decoração",
    unit: "Unidade",
    sku: "DEMO-DECOR-001",
    barcode: "7890000000073",
    type: "finished_product",
    name: "Tapete Sala 300x320",
    description: "Tapete de sala tamanho grande.",
    minimumStock: 5,
    priceCents: 34_900,
    costCents: 19_000,
    finalStock: 7,
  },
  {
    key: "embalagem",
    category: "Embalagens",
    unit: "Unidade",
    sku: "DEMO-EMB-001",
    barcode: "7890000000080",
    type: "packaging",
    name: "Embalagem para Presente",
    description: "Embalagem decorativa para presente.",
    minimumStock: 30,
    priceCents: 500,
    costCents: 150,
    finalStock: 100,
  },
  {
    key: "tecido",
    category: "Matéria-prima",
    unit: "Metro",
    sku: "DEMO-MP-001",
    barcode: null,
    type: "raw_material",
    name: "Tecido Percal",
    description: "Tecido percal vendido por metro.",
    minimumStock: 25,
    priceCents: 2_990,
    costCents: 1_500,
    finalStock: 120.5,
  },
  {
    key: "enchimento",
    category: "Matéria-prima",
    unit: "Quilograma",
    sku: "DEMO-MP-002",
    barcode: null,
    type: "raw_material",
    name: "Enchimento de Fibra",
    description: "Fibra siliconada para enchimento.",
    minimumStock: 10,
    priceCents: 2_500,
    costCents: 1_200,
    finalStock: 50,
  },
  {
    key: "bordado",
    category: "Serviços",
    unit: "Unidade",
    sku: "DEMO-SERV-001",
    barcode: null,
    type: "service",
    name: "Personalização com Bordado",
    description: "Personalização de peças com bordado.",
    minimumStock: 0,
    priceCents: 4_500,
    costCents: 1_500,
    finalStock: null,
  },
  {
    key: "bainha",
    category: "Serviços",
    unit: "Unidade",
    sku: "DEMO-SERV-002",
    barcode: null,
    type: "service",
    name: "Ajuste de Bainha",
    description: "Ajuste e acabamento de bainha.",
    minimumStock: 0,
    priceCents: 3_000,
    costCents: 800,
    finalStock: null,
  },
]

const saleProductKeys = [
  "jogo-cama",
  "edredom",
  "travesseiro",
  "protetor",
  "toalhas",
  "manta",
  "tapete",
  "embalagem",
]
const paymentMethods: PaymentMethod[] = ["cash", "pix", "credit", "debit"]
const salePlans: SalePlan[] = []

for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
  const month = monthStart(monthIndex - 12)
  for (let sequence = 0; sequence < 6; sequence += 1) {
    const completedAt = new Date(Date.UTC(
      month.getUTCFullYear(),
      month.getUTCMonth(),
      4 + (sequence * 4),
      15 + (sequence % 4),
      10,
    ))
    const isCancelled = monthIndex === 3 && sequence === 5
    const isReturned = monthIndex === 10 && sequence === 4
    salePlans.push({
      monthIndex,
      sequence,
      completedAt,
      productKey: saleProductKeys[(monthIndex + sequence) % saleProductKeys.length]
        ?? "jogo-cama",
      quantity: isReturned ? 2 : 1 + ((monthIndex + sequence) % 3),
      paymentMethod: paymentMethods[(monthIndex + sequence) % paymentMethods.length]
        ?? "cash",
      kind: isCancelled
        ? "cancelled"
        : isReturned ? "partially_returned" : "completed",
    })
  }
}

const config = loadConfig()
if (config.nodeEnv === "production") {
  throw new Error("The demo seed cannot run in production")
}
const demoPassword = requiredPassword()
const passwordHash = await hashPassword(demoPassword)
const database = createDatabase(config)

try {
  const seeded = await database.transaction().execute(async (transaction) => {
    const tenant = await transaction.selectFrom("tenants").select(["id", "name"])
      .where("slug", "=", TENANT_SLUG).where("archived_at", "is", null)
      .executeTakeFirstOrThrow()
    const marker = await transaction.selectFrom("audit_events").select("id")
      .where("tenant_id", "=", tenant.id)
      .where("action", "=", "demo.seed.completed")
      .where("reason", "=", DEMO_VERSION)
      .executeTakeFirst()

    async function ensureUser(input: {
      name: string
      email: string
      phone: string
      role: "admin" | "funcionario"
    }): Promise<string> {
      const existing = await transaction.selectFrom("users").select("id")
        .where("tenant_id", "=", tenant.id)
        .where("email", "=", input.email)
        .where("archived_at", "is", null)
        .executeTakeFirst()
      if (existing) {
        await transaction.updateTable("users").set({
          name: input.name,
          phone: input.phone,
          password_hash: passwordHash,
          role: input.role,
          status: "active",
          updated_at: new Date(),
        }).where("id", "=", existing.id).execute()
        return existing.id
      }
      const created = await transaction.insertInto("users").values({
        tenant_id: tenant.id,
        name: input.name,
        email: input.email,
        phone: input.phone,
        password_hash: passwordHash,
        role: input.role,
        status: "active",
        archived_at: null,
      }).returning("id").executeTakeFirstOrThrow()
      return created.id
    }

    const demoAdminId = await ensureUser({
      name: "Administrador Demo",
      email: "demo.admin@dlara.local",
      phone: "(81) 99999-1000",
      role: "admin",
    })
    const anaId = await ensureUser({
      name: "Ana Silva",
      email: "ana.silva@dlara.local",
      phone: "(81) 99999-1001",
      role: "funcionario",
    })
    const carlosId = await ensureUser({
      name: "Carlos Oliveira",
      email: "carlos.oliveira@dlara.local",
      phone: "(81) 99999-1002",
      role: "funcionario",
    })

    if (marker) {
      return {
        tenantId: tenant.id,
        adminId: demoAdminId,
        inserted: false,
      }
    }

    const categoryIds = new Map<string, string>()
    for (const name of [
      "Cama",
      "Banho",
      "Decoração",
      "Embalagens",
      "Matéria-prima",
      "Serviços",
    ]) {
      const existing = await transaction.selectFrom("categories").select("id")
        .where("tenant_id", "=", tenant.id).where("name", "=", name)
        .where("archived_at", "is", null).executeTakeFirst()
      const id = existing?.id ?? (await transaction.insertInto("categories").values({
        tenant_id: tenant.id,
        parent_id: null,
        name,
        active: true,
        created_by: demoAdminId,
        updated_by: demoAdminId,
        archived_at: null,
      }).returning("id").executeTakeFirstOrThrow()).id
      categoryIds.set(name, id)
    }

    const unitIds = new Map<string, string>()
    for (const unit of [
      { name: "Unidade", abbreviation: "un", fractional: false, scale: 0 },
      { name: "Metro", abbreviation: "m", fractional: true, scale: 3 },
      { name: "Quilograma", abbreviation: "kg", fractional: true, scale: 3 },
    ]) {
      const existing = await transaction.selectFrom("units").select("id")
        .where("tenant_id", "=", tenant.id).where("name", "=", unit.name)
        .where("archived_at", "is", null).executeTakeFirst()
      const id = existing?.id ?? (await transaction.insertInto("units").values({
        tenant_id: tenant.id,
        name: unit.name,
        abbreviation: unit.abbreviation,
        allows_fractional: unit.fractional,
        quantity_scale: unit.scale,
        active: true,
        created_by: demoAdminId,
        updated_by: demoAdminId,
        archived_at: null,
      }).returning("id").executeTakeFirstOrThrow()).id
      unitIds.set(unit.name, id)
    }

    const netSoldByProduct = new Map<string, number>()
    for (const plan of salePlans) {
      const netQuantity = plan.kind === "cancelled"
        ? 0
        : plan.kind === "partially_returned" ? plan.quantity - 1 : plan.quantity
      netSoldByProduct.set(
        plan.productKey,
        (netSoldByProduct.get(plan.productKey) ?? 0) + netQuantity,
      )
    }

    const products = new Map<string, {
      id: string
      name: string
      type: ProductType
      unit: string
      priceCents: number
      costCents: number
      initialStock: number | null
      finalStock: number | null
    }>()
    for (const product of productSeeds) {
      const created = await transaction.insertInto("products").values({
        tenant_id: tenant.id,
        category_id: categoryIds.get(product.category) ?? "",
        unit_id: unitIds.get(product.unit) ?? "",
        sku: product.sku,
        barcode: product.barcode,
        type: product.type,
        name: product.name,
        description: product.description,
        active: true,
        minimum_stock: product.minimumStock,
        current_price_cents: product.priceCents,
        current_cost_cents: product.costCents,
        cost_source: product.type === "service" ? "estimated" : "moving_average",
        created_by: demoAdminId,
        updated_by: demoAdminId,
        archived_at: null,
        created_at: monthStart(-13),
      }).returning("id").executeTakeFirstOrThrow()
      const initialStock = product.finalStock === null
        ? null
        : product.finalStock + (netSoldByProduct.get(product.key) ?? 0)
      products.set(product.key, {
        id: created.id,
        name: product.name,
        type: product.type,
        unit: product.unit === "Unidade"
          ? "un" : product.unit === "Metro" ? "m" : "kg",
        priceCents: product.priceCents,
        costCents: product.costCents,
        initialStock,
        finalStock: product.finalStock,
      })
      await transaction.insertInto("product_price_history").values({
        tenant_id: tenant.id,
        product_id: created.id,
        old_price_cents: null,
        new_price_cents: product.priceCents,
        actor_id: demoAdminId,
        reason: "Carga de demonstração",
        effective_at: monthStart(-13),
      }).execute()
      await transaction.insertInto("product_cost_history").values({
        tenant_id: tenant.id,
        product_id: created.id,
        old_cost_cents: null,
        new_cost_cents: product.costCents,
        source: product.type === "service" ? "estimated" : "moving_average",
        actor_id: demoAdminId,
        reason: "Carga de demonstração",
        effective_at: monthStart(-13),
      }).execute()
      if (initialStock !== null && product.finalStock !== null) {
        await transaction.insertInto("inventory_balances").values({
          tenant_id: tenant.id,
          product_id: created.id,
          on_hand: product.finalStock,
          reserved: 0,
          average_unit_cost_cents: product.costCents,
        }).execute()
        await transaction.insertInto("stock_movements").values({
          tenant_id: tenant.id,
          product_id: created.id,
          movement_type: "positive_adjustment",
          quantity: initialStock,
          resulting_on_hand: initialStock,
          resulting_reserved: 0,
          unit_cost_snapshot_cents: product.costCents,
          source_type: "demo_seed",
          source_id: null,
          source_reference: DEMO_VERSION,
          reason: "Estoque inicial da carga de demonstração",
          actor_user_id: demoAdminId,
          occurred_at: monthStart(-13),
          reversal_of_id: null,
        }).execute()
      }
    }

    const customerNames = [
      "Mariana Pereira",
      "Rafael Ribeiro",
      "Juliana Santos",
      "Fernanda Lima",
      "Paulo Henrique",
      "Camila Rocha",
      "Lucas Almeida",
      "Beatriz Costa",
      "Renata Gomes",
      "André Martins",
      "Patrícia Souza",
      "Gustavo Carvalho",
      "Larissa Melo",
      "Thiago Nunes",
      "Débora Alves",
      "Felipe Araújo",
      "Aline Ferreira",
      "Roberto Barros",
      "Isabela Monteiro",
      "Eduardo Freitas",
    ]
    const customers = await transaction.insertInto("customers").values(
      customerNames.map((name, index) => ({
        tenant_id: tenant.id,
        name,
        email: `${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replaceAll(" ", ".")}@exemplo.local`,
        phone: `(81) 98888-${String(1000 + index)}`,
        notes: index % 4 === 0 ? "Cliente recorrente da carga de demonstração." : "",
        status: index === 19 ? "inactive" as const : "active" as const,
        consent_at: new Date(),
        anonymized_at: null,
        created_by: anaId,
        updated_by: anaId,
        archived_at: null,
        created_at: monthStart(-12 + (index % 10)),
      })),
    ).returning(["id", "name"]).execute()

    const principalRegister = await transaction.insertInto("cash_registers").values({
      tenant_id: tenant.id,
      code: "DEMO-01",
      name: "Caixa Principal",
      active: true,
      created_by: demoAdminId,
      updated_by: demoAdminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const auxiliaryRegister = await transaction.insertInto("cash_registers").values({
      tenant_id: tenant.id,
      code: "DEMO-02",
      name: "Caixa Auxiliar",
      active: true,
      created_by: demoAdminId,
      updated_by: demoAdminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    await transaction.insertInto("cash_register_assignments").values([
      {
        tenant_id: tenant.id,
        user_id: anaId,
        cash_register_id: principalRegister.id,
        valid_from: monthStart(-12),
        valid_until: null,
        assigned_by: demoAdminId,
        reason: "Atribuição para testes da D'lara",
      },
      {
        tenant_id: tenant.id,
        user_id: carlosId,
        cash_register_id: auxiliaryRegister.id,
        valid_from: monthStart(-12),
        valid_until: null,
        assigned_by: demoAdminId,
        reason: "Atribuição para testes da D'lara",
      },
    ]).execute()

    const currentStock = new Map<string, number>()
    for (const [key, product] of products) {
      if (product.initialStock !== null) currentStock.set(key, product.initialStock)
    }
    const maxSale = await transaction.selectFrom("sales")
      .select((expression) => expression.fn.max("business_number").as("number"))
      .where("tenant_id", "=", tenant.id).executeTakeFirst()
    let saleNumber = Number(maxSale?.number ?? 0)
    let returnNumber = 0

    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const month = monthStart(monthIndex - 12)
      const openedAt = new Date(Date.UTC(
        month.getUTCFullYear(), month.getUTCMonth(), 2, 11,
      ))
      const closedAt = new Date(Date.UTC(
        month.getUTCFullYear(), month.getUTCMonth(), 27, 21,
      ))
      const session = await transaction.insertInto("cash_sessions").values({
        tenant_id: tenant.id,
        cash_register_id: principalRegister.id,
        opening_operator_id: anaId,
        opened_at: openedAt,
        opening_amount_cents: 20_000,
        status: "closed",
        closing_operator_id: anaId,
        closed_at: closedAt,
        closing_note: "Fechamento da carga de demonstração",
        created_at: openedAt,
        updated_at: closedAt,
      }).returning("id").executeTakeFirstOrThrow()
      const expected = new Map<PaymentMethod, number>([
        ["cash", 20_000],
        ["credit", 0],
        ["debit", 0],
        ["pix", 0],
      ])
      await transaction.insertInto("cash_movements").values({
        tenant_id: tenant.id,
        cash_session_id: session.id,
        movement_type: "opening",
        payment_method: "cash",
        amount_cents: 20_000,
        source_type: "cash_session",
        source_id: session.id,
        actor_user_id: anaId,
        reason: "Abertura da carga de demonstração",
        occurred_at: openedAt,
        reversal_of_id: null,
      }).execute()

      for (const plan of salePlans.filter((item) => item.monthIndex === monthIndex)) {
        const product = products.get(plan.productKey)
        if (!product) throw new Error(`Missing seeded product ${plan.productKey}`)
        saleNumber += 1
        const gross = product.priceCents * plan.quantity
        const discount = plan.kind === "partially_returned"
          ? 0 : saleNumber % 5 === 0 ? Math.round(gross * 0.05) : 0
        const net = gross - discount
        const returnedAmount = plan.kind === "partially_returned"
          ? product.priceCents : 0
        const customer = customers[(saleNumber - 1) % customers.length]
        if (!customer) throw new Error("Missing seeded customer")
        const cancelledAt = plan.kind === "cancelled"
          ? new Date(plan.completedAt.getTime() + (30 * 60 * 1_000)) : null
        const sale = await transaction.insertInto("sales").values({
          tenant_id: tenant.id,
          business_number: saleNumber,
          status: plan.kind,
          customer_id: customer.id,
          customer_name_snapshot: customer.name,
          operator_id: plan.sequence % 2 === 0 ? anaId : carlosId,
          cash_session_id: session.id,
          gross_amount_cents: gross,
          discount_amount_cents: discount,
          net_amount_cents: net,
          returned_amount_cents: returnedAmount,
          change_amount_cents: 0,
          business_date: dateOnly(plan.completedAt),
          completed_at: plan.completedAt,
          cancelled_by: plan.kind === "cancelled" ? anaId : null,
          cancelled_at: cancelledAt,
          cancellation_reason: plan.kind === "cancelled"
            ? "Cancelamento de demonstração" : null,
          created_at: plan.completedAt,
          updated_at: cancelledAt ?? plan.completedAt,
        }).returning("id").executeTakeFirstOrThrow()
        const saleItem = await transaction.insertInto("sale_items").values({
          tenant_id: tenant.id,
          sale_id: sale.id,
          product_id: product.id,
          product_name_snapshot: product.name,
          product_type_snapshot: product.type,
          unit_abbreviation_snapshot: product.unit,
          quantity: plan.quantity,
          unit_price_cents: product.priceCents,
          gross_amount_cents: gross,
          allocated_discount_cents: discount,
          net_amount_cents: net,
          unit_cost_snapshot_cents: product.costCents,
          returned_quantity: plan.kind === "partially_returned" ? 1 : 0,
          returned_net_amount_cents: returnedAmount,
          service_order_id: null,
          service_order_previous_column_id: null,
          created_at: plan.completedAt,
        }).returning("id").executeTakeFirstOrThrow()
        await transaction.insertInto("payments").values({
          tenant_id: tenant.id,
          sale_id: sale.id,
          payment_method: plan.paymentMethod,
          amount_cents: net,
          effective_amount_cents: net,
          installments: plan.paymentMethod === "credit" ? 2 : null,
          status: plan.kind === "cancelled" ? "reversed"
            : plan.kind === "partially_returned" ? "partially_refunded" : "completed",
          external_reference: `DEMO-${String(saleNumber)}`,
          created_at: plan.completedAt,
        }).execute()
        await transaction.insertInto("cash_movements").values({
          tenant_id: tenant.id,
          cash_session_id: session.id,
          movement_type: "sale",
          payment_method: plan.paymentMethod,
          amount_cents: net,
          source_type: "sale",
          source_id: sale.id,
          actor_user_id: plan.sequence % 2 === 0 ? anaId : carlosId,
          reason: "Venda da carga de demonstração",
          occurred_at: plan.completedAt,
          reversal_of_id: null,
        }).execute()
        expected.set(plan.paymentMethod, (expected.get(plan.paymentMethod) ?? 0) + net)

        const beforeSale = currentStock.get(plan.productKey)
        if (beforeSale === undefined) throw new Error("Missing seeded inventory balance")
        const afterSale = beforeSale - plan.quantity
        const saleMovement = await transaction.insertInto("stock_movements").values({
          tenant_id: tenant.id,
          product_id: product.id,
          movement_type: "sale",
          quantity: -plan.quantity,
          resulting_on_hand: afterSale,
          resulting_reserved: 0,
          unit_cost_snapshot_cents: product.costCents,
          source_type: "sale",
          source_id: sale.id,
          source_reference: String(saleNumber),
          reason: "Venda da carga de demonstração",
          actor_user_id: plan.sequence % 2 === 0 ? anaId : carlosId,
          occurred_at: plan.completedAt,
          reversal_of_id: null,
        }).returning("id").executeTakeFirstOrThrow()
        currentStock.set(plan.productKey, afterSale)

        if (plan.kind === "cancelled") {
          const reversalAt = cancelledAt ?? plan.completedAt
          const reversedStock = afterSale + plan.quantity
          await transaction.insertInto("stock_movements").values({
            tenant_id: tenant.id,
            product_id: product.id,
            movement_type: "sale_reversal",
            quantity: plan.quantity,
            resulting_on_hand: reversedStock,
            resulting_reserved: 0,
            unit_cost_snapshot_cents: product.costCents,
            source_type: "sale",
            source_id: sale.id,
            source_reference: String(saleNumber),
            reason: "Cancelamento da carga de demonstração",
            actor_user_id: anaId,
            occurred_at: reversalAt,
            reversal_of_id: saleMovement.id,
          }).execute()
          await transaction.insertInto("cash_movements").values({
            tenant_id: tenant.id,
            cash_session_id: session.id,
            movement_type: "sale_reversal",
            payment_method: plan.paymentMethod,
            amount_cents: -net,
            source_type: "sale",
            source_id: sale.id,
            actor_user_id: anaId,
            reason: "Cancelamento da carga de demonstração",
            occurred_at: reversalAt,
            reversal_of_id: null,
          }).execute()
          expected.set(plan.paymentMethod, (expected.get(plan.paymentMethod) ?? 0) - net)
          currentStock.set(plan.productKey, reversedStock)
        }

        if (plan.kind === "partially_returned") {
          returnNumber += 1
          const returnedAt = new Date(plan.completedAt.getTime() + (24 * 60 * 60 * 1_000))
          const returnedStock = afterSale + 1
          const returnMovement = await transaction.insertInto("stock_movements").values({
            tenant_id: tenant.id,
            product_id: product.id,
            movement_type: "return",
            quantity: 1,
            resulting_on_hand: returnedStock,
            resulting_reserved: 0,
            unit_cost_snapshot_cents: product.costCents,
            source_type: "sale_return",
            source_id: sale.id,
            source_reference: String(returnNumber),
            reason: "Devolução parcial da carga de demonstração",
            actor_user_id: anaId,
            occurred_at: returnedAt,
            reversal_of_id: null,
          }).returning("id").executeTakeFirstOrThrow()
          const saleReturn = await transaction.insertInto("sale_returns").values({
            tenant_id: tenant.id,
            business_number: returnNumber,
            sale_id: sale.id,
            operator_id: anaId,
            cash_session_id: session.id,
            reason: "Devolução parcial da carga de demonstração",
            total_amount_cents: returnedAmount,
            status: "completed",
            completed_at: returnedAt,
            created_at: returnedAt,
          }).returning("id").executeTakeFirstOrThrow()
          await transaction.insertInto("sale_return_items").values({
            tenant_id: tenant.id,
            return_id: saleReturn.id,
            sale_item_id: saleItem.id,
            quantity: 1,
            amount_cents: returnedAmount,
            restock: true,
            unit_cost_snapshot_cents: product.costCents,
            stock_movement_id: returnMovement.id,
            created_at: returnedAt,
          }).execute()
          await transaction.insertInto("sale_return_refunds").values({
            tenant_id: tenant.id,
            return_id: saleReturn.id,
            payment_method: plan.paymentMethod,
            amount_cents: returnedAmount,
            external_reference: `DEMO-RETURN-${String(returnNumber)}`,
            created_at: returnedAt,
          }).execute()
          await transaction.insertInto("cash_movements").values({
            tenant_id: tenant.id,
            cash_session_id: session.id,
            movement_type: "return",
            payment_method: plan.paymentMethod,
            amount_cents: -returnedAmount,
            source_type: "sale_return",
            source_id: saleReturn.id,
            actor_user_id: anaId,
            reason: "Devolução parcial da carga de demonstração",
            occurred_at: returnedAt,
            reversal_of_id: null,
          }).execute()
          expected.set(
            plan.paymentMethod,
            (expected.get(plan.paymentMethod) ?? 0) - returnedAmount,
          )
          currentStock.set(plan.productKey, returnedStock)
        }
      }

      await transaction.insertInto("cash_close_counts").values(
        paymentMethods.map((method) => ({
          tenant_id: tenant.id,
          cash_session_id: session.id,
          payment_method: method,
          expected_amount_cents: expected.get(method) ?? 0,
          counted_amount_cents: expected.get(method) ?? 0,
          difference_cents: 0,
          actor_user_id: anaId,
          counted_at: closedAt,
        })),
      ).execute()
    }

    const openTime = new Date(Date.now() - (2 * 60 * 60 * 1_000))
    const openSession = await transaction.insertInto("cash_sessions").values({
      tenant_id: tenant.id,
      cash_register_id: principalRegister.id,
      opening_operator_id: anaId,
      opened_at: openTime,
      opening_amount_cents: 20_000,
      status: "open",
      closing_operator_id: null,
      closed_at: null,
      closing_note: null,
      created_at: openTime,
      updated_at: openTime,
    }).returning("id").executeTakeFirstOrThrow()
    await transaction.insertInto("cash_movements").values([
      {
        tenant_id: tenant.id,
        cash_session_id: openSession.id,
        movement_type: "opening",
        payment_method: "cash",
        amount_cents: 20_000,
        source_type: "cash_session",
        source_id: openSession.id,
        actor_user_id: anaId,
        reason: "Abertura para testes",
        occurred_at: openTime,
        reversal_of_id: null,
      },
      {
        tenant_id: tenant.id,
        cash_session_id: openSession.id,
        movement_type: "supply",
        payment_method: "cash",
        amount_cents: 5_000,
        source_type: "demo_seed",
        source_id: null,
        actor_user_id: anaId,
        reason: "Suprimento para testes",
        occurred_at: new Date(openTime.getTime() + (20 * 60 * 1_000)),
        reversal_of_id: null,
      },
      {
        tenant_id: tenant.id,
        cash_session_id: openSession.id,
        movement_type: "withdrawal",
        payment_method: "cash",
        amount_cents: -2_500,
        source_type: "demo_seed",
        source_id: null,
        actor_user_id: anaId,
        reason: "Sangria para testes",
        occurred_at: new Date(openTime.getTime() + (40 * 60 * 1_000)),
        reversal_of_id: null,
      },
    ]).execute()

    for (const [key, product] of products) {
      if (product.initialStock === null || product.finalStock === null) continue
      let opening = product.initialStock
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        const month = monthStart(monthIndex - 12)
        const plans = salePlans.filter(
          (plan) => plan.monthIndex === monthIndex && plan.productKey === key,
        )
        const sold = plans.reduce(
          (total, plan) => total + (
            plan.kind === "cancelled"
              ? 0
              : plan.kind === "partially_returned" ? plan.quantity - 1 : plan.quantity
          ),
          0,
        )
        const closing = opening - sold
        const minutes = daysInMonth(month) * 24 * 60
        const stockoutMinutes = closing <= 0 ? Math.floor(minutes * 0.25) : 0
        await transaction.insertInto("inventory_daily_snapshots").values({
          tenant_id: tenant.id,
          product_id: product.id,
          local_date: dateOnly(month),
          opening,
          received: 0,
          sold,
          returned: plans.some((plan) => plan.kind === "partially_returned") ? 1 : 0,
          adjusted: 0,
          closing,
          reserved: 0,
          in_stock_minutes: minutes - stockoutMinutes,
          stockout_minutes: stockoutMinutes,
          observed_minutes: minutes,
          last_observed_at: new Date(Date.UTC(
            month.getUTCFullYear(), month.getUTCMonth() + 1, 1, 3,
          )),
          complete: true,
        }).execute()
        opening = closing
      }
    }

    const columns = await transaction.selectFrom("service_order_columns")
      .select(["id", "semantic_type", "display_position"])
      .where("tenant_id", "=", tenant.id).where("archived_at", "is", null)
      .orderBy("display_position").execute()
    const openColumns = columns.filter((column) => column.semantic_type === "open")
    const completedColumn = columns.find((column) => column.semantic_type === "completed")
    const cancelledColumn = columns.find((column) => column.semantic_type === "cancelled")
    if (openColumns.length === 0 || !completedColumn || !cancelledColumn) {
      throw new Error("D'lara service-order columns are incomplete")
    }
    const maxOrder = await transaction.selectFrom("service_orders")
      .select((expression) => expression.fn.max("business_number").as("number"))
      .where("tenant_id", "=", tenant.id).executeTakeFirst()
    let orderNumber = Number(maxOrder?.number ?? 0)
    const orderTitles = [
      "Bordado em jogo de toalhas",
      "Ajuste de bainha em cortina",
      "Kit de cama personalizado",
      "Reparo em edredom",
      "Bordado de iniciais",
      "Confecção de almofadas",
      "Ajuste de colcha queen",
      "Personalização para presente",
      "Troca de zíper em capa",
      "Conjunto infantil sob medida",
      "Acabamento em toalhas",
      "Reforma de manta",
    ]
    for (let index = 0; index < orderTitles.length; index += 1) {
      orderNumber += 1
      const createdAt = new Date(Date.now() - ((index + 1) * 24 * 60 * 60 * 1_000))
      const completed = index >= 7 && index <= 9
      const cancelled = index >= 10
      const column = completed
        ? completedColumn : cancelled
          ? cancelledColumn : openColumns[index % openColumns.length] ?? openColumns[0]
      if (!column) throw new Error("Missing service-order column")
      const completedAt = completed
        ? new Date(createdAt.getTime() + (20 * 60 * 60 * 1_000)) : null
      const cancelledAt = cancelled
        ? new Date(createdAt.getTime() + (8 * 60 * 60 * 1_000)) : null
      const customer = customers[index % customers.length]
      if (!customer) throw new Error("Missing seeded customer")
      const order = await transaction.insertInto("service_orders").values({
        tenant_id: tenant.id,
        business_number: orderNumber,
        customer_id: customer.id,
        customer_name_snapshot: customer.name,
        title: orderTitles[index] ?? "Ordem de demonstração",
        description: "Ordem criada para homologação das telas e regras da D'lara.",
        priority: index % 4 === 0 ? "high" : index % 3 === 0 ? "low" : "medium",
        due_at: new Date(createdAt.getTime() + ((index - 4) * 24 * 60 * 60 * 1_000)),
        estimated_value_cents: 4_500 + (index * 1_250),
        final_sale_id: null,
        current_column_id: column.id,
        current_status: completed ? "completed" : cancelled ? "cancelled" : "open",
        responsible_user_id: index % 2 === 0 ? anaId : carlosId,
        completed_at: completedAt,
        cancelled_at: cancelledAt,
        created_by: anaId,
        updated_by: anaId,
        created_at: createdAt,
        updated_at: completedAt ?? cancelledAt ?? createdAt,
      }).returning("id").executeTakeFirstOrThrow()
      await transaction.insertInto("service_order_status_history").values({
        tenant_id: tenant.id,
        service_order_id: order.id,
        previous_column_id: null,
        new_column_id: column.id,
        previous_status: null,
        new_status: completed ? "completed" : cancelled ? "cancelled" : "open",
        actor_user_id: anaId,
        occurred_at: completedAt ?? cancelledAt ?? createdAt,
        reason: "Carga de demonstração",
        metadata: { seedVersion: DEMO_VERSION },
        created_at: completedAt ?? cancelledAt ?? createdAt,
      }).execute()
    }

    for (const [sequenceName, value] of [
      ["sale", saleNumber],
      ["sale_return", returnNumber],
      ["service_order", orderNumber],
    ] as const) {
      await transaction.insertInto("tenant_sequences").values({
        tenant_id: tenant.id,
        sequence_name: sequenceName,
        current_value: value,
      }).onConflict((conflict) => conflict
        .columns(["tenant_id", "sequence_name"])
        .doUpdateSet({ current_value: value, updated_at: new Date() }))
        .execute()
    }

    await transaction.insertInto("audit_events").values({
      tenant_id: tenant.id,
      actor_type: "system",
      actor_id: null,
      action: "demo.seed.completed",
      entity_type: "tenant",
      entity_id: tenant.id,
      request_id: null,
      correlation_id: null,
      source: "system",
      reason: DEMO_VERSION,
      before_json: null,
      after_json: {
        users: 3,
        products: productSeeds.length,
        customers: customers.length,
        sales: salePlans.length,
        serviceOrders: orderTitles.length,
      },
      ip_address: null,
      user_agent: null,
    }).execute()

    return {
      tenantId: tenant.id,
      adminId: demoAdminId,
      inserted: true,
    }
  })

  const yesterday = new Date()
  yesterday.setUTCHours(0, 0, 0, 0)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const observationStart = new Date(yesterday)
  observationStart.setUTCDate(observationStart.getUTCDate() - 119)
  const recentSales = await sql<{
    product_id: string
    business_date: string
    sold: string
    returned: string
  }>`
    SELECT
      item.product_id,
      sale.business_date::text,
      SUM(item.quantity)::text AS sold,
      SUM(item.returned_quantity)::text AS returned
    FROM sale_items AS item
    INNER JOIN sales AS sale
      ON sale.id = item.sale_id
      AND sale.tenant_id = item.tenant_id
    INNER JOIN products AS product
      ON product.id = item.product_id
      AND product.tenant_id = item.tenant_id
    WHERE item.tenant_id = ${seeded.tenantId}::uuid
      AND product.sku LIKE 'DEMO-%'
      AND sale.status <> 'cancelled'
      AND sale.business_date >= ${dateOnly(observationStart)}::date
      AND sale.business_date <= ${dateOnly(yesterday)}::date
    GROUP BY item.product_id, sale.business_date
  `.execute(database)
  const dailyProducts = await database.selectFrom("products as product")
    .innerJoin("inventory_balances as balance", (join) => join
      .onRef("balance.product_id", "=", "product.id")
      .onRef("balance.tenant_id", "=", "product.tenant_id"))
    .select(["product.id", "balance.on_hand"])
    .where("product.tenant_id", "=", seeded.tenantId)
    .where("product.sku", "like", "DEMO-%")
    .where("product.type", "<>", "service")
    .execute()
  for (const product of dailyProducts) {
    const productSales = new Map(
      recentSales.rows
        .filter((row) => row.product_id === product.id)
        .map((row) => [
          row.business_date,
          { sold: Number(row.sold), returned: Number(row.returned) },
        ]),
    )
    const netSold = [...productSales.values()].reduce(
      (total, value) => total + value.sold - value.returned,
      0,
    )
    await database.deleteFrom("inventory_daily_snapshots")
      .where("tenant_id", "=", seeded.tenantId)
      .where("product_id", "=", product.id)
      .where("local_date", ">=", dateOnly(observationStart))
      .where("local_date", "<=", dateOnly(yesterday))
      .execute()
    let opening = Number(product.on_hand) + netSold
    for (
      let date = new Date(observationStart);
      date <= yesterday;
      date.setUTCDate(date.getUTCDate() + 1)
    ) {
      const localDate = dateOnly(date)
      const movement = productSales.get(localDate) ?? { sold: 0, returned: 0 }
      const closing = opening - movement.sold + movement.returned
      await database.insertInto("inventory_daily_snapshots").values({
        tenant_id: seeded.tenantId,
        product_id: product.id,
        local_date: localDate,
        opening,
        received: 0,
        sold: movement.sold,
        returned: movement.returned,
        adjusted: 0,
        closing,
        reserved: 0,
        in_stock_minutes: closing > 0 ? 1_440 : 1_080,
        stockout_minutes: closing > 0 ? 0 : 360,
        observed_minutes: 1_440,
        last_observed_at: new Date(date.getTime() + (24 * 60 * 60 * 1_000)),
        complete: true,
      }).execute()
      opening = closing
    }
  }

  const analyticsMarker = await database.selectFrom("audit_events").select("id")
    .where("tenant_id", "=", seeded.tenantId)
    .where("action", "=", "demo.analytics.completed")
    .where("reason", "=", ANALYTICS_VERSION)
    .executeTakeFirst()
  if (!analyticsMarker) {
    const forecasts = await generateForecasts(database, {
      tenantId: seeded.tenantId,
      actorId: seeded.adminId,
      includeRevenue: true,
    })
    const recommendations = await generateRecommendations(database, {
      tenantId: seeded.tenantId,
      actorId: seeded.adminId,
    })
    await database.insertInto("audit_events").values({
      tenant_id: seeded.tenantId,
      actor_type: "system",
      actor_id: null,
      action: "demo.analytics.completed",
      entity_type: "tenant",
      entity_id: seeded.tenantId,
      request_id: null,
      correlation_id: null,
      source: "system",
      reason: ANALYTICS_VERSION,
      before_json: null,
      after_json: {
        forecastRuns: forecasts.count,
        publishedForecasts: forecasts.publishedCount,
        recommendations: recommendations.count,
      },
      ip_address: null,
      user_agent: null,
    }).execute()
  }

  console.info(seeded.inserted
    ? "D'lara demonstration data was created."
    : "D'lara demonstration data already exists; passwords and analytical inputs were refreshed.")
} finally {
  await database.destroy()
}
