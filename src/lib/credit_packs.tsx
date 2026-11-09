import { useEffect, useState } from 'react'
import { buyPro } from './pro'

// 2026-11-09 owner-approved pack table (3x margin at about US$0.10 per AI find, Apple 15%; bigger pack = lower price per find).
// One source for the sizes and prices. The worker knows the same scopes (worker/site_worker.ts PRODUCTS: jobtrack-pack-<finds>)
// and the writer worker counts the finds per token (cvgen-writer-worker/src/index.ts). A pack token is NOT Pro: it only buys AI finds.
export const CREDIT_PACKS: { finds: number; usd: number }[] = [
  { finds: 10, usd: 4.99 },
  { finds: 25, usd: 10.99 },
  { finds: 50, usd: 19.99 },
  { finds: 100, usd: 34.99 },
]
export const PACK_SCOPE_PREFIX = 'jobtrack-pack-'
export const PACK_KEY = 'kworld_jobtrack_pack_token'
export const packScope = (finds: number) => PACK_SCOPE_PREFIX + finds

export function readPackToken(): string {
  try { return localStorage.getItem(PACK_KEY) ?? '' } catch { return '' }
}
export const openPacks = () => window.dispatchEvent(new Event('kworld-packs'))

// Mount once on a page; any "buy" button calls openPacks().
export function PackList() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const on = () => setOpen(true)
    window.addEventListener('kworld-packs', on)
    return () => window.removeEventListener('kworld-packs', on)
  }, [])
  if (!open) return null
  return (
    <div className="fd-ai-buy" role="dialog" aria-label="AI finds packs">
      <p className="fd-hint">AI finds: the bigger the pack, the less each find costs.</p>
      {CREDIT_PACKS.map(p => (
        <button key={p.finds} type="button" className="btn btn-glow fd-btn" onClick={() => buyPro({ scope: packScope(p.finds), amount: p.usd, title: `JobTrack AI finds (${p.finds})`, subtitle: `${p.finds} AI finds, US$${(p.usd / p.finds).toFixed(2)} each` })}>
          {p.finds} finds - US${p.usd.toFixed(2)} (US${(p.usd / p.finds).toFixed(2)} each)
        </button>
      ))}
      <button type="button" className="btn fd-btn" onClick={() => setOpen(false)}>Close</button>
    </div>
  )
}
