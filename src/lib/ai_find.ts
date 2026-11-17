// 2026-10-19: the JobTrack AI find, shared by one card (find_details.tsx) and the all-jobs run (job_room_helper.tsx).
// Nobody waits on a busy AI: best engine first, the next one at once. Only engines that search the web are used -
// one without would guess an address. Results are suggestions: nothing fills a job until the person taps "Use".
// 2026-11-13 owner: the Buy credits buttons are switched on and off in /admin (AI payments card), no code change or deploy.
// Off until the owner turns it on (likely after 2027-01-06, when there is money to top up the AI accounts). Any error reads as off.
let buyLive = false, buyLoaded = 0
const buyWatchers = new Set<(v: boolean) => void>()
export function useBuyCreditsLive(): boolean {
  const [v, setV] = useState(buyLive)
  useEffect(() => {
    buyWatchers.add(setV)
    if (Date.now() - buyLoaded > 60000) {
      buyLoaded = Date.now()
      fetch(SITE_BASE + '/api/ai-payments').then(r => r.json()).then(j => { buyLive = j?.live === true; buyWatchers.forEach(f => f(buyLive)) }).catch(() => { /* stays off */ })
    }
    return () => { buyWatchers.delete(setV) }
  }, [])
  return v
}
import { useEffect, useState } from 'react'
export type Loc = Record<string, any>  // an office: strings plus likelyForJob / headOffice flags
export type Rec = Record<string, string>
export interface AiSource { title: string; uri: string }
export interface AiSuggestion { runs: Loc[][]; contact: Rec; sources: AiSource[]; at: string; trace?: string }

// the iPhone app has no same-origin site, it calls the worker directly (phones reach workers.dev fine)
const SITE_BASE = typeof window !== 'undefined' && /^https?:/.test(window.location.origin) && window.location.hostname.endsWith('kworld.space') ? '' : 'https://kworld.space'   // the app has no same-origin site
const APP_FIND_URL = 'https://cvgen-writer.kinhswch-cloudflare.workers.dev/find-details'
const STORE = 'kworld_jobtrack_ai'

export function deviceId(): string {
  try {
    let d = localStorage.getItem('kworld_jobtrack_device')
    if (!d) { d = crypto.randomUUID(); localStorage.setItem('kworld_jobtrack_device', d) }
    return d
  } catch { return '' }
}
function readAll(): Record<string, AiSuggestion> {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') } catch { return {} }
}
export const readSuggestion = (id: number): AiSuggestion | null => readAll()[String(id)] ?? null
export function saveSuggestion(id: number, s: AiSuggestion) {
  try { const all = readAll(); all[String(id)] = s; localStorage.setItem(STORE, JSON.stringify(all)) } catch { /* private mode */ }
}
export function aiTrialUsed(): boolean {
  try {
    return localStorage.getItem('kworld_jobtrack_ai_trial_used') === '1' || Object.values(readAll()).some(s => !!s.trace)
  } catch { return false }
}
// 2026-11-15 owner: free finds are unlimited; after 5 a short note says Pro finds keep working on busy days
export function freeFindsCount(): number {
  try { return parseInt(localStorage.getItem('kworld_jobtrack_free_finds') || '0', 10) || 0 } catch { return 0 }
}
function countFreeFind() {
  try { localStorage.setItem('kworld_jobtrack_free_finds', String(freeFindsCount() + 1)) } catch { /* unavailable storage */ }
}
function markTrialUsed() {
  try { localStorage.setItem('kworld_jobtrack_ai_trial_used', '1') } catch { /* unavailable storage */ }
}

export function clearSuggestion(id: number) {
  try { const all = readAll(); delete all[String(id)]; localStorage.setItem(STORE, JSON.stringify(all)) } catch { /* private mode */ }
}

export type AiOutcome =
  | { kind: 'ok'; free: boolean; locs: Loc[]; contact: Rec; sources: AiSource[]; trace?: string }
  | { kind: 'none' } | { kind: 'webnone'; detail: string } | { kind: 'used' } | { kind: 'cap' } | { kind: 'paused' }
  | { kind: 'err'; detail: string; trail?: string }
  | { kind: 'jobs'; jobs: { url: string; title: string; source: string }[]; email?: string; via?: string }
  | { kind: 'sender'; company: string; website: string; role: string }

