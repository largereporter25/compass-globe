// Static reference tables used by the clue engine.
// Everything here is public-domain factual data (centroids, ISO codes, calling
// codes, registration-plate prefixes). No third-party service is involved.

export type Region = {
  key: string;      // stable id, e.g. "IN" or "IN-GJ"
  label: string;    // human label shown in the UI
  country: string;  // country name
  admin?: string;   // sub-national unit, when known
  lat: number;
  lon: number;
};

// Approximate geographic centroids. Used ONLY to place a marker for a region —
// never presented as a precise location of the footage.
export const REGIONS: Record<string, Region> = {
  AE: { key: "AE", label: "United Arab Emirates", country: "United Arab Emirates", lat: 23.42, lon: 53.85 },
  AF: { key: "AF", label: "Afghanistan", country: "Afghanistan", lat: 33.94, lon: 67.71 },
  AM: { key: "AM", label: "Armenia", country: "Armenia", lat: 40.07, lon: 45.04 },
  AR: { key: "AR", label: "Argentina", country: "Argentina", lat: -38.42, lon: -63.62 },
  AU: { key: "AU", label: "Australia", country: "Australia", lat: -25.27, lon: 133.78 },
  BD: { key: "BD", label: "Bangladesh", country: "Bangladesh", lat: 23.68, lon: 90.36 },
  BE: { key: "BE", label: "Belgium", country: "Belgium", lat: 50.5, lon: 4.47 },
  BG: { key: "BG", label: "Bulgaria", country: "Bulgaria", lat: 42.73, lon: 25.49 },
  BR: { key: "BR", label: "Brazil", country: "Brazil", lat: -14.24, lon: -51.93 },
  BY: { key: "BY", label: "Belarus", country: "Belarus", lat: 53.71, lon: 27.95 },
  CA: { key: "CA", label: "Canada", country: "Canada", lat: 56.13, lon: -106.35 },
  CH: { key: "CH", label: "Switzerland", country: "Switzerland", lat: 46.82, lon: 8.23 },
  CN: { key: "CN", label: "China", country: "China", lat: 35.86, lon: 104.2 },
  CO: { key: "CO", label: "Colombia", country: "Colombia", lat: 4.57, lon: -74.3 },
  CZ: { key: "CZ", label: "Czechia", country: "Czechia", lat: 49.82, lon: 15.47 },
  DE: { key: "DE", label: "Germany", country: "Germany", lat: 51.17, lon: 10.45 },
  DK: { key: "DK", label: "Denmark", country: "Denmark", lat: 56.26, lon: 9.5 },
  EG: { key: "EG", label: "Egypt", country: "Egypt", lat: 26.82, lon: 30.8 },
  ES: { key: "ES", label: "Spain", country: "Spain", lat: 40.46, lon: -3.75 },
  ET: { key: "ET", label: "Ethiopia", country: "Ethiopia", lat: 9.15, lon: 40.49 },
  FR: { key: "FR", label: "France", country: "France", lat: 46.23, lon: 2.21 },
  GB: { key: "GB", label: "United Kingdom", country: "United Kingdom", lat: 55.38, lon: -3.44 },
  GE: { key: "GE", label: "Georgia", country: "Georgia", lat: 42.32, lon: 43.36 },
  GR: { key: "GR", label: "Greece", country: "Greece", lat: 39.07, lon: 21.82 },
  ID: { key: "ID", label: "Indonesia", country: "Indonesia", lat: -0.79, lon: 113.92 },
  IL: { key: "IL", label: "Israel", country: "Israel", lat: 31.05, lon: 34.85 },
  IN: { key: "IN", label: "India", country: "India", lat: 22.35, lon: 78.67 },
  IQ: { key: "IQ", label: "Iraq", country: "Iraq", lat: 33.22, lon: 43.68 },
  IR: { key: "IR", label: "Iran", country: "Iran", lat: 32.43, lon: 53.69 },
  IT: { key: "IT", label: "Italy", country: "Italy", lat: 41.87, lon: 12.57 },
  JP: { key: "JP", label: "Japan", country: "Japan", lat: 36.2, lon: 138.25 },
  KE: { key: "KE", label: "Kenya", country: "Kenya", lat: -0.02, lon: 37.91 },
  KH: { key: "KH", label: "Cambodia", country: "Cambodia", lat: 12.57, lon: 104.99 },
  KR: { key: "KR", label: "South Korea", country: "South Korea", lat: 35.91, lon: 127.77 },
  KZ: { key: "KZ", label: "Kazakhstan", country: "Kazakhstan", lat: 48.02, lon: 66.92 },
  LK: { key: "LK", label: "Sri Lanka", country: "Sri Lanka", lat: 7.87, lon: 80.77 },
  MA: { key: "MA", label: "Morocco", country: "Morocco", lat: 31.79, lon: -7.09 },
  MM: { key: "MM", label: "Myanmar", country: "Myanmar", lat: 21.91, lon: 95.96 },
  MX: { key: "MX", label: "Mexico", country: "Mexico", lat: 23.63, lon: -102.55 },
  MY: { key: "MY", label: "Malaysia", country: "Malaysia", lat: 4.21, lon: 101.98 },
  NG: { key: "NG", label: "Nigeria", country: "Nigeria", lat: 9.08, lon: 8.68 },
  NL: { key: "NL", label: "Netherlands", country: "Netherlands", lat: 52.13, lon: 5.29 },
  NP: { key: "NP", label: "Nepal", country: "Nepal", lat: 28.39, lon: 84.12 },
  PH: { key: "PH", label: "Philippines", country: "Philippines", lat: 12.88, lon: 121.77 },
  PK: { key: "PK", label: "Pakistan", country: "Pakistan", lat: 30.38, lon: 69.35 },
  PL: { key: "PL", label: "Poland", country: "Poland", lat: 51.92, lon: 19.15 },
  PS: { key: "PS", label: "Palestinian Territories", country: "Palestinian Territories", lat: 31.95, lon: 35.23 },
  PT: { key: "PT", label: "Portugal", country: "Portugal", lat: 39.4, lon: -8.22 },
  RO: { key: "RO", label: "Romania", country: "Romania", lat: 45.94, lon: 24.97 },
  RS: { key: "RS", label: "Serbia", country: "Serbia", lat: 44.02, lon: 21.01 },
  RU: { key: "RU", label: "Russia", country: "Russia", lat: 61.52, lon: 105.32 },
  SA: { key: "SA", label: "Saudi Arabia", country: "Saudi Arabia", lat: 23.89, lon: 45.08 },
  SE: { key: "SE", label: "Sweden", country: "Sweden", lat: 60.13, lon: 18.64 },
  SY: { key: "SY", label: "Syria", country: "Syria", lat: 34.8, lon: 38.997 },
  TH: { key: "TH", label: "Thailand", country: "Thailand", lat: 15.87, lon: 100.99 },
  TR: { key: "TR", label: "Türkiye", country: "Türkiye", lat: 38.96, lon: 35.24 },
  TW: { key: "TW", label: "Taiwan", country: "Taiwan", lat: 23.7, lon: 120.96 },
  UA: { key: "UA", label: "Ukraine", country: "Ukraine", lat: 48.38, lon: 31.17 },
  US: { key: "US", label: "United States", country: "United States", lat: 37.09, lon: -95.71 },
  VN: { key: "VN", label: "Vietnam", country: "Vietnam", lat: 14.06, lon: 108.28 },
  ZA: { key: "ZA", label: "South Africa", country: "South Africa", lat: -30.56, lon: 22.94 },
};

