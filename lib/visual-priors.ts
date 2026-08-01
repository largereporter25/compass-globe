// Prompt banks for the CLIP vision pass.
//
// This is the part of the pipeline that works when there is no legible text at
// all — which is most viral footage. CLIP scores each keyframe against these
// natural-language descriptions and the winners become clues with the same
// audit trail as an OCR match.
//
// Two banks, doing different jobs:
//
//   LANDMARKS   distinctive built structures with real coordinates. A hit here
//               is the strongest clue the tool can produce, because it points
//               at a place rather than a region.
//
//   SCENE       ordinary streetscape signatures — vehicle types, utility
//               infrastructure, road markings, architecture, vegetation. No
//               single one is conclusive, but they are *gazetteer-free*, so
//               they can anchor a country the way a plate or dialling code
//               does, which is exactly what footage without signage needs.
//
// Contributions welcome and easy: both banks are plain data. If you know what
// the street furniture looks like where you work, that is a useful PR.

export type LandmarkPrior = {
  prompt: string;
  label: string;
  lat: number;
  lon: number;
  countryCode: string;
};

export type ScenePrior = {
  prompt: string;
  note: string;
  candidates: { key: string; w: number }[];
};

// CLIP compares an image against every prompt and picks relative winners, so a
// negative bank is needed: without unremarkable options to lose to, some
// landmark always "wins" a frame of a blank wall.
export const NEGATIVE_PROMPTS: string[] = [
  "a blurry out-of-focus photograph",
  "a close-up of a person's face",
  "an indoor room with plain walls",
  "a black screen or blank frame",
  "a computer screenshot or graphic overlay",
  "a close-up of hands or clothing",
  "a plain sky with no ground visible",
  "a generic modern office interior",
  "a television news studio",
  "text on a plain background",
];

