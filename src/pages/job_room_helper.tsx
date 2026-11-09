import FillRate from './fill_rate'
import FindDetails, { MissingDetailsKey } from './find_details'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { swissDate, type Application, JR_METHOD, jobRoomEntry, jobRoomMissing, looksWrong } from '../lib/orp'
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
export function resetJobRoomSelection() { KEEP = null }

type JobRoomHelperProps = {
  allApps?: Application[]; rows: Application[]; monthLabel: string; onUpdate: (id: number, patch: Patch) => void; t: (k: string) => string; onSetup?: () => void; cleanupOnly?: boolean; mobile?: boolean; manual?: boolean; fillChoice?: ReactNode; fillNext?: (glow: boolean) => ReactNode; fillReady?: boolean
}

export default function JobRoomHelper(props: JobRoomHelperProps) {
  // Keep hook order stable when changing between empty and populated months.
  if (!props.rows.length) return <p className="orp-empty-period" role="status">{props.t('jr.emptyPeriod')}</p>
  return <JobRoomHelperContent {...props} />
}

function JobRoomHelperContent({ rows, allApps, monthLabel, onUpdate, t, onSetup, cleanupOnly = false, mobile = false, manual = false, fillChoice, fillNext, fillReady = true }: JobRoomHelperProps) {
  const firstMissing = rows.findIndex(a => !a.jobroomDone && jobRoomMissing(jobRoomEntry(a)).length > 0)
  const firstAmber = rows.findIndex(a => !a.jobroomDone && jobRoomMissing(jobRoomEntry(a)).length === 0)
  const nextSquare = firstMissing >= 0 ? firstMissing : firstAmber
  const firstOpen = Math.max(0, nextSquare)
  const keptAt = !cleanupOnly && KEEP ? rows.findIndex(r => r.id === KEEP!.id) : -1
  const [i, setI] = useState(keptAt >= 0 ? keptAt : firstOpen)
  // After choosing a job, guide the user through 3.2, then 3.3.
  const [picked, setPicked] = useState(keptAt >= 0 && KEEP!.picked)
  // the Job-Room link in 3.3 has been tapped: 3.3 stops glowing and the Entered button glows next
  const [visited, setVisited] = useState(keptAt >= 0 && !!KEEP!.visited)
  const [copied, setCopied] = useState('')
  const done = rows.filter(a => a.jobroomDone).length
  // which field is being edited (pencil): its value becomes a text box with the text in it
  const [editKey, setEditKey] = useState('')
  const idx = Math.min(i, rows.length - 1)
  const a = rows[idx]
  const storedEntry = jobRoomEntry(a)
  const [aiPreview, setAiPreview] = useState<{ id: number; patch: Patch } | null>(null)
  const previewFields = aiPreview?.id === a.id ? Object.fromEntries(Object.entries(aiPreview.patch).filter(([key]) => !(a as unknown as Record<string, unknown>)[key])) : {}
  const e = jobRoomEntry({ ...a, ...previewFields })
  const missing = jobRoomMissing(storedEntry)
  // the card on screen is what Job-Room fill (on Job-Room) picks up
  // 2026-10-19 owner: auto fill is the paid tier (US$5 once), 1 free job as a trial; the fill window checks the trial on the server
  const { pro: webPro } = useProKey(PRO_KEY, 'jobtrack-pro-')
  const pro = webPro || isApp()
  const allEntered = rows.every(r => !!r.jobroomDone)
  const readyForForm = missing.length === 0 || allEntered
  const enteringForm = !cleanupOnly && readyForForm && fillReady
  // Next was tapped: step 3.3 is now the thing to do, so put it at the top of the panel (the blank room below it lets it reach the top)
  const wasFill = useRef(false)   // false on mount too: the Auto route comes back from the setup step with the fill already ready
  useEffect(() => {
    if (!wasFill.current && fillReady && readyForForm && !cleanupOnly && !mobile) {
      // content above 3.3 can still grow (a late AI result), so keep it pinned to the top for a few seconds unless the person scrolls
      const body = document.querySelector('.orp-body')
      let tick: ReturnType<typeof setInterval> | undefined
      const stop = () => { clearInterval(tick); for (const ev of ['wheel', 'touchstart', 'mousedown', 'keydown']) body?.removeEventListener(ev, stop) }
      setTimeout(() => {
        document.getElementById('jr-step3')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        if (!body) return
        for (const ev of ['wheel', 'touchstart', 'mousedown', 'keydown']) body.addEventListener(ev, stop, { once: true })
        let n = 0
        tick = setInterval(() => {
          const el = document.getElementById('jr-step3')
          if (!el || ++n > 20) return stop()
          if (Math.abs(el.getBoundingClientRect().top - body.getBoundingClientRect().top) > 12) el.scrollIntoView({ behavior: 'auto', block: 'start' })
        }, 500)
      }, 150)
    }
    wasFill.current = fillReady
  }, [fillReady]) // eslint-disable-line react-hooks/exhaustive-deps
  // the card just became complete (e.g. "Use this address"): the next action is the Auto/Manual choice below, so bring it into view
  const tappedIn32 = useRef(false)   // 2026-11-09 owner: a card the auto-search completes by itself must stay at 1.2 on the phone - only a tap inside 1.2 (e.g. Use this address) moves on to 1.3
  const wasReady = useRef({ id: a.id, ready: readyForForm })   // same card only: picking another job must not jump to the choice
  useEffect(() => {
    if (wasReady.current.id === a.id && !wasReady.current.ready && readyForForm && !cleanupOnly && (mobile ? tappedIn32.current : !fillReady)) setTimeout(() => (mobile ? document.getElementById('jr-step3') : document.querySelector('.orp-entry-choice'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)   // phone: no choice, the next step is 3.3 itself
    wasReady.current = { id: a.id, ready: readyForForm }
  }, [readyForForm, a.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const hasGap = (r: Application) => !r.jobroomDone && jobRoomMissing(jobRoomEntry(r)).length > 0   // red squares only, so the count matches what the user sees
  const hasMissingDetails = missing.length > 0 || [storedEntry.street, storedEntry.postal, storedEntry.city, storedEntry.contactPerson, storedEntry.email, storedEntry.phone, storedEntry.link].some(value => !value)
  const [s32Seen, setS32Seen] = useState(false)
  const glow32 = picked && !s32Seen && !visited
  const glow33 = !visited   // 3.3 only renders once the job is ready: glow until the Job-Room link is tapped
  try { localStorage.setItem(FILL_KEY, JSON.stringify({ ...fillPayload(a), pro, card: String(a.id), device: deviceId() })) } catch { /* private mode */ }

  // the date is shown DD.MM.YYYY but stored YYYY-MM-DD; a date that doesn't parse is ignored
  function save(field: keyof Application, v: string) {
    if (field === 'date') {
      const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
      if (!m) return
      v = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    }
    if ((field === 'company' || field === 'role') && !v) return
    onUpdate(a.id, (field === 'link' ? { link: v, linkFrom: 'user' } : { [field]: v }) as Patch)
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
        {field && !['date', 'company', 'role'].includes(field) && <button type="button" className="jr-del" aria-label={t('action.delete')} title={t('action.delete')} onClick={() => onUpdate(a.id, (field === 'link' ? { link: '', linkFrom: undefined } : { [field]: '' }) as Patch)}>
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
  const showAiPreview = useCallback((id: number, patch: Patch) => { setAiPreview({ id, patch }); setFolded(false); setS32Seen(true) }, [])
  function chooseJob(n: number) {
    if (!rows[n]) return
    KEEP = { id: rows[n].id, picked: true }
    tappedIn32.current = false; setI(n); setPicked(true); setVisited(false); setFolded(completeAt(n)); setS32Seen(false)
    // no gaps: the next action is the Auto/Manual choice or 3.3, so go there; otherwise 3.2
    if (completeAt(n) && !rows[n].jobroomDone) setTimeout(() => (document.querySelector('.orp-entry-choice') || document.getElementById('jr-step3') || document.getElementById('jr-step2'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
    else requestAnimationFrame(() => document.getElementById('jr-step2')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  // 2026-11-03 owner: coming back from Job-Room must not change the view - no fold, no scroll

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
      <div className="jr-head">
      <p className="jr-step"><b className="jts-num">{mobile ? '1.1.' : cleanupOnly ? '1.' : '3.1.'}</b> <b>{t(mobile ? 'jr.phoneChoose' : 'jr.here')}</b></p>
      </div>
      <p className="jr-legend">
        <span className="jr-leg"><span className="jr-lg done" />{t('jr.leg.done')}</span>
        <span className="jr-leg"><span className="jr-lg todo" />{t('jr.leg.todo')}</span>
        <span className="jr-leg"><span className="jr-lg need" />{t('jr.leg.need')}</span>
      </p>
      <div className="jr-dots" role="tablist">
        <svg className="jr-tapme" viewBox="0 0 24 24" width="26" height="26" role="img" aria-label={t('jr.flow2')}><path fill="#00ff41" d="M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.69-5.1c.01-.07.02-.13.02-.2 0-.62-.38-1.16-.91-1.38z" /></svg>
        {rows.map((r, n) => (
          <button key={r.id} type="button" role="tab" aria-selected={n === idx} aria-label={`${n + 1}. ${r.company}`} title={`${n + 1}. ${r.company} - ${swissDate(r.date)}`}
            className={'jr-dot' + (!picked && nextSquare >= 0 && n === nextSquare ? ' glow jt-guidance-glow' : '') + (r.jobroomDone ? ' done' : '') + (jobRoomMissing(jobRoomEntry(r)).length ? ' need' : '')}
            onClick={() => chooseJob(n)}>{n + 1}</button>
        ))}
      </div>

      <div key={`${a.id}-${idx}`} id="jr-step2" hidden={allEntered} className={'jr-step2' + (glow32 ? ' jr-glow jt-guidance-glow' : '')} onClick={() => { tappedIn32.current = true; setS32Seen(true) }}><b className="jts-num">{mobile ? '1.2.' : cleanupOnly ? '2.' : '3.2.'}</b> <b>{t('jr.appliedTo')}</b> {a.company}{a.role ? ' - ' + a.role : ''}{a.jobroomDone && <span className="jr-done-tag">{ICON_CHECK}{t('jr.doneTag')}</span>}
        {/* 2026-10-14 owner: "there shouldn't be any empty fields" - fill gaps from the ad, or look them up in one tap */}
        {hasMissingDetails
          ? <FindDetails mobile={mobile} autoSearch={picked && !a.jobroomDone && !allEntered} key={`${a.id}-${idx}`} a={a} e={storedEntry} live={e} onPreview={showAiPreview} allApps={allApps} onUpdate={onUpdate} t={t} requiredMissing={missing.length > 0} />
          : <p className="jr-nogaps">{ICON_CHECK}{t('jr.nogaps')}</p>}
      </div>
      <div hidden={allEntered}>
        <details className="fd-fold" open={!folded} onToggle={x => { const isOpen = (x.target as HTMLDetailsElement).open; if (isOpen && folded) setTimeout(() => document.getElementById('jr-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); setFolded(!isOpen) }}><summary className="fd-fold-ico"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" /></svg><span>{t('jr.replica')}</span></summary></details>
        {!folded && <div className="jr-card" id="jr-card" key={a.id}>

          <MissingDetailsKey e={storedEntry} t={t} />
          {missing.length === 0 && <p className="jr-ready">{ICON_CHECK}{t('jr.ready')}</p>}
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
          <Val k="email" label="Email" field="email" value={e.email} required={e.method === 'electronic' && !e.linkIsJob} />
          <Val k="phone" label="Phone number" field="phone" value={e.phone} />
          <p className="jr-q">{Q.job}</p>
          <Val k="job" label="Job title" field="role" value={e.jobTitle} required />
          <Val k="link" label="Link zum Online-Formular" field="link" value={e.link} required={e.method === 'electronic' && !e.email} />
          <p className="jr-q">{Q.rav}</p>
          <Pick label="" options={['No', 'Yes']} chosen={e.assigned ? 'Yes' : 'No'} />
          <p className="jr-q">{Q.rate}</p>
          <Pick label="" options={['Vollzeit', 'Teilzeit']} chosen={e.fullTime ? 'Vollzeit' : 'Teilzeit'} />
          <p className="jr-q">{Q.result}</p>
          <Pick label="" options={['Vorstellungsgespräch', 'Noch offen', 'Anstellung', 'Absage']} chosen={e.result} />
        </div>}
      {/* 2026-10-14 owner: "what happens when the gov changes a field?" - the fields live in one place; a changed form is one tap away */}
      {!folded && <p className="jr-form-check">{(() => {
          const parts = t('jr.formChecked').replace('{date}', FORM_CHECKED).split('|')
          const fresh = lastOk && (Date.now() - new Date(lastOk + 'T12:00:00').getTime()) < 60 * 86400000
          const first = !lastOk ? parts[0] : fresh ? t('jr.formOk').replace('{date}', swissDate(lastOk)) : t('jr.formStale').replace('{date}', swissDate(lastOk))
          return <><span>{first}</span><br /><span>{parts[1]}</span></>
        })()}{' '}
        {!isApp() && <a target="_blank" rel="noopener noreferrer" href={'/contact?help=1&msg=' + encodeURIComponent("Job-Room's ENTER form has changed. Field: ")}>{t('jr.formTell')}</a>}</p>}
      </div>
      {!cleanupOnly && readyForForm && fillChoice}
      {!cleanupOnly && readyForForm && fillReady && (mobile || manual ? <p id="jr-step3" className={'jr-step' + (glow33 ? ' jr-glow jt-guidance-glow' : '')}><b className="jts-num">{mobile ? '1.3.' : '3.3.'}</b> <a className={'jr-link' + (glow33 ? ' jt-guidance-glow' : '')} href="https://www.job-room.ch/dashboard/job-seeker" target="_blank" rel="noopener noreferrer" onClick={() => { setVisited(true); if (KEEP) KEEP.visited = true }}><b>Job-Room</b></a>{glow33 && <small className="jr-newtab"> {t('jr.newTab')}</small>}<b>:</b> {(() => { const [pre, post = ''] = t('jr.flowCopy').split('{month}'); const eb = t('jr.enteredBtn'); const k = post.indexOf(eb); return <>{pre}<b className="jr-month">{monthLabel}</b>{k < 0 ? post : <>{post.slice(0, k)}<b className="jr-bmname">{eb}</b>{post.slice(k + eb.length)}</>}</> })()}</p> : <>
      <p id="jr-step3" className={'jr-step' + (glow33 ? ' jr-glow jt-guidance-glow' : '')}><b className="jts-num">3.3.</b> <a className={'jr-link' + (glow33 ? ' jt-guidance-glow' : '')} href="https://www.job-room.ch/dashboard/job-seeker" target="_blank" rel="noopener noreferrer" onClick={() => { setVisited(true); if (KEEP) KEEP.visited = true }}><b>Job-Room</b></a>{glow33 && <small className="jr-newtab"> {t('jr.newTab')}</small>}<b> ({t('jr.autoFill')}):</b> {t('jr.flow1').split('{month}')[0]}<b className="jr-month">{monthLabel}</b>{(t('jr.flow1').split('{month}')[1] ?? '').split('Job-Room fill')[0]}<b className="jr-bmname">Job-Room fill</b>{(() => { const tail = (t('jr.flow1').split('{month}')[1] ?? '').split('Job-Room fill')[1] ?? ''; const eb = t('jr.enteredBtn'); const k = tail.indexOf(eb); return k < 0 ? tail : <>{tail.slice(0, k)}<b className="jr-bmname">{eb}</b>{tail.slice(k + eb.length)}</> })()}
        {!pro && <><br /><span className="jr-trial">{t('jr.trial')} <button type="button" className="btn-secondary jr-bm-back" onClick={() => buyPro({ scope: PRO_SCOPE, amount: PRO_USD, title: 'JobTrack Pro', subtitle: t('jr.proSub') })}>{t('jr.proBtn')}</button></span></>}
        {/* 2026-10-14 owner: the bookmark step must stay findable */}
        {onSetup && <><br /><button type="button" className="btn-secondary jr-bm-back" onClick={onSetup}>{t('jr.noBookmark')}</button></>}</p>
      </>)}

      <div className="jr-nav">
        <button type="button" className="btn-secondary" disabled={idx === 0} onClick={() => chooseJob(idx - 1)}>{t('jr.back')}</button>
        {!cleanupOnly && readyForForm && fillReady && (a.jobroomDone
          ? <button type="button" className="btn-secondary" onClick={() => onUpdate(a.id, { jobroomDone: undefined })}>{t('jr.undo')}</button>
          : <>
              <button type="button" className={(visited && !incompleteNow ? 'btn btn-glow jt-guidance-glow' : 'btn-secondary') + ' jr-entered'} onClick={entered}>{ICON_CHECK}{t('jr.enteredBtn')}</button>
            </>)}
        {enteringForm
          ? (a.jobroomDone
              ? <button type="button" className="btn-secondary" disabled={idx === rows.length - 1} onClick={() => chooseJob(idx + 1)}>{t('jr.next')}</button>   // Entered in Job-Room already moves on, so Next is only for a done job
              : (() => {
                  const order = [...rows.keys()].map(k => (idx + 1 + k) % rows.length).filter(n => n !== idx && hasGap(rows[n]))
                  return order.length > 0 && <button type="button" id="jr-nextgap" className="btn-secondary" onClick={() => chooseJob(order[0])}>{t('jr.nextGap')} ({order.length} {t('jr.toGo')})</button>
                })())
          : (() => {
              const order = [...rows.keys()].map(k => (idx + 1 + k) % rows.length).filter(n => n !== idx && hasGap(rows[n]))
              return <button type="button" className={'btn-secondary' + (order.length ? ' btn-glow jt-guidance-glow' : '')} disabled={!order.length} onClick={() => chooseJob(order[0])}>{t('jr.nextGap')} ({order.length} {t('jr.toGo')})</button>
            })()}
        {!cleanupOnly && readyForForm && fillNext?.(!rows.some(hasGap))}
      </div>
      {!mobile && !manual && !cleanupOnly && readyForForm && fillReady && <FillRate country="CH" t={t} />}
      {done === rows.length && <p className="jr-all">{ICON_CHECK}{t('jr.all')}</p>}

    </div>
  )
}
