// Laver en Pushover-besked om til en hændelse: titel, adresse, kategori og evt. koordinater.
// Bruges både af Edge Function "pushover" (på serveren) og af demo-tilstanden i browseren,
// så beskeder bliver læst ens begge steder. Eksempler på alle formater står i parse.test.mjs.
//
// Kilderne i dag:
//  1-1-2 Århus   Ingen titel. "ABA12 CI-M1 + CI  S1 Ny Munkegade 114 8000 Aarhus C Aarhus Kommune"
//  Mast          Titel = station ("🚒 Aarhus C"). Linjer: "🔥 ABA12 CI-M1 + CI-S1", "Beredskab: …",
//                "Station: …", evt. "Adresse: Ny Munkegade 114, 8000 Aarhus C", dato.
//  PF-Upload     Som Mast ved brand. Ved trafik: titel "Trafikmelding", "🚙 Uheld", vejstrækning,
//                "Nordjyske Motorvej, 8380 Spørring, Aarhus Kommune" og link til 112meldinger.dk.
//  Trafik Server Titel "Trafikmelding", HTML: <b>Kø</b>, vejstrækning, beskrivelse, FeatureID,
//                link "Se på Google Maps".
//  Google Maps Scanner  "🚨 Muligt trafikuheld detekteret på Google Maps", "📍 Østjyske Motorvej", "🏙️ 7100 Vejle"
//
// Samme alarm kommer ofte fra flere kilder. findMatch() lægger dem sammen til én hændelse.

// Nøgleord -> kategori. Titel og første linjer tjekkes først, og første match vinder.
const KATEGORIER = [
  ['Brand', /🔥|🚒|\bABA\d*|bygn\.?\s?brand|brand(?!væsen)|\bild\b|røg|eksplosion|brænd|skorsten|sprøjte|tankvogn|\bass\.|\bassistance\b/i],
  ['Trafik', /🚗|🚙|🚘|trafik|færdsel|uheld|ulykke|påkørsel|motorvej|frontal|lastbil|(?:^|[\s,.])kø(?=$|[\s,.])|\bE\d{2}\b|spærret|vejarbejde|dyr på vejen/i],
  ['Politi', /🚓|politi(?! og redning)|anholdt|skud|skyd|knivstik|røveri|indbrud|vold|drab|bevæbnet|aktion/i],
  ['Redning', /🚁|🚑|lægehelikopter|akuthjælper|hjertestop|udkald til|redning|drukn|eftersøg|savnet|person i vand|helikopter|ambulance|fastklemt/i],
  ['Miljø', /forurening|\bgas\b|kemikal|olie|udslip|lugt/i],
  ['Vejr', /storm|oversvøm|skybrud|stormflod|træ over/i],
];

// Kendte koder fra beredskabet, så fotograferne kan se, hvad det er
const KODER = [
  [/^ABA\d*/i, 'automatisk brandalarm'],
  [/^bygn\.?\s?brand/i, 'bygningsbrand'],
  [/^ass\.?-?\s?A-sprøjte/i, 'assistance'],
];

// Beskeder, der aldrig skal blive til hændelser (flere kan sættes på kontoret under Pushover)
const IGNORER = /radioprøve|prøvealarm|testalarm/i;
// Lægehelikopter, der lander ved et hospital, er bare patienttransport
const HOSPITAL = /hospital|sygehus|\bAUH\b|\bOUH\b|rigshospitalet|helipad|akutmodtagelse/i;

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const renEmoji = s => String(s || '').replace(EMOJI, '').replace(/[ \t]+/g, ' ').trim();
const ENTITETER = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const afkod = s => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) =>
  ENTITETER[e.toLowerCase()] ?? (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : m));

// Ligger koordinaterne inden for Danmark (inkl. Bornholm)?
const iDK = (lat, lon) => lat > 54.4 && lat < 57.9 && lon > 7.8 && lon < 15.3;