export const LANDMARKS: LandmarkPrior[] = [
  // ── India ────────────────────────────────────────────────────────────────
  { prompt: "the Jantar Mantar astronomical observatory in Delhi with large red masonry instruments", label: "Jantar Mantar, New Delhi", lat: 28.6271, lon: 77.2166, countryCode: "IN" },
  { prompt: "India Gate war memorial arch in New Delhi", label: "India Gate, New Delhi", lat: 28.6129, lon: 77.2295, countryCode: "IN" },
  { prompt: "the Red Fort in Delhi, long red sandstone fortress walls", label: "Red Fort, Delhi", lat: 28.6562, lon: 77.2410, countryCode: "IN" },
  { prompt: "Qutub Minar, a tall fluted red sandstone tower in Delhi", label: "Qutub Minar, Delhi", lat: 28.5245, lon: 77.1855, countryCode: "IN" },
  { prompt: "the Lotus Temple in Delhi, white petal-shaped concrete building", label: "Lotus Temple, Delhi", lat: 28.5535, lon: 77.2588, countryCode: "IN" },
  { prompt: "Rashtrapati Bhavan and the Rajpath ceremonial boulevard in New Delhi", label: "Rashtrapati Bhavan, New Delhi", lat: 28.6143, lon: 77.1994, countryCode: "IN" },
  { prompt: "Connaught Place in Delhi, white colonnaded circular colonial arcade", label: "Connaught Place, New Delhi", lat: 28.6315, lon: 77.2167, countryCode: "IN" },
  { prompt: "the Taj Mahal white marble mausoleum in Agra", label: "Taj Mahal, Agra", lat: 27.1751, lon: 78.0421, countryCode: "IN" },
  { prompt: "the Gateway of India arch on the Mumbai waterfront", label: "Gateway of India, Mumbai", lat: 18.9220, lon: 72.8347, countryCode: "IN" },
  { prompt: "Chhatrapati Shivaji Terminus railway station in Mumbai, Victorian Gothic", label: "Chhatrapati Shivaji Terminus, Mumbai", lat: 18.9398, lon: 72.8355, countryCode: "IN" },
  { prompt: "Marine Drive curving seafront promenade in Mumbai", label: "Marine Drive, Mumbai", lat: 18.9432, lon: 72.8231, countryCode: "IN" },
  { prompt: "the Charminar monument with four minarets in Hyderabad", label: "Charminar, Hyderabad", lat: 17.3616, lon: 78.4747, countryCode: "IN" },
  { prompt: "Hawa Mahal, the pink honeycomb palace facade in Jaipur", label: "Hawa Mahal, Jaipur", lat: 26.9239, lon: 75.8267, countryCode: "IN" },
  { prompt: "the Golden Temple, a gilded Sikh shrine on water in Amritsar", label: "Golden Temple, Amritsar", lat: 31.6200, lon: 74.8765, countryCode: "IN" },
  { prompt: "Howrah Bridge, a steel cantilever bridge in Kolkata", label: "Howrah Bridge, Kolkata", lat: 22.5851, lon: 88.3468, countryCode: "IN" },
  { prompt: "the Victoria Memorial white marble building in Kolkata", label: "Victoria Memorial, Kolkata", lat: 22.5448, lon: 88.3426, countryCode: "IN" },
  { prompt: "Sabarmati Ashram in Ahmedabad, low white Gandhian buildings", label: "Sabarmati Ashram, Ahmedabad", lat: 23.0608, lon: 72.5806, countryCode: "IN" },
  { prompt: "the Statue of Unity, a very tall bronze statue of a man in Gujarat", label: "Statue of Unity, Gujarat", lat: 21.8380, lon: 73.7191, countryCode: "IN" },
  { prompt: "Mysore Palace, an ornate Indo-Saracenic palace lit at night", label: "Mysore Palace, Karnataka", lat: 12.3052, lon: 76.6552, countryCode: "IN" },
  { prompt: "Meenakshi Amman Temple, a tall painted South Indian gopuram tower", label: "Meenakshi Temple, Madurai", lat: 9.9195, lon: 78.1193, countryCode: "IN" },
  { prompt: "the ghats of Varanasi with stone steps down to the Ganges river", label: "Varanasi Ghats", lat: 25.3062, lon: 83.0104, countryCode: "IN" },

  // ── South Asia ───────────────────────────────────────────────────────────
  { prompt: "Minar-e-Pakistan tower in Lahore", label: "Minar-e-Pakistan, Lahore", lat: 31.5925, lon: 74.3095, countryCode: "PK" },
  { prompt: "Faisal Mosque in Islamabad, angular white tent-shaped mosque", label: "Faisal Mosque, Islamabad", lat: 33.7295, lon: 73.0372, countryCode: "PK" },
  { prompt: "Boudhanath Stupa in Kathmandu, white dome with painted eyes", label: "Boudhanath, Kathmandu", lat: 27.7215, lon: 85.3620, countryCode: "NP" },
  { prompt: "Shaheed Minar monument in Dhaka", label: "Shaheed Minar, Dhaka", lat: 23.7276, lon: 90.3969, countryCode: "BD" },

  // ── United States ────────────────────────────────────────────────────────
  { prompt: "Cloud Gate, the mirrored bean sculpture in Chicago Millennium Park", label: "Cloud Gate, Chicago", lat: 41.8827, lon: -87.6233, countryCode: "US" },
  { prompt: "the Chicago elevated L train running on steel tracks above a downtown street", label: "Chicago Loop elevated railway", lat: 41.8807, lon: -87.6278, countryCode: "US" },
  { prompt: "the Chicago skyline with Willis Tower seen across the river", label: "Chicago Loop", lat: 41.8789, lon: -87.6359, countryCode: "US" },
  { prompt: "Times Square in New York with huge illuminated advertising screens", label: "Times Square, New York", lat: 40.7580, lon: -73.9855, countryCode: "US" },
  { prompt: "the Brooklyn Bridge stone towers and cables in New York", label: "Brooklyn Bridge, New York", lat: 40.7061, lon: -73.9969, countryCode: "US" },
  { prompt: "the United States Capitol building with its white dome in Washington DC", label: "US Capitol, Washington DC", lat: 38.8899, lon: -77.0091, countryCode: "US" },
  { prompt: "the Washington Monument obelisk on the National Mall", label: "Washington Monument, DC", lat: 38.8895, lon: -77.0353, countryCode: "US" },
  { prompt: "the Golden Gate Bridge, a red suspension bridge in fog", label: "Golden Gate Bridge, San Francisco", lat: 37.8199, lon: -122.4783, countryCode: "US" },
  { prompt: "the Hollywood sign on a dry brown hillside in Los Angeles", label: "Hollywood Sign, Los Angeles", lat: 34.1341, lon: -118.3215, countryCode: "US" },
  { prompt: "the Space Needle observation tower in Seattle", label: "Space Needle, Seattle", lat: 47.6205, lon: -122.3493, countryCode: "US" },

  // ── Europe ───────────────────────────────────────────────────────────────
  { prompt: "the Eiffel Tower iron lattice tower in Paris", label: "Eiffel Tower, Paris", lat: 48.8584, lon: 2.2945, countryCode: "FR" },
  { prompt: "the Arc de Triomphe in Paris", label: "Arc de Triomphe, Paris", lat: 48.8738, lon: 2.2950, countryCode: "FR" },
  { prompt: "the Palace of Westminster and Big Ben clock tower in London", label: "Westminster, London", lat: 51.5007, lon: -0.1246, countryCode: "GB" },
  { prompt: "Trafalgar Square in London with Nelson's Column and stone lions", label: "Trafalgar Square, London", lat: 51.5080, lon: -0.1281, countryCode: "GB" },
  { prompt: "Tower Bridge over the Thames in London", label: "Tower Bridge, London", lat: 51.5055, lon: -0.0754, countryCode: "GB" },
  { prompt: "the Brandenburg Gate neoclassical columns in Berlin", label: "Brandenburg Gate, Berlin", lat: 52.5163, lon: 13.3777, countryCode: "DE" },
  { prompt: "the Colosseum amphitheatre in Rome", label: "Colosseum, Rome", lat: 41.8902, lon: 12.4922, countryCode: "IT" },
  { prompt: "the Sagrada Familia basilica under construction in Barcelona", label: "Sagrada Família, Barcelona", lat: 41.4036, lon: 2.1744, countryCode: "ES" },
  { prompt: "Saint Basil's Cathedral with coloured onion domes in Moscow Red Square", label: "Red Square, Moscow", lat: 55.7539, lon: 37.6208, countryCode: "RU" },
  { prompt: "Maidan Nezalezhnosti independence square in Kyiv with a tall column", label: "Maidan Nezalezhnosti, Kyiv", lat: 50.4501, lon: 30.5241, countryCode: "UA" },
  { prompt: "the Acropolis and Parthenon on a rocky hill in Athens", label: "Acropolis, Athens", lat: 37.9715, lon: 23.7267, countryCode: "GR" },
  { prompt: "canal houses and bridges in Amsterdam", label: "Amsterdam canals", lat: 52.3702, lon: 4.8952, countryCode: "NL" },

  // ── Middle East, Africa, Asia-Pacific, Americas ──────────────────────────
  { prompt: "the Hagia Sophia domed mosque with minarets in Istanbul", label: "Hagia Sophia, Istanbul", lat: 41.0086, lon: 28.9802, countryCode: "TR" },
  { prompt: "Taksim Square in Istanbul with the Republic Monument", label: "Taksim Square, Istanbul", lat: 41.0370, lon: 28.9850, countryCode: "TR" },
  { prompt: "the Dome of the Rock golden dome in Jerusalem", label: "Dome of the Rock, Jerusalem", lat: 31.7781, lon: 35.2354, countryCode: "IL" },
  { prompt: "the Burj Khalifa supertall tower in Dubai", label: "Burj Khalifa, Dubai", lat: 25.1972, lon: 55.2744, countryCode: "AE" },
  { prompt: "the Pyramids of Giza in the Egyptian desert", label: "Giza Pyramids, Egypt", lat: 29.9792, lon: 31.1342, countryCode: "EG" },
  { prompt: "Tahrir Square in Cairo surrounded by dense city buildings", label: "Tahrir Square, Cairo", lat: 30.0444, lon: 31.2357, countryCode: "EG" },
  { prompt: "Table Mountain flat-topped mountain above Cape Town", label: "Table Mountain, Cape Town", lat: -33.9628, lon: 18.4098, countryCode: "ZA" },
  { prompt: "the Great Wall of China running along mountain ridges", label: "Great Wall, China", lat: 40.4319, lon: 116.5704, countryCode: "CN" },
  { prompt: "Tiananmen Gate with a portrait in Beijing", label: "Tiananmen, Beijing", lat: 39.9087, lon: 116.3975, countryCode: "CN" },
  { prompt: "Shibuya crossing in Tokyo with crowds and neon screens", label: "Shibuya, Tokyo", lat: 35.6595, lon: 139.7005, countryCode: "JP" },
  { prompt: "Mount Fuji snow-capped volcano in Japan", label: "Mount Fuji, Japan", lat: 35.3606, lon: 138.7274, countryCode: "JP" },
  { prompt: "Gwanghwamun Square in Seoul with a large statue and a palace gate", label: "Gwanghwamun, Seoul", lat: 37.5720, lon: 126.9769, countryCode: "KR" },
  { prompt: "the Grand Palace with golden Thai spires in Bangkok", label: "Grand Palace, Bangkok", lat: 13.7500, lon: 100.4914, countryCode: "TH" },
  { prompt: "Angkor Wat temple towers in Cambodia", label: "Angkor Wat, Cambodia", lat: 13.4125, lon: 103.8670, countryCode: "KH" },
  { prompt: "Merlion statue and Marina Bay Sands in Singapore", label: "Marina Bay, Singapore", lat: 1.2868, lon: 103.8545, countryCode: "MY" },
  { prompt: "the Sydney Opera House shell roofs on the harbour", label: "Sydney Opera House", lat: -33.8568, lon: 151.2153, countryCode: "AU" },
  { prompt: "Christ the Redeemer statue above Rio de Janeiro", label: "Christ the Redeemer, Rio", lat: -22.9519, lon: -43.2105, countryCode: "BR" },
  { prompt: "the Angel of Independence golden column on Paseo de la Reforma in Mexico City", label: "Ángel de la Independencia, Mexico City", lat: 19.4270, lon: -99.1677, countryCode: "MX" },
  { prompt: "Machu Picchu stone terraces on a green mountain in Peru", label: "Machu Picchu, Peru", lat: -13.1631, lon: -72.5450, countryCode: "US" },
];

