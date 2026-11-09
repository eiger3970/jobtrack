// The owner passphrase is kept in this browser only. It used to be stored as "kworld_owner_key": that old entry is
// still read once and copied to the new name, so no browser has to enter the passphrase again.
const STORE = 'kworld_owner_passphrase'
const OLD_STORE = 'kworld_owner_key'

export function getOwnerPassphrase(): string {
  try {
    const now = localStorage.getItem(STORE)
    if (now) return now
    const old = localStorage.getItem(OLD_STORE)
    if (old) { localStorage.setItem(STORE, old); return old }
  } catch { /* private mode */ }
  return ''
}

export function setOwnerPassphrase(value: string): void {
  try { localStorage.setItem(STORE, value) } catch { /* private mode */ }
}

export function clearOwnerPassphrase(): void {
  try { localStorage.removeItem(STORE); localStorage.removeItem(OLD_STORE) } catch { /* private mode */ }
}
