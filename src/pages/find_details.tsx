import { useState, useEffect, useRef, createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { swissDate, jobRoomMissing, jobRoomEntry, isJobLink, type Application, type JobRoomEntry } from '../lib/orp'
import { parseAd } from '../lib/ad_parse'
import { useProKey } from '../lib/pro'
import { PackList, openPacks, readPackToken } from '../lib/credit_packs'
import { isApp } from '../lib/platform'
import { PRO_KEY } from './job_track_pro'
import { quickLimitHit, aiFind, quickFindCached, quickHit, quickPatch, aiTrialUsed, freeFindsCount, rankLocations, saveSuggestion, type Loc, useBuyCreditsLive } from '../lib/ai_find'
import { useHoverInfo } from '../lib/hover_info'
import { newlyFilled } from '../lib/jr_seen'

type AiState = 'idle' | 'busy' | 'result' | 'used' | 'cap' | 'none' | 'err'

// 2026-10-19 owner: the two "missing" lists disagreed and 3.2 was disjointed. Now ONE list of what is missing (exact
// Job-Room names, amber = needed) on top, then where to look from easiest to hardest, one paste box, typing as the last resort.
type Patch = Partial<Application>
type Rec = Record<string, string>

// exact names as on the Job-Room form (same as the card below); needed = Job-Room will not save without it
const FIELDS: { k: string; label: string; needed?: boolean }[] = [
  { k: 'street', label: 'Street' }, { k: 'streetNo', label: 'No.' }, { k: 'postal', label: 'Postal code', needed: true },
  { k: 'city', label: 'City', needed: true }, { k: 'contactPerson', label: 'Kontaktperson' }, { k: 'email', label: 'Email', needed: true },
  { k: 'phone', label: 'Phone number' }, { k: 'link', label: 'Link zum Online-Formular' },
]

// 2026-11-03 owner: under the 3.2 header, list what Job-Room insists on and this job still lacks - amber until found, then green with the answer
const REQUIRED_LABEL: Record<string, string> = { date: 'Date', business: 'Business', postal: 'Postal code', city: 'City', jobTitle: 'Job title', email: 'Email or link (one is enough)' }   // 2026-11-19 owner: keep people from hunting for both
// 2026-11-05 owner: the Firefox version in steps 1 and 2 is a link that shows how to find your version
// 2026-11-06 owner: each step list sits behind three small buttons (Text, Screenshots, Video); the choice opens in a window over the page
type GuideKind = 'images' | 'text' | 'video'
// 2026-11-06 owner: Images = one small image per step with its step text under it, Video = one short clip per group.
// Files go in public/assets/jobtrack/ as history_search_<group>_1.jpg (plus _1b, _1c for more shots of the same step), _2.jpg ... and history_search_<group>.mp4; a missing file just hides itself.
const GUIDE_DIR = '/assets/jobtrack/history_search_'
// 2026-11-18 owner: the app had no Video button - the clips are not bundled, so the app streams them from the website (online only)
// 2026-11-18 owner: tap Video and it plays - the first clip starts by itself (muted: iPhone only autoplays silent video; the guide clips have no sound)
const videoDir = () => (isApp() ? 'https://kworld.space' : '') + GUIDE_DIR
const GUIDE_STEPS: Record<string, string[]> = {
  sync: ['fd.sync1a', 'fd.sync1b', 'fd.sync2a', 'fd.sync2b'],   // 2026-11-21 owner: 4 numbered steps on screen, one picture each (GUIDE_FILES)
  phone: ['fd.copyCompany', 'fd.hand2', 'fd.hand3', 'fd.hand4'],   // 2026-11-18 owner: images follow the on-screen steps 1-4
  computer: ['fd.inst1', 'fd.inst2', 'fd.inst3'],   // install the add-on (the computer user runs the add-on, not manual History steps)
}
// 2026-11-21 owner: History sync split from 2 steps into 4 - the existing pictures 1, 1b, 2, 2b are one per step, in that order
const GUIDE_FILES: Record<string, string[][]> = { sync: [['1'], ['1b'], ['2'], ['2b']] }
function GuideImages({ t, group, vars }: { t: (k: string) => string; group: string; vars?: Record<string, string> }) {
  const [bad, setBad] = useState<string[]>([])
  const [big, setBig] = useState<string | null>(null)
  const [wide, setWide] = useState<string[]>([])   // landscape (computer) shots show full width, tall phone shots stay narrow
  const keys = GUIDE_STEPS[group] || []
  // each step may have up to three images: <group>_<n>.jpg, <group>_<n>b.jpg, <group>_<n>c.jpg; a missing file just hides itself
  const files = keys.map((k, i) => ({ k, list: (GUIDE_FILES[group]?.[i] ?? ['', 'b', 'c'].map(x => `${i + 1}${x}`)).map(n => `${GUIDE_DIR}${group}_${n}.jpg?v=9`) }))
  if (files.every(f => f.list.every(u => bad.includes(u)))) return <p className="fd-flow">{t('fd.g.soon')}</p>
  const caption = (k: string) => { let x = t(k) + (k === 'fd.ph1' ? ' ' + t('fd.copyCompany') : '');   // the step's button name, which the Text window shows as a button
    for (const v in vars || {}) x = x.replace('{' + v + '}', (vars as Record<string, string>)[v]); return x }
  // 2026-11-06 owner: images and text did not match - each step now shows its number and text first, then its images side by side
  return <ol className="fd-gimgs">{files.map(({ k, list }, n) => list.every(u => bad.includes(u)) ? null : <li key={k}>
    <span className="fd-gcap"><b>{n + 1}.</b> {caption(k)}</span>
    <div className="fd-grow">{list.map(u => bad.includes(u) ? null : <img key={u} src={u} alt="" loading="lazy" className={big === u || wide.includes(u) ? 'fd-gimg fd-gimg-big' : 'fd-gimg'}
      onLoad={e => { const im = e.currentTarget; if (im.naturalWidth > im.naturalHeight) setWide(w => w.includes(u) ? w : [...w, u]) }}
      onClick={() => setBig(b => b === u ? null : u)} onError={() => setBad(b => b.includes(u) ? b : [...b, u])} />)}</div>
  </li>)}</ol>
}
// 2026-11-07 owner: History sync is one merged clip (1 of 2 desktop/computer, 2 of 2 phone) with title cards; every group has one clip
const GUIDE_CLIPS: Record<string, { file: string; label?: string }[]> = {}
function GuideVideo({ t, group }: { t: (k: string) => string; group: string }) {
  const [bad, setBad] = useState<string[]>([])
  const clips = GUIDE_CLIPS[group] || [{ file: group }]
  const shown = clips.filter(c => !bad.includes(c.file))
  if (!shown.length) return <p className="fd-flow">{t('fd.g.soon')}</p>
  const fail = (f: string) => setBad(b => b.includes(f) ? b : [...b, f])
  return <>{shown.map((c, ci) => <div key={c.file}>
    {c.label && <p className="fd-gvlabel">{t(c.label)}</p>}
    <video className="fd-gvideo" controls playsInline muted autoPlay={ci === 0} preload={ci === 0 ? 'auto' : 'none'} onError={() => fail(c.file)}><source src={`${videoDir()}${c.file}.mp4?v=18`} type="video/mp4" onError={() => fail(c.file)} /></video>
  </div>)}</>
}
// 2026-11-06 owner: tapping one part of a step (the text between the arrows) dims it, so the user sees where they are up to
const DoneCtx = createContext<{ done: string[] }>({ done: [] })
function Segs({ id, text, map, versionBtn }: { id: string; text: string; map?: Record<string, ReactNode>; versionBtn?: (v: string) => ReactNode }) {
  const { done } = useContext(DoneCtx)
  return <>{text.split(/\s*->\s*/).map((seg, i) => {
    const sid = id + ':' + i
    // a link (Firefox 142/157) can't be tapped to dim, so it dims once any later part of the step is dimmed;
    // the arrow in front of a part dims together with the part before it, so the arrow leading to the next live word is dimmed too
    const parts = text.split(/\s*->\s*/)
    const linkAt = (j: number) => !!versionBtn && /^Firefox 1\d\d$/.test(parts[j])
    const dimmed = (j: number): boolean => linkAt(j) ? parts.some((_, k) => k > j && done.includes(id + ':' + k)) : done.includes(id + ':' + j)
    const isLink = linkAt(i)
    const linkDone = isLink && dimmed(i)
    const sep = i > 0 ? <span className={dimmed(i - 1) ? 'fd-done' : undefined}>{' -> '}</span> : null
    if (isLink) return <span key={i}>{sep}<span className={linkDone ? 'fd-done' : undefined}>{versionBtn!(seg)}</span></span>
    return <span key={i}>{sep}<span className={'fd-seg' + (done.includes(sid) ? ' fd-done' : '')} data-sid={sid} role="button" tabIndex={0} aria-pressed={done.includes(sid)}>{map ? flow(seg, map) : seg}</span></span>
  })}</>
}

// tap one part: it and the parts before it in the same step dim; tap a dimmed part: it and every later part come back ("done up to here")
function segTap(done: string[], all: string[], i: number): string[] {
  const sid = all[i]
  const step = sid.split(':')[0]
  if (!done.includes(sid)) return Array.from(new Set([...done, ...all.slice(0, i + 1).filter(x => x.split(':')[0] === step)]))
  const after = all.slice(i).filter(x => x.split(':')[0] === step)
  return done.filter(x => !after.includes(x))
}
// 2026-11-16 owner: the same tappable "a -> b -> c" step line outside the guide window (JobTrack Update from email)
export function SegSteps({ id, text, map }: { id: string; text: string; map?: Record<string, ReactNode> }) {
  const [done, setDone] = useState<string[]>([])
  const box = useRef<HTMLSpanElement>(null)
  const tap = (target: EventTarget) => {
    const p = (target as Element).closest('[data-sid]') as HTMLElement | null; if (!p) return false
    const all = Array.from(box.current?.querySelectorAll<HTMLElement>('[data-sid]') ?? []).map(el => el.dataset.sid as string)
    setDone(segTap(done, all, all.indexOf(p.dataset.sid as string))); return true
  }
  // 2026-11-16 owner: "Can the step guide be navigated via Tab?" - Tab moves step to step, Enter or Space = tap
  return <DoneCtx.Provider value={{ done }}><span ref={box} className="fd-guide fd-segbox fd-segline" onClick={e => { tap(e.target) }}
    onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && tap(e.target)) e.preventDefault() }}><Segs id={id} text={text} map={map} /></span></DoneCtx.Provider>
}

// 2026-11-18 owner: the phone hand search steps must remember where the user is when they go to Firefox History and come back -
// tap a part to dim it (as in the guide window), kept per job on this device; the next unfinished step pulses
// 2026-11-20 owner: the desktop install steps on screen get the same tappable strikethrough as the phone hand steps (tap a part: it and everything before it dim; tap a dimmed part: it and everything after undim)
// 2026-11-21 owner: the Install button IS step 1 (like the phone's Copy company name button), not a separate button above the heading
function InstallSteps({ t, button }: { t: (k: string) => string; button?: ReactNode }) {
  return <StepList t={t} keys={button ? ['fd.inst1b', 'fd.inst2', 'fd.inst3'] : ['fd.inst1', 'fd.inst2', 'fd.inst3']} store="jt-inst-done" first={button} />
}
// 2026-11-21 owner: desktop, phone and app show the same thing - numbered steps on screen with the tappable strikethrough (install steps, History sync steps)
function StepList({ t, keys, store, versionBtn, first }: { t: (k: string) => string; keys: string[]; store: string; versionBtn?: (k: string) => ((v: string) => ReactNode) | undefined; first?: ReactNode }) {
  const key = store
  const [done, setDone] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(done)) } catch { /* private mode */ } }, [done])
  const box = useRef<HTMLOListElement>(null)
  const tap = (target: EventTarget) => {
    const el = (target as Element).closest('[data-sid]') as HTMLElement | null; if (!el) return false
    const all = Array.from(box.current?.querySelectorAll<HTMLElement>('[data-sid]') ?? []).map(x => x.dataset.sid as string)
    const i = all.indexOf(el.dataset.sid as string)
    setDone(d => d.includes(all[i]) ? all.slice(0, i) : all.slice(0, i + 1)); return true
  }
  return <DoneCtx.Provider value={{ done }}>
    <ol ref={box} className="fd-flow fd-phone-steps fd-guide fd-segbox" onClick={e => { tap(e.target) }} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && tap(e.target)) e.preventDefault() }}>
      {/* 2026-11-21 owner: the button and its next part are one step - same line, joined by an arrow, no gap */}
      {keys.map((k, i) => i === 0 && first
        ? <li key={k} className="fd-step-btn">{first}<span className={done.includes(k + ':0') ? 'fd-done' : undefined}>{' -> '}</span><Segs id={k} text={t(k)} versionBtn={versionBtn?.(k)} /></li>
        : <li key={k}><Segs id={k} text={t(k)} versionBtn={versionBtn?.(k)} /></li>)}
    </ol>
  </DoneCtx.Provider>
}

