export const PERMISSIONS = [
  { key: "dashboard.view", group: "Telas", label: "Dashboard" },
  { key: "pos.view", group: "Telas", label: "Frente de Caixa" },
  { key: "orders.view", group: "Telas", label: "Ordens" },
  { key: "cash.view", group: "Telas", label: "Caixa" },
  { key: "intelligence.view", group: "Telas", label: "Inteligência" },
  { key: "inventory.view", group: "Telas", label: "Inventário" },
  { key: "history.view", group: "Telas", label: "Histórico" },
  { key: "customers.view", group: "Telas", label: "Clientes" },
] as const

export type PermissionKey = (typeof PERMISSIONS)[number]["key"]

const permissionKeys = new Set<string>(PERMISSIONS.map(({ key }) => key))

export function isPermissionKey(value: string): value is PermissionKey {
  return permissionKeys.has(value)
}
