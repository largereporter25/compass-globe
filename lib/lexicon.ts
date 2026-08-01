// Place-word lexicon.
//
// The single biggest blind spot in a Latin-script OCR pipeline is footage that
// is written in the Latin alphabet but is not English. "Sansad Marg",
// "Karol Bagh", "Jalan Sudirman", "Prospekt Peremohy" all read as plain Latin
// text, so the script detector says nothing — yet the words themselves are
// decisive.
//
// These matchers are gazetteer-free, which is the important property: they can
// anchor a country without ever asking OpenStreetMap, so they are immune to the
// mapping-density bias that drags results towards Western Europe. A single
// "Marg" or "Chowk" on a signboard is worth more than a dozen ambiguous
// toponym lookups.
//
// Contributions are just rows in this table.

export type LexiconEntry = {
  /** Matched case-insensitively as a whole word. */
  words: string[];
  note: string;
  candidates: { key: string; w: number }[];
};

export const PLACE_LEXICON: LexiconEntry[] = [
  // ── South Asia ───────────────────────────────────────────────────────────
  {
    words: ["marg", "chowk", "nagar", "vihar", "puram", "pura", "bagh", "gali", "sarai", "ganj", "kunj", "dham", "wadi", "peth", "pally", "halli", "petta"],
    note: "Indian street and neighbourhood suffix",
    candidates: [{ key: "IN", w: 0.42 }],
  },
  {
    words: ["thana", "chowki", "tehsil", "taluka", "mandal", "panchayat", "zila", "sarkar", "nigam", "parishad", "samiti", "vidhan", "sabha"],
    note: "Indian administrative vocabulary",
    candidates: [{ key: "IN", w: 0.4 }],
  },
  {
    words: ["mandir", "gurudwara", "gurdwara", "masjid", "dargah", "ashram", "haveli", "chhatri", "ghat", "mela"],
    note: "South Asian religious or civic structure",
    candidates: [{ key: "IN", w: 0.28 }, { key: "PK", w: 0.08 }, { key: "NP", w: 0.06 }, { key: "BD", w: 0.05 }],
  },
  {
    words: ["rupees", "paise", "lakh", "crore"],
    note: "Indian numbering and currency vocabulary",
    candidates: [{ key: "IN", w: 0.3 }],
  },
  {
    words: ["aadhaar", "gst", "pan card", "rto", "bsnl", "ration"],
    note: "Indian government scheme or utility branding",
    candidates: [{ key: "IN", w: 0.38 }],
  },
  { words: ["shahrah", "gulberg", "cantt", "mohalla", "katchi"], note: "Pakistani street vocabulary", candidates: [{ key: "PK", w: 0.4 }] },
  { words: ["sarak", "para", "bazar", "upazila"], note: "Bangladeshi street vocabulary", candidates: [{ key: "BD", w: 0.3 }, { key: "IN", w: 0.08 }] },
  { words: ["tole", "marga", "chowk-nepal"], note: "Nepali street vocabulary", candidates: [{ key: "NP", w: 0.3 }] },
  { words: ["mawatha", "para-lk"], note: "Sri Lankan street vocabulary", candidates: [{ key: "LK", w: 0.4 }] },

  // ── Europe ───────────────────────────────────────────────────────────────
  { words: ["strasse", "straße", "platz", "gasse", "weg", "allee", "bahnhof", "rathaus", "innenstadt"], note: "German street vocabulary", candidates: [{ key: "DE", w: 0.34 }, { key: "CH", w: 0.06 }] },
  { words: ["rue", "boulevard", "avenue-fr", "quai", "impasse", "mairie", "arrondissement"], note: "French street vocabulary", candidates: [{ key: "FR", w: 0.32 }, { key: "BE", w: 0.06 }] },
  { words: ["calle", "avenida", "plaza", "paseo", "carrera", "colonia", "barrio", "ayuntamiento"], note: "Spanish street vocabulary", candidates: [{ key: "ES", w: 0.12 }, { key: "MX", w: 0.12 }, { key: "CO", w: 0.08 }, { key: "AR", w: 0.08 }] },
  { words: ["rua", "avenida-pt", "praca", "praça", "largo", "bairro", "prefeitura"], note: "Portuguese street vocabulary", candidates: [{ key: "BR", w: 0.22 }, { key: "PT", w: 0.1 }] },
  { words: ["via", "piazza", "corso", "viale", "comune", "stazione"], note: "Italian street vocabulary", candidates: [{ key: "IT", w: 0.34 }] },
  { words: ["straat", "gracht", "plein", "laan", "gemeente"], note: "Dutch street vocabulary", candidates: [{ key: "NL", w: 0.34 }, { key: "BE", w: 0.08 }] },
  { words: ["ulica", "plac", "aleja", "osiedle", "dworzec"], note: "Polish street vocabulary", candidates: [{ key: "PL", w: 0.34 }] },
  { words: ["ulitsa", "prospekt", "ploshchad", "pereulok", "shosse"], note: "Russian street vocabulary in transliteration", candidates: [{ key: "RU", w: 0.2 }, { key: "UA", w: 0.1 }, { key: "BY", w: 0.06 }] },
  { words: ["vulytsya", "maidan", "prospekt-ua"], note: "Ukrainian street vocabulary in transliteration", candidates: [{ key: "UA", w: 0.3 }] },
  { words: ["sokak", "cadde", "caddesi", "mahalle", "meydan", "belediye"], note: "Turkish street vocabulary", candidates: [{ key: "TR", w: 0.4 }] },

  // ── Middle East, Africa, Asia-Pacific ────────────────────────────────────
  { words: ["shari", "sharia-st", "midan", "corniche", "souk", "wilaya"], note: "Arabic street vocabulary in transliteration", candidates: [{ key: "EG", w: 0.1 }, { key: "AE", w: 0.08 }, { key: "SA", w: 0.08 }, { key: "MA", w: 0.06 }] },
  { words: ["rehov", "kikar", "sderot"], note: "Hebrew street vocabulary in transliteration", candidates: [{ key: "IL", w: 0.4 }] },
  { words: ["jalan", "lorong", "kampung", "kelurahan", "kecamatan"], note: "Malay/Indonesian street vocabulary", candidates: [{ key: "ID", w: 0.24 }, { key: "MY", w: 0.16 }] },
  { words: ["thanon", "soi", "amphoe", "khwaeng"], note: "Thai street vocabulary in transliteration", candidates: [{ key: "TH", w: 0.4 }] },
  { words: ["duong", "phuong", "quan-vn"], note: "Vietnamese street vocabulary", candidates: [{ key: "VN", w: 0.36 }] },
  { words: ["barangay", "poblacion"], note: "Philippine administrative vocabulary", candidates: [{ key: "PH", w: 0.44 }] },
  { words: ["chome", "dori", "machi", "shi-jp", "ku-jp"], note: "Japanese address vocabulary in transliteration", candidates: [{ key: "JP", w: 0.34 }] },
  { words: ["matatu", "boda", "duka", "mtaa", "barabara"], note: "East African street vocabulary", candidates: [{ key: "KE", w: 0.34 }] },
  { words: ["danfo", "okada", "lga"], note: "Nigerian transport and administrative vocabulary", candidates: [{ key: "NG", w: 0.38 }] },
  { words: ["township", "kasi", "spaza"], note: "South African urban vocabulary", candidates: [{ key: "ZA", w: 0.26 }] },

  // ── North America ────────────────────────────────────────────────────────
  {
    words: ["sheriff", "precinct", "dmv", "zip code", "interstate", "county sheriff", "nypd", "lapd", "cpd"],
    note: "United States institutional vocabulary",
    candidates: [{ key: "US", w: 0.36 }],
  },
  { words: ["rcmp", "ontario", "quebec", "postal code"], note: "Canadian institutional vocabulary", candidates: [{ key: "CA", w: 0.3 }] },
];

