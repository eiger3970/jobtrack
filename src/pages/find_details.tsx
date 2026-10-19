import { useState, useEffect, type ReactNode } from 'react'
import { swissDate, type Application, type JobRoomEntry } from '../lib/orp'
import { parseAd } from '../lib/ad_parse'
import { useProKey, buyPro } from '../lib/pro'
import { isApp } from '../lib/platform'
import { PRO_KEY, PRO_USD, PRO_SCOPE } from './job_track_pro'

// the iPhone app has no same-origin site, it calls the worker directly (phones reach workers.dev fine)
const APP_FIND_URL = 'https://cvgen-writer.kinhswch-cloudflare.workers.dev/find-details'
type AiState = 'idle' | 'busy' | 'result' | 'used' | 'cap' | 'none' | 'err'

// 2026-10-19 owner: the two "missing" lists disagreed and 3.2 was disjointed. Now ONE list of what is missing (exact
// Job-Room names, amber = needed) on top, then where to look from easiest to hardest, one paste box, typing as the last resort.
type Patch = Partial<Application>
type Rec = Record<string, string>
type Loc = Record<string, any>  // an office from the AI: strings plus likelyForJob / headOffice flags and a count

// exact names as on the Job-Room form (same as the card below); needed = Job-Room will not save without it
const FIELDS: { k: string; label: string; needed?: boolean }[] = [
  { k: 'street', label: 'Street' }, { k: 'streetNo', label: 'No.' }, { k: 'postal', label: 'Postal code', needed: true },
  { k: 'city', label: 'City', needed: true }, { k: 'contactPerson', label: 'Kontaktperson' }, { k: 'email', label: 'Email' },
  { k: 'phone', label: 'Phone number' }, { k: 'link', label: 'Link zum Online-Formular' },
]

// mini bar graph, n of 10 bars filled (taller to the right)
export function Score({ n }: { n: number }) {
  return <svg className="fd-score" viewBox="0 0 40 20" width="40" height="20" role="img" aria-label={`${n} / 10`}>
    {Array.from({ length: 10 }, (_, i) => <rect key={i} x={i * 4} y={18 - (i + 1) * 1.8} width="3" height={(i + 1) * 1.8 + 2} rx="0.6" fill={i < n ? '#00ff41' : '#3a3a4e'} />)}
  </svg>
}

const Ico = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="fd-ico"><path d={d} /></svg>
const BUILDING = 'M4 21V3h10v18M14 9h6v12M8 7h2M8 11h2M8 15h2M3 21h18'
const PIN = 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'

// small "i" that floats a light note over the page for 7 seconds - nothing moves
function InfoI({ text }: { text: string }) {
  const [on, setOn] = useState(false)
  useEffect(() => { if (!on) return; const id = setTimeout(() => setOn(false), 7000); return () => clearTimeout(id) }, [on])
  return <span className="fd-ibox"><button type="button" className="fd-i" aria-label={text} aria-expanded={on} onClick={e => { e.stopPropagation(); setOn(v => !v) }}>i</button>{on && <span className="fd-pop" role="status">{text}</span>}</span>
}

// the copy button sits inside the sentence, in place of its first words
function CopyBtn({ text, label, t }: { text: string; label: string; t: (k: string) => string }) {
  const [done, setDone] = useState(false)
  return <button type="button" className="fd-copy" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000) }).catch(() => {})}>{done ? t('fd.copied') : label}</button>
}

// "{copy} -> open ..." : tokens in the sentence become the given nodes
function flow(s: string, map: Record<string, ReactNode>): ReactNode[] {
  return s.split(/(\{\w+\})/).map((part, i) => { const m = part.match(/^\{(\w+)\}$/); return m && m[1] in map ? <span key={i}>{map[m[1]]}</span> : part })
}

const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

