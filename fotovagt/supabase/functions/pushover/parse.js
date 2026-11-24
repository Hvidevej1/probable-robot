// Laver en Pushover-besked om til en hændelse: titel, adresse, kategori og evt. koordinater.
// Bruges både af Edge Function "pushover" (på serveren) og af demo-tilstanden i browseren,
// så beskeder bliver læst ens begge steder. Ret her, hvis jeres beskeder har et andet format.

// Nøgleord -> kategori. Første match vinder.
const KATEGORIER = [
  ['Brand', /brand|ild|røg|eksplosion|brænd/i],
  ['Trafik', /trafik|færdsel|uheld|ulykke|påkørsel|motorvej|frontal|bil |bilen|lastbil|mc[- ]|kø på/i],
  ['Politi', /politi|anholdt|skud|skyd|knivstik|røveri|indbrud|vold|drab|bevæbnet|aktion/i],
  ['Redning', /redning|drukn|eftersøg|savnet|vand|strand|havn|helikopter|ambulance/i],
  ['Miljø', /forurening|gas|kemikal|olie|udslip|lugt/i],
  ['Vejr', /storm|oversvøm|sne|skybrud|stormflod|træ over/i],
];

// Ligger koordinaterne inden for Danmark (inkl. Bornholm)?
const iDK = (lat, lon) => lat > 54.4 && lat < 57.9 && lon > 7.8 && lon < 15.3;

export function findKoordinater(...tekster) {
  const s = tekster.filter(Boolean).join(' ');
  const mønstre = [
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,                     // google.com/maps/@55.67,12.56
    /[?&](?:q|ll|query|destination|daddr)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
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

export function findAdresse(tekst) {
  const s = String(tekst || '');
  // 1) En linje med "Adresse: ..." eller "Sted: ..."
  const label = s.match(/(?:adresse|sted|lokation|location|address|position)\s*[:\-]\s*([^\n]+)/i);
  if (label) return label[1].trim().replace(/[.;]+$/, '');
  // 2) Vejnavn + nummer + postnummer + by: "Vestergade 12, 1. th, 8000 Aarhus C"
  const fuld = s.match(/([A-ZÆØÅ][A-Za-zÆØÅæøåéüö.'\- ]{2,40}?\s\d{1,4}[A-Za-z]?(?:,?\s*(?:st|kl|\d{1,2})\.?\s*(?:th|tv|mf|\d{1,3})?\.?)?)\s*,?\s*(\d{4})\s+([A-ZÆØÅ][A-Za-zÆØÅæøå\-]+(?:\s(?:[A-ZÆØÅ][a-zæøå]+|[A-Z]{1,2}\b|[NSVØ]\b))?)/);
  if (fuld) return `${fuld[1].trim()}, ${fuld[2]} ${fuld[3].trim()}`;
  // 3) Kun postnummer + by: "8000 Aarhus C"
  const by = s.match(/\b(\d{4})\s+([A-ZÆØÅ][A-Za-zÆØÅæøå\-]+(?:\s[A-ZÆØÅ]\b)?)/);
  if (by && +by[1] >= 1000) return `${by[1]} ${by[2]}`;
  // 4) Motorvej / vejstrækning: "E45 ved Vejle", "Motorvej E20 mellem ..."
  const vej = s.match(/\b((?:E|Rute\s?)\d{1,3}|Motorring\s\d)\b[^.\n]{0,40}?\b(?:ved|nær|mellem|syd for|nord for|øst for|vest for)\s+([A-ZÆØÅ][a-zæøå]+)/);
  if (vej) return `${vej[2]}`;
  return '';
}

export function findKategori(...tekster) {
  const s = tekster.filter(Boolean).join(' ');
  for (const [navn, re] of KATEGORIER) if (re.test(s)) return navn;
  return 'Andet';
}

// Hele beskeden -> felter til tabellen "haendelser".
export function parseBesked({ title, message, url, priority, app } = {}) {
  const tekst = String(message || '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const titel = String(title || '').trim() || tekst.split('\n')[0].slice(0, 80) || 'Ny hændelse';
  const pos = findKoordinater(tekst, url, title);
  return {
    titel,
    tekst,
    adresse: findAdresse(`${title || ''}\n${tekst}`),
    kategori: findKategori(title, tekst),
    prioritet: Number.isFinite(+priority) ? +priority : 0,
    url: url || null,
    app: app || null,
    lat: pos ? pos.lat : null,
    lon: pos ? pos.lon : null,
  };
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