// Job-Room asks for the address of the office the application was sent to, so ranking looks for that office. Each office scores from
// every clue at once: the card/ad address (strongest), the AI's application match (an office directly linked to this application),
// the AI's pick for this job, then the ad text. The person's home town is deliberately not used and never sent anywhere.
// "likely" is shown only when one office clearly leads.
export function rankLocations(locs: Loc[], jobLocation: string, hint: string): Loc[] {
  const normal = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const matches = (loc: Loc, context: string) => {
    const text = ' ' + normal(context) + ' '
    return [loc.city, loc.postal].some(v => {
      const term = normal(v)
      return term.length >= 3 && text.includes(' ' + term + ' ')
    })
  }
  const locality = (context: string) => context.match(/\b[1-9]\d{3}\s+([^,;\n]+)/)?.[1] || context
  const score = (l: Loc) => (jobLocation && matches(l, locality(jobLocation)) ? 9 : 0) + (l.applicationMatch === true ? 5 : 0) + (l.likelyForJob ? 4 : 0) + (hint && matches(l, hint) ? 1 : 0)
  const scored = locs.map(l => ({ l, s: score(l) })).sort((x, y) => y.s - x.s || Number(y.l.n || 0) - Number(x.l.n || 0))
  const top = scored[0]?.s ?? 0
  const clear = top > 0 && (scored.length === 1 || top > scored[1].s)
  return scored.map(({ l }, i) => ({ ...l, ...(top > 0 ? { likelyForJob: clear && i === 0 } : {}) }))
}

export async function aiFind(o: { want?: 'joblink' | 'sender'; date?: string; company: string; role: string; hint: string; jobLocation?: string; applicationLink?: string; tok: string; app: boolean; retry?: boolean; avoid?: string; webOnly?: boolean; skipWeb?: boolean }, onSwitch?: () => void): Promise<AiOutcome> {
  const device = deviceId()
  const trail: [string, string][] = []   // [engine, exact error] per engine, so a failure can be diagnosed from a phone screenshot
  // same error from several engines is shown once: "claude, claude2: 400 credit balance too low | gemini: 429 quota"
  const LABEL: Record<string, string> = { claude: 'AI brand 1', claude2: 'AI brand 1', gemini: 'AI brand 2' }   // 2026-11-09 owner: claude and claude2 are one account, shown as one brand, so the list reads 1, 2 with no gap
  const tr = () => { const g = new Map<string, string[]>(); for (const [e, x] of trail) g.set(x, [...(g.get(x) ?? []), e]); return [...g].map(([x, es]) => [...new Set(es.map(e => LABEL[e] ?? e))].join(', ') + ': ' + x.replace(/\b(anthropic|claude|gemini|google)( api)?\b/gi, 'AI')).join(' | ') }
  let noFunds = false   // claude and claude2 are the same Anthropic account: when it has no funds the second try would fail the same way and only adds a request
  for (const [i, engine] of ['claude', 'claude2', 'gemini'].entries()) {
    if (engine === 'claude2' && noFunds) continue
    try {
      const r = await fetch(o.app ? APP_FIND_URL : '/api/jobtrack/find', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webOnly: !!o.webOnly, skipWeb: !!o.skipWeb, want: o.want, date: o.date, company: o.company, role: o.role, device, proToken: o.tok, app: o.app, engine, retry: !!o.retry, avoid: o.avoid ?? '', hint: o.hint, jobLocation: o.jobLocation ?? '', applicationLink: o.applicationLink ?? '' }), signal: AbortSignal.timeout(45000) })
      const raw = await r.text()
      let d: any
      try { d = JSON.parse(raw) } catch { const limited = /1015|rate limit/i.test(raw); trail.push([engine, limited ? 'blocked by the website rate limit (too many searches at once)' : 'bad reply']); if (o.webOnly) return { kind: 'webnone', detail: 'bad reply' }; if (limited) break; /* 2026-11-08 the limit is per website, not per AI: the next AI would be blocked the same way and only add requests */ if (i < 2) onSwitch?.(); continue }
      if (engine === 'claude' && /credit balance|billing/i.test(String(d.detail || ''))) noFunds = true
      if (d.status !== 'ok') trail.push([engine, (d.detail ? String(d.detail).replace(/\s*For more information.*$/, '').replace(/\s*Please go to.*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 140) : String(d.status || '?'))])
      if (d.status === 'web_none') return { kind: 'webnone', detail: String(d.detail || '') }
      if (d.status === 'trial_used') { markTrialUsed(); return { kind: 'used' } }
      if (d.status === 'cap') return { kind: 'cap' }
      if (d.status === 'paused') return { kind: 'paused' }
      if (d.status === 'ok' && d.found && d.pro === false) { markTrialUsed(); if (d.via !== 'search') countFreeFind() }
      if (o.want === 'sender' && d.status === 'ok') return d.found && d.sender?.company ? { kind: 'sender', company: String(d.sender.company), website: String(d.sender.website || ''), role: String(d.sender.role || '') } : { kind: 'none' }
      if (o.want === 'joblink' && d.status === 'ok') return { kind: 'jobs', jobs: Array.isArray(d.jobs) ? d.jobs : [], email: typeof d.email === 'string' ? d.email : '', via: typeof d.via === 'string' ? d.via : '' }
      if (d.status === 'ok') return d.found ? { kind: 'ok', free: d.pro === false, locs: rankLocations(d.locations ?? [], o.jobLocation ?? '', o.hint), contact: d.contact ?? {}, sources: d.sources ?? [], trace: d.trace } : { kind: 'none' }
      if (d.status === 'error') return { kind: 'err', detail: d.detail || '', trail: tr() }
    } catch (e) { trail.push([engine, e instanceof SyntaxError ? 'bad reply' : 'no connection']); if (o.webOnly) return { kind: 'webnone', detail: 'no connection' } }
    if (i < 2) onSwitch?.()
  }
  return { kind: 'err', detail: '', trail: tr() }
}