// Indian vehicle-registration state codes -> state centroid.
// India uses a strict "SS NN X NNNN" format where SS identifies the state/UT,
// which makes a legible plate one of the most precise text clues available.
export const IN_STATES: Record<string, Region> = {
  AP: { key: "IN-AP", label: "Andhra Pradesh, India", country: "India", admin: "Andhra Pradesh", lat: 15.91, lon: 79.74 },
  AR: { key: "IN-AR", label: "Arunachal Pradesh, India", country: "India", admin: "Arunachal Pradesh", lat: 28.22, lon: 94.73 },
  AS: { key: "IN-AS", label: "Assam, India", country: "India", admin: "Assam", lat: 26.2, lon: 92.94 },
  BR: { key: "IN-BR", label: "Bihar, India", country: "India", admin: "Bihar", lat: 25.1, lon: 85.31 },
  CG: { key: "IN-CG", label: "Chhattisgarh, India", country: "India", admin: "Chhattisgarh", lat: 21.28, lon: 81.87 },
  DL: { key: "IN-DL", label: "Delhi, India", country: "India", admin: "Delhi", lat: 28.61, lon: 77.21 },
  GA: { key: "IN-GA", label: "Goa, India", country: "India", admin: "Goa", lat: 15.3, lon: 74.12 },
  GJ: { key: "IN-GJ", label: "Gujarat, India", country: "India", admin: "Gujarat", lat: 22.26, lon: 71.19 },
  HP: { key: "IN-HP", label: "Himachal Pradesh, India", country: "India", admin: "Himachal Pradesh", lat: 31.1, lon: 77.17 },
  HR: { key: "IN-HR", label: "Haryana, India", country: "India", admin: "Haryana", lat: 29.06, lon: 76.09 },
  JH: { key: "IN-JH", label: "Jharkhand, India", country: "India", admin: "Jharkhand", lat: 23.61, lon: 85.28 },
  JK: { key: "IN-JK", label: "Jammu & Kashmir, India", country: "India", admin: "Jammu & Kashmir", lat: 33.78, lon: 76.58 },
  KA: { key: "IN-KA", label: "Karnataka, India", country: "India", admin: "Karnataka", lat: 15.32, lon: 75.71 },
  KL: { key: "IN-KL", label: "Kerala, India", country: "India", admin: "Kerala", lat: 10.85, lon: 76.27 },
  MH: { key: "IN-MH", label: "Maharashtra, India", country: "India", admin: "Maharashtra", lat: 19.75, lon: 75.71 },
  ML: { key: "IN-ML", label: "Meghalaya, India", country: "India", admin: "Meghalaya", lat: 25.47, lon: 91.37 },
  MN: { key: "IN-MN", label: "Manipur, India", country: "India", admin: "Manipur", lat: 24.66, lon: 93.91 },
  MP: { key: "IN-MP", label: "Madhya Pradesh, India", country: "India", admin: "Madhya Pradesh", lat: 22.97, lon: 78.66 },
  MZ: { key: "IN-MZ", label: "Mizoram, India", country: "India", admin: "Mizoram", lat: 23.16, lon: 92.94 },
  NL: { key: "IN-NL", label: "Nagaland, India", country: "India", admin: "Nagaland", lat: 26.16, lon: 94.56 },
  OD: { key: "IN-OD", label: "Odisha, India", country: "India", admin: "Odisha", lat: 20.95, lon: 85.1 },
  PB: { key: "IN-PB", label: "Punjab, India", country: "India", admin: "Punjab", lat: 31.15, lon: 75.34 },
  RJ: { key: "IN-RJ", label: "Rajasthan, India", country: "India", admin: "Rajasthan", lat: 27.02, lon: 74.22 },
  SK: { key: "IN-SK", label: "Sikkim, India", country: "India", admin: "Sikkim", lat: 27.53, lon: 88.51 },
  TN: { key: "IN-TN", label: "Tamil Nadu, India", country: "India", admin: "Tamil Nadu", lat: 11.13, lon: 78.66 },
  TR: { key: "IN-TR", label: "Tripura, India", country: "India", admin: "Tripura", lat: 23.94, lon: 91.99 },
  TS: { key: "IN-TS", label: "Telangana, India", country: "India", admin: "Telangana", lat: 18.11, lon: 79.02 },
  UK: { key: "IN-UK", label: "Uttarakhand, India", country: "India", admin: "Uttarakhand", lat: 30.07, lon: 79.02 },
  UP: { key: "IN-UP", label: "Uttar Pradesh, India", country: "India", admin: "Uttar Pradesh", lat: 26.85, lon: 80.95 },
  WB: { key: "IN-WB", label: "West Bengal, India", country: "India", admin: "West Bengal", lat: 22.99, lon: 87.86 },
};

