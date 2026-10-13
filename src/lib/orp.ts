// 2026-10-13 owner: ORP Lausanne wants every job search on form 716.007
// ("Preuves des recherches personnelles") or typed into Job-Room - the
// tracker lacked half of those fields. Kept optional on each application,
// so old backups still load and a normal entry is still company/role/date.

export type OrpMethod = 'electronic' | 'visit' | 'phone'
export type OrpResult = 'en suspens' | 'entretien' | 'engagement' | 'négatif'

export interface OrpFields {
  address?: string     // Entreprise, adresse
  contact?: string     // Personne contactée, numéro de tél.
  rate?: number        // 100 = à plein temps, else à temps partiel (%)
  method?: OrpMethod   // par lettre / électronique, visite personnelle, par téléphone
  assigned?: boolean   // Assignation ORP
  motif?: string       // Motif (why negative)
}

export interface Application extends OrpFields {
  id: number; company: string; role: string; date: string; status: string
  cv: string; cover: string; nextDate: string; notes: string
}

export const ORP_DEFAULTS: Required<Pick<OrpFields, 'rate' | 'method'>> = { rate: 100, method: 'electronic' }

// Tracker status -> the 4 result words printed on the ORP form.
export function orpResult(status: string): OrpResult {
  if (status === 'rejected') return 'négatif'
  if (status === 'accepted') return 'engagement'
  if (status === 'interview' || status === 'technical' || status === 'offer') return 'entretien'
  return 'en suspens'
}

export const METHOD_FR: Record<OrpMethod, string> = {
  electronic: 'par lettre / électronique',
  visit: 'visite personnelle',
  phone: 'par téléphone',
}

// "2026-09-19" -> "19.09.2026" (Swiss form date)
export const swissDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}.${m}.${y}` : iso
}

// Applications whose date falls in [from, to] (ISO dates, inclusive), oldest first.
export function inRange(apps: Application[], from: string, to: string): Application[] {
  return apps.filter(a => a.date >= from && a.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
}

export function monthRange(year: number, month1: number): [string, string] {
  const last = new Date(year, month1, 0).getDate()
  const mm = String(month1).padStart(2, '0')
  return [`${year}-${mm}-01`, `${year}-${mm}-${String(last).padStart(2, '0')}`]
}
