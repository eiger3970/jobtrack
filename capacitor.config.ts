import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.kworld.jobtrack',
  appName: 'JobTrack',
  webDir: 'dist',
  ios: { contentInset: 'always' },
  plugins: { CapacitorHttp: { enabled: true } },   // 2026-11-09: native fetch, so calls to kworld.space (/api/...) are not blocked by CORS
}

export default config
