// Local, page-memory-only usability counts with an opt-out. Never accepts application records.
export const UX_COLUMNS = ['date', 'status', 'cover', 'cv', 'company', 'role', 'actions'] as const
export const UX_OPT_OUT_STORAGE = 'kworld_jobtrack_ux_opt_out'
export const UX_ACTIONS = ['page_open', 'application_add', 'application_edit', 'note_open', 'note_save', 'status_change', 'filter_change', 'sort_change', 'search_focus', 'report_export', 'copy_email', 'backup_export', 'top', 'view_toggle'] as const
export type UXColumn = typeof UX_COLUMNS[number]
export type UXAction = typeof UX_ACTIONS[number]
export type UXSort = 'newest' | 'oldest' | 'az' | 'za'
export interface UXReport {
  schema_version: 1
  consent_version: 'jobtrack-ux-v1'
  build_date: string
  layout: 'phone' | 'desktop'
  column_order: UXColumn[]
  sort: UXSort
  counts: Partial<Record<UXAction, number>>
}

export function createUXRecorder(initiallyEnabled = false) {
  let enabled = initiallyEnabled
  let counts: Partial<Record<UXAction, number>> = initiallyEnabled ? { page_open: 1 } : {}
  return {
    start() { enabled = true; counts = {} },
    stop() { enabled = false; counts = {} },
    clear() { counts = {} },
    mark(action: UXAction) {
      if (!enabled || !(UX_ACTIONS as readonly string[]).includes(action)) return
      counts[action] = Math.min(999, (counts[action] || 0) + 1)
    },
    snapshot(context: { build_date: string; layout: 'phone' | 'desktop'; column_order: string[]; sort: UXSort }): UXReport | null {
      if (!enabled) return null
      const order = context.column_order
      const validOrder = order.length === UX_COLUMNS.length && new Set(order).size === UX_COLUMNS.length && order.every(c => (UX_COLUMNS as readonly string[]).includes(c))
      const safeCounts: UXReport['counts'] = {}
      for (const action of UX_ACTIONS) {
        const count = counts[action]
        if (Number.isInteger(count) && count! > 0) safeCounts[action] = Math.min(999, count!)
      }
      return {
        schema_version: 1,
        consent_version: 'jobtrack-ux-v1',
        build_date: /^(?:\d{4}-\d{2}-\d{2}|development)$/.test(context.build_date) ? context.build_date : 'development',
        layout: context.layout === 'phone' ? 'phone' : 'desktop',
        column_order: validOrder ? [...order] as UXColumn[] : [...UX_COLUMNS],
        sort: (['newest', 'oldest', 'az', 'za'] as string[]).includes(context.sort) ? context.sort : 'newest',
        counts: safeCounts,
      }
    },
  }
}