// Unicode script blocks -> plausible countries, with a prior weight.
// Weights encode how *discriminating* the script is: Gujarati script narrows
// to one Indian state; Latin script narrows to almost nothing.
export const SCRIPT_PRIORS: {
  name: string;
  test: RegExp;
  candidates: { key: string; w: number }[];
  note: string;
}[] = [
  { name: "Devanagari", test: /[\u0900-\u097F]/, note: "Devanagari script (Hindi, Marathi, Nepali)", candidates: [{ key: "IN", w: 0.62 }, { key: "NP", w: 0.24 }] },
  { name: "Gujarati", test: /[\u0A80-\u0AFF]/, note: "Gujarati script — effectively state-specific", candidates: [{ key: "IN-GJ", w: 0.82 }] },
  { name: "Gurmukhi", test: /[\u0A00-\u0A7F]/, note: "Gurmukhi script (Punjabi)", candidates: [{ key: "IN-PB", w: 0.62 }, { key: "PK", w: 0.12 }] },
  { name: "Bengali", test: /[\u0980-\u09FF]/, note: "Bengali/Assamese script", candidates: [{ key: "BD", w: 0.44 }, { key: "IN-WB", w: 0.4 }] },
  { name: "Tamil", test: /[\u0B80-\u0BFF]/, note: "Tamil script", candidates: [{ key: "IN-TN", w: 0.6 }, { key: "LK", w: 0.22 }] },
  { name: "Telugu", test: /[\u0C00-\u0C7F]/, note: "Telugu script", candidates: [{ key: "IN-TS", w: 0.42 }, { key: "IN-AP", w: 0.42 }] },
  { name: "Kannada", test: /[\u0C80-\u0CFF]/, note: "Kannada script", candidates: [{ key: "IN-KA", w: 0.78 }] },
  { name: "Malayalam", test: /[\u0D00-\u0D7F]/, note: "Malayalam script", candidates: [{ key: "IN-KL", w: 0.8 }] },
  { name: "Odia", test: /[\u0B00-\u0B7F]/, note: "Odia script", candidates: [{ key: "IN-OD", w: 0.78 }] },
  { name: "Sinhala", test: /[\u0D80-\u0DFF]/, note: "Sinhala script", candidates: [{ key: "LK", w: 0.85 }] },
  { name: "Thai", test: /[\u0E00-\u0E7F]/, note: "Thai script", candidates: [{ key: "TH", w: 0.86 }] },
  { name: "Lao", test: /[\u0E80-\u0EFF]/, note: "Lao script", candidates: [{ key: "TH", w: 0.1 }] },
  { name: "Khmer", test: /[\u1780-\u17FF]/, note: "Khmer script", candidates: [{ key: "KH", w: 0.86 }] },
  { name: "Myanmar", test: /[\u1000-\u109F]/, note: "Burmese script", candidates: [{ key: "MM", w: 0.86 }] },
  { name: "Cyrillic", test: /[\u0400-\u04FF]/, note: "Cyrillic script", candidates: [{ key: "RU", w: 0.3 }, { key: "UA", w: 0.18 }, { key: "BY", w: 0.08 }, { key: "RS", w: 0.06 }, { key: "BG", w: 0.06 }, { key: "KZ", w: 0.06 }] },
  { name: "Greek", test: /[\u0370-\u03FF]/, note: "Greek script", candidates: [{ key: "GR", w: 0.8 }] },
  { name: "Hebrew", test: /[\u0590-\u05FF]/, note: "Hebrew script", candidates: [{ key: "IL", w: 0.82 }] },
  { name: "Arabic", test: /[\u0600-\u06FF\u0750-\u077F]/, note: "Arabic script", candidates: [{ key: "EG", w: 0.12 }, { key: "SA", w: 0.12 }, { key: "IR", w: 0.12 }, { key: "IQ", w: 0.1 }, { key: "PK", w: 0.1 }, { key: "AE", w: 0.08 }, { key: "SY", w: 0.08 }, { key: "MA", w: 0.08 }, { key: "PS", w: 0.06 }, { key: "AF", w: 0.06 }] },
  { name: "Hangul", test: /[\uAC00-\uD7AF\u1100-\u11FF]/, note: "Hangul script", candidates: [{ key: "KR", w: 0.88 }] },
  { name: "Kana", test: /[\u3040-\u30FF]/, note: "Japanese kana", candidates: [{ key: "JP", w: 0.9 }] },
  { name: "Han", test: /[\u4E00-\u9FFF]/, note: "Han characters (also used in Japanese)", candidates: [{ key: "CN", w: 0.4 }, { key: "TW", w: 0.14 }, { key: "JP", w: 0.12 }] },
  { name: "Ethiopic", test: /[\u1200-\u137F]/, note: "Ge'ez / Ethiopic script", candidates: [{ key: "ET", w: 0.85 }] },
  { name: "Armenian", test: /[\u0530-\u058F]/, note: "Armenian script", candidates: [{ key: "AM", w: 0.88 }] },
  { name: "Georgian", test: /[\u10A0-\u10FF]/, note: "Georgian script", candidates: [{ key: "GE", w: 0.88 }] },
];

