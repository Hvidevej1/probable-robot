// Laver en Pushover-besked om til en hændelse: titel, adresse, kategori og evt. koordinater.
// Bruges både af Edge Function "pushover" (på serveren) og af demo-tilstanden i browseren,
// så beskeder bliver læst ens begge steder.
//
// Tilpasset de kilder, der sender til Pushover i dag:
//   1-1-2 Århus          (ingen titel)  "ABA12 CI-M1 + CI  S1 Ny Munkegade 114 8000 Aarhus C Aarhus Kommune"
//   Mast                 "🔥 ABA12 CI-M1 + CI-S1"     / "Beredskab: Østjyllands Brandvæsen"
//   PF-Upload            "🔥 Bygn.brand-Lejlighed"    / "Beredskab: Østjyllands Brandvæsen"
//   Trafik Server        "Kø"                         / "E45 fra Randers mod Randers mellem <44> ..."
//   Google Maps Scanner  "📍 Østjyske Motorvej"       / "🏙️ 7100 Vejle"
// Samme alarm kommer ofte fra flere kilder (fx 1-1-2 Århus og Mast). findMatch() herunder
// lægger dem sammen til én hændelse.

// Nøgleord -> kategori. Titlen tjekkes før beskeden, og første match vinder.
const KATEGORIER = [
  ['Brand', /🔥|\bABA\d*|bygn\.?\s?brand|brand(?!væsen)|\bild\b|røg|eksplosion|brænd|skorsten/i],
  ['Trafik', /🚗|🚙|trafik|færdsel|uheld|ulykke|påkørsel|motorvej|frontal|lastbil|(?:^|[\s,.])kø(?=$|[\s,.])|\bE\d{2}\b|spærret|vejarbejde/i],
  ['Politi', /🚓|politi|anholdt|skud|skyd|knivstik|røveri|indbrud|vold|drab|bevæbnet|aktion/i],
  ['Redning', /🚑|redning|drukn|eftersøg|savnet|person i vand|helikopter|ambulance|fastklemt/i],
  ['Miljø', /forurening|\bgas|kemikal|olie|udslip|lugt/i],
  ['Vejr', /storm|oversvøm|skybrud|stormflod|træ over/i],
];

// Kendte koder fra beredskabet, så fotograferne kan se, hvad det er
const KODER = [
  [/^ABA\d*/i, 'automatisk brandalarm'],
  [/^bygn\.?\s?brand/i, 'bygningsbrand'],
];

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const renEmoji = s => String(s || '').replace(EMOJI, '').replace(/[ \t]+/g, ' ').trim();

// Ligger koordinaterne inden for Danmark (inkl. Bornholm)?
const iDK = (lat, lon) => lat > 54.4 && lat < 57.9 && lon > 7.8 && lon < 15.3;

