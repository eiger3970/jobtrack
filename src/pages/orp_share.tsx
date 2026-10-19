import { useEffect, useRef, useState } from 'react'
import { shareBookmarklet } from '../lib/form_share'
import { countryName } from '../lib/countries'
import BookmarkPic from './bookmark_pic'

// 2026-10-15 owner: incentive for users to share their country's job-entry form. Submit only (v1):
// how to copy, preview of the field names, then the prefilled contact form carries it with the
// person's email. Credit is stated up front; nothing leaves before the person taps Send there.
export const SHARE_CREDIT = '5% off'

export default function OrpShare({ country, t }: { country: string; t: (k: string) => string }) {
  const bm = useRef<HTMLAnchorElement>(null)
  const sendRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => { bm.current?.setAttribute('href', shareBookmarklet(window.location.origin)) }, [])
  const card = useRef<HTMLDivElement>(null)
  const pasteBox = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (new URLSearchParams(window.location.search).get('share') === '1') setTimeout(() => { card.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); pasteBox.current?.focus({ preventScroll: true }) }, 400) }, [])
  type Fld = { label: string; id: string; type: string; options?: string[] }
  type Page = { site?: string; scanned?: string; fields: Fld[] }
  useEffect(() => { const back = () => { if (document.visibilityState === 'visible') pasteBox.current?.focus({ preventScroll: true }) }; document.addEventListener('visibilitychange', back); window.addEventListener('focus', back); return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back) } }, [])
  const [text, setText] = useState('')
  const [pages, setPages] = useState<Page[]>([])
  // each valid paste is one page of the form; more than one page = paste again
  function onPaste(v: string) {
    setText(v)
    try { const d = JSON.parse(v); if (d && d.formshare && Array.isArray(d.fields)) { setPages(p => [...p, d]); setText('') } } catch { /* not complete yet */ }
  }
  const all = pages.flatMap((p, i) => p.fields.map(f => ({ ...f, page: i + 1 })))
  const data = pages.length ? { site: pages[0].site, scanned: pages[0].scanned, fields: all } : null
  // 2026-10-15 owner: once a scan is pasted, scroll so the send button sits in view
  const valid = !!data && data.fields.length >= 8
  useEffect(() => { if (valid) setTimeout(() => { const b = document.querySelector('.orp-body'); b?.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }) }, 250) }, [valid])
  // after sending, go back to the top of the panel ("Which job searches...") ready for the next job
  function afterSend() { setTimeout(() => { setText(''); setPages([]); const body = document.querySelector('.orp-body'); body?.scrollTo({ top: 0, behavior: 'smooth' }) }, 300) }
  // compact copy of the list so it always fits in the message intact (valid JSON for the Pi's checks)
  const compact = (opts: number) => data ? JSON.stringify({ formshare: 1, site: data.site, scanned: data.scanned, fields: data.fields.slice(0, 120).map(f => ({ page: pages.length > 1 ? f.page : undefined, label: (f.label || '').slice(0, 80), id: (f.id || '').slice(0, 100), type: f.type, ...(f.options && opts ? { options: f.options.slice(0, opts).map(o => o.slice(0, 40)) } : {}) })) }) : ''
  const list = compact(15).length <= 5500 ? compact(15) : compact(0)
  const msg = data ? `FORM SHARE ${countryName(country, 'en')} (${country}) - ${data.site} - scanned ${data.scanned}, sent ${new Date().toISOString().slice(0, 10)}\nReward ${SHARE_CREDIT} code, sent automatically\n\n${list}` : ''
  return (
    <div className="orp-share" ref={card}>
      {/* same pink gift as the referral boxes */}
      <svg className="orp-share-gift" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9h18v4H3zM5 13h14v8H5zM12 9v12M12 9c-1-3-5-4-5-1.5S10 9 12 9zM12 9c1-3 5-4 5-1.5S14 9 12 9z" /></svg>
      <div className="orp-share-body">
      <p className="orp-share-h">{t('share.title').replace('{credit}', SHARE_CREDIT)}</p>
      <ul className="jr-assure orp-before-tip">
        <li><b>{t('share.anon')}</b> {t('share.anonText')}</li>
        <li><b>{t('share.shared')}</b> {t('share.sharedText')}</li>
      </ul>
      <ol className="jts-steps">
        <li><b className="jts-num">1.</b> {t('share.s1')}<BookmarkPic barLabel={t('share.barLabel')} button="Share form" /><a ref={bm} className="jr-bm-link" onClick={ev => { ev.preventDefault(); alert(t('jr.bm.notHere')) }}>JobTrack share form</a></li>
        <li><b className="jts-num">2.</b> {t('share.s2')}</li>
        <li><b className="jts-num">3.</b> {t('share.s3')}</li>
      </ol>
      <textarea ref={pasteBox} rows={3} placeholder={t('share.paste')} value={text} onChange={e => onPaste(e.target.value)} />
      {text && <p className="jr-warn">{t('share.bad')}</p>}
      {data && <>
        <p className="orp-count"><b>{data.fields.length}</b> {t('share.fields')} - {data.site} - {pages.length} {pages.length === 1 ? t('share.page') : t('share.pages')}</p>
        <ul className="orp-share-list">{data.fields.map((f, i) => <li key={i}>{pages.length > 1 && <b>p{f.page} </b>}{f.label || f.id || '?'} <i>({f.type})</i></li>)}</ul>
        <p className="orp-hint">{t('share.more')} <button type="button" className="jr-bm-again" onClick={() => setPages([])}>{t('share.clear')}</button></p>
      </>}
      {data && data.fields.length < 8 && <p className="jr-warn">{t('share.wrong')}</p>}
      {data && data.fields.length >= 8 && <a ref={sendRef} onClick={afterSend} className="orp-share-send" href={`/contact?help=1&focus=contact&msg=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"><svg className="orp-share-env" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>{t('share.how')}</a>}
      </div>
    </div>
  )
}
