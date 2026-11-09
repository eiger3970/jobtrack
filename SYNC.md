# Syncing from the website

The tracker pages are the same files as kworld.space (Website_live_repo/src). Copy the website version over the app copy, EXCEPT these app-only files, which must never be overwritten:

- src/main.tsx (no router, native storage restore)
- src/lib/platform.ts (isApp() asks Capacitor)
- src/lib/durable.ts (mirror of kworld_ keys into native Preferences)
- src/lib/reminders.ts (native ORP reminders; website copy is an empty stub)
- src/lib/save_file.ts (iOS share sheet; website copy is a plain download)

App patch after copying: src/components/security_shield.tsx - replace react-router Link with a plain <a href="https://kworld.space/..."> (the app has no router).

History: the 2026-10-19 sync overwrote reminders.ts and save_file.ts with the website stubs (found 2026-11-09, restored from commit 1c09083). Check these two after every sync.

2026-11-09 app-only additions (keep): capacitor.config.ts has CapacitorHttp enabled (no CORS on kworld.space/api); src/main.tsx patches window.fetch so relative /api/ and /owner/ calls go to https://kworld.space. UNTESTED on a device. Website-relative media (/assets/jobtrack/*.mp4, /free/bookmarks_search.xpi) still do not exist inside the app.