function HandSteps({ id, t, company, onCopied, onStep }: { id: string; t: (k: string) => string; company: string; onCopied: () => void; onStep: (n: number) => void }) {
  const key = 'jt-hand-' + id
  const [done, setDone] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(done)) } catch { /* private mode */ } }, [done, key])
  const keys = ['fd.hand2', 'fd.hand3', 'fd.hand4']
  const ids = (k: string) => t(k).split(/\s*->\s*/).map((_, i) => k + ':' + i)
  const complete = (k: string) => ids(k).every(x => done.includes(x))
  const next = !done.includes('h1') ? 1 : keys.findIndex(k => !complete(k)) + 2   // 1 = copy, 2-4 = steps, 1 (findIndex -1 + 2) = all done
  const allDone = done.includes('h1') && keys.every(complete)
  useEffect(() => { onStep(allDone ? 0 : next) }, [next, allDone])   // the parent pulses the paste box only at step 4
  const box = useRef<HTMLOListElement>(null)
  const tap = (target: EventTarget) => {
    const el = (target as Element).closest('[data-sid]') as HTMLElement | null; if (!el) return false
    // 2026-11-18 owner: across steps - tapping a part dims it and everything before it (copy step included); tapping a dimmed part undims it and everything after it
    const all = ['h1', ...Array.from(box.current?.querySelectorAll<HTMLElement>('[data-sid]') ?? []).map(x => x.dataset.sid as string)]
    const i = all.indexOf(el.dataset.sid as string)
    setDone(d => d.includes(all[i]) ? all.slice(0, i) : all.slice(0, i + 1)); return true
  }
  return <DoneCtx.Provider value={{ done }}>
    <ol ref={box} className="fd-flow fd-phone-steps fd-guide fd-segbox" onClick={e => { tap(e.target) }} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && tap(e.target)) e.preventDefault() }}>
      {/* 2026-11-20 owner: a dimmed button looks switched off - the copy button stays bright (it can be tapped again), a tick says it was done */}
      <li><CopyBtn text={company} label={t('fd.copyCompany')} t={t} glow={!allDone && next === 1} onCopied={() => { onCopied(); setDone(d => d.includes('h1') ? d : [...d, 'h1']) }} />{done.includes('h1') && <span className="fd-copied-tick" aria-label={t('fd.copied')}> ✓</span>}</li>
      {keys.map(k => <li key={k}><Segs id={k} text={t(k)} />{k === 'fd.hand2' && <><br /><span className="fd-side"><Segs id="ph2b" text={t('fd.ph2b')} /></span></>}</li>)}   {/* 2026-11-18 owner: the Bookmarks line from the old Text guide, under step 2 */}
    </ol>
  </DoneCtx.Provider>
}

// 2026-11-07 owner: a Video button that only says "Coming soon" wastes the user's time - the button shows only once the clip is confirmed to exist (a missing file may answer 200 with the page itself, so the type must be video)
const videoSeen: Record<string, boolean> = {}
function useHasVideo(group: string): boolean {
  const [has, setHas] = useState<boolean>(videoSeen[group] === true)
  useEffect(() => {
    if (group in videoSeen) { setHas(videoSeen[group]); return }
    let live = true
    fetch(`${videoDir()}${group}.mp4`, { method: 'HEAD' })
      .then(r => { const ok = r.ok && (r.headers.get('content-type') || '').startsWith('video/'); videoSeen[group] = ok; if (live) setHas(ok) })
      .catch(() => { if (live) setHas(false) })
    return () => { live = false }
  }, [group])
  return has
}
// 2026-11-20 owner: the tutorial buttons show only a picture, no words (Material image / article / play_circle); the word stays for screen readers
const GUIDE_IC: Record<GuideKind, string> = {
  images: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
  text: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z',
  video: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z',
}

function GuideRow({ t, title, group, vars, children, noText = false }: { t: (k: string) => string; title: string; group: string; vars?: Record<string, string>; children?: ReactNode; noText?: boolean }) {
  const [open, setOpen] = useState<GuideKind | null>(null)
  const hasVideo = useHasVideo(group)
  const kinds: GuideKind[] = ((hasVideo ? ['images', 'text', 'video'] : ['images', 'text']) as GuideKind[]).filter(k => !(noText && k === 'text'))   // alphabetical; noText: the steps are already on screen
  const [done, setDone] = useState<string[]>([])           // step parts the user dimmed, kept while the window is closed
  const box = useRef<HTMLDivElement>(null)
  // 2026-11-06 owner: Close sat below the steps (scroll, tap) and then the paste box needed another scroll - Close is now pinned at the top and, after the phone steps, the page jumps to the paste box
  // 2026-11-06 owner: closing in landscape then turning upright left the page mid-scroll, and the first tap on the box only raised the keyboard - the jump is instant now and repeats once when the screen turns, never while the box is being used
  const closeWin = () => {
    setOpen(null)
    if (group !== 'phone') return
    const box = document.querySelector<HTMLTextAreaElement>('textarea.jr-ad')
    box?.focus({ preventScroll: true })   // inside the Close tap, so the cursor is already live and the next tap shows Paste
    const toBox = () => box?.scrollIntoView({ block: 'start' })
    setTimeout(toBox, 60)
    const turned = () => { window.removeEventListener('resize', turned); window.removeEventListener('orientationchange', turned); setTimeout(toBox, 300) }
    window.addEventListener('resize', turned); window.addEventListener('orientationchange', turned)
    setTimeout(() => { window.removeEventListener('resize', turned); window.removeEventListener('orientationchange', turned) }, 15000)
  }
  // tap one part to dim it and the parts before it in the same step; tapping a dimmed part undims it and every part after it in the same step ("done up to here")
  const parts = () => Array.from(box.current?.querySelectorAll<HTMLElement>('[data-sid]') ?? [])
  const tapPart = (i: number) => setDone(segTap(done, parts().map(el => el.dataset.sid as string), i))
  const partAt = (el: Element | null) => { const p = el?.closest('[data-sid]') as HTMLElement | null; return p ? parts().indexOf(p) : -1 }
  return <div className="fd-guide">
    {/* 2026-11-20 owner: a mini tutorial picture (graduation cap, Material 'school') at the top left of EVERY Images / Text / Video button, so they read as a tutorial */}
    <div className="fd-guide-btns">{kinds.map(k => <button key={k} type="button" className="fd-guide-btn fd-guide-btn-ic" aria-label={t('fd.tutorial') + ': ' + t('fd.g.' + k)} title={t('fd.tutorial') + ': ' + t('fd.g.' + k)} onClick={() => setOpen(k)}><svg className="fd-guide-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3 1 9l11 6 9-4.91V17h2V9L12 3z" /></svg><svg viewBox="0 0 24 24" aria-hidden="true"><path d={GUIDE_IC[k]} /></svg></button>)}</div>
    {open && createPortal(<div className="modal fd-gmodal fd-guide" onClick={closeWin}>
      <div className="modal-content" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="fd-ghead"><h3>{title}: {t('fd.g.' + open)}</h3><button type="button" className="btn-secondary fd-gclose" onClick={closeWin}>{t('fd.g.close')}</button></div>
        {open === 'text'
          ? <><DoneCtx.Provider value={{ done }}><div ref={box} className="fd-segbox"
            onClick={e => { if ((e.target as HTMLElement).closest('button, a')) return; const i = partAt(e.target as Element); if (i >= 0) tapPart(i) }}
            onKeyDown={e => { if (e.key !== 'Enter' && e.key !== ' ') return; const i = partAt(e.target as Element); if (i >= 0) { e.preventDefault(); tapPart(i) } }}>{children}</div></DoneCtx.Provider></>
          : open === 'images' ? <GuideImages t={t} group={group} vars={vars} /> : <GuideVideo t={t} group={group} />}
      </div>
    </div>, (document.querySelector('.jobtrack-page') as HTMLElement | null) ?? document.body)}
  </div>
}

function SyncSteps({ t }: { t: (k: string) => string }) {
  const [ver, setVer] = useState<'pc' | 'ph' | null>(null)
  // 2026-11-21 owner: the steps were hidden behind the Text button - now on screen as 1. 2. 3. 4. under the Images and Video buttons, like the phone hand steps
  const which = (k: string): 'pc' | 'ph' | null => k === 'fd.sync1a' ? 'pc' : k === 'fd.sync2a' ? 'ph' : null
  return <>
    <GuideRow t={t} title={t('fd.syncH')} group="sync" noText />
    <StepList t={t} keys={GUIDE_STEPS.sync} store="jt-sync-done" versionBtn={k => { const w = which(k); return w ? (x => <button type="button" className="jr-bm-again" onClick={() => setVer(v => v === w ? null : w)}>{x}</button>) : undefined }} />
    {ver && <p className="fd-side" style={{ display: 'block' }}>{t(ver === 'pc' ? 'fd.verPc' : 'fd.verPh')}</p>}
  </>
}

function RequiredChecklist({ keys, live, t }: { keys: string[]; live: JobRoomEntry; t: (key: string) => string }) {
  if (!keys.length) return null
  const values = live as unknown as Rec
  return <div className="fd-req" role="list" aria-label={t('fd.needL')}>
    {keys.map(k => {
      const v = k === 'email' ? (values.email || (live.linkIsJob ? values.link : '')) : values[k]
      return <span key={k} role="listitem" className={'fd-req-row' + (v ? ' found' : '')} title={v ? undefined : t('fd.needed')}>
        {v ? <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> : <span className="fd-req-box" aria-hidden="true" />}
        <b>{REQUIRED_LABEL[k] ?? k}</b>{v && <span className="fd-req-val">{v}</span>}
      </span>
    })}
  </div>
}

export function MissingDetailsKey({ e, t }: { e: JobRoomEntry; t: (key: string) => string }) {
  const values = e as unknown as Rec
  const eitherMissing = e.method === 'electronic' && !values.email && !e.linkIsJob
  // 2026-11-04 owner: same pills as the header - amber box until found, then green tick; Job-Room needs only one of email or link
  const need = [
    { k: 'postal', label: 'Postal code', done: !!values.postal },
    { k: 'city', label: 'City', done: !!values.city },
    { k: 'email', label: REQUIRED_LABEL.email, done: !eitherMissing },
  ]
  const seen = useRef<Set<string>>(new Set())
  need.forEach(n => { if (!n.done) seen.current.add(n.k) })
  const rows = need.filter(n => seen.current.has(n.k))
  const optional = FIELDS.filter(f => !f.needed && f.k !== 'link' && !values[f.k])
    .concat(eitherMissing || values.link ? [] : FIELDS.filter(f => f.k === 'link' && !values.link))
  if (!rows.length && !optional.length) return null
  return <div className="fd-field-key">
    {rows.length > 0 && <span className="fd-required-key">{t('jr.missing')}</span>}
    {rows.length > 0 && <div className="fd-req" role="list">{rows.map(n => <span key={n.k} role="listitem" className={'fd-req-row' + (n.done ? ' found' : '')}>
      {n.done ? <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> : <span className="fd-req-box" aria-hidden="true" />}
      <b>{n.label}</b></span>)}</div>}
    {optional.length > 0 && <div className="fd-optional-fields"><span className="fd-optional-key">{t('fd.optL')}</span>{optional.map(f => <span key={f.k} className="fd-chip">{f.label}</span>)}</div>}
  </div>
}

// mini bar graph, n of 10 bars filled (taller to the right)
// 2026-10-26 owner: how many taps a method takes, shown BEFORE the person picks it. One svg: pointing
// finger, ripple arcs at the fingertip, the number on the palm. A bigger hand = more taps.
// Counted by hand, from the open job: every tap/click, each Ctrl+C / Ctrl+V = 1, a triple-click = 3.
export const TAPS = {
  twin: 2,   // open the method, Use it
  autoAi: 2, // choose the job square, then Use this result
  ai: 3,     // open, Find address and contact, Use it
  addr: 9,   // open, search.ch button, triple-click address (3), Ctrl+C, back here, click the box, Ctrl+V
  mail: 14,  // open, Copy company, mail link, search box, Ctrl+V, Enter, open the email, triple-click (3), Ctrl+C, back here, click the box, Ctrl+V
  link: 6,   // open, Copy company, history (Ctrl+H) search, open the page, copy its address, back here, paste
  site: 11,  // open, search, result, Contact page, triple-click (3), Ctrl+C, back here, click the box, Ctrl+V
  other: 11, // open, Gmail link, the email, triple-click (3), Ctrl+C, back here, open Type it yourself, click the field, Ctrl+V
  ad: 15,    // open, Copy job, Job-Room, sign in, search box, Ctrl+V, Enter, result, triple-click (3), Ctrl+C, back here, click the box, Ctrl+V (typing the sign-in not counted)
  type: 3,   // open, click the field, Enter (each further field: +2) - plus the typed keys, see KEYS
} as const
export function TapCount({ n, label, maxCount, big }: { n: number; label: string; maxCount?: number; big?: boolean }) {
  // 2026-10-26 owner: a plain pointing index finger tapping (Material "touch_app"), number on the palm
  const h = maxCount && maxCount > 1
    ? Math.round((big ? 38 : 24) + (Math.max(1, Math.min(n, maxCount)) - 1) * (big ? 22 : 24) / (maxCount - 1))
    : Math.round(22 + Math.min(n, 15) * 1.5)
  return <span className="fd-tapbox"><svg className="fd-taps" viewBox="0 0 24 24" height={h} width={h} role="img" aria-label={label.replace('{n}', String(n))}>
    <path fill="#f0eeff" d="M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.69-5.1c.01-.07.02-.13.02-.2 0-.62-.38-1.16-.91-1.38z" />
    <text x="14.6" y="20" textAnchor="middle" fontSize={big ? (n > 9 ? 6.4 : 8.2) : (n > 9 ? 5.2 : 6.5)} fontWeight="800" fontFamily="system-ui, sans-serif" fill="#03020a">{n}</text>
  </svg></span>
}
// keys typed by hand: for people who do not touch-type this is the real effort. Only methods that need typing show it.
export const KEYS = { type: 35 } as const  // a typical address: street ~20, number 2, postcode 4, city ~9 (each extra contact field: more)
export function KeyCount({ n, label }: { n: number; label: string }) {
  return <svg className="fd-keys" viewBox="0 0 40 34" height="34" width="40" role="img" aria-label={label.replace('{n}', String(n))}>
    <rect x="1" y="2" width="38" height="14" rx="3" fill="none" stroke="#f0eeff" strokeWidth="1.6" />
    {[6, 12, 18, 24, 30].map(k => <rect key={k} x={k} y="5" width="3" height="3" rx=".6" fill="#f0eeff" />)}
    <rect x="9" y="11" width="22" height="2.6" rx=".8" fill="#f0eeff" />
    <text x="20" y="29" textAnchor="middle" fontSize="11" fontWeight="800" fontFamily="system-ui, sans-serif" fill="#00ff41">{n}</text>
  </svg>
}

