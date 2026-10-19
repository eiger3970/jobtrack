import FillRate from './fill_rate'
import FindDetails from './find_details'
import { useEffect, useState } from 'react'
import { swissDate, type Application, type JobRoomEntry, JR_METHOD, jobRoomEntry, jobRoomMissing, looksWrong } from '../lib/orp'
import { parseAd } from '../lib/ad_parse'
import { fillPayload, FILL_KEY } from '../lib/jobroom_fill'
import { useProKey, buyPro } from '../lib/pro'
import { isApp } from '../lib/platform'
import { PRO_KEY, PRO_USD, PRO_SCOPE } from './job_track_pro'

// 2026-10-14: the date Job-Room's ENTER form was last checked against these fields
const FORM_CHECKED = '14.10.2026'

// anonymous random id of this browser, only used to count the one free auto fill
function deviceId(): string {
  try {
    let d = localStorage.getItem('kworld_jobtrack_device')
    if (!d) { d = crypto.randomUUID(); localStorage.setItem('kworld_jobtrack_device', d) }
    return d
  } catch { return '' }
}

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

// remembers the selected job while the panel swaps to the set-up window and back (resets on page reload)
let KEEP: { id: number; picked: boolean; visited?: boolean } | null = null

export default function JobRoomHelper({ rows, allApps, monthLabel, onUpdate, t, onSetup }: {
  allApps?: Application[]; rows: Application[]; monthLabel: string; onUpdate: (id: number, patch: Patch) => void; t: (k: string) => string; onSetup?: () => void
}) {
  const firstOpen = Math.max(0, rows.findIndex(a => !a.jobroomDone))
  const keptAt = KEEP ? rows.findIndex(r => r.id === KEEP!.id) : -1
  const [i, setI] = useState(keptAt >= 0 ? keptAt : firstOpen)
  // guidance: 3.1 glows until a square is tapped, then 3.3 (3.2 only when Job-Room's required details are missing)
  const [picked, setPicked] = useState(keptAt >= 0 && KEEP!.picked)
  // the Job-Room link in 3.3 has been tapped: 3.3 stops glowing and the Entered button glows next
  const [visited, setVisited] = useState(keptAt >= 0 && !!KEEP!.visited)
  const [copied, setCopied] = useState('')
  const done = rows.filter(a => a.jobroomDone).length
  const [ad, setAd] = useState('')
  // which field is being edited (pencil): its value becomes a text box with the text in it
  const [editKey, setEditKey] = useState('')
  if (rows.length === 0) return null
  const idx = Math.min(i, rows.length - 1)
  const a = rows[idx]
  const e = jobRoomEntry(a)
  const missing = jobRoomMissing(e)
  // the card on screen is what JobTrack fill (on Job-Room) picks up
  // 2026-10-19 owner: auto fill is the paid tier (US$5 once), 1 free job as a trial; the fill window checks the trial on the server
  const { pro: webPro } = useProKey(PRO_KEY, 'jobtrack-pro-')
  const pro = webPro || isApp()
  try { localStorage.setItem(FILL_KEY, JSON.stringify({ ...fillPayload(a), pro, card: String(a.id), device: deviceId() })) } catch { /* private mode */ }
  // empty fields Job-Room asks for (required or not) - the ones worth finding
  const gaps = ([['street', e.street], ['postal', e.postal], ['city', e.city], ['contactPerson', e.contactPerson], ['email', e.email], ['phone', e.phone], ['link', e.link]] as const)
    .filter(([, v]) => !v).map(([k]) => t('jr.f.' + k))
  const [adNote, setAdNote] = useState('')
  const [found, setFound] = useState<{ statusHint: string; siteDomain: string; urls: string[] }>({ statusHint: '', siteDomain: '', urls: [] })
  function fillFromAd(text: string = ad) {
    const p = parseAd(text)
    const patch: Partial<Application> = {}
    const put = (k: keyof Application, v: string | undefined, have: string) => { if (v && !have) (patch as any)[k] = v }
    put('street', p.street, e.street); put('streetNo', p.streetNo, e.streetNo); put('postal', p.postal, e.postal); put('city', p.city, e.city)
    put('contactPerson', p.contactPerson, e.contactPerson); put('email', p.email, e.email); put('phone', p.phone, e.phone); put('link', p.link, e.link)
    if (!a.adText) patch.adText = text.slice(0, 20000) // kept as proof if the ad page goes 404
    setFound({ statusHint: p.statusHint, siteDomain: p.siteDomain, urls: p.urls })
    const filled = Object.keys(patch).filter(k => k !== 'adText')
    if (Object.keys(patch).length) onUpdate(a.id, patch)
    // 2026-10-15 owner: pasting fills straight away; say what happened (it only fills boxes that are empty)
    setAdNote(filled.length ? t('jr.adDone').replace('{list}', filled.join(', ')) : (p.postal || p.city || p.street ? t('jr.adHave') : (p.statusHint || p.siteDomain ? t('jr.adEmailOnly') : t('jr.adNone'))))
    setAd('')
  }

  // the date is shown DD.MM.YYYY but stored YYYY-MM-DD; a date that doesn't parse is ignored
  function save(field: keyof Application, v: string) {
    if (field === 'date') {
      const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
      if (!m) return
      v = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    }
    if ((field === 'company' || field === 'role') && !v) return
    onUpdate(a.id, { [field]: v } as Patch)
  }

  async function copy(key: string, value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(''), 1200) } catch { /* no clipboard */ }
  }

  // a text value: shown with Copy; empty -> an input right here (amber if Job-Room needs it)
  const Val = ({ k, label, field, value, required = false }: { k: string; label: string; field?: keyof Application; value: string; required?: boolean }) => (
    <div className={'jr-row' + (!value && required ? ' jr-need' : '') + (field && looksWrong(field, value) ? ' jr-odd' : '')}>
      <span className="jr-label">{label}{field && looksWrong(field, value) && <span className="jr-odd-tag">{t('jr.odd')}</span>}</span>
      {value && field && editKey === k
        ? <input className="jr-input" autoFocus defaultValue={value}
            onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
            onBlur={ev => { save(field, ev.target.value.trim()); setEditKey('') }} />
        : value
        // 2026-10-14 owner: tap the text itself to edit - no pencil step
        ? <span className={'jr-value' + (field ? ' jr-tapedit' : '')} role={field ? 'button' : undefined} tabIndex={field ? 0 : undefined}
            onClick={field ? () => setEditKey(k) : undefined} onKeyDown={field ? ev => { if (ev.key === 'Enter') setEditKey(k) } : undefined}>{value}</span>
        : field
          ? <input className="jr-input" placeholder={required ? t('jr.needed') : t('jr.optional')} defaultValue=""
              onBlur={ev => { const v = ev.target.value.trim(); if (v) save(field, v) }} />
          : <span className="jr-value jr-empty">-</span>}
      {value && editKey !== k && <span className="jr-acts">
        <button type="button" className="jr-copy" onClick={() => copy(k, value)}>{copied === k ? ICON_CHECK : t('orp.copy')}</button>
        {/* 2026-10-14 owner: a quick delete as well as edit */}
        {field && !['date', 'company', 'role'].includes(field) && <button type="button" className="jr-del" aria-label={t('action.delete')} title={t('action.delete')} onClick={() => onUpdate(a.id, { [field]: '' } as Patch)}>
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg></button>}
      </span>}
    </div>
  )
  // a choice in Job-Room: the option to tick, highlighted (nothing to copy)
  const Pick = ({ label, options, chosen }: { label: string; options: string[]; chosen: string }) => (
    <div className="jr-row">
      <span className="jr-label">{label}</span>
      <span className="jr-picks">{options.map(o => <span key={o} className={'jr-pick' + (o === chosen ? ' on' : '')}>{o === chosen && ICON_CHECK}{o}</span>)}</span>
    </div>
  )

  // 2026-10-15 owner: coming back from Job-Room, fold up the job's details so "Entered in Job-Room" is right there (no scrolling)
  // leaving this tab/window after picking a job = off to Job-Room by whatever route (link, own tab, other window)
  useEffect(() => {
    const away = () => { if (picked && !a.jobroomDone) { setVisited(true); if (KEEP) KEEP.visited = true } }
    const vis = () => { if (document.visibilityState === 'hidden') away() }
    document.addEventListener('visibilitychange', vis); window.addEventListener('blur', away)
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('blur', away) }
  })
  // 2026-10-15 owner: when everything Job-Room needs is there (the ticks), the details start folded
  const completeAt = (n: number) => (rows[n] ? jobRoomMissing(jobRoomEntry(rows[n])).length === 0 : false)
  const [lastOk, setLastOk] = useState<string | null>(null)  // '' = never, null = not loaded / offline
  useEffect(() => { fetch('/api/fill-ok?country=CH').then(r => r.json()).then(d => setLastOk(typeof d.last === 'string' ? d.last : null)).catch(() => setLastOk(null)) }, [])
  const [folded, setFolded] = useState(() => completeAt(firstOpen))
  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible' && picked && !a.jobroomDone && missing.length === 0) setFolded(true) }
    document.addEventListener('visibilitychange', back); window.addEventListener('focus', back)
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back) }
  })

  const incompleteNow = missing.length > 0
  function entered() {
    fetch('/api/fill-ok', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ country: 'CH' }) }).catch(() => {})
    setPicked(false); setVisited(false)
    KEEP = null
    onUpdate(a.id, { jobroomDone: new Date().toISOString().slice(0, 10) })
    const next = rows.findIndex((r, n) => n > idx && !r.jobroomDone)
    setI(next >= 0 ? next : idx)
    setFolded(completeAt(next >= 0 ? next : idx))
  }

  return (
    <div className="jr">
      {/* 2026-10-14 owner: 3 steps in the order you do them - 1 pick here, 2 fill gaps here, 3 Job-Room */}
      <p className={'jr-step' + (!picked ? ' jr-glow' : '')}><b className="jts-num">3.1.</b> <b>{t('jr.here')}</b> {t('jr.flow2')}</p>
      <p className="jr-legend">
        <span className="jr-leg"><span className="jr-lg cur" />{t('jr.leg.cur')}</span>
        <span className="jr-leg"><span className="jr-lg done" />{t('jr.leg.done')}</span>
        <span className="jr-leg"><span className="jr-lg todo" />{t('jr.leg.todo')}</span>
        <span className="jr-leg"><span className="jr-lg need" />{t('jr.leg.need')}</span>
      </p>
      <div className="jr-dots" role="tablist">
        {rows.map((r, n) => (
          <button key={r.id} type="button" role="tab" aria-selected={n === idx} aria-label={`${n + 1}. ${r.company}`} title={`${n + 1}. ${r.company} - ${swissDate(r.date)}`}
            className={'jr-dot' + (n === idx ? ' cur' : '') + (r.jobroomDone ? ' done' : '') + (jobRoomMissing(jobRoomEntry(r)).length ? ' need' : '')}
            onClick={() => { KEEP = { id: r.id, picked: true }; setI(n); setPicked(true); setVisited(false); setFolded(completeAt(n)) }}>{n + 1}</button>
        ))}
      </div>

      <div id="jr-step2" className={'jr-step2' + (picked && missing.length > 0 ? ' jr-glow' : '')}><b className="jts-num">3.2.</b> <b>{t('jr.appliedTo')}</b> {a.company}{a.role ? ' - ' + a.role : ''}{a.jobroomDone && <span className="jr-done-tag">{ICON_CHECK}{t('jr.doneTag')}</span>}
        {/* 2026-10-14 owner: "there shouldn't be any empty fields" - fill gaps from the ad, or look them up in one tap */}
        {gaps.length === 0
          ? <p className="jr-nogaps">{ICON_CHECK}{t('jr.nogaps')}</p>
          : <>
              {missing.length === 0 && t('jr.allNeeded').split('|').map(x => <p key={x} className="jr-nogaps">{ICON_CHECK}{x}</p>)}
              <FindDetails key={a.id} a={a} e={e} allApps={allApps} onUpdate={onUpdate} t={t} requiredMissing={missing.length > 0} />
            </>}
        <div><button type="button" className="jr-bm-again" onClick={() => { if (folded) setTimeout(() => document.getElementById('jr-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); setFolded(f => !f) }}>{folded ? t('jr.showDetails') : t('jr.hideDetails')}</button></div>
        {!folded && <div className="jr-card" id="jr-card" key={a.id}>

          {missing.length > 0 ? <p className="jr-warn">{t('jr.missing')}</p> : <p className="jr-ready">{ICON_CHECK}{t('jr.ready')}</p>}
          <p className="jr-q">{Q.when}</p>
          <Val k="date" label="Date" field="date" value={e.date} required />
          <p className="jr-q">{Q.how}</p>
          <Pick label="" options={['Elektronisch', 'Brieflich', 'Persönlich', 'Telefonisch']} chosen={JR_METHOD[e.method]} />
          <p className="jr-q">{Q.where}</p>
          <Val k="biz" label="Business" field="company" value={e.business} required />
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
          <Val k="job" label="Job title" field="role" value={e.jobTitle} required />
          <Val k="link" label="Link zum Online-Formular" field="link" value={e.link} />
          <p className="jr-q">{Q.rav}</p>
          <Pick label="" options={['No', 'Yes']} chosen={e.assigned ? 'Yes' : 'No'} />
          <p className="jr-q">{Q.rate}</p>
          <Pick label="" options={['Vollzeit', 'Teilzeit']} chosen={e.fullTime ? 'Vollzeit' : 'Teilzeit'} />
          <p className="jr-q">{Q.result}</p>
          <Pick label="" options={['Vorstellungsgespräch', 'Noch offen', 'Anstellung', 'Absage']} chosen={e.result} />
        </div>}
      </div>
      <p className={'jr-step' + (picked && !visited && missing.length === 0 ? ' jr-glow' : '')}><b className="jts-num">3.3.</b> <a className="jr-link" href="https://www.job-room.ch/dashboard/job-seeker" target="_blank" rel="noopener noreferrer" onClick={() => { setVisited(true); if (KEEP) KEEP.visited = true }}><b>Job-Room</b></a><b> ({t('jr.autoFill')}):</b> {t('jr.flow1').split('{month}')[0]}<b className="jr-month">{monthLabel}</b>{(t('jr.flow1').split('{month}')[1] ?? '').split('JobTrack fill')[0]}<b className="jr-bmname">JobTrack fill</b>{(() => { const tail = (t('jr.flow1').split('{month}')[1] ?? '').split('JobTrack fill')[1] ?? ''; const eb = t('jr.enteredBtn'); const k = tail.indexOf(eb); return k < 0 ? tail : <>{tail.slice(0, k)}<b className="jr-bmname">{eb}</b>{tail.slice(k + eb.length)}</> })()}
        {!pro && <><br /><span className="jr-trial">{t('jr.trial')} <button type="button" className="btn-secondary jr-bm-back" onClick={() => buyPro({ scope: PRO_SCOPE, amount: PRO_USD, title: 'JobTrack Pro', subtitle: t('jr.proSub') })}>{t('jr.proBtn')}</button></span></>}
        {/* 2026-10-14 owner: the bookmark step must stay findable */}
        {onSetup && <><br /><button type="button" className="btn-secondary jr-bm-back" onClick={onSetup}>{t('jr.noBookmark')}</button></>}</p>
      <div className="jr-nav">
        <button type="button" className="btn-secondary" disabled={idx === 0} onClick={() => setI(idx - 1)}>{t('jr.back')}</button>
        {a.jobroomDone
          ? <button type="button" className="btn-secondary" onClick={() => onUpdate(a.id, { jobroomDone: undefined })}>{t('jr.undo')}</button>
          : <>
              <button type="button" className={'btn jr-entered' + (visited && !incompleteNow ? ' btn-glow' : '')} onClick={entered}>{ICON_CHECK}{t('jr.enteredBtn')}</button>
            </>}
        <button type="button" className="btn-secondary" disabled={idx === rows.length - 1} onClick={() => setI(idx + 1)}>{t('jr.next')}</button>
      </div>
      <FillRate country="CH" t={t} />
      {done === rows.length && <p className="jr-all">{ICON_CHECK}{t('jr.all')}</p>}
      {/* 2026-10-14 owner: "what happens when the gov changes a field?" - the fields live in one place; a changed form is one tap away */}
      <p className="jr-form-check">{(() => {
          const parts = t('jr.formChecked').replace('{date}', FORM_CHECKED).split('|')
          const fresh = lastOk && (Date.now() - new Date(lastOk + 'T12:00:00').getTime()) < 14 * 86400000
          const first = lastOk === null ? parts[0] : fresh ? t('jr.formOk').replace('{date}', swissDate(lastOk)) : t('jr.formStale')
          return <><span>{first}</span><br /><span>{parts[1]}</span></>
        })()}{' '}
        {!isApp() && <a target="_blank" rel="noopener noreferrer" href={'/contact?help=1&msg=' + encodeURIComponent("Job-Room's ENTER form has changed. Field: ")}>{t('jr.formTell')}</a>}</p>
    </div>
  )
}

export type { JobRoomEntry }