export function findKoordinater(...tekster) {
  const s = tekster.filter(Boolean).join(' ');
  const mønstre = [
    [/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/, 0],                     // google.com/maps/@55.67,12.56
    [/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, 0],                 // google.com/maps/place/...!3d55.6!4d12.5
    [/[?&](?:q|ll|query|destination|daddr|center|sll)=(?:loc:)?(-?\d{1,2}\.\d+)(?:,|%2C)\s*\+?(-?\d{1,3}\.\d+)/i, 0],
    [/lonlat:(-?\d{1,3}\.\d+),(-?\d{1,2}\.\d+)/i, 1],              // 112meldinger.dk (lon før lat)
    [/"latitude"\s*:\s*(-?\d{1,2}\.\d+)[\s\S]{0,40}?"longitude"\s*:\s*(-?\d{1,3}\.\d+)/i, 0],
    [/\bLAT\s*=\s*(-?\d{1,2}\.\d+)[\s\S]{0,80}?\bLO?NG?\s*=\s*(-?\d{1,3}\.\d+)/, 0],
    [/(-?\d{1,2}\.\d{3,})\s*[,;]\s*(-?\d{1,3}\.\d{3,})/, 0],       // 55.6761, 12.5683
  ];
  for (const [m, omvendt] of mønstre) {
    const r = s.match(m);
    if (r) {
      const lat = parseFloat(r[omvendt ? 2 : 1]), lon = parseFloat(r[omvendt ? 1 : 2]);
      if (iDK(lat, lon)) return { lat, lon };
    }
  }
  return null;
}

// Links, serveren skal åbne for at finde koordinater (112meldinger.dk, korte Google-links)
export const skalSlåsOp = u => /112meldinger\.dk\/map|goo\.gl|maps\.app/i.test(u || '');

const VEJ = "[A-ZÆØÅ][A-Za-zÆØÅæøåéüö.'\\- ]{2,40}?";
const BY = '[A-ZÆØÅ][A-Za-zÆØÅæøå\\-]+(?:\\s(?!Kommune\\b)(?![A-Za-zÆØÅæøå]+\\sKommune\\b)(?:[A-ZÆØÅ][a-zæøå]+|[A-Z]{1,2}\\b))?';
const STEDNAVN = '[A-ZÆØÅ][a-zæøå]+(?:\\s(?:[A-ZÆØÅ][a-zæøå]+|[A-Z]{1,2}\\b))?';