const Ico = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="fd-ico"><path d={d} /></svg>
const BUILDING = 'M4 21V3h10v18M14 9h6v12M8 7h2M8 11h2M8 15h2M3 21h18'
const PIN = 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'

// small "i" that floats a light note over the page for 7 seconds - nothing moves
export function InfoI({ text, left, children }: { text?: string; left?: boolean; children?: ReactNode }) {
  const [on, setOn] = useState(false)
  const hover = useHoverInfo(setOn)   // 2026-11-16 owner: computer = mouse over, phone = tap the i
  useEffect(() => { if (!on) return; const id = setTimeout(() => setOn(false), 7000); return () => clearTimeout(id) }, [on])
  return <span className="fd-ibox"><button ref={hover} type="button" className="fd-i" aria-label={text ?? 'i'} aria-expanded={on} onClick={e => { e.stopPropagation(); setOn(v => !v) }}>i</button>{on && <span className={'fd-pop' + (left ? ' fd-pop-left' : '')} role="status">{children ?? text}</span>}</span>
}

// the copy button sits inside the sentence, in place of its first words
// 2026-11-17 owner: on the phone the Proton/Gmail web search needs a login and the search is lost -
// copy the company name and open the mail APP instead (already logged in), the owner pastes it into the app's search
export const phoneLike = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
// the 4 steps in the mail app, each with its picture: copy (done) -> magnifier -> clipboard -> return key
const MAIL_STEPS: [string, ReactNode][] = [
  ['fd.mailAppCopy', <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /><path d="M11 14l2 2 4-4" /></>],
  ['fd.mailAppSearch', <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></>],
  ['fd.mailAppPaste', <><rect x="5" y="5" width="14" height="16" rx="2" /><path d="M9 5V3h6v2M9 12h6M9 16h4" /></>],
  ['fd.mailAppGo', <><path d="M20 5v7a3 3 0 0 1-3 3H5" /><path d="M9 11l-4 4 4 4" /></>],
  // 2026-11-20 owner: the way back is part of the same line: replies after <date> -> copy the sender's email or job link -> paste here
  ['fd.mailAppReplies', <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>],
  ['fd.mailAppCopyBack', <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>],
  ['fd.mailAppPasteHere', <><path d="M12 4v14M6 12l6 6 6-6" /></>],
]
export function MailAppBtns({ company, t, onBack, date = '', between, compact = false, big = false }: { company: string; t: (k: string) => string; onBack?: () => void; date?: string; between?: ReactNode; compact?: boolean; big?: boolean }) {
  const [msg, setMsg] = useState('')
  const open = (scheme: string) => {
    navigator.clipboard?.writeText(company).catch(() => {})
    setMsg(t('fd.mailAppCopied'))
    let left = false
    // 2026-11-20 owner: back from the mail app without the job (EPFL: emails only back to May) - the next search must be obvious
    const onBackVis = () => { if (document.visibilityState === 'visible' && left) { document.removeEventListener('visibilitychange', onBackVis); onBack?.() } }
    document.addEventListener('visibilitychange', onBackVis)
    const onHide = () => { if (document.visibilityState === 'hidden') left = true }
    document.addEventListener('visibilitychange', onHide)
    setTimeout(() => { document.removeEventListener('visibilitychange', onHide); if (!left) setMsg(t('fd.mailAppMissing')) }, 1800)
    window.location.href = scheme
  }
  return <span className="fd-mailapp">
    {/* 2026-11-17 owner: "needs to be clearly informed the search is copied and to tap search and paste" - said BEFORE the tap, the app covers anything shown after */}
    {/* 2026-11-20 owner: the two app buttons first, the steps under them */}
    {/* 2026-11-20 owner: the buttons looked like plain "open the app" - say on the button that the search word comes with it */}
    {([['protonmail://', 'fd.mailAppProton'], ['googlegmail://', 'fd.mailAppGmail']] as const).map(([scheme, k]) =>
      <button key={k} type="button" className={'btn fd-btn fd-mailapp-btn' + (big ? ' fd-mailapp-big' : '')} onClick={() => open(scheme)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></svg>
        <span className="fd-mailapp-txt" aria-label={t('fd.mailAppSearchIn').replace('{app}', t(k)) + ' ' + company}>{big ? <><span>{t('fd.mailAppSearchIn').replace('{app}', t(k))}</span><q>{company}</q></> : <>{t(k)} <q>{company}</q></>}</span>   {/* 2026-11-20 owner: the magnifier says search - no word needed */}
      </button>)}
    {between}
    {/* 2026-11-20 owner: "clear steps: Pre-copied -> tap search -> paste -> go", an arrow between every step */}
    {/* 2026-11-20 owner: in the Batch search list only the two buttons - the steps are in Email search */}
    {!compact && <span className="fd-mailapp-how" aria-label={t('fd.mailAppHow').replace('{name}', company)}>
      {MAIL_STEPS.map(([k, icon], i) => <span key={k} className="fd-how-rest">
        {i > 0 && <span className="fd-how-arrow" aria-hidden="true">→</span>}
        <span className="fd-how-step"><svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg>{t(k).split('{date}').map((part, j) => j ? <span key={j}><b className="fd-how-date">{date}</b>{part}</span> : part)}</span>
      </span>)}
    </span>}
    {msg && <span className="fd-t fd-mailapp-msg">{msg}</span>}
  </span>
}

function CopyBtn({ text, label, t, glow = false, onCopied }: { text: string; label: string; t: (k: string) => string; glow?: boolean; onCopied?: () => void }) {
  const [done, setDone] = useState(false)
  return <button type="button" className={'fd-copy' + (glow ? ' jt-guidance-glow' : '')} onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); onCopied?.(); setTimeout(() => setDone(false), 2000) }).catch(() => {})}>{done ? t('fd.copied') : label}</button>
}

// "{copy} -> open ..." : tokens in the sentence become the given nodes
function flow(s: string, map: Record<string, ReactNode>): ReactNode[] {
  return s.split(/(\{\w+\})/).map((part, i) => { const m = part.match(/^\{(\w+)\}$/); return m && m[1] in map ? <span key={i}>{map[m[1]]}</span> : part })
}

// drop tracking bits (utm_*, applySourceOverride) from a job link
function cleanJobLink(url: string): string {
  try { const u = new URL(url); for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k) || k === 'applySourceOverride') u.searchParams.delete(k); return u.toString() } catch { return url }
}

// 2026-11-19 owner: "My Leukerbad AG" found nothing in Proton - the emails say "Leukerbad". Mail search uses the name without
// legal forms (AG, SA, GmbH...) and short filler words (My, de, la...): the distinctive words a mail header or signature carries.
export const mailName = (company: string) => {
  const w = company.replace(/\(.*?\)/g, ' ').replace(/\b(AG|SA|S\.A\.|Sàrl|SARL|Sarl|GmbH|Ltd|Inc|KG|Co|Cie|Holding|Group|Groupe)\b\.?/gi, ' ').split(/\s+/).filter(x => x.replace(/[^\p{L}\p{N}]/gu, '').length > 2)
  return (w.join(' ') || company).trim()
}
// 2026-11-21 owner: "EPFL - Venture Program Leader" found nothing in Firefox History - company fields often carry the job
// title after " - " / " | " / " – ". Step 1 copies only the company part, which a History title/address contains.
export const histName = (company: string) => mailName(company.split(/\s+[-|–—]\s+/)[0] || company)
const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// 2026-11-04 owner: only the words "AI search failed" are amber, the reason and details stay grey
function amberLead(s: string) {
  const m = s.match(/^([^:.]+)([\s\S]*)$/)
  return m ? <><span className="fd-failword">{m[1]}</span>{m[2]}</> : <>{s}</>
}
const addonClock = new Map<string | number, number>()   // 2026-11-19: the 8 s add-on picture per job survives the panel being rebuilt mid-search
let batchAutoOpened = false   // Batch search opened by itself once per page visit
let histLastPost = 0   // 2026-11-07 owner: two Allow tabs opened - automatic history searches (also from a second open job card) are sent at most once every 8 s
function postHistoryOnce(msg: Record<string, unknown>): boolean {
  if (Date.now() - histLastPost < 8000) return false
  histLastPost = Date.now(); window.postMessage(msg, window.location.origin); return true
}
// 2026-11-08 owner: a status line unfolds (height, then fade) the moment it appears - never pops in
function Unfold({ children }: { children: ReactNode }) { return <div className="fd-unfold"><div className="fd-unfold-in">{children}</div></div> }

