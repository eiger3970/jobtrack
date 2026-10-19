import type { Application } from './orp'

// Website copy: browsers can't schedule the ORP reminders - the JobTrack app does.
export async function planReminders(_apps: Application[]): Promise<void> {}