// 2026-11-17 owner: when the history search finds nothing, a free search (web + the company's own website) runs in the
// same 8 seconds. Only the company name, job title and place are sent, to kworld's own worker.
type QuickFields = { email?: string; phone?: string; street?: string; streetNo?: string; postal?: string; city?: string; contactPerson?: string }
export type QuickFind = { jobs: { url: string; title: string }[]; site: ({ site: string } & QuickFields) | null; jobroom: ({ url: string; title: string; formUrl?: string } & QuickFields) | null }
export async function quickFind(company: string, role: string, place: string, app: boolean): Promise<QuickFind> {
  try {
    const r = await fetch(app ? APP_FIND_URL.replace('/find-details', '/quick-find') : '/api/jobtrack/quick', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, role, place }), signal: AbortSignal.timeout(7500) })
    const j = await r.json()
    return { jobs: Array.isArray(j?.jobs) ? j.jobs : [], site: j?.site && typeof j.site.site === 'string' ? j.site : null, jobroom: j?.jobroom && typeof j.jobroom.url === 'string' ? j.jobroom : null }
  } catch { return { jobs: [], site: null, jobroom: null } }
}

// 2026-11-17 owner (1): every red square is searched in the background as soon as the Job-Room panel opens, so a tapped
// square has its answer ready. One promise per company + job title for this visit; 2 at a time, so the worker is not flooded.
const quickCache = new Map<string, Promise<QuickFind>>()
export function quickFindCached(company: string, role: string, place: string, app: boolean): Promise<QuickFind> {
  const k = (company + '|' + role).toLowerCase()
  let p = quickCache.get(k)
  if (!p) { p = quickFind(company, role, place, app); quickCache.set(k, p); p.then(q => { quickDone.set(k, q); quickListeners.forEach(f => f()) }) }
  return p
}
// finished background searches, for the Fill all list (2026-11-17 owner)
const quickDone = new Map<string, QuickFind>()
const quickListeners = new Set<() => void>()
export function quickResult(company: string, role: string): QuickFind | undefined { return quickDone.get((company + '|' + role).toLowerCase()) }
export function onQuickDone(f: () => void): () => void { quickListeners.add(f); return () => { quickListeners.delete(f) } }
// the best find, most complete first: Job-Room's ad for this exact job, then the company website, then Job-Room's company address
export function quickHit(q: QuickFind | undefined, t: (k: string) => string): null | { from: 'jobroom' | 'site'; label: string; fields: Record<string, string> } {
  if (!q) return null
  const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(k => typeof o[k] === 'string' && o[k]).map(k => [k, o[k] as string])) as Record<string, string>
  const F = ['email', 'street', 'streetNo', 'postal', 'city', 'phone', 'contactPerson']
  const jr = q.jobroom, st = q.site
  if (jr && jr.url) return { from: 'jobroom', label: t('fd.quickJobRoom').replace('{title}', jr.title), fields: { ...pick(jr, F), link: jr.formUrl || jr.url, linkFrom: jr.formUrl ? 'user' : 'company' } }
  if (st && (st.email || st.postal)) return { from: 'site', label: t('fd.quickSite').replace('{site}', st.site), fields: pick(st, F) }
  if (jr && jr.postal) return { from: 'jobroom', label: t('fd.quickJobRoomAddr'), fields: pick(jr, F) }
  return null
}
// only the fields the job does not have yet; the link kind only together with a link
export function quickPatch(a: object, fields: Record<string, string>): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) if (v && !(a as Record<string, unknown>)[k]) patch[k] = v
  if (!patch.link) delete patch.linkFrom
  return patch
}
let prefetchRunning = false
export async function prefetchQuick(list: { company: string; role: string; place: string }[], app: boolean) {
  if (prefetchRunning) return
  prefetchRunning = true
  try {
    const queue = list.filter(x => x.company && !quickCache.has((x.company + '|' + x.role).toLowerCase()))
    const worker = async () => { for (let x = queue.shift(); x; x = queue.shift()) await quickFindCached(x.company, x.role, x.place, app) }
    await Promise.all([worker(), worker()])
  } finally { prefetchRunning = false }
}