export default function FindDetails({ a, e, live, allApps, onUpdate, t, requiredMissing, method, mobile = false, autoSearch = false, onPreview, batch }: {
  batch?: { count: number; done: boolean; node: ReactNode }; a: Application; e: JobRoomEntry; live?: JobRoomEntry; allApps?: Application[]; onUpdate: (id: number, patch: Patch) => void; t: (k: string) => string; requiredMissing: boolean; method?: string; mobile?: boolean; autoSearch?: boolean; onPreview?: (id: number, patch: Patch) => void
}) {
  const buyLive = useBuyCreditsLive()
  const ev = e as unknown as Rec
  const twin = (allApps ?? []).find(o => o.id !== a.id && norm(o.company) === norm(a.company) && o.postal && o.city)
  // 2026-11-19 owner: "a user may not remember the same company already has an email - will the page remember?" - offered, one tap, never filled by itself (departments differ)
  const mailTwin = (allApps ?? []).find(o => o.id !== a.id && norm(o.company) === norm(a.company) && !!o.email)
  const adWorkLocation = a.adText ? parseAd(a.adText).address : ''
  const needAddr = !e.postal || !e.city || (!e.street && !a.addrUnknown)
  const [open, setOpen] = useState(true)
  // 2026-11-03 owner: with the Bookmarks add-on installed, one tap finds the page applied on in the browser history (nothing leaves the browser)
  const [addon, setAddon] = useState(false)
  const [installClicked, setInstallClicked] = useState(false)   // 15 s after Install, add-on still not heard: offer the reload (owner: an instant change distracted mid-install, and mostly the add-on arrives by itself)
  const addonRef = useRef(false)
  const mountedAt = useRef(Date.now())
  const lateAddon = useRef(false)
  const [lateGo, setLateGo] = useState(0)
  // 2026-11-17 owner: "run everything in the 8 seconds if the bookmarks/history has 0 searches, then suggest there might be a
  // solution in x". The history search is sent at once; whatever it (and the free quick search after it) finds is shown at 8 s.
  const holdUntil = useRef(addonClock.get(a.id) ?? 0)
  const quickRef = useRef<() => void>(() => {})
  const startAddonShowRef = useRef<() => void>(() => {})
  const waitPermRef = useRef(false)   // the add-on asked for permission: its real search comes after the Allow tab
  const finishRef = useRef<(results: { url: string; title: string }[]) => void>(() => {})
  // the best quick find: Job-Room's ad for this job first (exact), else the company website
  const [siteFind, setSiteFind] = useState<null | { label: string; fields: Rec }>(null)
  const [suggest, setSuggest] = useState<'' | 'mail' | 'site'>('')
  // 2026-11-19 owner: "where is the 8 second timer?" - the seconds left are shown beside "Add-on searching"
  const [, setTick] = useState(0)
  useEffect(() => { const id = window.setInterval(() => { if (holdUntil.current > Date.now() - 1000) setTick(n => n + 1) }, 250); return () => window.clearInterval(id) }, [])
  const holdLeft = Math.max(0, Math.ceil((holdUntil.current - Date.now()) / 1000))
  // 2026-11-19 owner: "I'm still not seeing an 8 second working Add-on image" on desktop - the picture hung on the search state,
  // which other steps finished early (gone after ~1.5 s in a local test). Now it has its own 8 s clock; results wait behind it.
  const [addonShowUntil, setAddonShowUntil] = useState(() => addonClock.get(a.id) ?? 0)
  const startAddonShow = () => { const u = Date.now() + 8000; holdUntil.current = Math.max(holdUntil.current, u); addonClock.set(a.id, u); setAddonShowUntil(u) }
  const addonShowing = addonShowUntil > Date.now()
  startAddonShowRef.current = startAddonShow
  const afterHold = (fn: () => void) => { const wait = holdUntil.current - Date.now(); if (wait > 0) window.setTimeout(fn, wait); else fn() }
  // 2026-11-17 owner: "build that" - after installing the add-on the history search starts by itself, no F5 and no tap.
  // The 11-07 rule stays: never while Firefox's install pop-ups are open (the Allow tab popped up mid-install). So wait
  // 3 s, then until the page has the focus back (the Add / OK pop-ups hold it), then start.
  useEffect(() => {
    if (!addon || !lateAddon.current) return
    const started = Date.now()
    const id = window.setInterval(() => {
      if (Date.now() - started < 3000 || !document.hasFocus() || document.visibilityState !== 'visible') return
      window.clearInterval(id); lateAddon.current = false; setLateGo(n => n + 1)
    }, 500)
    return () => window.clearInterval(id)
  }, [addon])
  const quietRef = useRef(false)
  const canAddon = typeof navigator !== 'undefined' && /Firefox|LibreWolf|Waterfox|Zen/i.test(navigator.userAgent) && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)   // add-on installs only on desktop Firefox-family browsers
  const [histPerm, setHistPerm] = useState(false)
  const aiDiag = useRef('')   // what the AI answered when it failed, kept even when the history search then finds something
  const [showOthers, setShowOthers] = useState(false)   // with a suggestion on screen the other search options stay folded away
  const [aiFail, setAiFail] = useState<{ kind: 'cap' | 'err'; diag: string } | null>(null)   // 2026-11-04 owner: AI failed -> say so and offer Pro, THEN the next search (history) runs below it
  const searchJobLinkRef = useRef<() => void>(() => {})
  const linkAiTried = useRef(false)
  const histKeep = useRef<{ url: string; title: string }[]>([])   // 2026-11-04 owner: a result the browser history found must survive the AI search
  const [hist, setHist] = useState<{ state: 'idle' | 'busy' | 'done'; src?: 'ai' | 'history' | 'web'; via?: 'quick'; why?: 'cap' | 'procap' | 'err'; email?: string; web?: boolean; diag?: string; results: { url: string; title: string }[] }>({ state: 'idle', results: [] })
  useEffect(() => {
    const on = (ev: MessageEvent) => {
      if (ev.source !== window || !ev.data || ev.data.source !== 'bookmarks-search') return
      if (ev.data.type === 'present') { if (!addonRef.current && Date.now() - mountedAt.current > 4000) lateAddon.current = true; addonRef.current = true; setAddon(true); window.postMessage({ source: 'kworld-page', type: 'perm' }, window.location.origin) }   // 2026-11-07 owner: an add-on installed while the page is open must not start the history search (the Allow tab popped up mid-install)
      if (ev.data.type === 'perm') { try { if (ev.data.history) localStorage.setItem('kworld_hist_granted', '1'); else localStorage.removeItem('kworld_hist_granted') } catch { /* private mode */ } }   // 2026-11-08 owner: add-on 0.5.5 tells at once whether history search is allowed - no Allow picture for someone who already approved (older add-ons never answer, the old memory stays)
      if (ev.data.type === 'history-result') {
        const results = ev.data.needPermission || !Array.isArray(ev.data.results) ? [] : ev.data.results.filter((r: { url: string }) => isJobLink(r.url))
        setHistPerm(!!ev.data.needPermission)
        try { if (ev.data.needPermission) localStorage.removeItem('kworld_hist_granted'); else localStorage.setItem('kworld_hist_granted', '1') } catch { /* private mode */ }   // 2026-11-08 owner: once the person has allowed history search, the Allow picture must not show again
        // 2026-11-19 owner: "Add-on found nothing" showed before the add-on had searched - its first answer after a new install is
        // "needs permission", not a search. Wait for the Allow tab; the search that follows the approval is the real one.
        if (ev.data.needPermission) { waitPermRef.current = true; return }
        if (quietRef.current) { quietRef.current = false; if (!waitPermRef.current) { if (results.length) { histKeep.current = results; setHist({ state: 'done', src: 'history', results }) }; return } }
        waitPermRef.current = false   // 2026-11-07 owner: the rerun after the Allow tab must not wipe an AI answer already on screen - it only adds a history find
        if (results.length) histKeep.current = results
        // 2026-11-19 owner: after the Allow tab the add-on was never seen working - the 8 s start once the person is back on this page
        const go = () => { if (holdUntil.current < Date.now() + 1000) startAddonShowRef.current(); finishRef.current(results) }
        if (document.visibilityState === 'visible' && document.hasFocus()) go()
        else { const id = window.setInterval(() => { if (document.visibilityState === 'visible' && document.hasFocus()) { window.clearInterval(id); go() } }, 300) }   // 2026-11-17 owner (3): history + the free quick search (Job-Room, company website) together, shown at 8 s
      }
    }
    window.addEventListener('message', on)
    window.postMessage({ source: 'kworld-page', type: 'ping' }, window.location.origin)
    return () => window.removeEventListener('message', on)
  }, [])
  const needsLink = jobRoomMissing(e).includes('email')
  const histAuto = useRef(false)
  const [aiDone, setAiDone] = useState(false)
  const [histWarm, setHistWarm] = useState(false)
  useEffect(() => {
    if (!addon || !needsLink || histAuto.current || lateAddon.current) return   // 2026-11-03 owner: easiest first = AI runs by itself; history is the fallback
    if (!autoSearch || !aiDone) return   // 2026-11-07 owner: the rule is AI search first and by itself (it starts when a red square is tapped) - the browser history never runs before it, not even on a page refresh
    if (hist.results.length || hist.email) return   // the AI already found the link
    histAuto.current = true
    // 2026-11-07 owner: the Allow tab opened the instant the AI search failed - too fast for a person to read "AI search failed". Wait 2 s first.
    // 2026-11-07 owner: say what happens next during the wait - "installed add-on running... a moment", then the tab asks for permission
    let allowed = false; try { allowed = localStorage.getItem('kworld_hist_granted') === '1' } catch { /* private mode */ }
    setHist({ state: 'busy', src: 'history', results: [] }); if (!allowed) setHistWarm(true)   // 2026-11-08 owner: the Allow picture only when the Allow tab will really open
    if (allowed) { startAddonShow(); postHistoryOnce({ source: 'kworld-page', type: 'history', company: a.company, role: a.role, date: a.date }) }
    else window.setTimeout(() => { setHistWarm(false); startAddonShow(); postHistoryOnce({ source: 'kworld-page', type: 'history', company: a.company, role: a.role, date: a.date }) }, 8000)   // the Allow tab opens - 8 s to read first   // 2026-11-17 owner: "too fast for humans" (1.5 -> 4 s), then "give the add-on search twice as much time" -> 8 s
  }, [addon, needsLink, autoSearch, aiDone, lateGo]) // eslint-disable-line react-hooks/exhaustive-deps
  // AI job-page search (no add-on needed): runs by itself when a link is needed and the history search is not available or found nothing
  // 2026-11-04 owner: the free web search runs by itself; the AI search only when the person taps it
  const jobLinkBase = () => ({ want: 'joblink' as const, date: a.date, company: a.company, role: a.role, hint: '', jobLocation: [a.postal, a.city].filter(Boolean).join(' '), tok, app })
  // each step stays on screen at least 5 seconds, so a person can read what is happening
  const atLeast = async <T,>(work: Promise<T>, ms = 5000): Promise<T> => { const [r] = await Promise.all([work, new Promise(res => setTimeout(res, ms))]); return r }
  const showJobLinkOutcome = (out: Awaited<ReturnType<typeof aiFind>>) => {
    const foundEmail = out.kind === 'jobs' ? out.email || '' : ''
    const aiFound = out.kind === 'jobs' ? out.jobs.filter(j => isJobLink(j.url)).map(j => ({ url: j.url, title: j.title })) : []
    aiDiag.current = out.kind === 'err' ? out.trail || '' : ''
    setAiDone(true)
    setAiFail(out.kind === 'err' ? { kind: 'err', diag: out.trail || '' } : out.kind === 'cap' || out.kind === 'used' || out.kind === 'paused' ? { kind: 'cap', diag: '' } : null)
    setHist({ state: 'done', src: aiFound.length || !histKeep.current.length ? 'ai' : 'history', email: foundEmail, web: out.kind === 'jobs' && out.via === 'search', diag: out.kind === 'err' ? out.trail : undefined, why: out.kind === 'cap' && pro ? 'procap' : out.kind === 'cap' || out.kind === 'used' || out.kind === 'paused' ? 'cap' : out.kind === 'err' ? 'err' : undefined, results: aiFound.length ? aiFound : histKeep.current })
  }
  async function searchJobLink() {   // 2026-11-04 owner: the AI search is the top search and starts by itself when a square is tapped
    if (linkAiTried.current) return
    linkAiTried.current = true
    await searchJobLinkAi()
  }
  async function searchJobLinkAi() {
    setAiFail(null)
    setHist({ state: 'busy', src: 'ai', results: [] })
    showJobLinkOutcome(await atLeast(aiFind({ ...jobLinkBase(), skipWeb: true })))
  }
  searchJobLinkRef.current = () => { void searchJobLink() }
  quickRef.current = () => finishRef.current([])
  finishRef.current = (histResults) => {
    setHist({ state: 'busy', src: 'history', results: [] })   // the add-on picture keeps running until 8 s
    void quickFindCached(a.company, a.role, [a.postal, a.city].filter(Boolean).join(' '), app).then(q => afterHold(() => {
      // most complete first: Job-Room's ad for this exact job (email, address, contact), then the history link, then the company website
      if (histResults.length && !(q.jobroom && q.jobroom.url)) { setSiteFind(null); setSuggest(''); setHist({ state: 'done', src: 'history', results: histResults }); return }
      const jobs = q.jobs.filter(j => isJobLink(j.url))
      const raw = quickHit(q, t)
      // 2026-11-19 owner: EPFL showed "Company website: +41 21 693 3000" - only offered when it fills something Job-Room still needs
      const hit = raw && jobRoomMissing(jobRoomEntry({ ...a, ...quickPatch(a, raw.fields) } as Application)).length < jobRoomMissing(jobRoomEntry(a)).length ? raw : null
      setSiteFind(hit)
      setSuggest(jobs.length || hit ? '' : q.site ? 'site' : 'mail')
      setHist({ state: 'done', src: 'history', via: jobs.length ? 'quick' : undefined, results: jobs })
    }))
  }
  useEffect(() => {
    if (!autoSearch || !needsLink || linkAiTried.current) return
    void searchJobLink()
  }, [autoSearch, needsLink]) // eslint-disable-line react-hooks/exhaustive-deps
  const searchHistory = () => { startAddonShow(); setSiteFind(null); setSuggest(''); setHist({ state: 'busy', src: 'history', results: [] }); window.postMessage({ source: 'kworld-page', type: 'history', company: a.company, role: a.role, date: a.date }, window.location.origin) }
  const histBoxRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (histPerm) { setOpenOpt('link'); setUserOpt(true) } }, [histPerm])
  // 2026-11-19: the "N found by Batch search" button under the squares opens Batch search here, where Fill all sits on top
  useEffect(() => {
    const on = () => { setOpenOpt('batch'); setUserOpt(true); setTimeout(() => document.querySelector('.fd-opt.on')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80) }
    window.addEventListener('jr-open-batch', on)
    return () => window.removeEventListener('jr-open-batch', on)
  }, [])
  // 2026-11-19 owner: "take the user automatically to Batch search open, Fill all pulsing" - only while no square was tapped
  // (a tapped square runs its own AI + add-on search; jumping away from it would lose the person). Once per visit.
  useEffect(() => {
    if (!batch?.done || !batch.count || autoSearch || userOpt || batchAutoOpened) return
    batchAutoOpened = true
    setOpenOpt('batch'); setUserOpt(true)
    setTimeout(() => document.querySelector('.fd-opt.on')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
  }, [batch?.done, batch?.count, autoSearch]) // eslint-disable-line react-hooks/exhaustive-deps   // 2026-11-07 owner: History search opens at the permission note
  // 2026-11-07 owner: closing the Allow tab opened another one. Now the add-on says 'granted' once the permission is really given, and only then the search reruns.
  useEffect(() => {
    const on = (ev: MessageEvent) => {
      if (ev.source !== window || !ev.data || ev.data.source !== 'bookmarks-search' || ev.data.type !== 'granted') return
      setHistPerm(false); histLastPost = 0
      try { localStorage.setItem('kworld_hist_granted', '1') } catch { /* private mode */ }   // 2026-11-08 owner: remember the approval at once, not only after a later search
      quietRef.current = postHistoryOnce({ source: 'kworld-page', type: 'history', company: a.company, role: a.role, date: a.date })
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [])
  useEffect(() => { if (!hist.results.length && !hist.email) return
    // 2026-11-19 owner: "Use this job is hidden at the bottom, cut off flat" - the answer unfolds over 0.9 s: check again once it is full height
    const go = () => (histBoxRef.current && !histBoxRef.current.closest('.fd-body')) && histBoxRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const ids = [250, 1050].map(ms => window.setTimeout(go, ms)); return () => ids.forEach(x => window.clearTimeout(x)) }, [hist.results.length, hist.email])   // 2026-11-07 owner: a found link collapses the option list and shows at the top of the window - scroll there once the layout has settled
  const [reqKeys] = useState(() => jobRoomMissing(e))   // what was missing when this job was opened: stays listed (green) once found
  const [ad, setAd] = useState('')
  const [ad2, setAd2] = useState('')
  const [note, setNote] = useState('')
  const [site, setSite] = useState('')
  const [rej, setRej] = useState(false)
  const { pro: webPro, tok } = useProKey(PRO_KEY, 'jobtrack-pro-')
  const app = isApp()
  const pro = webPro || app
  const [ai, setAi] = useState<AiState>('idle')
  const [trialUsed, setTrialUsed] = useState(aiTrialUsed)
  const [freeResult, setFreeResult] = useState(false)
  const [aiRuns, setAiRuns] = useState<Loc[][]>([])
  const [aiContact, setAiContact] = useState<Rec>({})
  const [aiPick, setAiPick] = useState(0)
  const [aiSrc, setAiSrc] = useState<{ title: string; uri: string }[]>([])
  const [aiErr, setAiErr] = useState('')
  const [aiMsg, setAiMsg] = useState('')
  // 2026-10-19 owner: eight choices must not look like eight steps - rows stay closed until one is tapped
  // 2026-11-03 owner: the AI looks for addresses. Only Email missing -> no AI, open the Email search (next best) instead.
  const reqAddr = jobRoomMissing(e).some(k => k === 'postal' || k === 'city')
  const emailOnly = !reqAddr && jobRoomMissing(e).includes('email')
  const [mailGlow, setMailGlow] = useState(false)
  const [mailBack, setMailBack] = useState(false)   // came back from the phone mail app
  const [syncOn, setSyncOn] = useState(() => { try { return localStorage.getItem('jt-sync-on') === '1' } catch { return false } })
  const [openOpt, setOpenOpt] = useState('')   // 2026-11-03 owner: nothing found -> Email search opens first (most likely), then the job link
  // 2026-11-20 owner (screenshot): Email search opened with the amber "Not in emails? Next search" just below the window edge - nudge it into view once the opening scroll has settled
  const mailNextRef = useRef<HTMLParagraphElement>(null)
  const mailOpen = method === 'mail' || openOpt === 'mail'
  useEffect(() => {
    if (!mailOpen || !phoneLike()) return
    const id = setTimeout(() => mailNextRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 1400)
    return () => clearTimeout(id)
  }, [mailOpen])
  const autoStarted = useRef(false)
  const isOpen = (id: string) => id === 'ai' || method === id || openOpt === id || (id === 'ai' && (autoSearch || trialUsed || ai !== 'idle'))
  // 2026-11-04 owner: AI failed -> order is Pro offer, then e-mail search, then browser history/bookmarks, then the rest
  useEffect(() => { if (hist.results.length > 0 || hist.email) setShowOthers(true) }, [hist.results.length, hist.email])   // 2026-11-04 owner: a free-search answer can be wrong - the other searches stay visible under it
  useEffect(() => { if (aiFail && !hist.results.length && !hist.email && !histKeep.current.length) { setMailGlow(true); if (mobile) setShowOthers(true) } }, [aiFail])   /* 2026-11-19 owner (phone): opening Email search by itself scrolled "AI search failed" and Batch search away - it stays folded and glows; a tap opens + scrolls it */   // a result is already on screen (e.g. from the browser history): the email search stays folded   // 2026-11-04 owner: AI failed -> next in order is the email search (least brain power), then browser bookmarks, then web search
  const [userOpt, setUserOpt] = useState(false)
  // 2026-11-19 owner: "Email search is already open, but not scrolled up" - an option opened by itself (AI failed -> Email search)
  // comes to the top once the add-on picture and search are over, so its paste box is in view. Once per opened option.
  const autoScrolled = useRef('')
  useEffect(() => {
    if (!openOpt || addonShowing || (hist.state === 'busy' && hist.src === 'history') || autoScrolled.current === openOpt) return
    autoScrolled.current = openOpt
    // 2026-11-19 owner: square 29 - the add-on found the job link, then the jump to Email search hid "Use this job link". An answer stays in view.
    if (hist.results.length || hist.email || siteFind) return
    const go = () => document.querySelector('.fd-opt.on')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(go, 120); setTimeout(go, 900)
  }, [openOpt, addonShowing, hist.state]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => {
    setUserOpt(true)
    if (id === 'ai' && (autoSearch || trialUsed || ai !== 'idle')) return
    // 2026-11-05 owner: tapping a search type scrolls smoothly so it sits at the top of the screen
    // 2026-11-08 owner: the view must follow the tapped search - scroll again once the layout has settled (fail note, fade, folded options move things)
    if (openOpt !== id) for (const ms of [60, 700, 1500]) setTimeout(() => document.querySelector('.fd-opt.on')?.scrollIntoView({ behavior: ms === 60 ? 'smooth' : 'auto', block: 'start' }), ms)
    // 2026-11-20 owner (phone): closing the auto Batch search folded up onto the Job-Room form replica - the next thing needed is
    // the other searches, so the view goes to 'Other ways to find it' instead
    // 2026-11-20 owner: fold not there (job needs no email, all searches listed) -> the closed Batch search header goes to the top, the other searches right under it
    if (openOpt === id && id === 'batch') for (const ms of [80, 600]) setTimeout(() => {
      const fold = document.querySelector('.fd-others'), head = document.querySelector('.fd-opt-batch')
      if (fold) fold.scrollIntoView({ behavior: ms === 80 ? 'smooth' : 'auto', block: 'start' })   // 2026-11-20 owner: centred left the squares filling the top half - the fold goes to the top
      else head?.scrollIntoView({ behavior: ms === 80 ? 'smooth' : 'auto', block: 'start' })
    }, ms)
    setOpenOpt(o => (o === id ? '' : id))
  }

  // mode: new search | check (same question again, to compare) | wrong ("Not right": look elsewhere)
  async function findWithAi(mode: 'new' | 'check' | 'wrong' = 'new') {
    setFreeResult(false); setAi('busy'); setAiErr(''); setAiMsg('')
    const out = await atLeast(aiFind({
      company: a.company, role: a.role, applicationLink: a.link || aiContact.link || (a.adText ? parseAd(a.adText).link : ''), tok: tok || readPackToken(), app, retry: mode !== 'new',
      avoid: mode === 'wrong' ? aiLocs.map(l => [l.label, l.street, l.streetNo, l.postal, l.city].filter(Boolean).join(' ')).join(' | ') : '',
      jobLocation: [a.postal, a.city || adWorkLocation].filter(Boolean).join(' '),
      hint: [a.adText, a.notes, a.city].filter(Boolean).join(' '),
    }, () => setAiMsg(t('ai.switch'))), 6000)   // 2026-11-08 owner: messages must stay long enough to read
    setTrialUsed(aiTrialUsed())
    if (out.kind === 'used') { setAi('used'); return }
    if (out.kind === 'cap') { setAi('cap'); return }
    if (out.kind === 'paused') { setAiErr(t('ai.paused')); setAi('err'); return }
    if (out.kind === 'none' || out.kind === 'webnone') { setAi('none'); return }
    if (out.kind === 'err') { setAiErr(out.detail); setAi('err'); return }
    if (out.kind === 'jobs' || out.kind === 'sender') { setAi('idle'); return }
    setFreeResult(out.free === true)
    const runs = mode === 'new' ? [out.locs] : [...aiRuns, out.locs]
    const contact = { ...(mode === 'new' ? {} : aiContact), ...out.contact }
    const sources = mode === 'new' ? out.sources : [...aiSrc, ...out.sources].slice(0, 5)
    setAiRuns(runs); setAiContact(contact); setAiSrc(sources); setAiPick(0); setAi('result')
    saveSuggestion(a.id, { runs, contact, sources, at: new Date().toISOString(), trace: out.trace })
  }
  useEffect(() => {
    if (!autoSearch || autoStarted.current || !reqAddr) return
    autoStarted.current = true
    void findWithAi()
  }, [autoSearch, a.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // every office from every search; "found in n of N searches" = the same answer came back again
  const placeKey = (l: Loc) => (l.street + l.streetNo + l.postal).toLowerCase().replace(/[^a-z0-9]/g, '')
  const aiLocs: Loc[] = (() => {
    const m = new Map<string, Loc>()
    aiRuns.forEach((run, ri) => { for (const l of run) { const k = placeKey(l); const e0 = m.get(k); if (e0) { if (!e0.seen.includes(ri)) { e0.seen.push(ri); e0.n++ } e0.likelyForJob = e0.likelyForJob || l.likelyForJob } else m.set(k, { ...l, n: 1, seen: [ri] }) } })
    return rankLocations([...m.values()], [a.postal, a.city || adWorkLocation].filter(Boolean).join(' '), [a.adText, a.notes].filter(Boolean).join(' '))
  })()

  // the card may already know the town / postal code: that office is the likely one even when the AI can't tell
  const cardPlace = (a.postal || a.city || '').toString().toLowerCase().trim()
  const sameAsCard = (l: Loc) => !!cardPlace && ([l.postal, l.city].some(v => v && String(v).toLowerCase() === cardPlace))
  useEffect(() => {
    setAiPick(0)
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
  // no job link and no pasted ad: the AI is guessing from the company name, so nothing is called "likely" and the next steps show
  const noProof = !a.link && !a.adText
  const proven = (l: Loc) => (!!l.likelyForJob && !noProof) || sameAsCard(l)
  const unsure = noProof || aiLocs.length > 1 && (!aiLocs.some(proven) || (aiRuns.length > 1 && aiLocs.some(l => l.n < aiRuns.length)))

  function selectedPatch(): Rec {
    const loc = aiLocs[aiPick]
    const contact = loc?.contact && typeof loc.contact === 'object'
      ? { ...(loc.applicationMatch ? aiContact : (aiContact.link ? { link: aiContact.link } : {})), ...loc.contact }
      : aiContact
    const all: Rec = { ...(loc ? { street: loc.street, streetNo: loc.streetNo, postal: loc.postal, city: loc.city } : {}), ...contact }
    const patch: Rec = {}
    for (const key of ['street', 'streetNo', 'postal', 'city', 'contactPerson', 'email', 'phone', 'link']) {
      if (typeof all[key] === 'string' && all[key] && !ev[key]) patch[key] = all[key]
    }
    if (patch.link) patch.linkFrom = 'company'   // AI / contact-page link: not the application form
    return patch
  }
  useEffect(() => {
    if (ai === 'result') onPreview?.(a.id, selectedPatch() as Patch)
  }, [ai, aiRuns, aiPick, aiContact]) // eslint-disable-line react-hooks/exhaustive-deps

  // 2026-11-03 owner: the AI button names what is actually missing (it said "address and contact" when only Email was)
  function aiLabel(): string {
    // follows the amber pills: only what Job-Room insists on (optional gaps like Kontaktperson or Phone do not change the name)
    const need = jobRoomMissing(e)
    const addr = need.includes('postal') || need.includes('city')
    const mail = need.includes('email')
    const k = addr && mail ? 'ai.f.addrContact' : addr ? 'ai.f.addr' : mail ? 'ai.f.email' : 'ai.f.addrContact'
    return t(k) + (pro ? '' : ' ' + t('ai.f.free'))
  }

  function useAi() {
    const patch = selectedPatch()
    if (Object.keys(patch).length) onUpdate(a.id, patch as Patch)
    setAi('idle')
  }

  function fill(text: string) {
    // 2026-11-18 owner: pasting the copied company name here found nothing (and would have been kept as the ad text) - say what to paste instead
    if (a.company && text.trim().toLowerCase() === a.company.trim().toLowerCase()) { setNote(t('fd.coPasted')); setAd(''); setAd2(''); return }
    const p = parseAd(text)
    const patch: Rec = {}
    const put = (k: string, v: string | undefined, have: string) => { if (v && !have) patch[k] = v }
    put('street', p.street, e.street); put('streetNo', p.streetNo, e.streetNo); put('postal', p.postal, e.postal); put('city', p.city, e.city)
    put('contactPerson', p.contactPerson, e.contactPerson); put('email', p.email, e.email); put('phone', p.phone, e.phone); put('link', p.link, e.linkIsJob ? e.link : '')   // a company/home-page link from an earlier search must not block the pasted job link
    if (patch.link) patch.linkFrom = 'user'   // pasted by the person: counts as the application link
    if (!a.adText) patch.adText = text.slice(0, 20000)
    const filled = Object.keys(patch).filter(k => k !== 'adText' && k !== 'linkFrom').map(k => FIELDS.find(f => f.k === k)?.label ?? k)
    if (Object.keys(patch).length) onUpdate(a.id, patch as Patch)
    // 2026-11-05 owner: after a fill, show the form (check no pills are left), then point at the next job needing details
    if (filled.length) {
      setTimeout(() => document.getElementById('jr-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 500)
      // 2026-11-19 owner: the form copy went by "too fast for me to study" - no second jump; the Next button only glows, the person scrolls on when ready
      ;(window as unknown as { __jrHold?: number }).__jrHold = Date.now()
      setTimeout(() => { document.getElementById('jr-nextgap')?.classList.add('jt-guidance-glow') }, 1500)
    }
    setSite(p.siteDomain); setRej(p.statusHint === 'rejected' && a.status !== 'rejected')
    setNote(filled.length ? t('jr.adDone').replace('{list}', filled.join(', ')) : (p.postal || p.city || p.street ? t('jr.adHave') : (p.statusHint || p.siteDomain ? t('jr.adEmailOnly') : t('jr.adNone'))))
    setAd(''); setAd2('')
  }
  const q = encodeURIComponent
  const ext = { target: '_blank', rel: 'noopener noreferrer' } as const
  const date = swissDate(a.date)

  const term = `${a.role} ${a.company}`

  // paste target right where the sentence ends; pasting fills the form
  // 2026-11-18 owner: History and bookmarks open on the phone -> Copy company name pulses; once tapped, the Ctrl+V here box pulses until something is pasted
  const [, setCoCopied] = useState(false)   // kept for the copy callback; the paste box now follows handStep
  const [handStep, setHandStep] = useState(0)   // phone hand search: the step the user is on (4 = paste the job ad)
  const installBtn = canAddon ? <>
                  {/* 2026-11-19 owner: after installing, the button stayed - Firefox gives the add-on's page script only to pages
                      loaded AFTER the install, so this open page can't hear it. After the click: one button that reloads. */}
                  {!installClicked
                    ? <a className="btn btn-glow fd-btn" href="/free/bookmarks_search.xpi" onClick={() => {
                      // 2026-11-21 owner recording: the .xpi link fired the browser's "Leave page?" (the not-backed-up net) - the page stays, so skip it for this click
                      const w = window as unknown as { kworldLeaving?: boolean }; w.kworldLeaving = true; setTimeout(() => { w.kworldLeaving = false }, 3000)
                      setTimeout(() => setInstallClicked(true), 15000) }}>{t('fd.addonInstall')}</a>
                    : <button type="button" className="btn btn-glow fd-btn" onClick={() => window.location.reload()}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: '.4rem' }}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>{t('fd.addonReload')}</button>}
  </> : undefined
  const pasteBox = (val: string, set: (v: string) => void) => <>
    <textarea className={'jr-ad' + (handStep === 4 && !val.trim() ? ' jt-guidance-glow' : '')} rows={2} onFocus={x => { const el = x.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400) }} placeholder={t('fd.pasteHere')} value={val} onChange={x => set(x.target.value)}
      onPaste={x => { const v = x.clipboardData.getData('text'); if (v.trim().length >= 12) { x.preventDefault(); fill(v) } }} />
    {val.trim() && <button type="button" className="btn-secondary fd-btn fd-fill-ad jt-guidance-glow" onClick={() => fill(val)}>{t('jr.adFill')}</button>}   {/* 2026-11-18 owner: once pasted, Fill from the ad is the next tap, so it pulses */}
    {note && <span className="fd-note">{note}</span>}
    {rej && <button type="button" className="btn-secondary fd-btn" onClick={() => { onUpdate(a.id, { status: 'rejected' }); setRej(false) }}>{t('jr.setRejected')}</button>}
  </>

  const statusBelow = addon && isOpen('link') && !hist.results.length && !hist.email   // 2026-11-07 owner: while the History option is open and still searching, status lines sit under its button; once a link is found the list folds away and the AI-failed note moves up to the top, fading in beside the result
  const histStatus = (<>
        {hist.state === 'busy' && histWarm && <Unfold><span className="fd-warm fd-fade" role="status"><svg viewBox="0 0 160 96" width="160" height="96" aria-hidden="true"><rect x="2" y="2" width="156" height="92" rx="6" fill="#0d0d1a" stroke="#6b6b8a" strokeWidth="2" /><rect x="2" y="2" width="156" height="14" rx="4" fill="#2a2748" /><text x="10" y="12" fontSize="7" fill="#c8c8d8">Allow history search</text><circle cx="80" cy="38" r="14" fill="none" stroke="#00ff41" strokeWidth="2.5" /><path d="M80 30v8l5 3" fill="none" stroke="#00ff41" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><rect x="22" y="62" width="116" height="22" rx="6" fill="#00ff41" /><text x="80" y="76" textAnchor="middle" fontSize="9" fontWeight="700" fill="#000">Allow history search</text></svg><span className="fd-warm-t"><b>{t('fd.histWarm')}</b><span className="fd-ell" /></span></span></Unfold>}
        {/* 2026-11-17 owner: "needs a human activity progress image so user knows Add-on is searching, then shows the found data" -
            a browser-history list with a magnifier moving down it, row by row lighting up */}
        {/* 2026-11-17 owner: "the page jumps around whilst transitioning from Add-on searching to ... found data" - the picture and
            the found link share one slot of the same height (fd-hslot) and crossfade, so nothing below moves */}
        {(addonShowing || (hist.state === 'busy' && !histWarm && hist.src === 'history')) && <div key="hscan" className="fd-hslot"><span className="fd-warm fd-fade" role="status">
          <svg className="fd-hscan" viewBox="0 0 160 96" width="107" height="64" aria-hidden="true">
            <rect x="2" y="2" width="156" height="92" rx="6" fill="#0d0d1a" stroke="#6b6b8a" strokeWidth="2" />
            <rect x="2" y="2" width="156" height="14" rx="4" fill="#2a2748" />
            <circle cx="11" cy="9" r="4" fill="none" stroke="#c8c8d8" strokeWidth="1.3" /><path d="M11 6.5V9l1.7 1" fill="none" stroke="#c8c8d8" strokeWidth="1.2" strokeLinecap="round" />
            {[0, 1, 2, 3].map(i => <g key={i} className={'fd-hscan-row fd-hscan-r' + i}>
              <rect x="10" y={24 + i * 17} width="140" height="12" rx="3" fill="#1c1a33" />
              <rect x="15" y={27.5 + i * 17} width="6" height="5" rx="1" fill="#6b6b8a" />
              <rect x="26" y={28 + i * 17} width={[90, 70, 100, 60][i]} height="4" rx="2" fill="#6b6b8a" />
            </g>)}
            <g className="fd-hscan-lens"><circle cx="128" cy="30" r="9" fill="rgba(0,255,65,.12)" stroke="#00ff41" strokeWidth="2.5" /><path d="M134.5 36.5l7 7" stroke="#00ff41" strokeWidth="3" strokeLinecap="round" /></g>
          </svg>
          <span className="fd-warm-t"><b>{t('fd.histWarm')}</b><span className="fd-ell" />{holdLeft > 0 && <span className="fd-count"> {holdLeft} s</span>}</span></span></div>}
        {!addonShowing && <>{/* results and "found nothing" wait until the 8 s add-on picture is over */}
        {hist.state === 'busy' && !histWarm && hist.src !== 'ai' && hist.src !== 'history' && <Unfold key={hist.src}><span className="fd-t fd-fade" role="status"><span className="fd-dots"><i /><i /><i /></span>{ hist.src === 'web' ? t('fd.webBusy') : hist.src === 'history' ? t('fd.histWarm') : t(pro ? 'fd.histBusy' : 'fd.histBusyFree')}</span></Unfold>}
        {hist.state === 'done' && !hist.results.length && siteFind && <div className="fd-hslot fd-hslot-in">
          <span className="fd-t fd-found">{siteFind.label}</span>
          <button type="button" className="btn btn-glow fd-btn fd-hist jt-use-link jt-guidance-glow fd-one-line" title={Object.values(siteFind.fields).join(' · ')} onClick={() => {
            onUpdate(a.id, quickPatch(a, siteFind.fields) as Patch); setSiteFind(null); setHist({ state: 'idle', results: [] })
          }}>{t('fd.quickUse')} {(f => [f.email, [[f.street, f.streetNo].filter(Boolean).join(' '), [f.postal, f.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), f.contactPerson].filter(Boolean).join(' · '))(siteFind.fields)}</button>
        </div>}
        {hist.state === 'done' && !hist.results.length && !siteFind && suggest && <div className="fd-hslot fd-hslot-in">
          {/* 2026-11-19 owner: say that the ADD-ON found nothing, and point DOWN the list (easiest to hardest): Email search sits above and was already tried, so the next one is Web search */}
          {(() => { const next = addon && suggest === 'mail' ? 'webs' : suggest; return <>
          <span className="fd-t fd-found">{addon && openOpt && openOpt !== 'link' ? t('fd.addonNoneOpen').replace('{h}', t(openOpt === 'mail' ? 'fd.mailH' : openOpt === 'batch' ? 'fd.batchH' : openOpt === 'site' ? 'fd.siteH' : 'fd.mailH')) : t(addon ? (next === 'site' ? 'fd.addonNoneSite' : 'fd.addonNone') : 'fd.quickNone')}</span>
          {openOpt !== next && next !== 'webs' && <button type="button" className="btn btn-glow fd-btn jt-guidance-glow" onClick={() => { setOpenOpt(next); setUserOpt(true) }}>{t(next === 'site' ? 'fd.siteH' : 'fd.mailH')}</button>}
          </> })()}{/* 2026-11-19 owner: once tapped, the same search is open below - a second Email search button is noise */}
        </div>}
        {histPerm && !hist.results.length && <span className="fd-t fd-ai-notice" role="status">{t('fd.histPerm')}</span>}
        {hist.state === 'done' && !hist.results.length && !hist.email && !histPerm && !aiFail && !siteFind && !suggest && <span className="fd-t">{t(hist.why === 'procap' ? 'fd.histProCap' : hist.why === 'cap' ? (pro ? 'fd.histErr' : buyLive ? 'fd.histCapPay' : 'fd.histCap') : hist.why === 'err' ? (pro ? 'fd.histErr' : 'fd.histBuy') : 'fd.histNone')}</span>}
        </>}
  </>)   // 2026-11-07 owner: no result must be told at the button itself, not only in a box above the list
  // 2026-11-08 owner: the AI-failed note must sit where the person is looking - inside the search option that is open, not at the top of the list
  const failMsg = aiFail ? (aiFail.diag ? amberLead(t(/credit balance|insufficient|billing|\b402\b/i.test(aiFail.diag) ? 'fd.aiNoFunds' : /quota|\b429\b|exhausted/i.test(aiFail.diag) ? 'fd.aiQuota' : /overload|\b529\b|busy/i.test(aiFail.diag) ? 'fd.aiBusy' : 'fd.aiFailed') + (phoneLike() ? '' : ' (' + aiFail.diag + ')')) : amberLead(t(pro ? 'fd.histProCap' : buyLive ? 'fd.histCapPay' : 'fd.histCap'))) : null   // 2026-11-09 owner: every search option shows the same AI-failed text
  const failNote = needsLink && aiFail && ai !== 'busy' ? <div className="fd-hist-box fd-ai-fail fd-slide-in">
        <span className="fd-side" role="alert">{failMsg}</span>
        {buyLive && !pro && <button type="button" className="btn btn-glow fd-btn" onClick={() => openPacks()}>{t('fd.buyNow')}</button>}
        {buyLive && !pro && <PackList />}
      </div> : null
  // 2026-11-08 owner: the AI "searching" line follows the person too - it shows inside the open search option, like the failed note
  const aiBusyText = ai === 'busy' ? (aiMsg || t(pro ? 'ai.busyPaid' : 'ai.busy')) : hist.state === 'busy' && hist.src === 'ai' ? t(pro ? 'fd.histBusy' : 'fd.histBusyFree') : ''
  const shortFail = needsLink && aiFail && ai !== 'busy' ? <div className="fd-hist-box fd-ai-fail"><span className="fd-t">{failMsg}</span></div> : null   // 2026-11-08 owner: inside History search one short note, same place before and after the result arrives
  const busyNote = aiBusyText ? <span key={aiBusyText} className="fd-t fd-busy fd-fade" role="status"><span className="fd-dots"><i /><i /><i /></span>{aiBusyText}</span> : null
  // 2026-11-08 owner: a found link shows where the person already is - inside the search option they tapped - and the view does not jump up to 3.2
  const optTaken = !!((userOpt && openOpt && openOpt !== 'ai') || (openOpt === 'link' && hist.src === 'history'))   // 2026-11-08 owner: a History result belongs in the History option even when it opened by itself - it must not show at the top first and then jump
  const inOpt = optTaken && !method
  const foundHere = hist.results.length > 0 || !!hist.email
  const resultBox = needsLink && (hist.state !== 'idle' || histPerm) ? (<div className="fd-unfold"><div className="fd-unfold-in"><div className="fd-hist-box" ref={histBoxRef}>
        {!statusBelow && histStatus}   {/* 2026-11-07 owner: with History search open, every status line shows under its green button - nothing flashes in at the top */}
        {hist.state === 'done' && !aiFail && (hist.diag || aiDiag.current) && <span className="fd-diag">{hist.diag ? '' : <><span className="fd-failword">AI search failed</span>. </>}{hist.diag || aiDiag.current}</span>}
        {hist.state === 'done' && !aiFail && (hist.why === 'cap' || hist.why === 'err') && buyLive && !pro && <div className="fd-ai-buy"><button type="button" className="btn btn-glow fd-btn" onClick={() => openPacks()}>{t('bulk.buy')}</button></div>}
        {foundHere && <div className={hist.src === 'history' ? 'fd-hslot fd-hslot-in' : 'fd-reveal'}><div className={hist.src === 'history' ? '' : 'fd-reveal-in'}>
        {hist.email && <><span className="fd-t fd-found">{t(pro ? 'fd.srcAi' : 'fd.srcAiFree')}</span><button type="button" className="btn btn-glow fd-btn fd-hist jt-use-link jt-guidance-glow" onClick={() => { onUpdate(a.id, { email: hist.email } as Patch); setHist({ state: 'idle', results: [] }) }}>{t('fd.emailUse')} {hist.email}</button></>}
        {hist.results.length > 0 && <span className="fd-t fd-found">{hist.via === 'quick' ? t('fd.srcWeb') : hist.src === 'history' ? t('fd.srcHist') : hist.web ? t('fd.srcWeb') : t(pro ? 'fd.srcAi' : 'fd.srcAiFree')}</span>}
        {hist.results.slice(0, 1).map(r => <button key={r.url} type="button" className="btn btn-glow fd-btn fd-hist jt-use-link jt-guidance-glow" onClick={() => { onUpdate(a.id, { link: cleanJobLink(r.url), linkFrom: 'user' } as Patch); setHist({ state: 'idle', results: [] }) }}>{t('fd.histUse')} {r.title || r.url}<small>{r.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}</small></button>)}
        {hist.state === 'done' && hist.web && hist.results.length > 0 && buyLive && !pro && <button type="button" className="btn btn-glow fd-btn" onClick={() => openPacks()}>{t('bulk.buy')}</button>}
        {hist.results.length > 1 && <details className="fd-hist-more" onToggle={x => { const d = x.currentTarget as HTMLDetailsElement; if (!d.open) requestAnimationFrame(() => d.scrollIntoView({ block: 'nearest' })) }}><summary>{t('fd.histMore')}</summary>
          {hist.results.slice(1).map(r => <button key={r.url} type="button" className="btn-secondary fd-btn fd-hist" onClick={() => { onUpdate(a.id, { link: cleanJobLink(r.url), linkFrom: 'user' } as Patch); setHist({ state: 'idle', results: [] }) }}>{r.title || r.url}<small>{r.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}</small></button>)}
        </details>}
        </div></div>}
      </div></div></div>) : null
  // 2026-11-08 owner: one slot for the AI line - it unfolds once and the busy/failed text swaps inside it, so nothing jumps
  const noteSlot = (fail: ReactNode) => (busyNote || fail) ? <div className="fd-unfold"><div className="fd-unfold-in">{busyNote}{fail}</div></div> : null
  const failNoteTop = !statusBelow && !(method || optTaken)   // 2026-11-08 owner: only an option the person tapped takes the notes - the auto-opened Email option must not pull them out of view under 3.2
  return (
    <details className="fd" open={open} onToggle={x => { if (x.target === x.currentTarget) setOpen((x.target as HTMLDetailsElement).open) }}>
      <summary className="fd-sum"><span><span className="fd-chev" aria-hidden="true">{open ? '▾' : '▸'}</span> {requiredMissing ? t('details.choose') : t('fd.titleMore')}</span><RequiredChecklist keys={reqKeys} live={live ?? e} t={t} /></summary>
      {failNoteTop && noteSlot(shortFail)}
      {!(inOpt && (foundHere || openOpt !== 'link')) && !(statusBelow && (hist.state === 'busy' || !!siteFind || !!suggest)) && resultBox}   {/* 2026-11-17: an empty box here while the status shows below shifted the list 4 px when it went */}


      {needsLink && (hist.results.length > 0 || mobile) && !inOpt && <details className="fd-fold fd-others" open={showOthers} onToggle={x => { const d = x.currentTarget as HTMLDetailsElement; setShowOthers(d.open); if (!d.open) requestAnimationFrame(() => d.scrollIntoView({ block: 'nearest' })) }}><summary>{t('fd.othersShow')}</summary></details>}
      {/* 2026-11-19 owner: "not reviewing the results, just accepting them" - every detail filled on this visit, at the top, one glance + Undo */}
      {(() => { const nk = newlyFilled(a.id, e); return nk.length > 0 && <div className="fd-justfilled" role="status">
        <b className="fd-justfilled-h">{t('fd.justFilled')}</b>
        {nk.map(k => <div key={k} className="fd-justfilled-row">
          <span className="fd-justfilled-k">{FIELDS.find(f => f.k === k)?.label ?? k}</span>
          <span className="fd-justfilled-v">{String((e as unknown as Record<string, unknown>)[k] ?? '')}</span>
          <button type="button" className="btn-secondary fd-justfilled-undo" onClick={() => onUpdate(a.id, (k === 'link' ? { link: '', linkFrom: undefined } : { [k]: '' }) as Patch)}>{t('fd.undo')}</button>
        </div>)}
      </div> })()}
      {mailTwin && !e.email && jobRoomMissing(e).includes('email') && <div className="fd-mailtwin">
        <span className="fd-t">{t('fd.mailTwin').replace('{date}', swissDate(mailTwin.date))}</span>
        <button type="button" className="btn btn-glow fd-btn jt-guidance-glow fd-one-line" onClick={() => onUpdate(a.id, { email: mailTwin.email } as Patch)}>{t('fd.mailTwinUse')} {mailTwin.email}</button>
      </div>}
      <ol className="fd-list" hidden={needsLink && (hist.results.length > 0 || mobile) && !showOthers && !inOpt}>
        <li hidden={emailOnly || (!!method && method !== 'ai')}>
          <div className="fd-ai-header">

            {pro && <b>{aiLabel()}</b>}
          </div>
          {isOpen('ai') && <div className="fd-body">
          {pro && (ai === 'idle' || ai === 'err' || ai === 'none') && <button type="button" className="btn btn-glow fd-btn" onClick={() => findWithAi()}>{aiLabel()}</button>}
          {ai === 'none' && <span className="fd-t">{t('ai.none')}</span>}
          {ai === 'err' && !failNote && hist.state !== 'busy' && <span className="fd-t fd-ai-notice fd-ai-warn" role="alert"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#ffb000" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg><span><span className="fd-failword">{t('fd.aiFailed').replace(/\.$/, '')}</span>: {aiErr || t('ai.err')}</span></span>}
          {ai === 'err' && buyLive && !pro && aiErr && <div className="fd-ai-buy"><button type="button" className="btn btn-glow fd-btn" onClick={() => openPacks()}>{t('ai.skipWait')}</button></div>}
          {ai === 'used' && <>
            <span className="fd-t fd-ai-notice" role="status">{t('ai.used')}</span>
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
                    {proven(l) ? <i className="fd-tag ok" title={l.why || ''}>{t('ai.likely')}</i> : noProof && i === 0 && <i className="fd-tag">{t('ai.unconfirmed')}</i>}
                    {aiRuns.length > 1 && <span className="fd-by">{t('ai.foundBy')} {aiRuns.map((_, ri) => <span key={ri} className={l.seen.includes(ri) ? 'y' : 'n'}>{ri + 1}{l.seen.includes(ri) ? '✓' : '✗'}</span>)}</span>}
                  </span>
                </span>
              </label>
            ))}
            {unsure && <div className="fd-next"><b>{t('ai.nextH')}</b></div>}
            <span className="fd-srcs">{t('ai.src')} {srcLabels.map((s, i) => <a key={i} className="fd-src" href={s.uri} {...ext}>{s.label}</a>)}</span>
            <div className="fd-result-actions">
              <button type="button" className={(unsure ? 'btn-secondary' : 'btn') + ' fd-btn btn-glow jt-guidance-glow jt-use-ai'} onClick={useAi}>{t('ai.use')}</button>
              <button type="button" className="btn-secondary fd-btn" onClick={() => findWithAi('check')}>{t('ai.check2')}</button>
            </div>
          </>}
          </div>}
          {buyLive && !pro && ai === 'result' && freeResult && freeFindsCount() >= 5 && <span className="fd-t">{t('ai.freeNote')}</span>}
          {buyLive && !pro && ai !== 'idle' && ai !== 'busy' && !(ai === 'err' && aiErr) && <div className="fd-ai-buy"><button type="button" className="btn fd-btn" onClick={() => openPacks()}>{t(ai === 'result' && freeResult ? 'ai.buyResult' : 'bulk.buy')}</button></div>}
        </li>

        {/* 2026-11-03 owner: order is pills, free AI search, Easiest first, manual searches - and Easiest first sits closer to the list below it */}
        <li className="fd-guidance fd-guidance-row" hidden={!!method}><span>{t('fd.scoreL2')}</span><TapCount n={TAPS.twin} label={t('fd.tapsAria')} /><TapCount n={TAPS.ad} label={t('fd.tapsAria')} /></li>
        {/* 2026-11-17 owner: the batch fill as a search option, above Email search - all red squares at once */}
        {batch && <li hidden={!!method}>
          <div className={'fd-opt fd-opt-batch' + (isOpen('batch') ? ' on' : batch.done && batch.count ? ' fd-batch-ready jt-guidance-glow' : '')} role="button" tabIndex={0} aria-expanded={isOpen('batch')} onClick={() => toggle('batch')} onKeyDown={x => { if (x.key === 'Enter' || x.key === ' ') { x.preventDefault(); toggle('batch') } }}>
            <span className="fd-chev" aria-hidden="true">{isOpen('batch') ? '▾' : '▸'}</span>
            <b><TapCount n={1} label={t('fd.tapsAria')} /><span className="fd-opt-txt">{t('fd.batchH')}<small>{!batch.done ? t('fd.batchBusy') : batch.count ? t('fd.batchHint').replace('{n}', String(batch.count)) : quickLimitHit ? t('fd.batchLimit') : t('fd.batchNone')}</small></span></b>
          </div>
          {isOpen('batch') && <div className="fd-body">{batch.done ? batch.node : <span className="fd-t">{t('fd.batchBusy')}</span>}</div>}
        </li>}
        <li hidden={!!method && method !== 'mail'}>
          <div hidden={!!method} className={'fd-opt' + (isOpen('mail') ? ' on' : mailGlow ? ' jt-guidance-glow' : '')} role="button" tabIndex={0} aria-expanded={isOpen('mail')} onClick={() => toggle('mail')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('mail') } }}>
            <span className="fd-chev" aria-hidden="true">{isOpen('mail') ? '▾' : '▸'}</span>
            <b><TapCount n={TAPS.mail} label={t('fd.tapsAria')} /><span className="fd-opt-txt">{t('fd.mailH')}<small>{t('fd.mailHint')}</small></span></b>
          </div>
          {/* 2026-11-19 owner: "the Ctrl+V here box is hidden below" - mail buttons, step, paste box first; the AI/add-on notes and the narrower search under it */}
          {isOpen('mail') && <div className="fd-body">

          {/* 2026-11-20 owner: "needs cleaning up" - one order for every option: AI note first, search, narrow it, paste, then the next search as a big button */}
          {!failNoteTop && noteSlot(shortFail)}
          {phoneLike() ? <MailAppBtns company={mailName(a.company)} t={t} onBack={() => setMailBack(true)} date={date} big={!shortFail}
            between={a.role ? <div className="fd-mailrow fd-mailrole"><span className="fd-t">{t('fd.mailManyShort')}</span><CopyBtn text={a.role} label={t('fd.copyRole')} t={t} /></div> : null} /> : <div className="fd-mailrow">
            <a className={'fd-lnk' + (aiFail ? ' jt-guidance-glow' : '')} href={`https://mail.proton.me/u/0/all-mail#keyword=${q(mailName(a.company))}`} {...ext}>{t('jr.mailProton')}</a>
            <a className={'fd-lnk' + (aiFail ? ' jt-guidance-glow' : '')} href={`https://mail.google.com/mail/u/0/#search/${q(mailName(a.company))}`} {...ext}>{t('jr.mailGmail')}</a>
            <CopyBtn text={mailName(a.company)} label={t('fd.mailOther')} t={t} />
          </div>}
          {/* 2026-11-19 owner: Swissquote gave lots of emails; narrowing needed the job title, found by scrolling to the form copy. Now one tap here. */}
          {a.role && !phoneLike() && (
            <div className="fd-mailrow fd-mailrole"><span className="fd-t">{t('fd.mailMany')}</span>
              <a className="fd-lnk" href={`https://mail.proton.me/u/0/all-mail#keyword=${q(mailName(a.company) + ' ' + a.role)}`} {...ext}>{t('fd.mailProtonRole').replace('{role}', a.role)}</a>
              <a className="fd-lnk" href={`https://mail.google.com/mail/u/0/#search/${q(mailName(a.company) + ' ' + a.role)}`} {...ext}>{t('fd.mailGmailRole').replace('{role}', a.role)}</a>
              <CopyBtn text={a.role} label={t('fd.copyRole')} t={t} />
            </div>)}
          {!phoneLike() && <p className="fd-flow">{flow(t('fd.flowMail'), { date: <b className="fd-data">{date}</b> })}</p>}
          {pasteBox(ad, setAd)}
          {/* 2026-11-20 owner: amber hint, not a button - History and bookmarks search is the option right below, the arrow points to it */}
          {jobRoomMissing(e).length > 0 && <p ref={mailNextRef} className={'fd-mailnext' + (mailBack ? ' fd-mailnext-pulse' : '')}>{t('fd.mailNext').replace('{date}', date)}<span className="fd-mailnext-arrow" aria-hidden="true">↓</span></p>}
          {inOpt && (foundHere || openOpt !== 'link') && resultBox}
          </div>}
        </li>

        {/* 2026-11-03 owner: applied on the company's website - the confirmation email has no link, so look in the browser history or the portal */}
        {!method && <li>
          <div className={'fd-opt' + (isOpen('link') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('link')} onClick={() => toggle('link')} onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle('link') } }}>
            <span className="fd-chev" aria-hidden="true">{isOpen('link') ? '▾' : '▸'}</span>
            <b><TapCount n={TAPS.link} label={t('fd.tapsAria')} /><span className="fd-opt-txt">{t('fd.linkH')}<small>{t('fd.linkHint')}</small></span></b>
          </div>
          {isOpen('link') && <div className="fd-body">
            {!failNoteTop && !phoneLike() && !isApp() && noteSlot(shortFail)}   {/* 2026-11-20 owner: the AI note sits at the top of every option. 2026-11-21 owner: not in History search on phone/app - it pushed step 4 off screen; the by-hand steps use no AI */}
            {/* 2026-11-20 owner: "can this be auto detected or made easier?" - a web page cannot see the browser's sync setting;
                one tap "It's on" hides this for good on this device */}
            {/* 2026-11-20 owner: after 'hide this' there was no way back - one small link brings the steps back */}
            {syncOn && <button type="button" className="fd-sync-back" onClick={() => { try { localStorage.removeItem('jt-sync-on') } catch { /* private mode */ } setSyncOn(false) }}>{t('fd.syncBack')}</button>}
            {!syncOn && <details className="fd-fold"><summary>{t('fd.syncH')}</summary>
              <SyncSteps t={t} />
              <button type="button" className="btn-secondary fd-btn" onClick={() => { try { localStorage.setItem('jt-sync-on', '1') } catch { /* private mode */ } setSyncOn(true) }}>{t('fd.syncIsOn')}</button>{/* 2026-11-20 owner: the ✓ on the button looked like the page had checked Firefox - it can't, the person says so */}
            </details>}
            {addon
              ? <>
                <button type="button" className="btn btn-glow fd-btn" onClick={searchHistory} disabled={hist.state === 'busy'}>{t('fd.histBtn')}</button>
                {inOpt && foundHere && resultBox}
                {needsLink && statusBelow && (hist.state !== 'idle' || histPerm) && <div className="fd-hist-box">{histStatus}</div>}
              </>
              : <>
                {app && <p className="fd-flow">{t('fd.addonWeb')}</p>}
                {inOpt && foundHere && resultBox}
                {mobile
                  ? <>
                  {/* 2026-11-18 owner: "No user will find that" - Copy company sat inside the Text window; now on screen as step 1, the guide buttons follow */}
                  {/* 2026-11-18 owner: "If I have to search by hand, show the user how" - the hand search as 4 numbered steps on screen; Copy pulses first, then step 2 and the paste box */}
                  {/* 2026-11-18 owner: the on-screen steps 1-4 replace the Text guide; Images and Video sit between the heading and step 1 */}
                  <div className="fd-hand">{/* 2026-11-21 owner: 'Search Firefox History by hand:' line removed */}
                    <GuideRow t={t} title={t('fd.linkH')} group="phone" noText />
                    <HandSteps id={String(a.id)} t={t} company={histName(a.company)} onCopied={() => setCoCopied(true)} onStep={setHandStep} />
                  </div></>
                  /* 2026-11-20 owner: desktop showed only a Text button while the phone shows numbered steps - the install steps are on screen as 1. 2. 3. like the phone, Images and Video above them */
                  : <div className="fd-hand"><b>{t('fd.instH')}</b>
                    <GuideRow t={t} title={t('fd.addonInstall')} group="computer" noText />
                    <InstallSteps t={t} button={installBtn} />
                  </div>}
              </>}
            {/* 2026-11-21 owner: "what is this box for?" - one line says it: the by-hand route */}
            {!addon && !phoneLike() && !isApp() && <p className="fd-flow fd-paste-own">{t('fd.pasteOwn')}</p>}
            {pasteBox(ad, setAd)}
          </div>}
        </li>}
        {/* 7 taps, counted the way TAPS counts: Search the web yourself, a result, Ctrl+L, Ctrl+C, back here, click the box, Ctrl+V */}
        {needsLink && !method && <li>
          <div className={'fd-opt' + (isOpen('webs') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('webs')} onClick={() => toggle('webs')} onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle('webs') } }}>
            <span className="fd-chev" aria-hidden="true">{isOpen('webs') ? '▾' : '▸'}</span>
            <b><TapCount n={7} label={t('fd.tapsAria')} /><span className="fd-opt-txt">{t('fd.webH')}<small>{t('fd.webHint')}</small></span></b>
          </div>
          {isOpen('webs') && <div className="fd-body">{!failNoteTop && noteSlot(shortFail)}{inOpt && (foundHere || openOpt !== 'link') && resultBox}
            <a className="btn btn-glow fd-btn" href={`https://www.google.com/search?q=${encodeURIComponent([a.company, a.role, a.city, 'job'].filter(Boolean).join(' '))}`} {...ext}>{t('fd.webSelf')}</a>
            {pasteBox(ad, setAd)}
          </div>}
        </li>}

        {!method && twin && needAddr && <li>
          <div className={'fd-opt' + (isOpen('twin') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('twin')} onClick={() => toggle('twin')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('twin') } }}>
            <span className="fd-chev" aria-hidden="true">{isOpen('twin') ? '▾' : '▸'}</span>
            <b><TapCount n={TAPS.twin} label={t('fd.tapsAria')} /><span className="fd-opt-txt">{t('fd.twinH')}<small>{t('fd.twinHint')}</small></span></b>
          </div>
          {isOpen('twin') && <div className="fd-body">{!failNoteTop && noteSlot(shortFail)}{inOpt && (foundHere || openOpt !== 'link') && resultBox}
          <span className="fd-t">{t('fd.twinFrom')} <b>{twin.company}</b>{twin.role ? ' - ' + twin.role : ''} ({swissDate(twin.date)})</span>
          <span className="fd-side">{t('fd.twinCheck')}</span>
          <span className="fd-t">{[[twin.street, twin.streetNo].filter(Boolean).join(' '), [twin.postal, twin.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span>
          <button type="button" className="btn btn-glow fd-btn" onClick={() => {
            const patch: Rec = {}
            for (const k of ['street', 'streetNo', 'postal', 'city'] as const) if (twin[k] && !ev[k]) patch[k] = twin[k] as string
            if (Object.keys(patch).length) onUpdate(a.id, patch as Patch)
          }}>{t('jr.useIt')}</button>
          </div>}
        </li>}

        <li hidden={!!method && method !== 'addr'}>
          <div hidden={!!method} className={'fd-opt' + (isOpen('addr') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('addr')} onClick={() => toggle('addr')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('addr') } }}>
            <span className="fd-chev" aria-hidden="true">{isOpen('addr') ? '▾' : '▸'}</span>
            <b><TapCount n={TAPS.addr} label={t('fd.tapsAria')} /><span className="fd-opt-txt">{t('fd.addrH')}<small>{t('fd.addrHint')}</small></span></b>
          </div>
          {isOpen('addr') && <div className="fd-body">{!failNoteTop && noteSlot(shortFail)}{inOpt && (foundHere || openOpt !== 'link') && resultBox}
          <span className="fd-t">{t('fd.autoT')}</span>
          <a className="btn-secondary fd-btn" href={`https://www.zefix.ch/en/search/entity/list?name=${q(a.company)}`} {...ext}><Ico d={BUILDING} />{t('fd.zefix')}</a>
          <a className="btn-secondary fd-btn" href={`https://search.ch/tel/?was=${q(a.company)}`} {...ext}><Ico d={BUILDING} />{t('fd.searchch')}</a>
          <a className="btn-secondary fd-btn" href={`https://www.google.com/maps/search/${q(a.company)}`} {...ext}><Ico d={PIN} />{t('fd.map')}</a>
          <span className="fd-t">{t('fd.copyHint')}</span>
          {pasteBox(ad, setAd)}
          {a.addrUnknown
            ? <span className="fd-note">{t('fd.cantFindDone')} <button type="button" className="btn-secondary fd-btn" onClick={() => onUpdate(a.id, { addrUnknown: undefined })}>{t('fd.cantFindUndo')}</button></span>
            : <button type="button" className="btn-secondary fd-btn" onClick={() => onUpdate(a.id, { addrUnknown: true })}>{t('fd.cantFind')}</button>}
          </div>}
        </li>

        <li hidden={!!method && method !== 'site'}>
          <div hidden={!!method} className={'fd-opt' + (isOpen('site') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('site')} onClick={() => toggle('site')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('site') } }}>
            <span className="fd-chev" aria-hidden="true">{isOpen('site') ? '▾' : '▸'}</span>
            <b><TapCount n={TAPS.site} label={t('fd.tapsAria')} /><span className="fd-opt-txt">{t('fd.siteH')}<small>{t('fd.siteHint')}</small></span></b>
          </div>
          {isOpen('site') && <div className="fd-body">{!failNoteTop && noteSlot(shortFail)}{inOpt && (foundHere || openOpt !== 'link') && resultBox}
          <a className="btn-secondary fd-btn" href={`https://www.google.com/search?q=${q(`${a.company} ${site} contact us about us`)}`} {...ext}>{t('jr.siteSearch')}</a>
          {site && <a className="btn-secondary fd-btn" href={`https://www.${site}/`} {...ext}>{site}</a>}
          {pasteBox(ad, setAd)}
          </div>}
        </li>

        <li hidden={!!method && method !== 'other'}>
          <div hidden={!!method} className={'fd-opt' + (isOpen('other') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('other')} onClick={() => toggle('other')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('other') } }}>
            <span className="fd-chev" aria-hidden="true">{isOpen('other') ? '▾' : '▸'}</span>
            <b><TapCount n={TAPS.other} label={t('fd.tapsAria')} /><span className="fd-opt-txt">{t('fd.otherH')}<small>{t('fd.otherHint')}</small></span></b>
          </div>
          {isOpen('other') && <div className="fd-body">{!failNoteTop && noteSlot(shortFail)}{inOpt && (foundHere || openOpt !== 'link') && resultBox}
          <span className="fd-t">{t('fd.otherT')}</span>
          <a className="btn-secondary fd-btn" href={`https://mail.google.com/mail/u/0/#search/${q('jobs.ch OR jobup.ch OR indeed OR linkedin OR ostjob')}`} {...ext}>{t('fd.otherMail')}</a>
          <a className="btn-secondary fd-btn" href={`https://www.google.com/search?q=${q(term)}`} {...ext}>{t('fd.otherBtn')}</a>
          </div>}
        </li>

        <li hidden={!!method && method !== 'ad'}>
          <div hidden={!!method} className={'fd-opt' + (isOpen('ad') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('ad')} onClick={() => toggle('ad')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('ad') } }}>
            <span className="fd-chev" aria-hidden="true">{isOpen('ad') ? '▾' : '▸'}</span>
            <b><TapCount n={TAPS.ad} label={t('fd.tapsAria')} /><span className="fd-opt-txt">{t('fd.adH')}<small>{t('fd.adHint')}</small></span></b>
          </div>
          {isOpen('ad') && <div className="fd-body">{!failNoteTop && noteSlot(shortFail)}{inOpt && (foundHere || openOpt !== 'link') && resultBox}
          <p className="fd-flow">{flow(t('fd.flowAd'), {
            copy: <CopyBtn text={term} label={t('fd.copyJob')} t={t} />,
            room: <a className="fd-lnk" href="https://www.job-room.ch/" {...ext}>Job-Room</a>,
          })}</p>
          {pasteBox(ad2, setAd2)}
          </div>}
        </li>

        <li hidden={!!method && method !== 'type'}>
          <div hidden={!!method} className={'fd-opt' + (isOpen('type') ? ' on' : '')} role="button" tabIndex={0} aria-expanded={isOpen('type')} onClick={() => toggle('type')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('type') } }}>
            <span className="fd-chev" aria-hidden="true">{isOpen('type') ? '▾' : '▸'}</span>
            <b><TapCount n={TAPS.type} label={t('fd.tapsAria')} /><KeyCount n={KEYS.type} label={t('fd.keysAria')} /><span className="fd-opt-txt">{t('fd.typeH')}<small>{t('fd.typeHint')}</small></span></b>
          </div>
          {isOpen('type') && <div className="fd-body">{!failNoteTop && noteSlot(shortFail)}{inOpt && (foundHere || openOpt !== 'link') && resultBox}
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
