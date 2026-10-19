// 2026-10-13 owner: "I already have trouble entering data" - a job ad's text,
// copied from Job-Room (or any job site) and pasted in, fills the entry.
// Job-Room's robots.txt says "Do not crawl Job Adverts", so nothing is
// fetched: only text the person copied from the page they already opened.

import { splitAddress } from './orp'

export interface ParsedAd {
  role: string
  company: string
  address: string
  contact: string
  // 2026-10-14: Job-Room's form fields, picked out of the ad
  street: string; streetNo: string; postal: string; city: string
  contactPerson: string; email: string; phone: string; link: string
  rate?: number
  housing: boolean
  notes: string
  // 2026-10-15 owner: pasted EMAILS (confirmation / rejection) too
  statusHint: '' | 'rejected' | 'accepted'
  siteDomain: string   // company site, from the sender's address (noreply@academicwork.com -> academicwork.com)
  urls: string[]       // web addresses in the text with a real page path
}

const lines = (t: string) => t.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
const RATE = /(\d{2,3})\s*%/

// value on the line after a label, e.g. "Workload" -> "100%"
function after(ls: string[], labels: RegExp): string {
  const i = ls.findIndex(l => labels.test(l))
  return i >= 0 && i + 1 < ls.length ? ls[i + 1] : ''
}

const GREETING = /^(bonjour|bonsoir|hello|hi|dear|hallo|guten tag|sehr geehrte|madame|monsieur|cher|chère)\b/i
const FREE_MAIL = /^(gmail|googlemail|proton|protonmail|pm|outlook|hotmail|live|yahoo|bluewin|icloud|me|gmx|sunrise|tutanota)\./i
// "Your application for X has been received" / "candidature pour X." / "Bewerbung als X"
function applicationRole(text: string): string {
  const m = text.match(/application for (.{3,120}?)(?:\s+(?:has been|was) received|\.|!|\n)/i)
    || text.match(/candidature pour (.{3,120}?)(?:\.|!|\n)/i)
    || text.match(/Bewerbung (?:als|für|auf) (.{3,120}?)(?: ist | wurde |\.|!|\n)/i)
  return m?.[1]?.trim().replace(/[.!]+$/, '') ?? ''
}
// "Olivier chez Academic Work", "Anna at X", "Peter bei X"; else the line after "Regards,/Cordialement,"
function signatureName(ls: string[]): string {
  for (const l of ls) { const m = l.match(/^([A-ZÀ-Ý][\wà-ÿ'-]+(?:\s+[A-ZÀ-Ý][\wà-ÿ'-]+)?)\s+(?:chez|at|bei|von)\s+\S/); if (m) return m[1] }
  const i = ls.findIndex(l => /^(best regards|kind regards|warm regards|regards|sincerely|cordialement|bien cordialement|salutations|chaleureuses salutations|freundliche grüsse|mit freundlichen grüssen|beste grüsse)[,.!]*$/i.test(l))
  const n = i >= 0 ? ls[i + 1] : ''
  return n && /^[A-ZÀ-Ý][\wà-ÿ'-]+(?:\s+[A-ZÀ-Ý][\wà-ÿ'-]+){0,2}$/.test(n) && !/Academic|Team|Recruit/i.test(n) ? n : ''
}
const REJECT = /d'autres candidats .{0,60}(retenus|choisis)|ne (pouvons|retenons) pas (donner suite|votre candidature)|nous regrettons|regret(s)? de vous informer|unfortunately|we (regret|are sorry) to|not (be )?(moving|proceed)|other candidates|leider|bedauern|absage|nicht berücksichtigen/i
const ACCEPT = /(nous avons le plaisir de vous (informer|annoncer)|félicitations|congratulations|we are (pleased|delighted) to (offer|inform)|job offer|freuen uns.{0,40}(zusage|angebot)|herzlichen glückwunsch)/i

