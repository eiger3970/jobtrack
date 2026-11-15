// 2026-11-15 owner: one sponsor line per country, under the JobTrack jobs table. Same line for every user:
// no tracking, no ad network, no data about the person decides it. Sold directly, CHF 50/month per country to start.
// Add a sold slot here, e.g. CH: { name: 'Sponsor name', text: 'What they offer in a few words', url: 'https://...' }
// No sponsor for a country = website shows "Your ad here", the app shows nothing.
export interface Sponsor { name: string; text: string; url: string }
export const SPONSORS: Record<string, Sponsor> = {}