/** Vehicle registration formats beyond India and the UK. */
export const PLATE_FORMATS: {
  name: string;
  re: RegExp;
  note: string;
  candidates: { key: string; w: number }[];
}[] = [
  {
    name: "Bangladesh",
    re: /\b(DHAKA|CHATTA|CHITTA|KHULNA|SYLHET|RAJSHAHI)[\s-]?(METRO)?[\s-]?[A-Z]{1,2}[\s-]?\d{2}[\s-]?\d{4}\b/g,
    note: "Matches the Bangladeshi plate layout, which names the issuing city in full",
    candidates: [{ key: "BD", w: 0.6 }],
  },
  {
    name: "Pakistan",
    re: /\b([A-Z]{2,3})[\s-]?\d{2,4}[\s-]?(ISB|LHR|KHI|PSH|QTA)\b/g,
    note: "Matches a Pakistani plate carrying a city suffix code",
    candidates: [{ key: "PK", w: 0.55 }],
  },
  {
    name: "Mercosur",
    re: /\b[A-Z]{3}[\s-]?\d[A-Z]\d{2}\b/g,
    note: "Matches the Mercosur plate layout used across Brazil and Argentina",
    candidates: [{ key: "BR", w: 0.3 }, { key: "AR", w: 0.16 }],
  },
  {
    name: "Netherlands",
    re: /\b\d{2}-[A-Z]{3}-\d\b|\b[A-Z]{2}-\d{3}-[A-Z]\b/g,
    note: "Matches the hyphenated Dutch plate layout",
    candidates: [{ key: "NL", w: 0.45 }],
  },
  {
    name: "Germany",
    re: /\b[A-Z]{1,3}[\s-][A-Z]{1,2}[\s-]?\d{1,4}\b(?=\s|$)/g,
    note: "Matches the German district-letter plate layout",
    candidates: [{ key: "DE", w: 0.22 }],
  },
  {
    name: "Türkiye",
    re: /\b(0[1-9]|[1-7]\d|8[01])[\s-][A-Z]{1,3}[\s-]?\d{2,4}\b/g,
    note: "Matches a Turkish plate, which opens with a two-digit province code",
    candidates: [{ key: "TR", w: 0.4 }],
  },
  {
    name: "UAE",
    re: /\b(DUBAI|ABU DHABI|SHARJAH)[\s-][A-Z]?[\s-]?\d{1,5}\b/g,
    note: "Matches an Emirati plate naming its emirate",
    candidates: [{ key: "AE", w: 0.55 }],
  },
];
