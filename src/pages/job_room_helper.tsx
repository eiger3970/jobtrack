import { useEffect, useRef, useState } from 'react'
import { type Application, type JobRoomEntry, JR_METHOD, jobRoomEntry, jobRoomMissing } from '../lib/orp'
import { parseAd } from '../lib/ad_parse'
import { bookmarklet, fillPayload, FILL_KEY } from '../lib/jobroom_fill'

// 2026-10-14: the date Job-Room's ENTER form was last checked against these fields
const FORM_CHECKED = '14.10.2026'

// 2026-10-14 owner: "build a proper complex product, with super simple user
// UX ... as many details as possible to reduce kafkaesque bureaucracy push
// back". One application at a time, laid out exactly like Job-Room's ENTER
// form (same questions, same order, Job-Room's own words), a Copy button on
// every value, gaps fillable right here, and a big "Entered" button that
// moves on. Progress is saved on each application (jobroomDone).

type Patch = Partial<Application>

// Job-Room shows these questions in German even in English mode (owner's paste 2026-10-14)
const Q = {
  when: 'Wann haben Sie sich beworben?',
  how: 'Wie haben Sie sich beworben?',
  where: 'Wo haben Sie sich beworben?',
  job: 'Auf welche Stelle haben Sie sich beworben?',
  rav: 'Erfolgte die Bewerbung aufgrund einer Zuweisung des RAV?',
  rate: 'Für welches Arbeitspensum haben Sie sich beworben?',
  result: 'Wie lautet das Ergebnis Ihrer Bewerbung?',
}

const ICON_CHECK = <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>

