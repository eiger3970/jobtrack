import { useEffect, type RefObject } from 'react'
import { readAdChoice } from './ad_choice'

// 2026-11-09 owner: count ad views and clicks per slot, page and destination so
// ad space can be priced from real numbers. No cookie, no IP, no user id leaves
// here: only {kind, what, page}. Totals per day are kept by /api/ad-count.
// Not countable: unique people, Google's own ad clicks (iframe), ad-blocked views.
const seen = new Set<string>()

function send(kind: 'view' | 'click', what: string) {
  // same opt-outs as the tap counter: "Keep my privacy", Do Not Track, Global Privacy Control
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  if (readAdChoice() === 'private' || nav.doNotTrack === '1' || nav.globalPrivacyControl) return
  const page = location.pathname.replace(/[^a-zA-Z0-9/_-]/g, '').slice(0, 60) || '/'
  const body = JSON.stringify({ kind, what: what.replace(/[^a-zA-Z0-9:/_.-]/g, '').slice(0, 60), page })
  try {
    if (!navigator.sendBeacon?.('/api/ad-count', new Blob([body], { type: 'application/json' }))) {
      fetch('/api/ad-count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
  } catch { /* counting must never break the page */ }
}

// click: one per tap
export function countAdClick(what: string) { send('click', what) }

// view: once per page load and ad, when at least half of it is on screen for 1 s
export function useAdView(ref: RefObject<Element | null>, what: string, on = true) {
  useEffect(() => {
    const el = ref.current
    if (!el || !on || import.meta.env.DEV || typeof IntersectionObserver === 'undefined') return
    const id = location.pathname + '|' + what
    if (seen.has(id)) return
    let t: ReturnType<typeof setTimeout> | undefined
    const io = new IntersectionObserver(es => {
      for (const e of es) {
        if (e.isIntersecting) { t = setTimeout(() => { if (!seen.has(id)) { seen.add(id); send('view', what) } io.disconnect() }, 1000) }
        else clearTimeout(t)
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => { io.disconnect(); clearTimeout(t) }
  }, [ref, what, on, ref.current])  // eslint-disable-line react-hooks/exhaustive-deps
}
