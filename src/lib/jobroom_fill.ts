// 2026-10-14 owner: "auto fill or bitwarden style ... aim for most user UX". A
// bookmarklet the person clicks on Job-Room's ENTER form (job-room.ch/work-efforts):
// it reads the entry JobTrack copied to the clipboard and fills every field. It
// never presses Save - the person checks and saves (it's their declaration).
// Field ids from the owner's saved copy of the form (14.10.2026), matched by the
// stable part of the id; a field it can't find is outlined amber, the rest still fills.
import { type Application, jobRoomEntry } from './orp'

export interface FillPayload {
  jobtrack: 1
  date: string; method: string
  business: string; street: string; no: string; po: string; country: string; postal: string; city: string
  person: string; email: string; phone: string
  job: string; link: string
  rav: boolean; full: boolean; result: 'PENDING' | 'EMPLOYED' | 'REJECTED'; interview: boolean
}

export function fillPayload(a: Application): FillPayload {
  const e = jobRoomEntry(a)
  return {
    jobtrack: 1, date: e.date, method: e.method,
    business: e.business, street: e.street, no: e.streetNo, po: e.poBox, country: 'CH', postal: e.postal, city: e.city,
    person: e.contactPerson, email: e.email, phone: e.phone,
    job: e.jobTitle, link: e.link,
    rav: e.assigned, full: e.fullTime,
    result: e.result === 'Absage' ? 'REJECTED' : e.result === 'Anstellung' ? 'EMPLOYED' : 'PENDING',
    interview: e.result === 'Vorstellungsgespräch',
  }
}

// Runs inside job-room.ch. Kept as plain browser JS (no imports) - it becomes the bookmarklet.
export function fillJobRoom(d: FillPayload): Promise<string[]> {
  const missed: string[] = []
  const q = (part: string) => document.querySelector<HTMLInputElement>(`[id*="${part}"]`)
  const mark = (el: Element | null, name: string) => { missed.push(name); if (el) (el as HTMLElement).style.outline = '3px solid #ffb000' }
  const type = (part: string, v: string, name: string) => {
    if (!v) return
    const el = q(part)
    if (!el) { mark(null, name); return }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
  }
  const tick = (part: string, on: boolean, name: string) => {
    const el = q(part)
    if (!el) { mark(null, name); return }
    if (el.checked !== on) el.click()
  }
  const channel: Record<string, string> = { electronic: 'apply-channel.electronic', letter: 'apply-channel.mail', visit: 'apply-channel.personal', phone: 'apply-channel.phone' }

  type('date-input', d.date, 'Date')
  tick(channel[d.method] ?? channel.electronic, true, 'Wie beworben')
  type('company.name', d.business, 'Business')
  type('company.street', d.street, 'Street')
  type('house-number', d.no, 'No.')
  type('postbox-number', d.po, 'PO box')
  const country = q('company.country') as unknown as HTMLSelectElement | null
  if (country) {
    const opt = [...country.options].find(o => o.value.endsWith(d.country))
    if (opt) { country.value = opt.value; country.dispatchEvent(new Event('change', { bubbles: true })) }
  }
  type('contact-person', d.person, 'Kontaktperson')
  type('contact.email', d.email, 'Email')
  type('global.phone', d.phone, 'Phone')
  type('job-title', d.job, 'Job title')
  type('online-form-url', d.link, 'Link')
  const radio = (suffix: string, name: string) => {
    const el = document.querySelector<HTMLInputElement>(`input[type="radio"][id$="-${suffix}"]`)
    if (!el) { mark(null, name); return }
    if (!el.checked) el.click()
  }
  radio(d.rav ? 'true' : 'false', 'Zuweisung des RAV')
  radio(d.full ? 'FULLTIME' : 'PARTTIME', 'Arbeitspensum')
  radio(d.result, 'Ergebnis')
  if (d.interview) {
    // the interview tick box has no telling id - find it by its label
    const lab = [...document.querySelectorAll('label')].find(l => /Vorstellungsgespr/.test(l.textContent || ''))
    const box = lab && document.getElementById(lab.htmlFor) as HTMLInputElement | null
    if (box) { if (!box.checked) box.click() } else mark(null, 'Vorstellungsgespräch')
  }

  // Postal code / City is a lookup: type the postal code WITHOUT leaving the field (leaving
  // closed the suggestion list - owner's test 2026-10-14: "1820" left red), wait for the
  // list, click the matching city. No list in time -> cursor left in the field to pick by hand.
  return new Promise(resolve => {
    const city = q('postal-code')
    if (!city || !(d.postal || d.city)) { resolve(missed); return }
    city.focus()
    const v = d.postal || d.city
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(city, v)
    city.dispatchEvent(new Event('input', { bubbles: true }))
    city.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: v.slice(-1) }))
    let tries = 0
    const pick = () => {
      const opts = [...document.querySelectorAll<HTMLElement>('[role="option"], ngb-typeahead-window .dropdown-item, .dropdown-menu .dropdown-item')]
        .filter(o => o.offsetParent !== null)
      const want = (d.city || '').toLowerCase()
      const hit = opts.find(o => (o.textContent || '').toLowerCase().includes(want) && (!d.postal || (o.textContent || '').includes(d.postal))) ?? opts[0]
      if (hit) { hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); hit.click(); resolve(missed) }
      else if (++tries < 40) setTimeout(pick, 200)
      else { mark(city, 'Postal code / City - pick the city from the list'); city.focus(); resolve(missed) }
    }
    setTimeout(pick, 400)
  })
}

// The bookmark (2026-10-14, owner's test: the clipboard came back empty and Firefox's
// Paste prompts confused): it opens a small JobTrack window, which hands over the card
// that is open in JobTrack and closes itself. Clipboard / paste box only as a fallback.
export const FILL_KEY = 'kworld_jobtrack_fill_next'
export function bookmarklet(origin: string): string {
  const body = `(async()=>{const fill=${fillJobRoom.toString()};
const done=async d=>{const m=await fill(d);alert(m.length?'JobTrack filled the form.\\n\\n1. Check the amber fields: '+m.join(', ')+'.\\n2. Tap Save.\\n3. Back in JobTrack, tap Entered in Job-Room.':'JobTrack filled the form.\\n\\n1. Check the details look right.\\n2. Tap Save.\\n3. Back in JobTrack, tap Entered in Job-Room.')};
let got=false;const on=e=>{if(e.origin!=='${origin}'||!e.data||!e.data.jobtrack||got)return;got=true;removeEventListener('message',on);done(e.data)};
addEventListener('message',on);
const w=open('${origin}/jobtrack_fill.html','jobtrackfill','width=360,height=200');
setTimeout(async()=>{if(got)return;removeEventListener('message',on);try{w&&w.close()}catch(e){}
let t='';try{t=await navigator.clipboard.readText()}catch(e){}
if(!t||t.indexOf('"jobtrack"')<0)t=prompt('JobTrack: open JobTrack in another tab with the card showing, then try again - or paste a copied entry here (Ctrl+V)')||'';
if(t.indexOf('"jobtrack"')<0)return;done(JSON.parse(t))},5000)})()`
  return 'javascript:void(' + encodeURIComponent(body.replace(/\n/g, '')) + ')'
}