// Giver { adresse, linje, start, cirka }: linje/start er hvor adressen står (bruges til at korte titlen af).
// cirka = true, når det kun er en by/station/vejstrækning og ikke en præcis adresse.
export function findAdresse(linjer, station) {
  const L = Array.isArray(linjer) ? linjer : String(linjer || '').split('\n');
  const ingen = { adresse: '', linje: -1, start: -1, cirka: false };
  // 1) "Adresse: …", "Sted: …", "Lokation: …" (også midt i en linje efter et punktum)
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/(?:^|[.!]\s+)(?:adresse|sted|lokation|location|address|position)\s*:\s*(.+)$/i);
    if (m) {
      const a = m[1].trim().replace(/[.;]+$/, '').replace(/\s+,/g, ',').replace(/,?\s*[A-ZÆØÅ][a-zæøå]+ Kommune$/, '')
        .replace(/([A-ZÆØÅ][\wæøåÆØÅ .\-]*?)\s*\((\d{4})\)$/, '$2 $1');
      return { adresse: a, linje: -1, start: -1, cirka: !/\d/.test(a) };
    }
  }
  // 2) Motorvej i beredskabets kortform: "MTV Ø 501 M61 166 8362 Hørning". MTV = motorvej,
  //    Ø/N/S = Østjyske/Nordjyske/Sønderjyske. Tallene (formentlig kilometer) kendes ikke sikkert,
  //    så placeringen bliver cirka ved postnummeret.
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(new RegExp(`\\bMTV\\s+(Ø|N|S|V|E\\d{1,3})(?=\\s)[^\\n]*?\\b(\\d{4})\\s+(${BY})`));
    if (!m) continue;
    const navn = { Ø: 'Østjyske Motorvej', N: 'Nordjyske Motorvej', S: 'Sønderjyske Motorvej', V: 'Motorvej' }[m[1]] || m[1];
    return { adresse: `${navn}, ${m[2]} ${m[3].trim()}`, linje: i, start: m.index, cirka: true };
  }
  // 3) Vejnavn + nummer + postnummer + by: "Ny Munkegade 114 8000 Aarhus C", "Lysholt All. 11 , 7100 Vejle"
  const fuld = new RegExp(`(${VEJ}\\s\\d{1,4}[A-Za-z]?(?:,?\\s*(?:st|kl|\\d{1,2})\\.\\s*(?:th|tv|mf|\\d{1,3})?\\.?)?)\\s*,?\\s*(\\d{4})\\s+(${BY})`);
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(fuld);
    if (!m) continue;
    // Koder foran vejnavnet ("CI S1 Ny Munkegade", "Bygn.brand-Villa Skovvej") skæres fra
    const ord = m[1].trim().split(' ');
    let k = 0;
    for (let j = 0; j < ord.length - 1; j++) {
      if ((/^[A-ZÆØÅ0-9+\-]+$/.test(ord[j]) && ord[j].length <= 5) || (/\./.test(ord[j]) && /-/.test(ord[j])) || /[()]/.test(ord[j])) k = j + 1;
    }
    const vej = ord.slice(k).join(' ');
    return { adresse: `${vej}, ${m[2]} ${m[3].trim()}`, linje: i, start: L[i].indexOf(vej), cirka: false };
  }
  // 4) Postnummer + by, evt. med vejnavn foran på samme eller forrige linje:
  //    "Nordjyske Motorvej, 8380 Spørring, Aarhus Kommune" / "Østjyske Motorvej" + "7100 Vejle"
  const pb = new RegExp(`(?:^|[\\s,])(\\d{4})\\s+(${BY})`);
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(pb);
    if (!m || +m[1] < 1000 || /^\d{2}-\d{2}-\d{4}/.test(L[i]) || /\d{4}\s+kl\./.test(L[i])) continue;
    const by = `${m[1]} ${m[2].trim()}`;
    let vej = L[i].slice(0, m.index).replace(/[,\s]+$/, '').trim();
    if (!vej && i > 0 && /^[A-ZÆØÅ][a-zæøå]+(?:\s[A-ZÆØÅa-zæøå]+){0,3}$/.test(L[i - 1]) && !/:/.test(L[i - 1])) vej = L[i - 1];
    if (vej && (/:/.test(vej) || vej.length > 40)) vej = '';
    return { adresse: vej ? `${vej}, ${by}` : by, linje: vej ? i : -1, start: -1, cirka: true };
  }
  // 5) Motorvejsstrækning: "mellem <44> Hadsten og …", "mellem Horsens C og [57] Horsens S", "E45 fra Randers"
  for (const s of L) {
    const m = s.match(new RegExp(`\\bmellem\\s+(?:[<\\[]\\d+[>\\]]\\s*)?(${STEDNAVN})\\s+og\\b`))
      || s.match(new RegExp(`\\b(?:E|Rute\\s?)\\d{1,3}\\b.{0,40}?\\b(?:ved|nær|fra|syd for|nord for|øst for|vest for)\\s+(${STEDNAVN})`));
    if (m) return { adresse: m[1].replace(/\s(?:N|S|Ø|V|C|Nord|Syd|Øst|Vest|Midt)$/, ''), linje: -1, start: -1, cirka: true };
  }
  // 6) Kun stationen kendes (Mast/PF-Upload uden adresse): placér ved stationens by
  if (station) return { ...ingen, adresse: station.replace(/^(?:assistance|ass\.?)\s*-\s*/i, '').trim(), cirka: true };
  return ingen;
}