export function parseEmail(text: string): { role: string; person: string; email: string; statusHint: '' | 'rejected' | 'accepted'; siteDomain: string; urls: string[] } {
  const ls = lines(text)
  const emails = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []
  const real = emails.find(e => !/^(no-?reply|donotreply|do-not-reply|mailer-daemon|notifications?)@/i.test(e) && !/proton\.me|protonmail/i.test(e.split('@')[1]))
  const domain = (emails.map(e => e.split('@')[1].toLowerCase()).find(d => !FREE_MAIL.test(d) && !/^proton/.test(d))) ?? ''
  const urls = (text.match(/https?:\/\/[^\s<>"]+/g) ?? []).map(u => u.replace(/[.,;)]+$/, '')).filter(u => { try { const x = new URL(u); return x.pathname.replace(/\/+$/, '') !== '' } catch { return false } })
  return {
    role: applicationRole(text), person: signatureName(ls), email: real ?? '',
    statusHint: REJECT.test(text) ? 'rejected' : ACCEPT.test(text) ? 'accepted' : '',
    siteDomain: domain.replace(/^(mail|email|noreply|no-reply)\./, ''), urls: [...new Set(urls)].slice(0, 4),
  }
}

export function parseAd(text: string): ParsedAd {
  const ls = lines(text)
  const em = parseEmail(text)
  const isEmail = /^(From|De|Von|Subject|Objet|Betreff)\b/i.test(ls[0] ?? '') || ls.slice(0, 8).some(l => GREETING.test(l)) || !!em.role
  // 2026-10-13: Ctrl+A copies the site's menu too ("Header", "Home"...), so the
  // title is the line just before "Vacant since", else the first line ending
  // in a work rate ("Ski Lift Operator 100%"), else the first line.
  const vacant = ls.findIndex(l => /Vacant since|Vakant seit|Vacant depuis|Ausgeschrieben seit|Publiée? le/i.test(l))
  const first = (vacant > 0 ? ls[vacant - 1] : undefined) ?? ls.find(l => /^\D.{2,80}\d{2,3}\s*%$/.test(l)) ?? ls[0] ?? ''
  const role = isEmail ? em.role : first.replace(/\d{2,3}\s*(-\s*\d{2,3}\s*)?%/, '').replace(/\s+-?\s*$/, '').trim()

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

  const email = isEmail ? em.email : (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? '')
  const phone = text.match(/(?:\+41|0)\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2}/)?.[0] ?? ''
  // label on its own line (value on the next), or "Contact: Name" on one line
  const inlinePerson = ls.map(l => l.match(/^(?:Contact|Kontakt|Contact person|Kontaktperson|Personne de contact|Ansprechperson|Ansprechpartner(?:in)?)\s*[:\-]\s*([^,@\d][^,@\d]{1,60})$/i)).find(Boolean)?.[1]?.trim() ?? ''
  const person = after(ls, /^(Contact|Kontakt|Contact person|Kontaktperson)$/i) || inlinePerson || (isEmail ? em.person : '')
  const contact = [person, email, phone].filter(Boolean).join(', ')

  // staff housing offered - the thing that decides whether a resort job is possible
  const housing = /staff (apartment|accommodation|room|housing)|Personal(wohnung|zimmer|unterkunft)|logement (du personnel|fourni)|Unterkunft/i.test(text)

  const start = after(ls, /^(Employment start|Stellenantritt|Entrée en fonction)$/i)
  const duration = after(ls, /^(Employment duration|Anstellungsdauer|Durée de l'engagement)$/i)
  // 2026-10-14 owner's real paste: Job-Room shows other sites' ads ("Jobup Vacant since : 09.10.2026",
  // "found on an external website") - then the contact, email and apply link are on that site
  const source = text.match(/^\s*([A-Za-z][\w.-]{1,30})\s+Vacant since/m)?.[1] ?? ''
  const external = /found on an external website|auf einer externen Webseite|sur un site externe/i.test(text)
  const notes = [housing ? 'Staff housing offered' : '', start && `Start: ${start}`, duration,
    external && source ? `Ad from ${source} - contact, email and apply link are on ${source}` : ''].filter(Boolean).join(' · ')

  // a full address anywhere in the ad beats the bare work location ("Bahnhofstr. 1, 3954 Leukerbad")
  const fullAddr = text.match(/[A-ZÄÖÜ][\wäöüéèà.'-]+(?:[ \t][\wäöüéèà.'-]+)*[ \t]\d+[ \t]?[a-z]?,?[ \t]+\d{4}[ \t]+[A-ZÄÖÜ][\wäöüéèà' -]+/)?.[0] ?? ''
  const parts = splitAddress(fullAddr || address)
  // 2026-10-15 owner: "Link zum Online-Formular" is the page of THIS job's form. A bare company homepage (no path) is not that link - skip it
  const link = (text.match(/https?:\/\/[^\s<>"]+/g) ?? []).map(u => u.replace(/[.,;)]+$/, '')).find(u => { try { const x = new URL(u); return x.pathname.replace(/\/+$/, '') !== '' || x.search !== '' } catch { return false } }) ?? ''
  return { role, company, address, contact, ...parts, contactPerson: person, email, phone, link,
    rate: rateMatch ? Number(rateMatch[1]) : undefined, housing, notes, statusHint: em.statusHint, siteDomain: em.siteDomain, urls: em.urls }
}