export const CALLING_CODES: Record<string, string> = {
  "91": "IN", "92": "PK", "880": "BD", "977": "NP", "94": "LK", "95": "MM",
  "66": "TH", "84": "VN", "855": "KH", "60": "MY", "62": "ID", "63": "PH",
  "81": "JP", "82": "KR", "86": "CN", "886": "TW", "7": "RU", "380": "UA",
  "375": "BY", "44": "GB", "33": "FR", "49": "DE", "39": "IT", "34": "ES",
  "351": "PT", "31": "NL", "32": "BE", "41": "CH", "48": "PL", "40": "RO",
  "381": "RS", "359": "BG", "30": "GR", "90": "TR", "972": "IL", "970": "PS",
  "20": "EG", "212": "MA", "966": "SA", "971": "AE", "964": "IQ", "98": "IR",
  "963": "SY", "93": "AF", "234": "NG", "254": "KE", "251": "ET", "27": "ZA",
  "1": "US", "52": "MX", "55": "BR", "54": "AR", "57": "CO", "61": "AU",
};

export const CCTLDS: Record<string, string> = {
  in: "IN", pk: "PK", bd: "BD", np: "NP", lk: "LK", th: "TH", vn: "VN",
  my: "MY", id: "ID", ph: "PH", jp: "JP", kr: "KR", cn: "CN", tw: "TW",
  ru: "RU", ua: "UA", by: "BY", uk: "GB", fr: "FR", de: "DE", it: "IT",
  es: "ES", pt: "PT", nl: "NL", be: "BE", ch: "CH", pl: "PL", ro: "RO",
  rs: "RS", bg: "BG", gr: "GR", tr: "TR", il: "IL", ps: "PS", eg: "EG",
  ma: "MA", sa: "SA", ae: "AE", iq: "IQ", ir: "IR", sy: "SY", af: "AF",
  ng: "NG", ke: "KE", et: "ET", za: "ZA", mx: "MX", br: "BR", ar: "AR",
  co: "CO", au: "AU", ca: "CA", se: "SE", dk: "DK", cz: "CZ", kz: "KZ",
};

export const CURRENCY_SIGNS: { sign: string; key: string; label: string }[] = [
  { sign: "₹", key: "IN", label: "Indian rupee sign" },
  { sign: "৳", key: "BD", label: "Bangladeshi taka sign" },
  { sign: "฿", key: "TH", label: "Thai baht sign" },
  { sign: "₩", key: "KR", label: "South Korean won sign" },
  { sign: "₪", key: "IL", label: "Israeli new shekel sign" },
  { sign: "₦", key: "NG", label: "Nigerian naira sign" },
  { sign: "₴", key: "UA", label: "Ukrainian hryvnia sign" },
  { sign: "₽", key: "RU", label: "Russian ruble sign" },
  { sign: "₺", key: "TR", label: "Turkish lira sign" },
  { sign: "₫", key: "VN", label: "Vietnamese dong sign" },
  { sign: "₱", key: "PH", label: "Philippine peso sign" },
  { sign: "₨", key: "PK", label: "Rupee sign (Pakistan, Sri Lanka, Nepal)" },
];

export function resolveRegion(key: string): Region | null {
  if (REGIONS[key]) return REGIONS[key];
  if (key.startsWith("IN-")) {
    const st = IN_STATES[key.slice(3)];
    if (st) return st;
  }
  return null;
}
