// 2026-10-13 owner: "I already have trouble entering data" - a job ad's text,
// copied from Job-Room (or any job site) and pasted in, fills the entry.
// Job-Room's robots.txt says "Do not crawl Job Adverts", so nothing is
// fetched: only text the person copied from the page they already opened.

export interface ParsedAd {
  role: string
  company: string
  address: string
  contact: string
  rate?: number
  housing: boolean
  notes: string
}

const lines = (t: string) => t.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
const RATE = /(\d{2,3})\s*%/

// value on the line after a label, e.g. "Workload" -> "100%"
function after(ls: string[], labels: RegExp): string {
  const i = ls.findIndex(l => labels.test(l))
  return i >= 0 && i + 1 < ls.length ? ls[i + 1] : ''
}

export function parseAd(text: string): ParsedAd {
  const ls = lines(text)
  const first = ls[0] ?? ''
  const role = first.replace(RATE, '').replace(/\s+-?\s*$/, '').trim()

  // "Company: Role" line (Job-Room repeats the title that way), else "Join the X team"
  let company = ''
  const esc = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const colon = role ? ls.find(l => new RegExp(`^(.+?):\\s*${esc}`, 'i').test(l)) : undefined
  if (colon) company = colon.split(':')[0].trim()
  if (!company) company = text.match(/Join the (.+?) team/i)?.[1] ?? ''
  if (!company) company = text.match(/^(.+?\b(?:AG|SA|GmbH|Sàrl|Sagl|S\.A\.|Ltd))\b/m)?.[1] ?? ''

  const address = after(ls, /^(Work location|Arbeitsort|Lieu de travail)$/i) || after(ls, /^(Workplace|Arbeitsplatz)$/i)
  const workload = after(ls, /^(Workload|Pensum|Taux d'activité)$/i) || first
  const rateMatch = workload.match(RATE)

  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? ''
  const phone = text.match(/(?:\+41|0)\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2}/)?.[0] ?? ''
  const person = after(ls, /^(Contact|Kontakt|Contact person|Kontaktperson)$/i)
  const contact = [person, email, phone].filter(Boolean).join(', ')

  // staff housing offered - the thing that decides whether a resort job is possible
  const housing = /staff (apartment|accommodation|room|housing)|Personal(wohnung|zimmer|unterkunft)|logement (du personnel|fourni)|Unterkunft/i.test(text)

  const start = after(ls, /^(Employment start|Stellenantritt|Entrée en fonction)$/i)
  const duration = after(ls, /^(Employment duration|Anstellungsdauer|Durée de l'engagement)$/i)
  const notes = [housing ? 'Staff housing offered' : '', start && `Start: ${start}`, duration].filter(Boolean).join(' · ')

  return { role, company, address, contact, rate: rateMatch ? Number(rateMatch[1]) : undefined, housing, notes }
}