export function findKoordinater(...tekster) {
  const s = tekster.filter(Boolean).join(' ');
  const mønstre = [
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,                     // google.com/maps/@55.67,12.56
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,                 // google.com/maps/place/...!3d55.6!4d12.5
    /[?&](?:q|ll|query|destination|daddr|center)=(?:loc:)?(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /(-?\d{1,2}\.\d{3,})\s*[,;]\s*(-?\d{1,3}\.\d{3,})/,       // 55.6761, 12.5683
    /lat\w*\s*[:=]\s*(-?\d{1,2}\.\d+).{0,20}?lo?ng?\w*\s*[:=]\s*(-?\d{1,3}\.\d+)/i,
  ];
  for (const m of mønstre) {
    const r = s.match(m);
    if (r) {
      const lat = parseFloat(r[1]), lon = parseFloat(r[2]);
      if (iDK(lat, lon)) return { lat, lon };
    }
  }
  return null;
}

const VEJ = "[A-ZÆØÅ][A-Za-zÆØÅæøåéüö.'\\- ]{2,40}?";
const BY = '[A-ZÆØÅ][A-Za-zÆØÅæøå\\-]+(?:\\s(?!Kommune\\b)(?![A-Za-zÆØÅæøå]+\\sKommune\\b)(?:[A-ZÆØÅ][a-zæøå]+|[A-Z]{1,2}\\b))?';

// Giver { adresse, start } – start er hvor adressen begynder i teksten (bruges til at korte titlen af)
export function findAdresseMedPlads(tekst) {
  const s = renEmoji(tekst);
  // 1) En linje, der starter med "Adresse:" eller "Sted:"
  const label = s.match(/(?:^|\n)\s*(?:adresse|sted|lokation|location|address|position)\s*[:\-]\s*([^\n]+)/i);
  if (label) return { adresse: label[1].trim().replace(/[.;]+$/, ''), start: -1 };
  // 2) Vejnavn + nummer + postnummer + by: "Ny Munkegade 114 8000 Aarhus C"
  const fuld = s.match(new RegExp(`(${VEJ}\\s\\d{1,4}[A-Za-z]?(?:,?\\s*(?:st|kl|\\d{1,2})\\.\\s*(?:th|tv|mf|\\d{1,3})?\\.?)?)\\s*,?\\s*(\\d{4})\\s+(${BY})`));
  if (fuld) {
    let vej = fuld[1].trim();
    // Koder foran vejnavnet ("CI S1 Ny Munkegade", "Bygn.brand-Villa Skovvej") skæres fra
    const ord = vej.split(' ');
    let i = 0;
    for (let j = 0; j < ord.length - 1; j++) if ((/^[A-ZÆØÅ0-9+\-]+$/.test(ord[j]) && ord[j].length <= 5) || (/\./.test(ord[j]) && /-/.test(ord[j]))) i = j + 1;
    vej = ord.slice(i).join(' ');
    return { adresse: `${vej}, ${fuld[2]} ${fuld[3].trim()}`, start: s.indexOf(vej) };
  }
  // 3) Kun postnummer + by: "7100 Vejle". Står der en vej på linjen før (Google Maps Scanner), tages den med.
  const by = s.match(new RegExp(`\\b(\\d{4})\\s+(${BY})`));
  if (by && +by[1] >= 1000) {
    const før = s.slice(0, by.index).trim().split('\n').pop().trim();
    const vej = /^[A-ZÆØÅ][a-zæøå]+(?:\s[A-ZÆØÅa-zæøå]+){0,3}$/.test(før) && !/^beredskab/i.test(før) ? før : '';
    return { adresse: `${vej ? vej + ', ' : ''}${by[1]} ${by[2]}`, start: vej ? s.indexOf(vej) : by.index };
  }
  // 4) Motorvej: "E45 fra Randers mod ...", "E20 ved Middelfart"
  const vej = s.match(/\b((?:E|Rute\s?)\d{1,3}|Motorring\s\d)\b[^\n]{0,40}?\b(?:ved|nær|mellem|fra|syd for|nord for|øst for|vest for)\s+([A-ZÆØÅ][a-zæøå]+)/);
  if (vej) return { adresse: vej[2], start: -1 };
  return { adresse: '', start: -1 };
}
export const findAdresse = tekst => findAdresseMedPlads(tekst).adresse;

export function findKategori(...tekster) {
  for (const s of tekster) {
    if (!s) continue;
    for (const [navn, re] of KATEGORIER) if (re.test(s)) return navn;
  }
  return 'Andet';
}

// Hele beskeden -> felter til tabellen "haendelser".
export function parseBesked({ title, message, url, priority, app } = {}) {
  const rå = String(message || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, ' ');
  const tekst = rå.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  const rent = renEmoji(title);
  // Pushover sætter appens navn som titel, hvis afsenderen ikke giver en
  const harTitel = rent && rent.toLowerCase() !== String(app || '').toLowerCase();
  const fuld = `${harTitel ? rent + '\n' : ''}${tekst}`;
  const { adresse, start } = findAdresseMedPlads(fuld);

  let titel = harTitel ? rent : renEmoji(tekst.split('\n')[0]);
  // Står adressen i titlen ("ABA12 CI-M1 + CI S1 Ny Munkegade 114 ..."), skæres den fra
  if (!harTitel && start > 0) {
    const førAdresse = renEmoji(fuld).slice(0, start).trim();
    if (førAdresse.length >= 3) titel = førAdresse;
  }
  titel = titel.replace(/\s{2,}/g, ' ').slice(0, 90) || 'Ny hændelse';
  const kode = KODER.find(([re]) => re.test(titel));
  if (kode && !titel.toLowerCase().includes(kode[1])) titel += ` – ${kode[1]}`;

  const pos = findKoordinater(tekst, url, title);
  return {
    titel,
    tekst,
    adresse,
    kategori: findKategori(title, tekst.replace(/brandvæsen/gi, '')),
    prioritet: Number.isFinite(+priority) ? +priority : 0,
    url: url || null,
    app: app || null,
    lat: pos ? pos.lat : null,
    lon: pos ? pos.lon : null,
  };
}

// Samme alarm fra flere kilder? Giver den aktive hændelse, en ny besked hører til, eller null.
// Match, hvis den aktive er højst 45 min gammel og enten
//  - har samme kode/titel (fx "ABA12 CI-M1 + CI-S1" fra både 1-1-2 Århus og Mast) og ikke ligger
//    over 2 km fra hinanden, eller
//  - ligger under 300 m væk med samme kategori.
const nøgle = s => renEmoji(s).toLowerCase().replace(/ – .*$/, '').replace(/[^a-z0-9æøå]/g, '');
export function findMatch(ny, aktive, nu = Date.now()) {
  const n = nøgle(ny.titel);
  // Nyeste først, så en besked uden adresse havner hos den seneste alarm med samme titel
  for (const h of [...aktive].sort((x, y) => String(y.oprettet).localeCompare(String(x.oprettet)))) {
    if (!['ny', 'taget', 'ankommet'].includes(h.status)) continue;
    if (nu - new Date(h.oprettet).getTime() > 45 * 60e3) continue;
    const a = nøgle(h.titel);
    const kort = Math.min(a.length, n.length);
    const begge = ny.lat != null && h.lat != null;
    const afstand = begge ? Math.hypot((ny.lat - h.lat) * 111, (ny.lon - h.lon) * 111 * Math.cos(h.lat * Math.PI / 180)) : null;
    // Samme titel, men flere km fra hinanden = to forskellige alarmer
    if (kort >= 6 && (a.startsWith(n) || n.startsWith(a)) && !(afstand > 2)) return h;
    if (begge && ny.kategori === h.kategori && afstand < 0.3) return h;
  }
  return null;
}

// Felter, der skal opdateres på den eksisterende hændelse, når en ekstra besked kommer ind.
export function flet(h, ny, app) {
  const linje = `— ${app || 'Ekstra besked'}: ${[ny.titel, ny.tekst].filter(Boolean).join(' · ')}`;
  const felter = { tekst: [h.tekst, linje].filter(Boolean).join('\n') };
  if (!h.adresse && ny.adresse) felter.adresse = ny.adresse;
  if (h.lat == null && ny.lat != null) { felter.lat = ny.lat; felter.lon = ny.lon; }
  if ((!h.kategori || h.kategori === 'Andet') && ny.kategori !== 'Andet') felter.kategori = ny.kategori;
  if (!h.url && ny.url) felter.url = ny.url;
  return felter;
}

// Slår en adresse op og giver { lat, lon, navn } eller null. Bruger OpenStreetMap (Nominatim),
// som er gratis, men højst må kaldes ca. én gang i sekundet.
export async function geokod(adresse, { fetchFn = fetch, headers = {} } = {}) {
  if (!adresse) return null;
  const forsøg = [adresse];
  const pb = adresse.match(/\b\d{4}\s+[^,]+$/);       // "8000 Aarhus C" som reserve
  if (pb && pb[0] !== adresse) forsøg.push(pb[0]);
  for (const q of forsøg) {
    const u = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=dk&accept-language=da&q=' + encodeURIComponent(q);
    try {
      const r = await fetchFn(u, { headers });
      if (!r.ok) continue;
      const [hit] = await r.json();
      if (hit) return { lat: +hit.lat, lon: +hit.lon, navn: hit.display_name };
    } catch { /* prøv næste */ }
  }
  return null;
}
