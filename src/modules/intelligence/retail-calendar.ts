export interface RetailCalendarEvent {
  name: string
  startsOn: string
  endsOn: string
  kind: "season" | "retail" | "holiday"
  source: "brazil-retail-calendar"
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): Date {
  const first = utcDate(year, month, 1)
  const offset = (weekday - first.getUTCDay() + 7) % 7
  return addDays(first, offset + ((nth - 1) * 7))
}

function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = ((19 * a) + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + (2 * e) + (2 * i) - h - k) % 7
  const m = Math.floor((a + (11 * h) + (22 * l)) / 451)
  const month = Math.floor((h + l - (7 * m) + 114) / 31)
  const day = ((h + l - (7 * m) + 114) % 31) + 1
  return utcDate(year, month, day)
}

function event(
  name: string,
  startsOn: Date,
  endsOn: Date,
  kind: RetailCalendarEvent["kind"],
): RetailCalendarEvent {
  return {
    name,
    startsOn: iso(startsOn),
    endsOn: iso(endsOn),
    kind,
    source: "brazil-retail-calendar",
  }
}

export function brazilRetailCalendar(year: number): RetailCalendarEvent[] {
  const easter = easterSunday(year)
  const mothersDay = nthWeekday(year, 5, 0, 2)
  const fathersDay = nthWeekday(year, 8, 0, 2)
  const blackFriday = nthWeekday(year, 11, 5, 4)
  return [
    event("Verão", utcDate(year, 1, 1), utcDate(year, 3, 19), "season"),
    event("Volta às aulas", utcDate(year, 1, 15), utcDate(year, 2, 15), "retail"),
    event("Carnaval", addDays(easter, -49), addDays(easter, -47), "retail"),
    event("Dia do Consumidor", utcDate(year, 3, 8), utcDate(year, 3, 15), "retail"),
    event("Outono", utcDate(year, 3, 20), utcDate(year, 6, 20), "season"),
    event("Período de Páscoa", addDays(easter, -21), easter, "retail"),
    event("Dia das Mães", addDays(mothersDay, -14), mothersDay, "retail"),
    event("Inverno", utcDate(year, 6, 21), utcDate(year, 9, 21), "season"),
    event("Dia dos Namorados", utcDate(year, 6, 1), utcDate(year, 6, 12), "retail"),
    event("Festas Juninas", utcDate(year, 6, 1), utcDate(year, 6, 30), "retail"),
    event("Dia dos Pais", addDays(fathersDay, -14), fathersDay, "retail"),
    event("Primavera", utcDate(year, 9, 22), utcDate(year, 12, 20), "season"),
    event("Independência do Brasil", utcDate(year, 9, 7), utcDate(year, 9, 7), "holiday"),
    event("Dia das Crianças", utcDate(year, 10, 1), utcDate(year, 10, 12), "retail"),
    event("Proclamação da República", utcDate(year, 11, 15), utcDate(year, 11, 15), "holiday"),
    event("Black Friday", addDays(blackFriday, -4), blackFriday, "retail"),
    event("Verão", utcDate(year, 12, 21), utcDate(year, 12, 31), "season"),
    event("Período de Natal", utcDate(year, 12, 1), utcDate(year, 12, 25), "retail"),
    event("Réveillon", utcDate(year, 12, 26), utcDate(year, 12, 31), "retail"),
  ]
}

export function monthEnd(monthStart: string): string {
  const start = new Date(`${monthStart.slice(0, 7)}-01T00:00:00.000Z`)
  return iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)))
}

export function brazilRetailEventsBetween(
  startsOn: string,
  endsOn: string,
): RetailCalendarEvent[] {
  const firstYear = Number(startsOn.slice(0, 4))
  const lastYear = Number(endsOn.slice(0, 4))
  return Array.from({ length: (lastYear - firstYear) + 1 }, (_, index) =>
    brazilRetailCalendar(firstYear + index)
  ).flat().filter((item) => item.startsOn <= endsOn && item.endsOn >= startsOn)
}