export default function FindDetails({ a, e, allApps, onUpdate, t, requiredMissing }: {
  a: Application; e: JobRoomEntry; allApps?: Application[]; onUpdate: (id: number, patch: Patch) => void; t: (k: string) => string; requiredMissing: boolean
}) {
  const ev = e as unknown as Rec
  const twin = (allApps ?? []).find(o => o.id !== a.id && norm(o.company) === norm(a.company) && o.postal && o.city)
  const gaps = FIELDS.filter(f => !ev[f.k])
  const needAddr = !e.postal || !e.city || !e.street
  const [open, setOpen] = useState(requiredMissing)
  const [ad, setAd] = useState('')
  const [ad2, setAd2] = useState('')
  const [note, setNote] = useState('')
  const [site, setSite] = useState('')
  const [rej, setRej] = useState(false)
  const { pro: webPro, tok } = useProKey(PRO_KEY, 'jobtrack-pro-')
  const app = isApp()
  const pro = webPro || app
  const [ai, setAi] = useState<AiState>('idle')
  const [aiRuns, setAiRuns] = useState<Loc[][]>([])
  const [aiContact, setAiContact] = useState<Rec>({})
  const [aiPick, setAiPick] = useState(0)
  const [aiSrc, setAiSrc] = useState<{ title: string; uri: string }[]>([])
  const [aiErr, setAiErr] = useState('')
  const [aiMsg, setAiMsg] = useState('')
  // 2026-10-19 owner: eight choices must not look like eight steps - rows stay closed until one is tapped
  const [openOpt, setOpenOpt] = useState('')
  const isOpen = (id: string) => openOpt === id || (id === 'ai' && ai !== 'idle')
  const toggle = (id: string) => { if (id === 'ai' && ai !== 'idle') return; setOpenOpt(o => (o === id ? '' : id)) }

  // mode: new search | check (same question again, to compare) | wrong ("Not right": look elsewhere)
  async function findWithAi(mode: 'new' | 'check' | 'wrong' = 'new') {
    const retry = mode !== 'new'
    setAi('busy'); setAiErr(''); setAiMsg('')
    let device = ''
    try { device = localStorage.getItem('kworld_jobtrack_device') ?? ''; if (!device) { device = crypto.randomUUID(); localStorage.setItem('kworld_jobtrack_device', device) } } catch { /* private mode */ }
    // 2026-10-19 owner: nobody waits on a busy AI. The best engine goes first; if it is busy the next one runs at once,
    // and the person is told. Only engines that search the web are used - one without would guess an address.
    for (const [i, engine] of ['claude', 'claude2', 'gemini'].entries()) {
      try {
        const r = await fetch(app ? APP_FIND_URL : '/api/jobtrack/find', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company: a.company, role: a.role, device, proToken: tok, app, engine, retry, avoid: mode === 'wrong' ? aiLocs.map(l => [l.label, l.street, l.streetNo, l.postal, l.city].filter(Boolean).join(' ')).join(' | ') : '', hint: [a.adText, a.notes, a.city].filter(Boolean).join(' ') }), signal: AbortSignal.timeout(22000) })
        const d = await r.json()
        if (d.status === 'trial_used') { setAi('used'); return }
        if (d.status === 'cap') { setAi('cap'); return }
        if (d.status === 'ok') {
          if (!d.found) { setAi('none'); return }
          const locs: Loc[] = d.locations ?? []
          const runs = mode === 'new' ? [locs] : [...aiRuns, locs]
          setAiRuns(runs); setAiContact(c => ({ ...(mode === 'new' ? {} : c), ...(d.contact ?? {}) })); setAiSrc(s => mode === 'new' ? d.sources : [...s, ...d.sources].slice(0, 5)); setAiPick(0); setAi('result'); return
        }
        if (d.status === 'error') { setAiErr(d.detail || ''); setAi('err'); return }
      } catch { /* busy or offline: try the next one */ }
      if (i < 2) setAiMsg(t('ai.switch'))
    }
    setAi('err')
  }
  // every office from every search; "found in n of N searches" = the same answer came back again
  const placeKey = (l: Loc) => (l.street + l.streetNo + l.postal).toLowerCase().replace(/[^a-z0-9]/g, '')
  const aiLocs: Loc[] = (() => {
    const m = new Map<string, Loc>()
    aiRuns.forEach((run, ri) => { for (const l of run) { const k = placeKey(l); const e0 = m.get(k); if (e0) { if (!e0.seen.includes(ri)) { e0.seen.push(ri); e0.n++ } e0.likelyForJob = e0.likelyForJob || l.likelyForJob } else m.set(k, { ...l, n: 1, seen: [ri] }) } })
    return [...m.values()].sort((p, q) => (q.n - p.n) || (Number(!!q.likelyForJob) - Number(!!p.likelyForJob)))
  })()

  // the card may already know the town / postal code: that office is the likely one even when the AI can't tell
  const cardPlace = (a.postal || a.city || '').toString().toLowerCase().trim()
  const sameAsCard = (l: Loc) => !!cardPlace && ([l.postal, l.city].some(v => v && String(v).toLowerCase() === cardPlace))
  useEffect(() => {
    const i = aiLocs.findIndex(sameAsCard)
    if (i >= 0 && !aiLocs.some(l => l.likelyForJob)) setAiPick(i)
  }, [aiRuns.length])

  // sources, quiet: just the site names, each once
  const srcLabels = (() => {
    const seen = new Set<string>(), out: { uri: string; label: string }[] = []
    for (const s of aiSrc) {
      let host = ''
      try { host = new URL(s.uri).hostname.replace(/^www\./, '') } catch { continue }
      const label = host.includes('vertexaisearch') || host.includes('google') ? (s.title || host) : host
      if (!seen.has(label)) { seen.add(label); out.push({ uri: s.uri, label }) }
    }
    return out.slice(0, 4)
  })()

  // no clear answer: several offices and none is marked for this job / matches the card, or the searches disagreed
  const unsure = aiLocs.length > 1 && (!aiLocs.some(l => l.likelyForJob || sameAsCard(l)) || (aiRuns.length > 1 && aiLocs.some(l => l.n < aiRuns.length)))

  function useAi() {
    const loc = aiLocs[aiPick]
    const all: Rec = { ...(loc ? { street: loc.street, streetNo: loc.streetNo, postal: loc.postal, city: loc.city } : {}), ...aiContact }
    const patch: Rec = {}
    for (const [k, v] of Object.entries(all)) if (v && !ev[k]) patch[k] = v
    if (Object.keys(patch).length) onUpdate(a.id, patch as Patch)
    setAi('idle')
  }

  function fill(text: string) {
    const p = parseAd(text)
    const patch: Rec = {}
    const put = (k: string, v: string | undefined, have: string) => { if (v && !have) patch[k] = v }
    put('street', p.street, e.street); put('streetNo', p.streetNo, e.streetNo); put('postal', p.postal, e.postal); put('city', p.city, e.city)
    put('contactPerson', p.contactPerson, e.contactPerson); put('email', p.email, e.email); put('phone', p.phone, e.phone); put('link', p.link, e.link)
    if (!a.adText) patch.adText = text.slice(0, 20000)
    const filled = Object.keys(patch).filter(k => k !== 'adText').map(k => FIELDS.find(f => f.k === k)?.label ?? k)
    if (Object.keys(patch).length) onUpdate(a.id, patch as Patch)
    setSite(p.siteDomain); setRej(p.statusHint === 'rejected' && a.status !== 'rejected')
    setNote(filled.length ? t('jr.adDone').replace('{list}', filled.join(', ')) : (p.postal || p.city || p.street ? t('jr.adHave') : (p.statusHint || p.siteDomain ? t('jr.adEmailOnly') : t('jr.adNone'))))
    setAd(''); setAd2('')
  }
  const q = encodeURIComponent
  const ext = { target: '_blank', rel: 'noopener noreferrer' } as const
  const date = swissDate(a.date)

  const term = `${a.role} ${a.company}`

  // paste target right where the sentence ends; pasting fills the form
  const pasteBox = (val: string, set: (v: string) => void) => <>
    <textarea className="jr-ad" rows={2} placeholder={t('fd.pasteHere')} value={val} onChange={x => set(x.target.value)}
      onPaste={x => { const v = x.clipboardData.getData('text'); if (v.trim().length >= 12) { x.preventDefault(); fill(v) } }} />
    {val.trim() && <button type="button" className="btn-secondary fd-btn" onClick={() => fill(val)}>{t('jr.adFill')}</button>}
    {note && <span className="fd-note">{note}</span>}
    {rej && <button type="button" className="btn-secondary fd-btn" onClick={() => { onUpdate(a.id, { status: 'rejected' }); setRej(false) }}>{t('jr.setRejected')}</button>}
  </>

  return (
    <details className="fd" open={open} onToggle={x => setOpen((x.target as HTMLDetailsElement).open)}>
      <summary className="fd-sum">{requiredMissing ? t('fd.titleNeed') : t('fd.titleMore')}</summary>

      <p className="fd-legend"><span className="fd-sq need" />{t('fd.needL')} <span className="fd-sq" />{t('fd.optL')}</p>
      <p className="fd-chips">{gaps.map(f => <span key={f.k} className={'fd-chip' + (f.needed ? ' need' : '')}>{f.label}</span>)}</p>

      <ol className="fd-list">
        <li>
          <div className={'fd-opt' + (isOpen('ai') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('ai')} onClick={() => toggle('ai')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('ai') } }}>
            <b><Score n={pro ? 10 : 9} /><InfoI text={t('fd.scoreL')} />{t('ai.h')}</b>
            <span className="fd-chev" aria-hidden="true">{isOpen('ai') ? '▾' : '▸'}</span>
          </div>
          {isOpen('ai') && <div className="fd-body">
          {(ai === 'idle' || ai === 'err' || ai === 'none') && <button type="button" className="btn btn-glow fd-btn" onClick={() => findWithAi()}>{pro ? t('ai.btn') : t('ai.btnFree')}</button>}
          {ai === 'busy' && <span className="fd-t fd-busy" role="status"><span className="fd-dots"><i /><i /><i /></span>{aiMsg || t('ai.busy')}</span>}
          {ai === 'none' && <span className="fd-t">{t('ai.none')}</span>}
          {ai === 'err' && <span className="fd-t">{aiErr || t('ai.err')}</span>}
          {ai === 'used' && <>
            <span className="fd-t">{t('ai.used')}</span>
            <button type="button" className="btn btn-glow fd-btn" onClick={() => buyPro({ scope: PRO_SCOPE, amount: PRO_USD, title: 'JobTrack Pro', subtitle: t('jr.proSub') })}>{t('jr.proBtn')}</button>
          </>}
          {ai === 'cap' && <span className="fd-t">{t('ai.cap')}</span>}
          {ai === 'result' && <>
            {aiLocs.map((l, i) => (
              <label key={i} className={'fd-loc' + (i === aiPick ? ' on' : '')}>
                {aiLocs.length > 1 && <input type="radio" name={'ailoc' + a.id} checked={i === aiPick} onChange={() => setAiPick(i)} />}
                <span>
                  <span className="fd-addr fd-data">{[[l.street, l.streetNo].filter(Boolean).join(' '), [l.postal, l.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span>
                  <span className="fd-meta">
                    {l.label && l.label !== l.city && <span className="fd-lbl">{l.label}</span>}
                    {l.headOffice && <i className="fd-tag">{t('ai.head')}</i>}
                    {(l.likelyForJob || sameAsCard(l)) && <i className="fd-tag ok" title={l.why || ''}>{t('ai.likely')}</i>}
                    {aiRuns.length > 1 && <span className="fd-by">{t('ai.foundBy')} {aiRuns.map((_, ri) => <span key={ri} className={l.seen.includes(ri) ? 'y' : 'n'}>{ri + 1}{l.seen.includes(ri) ? '✓' : '✗'}</span>)}</span>}
                  </span>
                </span>
              </label>
            ))}
            {unsure && <div className="fd-next">
              <b>{t('ai.nextH')}</b>
              <span className="fd-t">{t('ai.nextT')}</span>
              <a className="btn btn-glow fd-btn" href={`https://mail.proton.me/u/0/all-mail#keyword=${q(a.company)}`} {...ext}>{t('jr.mailProton')}</a>
              <a className="btn-secondary fd-btn" href={`https://mail.google.com/mail/u/0/#search/${q(a.company)}`} {...ext}>{t('jr.mailGmail')}</a>
            </div>}
            <span className="fd-srcs">{t('ai.src')} {srcLabels.map((s, i) => <a key={i} className="fd-src" href={s.uri} {...ext}>{s.label}</a>)}</span>
            <button type="button" className={(unsure ? 'btn-secondary' : 'btn btn-glow') + ' fd-btn'} onClick={useAi}>{t('ai.use')}</button>
            <span className="fd-two">
              <button type="button" className="btn-secondary fd-btn" onClick={() => findWithAi('check')}>{t('ai.check2')}</button>
              <button type="button" className="btn-secondary fd-btn" onClick={() => findWithAi('wrong')}>{t('ai.no')}</button>
            </span>
            {Object.keys(aiContact).length > 0 && <span className="fd-contact">{Object.entries(aiContact).map(([k, v]) => <span key={k}><i className="fd-ck">{FIELDS.find(f => f.k === k)?.label ?? k}</i> {v}</span>)}</span>}
          </>}
          </div>}
        </li>

        {twin && needAddr && <li>
          <div className={'fd-opt' + (isOpen('twin') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('twin')} onClick={() => toggle('twin')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('twin') } }}>
            <b><Score n={10} />{t('fd.twinH')}</b>
            <span className="fd-chev" aria-hidden="true">{isOpen('twin') ? '▾' : '▸'}</span>
          </div>
          {isOpen('twin') && <div className="fd-body">
          <span className="fd-t">{[[twin.street, twin.streetNo].filter(Boolean).join(' '), [twin.postal, twin.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span>
          <button type="button" className="btn btn-glow fd-btn" onClick={() => {
            const patch: Rec = {}
            for (const k of ['street', 'streetNo', 'postal', 'city'] as const) if (twin[k] && !ev[k]) patch[k] = twin[k] as string
            if (Object.keys(patch).length) onUpdate(a.id, patch as Patch)
          }}>{t('jr.useIt')}</button>
          </div>}
        </li>}

        <li>
          <div className={'fd-opt' + (isOpen('mail') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('mail')} onClick={() => toggle('mail')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('mail') } }}>
            <b><Score n={8} />{t('fd.mailH')}</b>
            <span className="fd-chev" aria-hidden="true">{isOpen('mail') ? '▾' : '▸'}</span>
          </div>
          {isOpen('mail') && <div className="fd-body">
          <p className="fd-flow">{flow(t('fd.flowMail'), {
            date: <b className="fd-data">{date}</b>,
            copy: <CopyBtn text={a.company} label={t('fd.copyCompany')} t={t} />,
            mail: <><a className="fd-lnk" href={`https://mail.proton.me/u/0/all-mail#keyword=${q(a.company)}`} {...ext}>{t('jr.mailProton')}</a> <a className="fd-lnk" href={`https://mail.google.com/mail/u/0/#search/${q(a.company)}`} {...ext}>{t('jr.mailGmail')}</a></>,
          })}</p>
          {pasteBox(ad, setAd)}
          </div>}
        </li>

        <li>
          <div className={'fd-opt' + (isOpen('addr') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('addr')} onClick={() => toggle('addr')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('addr') } }}>
            <b><Score n={6} />{t('fd.addrH')}</b>
            <span className="fd-chev" aria-hidden="true">{isOpen('addr') ? '▾' : '▸'}</span>
          </div>
          {isOpen('addr') && <div className="fd-body">
          <span className="fd-t">{t('fd.autoT')}</span>
          <a className="btn-secondary fd-btn" href={`https://www.zefix.ch/en/search/entity/list?name=${q(a.company)}`} {...ext}><Ico d={BUILDING} />{t('fd.zefix')}</a>
          <a className="btn-secondary fd-btn" href={`https://www.google.com/maps/search/${q(a.company)}`} {...ext}><Ico d={PIN} />{t('fd.map')}</a>
          </div>}
        </li>

        <li>
          <div className={'fd-opt' + (isOpen('site') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('site')} onClick={() => toggle('site')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('site') } }}>
            <b><Score n={6} />{t('fd.siteH')}</b>
            <span className="fd-chev" aria-hidden="true">{isOpen('site') ? '▾' : '▸'}</span>
          </div>
          {isOpen('site') && <div className="fd-body">
          <a className="btn-secondary fd-btn" href={`https://www.google.com/search?q=${q(`${a.company} ${site} contact us about us`)}`} {...ext}>{t('jr.siteSearch')}</a>
          {site && <a className="btn-secondary fd-btn" href={`https://www.${site}/`} {...ext}>{site}</a>}
          </div>}
        </li>

        <li>
          <div className={'fd-opt' + (isOpen('other') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('other')} onClick={() => toggle('other')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('other') } }}>
            <b><Score n={3} />{t('fd.otherH')}</b>
            <span className="fd-chev" aria-hidden="true">{isOpen('other') ? '▾' : '▸'}</span>
          </div>
          {isOpen('other') && <div className="fd-body">
          <span className="fd-t">{t('fd.otherT')}</span>
          <a className="btn-secondary fd-btn" href={`https://mail.google.com/mail/u/0/#search/${q('jobs.ch OR jobup.ch OR indeed OR linkedin OR ostjob')}`} {...ext}>{t('fd.otherMail')}</a>
          <a className="btn-secondary fd-btn" href={`https://www.google.com/search?q=${q(term)}`} {...ext}>{t('fd.otherBtn')}</a>
          </div>}
        </li>

        <li>
          <div className={'fd-opt' + (isOpen('ad') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('ad')} onClick={() => toggle('ad')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('ad') } }}>
            <b><Score n={2} />{t('fd.adH')}</b>
            <span className="fd-chev" aria-hidden="true">{isOpen('ad') ? '▾' : '▸'}</span>
          </div>
          {isOpen('ad') && <div className="fd-body">
          <p className="fd-flow">{flow(t('fd.flowAd'), {
            copy: <CopyBtn text={term} label={t('fd.copyJob')} t={t} />,
            room: <a className="fd-lnk" href="https://www.job-room.ch/" {...ext}>Job-Room</a>,
          })}</p>
          {pasteBox(ad2, setAd2)}
          </div>}
        </li>

        <li>
          <div className={'fd-opt' + (isOpen('type') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('type')} onClick={() => toggle('type')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('type') } }}>
            <b><Score n={1} />{t('fd.typeH')}</b>
            <span className="fd-chev" aria-hidden="true">{isOpen('type') ? '▾' : '▸'}</span>
          </div>
          {isOpen('type') && <div className="fd-body">
          {FIELDS.filter(f => ['contactPerson', 'email', 'phone', 'link'].includes(f.k) && !ev[f.k]).map(f => (
            <input key={a.id + f.k} className="jr-input jr-quick" type="text" placeholder={t('jr.quick.' + f.k)}
              onKeyDown={x => { if (x.key === 'Enter') (x.target as HTMLInputElement).blur() }}
              onBlur={x => { const v = x.target.value.trim(); if (v) onUpdate(a.id, { [f.k]: v } as Patch) }} />
          ))}
          </div>}
        </li>
      </ol>
    </details>
  )
}