export function findKategori(...tekster) {
  for (const s of tekster) {
    if (!s) continue;
    for (const [navn, re] of KATEGORIER) if (re.test(s)) return navn;
  }
  return 'Andet';
}

// Linjer, der ikke er selve meldingen (bruges ikke til titel)
const METALINJE = /^(?:beredskab|station|adresse|lokation|featureid|se placering|se på google|detekteret kl|forventes at vare)|^\d{2}-\d{2}-\d{4}|^https?:\/\/|^ai-detektion/i;
const GENERISK_TITEL = /^(?:trafikmelding|1-1-2.*|112.*|alarm|besked)$/i;
const VEJLINJE = /^(?:E\d{1,3}|Rute\s?\d+|M\d{1,2}\b)|motorvej/i;

// Hele beskeden -> felter til tabellen "haendelser" (+ links, station og ignorer til serveren).
export function parseBesked({ title, message, url, priority, app } = {}) {
  let html = String(message || '');
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m => afkod(m[1]));
  html = html.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, ' ');
  const alle = afkod(html).split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim());
  links.push(...(alle.join(' ').match(/https?:\/\/[^\s<>"]+/g) || []));
  if (url) links.unshift(url);

  const tekst = alle.filter(l => l && !/^featureid:/i.test(l) && !/^se på google maps$/i.test(l)).join('\n');
  const rene = alle.map(l => renEmoji(l).replace(/^assistance:\s*(?=(?:@\d+\s*)?(?:assistance|ass\.))/i, '').replace(/^@\d+\s*/, '')).filter(Boolean);
  const rentitel = renEmoji(title).replace(/^@\d+\s*/, '');
  const stationLinje = rene.find(l => /^station:/i.test(l))?.replace(/^station:\s*/i, '');
  const erStationsFormat = rene.some(l => /^(?:beredskab|station):/i.test(l));
  const harTitel = rentitel && rentitel.toLowerCase() !== String(app || '').toLowerCase() && !GENERISK_TITEL.test(rentitel) && !erStationsFormat;
  const station = stationLinje || (erStationsFormat ? rentitel : '') || '';

  const indhold = rene.filter(l => !METALINJE.test(l));
  const { adresse, linje, start, cirka } = findAdresse(rene, station);

  let titel;
  if (/detekteret på google maps/i.test(rentitel)) {
    // Google Maps Scanner: "Muligt trafikuheld – Østjyske Motorvej"
    titel = rentitel.replace(/\s*detekteret på google maps/i, '') + (indhold[0] && !/^\d{4}\s/.test(indhold[0]) ? ` – ${indhold[0]}` : '');
  } else if (harTitel) {
    titel = rentitel;
  } else {
    titel = indhold[0] || rentitel || 'Ny hændelse';
    // Adressen står i samme linje ("ABA12 CI-M1 + CI S1 Ny Munkegade 114 …"): skær den fra
    const i = rene.indexOf(indhold[0]);
    if (i === linje && start > 2) titel = rene[i].slice(0, start).trim();
    // Kort titel som "Uheld" eller "Kø": tilføj vejen fra næste linje
    if (titel.length < 20 && indhold[1] && VEJLINJE.test(indhold[1])) {
      titel += ' – ' + indhold[1].split(/\s(?:fra|mellem|i|ved)\s/)[0];
    }
  }
  titel = titel
    .replace(/,?\s*#\d{5,}/g, '')                                         // sagsnummer "#1536906"
    .replace(/\s*\([^)]*(?:\+|ISL|MR-\d|-[MVR]\d)[^)]*\)/g, '')           // enheder "(ISL SYD + KO MR-1)"
    .replace(/^(.*[a-zæøå].{2,}?)\s+ISL\b.*$/, '$1')                        // "Naturbrand-Mindre brand ISL SY + …"
    .replace(/\s+\/-\s*/g, ' ')
    .replace(/[<\[]\d+[>\]]\s*/g, '').replace(/\s{2,}/g, ' ').replace(/[\s,;:+\-–]+$/, '').trim();
  if (titel.length > 80) titel = titel.slice(0, 80).replace(/[\s,;:+\-–]+\S*$/, '') + ' …';
  titel ||= 'Ny hændelse';
  const helikopter = /lægehelikopter|akutlægehelikopter/i.test(`${rentitel} ${indhold[0] || ''}`);
  if (helikopter && adresse) titel = `${titel.replace(/\s*–.*$/, '')} – ${adresse.split(',').pop().replace(/^\s*\d{4}\s+/, '').trim()}`;
  const kode = KODER.find(([re]) => re.test(titel));
  if (kode && !titel.toLowerCase().includes(kode[1])) titel += ` – ${kode[1]}`;

  const pos = findKoordinater(...links.filter(u => !skalSlåsOp(u)), tekst);
  const bedsteLink = links.find(u => /google\.[a-z.]+\/maps|maps\.apple|112meldinger|goo\.gl/i.test(u)) || links[0] || null;
  return {
    titel,
    tekst,
    adresse,
    kategori: findKategori(rentitel, indhold.slice(0, 2).join(' '), tekst.replace(/brandvæsen/gi, '')),
    prioritet: Number.isFinite(+priority) ? +priority : 0,
    url: bedsteLink,
    app: app || null,
    lat: pos ? pos.lat : null,
    lon: pos ? pos.lon : null,
    cirka: pos ? false : cirka,
    // Kun til serveren, gemmes ikke:
    links: [...new Set(links)],
    station: station || null,
    ignorer: IGNORER.test(`${title}\n${tekst}`) || (helikopter && HOSPITAL.test(adresse)),
    helikopter,
  };
}

// Kolonnerne i tabellen "haendelser", som parseBesked udfylder
export const række = h => {
  const { titel, tekst, adresse, kategori, prioritet, url, app, lat, lon, cirka } = h;
  return { titel, tekst, adresse, kategori, prioritet, url, app, lat, lon, cirka: !!cirka };
};

// Skal beskeden ignoreres? (indbygget liste + kontorets egen liste, fx "(Bus)")
export function skalIgnoreres(h, egne = []) {
  if (h.ignorer) return true;
  const s = `${h.titel}\n${h.tekst}`.toLowerCase();
  return (egne || []).some(o => o && s.includes(String(o).toLowerCase().trim()));
}

// Samme alarm fra flere kilder? Giver den aktive hændelse, en ny besked hører til, eller null.
// Match, hvis den aktive er højst 45 min gammel og enten
//  - har samme adresse (fx "ABA11 …" og "Ass.-A-sprøjte …" på Byvej 63), eller
//  - har samme kode/titel (fx "ABA12 CI-M1 + CI-S1" fra både 1-1-2 Århus og Mast), og de ikke
//    ligger langt fra hinanden, eller
//  - ligger under 300 m fra hinanden med samme kategori (eller under 100 m uanset kategori), eller
//  - er en lægehelikopter, der lander under 3 km fra hændelsen (5 km hvis den kun er cirka).
const KODE_FORKLARING = new RegExp(` – (?:${KODER.map(k => k[1]).join('|')})$`);
const nøgle = s => renEmoji(s).toLowerCase().replace(KODE_FORKLARING, '').replace(/[^a-z0-9æøå]/g, '');
const adrNøgle = a => /\d/.test(a || '') ? String(a).toLowerCase().replace(/[^a-z0-9æøå]/g, '') : '';
const fællesStart = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

export function findMatch(ny, aktive, nu = Date.now()) {
  const n = nøgle(ny.titel), na = adrNøgle(ny.adresse);
  // Nyeste først, så en besked uden adresse havner hos den seneste alarm med samme titel
  for (const h of [...aktive].sort((x, y) => String(y.oprettet).localeCompare(String(x.oprettet)))) {
    if (!['ny', 'taget', 'ankommet'].includes(h.status)) continue;
    if (nu - new Date(h.oprettet).getTime() > 45 * 60e3) continue;
    if (na && na === adrNøgle(h.adresse)) return h;
    const begge = ny.lat != null && h.lat != null;
    const afstand = begge ? Math.hypot((ny.lat - h.lat) * 111, (ny.lon - h.lon) * 111 * Math.cos(h.lat * Math.PI / 180)) : null;
    const præcis = begge && !ny.cirka && !h.cirka;
    const a = nøgle(h.titel), kort = Math.min(a.length, n.length), fælles = fællesStart(a, n);
    const sammeTitel = (kort >= 6 && fælles === kort) || (fælles >= 10 && fælles >= 0.8 * kort);
    if (sammeTitel && !(afstand > (præcis ? 2 : 25))) return h;
    if (præcis && (afstand < 0.1 || (afstand < 0.3 && ny.kategori === h.kategori))) return h;
  }
  // Lægehelikopter: læg den ind i den nærmeste aktive hændelse inden for 3 km (5 km hvis den kun er cirka)
  if (ny.helikopter && ny.lat != null) {
    let bedst = null, bedstAfstand = Infinity;
    for (const h of aktive) {
      if (!['ny', 'taget', 'ankommet'].includes(h.status) || h.lat == null || /lægehelikopter/i.test(h.titel)) continue;
      if (nu - new Date(h.oprettet).getTime() > 45 * 60e3) continue;
      const d = Math.hypot((ny.lat - h.lat) * 111, (ny.lon - h.lon) * 111 * Math.cos(h.lat * Math.PI / 180));
      if (d < (h.cirka ? 5 : 3) && d < bedstAfstand) { bedst = h; bedstAfstand = d; }
    }
    return bedst;
  }
  return null;
}

// Felter, der skal opdateres på den eksisterende hændelse, når en ekstra besked kommer ind.
export function flet(h, ny, app) {
  const linje = `— ${app || 'Ekstra besked'}: ${[ny.titel, ny.tekst].filter(Boolean).join(' · ').replace(/\n+/g, ' · ')}`;
  const felter = { tekst: [h.tekst, linje].filter(Boolean).join('\n') };
  const bedreAdresse = ny.adresse && (!h.adresse || (h.cirka && !ny.cirka && !ny.helikopter));
  if (bedreAdresse) felter.adresse = ny.adresse;
  // (en lægehelikopter lander ved stedet, ikke præcis på det: placeringen forbliver cirka)
  if (ny.lat != null && (h.lat == null || (h.cirka && !ny.cirka))) { felter.lat = ny.lat; felter.lon = ny.lon; felter.cirka = !!ny.cirka || !!ny.helikopter; }
  else if (bedreAdresse && h.cirka && !ny.cirka) { felter.lat = null; felter.lon = null; felter.cirka = false; } // slås op igen
  if ((!h.kategori || h.kategori === 'Andet') && ny.kategori !== 'Andet') felter.kategori = ny.kategori;
  if (!h.url && ny.url) felter.url = ny.url;
  return felter;
}

// Slår en adresse op og giver { lat, lon, navn } eller null. Bruger OpenStreetMap (Nominatim),
// som er gratis, men højst må kaldes ca. én gang i sekundet.
export async function geokod(adresse, { fetchFn = fetch, headers = {} } = {}) {
  if (!adresse) return null;
  const forsøg = [adresse];
  const [vej, ...resten] = adresse.split(',');
  const ord = vej.trim().split(/\s+/);
  if (ord.length >= 3 && /\d/.test(ord[ord.length - 1])) forsøg.push([ord.slice(1).join(' '), ...resten].join(','));  // uden firmanavn
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
