const FORMULA_PREFIX = /^[=+\-@\t\r]/

function safeText(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const serialized = typeof value === "string"
    ? value
    : typeof value === "number"
      || typeof value === "boolean"
      || typeof value === "bigint"
      ? String(value)
      : JSON.stringify(value)
  const text = typeof value === "string" ? safeText(serialized) : serialized
  return `"${text.replaceAll("\"", "\"\"")}"`
}

export function createCsv(
  headers: string[],
  rows: unknown[][],
  options: { delimiter?: "," | ";" } = {},
): string {
  const delimiter = options.delimiter ?? ","
  return `\uFEFF${[
    headers.map(csvCell).join(delimiter),
    ...rows.map((row) => row.map(csvCell).join(delimiter)),
  ].join("\r\n")}\r\n`
}
