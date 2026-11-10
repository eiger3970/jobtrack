import { useEffect, useRef, useState } from 'react'

// 2026-11-10 owner: "user lost in a sea of infinite-like jobs... a vim map". Edge map: one tick per job, coloured by
// status; a frame shows which jobs are on screen; "12 of 59" while scrolling or dragging; drag or tap to jump.
const COLOUR: Record<string, string> = {
  applied: '#3b82f6', screening: '#a855f7', interview: '#f59e0b', technical: '#f59e0b',
  offer: '#22c55e', accepted: '#22c55e', rejected: '#ef4444',
}
const MIN_JOBS = 12   // a short list needs no map

export default function JobMap({ jobs }: { jobs: { id: number; status: string }[] }) {
  const n = jobs.length
  const [range, setRange] = useState<[number, number] | null>(null)   // first and last job index on screen
  const [show, setShow] = useState(false)
  const [drag, setDrag] = useState(false)
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (n < MIN_JOBS) return
    let raf = 0
    const measure = () => {
      raf = 0
      const vh = window.innerHeight
      let first = -1, last = -1
      for (let i = 0; i < n; i++) {
        const el = document.getElementById(`jobtrack-application-${jobs[i].id}`)
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.bottom > 0 && r.top < vh) { if (first < 0) first = i; last = i }
        else if (first >= 0) break
      }
      setRange(first < 0 ? null : [first, last])
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure)
      setShow(true)
      if (hide.current) clearTimeout(hide.current)
      hide.current = setTimeout(() => setShow(false), 1400)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); if (hide.current) clearTimeout(hide.current) }
  }, [n, jobs])

  if (n < MIN_JOBS || !range) return null

  function jump(clientY: number) {
    const b = bar.current; if (!b) return
    const r = b.getBoundingClientRect()
    const i = Math.min(n - 1, Math.max(0, Math.floor(((clientY - r.top) / r.height) * n)))
    document.getElementById(`jobtrack-application-${jobs[i].id}`)?.scrollIntoView({ block: 'start' })
  }

  const [a, z] = range
  const label = a === z ? `${a + 1} of ${n}` : `${a + 1}-${z + 1} of ${n}`
  return (
    <div className={'jt-map' + (show || drag ? ' jt-map-on' : '')} aria-hidden="true">
      <div className="jt-map-label">{label}</div>
      <div ref={bar} className="jt-map-bar" style={{ touchAction: 'none' }}
        onPointerDown={e => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag(true); jump(e.clientY) }}
        onPointerMove={e => { if (drag) jump(e.clientY) }}
        onPointerUp={() => setDrag(false)} onPointerCancel={() => setDrag(false)}>
        {jobs.map(j => <i key={j.id} style={{ background: COLOUR[j.status] ?? '#6b7280' }} />)}
        <b style={{ top: `${(a / n) * 100}%`, height: `${((z - a + 1) / n) * 100}%` }} />
      </div>
    </div>
  )
}
