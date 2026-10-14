// 2026-10-14 owner: "I work between phone and desktop, so that messes up
// jobtrack" - each browser kept its own list. Sync = the computer shows a QR,
// the phone scans it, both lists become one. Works on a library computer too
// (just the web page, nothing to install).
// The list goes through the transfer-signal introducer, locked (AES-256-GCM)
// with a key that travels only inside the QR (#e=, never sent over a network).
// The server sees locked data and that two devices linked - nothing else.
import { type Application } from './orp'
import { EFF_BY_LEN } from '../pages/passphrase_words'

export const SIGNAL = import.meta.env.DEV && new URLSearchParams(window.location.search).has('localsig')
  ? 'ws://localhost:8787/room/'
  : 'wss://transfer-signal.kinhswch-cloudflare.workers.dev/room/'

// ── Merge ──
// Owner rule: never lose data > never duplicate. Each device keeps the list as
// it was right after its last sync (its "base"). Per entry:
//  - same on both sides -> one
//  - only one side changed it since its last sync -> that side's version
//  - both changed it -> Keep Both (the phone's copy gets a new id)
//  - one side deleted it, the other didn't touch it -> deleted
//  - one side deleted it, the other changed it -> kept
export type Base = Record<number, string>
export const baseOf = (apps: Application[]): Base => Object.fromEntries(apps.map(a => [a.id, key(a)]))
// field order doesn't matter - sorted keys
export function key(a: Application): string {
  return JSON.stringify(Object.keys(a).sort().map(k => [k, (a as any)[k] ?? '']).filter(([, v]) => v !== ''))
}

export interface MergeResult { apps: Application[]; fromPhone: number; fromComputer: number; both: number; removed: number }

export function merge(pc: Application[], pcBase: Base, phone: Application[], phoneBase: Base): MergeResult {
  const P = new Map(pc.map(a => [a.id, a]))
  const Q = new Map(phone.map(a => [a.id, a]))
  const ids = [...new Set([...P.keys(), ...Q.keys()])]
  const out: Application[] = []
  let fromPhone = 0, fromComputer = 0, both = 0, removed = 0
  let nextId = Math.max(Date.now(), ...ids) + 1
  for (const id of ids) {
    const p = P.get(id), q = Q.get(id)
    const pChanged = p ? pcBase[id] !== key(p) : id in pcBase
    const qChanged = q ? phoneBase[id] !== key(q) : id in phoneBase
    if (p && q) {
      if (key(p) === key(q)) out.push(p)
      else if (!pChanged) { out.push(q); fromPhone++ }
      else if (!qChanged) { out.push(p); fromComputer++ }
      else { out.push(p, { ...q, id: nextId++ }); both++ }
    } else if (p) {
      // the phone had it and deleted it, the computer didn't touch it -> gone
      if (id in phoneBase && !pChanged) removed++
      else { out.push(p); if (!(id in phoneBase)) fromComputer++ }
    } else if (q) {
      if (id in pcBase && !qChanged) removed++
      else { out.push(q); if (!(id in pcBase)) fromPhone++ }
    }
  }
  return { apps: out, fromPhone, fromComputer, both, removed }
}

// ── Link ──
const SHORT = [3, 4, 5].flatMap(n => EFF_BY_LEN[n] ?? [])
// room = 4 EFF words joined by 0 (the introducer takes [a-z0-9] only)
export const newRoom = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => SHORT[n % SHORT.length]).join('0')
const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
const b64uEnc = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const newKey = () => b64uEnc(crypto.getRandomValues(new Uint8Array(32)))
// a scanned QR (app) or this page's own address (phone browser)
export function linkFromText(t: string): { room: string; key: string } | null {
  const m = /[#&]sync=([a-z0-9]{10,40})&e=([A-Za-z0-9_-]{43})/.exec(t)
  return m ? { room: m[1], key: m[2] } : null
}
export const linkFromHash = () => linkFromText(window.location.hash)

const enc = new TextEncoder()
async function importKey(raw: string) { return crypto.subtle.importKey('raw', b64u(raw), 'AES-GCM', false, ['encrypt', 'decrypt']) }
async function seal(k: CryptoKey, text: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, k, enc.encode(text)))
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12)
  return b64uEnc(out)
}
async function unseal(k: CryptoKey, s: string, aad: string): Promise<string> {
  const b = b64u(s)
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12), additionalData: enc.encode(aad) }, k, b.subarray(12)))
}

// the introducer drops messages over 64,000 characters
const PART = 48000

export interface SyncLink { send: (kind: string, body: unknown) => Promise<void>; close: () => void }

// Joins the room; onPeers(n) = how many browsers are in it, onMsg = a whole
// unlocked message. A message that fails to unlock (wrong key) is dropped.
export async function openLink(room: string, rawKey: string, role: 'computer' | 'phone', on: {
  open: () => void; peers: (n: number) => void; msg: (kind: string, body: any) => void; lost: () => void
}): Promise<SyncLink> {
  const k = await importKey(rawKey)
  const ws = new WebSocket(SIGNAL + room + '?role=' + role)
  let alive = true
  const parts = new Map<string, string[]>()
  ws.onopen = () => on.open()
  ws.onerror = () => { if (alive) on.lost() }
  ws.onclose = () => { if (alive) on.lost() }
  ws.onmessage = async ev => {
    let m: any
    try { m = JSON.parse(ev.data) } catch { return }
    if (m.type === 'peers') { on.peers(m.n); return }
    if (m.type !== 'js' || typeof m.id !== 'string') return
    const got = parts.get(m.id) ?? []
    got[m.i] = m.d
    parts.set(m.id, got)
    if (got.filter(x => x !== undefined).length !== m.n) return
    parts.delete(m.id)
    try {
      const { kind, body } = JSON.parse(await unseal(k, got.join(''), room))
      on.msg(kind, body)
    } catch { /* not ours / wrong key */ }
  }
  return {
    async send(kind, body) {
      const s = await seal(k, JSON.stringify({ kind, body }), room)
      const id = b64uEnc(crypto.getRandomValues(new Uint8Array(6)))
      const n = Math.ceil(s.length / PART) || 1
      for (let i = 0; i < n; i++) ws.send(JSON.stringify({ type: 'js', id, i, n, d: s.slice(i * PART, (i + 1) * PART) }))
    },
    close() { alive = false; try { ws.close() } catch { /* gone */ } },
  }
}
