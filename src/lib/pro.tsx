import { useEffect, useState, type ReactNode } from 'react'
import './pro.css'

// 2026-10-06: one-time Pro unlocks (Transfer Pro pattern, reused per tool).
// The buyer's signed link (<page>?t=...) is kept in this browser and checked
// against the site's public key. The 7-day link expiry doesn't apply - Pro
// is for good. Payment runs through the same modal as every other product.

const PUBLIC_KEY_HEX = '03f849f2d6db33e9bab83594d5527ed1e45bd6062023b99edb964f512cbf82b3'
const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

export async function proValid(tok: string, scopePrefix: string): Promise<boolean> {
  const parts = tok.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64u(parts[1])))
    if (!String(payload.scope).startsWith(scopePrefix)) return false
    if (payload.trial === true && Date.now() / 1000 > Number(payload.exp)) return false   // a free trial key really ends
    const hex = Uint8Array.from(PUBLIC_KEY_HEX.match(/../g)!.map(h => parseInt(h, 16)))
    const key = await crypto.subtle.importKey('raw', hex, { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify('Ed25519', key, b64u(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  } catch { return false }
}

// Reads ?t= once (then strips it from the address bar), keeps it, checks it.
export function useProKey(storageKey: string, scopePrefix: string): { pro: boolean; tok: string } {
  const [state, setState] = useState({ pro: false, tok: '' })
  useEffect(() => {
    let tok = ''
    try {
      const u = new URLSearchParams(window.location.search).get('t')
      if (u) { localStorage.setItem(storageKey, u); history.replaceState(null, '', window.location.pathname + window.location.hash) }
      tok = localStorage.getItem(storageKey) ?? ''
    } catch { /* private mode */ }
    const check = tok ? proValid(tok, scopePrefix) : Promise.resolve(false)
    check.then(ok => {
      if (ok) { setState({ pro: true, tok }); return }
      // the owner's browser (it holds the owner key, set once at /free) needs no purchase and no link: ask for a key
      ownerKeyFor(scopePrefix).then(t => { if (t) { try { localStorage.setItem(storageKey, t) } catch { /* ignore */ } setState({ pro: true, tok: t }) } })
    })
    // a promo code typed into the page: unlock in place, so a PDF already chosen on the page is not lost
    const onUnlock = (e: Event) => {
      const t = String((e as CustomEvent).detail || '')
      proValid(t, scopePrefix).then(ok => { if (ok) { try { localStorage.setItem(storageKey, t) } catch { /* ignore */ } setState({ pro: true, tok: t }) } })
    }
    window.addEventListener('kworld-unlock', onUnlock)
    return () => window.removeEventListener('kworld-unlock', onUnlock)
  }, [storageKey, scopePrefix])
  return state
}

// 2026-10-21 owner: a browser that holds the owner key unlocks every product by itself. The site checks the key and
// hands back a no-limit key for just that product; nobody else can ask for one.
const OWNER_PRODUCT: Record<string, string> = { 'bookmarks-pro-': 'bookmarks-pro', 'sign-pro-': 'sign-pro', 'sign-design-': 'sign-art', 'jobtrack-pro-': 'jobtrack', 'divorce-forms-': 'divorce', 'transfer-pro-': 'transfer' }
export async function ownerKeyFor(scopePrefix: string): Promise<string> {
  try {
    const key = localStorage.getItem('kworld_owner_key'); const product = OWNER_PRODUCT[scopePrefix]
    if (!key || !product) return ''
    const r = await fetch('/owner/grant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, product, days: 0 }) })
    const j = await r.json()
    return j.status === 'ok' ? String(j.link).split('?t=')[1] || '' : ''
  } catch { return '' }
}

export function buyPro(o: { scope: string; amount: number; title: string; subtitle: string }) {
  const open = () => (window as any).PaymentModal?.open({
    title: o.title, subtitle: o.subtitle, amount: o.amount, currency: 'USD', scope: o.scope,
    methods: ['lightning', 'bmc', 'liberapay', 'paypal'],
    lightning: { address: 'steamyice42@walletofsatoshi.com', qrSrc: '/assets/wos.svg' },
    links: { liberapay: 'https://liberapay.com/kworld', paypal: 'https://paypal.me/kworldstarsha', bmc: 'https://buymeacoffee.com/kworldstarsha' },
    endpoint: '/api/purchase', ntfyTopic: 'owner', ntfyLabel: `${o.title} $${o.amount}`,
  })
  if ((window as any).PaymentModal) { open(); return }
  const script = document.createElement('script'); script.src = '/payment-modal.js'
  script.onload = open; document.head.appendChild(script)
}

type Tx = (en: string, de: string, fr: string) => string
export const makeL = (lang: string): Tx => (en, de, fr) => (lang === 'de' ? de : lang === 'fr' ? fr : en)

const STAR = <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="#ffb000"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>

// Upfront, before paying: what's in it for you / you pay / you get / we never.
// "You get" and "We never" are sorted A-Z (main noun first in every line).
// Free way in: a one-time code (four words with hyphens: word1-word2-word3-word4) goes to /redeem, which uses it up and opens the product;
// the owner key (no hyphens) is kept in this browser, checked now, and unlocks every product by itself.
export function FreeEntry({ L, scopePrefix }: { L: Tx; scopePrefix: string }) {
  const [val, setVal] = useState('')
  const [show, setShow] = useState(false)   // eye button: show the typed code or hide it
  const [state, setState] = useState<'' | 'busy' | 'ok' | 'bad' | 'slow'>('')   // shown on the button itself, so nothing on the page moves
  const go = async () => {
    const v = val.trim()
    if (!v || state) return
    setState('busy')
    const t0 = Date.now()
    const done = async (tok: string, slow = false) => {
      const wait = 1200 - (Date.now() - t0)   // show Checking... long enough to read
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      if (tok) { setState('ok'); setTimeout(() => window.dispatchEvent(new CustomEvent('kworld-unlock', { detail: tok })), 1800); return }
      setState(slow ? 'slow' : 'bad'); setTimeout(() => setState(''), 3000)
    }
    if (v.includes('-')) {   // a passphrase code: redeemed here, the page stays as it is
      try {
        const j = await (await fetch('/api/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: v }) })).json()
        const tok = j.status === 'ok' ? String(j.link).split('?t=')[1] || '' : ''
        if (tok && !(await proValid(tok, scopePrefix))) return done('')
        return done(tok, j.status === 'slow')
      } catch { return done('') }
    }
    let prev: string | null = null
    try { prev = localStorage.getItem('kworld_owner_key'); localStorage.setItem('kworld_owner_key', v) } catch { /* private mode */ }
    const tok = await ownerKeyFor(scopePrefix)
    if (!tok) { try { if (prev) localStorage.setItem('kworld_owner_key', prev); else localStorage.removeItem('kworld_owner_key') } catch { /* ignore */ } }
    return done(tok)
  }
  return (
    <div className="pro-free">
      <p className="pro-free-title">{L('Promo code', 'Promo-Code', 'Code promo')}</p>
      <div className="pro-free-row">
        <input type={show ? 'text' : 'password'} name="kworld_free_entry" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }}
          placeholder="Your1-code" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          data-bwignore="true" data-lpignore="true" data-1p-ignore="true" />
        <button type="button" className="pro-free-eye" aria-label={show ? L('Hide code', 'Code verbergen', 'Masquer le code') : L('Show code', 'Code anzeigen', 'Afficher le code')} aria-pressed={show} onClick={() => setShow(v => !v)}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />{show && <path d="M3 3l18 18" />}
          </svg>
        </button>
        <button type="button" className="pro-free-go" disabled={!!state || !val.trim()} onClick={go}>{state === 'busy' ? L('Checking...', 'Prüfe...', 'Vérification...') : state === 'ok' ? L('Valid - unlocking', 'Gültig - schalte frei', 'Valide - déblocage') : state === 'slow' ? L('Try tomorrow', 'Morgen wieder', 'Demain') : state === 'bad' ? L('Invalid', 'Ungültig', 'Invalide') : L('Unlock', 'Freischalten', 'Débloquer')}</button>
      </div>
      <p className="tb-small pro-free-earn">{L('Earn a promo code: report a bug.', 'Verdiene einen Promo-Code: melde einen Fehler.', 'Gagnez un code promo : signalez un bogue.')} <a href="/contact?topic=bug">{L('Report', 'Melden', 'Signaler')}</a></p>
    </div>
  )
}

export function ProBox({ L, title, why, amount, get, never, onBuy, children, scopePrefix }: {
  L: Tx; title: string; why: string; amount: number; get: string[]; never: string[]; onBuy: () => void; children?: ReactNode; scopePrefix?: string
}) {
  const az = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b))
  return (
    <div className="pro-box">
      <h3>{STAR} {title}</h3>
      <p className="pro-box-why">{why}</p>
      <dl>
        <dt>{L('You pay', 'Du zahlst', 'Vous payez')}</dt><dd>US${amount}, {L('once - no subscription. Your payment method converts it to your local currency.', 'einmal - kein Abo. Ihre Zahlungsart rechnet in Ihre Währung um.', "une fois - pas d'abonnement. Votre moyen de paiement convertit dans votre devise.")}</dd>
        <dt>{L('You get', 'Du bekommst', 'Vous recevez')}</dt><dd><ul>{az(get).map(g => <li key={g}>{g}</li>)}</ul></dd>
        <dt>{L('We never', 'Wir nie', 'Jamais')}</dt><dd><ul>{az(never).map(g => <li key={g}>{g}</li>)}</ul></dd>
      </dl>
      {children}
      <button type="button" className="pro-box-btn" onClick={onBuy}>{L(`Get Pro - $${amount}`, `Pro holen - $${amount}`, `Obtenir Pro - $${amount}`)}</button>
      {scopePrefix && <FreeEntry L={L} scopePrefix={scopePrefix} />}
    </div>
  )
}
