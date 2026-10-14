// 2026-10-13 owner: ORP Lausanne wants every job search on form 716.007
// ("Preuves des recherches personnelles") or typed into Job-Room - the
// tracker lacked half of those fields. Kept optional on each application,
// so old backups still load and a normal entry is still company/role/date.

export type OrpMethod = 'electronic' | 'letter' | 'visit' | 'phone'
export type OrpResult = 'en suspens' | 'entretien' | 'engagement' | 'négatif'

export interface OrpFields {
  address?: string     // Entreprise, adresse
  contact?: string     // Personne contactée, numéro de tél.
  rate?: number        // 100 = à plein temps, else à temps partiel (%)
  method?: OrpMethod   // par lettre / électronique, visite personnelle, par téléphone
  assigned?: boolean   // Assignation ORP
  motif?: string       // Motif (why negative)
  // 2026-10-14 owner: "as many details as possible to reduce kafkaesque
  // bureaucracy push back" - Job-Room's ENTER form, field by field. The old
  // one-line address/contact above still load and are split on display.
  street?: string
  streetNo?: string
  poBox?: string
  postal?: string
  city?: string
  country?: string     // default Schweiz
  contactPerson?: string
  email?: string
  phone?: string
  link?: string        // ad or online application form
  jobroomDone?: string // ISO date it was entered in Job-Room
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
  letter: 'par lettre / électronique',
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

// ── Job-Room's ENTER form (2026-10-14) ──
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/
const PHONE = /(?:\+41|0041|0)\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2}/

// "Bahnhofstrasse 12, 7277 Davos Glaris (GR)" -> parts
export function splitAddress(s: string): { street: string; streetNo: string; postal: string; city: string } {
  const out = { street: '', streetNo: '', postal: '', city: '' }
  const pc = s.match(/\b(\d{4})\s+([^,()]+?)\s*(?:\([A-Z]{2}\))?\s*(?:,|$)/)
  if (pc) { out.postal = pc[1]; out.city = pc[2].trim() }
  const st = s.split(',')[0].trim().match(/^(\D+?)\s+(\d+\s?[a-zA-Z]?)$/)
  if (st && !/^\d{4}$/.test(st[2])) { out.street = st[1].trim(); out.streetNo = st[2].trim() }
  // just a place name ("Lausanne", "Davos (GR)") = the city
  if (!out.city && !out.street && s.trim() && !/\d/.test(s)) out.city = s.replace(/\([A-Z]{2}\)/, '').trim()
  return out
}

export interface JobRoomEntry {
  date: string; method: OrpMethod
  business: string; street: string; streetNo: string; poBox: string; country: string; postal: string; city: string
  contactPerson: string; email: string; phone: string
  jobTitle: string; link: string
  assigned: boolean; fullTime: boolean
  result: 'Vorstellungsgespräch' | 'Noch offen' | 'Anstellung' | 'Absage'
}

// One application as Job-Room wants it - new fields first, old one-liners split as a fallback.
export function jobRoomEntry(a: Application): JobRoomEntry {
  const split = splitAddress(a.address ?? '')
  const contact = a.contact ?? ''
  const email = a.email || contact.match(EMAIL)?.[0] || ''
  const phone = a.phone || contact.match(PHONE)?.[0] || ''
  const person = a.contactPerson || contact.split(',').map(x => x.trim()).find(x => x && !EMAIL.test(x) && !PHONE.test(x)) || ''
  const r = orpResult(a.status)
  return {
    date: swissDate(a.date), method: a.method ?? 'electronic',
    business: a.company, street: a.street || split.street, streetNo: a.streetNo || split.streetNo, poBox: a.poBox ?? '',
    country: a.country || 'Schweiz', postal: a.postal || split.postal, city: a.city || split.city,
    contactPerson: person, email, phone,
    jobTitle: a.role, link: a.link ?? '',
    assigned: !!a.assigned, fullTime: (a.rate ?? 100) >= 100,
    result: r === 'négatif' ? 'Absage' : r === 'engagement' ? 'Anstellung' : r === 'entretien' ? 'Vorstellungsgespräch' : 'Noch offen',
  }
}

export const JR_METHOD: Record<OrpMethod, string> = { electronic: 'Elektronisch', letter: 'Brieflich', visit: 'Persönlich', phone: 'Telefonisch' }

// Required by Job-Room's form - empty ones show amber before you get there.
export function jobRoomMissing(e: JobRoomEntry): string[] {
  return (['date', 'business', 'postal', 'city', 'jobTitle'] as const).filter(k => !e[k])
}
