import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { type Application, inRange, monthRange } from './orp'

// 2026-10-13 owner frictions: proofs are due before the 5th, and the ORP
// wants at least 2 searches every week. One-shot reminders for the next
// 1st, 4th and Thursday, with the real counts, re-planned on every change.

const IDS = { first: 101, fourth: 104, thursday: 111 }

function next(day: (d: Date) => boolean, hour: number): Date {
  const d = new Date(); d.setHours(hour, 0, 0, 0)
  if (d <= new Date()) d.setDate(d.getDate() + 1)
  while (!day(d)) d.setDate(d.getDate() + 1)
  return d
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export async function planReminders(apps: Application[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const perm = await LocalNotifications.checkPermissions()
  if (perm.display !== 'granted' && (await LocalNotifications.requestPermissions()).display !== 'granted') return
  await LocalNotifications.cancel({ notifications: Object.values(IDS).map(id => ({ id })) })

  const first = next(d => d.getDate() === 1, 9)
  const fourth = next(d => d.getDate() === 4, 9)
  const thursday = next(d => d.getDay() === 4, 18)

  // searches in the month the proofs are for (the month before the 1st / 4th)
  const lastMonth = (d: Date) => { const m = new Date(d.getFullYear(), d.getMonth() - 1, 1); return inRange(apps, ...monthRange(m.getFullYear(), m.getMonth() + 1)).length }
  const monday = new Date(thursday); monday.setDate(monday.getDate() - 3)
  const thisWeek = inRange(apps, iso(monday), iso(thursday)).length

  await LocalNotifications.schedule({ notifications: [
    { id: IDS.first, title: 'ORP proofs due by the 5th', body: `${lastMonth(first)} searches last month - JobTrack -> ORP proofs -> Make the 716.007 PDF`, schedule: { at: first } },
    { id: IDS.fourth, title: 'ORP proofs due TOMORROW', body: `${lastMonth(fourth)} searches last month - send them today: JobTrack -> ORP proofs`, schedule: { at: fourth } },
    ...(thisWeek < 2 ? [{ id: IDS.thursday, title: `This week: ${thisWeek} of 2 searches`, body: 'The ORP expects at least 2 a week - JobTrack -> Add', schedule: { at: thursday } }] : []),
  ] as Parameters<typeof LocalNotifications.schedule>[0]['notifications'] })
}
