import { useRef, useEffect, useState } from 'react'
import { saveBookmarklet } from '../lib/jobtrack_save'
import BookmarkDrag from './bookmark_drag'


// 2026-11-03 owner: capture the job page at the moment of applying - one bookmark, any company or agency site.
export default function JobSaveBookmark({ t, bare, onClose }: { t: (k: string) => string; bare?: boolean; onClose?: () => void }) {
  const bm = useRef<HTMLAnchorElement>(null)
  const READY_KEY = 'kworld_jobtrack_savebm_ready'
  const [ready, setReadyState] = useState(() => { try { return localStorage.getItem(READY_KEY) === '1' } catch { return false } })
  const setReady = (v: boolean) => { setReadyState(v); try { if (v) localStorage.setItem(READY_KEY, '1'); else localStorage.removeItem(READY_KEY) } catch { /* private mode */ } }
  useEffect(() => { bm.current?.setAttribute('href', saveBookmarklet(window.location.origin)) })   // every render: the button is rebuilt after "Set up again", and a link without an address cannot be dragged
  // same guide as the Job-Room fill bookmark. 2026-11-03 owner: "Done" must not close the window - the 3 steps stay on screen
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches
  if (bare) return <div className={'orp-setup-big jt-savebm' + (phone ? ' jt-desktop-only' : '')}>
    {phone && <p className="jt-desktop-note">{t('bm.desktopOnly')}</p>}
    {!ready && <BookmarkDrag bm={bm} label={t('bm.saveBtn')} barLabel={t('share.barLabel')} title={t('share.s1')} how={t('bm.retry')} notHere={t('bm.saveNotHere')} onDragged={() => setReady(true)} />}
    {ready && <p className="orp-setup-h jt-ready"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> {t('bm.ready')}</p>}
    <ul className="jt-savebm-steps">
      <li><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 8 6h3v5H6V8l-4 4 4 4v-3h5v5H8l4 4 4-4h-3v-5h5v3l4-4-4-4v3h-5V6h3z" /></svg><span><b className="jt-n">1.</b> {t('bm.stepDrag')}</span></li>
      <li><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3 9h18" stroke="currentColor" strokeWidth="2" /></svg><span><b className="jt-n">2.</b> {t('bm.step0')}</span></li>
      <li><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" /></svg><span><b className="jt-n">3.</b> {t('bm.step1')}</span></li>
      <li><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg><span><b className="jt-n">4.</b> {t('bm.step2')}</span></li>
    </ul>
    <div className="jt-bm-foot">
      {!ready
        ? <button type="button" className="jr-bm-again" onClick={() => setReady(true)}>{t('bm.have')}</button>
        : <button type="button" className="jr-bm-again" onClick={() => setReady(false)}>{t('bm.again')}</button>}
      {onClose && <button className="btn-secondary" onClick={onClose}>{t('close')}</button>}
    </div>
  </div>
  return <details className="jt-savebm">
    <summary aria-label={t('bm.saveH')} title={t('bm.saveH')}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" /></svg><span className="jt-lbl">{t('bm.saveH')}</span></summary>
    <p><a ref={bm} className="jr-bm-link" onClick={ev => { ev.preventDefault(); alert(t('bm.saveNotHere')) }}>{t('bm.saveBtn')}</a></p>
    <p className="jt-savebm-how">{t('bm.saveHow')}</p>
  </details>
}
