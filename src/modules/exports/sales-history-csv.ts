import type { PaymentMethod, SaleStatus } from "../../database/types.js"
import type { SaleHistoryRecord } from "../history/types.js"
import { createCsv } from "./csv.js"

const STATUS_LABELS: Record<SaleStatus, string> = {
  completed: "Concluída",
  partially_returned: "Parcialmente devolvida",
  returned: "Devolvida",
  cancelled: "Cancelada",
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Dinheiro",
  credit: "Crédito",
  debit: "Débito",
  pix: "Pix",
}

const DECIMAL_FORMATTER = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
})

function decimal(value: number | null): string {
  return value === null ? "" : DECIMAL_FORMATTER.format(value)
}

function money(cents: number | null): string {
  return cents === null ? "" : decimal(cents / 100)
}

function percentage(rate: number | null): string {
  return rate === null ? "" : decimal(rate * 100)
}

function date(value: string): string {
  const [year, month, day] = value.split("-")
  return year && month && day ? `${day}/${month}/${year}` : value
}

function timestamp(value: string | null, formatter: Intl.DateTimeFormat): string {
  if (!value) return ""
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return formatter.format(parsed).replace(",", "")
}

export function createSalesHistoryCsv(
  sales: SaleHistoryRecord[],
  options: { currency: string; timeZone: string },
): string {
  const timestampFormatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: options.timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
  const headers = [
    "ID da venda",
    "Nº da venda",
    "Status",
    "Data da venda",
    "Concluída em",
    "Cancelada em",
    "Cliente",
    "Operador",
    "Qtd. de itens",
    "Itens",
    "Formas de pagamento",
    "Possui devolução",
    `Valor bruto (${options.currency})`,
    `Desconto (${options.currency})`,
    `Valor devolvido (${options.currency})`,
    `Receita líquida (${options.currency})`,
    `CMV (${options.currency})`,
    `Lucro bruto (${options.currency})`,
    "Margem bruta (%)",
    "Custos completos",
  ]
  const rows = sales.map((sale) => {
    const financial = sale.financial
    return [
      sale.id,
      sale.businessNumber,
      STATUS_LABELS[sale.status],
      date(sale.businessDate),
      timestamp(sale.completedAt, timestampFormatter),
      timestamp(sale.cancelledAt, timestampFormatter),
      sale.customer?.name ?? "Consumidor não identificado",
      sale.operator.name,
      sale.itemCount,
      sale.itemNames.join(" | "),
      sale.paymentMethods.map((method) => PAYMENT_LABELS[method]).join(" | "),
      sale.hasReturns ? "Sim" : "Não",
      money(financial?.grossAmountCents ?? null),
      money(financial?.discountAmountCents ?? null),
      money(financial?.returnedAmountCents ?? null),
      money(financial?.netRevenueCents ?? null),
      money(financial?.cogsCents ?? null),
      money(financial?.grossProfitCents ?? null),
      percentage(financial?.grossMarginRate ?? null),
      financial ? financial.costComplete ? "Sim" : "Não" : "",
    ]
  })
  return createCsv(headers, rows, { delimiter: ";" })
}
