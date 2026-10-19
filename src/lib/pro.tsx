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
    if (tok) proValid(tok, scopePrefix).then(ok => setState({ pro: ok, tok: ok ? tok : '' }))
  }, [storageKey, scopePrefix])
  return state
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
export function ProBox({ L, title, why, amount, get, never, onBuy, children }: {
  L: Tx; title: string; why: string; amount: number; get: string[]; never: string[]; onBuy: () => void; children?: ReactNode
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
    </div>
  )
}
