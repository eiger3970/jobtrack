import { useRef, useLayoutEffect, useState, type RefObject } from 'react'
import BookmarkPic from './bookmark_pic'

// 2026-11-03 owner: the browser shows a globe for this kind of bookmark, so the button shows the same globe - no surprises
export const FillIcon = () => <svg className="jt-fillicon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M4.5 7.5h15M4.5 16.5h15" /></svg>

// One drag-to-bookmarks-bar guide for every JobTrack bookmark: a copy of the real button flies from the button into the bar in the picture.
// The parent keeps the `bm` ref and sets its href.
export default function BookmarkDrag({ bm, label, barLabel, title, how, notHere, onDragged }: { bm: RefObject<HTMLAnchorElement | null>; label: string; barLabel: string; title: string; how: string; notHere: string; onDragged: () => void }) {
  const zone = useRef<HTMLDivElement>(null)
  const ghost = useRef<HTMLSpanElement>(null)
  const [dragged, setDragged] = useState(false)
  useLayoutEffect(() => {
    const place = () => {
      const z = zone.current, g = ghost.current, b = bm.current, svg = z?.querySelector('svg')
      if (!z || !g || !b || !svg) return
      const zr = z.getBoundingClientRect(), br = b.getBoundingClientRect(), sr = svg.getBoundingClientRect()
      g.style.left = (br.left - zr.left) + 'px'; g.style.top = (br.top - zr.top) + 'px'; g.style.width = br.width + 'px'; g.style.height = br.height + 'px'
      const tx = sr.left + 247 / 320 * sr.width, ty = sr.top + 17 / 44 * sr.height
      g.style.setProperty('--dx', (tx - (br.left + br.width / 2)) + 'px'); g.style.setProperty('--dy', (ty - (br.top + br.height / 2)) + 'px')
    }
    place()
    window.addEventListener('resize', place)
    const t = window.setTimeout(place, 300)
    return () => { window.removeEventListener('resize', place); window.clearTimeout(t) }
  }, [bm])
  return <div className="jt-fly" ref={zone}>
    <BookmarkPic barLabel={barLabel} button={label} flying />
    <div className="orp-setup-drag"><p className="orp-setup-h">{title}</p>
      <a ref={bm} className="jr-bm-link orp-setup-btn" onDragEnd={() => { setDragged(true); onDragged() }} onClick={ev => { ev.preventDefault(); alert(notHere) }}><FillIcon />{label}</a></div>
    {!dragged && <span ref={ghost} className="jt-ghost" aria-hidden="true"><FillIcon />{label}</span>}
    <p className="orp-setup-how">{how}</p>
  </div>
}
