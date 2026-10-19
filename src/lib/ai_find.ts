// 2026-10-19: the JobTrack AI find, shared by one card (find_details.tsx) and the all-jobs run (job_room_helper.tsx).
// Nobody waits on a busy AI: best engine first, the next one at once. Only engines that search the web are used -
// one without would guess an address. Results are suggestions: nothing fills a job until the person taps "Use".
export type Loc = Record<string, any>  // an office: strings plus likelyForJob / headOffice flags
export type Rec = Record<string, string>
export interface AiSource { title: string; uri: string }
export interface AiSuggestion { runs: Loc[][]; contact: Rec; sources: AiSource[]; at: string }

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
export function clearSuggestion(id: number) {
  try { const all = readAll(); delete all[String(id)]; localStorage.setItem(STORE, JSON.stringify(all)) } catch { /* private mode */ }
}

export type AiOutcome =
  | { kind: 'ok'; locs: Loc[]; contact: Rec; sources: AiSource[] }
  | { kind: 'none' } | { kind: 'used' } | { kind: 'cap' } | { kind: 'paused' }
  | { kind: 'err'; detail: string }

export async function aiFind(o: { company: string; role: string; hint: string; tok: string; app: boolean; retry?: boolean; avoid?: string }, onSwitch?: () => void): Promise<AiOutcome> {
  const device = deviceId()
  for (const [i, engine] of ['claude', 'claude2', 'gemini'].entries()) {
    try {
      const r = await fetch(o.app ? APP_FIND_URL : '/api/jobtrack/find', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: o.company, role: o.role, device, proToken: o.tok, app: o.app, engine, retry: !!o.retry, avoid: o.avoid ?? '', hint: o.hint }), signal: AbortSignal.timeout(22000) })
      const d = await r.json()
      if (d.status === 'trial_used') return { kind: 'used' }
      if (d.status === 'cap') return { kind: 'cap' }
      if (d.status === 'paused') return { kind: 'paused' }
      if (d.status === 'ok') return d.found ? { kind: 'ok', locs: d.locations ?? [], contact: d.contact ?? {}, sources: d.sources ?? [] } : { kind: 'none' }
      if (d.status === 'error') return { kind: 'err', detail: d.detail || '' }
    } catch { /* busy or offline: try the next one */ }
    if (i < 2) onSwitch?.()
  }
  return { kind: 'err', detail: '' }
}
