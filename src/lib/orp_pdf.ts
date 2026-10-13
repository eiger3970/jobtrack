import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { type Application, METHOD_FR, orpResult, swissDate } from './orp'

// 2026-10-13 owner: the ORP mails form 716.007 as Word files to print -
// "homeless, papers get lost, stolen, damaged". Same columns, same order as
// the form, filled from the tracker, one A4 landscape page per 12 searches.

export interface OrpProfile { name: string; avs: string }

const COLS: { head: string; w: number }[] = [
  { head: 'Date', w: 52 },
  { head: 'Entreprise, adresse', w: 150 },
  { head: 'Personne contactée, tél.', w: 105 },
  { head: 'Description du poste', w: 150 },
  { head: 'Assign. ORP', w: 52 },
  { head: 'Activité', w: 58 },
  { head: 'Offre de service', w: 92 },
  { head: 'Résultat', w: 62 },
  { head: 'Motif', w: 60 },
]
const ROWS_PER_PAGE = 12
const BLACK = rgb(0, 0, 0)

function fit(font: PDFFont, text: string, size: number, width: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (font.widthOfTextAtSize(next, size) <= width) cur = next
    else { if (cur) lines.push(cur); cur = w }
    if (lines.length === maxLines) break
  }
  if (lines.length < maxLines && cur) lines.push(cur)
  return lines.slice(0, maxLines)
}

// pdf-lib's standard fonts are WinAnsi - drop what they can't draw instead of crashing
const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E -ÿ]/g, '')

export async function buildOrpPdf(apps: Application[], profile: OrpProfile, periodLabel: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Preuves des recherches - ${periodLabel}`)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const pages = Math.max(1, Math.ceil(apps.length / ROWS_PER_PAGE))

  for (let p = 0; p < pages; p++) {
    const page: PDFPage = doc.addPage([842, 595])
    const text = (s: string, x: number, y: number, size = 8, f = font) => page.drawText(safe(s), { x, y, size, font: f, color: BLACK })
    text('Assurance-chômage', 30, 560, 9)
    text('Preuves des recherches personnelles effectuées en vue de trouver un emploi', 30, 545, 13, bold)
    text('A remettre à l\'ORP au plus tard le 5 du mois suivant', 560, 560, 8)
    text(`Nom et prénom: ${profile.name}`, 30, 522, 10)
    text(`No AVS: ${profile.avs}`, 330, 522, 10)
    text(`Mois et année: ${periodLabel}`, 560, 522, 10)
    text(`Page ${p + 1} / ${pages}`, 760, 30, 8)

    let x = 30
    const top = 505, headH = 20, rowH = 36
    for (const c of COLS) {
      page.drawRectangle({ x, y: top - headH, width: c.w, height: headH, borderColor: BLACK, borderWidth: 0.7 })
      text(c.head, x + 3, top - 13, 7.5, bold)
      x += c.w
    }
    const rows = apps.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE)
    for (let r = 0; r < ROWS_PER_PAGE; r++) {
      const a = rows[r]
      const yTop = top - headH - r * rowH
      x = 30
      const cells = a ? [
        swissDate(a.date),
        [a.company, a.address].filter(Boolean).join(', '),
        a.contact ?? '',
        a.role,
        a.assigned ? 'oui' : '',
        (a.rate ?? 100) >= 100 ? 'plein temps' : `partiel ${a.rate}%`,
        METHOD_FR[a.method ?? 'electronic'],
        orpResult(a.status),
        a.status === 'rejected' ? (a.motif ?? '') : '',
      ] : COLS.map(() => '')
      COLS.forEach((c, i) => {
        page.drawRectangle({ x, y: yTop - rowH, width: c.w, height: rowH, borderColor: BLACK, borderWidth: 0.5 })
        fit(font, safe(cells[i]), 7.5, c.w - 6, 4).forEach((line, li) => text(line, x + 3, yTop - 10 - li * 8.5, 7.5))
        x += c.w
      })
    }
  }
  return doc.save()
}
