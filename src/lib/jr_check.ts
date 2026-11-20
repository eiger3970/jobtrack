// 2026-11-19 owner: "the code should take care of most of it". Batch search once matched a Job-Room ad on one shared word
// (Android Developer -> "Software Engineer PHP"). Every filled Job-Room link is checked against the ad's real title here, on
// every device, so a wrong job shows before it goes into Job-Room.
import { useEffect, useState } from 'react'

const TITLES_URL = 'https://cvgen-writer.kinhswch-cloudflare.workers.dev/jr-titles'
export const jrAdId = (link?: string) => (link || '').match(/job-room\.ch\/job-search\/([0-9a-f-]{36})/i)?.[1]?.toLowerCase() || ''

const words = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !/^\d+$/.test(w))
/** false = the ad is clearly another job: fewer than 2 shared title words (1 is enough when either title has one word) */
export function sameJob(role: string, adTitle: string): boolean {
  const rw = words(role), tw = words(adTitle)
  if (!rw.length || !tw.length) return true
  const hit = rw.filter(w => tw.some(t => t === w || (w.length > 5 && t.startsWith(w.slice(0, 6))))).length
  return hit >= Math.min(2, rw.length, tw.length)
}

type Ad = { title: string; employer: string } | null
const cache = new Map<string, Ad>()
const asked = new Set<string>()
const listeners = new Set<() => void>()
async function load(ids: string[]) {
  const todo = ids.filter(id => !asked.has(id))
  if (!todo.length) return
  todo.forEach(id => asked.add(id))
  try {
    const r = await fetch(TITLES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: todo }), signal: AbortSignal.timeout(15000) })
    const j = await r.json()
    for (const id of todo) cache.set(id, j?.ads?.[id] ?? null)
  } catch { todo.forEach(id => asked.delete(id)) }
  listeners.forEach(f => f())
}

/** job id -> the ad's title when the filled Job-Room link points to a different job */
export function useWrongJobLinks(rows: { id: number; role: string; link?: string }[]): Map<number, string> {
  const [, tick] = useState(0)
  const ids = [...new Set(rows.map(r => jrAdId(r.link)).filter(Boolean))]
  const key = ids.join(',')
  useEffect(() => { const f = () => tick(n => n + 1); listeners.add(f); return () => { listeners.delete(f) } }, [])
  useEffect(() => { if (ids.length) void load(ids) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const out = new Map<number, string>()
  for (const r of rows) {
    const ad = cache.get(jrAdId(r.link))
    if (ad && ad.title && !sameJob(r.role, ad.title)) out.set(r.id, ad.title)
  }
  return out
}
