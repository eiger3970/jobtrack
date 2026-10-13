import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

// 2026-10-13 owner: "records lived only in one browser". In the app the
// tracker still reads localStorage (same code as kworld.space/jobtrack),
// but iOS may clear a web view's storage when space runs low - every
// kworld_ key is mirrored into native Preferences and restored at start.

const PREFIX = 'kworld_'

export async function restoreFromNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const { keys } = await Preferences.keys()
  for (const key of keys) {
    if (!key.startsWith(PREFIX) || localStorage.getItem(key) !== null) continue
    const { value } = await Preferences.get({ key })
    if (value !== null) localStorage.setItem(key, value)
  }
}

// Wrap localStorage.setItem/removeItem once so every write also lands natively.
export function mirrorToNative(): void {
  if (!Capacitor.isNativePlatform()) return
  const set = localStorage.setItem.bind(localStorage)
  const remove = localStorage.removeItem.bind(localStorage)
  localStorage.setItem = (key: string, value: string) => {
    set(key, value)
    if (key.startsWith(PREFIX)) void Preferences.set({ key, value })
  }
  localStorage.removeItem = (key: string) => {
    remove(key)
    if (key.startsWith(PREFIX)) void Preferences.remove({ key })
  }
}
