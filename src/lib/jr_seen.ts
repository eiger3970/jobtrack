// 2026-11-19 owner: "I'm not reviewing the results, just accepting them... it's hard to view the missing data that was
// just populated". What each job looked like when the Job-Room panel first showed it on this page visit - so every
// detail filled since (Batch search, add-on, AI, paste, same company) can be listed and marked "new" for a quick check.
const TRACK = ['email', 'link', 'street', 'streetNo', 'postal', 'city', 'contactPerson', 'phone'] as const
export type TrackKey = typeof TRACK[number]
const seen = new Map<number, Partial<Record<TrackKey, string>>>()

export function rememberSeen(id: number, entry: Partial<Record<TrackKey, unknown>>) {
  if (seen.has(id)) return
  const snap: Partial<Record<TrackKey, string>> = {}
  for (const k of TRACK) snap[k] = String(entry[k] ?? '')
  seen.set(id, snap)
}

export function newlyFilled(id: number, entry: Partial<Record<TrackKey, unknown>>): TrackKey[] {
  const was = seen.get(id)
  if (!was) return []
  return TRACK.filter(k => !was[k] && !!String(entry[k] ?? '').trim())
}
