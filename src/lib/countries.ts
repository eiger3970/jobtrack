// 2026-10-15 owner: pick a country (never detected). CH has the full Job-Room flow,
// every other country gets the copy-per-field job search record.
export const COUNTRY_CODES = ['AL','AR','AT','AU','BE','BG','BR','CA','CH','CL','CN','CO','CZ','DE','DK','EE','ES','FI','FR','GB','GR','HK','HR','HU','ID','IE','IL','IN','IS','IT','JP','KR','LI','LT','LU','LV','MX','MY','NL','NO','NZ','PH','PL','PT','RO','RS','SE','SG','SI','SK','TH','TR','UA','US','VN','ZA']

export function countryName(code: string, lang: string): string {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code } catch { return code }
}

export function sortedCountries(lang: string): [string, string][] {
  return COUNTRY_CODES.map(c => [c, countryName(c, lang)] as [string, string]).sort((a, b) => a[1].localeCompare(b[1], lang))
}
