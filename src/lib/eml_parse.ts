// 2026-11-16 owner: "Copying an email never knows how much text to copy ... export email? ... compatible with gmail,
// thunderbird etc." Reads a saved email file (.eml: Gmail "Download message", Thunderbird/Apple Mail/Proton "Save as",
// Outlook web "Download") in the browser - nothing is uploaded. Gives the sender, subject and body as plain text.

export type ParsedEmail = { from: string; subject: string; body: string }

const bytesOf = (bin: string) => Uint8Array.from(bin, c => c.charCodeAt(0) & 0xff)
function decodeBytes(bytes: Uint8Array, charset: string): string {
  const cs = (charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '')
  try { return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs).decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}
function qpBytes(s: string): Uint8Array {
  const t = s.replace(/=\r?\n/g, '')
  const out: number[] = []
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) { out.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2 }
    else out.push(t.charCodeAt(i) & 0xff)
  }
  return Uint8Array.from(out)
}
function b64Bytes(s: string): Uint8Array {
  try { return bytesOf(atob(s.replace(/[^A-Za-z0-9+/=]/g, ''))) } catch { return new Uint8Array() }
}
// =?charset?B?...?= and =?charset?Q?...?= in headers (accents in subjects and names)
function decodeWords(v: string): string {
  return v.replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) =>
    decodeBytes(enc.toUpperCase() === 'B' ? b64Bytes(txt) : qpBytes(txt.replace(/_/g, ' ')), cs))
}
function splitHead(raw: string): { head: Map<string, string>; body: string } {
  const m = raw.match(/\r?\n\r?\n/)
  const headText = m ? raw.slice(0, m.index) : raw
  const body = m ? raw.slice((m.index ?? 0) + m[0].length) : ''
  const head = new Map<string, string>()
  for (const line of headText.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':'); if (i < 1) continue
    const k = line.slice(0, i).trim().toLowerCase()
    if (!head.has(k)) head.set(k, line.slice(i + 1).trim())
  }
  return { head, body }
}
const param = (v: string, name: string) => (v.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i')) || [])[2] ?? (v.match(new RegExp(`${name}\\s*=\\s*([^;\\s]+)`, 'i')) || [])[1] ?? ''
function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html.replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, '$&\n'), 'text/html')
  doc.querySelectorAll('style,script,head').forEach(n => n.remove())
  return (doc.body?.textContent || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
// best text of a MIME part: text/plain first, else text/html turned into text
function partText(raw: string): { plain: string; html: string } {
  const { head, body } = splitHead(raw)
  const type = head.get('content-type') || 'text/plain'
  if (/^multipart\//i.test(type)) {
    const boundary = param(type, 'boundary')
    if (!boundary) return { plain: '', html: '' }
    let plain = '', html = ''
    for (const p of body.split('--' + boundary).slice(1)) {
      if (/^--/.test(p)) break
      const r = partText(p.replace(/^\r?\n/, ''))
      plain ||= r.plain; html ||= r.html
    }
    return { plain, html }
  }
  if (/attachment/i.test(head.get('content-disposition') || '')) return { plain: '', html: '' }
  const enc = (head.get('content-transfer-encoding') || '').toLowerCase()
  const bytes = enc === 'base64' ? b64Bytes(body) : enc === 'quoted-printable' ? qpBytes(body) : bytesOf(body)
  const text = decodeBytes(bytes, param(type, 'charset'))
  if (/^text\/html/i.test(type)) return { plain: '', html: text }
  if (/^text\//i.test(type) || !head.has('content-type')) return { plain: text, html: '' }
  if (/^message\/rfc822/i.test(type)) return partText(text)
  return { plain: '', html: '' }
}

export class OutlookMsgError extends Error {}

export async function parseEmailFile(file: File): Promise<ParsedEmail> {
  const buf = new Uint8Array(await file.arrayBuffer())
  // Outlook desktop .msg is a binary format, not an email text file
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) throw new OutlookMsgError('msg')
  let raw = ''
  for (let i = 0; i < buf.length; i += 0x8000) raw += String.fromCharCode(...buf.subarray(i, i + 0x8000))   // bytes kept as-is, decoded per part
  raw = raw.replace(/^From [^\n]*\n/, '')   // .mbox with one message
  const { head } = splitHead(raw)
  const t = partText(raw)
  const from = decodeWords(head.get('from') || '')
  const addr = (from.match(/<([^>]+)>/) || [])[1] || from
  return { from: addr.trim(), subject: decodeWords(head.get('subject') || '').trim(), body: (t.plain.trim() || htmlToText(t.html)).trim() }
}
