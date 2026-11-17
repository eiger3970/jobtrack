import { useCallback } from 'react'

// 2026-11-16 owner: "the i for info ... is only needed on phone. Desktop can be a pure mouse over".
// Put the returned ref on an i button: on a computer with a mouse, moving the mouse over the area the i sits in
// (the i button's parent: the column header, the button row, the sentence) opens the info, moving off closes the
// info after a short pause. The i itself is hidden on a computer (index.css), but stays reachable with the Tab key.
// Phone and app: nothing changes, tap the i.
export const HOVER_DEVICE = '(hover: hover) and (pointer: fine)'
// zone 'prev': only the element right before the i (the button the i explains), the i and the box right after the i
// open the info - for rows holding several buttons, e.g. Export backup next to Import backup.
// 2026-11-16 owner: "I can't reach Import backup file, as the Export data backup keeps opening its window"
// zone 'stay': mouse over opens, and the info stays open until a click somewhere else or Esc - for longer info that
// needs scrolling to read (2026-11-16 owner: Diagnostics "it disappears")
export function useHoverInfo(set: (on: boolean) => void, zone: 'parent' | 'prev' | 'stay' = 'parent') {
  return useCallback((btn: HTMLElement | null) => {
    if (!btn || typeof window === 'undefined' || !window.matchMedia(HOVER_DEVICE).matches) return
    const area = btn.parentElement
    if (!area) return
    // 2026-11-16 owner: "easy to miss, is there a mouseover hint?" - the area marks itself (index.css: help cursor, dotted underline on text)
    area.classList.add('has-hover-info')
    let timer = 0
    // 2026-11-16 owner: "I can't scroll down or it disappears" - scrolling slides the page under a still mouse, which
    // the browser reports as leaving. A leave right after a scroll does not close; the next real mouse move decides.
    let lastScroll = 0
    const scrolled = () => { lastScroll = Date.now() }
    window.addEventListener('scroll', scrolled, { capture: true, passive: true })
    window.addEventListener('wheel', scrolled, { passive: true })
    const open = () => { clearTimeout(timer); set(true) }
    const closeNow = () => { clearTimeout(timer); timer = window.setTimeout(() => set(false), 250) }
    const nextMove = (e: MouseEvent) => { if (Date.now() - lastScroll < 150) return; document.removeEventListener('mousemove', nextMove); if (!area.contains(e.target as Node)) closeNow() }
    const close = () => {
      if (Date.now() - lastScroll < 600) { document.addEventListener('mousemove', nextMove); return }
      closeNow()
    }
    const inZone = (t: EventTarget | null) => {
      if (zone === 'parent') return true
      const n = t as Node | null
      return !!n && [btn.previousElementSibling, btn, btn.nextElementSibling].some(el => el?.contains(n))
    }
    if (zone === 'stay') {
      const outside = (e: MouseEvent) => { if (!area.contains(e.target as Node)) set(false) }
      const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') set(false) }
      // 2026-11-17 owner: "when I tap on the Before registration date button, the info closes, the button doesn't action,
      // and it needs to be tapped again" - closing on mousedown shrank the page, so the button slid away before the
      // click landed. The info now closes on the finished click: the button gets the click first, then the info closes.
      area.addEventListener('mouseenter', open); document.addEventListener('click', outside); document.addEventListener('keydown', esc)
      return () => { area.removeEventListener('mouseenter', open); document.removeEventListener('click', outside); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', scrolled, { capture: true }); window.removeEventListener('wheel', scrolled) }
    }
    const move = (e: MouseEvent) => { if (inZone(e.target)) open(); else close() }
    area.addEventListener('mouseover', move)
    area.addEventListener('mouseleave', close)
    return () => { clearTimeout(timer); area.removeEventListener('mouseover', move); area.removeEventListener('mouseleave', close); document.removeEventListener('mousemove', nextMove); window.removeEventListener('scroll', scrolled, { capture: true }); window.removeEventListener('wheel', scrolled) }
  }, [set, zone])
}