export default function JobRoomHelper({ rows, monthLabel, onUpdate, t }: {
  rows: Application[]; monthLabel: string; onUpdate: (id: number, patch: Patch) => void; t: (k: string) => string
}) {
  const firstOpen = Math.max(0, rows.findIndex(a => !a.jobroomDone))
  const [i, setI] = useState(firstOpen)
  const [copied, setCopied] = useState('')
  const done = rows.filter(a => a.jobroomDone).length
  const [ad, setAd] = useState('')
  const bm = useRef<HTMLAnchorElement>(null)
  const fillUsed = (() => { try { return !!localStorage.getItem('kworld_jobtrack_fill_used') } catch { return false } })()
  const [setupOpen, setSetupOpen] = useState(() => { try { return !localStorage.getItem('kworld_jobtrack_fill_used') && !localStorage.getItem('kworld_jobtrack_fill_seen') } catch { return false } })
  useEffect(() => { bm.current?.setAttribute('href', bookmarklet(window.location.origin)) }, [rows.length, setupOpen])
  if (rows.length === 0) return null
  const idx = Math.min(i, rows.length - 1)
  const a = rows[idx]
  const e = jobRoomEntry(a)
  const missing = jobRoomMissing(e)
  // the card on screen is what JobTrack fill (on Job-Room) picks up
  try { localStorage.setItem(FILL_KEY, JSON.stringify(fillPayload(a))) } catch { /* private mode */ }
  // empty fields Job-Room asks for (required or not) - the ones worth finding
  const gaps = ([['street', e.street], ['postal', e.postal], ['city', e.city], ['contactPerson', e.contactPerson], ['email', e.email], ['phone', e.phone], ['link', e.link]] as const)
    .filter(([, v]) => !v).map(([k]) => t('jr.f.' + k))
  function fillFromAd() {
    const p = parseAd(ad)
    const patch: Partial<Application> = {}
    const put = (k: keyof Application, v: string | undefined, have: string) => { if (v && !have) (patch as any)[k] = v }
    put('street', p.street, e.street); put('streetNo', p.streetNo, e.streetNo); put('postal', p.postal, e.postal); put('city', p.city, e.city)
    put('contactPerson', p.contactPerson, e.contactPerson); put('email', p.email, e.email); put('phone', p.phone, e.phone); put('link', p.link, e.link)
    if (!a.adText) patch.adText = ad.slice(0, 20000) // kept as proof if the ad page goes 404
    if (Object.keys(patch).length) onUpdate(a.id, patch)
    setAd('')
  }

  async function copy(key: string, value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(''), 1200) } catch { /* no clipboard */ }
  }

  // a text value: shown with Copy; empty -> an input right here (amber if Job-Room needs it)
  const Val = ({ k, label, field, value, required = false }: { k: string; label: string; field?: keyof Application; value: string; required?: boolean }) => (
    <div className={'jr-row' + (!value && required ? ' jr-need' : '')}>
      <span className="jr-label">{label}</span>
      {value
        ? <span className="jr-value">{value}</span>
        : field
          ? <input className="jr-input" placeholder={required ? t('jr.needed') : t('jr.optional')} defaultValue=""
              onBlur={ev => { const v = ev.target.value.trim(); if (v) onUpdate(a.id, { [field]: v } as Patch) }} />
          : <span className="jr-value jr-empty">-</span>}
      {value && <button type="button" className="jr-copy" onClick={() => copy(k, value)}>{copied === k ? ICON_CHECK : t('orp.copy')}</button>}
    </div>
  )
  // a choice in Job-Room: the option to tick, highlighted (nothing to copy)
  const Pick = ({ label, options, chosen }: { label: string; options: string[]; chosen: string }) => (
    <div className="jr-row">
      <span className="jr-label">{label}</span>
      <span className="jr-picks">{options.map(o => <span key={o} className={'jr-pick' + (o === chosen ? ' on' : '')}>{o === chosen && ICON_CHECK}{o}</span>)}</span>
    </div>
  )

  function entered() {
    onUpdate(a.id, { jobroomDone: new Date().toISOString().slice(0, 10) })
    const next = rows.findIndex((r, n) => n > idx && !r.jobroomDone)
    setI(next >= 0 ? next : idx)
  }

  return (
    <div className="jr">
      {/* 2026-10-14 owner: set-up first and small; then two lines, each saying WHERE you are */}
      {/* 2026-10-14 owner: "is there a way to check it's set up?" - a site can't read bookmarks, but the
          hand-over page records the first real use; until then a pop-up, after that a small link */}
      {fillUsed
        ? <button type="button" className="jr-bm-again" onClick={() => setSetupOpen(true)}>{t('jr.bm.again')}</button>
        : <button type="button" className="jr-bm-start" onClick={() => setSetupOpen(true)}>{t('jr.bm.title')}</button>}
      {setupOpen && (
        <div className="jr-setup" role="dialog" aria-label={t('jr.bm.title')}>
          <p className="jr-setup-title">{t('jr.bm.title')}</p>
          <p>{t('jr.bm.once')}</p>
          <a ref={bm} className="jr-bm-link" onClick={ev => { ev.preventDefault(); alert(t('jr.bm.notHere')) }} title={t('jr.bm.drag')}>JobTrack fill</a>
          <div className="jr-setup-btns"><button type="button" className="btn" onClick={() => { setSetupOpen(false); try { localStorage.setItem('kworld_jobtrack_fill_seen', '1') } catch { /* private */ } }}>{t('jr.bm.done')}</button></div>
        </div>
      )}
      <div className="jr-top">
        <p className="jr-progress"><b>{done}</b> / {rows.length} {t('jr.entered')}</p>
        <div className="jr-bar"><div style={{ width: `${(done / rows.length) * 100}%` }} /></div>
        <ol className="jr-flow">
          <li><b>Job-Room:</b> {t('jr.flow1').split('{month}')[0]}<b className="jr-month">{monthLabel}</b>{t('jr.flow1').split('{month}')[1] ?? ''}</li>
          <li><b>JobTrack:</b> {t('jr.flow2')}</li>
        </ol>
      </div>
      <div className="jr-dots" role="tablist">
        {rows.map((r, n) => (
          <button key={r.id} type="button" role="tab" aria-selected={n === idx} aria-label={`${n + 1}. ${r.company}`}
            className={'jr-dot' + (n === idx ? ' cur' : '') + (r.jobroomDone ? ' done' : '') + (jobRoomMissing(jobRoomEntry(r)).length ? ' need' : '')}
            onClick={() => setI(n)}>{n + 1}</button>
        ))}
      </div>

      <div className="jr-card" key={a.id}>
        <p className="jr-head">{idx + 1}. {a.company}{a.jobroomDone && <span className="jr-done-tag">{ICON_CHECK}{t('jr.doneTag')}</span>}</p>
        {missing.length > 0 && <p className="jr-warn">{t('jr.missing')}</p>}
        {/* 2026-10-14 owner: "there shouldn't be any empty fields" - fill gaps from the ad, or look them up in one tap */}
        {gaps.length > 0 && (
          <details className="jr-fill" open={missing.length > 0}>
            <summary>{t('jr.fill')} ({gaps.join(', ')})</summary>
            <textarea className="jr-ad" rows={3} placeholder={t('jr.adPaste')} value={ad} onChange={ev => setAd(ev.target.value)} />
            <button type="button" className="btn-secondary" disabled={!ad.trim()} onClick={fillFromAd}>{t('jr.adFill')}</button>
            <div className="jr-find">
              <a href={`https://www.zefix.ch/en/search/entity/list?mainSearch=${encodeURIComponent(a.company)}`} target="_blank" rel="noopener noreferrer">{t('jr.zefix')}</a>
              <a href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(a.company)}`} target="_blank" rel="noopener noreferrer">{t('jr.map')}</a>
              <button type="button" className="jr-copy" onClick={() => copy('sent', a.company)}>{copied === 'sent' ? ICON_CHECK : t('jr.sent')}</button>
              <a href="https://www.job-room.ch/job-search" target="_blank" rel="noopener noreferrer">{t('jr.search')}</a>
              {/* 2026-10-14 owner: a Jobup link was 404 - the same job was still live on ostjob.ch */}
              <a href={`https://duckduckgo.com/?q=${encodeURIComponent(`${a.company} ${a.role}`)}`} target="_blank" rel="noopener noreferrer">{t('jr.other')}</a>
            </div>
          </details>
        )}

        <p className="jr-q">{Q.when}</p>
        <Val k="date" label="Date" value={e.date} required />
        <p className="jr-q">{Q.how}</p>
        <Pick label="" options={['Elektronisch', 'Brieflich', 'Persönlich', 'Telefonisch']} chosen={JR_METHOD[e.method]} />
        <p className="jr-q">{Q.where}</p>
        <Val k="biz" label="Business" value={e.business} required />
        <Val k="street" label="Street" field="street" value={e.street} />
        <Val k="no" label="No." field="streetNo" value={e.streetNo} />
        <Val k="po" label="PO box no." field="poBox" value={e.poBox} />
        <Val k="country" label="Country" value={e.country} />
        <Val k="postal" label="Postal code" field="postal" value={e.postal} required />
        <Val k="city" label="City" field="city" value={e.city} required />
        <Val k="person" label="Kontaktperson" field="contactPerson" value={e.contactPerson} />
        <Val k="email" label="Email" field="email" value={e.email} />
        <Val k="phone" label="Phone number" field="phone" value={e.phone} />
        <p className="jr-q">{Q.job}</p>
        <Val k="job" label="Job title" value={e.jobTitle} required />
        <Val k="link" label="Link zum Online-Formular" field="link" value={e.link} />
        <p className="jr-q">{Q.rav}</p>
        <Pick label="" options={['No', 'Yes']} chosen={e.assigned ? 'Yes' : 'No'} />
        <p className="jr-q">{Q.rate}</p>
        <Pick label="" options={['Vollzeit', 'Teilzeit']} chosen={e.fullTime ? 'Vollzeit' : 'Teilzeit'} />
        <p className="jr-q">{Q.result}</p>
        <Pick label="" options={['Vorstellungsgespräch', 'Noch offen', 'Anstellung', 'Absage']} chosen={e.result} />
      </div>

      <div className="jr-nav">
        <button type="button" className="btn-secondary" disabled={idx === 0} onClick={() => setI(idx - 1)}>{t('jr.back')}</button>
        {a.jobroomDone
          ? <button type="button" className="btn-secondary" onClick={() => onUpdate(a.id, { jobroomDone: undefined })}>{t('jr.undo')}</button>
          : <>
              <button type="button" className="btn-secondary jr-copyfill" onClick={() => copy('fill', JSON.stringify(fillPayload(a)))}>{copied === 'fill' ? ICON_CHECK : t('jr.copyFill')}</button>
              <button type="button" className="btn btn-glow jr-entered" onClick={entered}>{ICON_CHECK}{t('jr.enteredBtn')}</button>
            </>}
        <button type="button" className="btn-secondary" disabled={idx === rows.length - 1} onClick={() => setI(idx + 1)}>{t('jr.next')}</button>
      </div>
      {done === rows.length && <p className="jr-all">{ICON_CHECK}{t('jr.all')}</p>}
      {/* 2026-10-14 owner: "what happens when the gov changes a field?" - the fields live in one place; a changed form is one tap away */}
      <p className="jr-form-check">{t('jr.formChecked').replace('{date}', FORM_CHECKED)}{' '}
        <a target="_blank" rel="noopener noreferrer" href={'/contact?service=' + encodeURIComponent('JobTrack') + '&msg=' + encodeURIComponent("Job-Room's ENTER form has changed. Field: ")}>{t('jr.formTell')}</a></p>
    </div>
  )
}

export type { JobRoomEntry }
