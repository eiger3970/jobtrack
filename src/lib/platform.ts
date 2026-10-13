import { Capacitor } from '@capacitor/core'

// App build: true. The website copy of this file returns false - the tracker
// pages are the same files in both places, only src/lib differs.
export const isApp = (): boolean => Capacitor.isNativePlatform()