export const SCENE_PRIORS: ScenePrior[] = [
  // ── South Asia streetscape signatures ────────────────────────────────────
  {
    prompt: "a busy Indian street with yellow and green auto-rickshaws and dense tangled overhead power cables",
    note: "Auto-rickshaws in green-and-yellow livery with heavy overhead cabling are a strong Indian urban signature",
    candidates: [{ key: "IN", w: 0.55 }, { key: "BD", w: 0.08 }, { key: "PK", w: 0.06 }],
  },
  {
    prompt: "an Indian city street with hand-painted shop signs, cycle rickshaws and small kirana shops",
    note: "Hand-painted shopfronts and cycle rickshaws typical of North Indian bazaars",
    candidates: [{ key: "IN", w: 0.45 }, { key: "BD", w: 0.1 }, { key: "NP", w: 0.06 }],
  },
  {
    prompt: "an Indian police officer in a khaki uniform with a khaki peaked cap",
    note: "Khaki policing uniform, standard across most Indian state forces",
    candidates: [{ key: "IN", w: 0.5 }, { key: "PK", w: 0.08 }],
  },
  {
    prompt: "Indian paramilitary personnel in olive fatigues behind metal crowd-control barricades on a wide road",
    note: "Olive-drab paramilitary deployment with tubular steel barricades, common at Indian protest sites",
    candidates: [{ key: "IN", w: 0.42 }],
  },
  {
    prompt: "a wide colonial-era boulevard in New Delhi with red sandstone government buildings and manicured lawns",
    note: "Lutyens' Delhi government quarter",
    candidates: [{ key: "IN-DL", w: 0.5 }, { key: "IN", w: 0.2 }],
  },
  {
    prompt: "a crowded protest in India with people holding banners in Devanagari script and white Gandhi caps",
    note: "Indian protest iconography",
    candidates: [{ key: "IN", w: 0.45 }],
  },
  {
    prompt: "a South Asian street with white Maruti Suzuki hatchbacks, Tata trucks and motorbikes without helmets",
    note: "Vehicle fleet composition specific to the Indian subcontinent",
    candidates: [{ key: "IN", w: 0.4 }, { key: "PK", w: 0.1 }, { key: "BD", w: 0.08 }],
  },
  {
    prompt: "a Pakistani street with elaborately decorated painted trucks and Urdu shop signage",
    note: "Truck art and Urdu signage",
    candidates: [{ key: "PK", w: 0.5 }],
  },
  {
    prompt: "a Bangladeshi street packed with green battery rickshaws and colourful buses",
    note: "Dhaka-style rickshaw density",
    candidates: [{ key: "BD", w: 0.45 }],
  },

  // ── North America ────────────────────────────────────────────────────────
  {
    prompt: "an American city street with yellow school buses, fire hydrants and traffic lights hanging on wires over the intersection",
    note: "Overhead span-wire signals and hydrants are a North American signature",
    candidates: [{ key: "US", w: 0.42 }, { key: "CA", w: 0.12 }],
  },
  {
    prompt: "United States police officers in dark blue uniforms next to black and white patrol cars",
    note: "US municipal policing livery",
    candidates: [{ key: "US", w: 0.45 }],
  },
  {
    prompt: "a protest march in an American downtown with people holding placards in English and a police line in riot gear",
    note: "US street-protest scene",
    candidates: [{ key: "US", w: 0.35 }, { key: "CA", w: 0.08 }],
  },
  {
    prompt: "a Chicago street beneath the elevated railway with steel girders casting shadows on the road",
    note: "Chicago's elevated Loop structure is visually unique in North America",
    candidates: [{ key: "US", w: 0.5 }],
  },
  {
    prompt: "a wide North American road with a yellow centre line, green highway signs and pickup trucks",
    note: "Yellow centre lines and green guide signage follow the US MUTCD standard",
    candidates: [{ key: "US", w: 0.35 }, { key: "CA", w: 0.14 }],
  },

  // ── Europe and elsewhere ─────────────────────────────────────────────────
  {
    prompt: "a European street with narrow pavements, white road markings, small hatchback cars and a tram line",
    note: "Continental European streetscape with tram infrastructure",
    candidates: [{ key: "DE", w: 0.12 }, { key: "FR", w: 0.1 }, { key: "PL", w: 0.08 }, { key: "CZ", w: 0.06 }, { key: "IT", w: 0.06 }],
  },
  {
    prompt: "a British street with red double-decker buses, black taxis and traffic driving on the left",
    note: "UK-specific vehicle fleet",
    candidates: [{ key: "GB", w: 0.5 }],
  },
  {
    prompt: "a Middle Eastern street with Arabic signage, white SUVs and low sand-coloured buildings",
    note: "Gulf and Levant urban signature",
    candidates: [{ key: "AE", w: 0.12 }, { key: "SA", w: 0.12 }, { key: "EG", w: 0.1 }, { key: "IQ", w: 0.08 }, { key: "SY", w: 0.06 }],
  },
  {
    prompt: "a Southeast Asian street with dense scooter traffic, plastic stools on the pavement and shophouses",
    note: "Scooter-dominant Southeast Asian streetscape",
    candidates: [{ key: "VN", w: 0.18 }, { key: "TH", w: 0.14 }, { key: "ID", w: 0.12 }, { key: "PH", w: 0.08 }],
  },
  {
    prompt: "an East African street with matatu minibuses, red earth at the roadside and single-storey shopfronts",
    note: "East African urban signature",
    candidates: [{ key: "KE", w: 0.3 }, { key: "ET", w: 0.1 }],
  },
  {
    prompt: "a Latin American street with colourful low-rise buildings, Spanish signage and yellow taxis",
    note: "Latin American urban signature",
    candidates: [{ key: "MX", w: 0.16 }, { key: "CO", w: 0.12 }, { key: "AR", w: 0.1 }],
  },
  {
    prompt: "an East Asian street with vertical shop signs in Chinese or Japanese characters and clean narrow roads",
    note: "East Asian urban signature",
    candidates: [{ key: "JP", w: 0.14 }, { key: "CN", w: 0.14 }, { key: "TW", w: 0.08 }, { key: "KR", w: 0.08 }],
  },

  // ── Environment. Recorded and displayed, never scored. ───────────────────
  { prompt: "an arid desert landscape with sand and sparse dry scrub", note: "Arid environment", candidates: [] },
  { prompt: "dense green tropical vegetation and palm trees", note: "Tropical vegetation", candidates: [] },
  { prompt: "snow-covered ground and bare winter trees", note: "Snow cover", candidates: [] },
  { prompt: "steep mountains or high hills in the background", note: "Mountainous terrain", candidates: [] },
  { prompt: "a coastline, harbour or large body of open water", note: "Coastal or waterfront", candidates: [] },
  { prompt: "heavy monsoon rain with wet roads and standing water", note: "Heavy rain, wet surfaces", candidates: [] },
  { prompt: "a night-time scene lit by streetlights", note: "Night-time capture", candidates: [] },
  { prompt: "a large crowd of people filling a street or square", note: "Large crowd present", candidates: [] },
];
