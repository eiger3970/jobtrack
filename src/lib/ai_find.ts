// 2026-10-19: the JobTrack AI find, shared by one card (find_details.tsx) and the all-jobs run (job_room_helper.tsx).
// Nobody waits on a busy AI: best engine first, the next one at once. Only engines that search the web are used -
// one without would guess an address. Results are suggestions: nothing fills a job until the person taps "Use".
// 2026-11-04 owner: the Buy credits buttons stay hidden until there is money to top up the AI accounts (likely after 2027-01-06) - then set this to true
export const BUY_CREDITS_LIVE = false
export type Loc = Record<string, any>  // an office: strings plus likelyForJob / headOffice flags
export type Rec = Record<string, string>
export interface AiSource { title: string; uri: string }
export interface AiSuggestion { runs: Loc[][]; contact: Rec; sources: AiSource[]; at: string; trace?: string }

// the iPhone app has no same-origin site, it calls the worker directly (phones reach workers.dev fine)
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

export async function aiFind(o: { want?: 'joblink'; date?: string; company: string; role: string; hint: string; jobLocation?: string; applicationLink?: string; tok: string; app: boolean; retry?: boolean; avoid?: string; webOnly?: boolean; skipWeb?: boolean }, onSwitch?: () => void): Promise<AiOutcome> {
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
      if (d.status === 'ok' && d.found && d.pro === false) markTrialUsed()
      if (o.want === 'joblink' && d.status === 'ok') return { kind: 'jobs', jobs: Array.isArray(d.jobs) ? d.jobs : [], email: typeof d.email === 'string' ? d.email : '', via: typeof d.via === 'string' ? d.via : '' }
      if (d.status === 'ok') return d.found ? { kind: 'ok', free: d.pro === false, locs: rankLocations(d.locations ?? [], o.jobLocation ?? '', o.hint), contact: d.contact ?? {}, sources: d.sources ?? [], trace: d.trace } : { kind: 'none' }
      if (d.status === 'error') return { kind: 'err', detail: d.detail || '', trail: tr() }
    } catch (e) { trail.push([engine, e instanceof SyntaxError ? 'bad reply' : 'no connection']); if (o.webOnly) return { kind: 'webnone', detail: 'no connection' } }
    if (i < 2) onSwitch?.()
  }
  return { kind: 'err', detail: '', trail: tr() }
}
