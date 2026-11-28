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
  ['Forsyning', /vandafbrydelse|varmeafbrydelse|strømafbrydelse|fjernvarme|vandledning|elnet|ledningsbrud|\bforsyning\b/i],
  // Redningskoder fra beredskabet (fx "Redn.-Silo/Brønd") vinder over 🔥, som alle beredskabsbeskeder har
  ['Redning', /\bredn\.|(?<!(?:&|\bog)\s?)\bredning\b|\bsilo\b|brønd|drukn|person i vand(?:et)?|fastklemt|vandredning|dyreredning/i],
  ['Brand', /🔥|🚒|\bABA\d*|bygn\.?\s?brand|brand(?!væsen)|\bild\b|røg|eksplosion|brænd|skorsten|sprøjte|tankvogn|\bass\.|\bassistance\b/i],
  ['Trafik', /🚗|🚙|🚘|trafik|færdsel|uheld|ulykke|påkørsel|motorvej|frontal|lastbil|(?:^|[\s,.])kø(?=$|[\s,.])|\bE\d{2}\b|spærret|vejarbejde|dyr på vejen/i],
  ['Politi', /🚓|👮|efterlys|varetægt|voldtægt|politi(?! og redning)|anholdt|skud|skyd|knivstik|røveri|indbrud|vold|drab|bevæbnet|aktion/i],
  ['Redning', /🚁|\bfly\b|sikkerhedslanding|nødlanding|flystyrt|🚑|lægehelikopter|akuthjælper|hjertestop|udkald til|redning|drukn|eftersøg|savnet|person i vand|helikopter|ambulance|fastklemt/i],
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
// (Planlagte strømafbrydelser kommer med – de får tidsrummet i titlen)
const IGNORER = /radioprøve|prøvealarm|testalarm|welcome to pushover/i;
// Lægehelikopter, der lander ved et hospital, er bare patienttransport
const HOSPITAL = /hospital|sygehus|\bAUH\b|\bOUH\b|rigshospitalet|helipad|akutmodtagelse/i;

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{2640}\u{2642}\u{FE0F}\u{200D}\u{20E3}]/gu;
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
const BY = '[A-ZÆØÅ][A-Za-zÆØÅæøå\\-]+(?:\\s(?!Kommune\\b)(?![A-Za-zÆØÅæøå]+\\sKommune\\b)(?:[A-ZÆØÅ][a-zæøå]+|[A-ZÆØÅ]{1,2}(?![A-Za-zÆØÅæøå])))?';
const STEDNAVN = '[A-ZÆØÅ][a-zæøå]+(?:\\s(?:[A-ZÆØÅ][a-zæøå]+|[A-Z]{1,2}\\b))?';

// Et gadenavn uden husnummer i fri tekst: "lukke for vandet på Remstrupvej", "ved Stadion Allé i Viborg"
const GADE = '(?<![A-Za-zÆØÅæøå])((?!Motorvej)[A-ZÆØÅ][a-zæøå]+(?:vej|gade|allé|alle|stræde|torv|plads|boulevard|vænget|parken|stien)|[A-ZÆØÅ][a-zæøå]+\\s(?:Allé|Alle|Vej|Gade|Plads|Torv|Boulevard|Stræde))(?![A-Za-zÆØÅæøåé])';
function findGade(L) {
  for (const l of L) {
    if (/^(?:station|beredskab|netselskab|læs mere)/i.test(l)) continue;
    const m = l.match(new RegExp(GADE));
    if (m && !/motorvej/i.test(m[1])) return m[1];
  }
  return '';
}

const SEKTION = /^(?:nyheder|artikel|video|live|sport|kort-nyt|kortnyt|breaking|seneste|nyt|indland|regionalt|112|krimi|trafik|politi|vejr)$/i;
// Regionale TV-stationers links har kommunen først i stien: tv2ostjylland.dk/aarhus/…, tvsyd.dk/kolding/…
export function byFraLink(links) {
  for (const u of links || []) {
    const m = String(u).match(/^https?:\/\/(?:www\.)?(?:tv2[a-z]*|tvsyd|tvmidtvest|tv2fyn|tv2nord|tv2east|tv2kosmopol|lorry)\.dk\/(.+)$/i);
    // Politiets pressemeddelelser (via.ritzau.dk/pressemeddelelse/123/mistaenkeligt-dodsfald-i-nakskov-…): byen står efter "-i-"
    const pm = String(u).match(/ritzau\.dk\/pressemeddelelse\/\d+\/([a-z0-9-]+)/i);
    const iBy = pm && [...pm[1].matchAll(/-(?:i|ved|nær|naer)-([a-z]{3,}(?:-(?:s|n|v|c|nord|syd|oest|vest))?)(?=-|$)/gi)].pop();
    if (iBy && !/^(?:forbindelse|bil|lejlighed|hus|huset|bolig|butik|nat|morges|aftes|weekenden|dag|gaar|omraadet|sagen)$/i.test(iBy[1])) {
      return iBy[1].replace(/oe/g, 'ø').replace(/ae/g, 'æ').split('-').map(o => o[0].toUpperCase() + o.slice(1)).join(' ');
    }
    if (!m) continue;
    const dele = m[1].split(/[/?#]/).slice(0, -1);   // sidste del er selve artiklen
    const by = dele.find(d => /^[a-zæøå-]+$/i.test(d) && !SEKTION.test(d));
    if (by) return by.replace(/oe/g, 'ø').replace(/ae/g, 'æ').split('-').map(o => o[0].toUpperCase() + o.slice(1)).join(' ');
  }
  return '';
}

// Giver { adresse, linje, start, cirka }: linje/start er hvor adressen står (bruges til at korte titlen af).
// cirka = true, når det kun er en by/station/vejstrækning og ikke en præcis adresse.
// Ord efter "på", der ikke er vejnavne (øer, landsdele, sociale medier, steder i almindelighed)
const IKKE_VEJ = /^(?:Fyn|Sjælland|Jylland|Als|Mors|Bornholm|Lolland|Falster|Møn|Langeland|Ærø|Djursland|Samsø|Fanø|Rømø|Læsø|Anholt|Thurø|Tåsinge|Amager|Facebook|Twitter|Instagram|Tiktok|Youtube|Hospitalet|Sygehuset|Skolen|Stationen|Stedet|Vejen|Motorvejen|Banen|Havnen|Stranden|Torvet|Grund|Grundlag|Baggrund|Mandag|Tirsdag|Onsdag|Torsdag|Fredag|Lørdag|Søndag)$/;
export function findAdresse(linjer, station, byHint = '', kendteVeje = []) {
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
  // 3b) "Postnummer: 8600" og "By: Silkeborg" i hver sin linje
  const pnLinje = L.find(l => /^postnummer:\s*\d{4}\s*$/i.test(l));
  const byLinje = L.find(l => /^by:\s*\S/i.test(l));
  if (pnLinje && byLinje) {
    const by = `${pnLinje.match(/\d{4}/)[0]} ${byLinje.replace(/^by:\s*/i, '').trim()}`;
    const gade = findGade(L);
    return { adresse: gade ? `${gade}, ${by}` : by, linje: -1, start: -1, cirka: true };
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
    const gade = vej ? '' : findGade(L);   // fx "Remstrupvej" længere nede i teksten
    return { adresse: vej ? `${vej}, ${by}` : gade ? `${gade}, ${by}` : by, linje: vej ? i : -1, start: -1, cirka: true };
  }
  // 4b) Gade + by: "ved Stadion Allé i Viborg", "Viborgvej nordøst for Aalestrup".
  //     "Randersvej ved Djurslandsmotorvejen": byen tages fra TV-stationens link, ellers kun gaden (placeres ikke)
  for (const l of L) {
    const m = l.match(new RegExp(`${GADE}[^.\\n]{0,40}?\\s(?:i|ved|nær|(?:nord|syd|øst|vest|nordøst|nordvest|sydøst|sydvest)\\s+for)\\s+(${STEDNAVN})`));
    if (m && !/motorvej/i.test(m[1]) && !/motorvej/i.test(m[2])) return { adresse: `${m[1]}, ${m[2].replace(/\s[A-ZÆØÅ]{1,2}$/, '')}`, linje: -1, start: -1, cirka: true };
  }
  // 4c) Nyheder: "en lejlighed på Uglehøjen i Højby syd for Odense" – vejnavne uden vej/gade (højen, toften, …).
  //     Byen, der henvises til ("syd for Odense"), tages med, så den rigtige Højby findes.
  for (const l of L) {
    const m = l.match(new RegExp(`\\bpå\\s+([A-ZÆØÅ][a-zæøå]{3,}(?:\\s[A-ZÆØÅ][a-zæøå]+)?)\\s+i\\s+(${STEDNAVN})(?:\\s+(?:nord|syd|øst|vest|nordøst|nordvest|sydøst|sydvest)\\s+for\\s+(${STEDNAVN}))?`));
    if (m && !IKKE_VEJ.test(m[1])) return { adresse: [m[1], m[2], m[3]].filter(Boolean).join(', '), linje: -1, start: -1, cirka: true, gade: m[1] };
  }
  // 4d) Lærte vejnavne (stedviden): veje, Fotovagt tidligere har fundet – også uden vej/gade ("ved Uglehøjen")
  if (kendteVeje.length) {
    const tekst = L.filter(l => !/^(?:station|beredskab):/i.test(l)).join('\n');
    for (const k of kendteVeje) {
      // (almindelige navne som Skovvej/Vestergade findes i mange byer og klares af reglerne ovenfor)
      if (!k?.navn || k.navn.length < 4 || /(?:vej|gade|allé|alle|stræde|torv|plads|boulevard|vænget|parken|stien)$/i.test(k.navn) || !tekst.includes(k.navn)) continue;
      if (new RegExp(`(?<![A-Za-zÆØÅæøåé])${k.navn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-zÆØÅæøåé])`).test(tekst)) {
        const by = byHint || k.by;
        return { adresse: by ? `${k.navn}, ${by}` : k.navn, linje: -1, start: -1, cirka: true, gade: k.navn };
      }
    }
  }
  const gade = findGade(L);
  if (gade && byHint) return { adresse: `${gade}, ${byHint}`, linje: -1, start: -1, cirka: true };
  // 5) Motorvejsstrækning: "mellem <44> Hadsten og …", "mellem Horsens C og [57] Horsens S", "E45 fra Randers"
  for (const s of L) {
    const m = s.match(new RegExp(`\\bmellem\\s+(?:[<\\[]\\d+[>\\]]\\s*)?(${STEDNAVN})\\s+og\\b`))
      || s.match(new RegExp(`\\b(?:E|Rute\\s?)\\d{1,3}\\b.{0,120}?\\b(?:ved|nær|fra|syd for|nord for|øst for|vest for)\\s+(${STEDNAVN})`));
    if (m) return { adresse: m[1].replace(/\s(?:N|S|Ø|V|C|Nord|Syd|Øst|Vest|Midt)$/, ''), linje: -1, start: -1, cirka: true };
  }
  if (byHint) return { ...ingen, adresse: byHint, cirka: true };
  if (gade) return { ...ingen, adresse: gade, cirka: true };   // kun gadenavn: vises, men placeres ikke
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
const METALINJE = /^(?:beredskab|station|adresse|lokation|featureid|se placering|se på google|detekteret kl|forventes at vare|læs mere|postnummer|by:|type:|berørte|årsag|start:|forventet slut|netselskab|akut:)|^\d{2}-\d{2}-\d{4}|^https?:\/\/|^ai-detektion/i;
const GENERISK_TITEL = /^(?:trafikmelding|1-1-2.*|112.*|alarm|besked|breaking|nyhed(?:er)?|.*\bpoliti|(?:www\.)?[a-z0-9æøå-]+\.dk)$/i;
const NYHEDSKILDE = /^(?:breaking:?\s*)?[A-Za-z0-9æøå-]+\.dk:\s*/i;
const VEJLINJE = /^(?:E\d{1,3}|Rute\s?\d+|M\d{1,2}\b)|motorvej/i;

// Hele beskeden -> felter til tabellen "haendelser" (+ links, station og ignorer til serveren).
export function parseBesked({ title, message, url, priority, app, kendteVeje = [] } = {}) {
  let html = String(message || '');
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m => afkod(m[1]));
  html = html.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, ' ');
  const alle = afkod(html).split('\n').map(l => l.replace(/Lyt til artiklen\s*Stop afspilningen\s*Genoptag afspilning\s*/gi, '').replace(/[ \t]+/g, ' ').trim());
  links.push(...(alle.join(' ').match(/https?:\/\/[^\s<>"]+/g) || []));
  if (url) links.unshift(url);

  const tekst = alle.filter(l => l && !/^featureid:/i.test(l) && !/^se på google maps$/i.test(l)).join('\n');
  const rene = alle.map(l => renEmoji(l).replace(/^assistance:\s*(?=(?:@\d+\s*)?(?:assistance|ass\.))/i, '').replace(/^@\d+\s*/, '').replace(NYHEDSKILDE, '')).filter(Boolean);
  let rentitel = renEmoji(title).replace(/^@\d+\s*/, '');
  if (/^breaking\b/i.test(rentitel)) rentitel = rentitel.replace(NYHEDSKILDE, '').replace(/^breaking:?\s*/i, '') || 'Breaking';
  const stationLinje = rene.find(l => /^station:/i.test(l))?.replace(/^station:\s*/i, '');
  const erStationsFormat = rene.some(l => /^(?:beredskab|station):/i.test(l));
  const harTitel = rentitel && rentitel.toLowerCase() !== String(app || '').toLowerCase() && !GENERISK_TITEL.test(rentitel) && !erStationsFormat;
  const station = stationLinje || (erStationsFormat ? rentitel : '') || '';

  const indhold = rene.filter(l => !METALINJE.test(l));
  const { adresse, linje, start, cirka, gade: adrGade } = findAdresse(rene, station, byFraLink(links), kendteVeje);

  let titel;
  if (/detekteret på google maps/i.test(rentitel)) {
    // Google Maps Scanner: "Muligt trafikuheld – Østjyske Motorvej"
    titel = rentitel.replace(/\s*detekteret på google maps/i, '') + (indhold[0] && !/^\d{4}\s/.test(indhold[0]) ? ` – ${indhold[0]}` : '');
  } else if (harTitel) {
    titel = rentitel;
  } else {
    titel = indhold[0] || rentitel || 'Ny hændelse';
    // Politiets pressemeddelelser: første sætning (navne i efterlysninger kommer ikke i titlen)
    if (/politi$/i.test(rentitel)) {
      titel = /efterlys/i.test(titel) && !/er fundet/i.test(titel)
        ? `Efterlysning${adresse ? ' – ' + adresse.split(',').pop().replace(/^\s*\d{4}\s+/, '').trim() : ''}`
        : titel.split(/(?<=[a-zæøå]{3})\.\s/)[0];
      const om = titel.match(/anmeldelse om (?:et|en)\s+(.+?)(?:\s+i\s+(?:nordlig|sydlig|østlig|vestlig|begge)\w*\s+retning.*)?$/i);
      if (om) titel = om[1][0].toUpperCase() + om[1].slice(1);
    }
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
  // Planlagt afbrydelse (strøm, vand, varme): tidsrummet i titlen, fx "Strømafbrydelse – Sindal (planlagt kl. 12.00–15.00)"
  if (rene.some(l => /^type:\s*planlagt/i.test(l))) {
    const tid = navn => (rene.find(l => new RegExp(`^${navn}:`, 'i').test(l)) || '').match(/(\d{2})-(\d{2})-\d{4}\s*kl\.\s*(\d{1,2})[:.](\d{2})/);
    const fra = tid('start'), til = tid('forventet slut');
    if (fra && !/planlagt/i.test(titel)) {
      const idag = new Intl.DateTimeFormat('da-DK', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Copenhagen' }).format(new Date()).replace('.', '-').replace(/\.$/, '');
      const dag = `${fra[1]}-${fra[2]}` === idag ? '' : `${+fra[1]}/${+fra[2]} `;
      titel += ` (planlagt ${dag}kl. ${fra[3]}.${fra[4]}${til ? `–${til[3]}.${til[4]}` : ''})`;
    }
  }
  const kode = KODER.find(([re]) => re.test(titel));
  if (kode && !titel.toLowerCase().includes(kode[1])) titel += ` – ${kode[1]}`;

  const pos = findKoordinater(...links.filter(u => !skalSlåsOp(u)), tekst);
  const bedsteLink = links.find(u => /google\.[a-z.]+\/maps|maps\.apple|112meldinger|goo\.gl/i.test(u)) || links[0] || null;
  return {
    titel,
    tekst,
    adresse,
    kategori: /politi$/i.test(rentitel)
      ? (findKategori(indhold.slice(0, 2).join(' ')) === 'Andet' ? 'Politi' : findKategori(indhold.slice(0, 2).join(' ')))
      : findKategori(rentitel, indhold.slice(0, 2).join(' '), tekst.replace(/^.*\bberedskab:.*$/gim, '').replace(/brandvæsen|brand (?:og|&) redning/gi, '')),
    prioritet: Number.isFinite(+priority) ? +priority : 0,
    url: bedsteLink,
    app: app || null,
    lat: pos ? pos.lat : null,
    lon: pos ? pos.lon : null,
    cirka: pos ? false : cirka,
    // Kun til serveren, gemmes ikke:
    links: [...new Set(links)],
    station: station || null,
    // Opfølgning ("personen er fundet"): bruges kun til at opdatere den hændelse, den hører til
    opfoelgning: /politi$/i.test(rentitel) && /er fundet|slette (?:foto|billede|navn)/i.test(tekst),
    ignorer: IGNORER.test(`${title}\n${tekst}`) || (helikopter && HOSPITAL.test(adresse)),
    helikopter,
    gade: (adrGade || findGade(rene)).toLowerCase(),
  };
}

// Kolonnerne i tabellen "haendelser", som parseBesked udfylder
export const pressemeddelelseNr = u => (String(u || '').match(/pressemeddelelse\/(\d+)/) || [])[1] || '';
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

// Stationen i den første melding ("Station: Allerød")
const stationAf = h => (String(h.tekst || '').split('\n').filter(l => !l.startsWith('— ')).map(renEmoji)
  .find(l => /^station:/i.test(l)) || '').replace(/^station:\s*/i, '').trim().toLowerCase();
const gadeAf = h => findGade([h.adresse || '', ...String(h.tekst || '').split('\n').map(renEmoji)]).toLowerCase();
const pressemeddelelse = u => (String(u || '').match(/pressemeddelelse\/(\d+)/) || [])[1] || '';

// Hvilken slags sted handler det om? Bruges til at genkende en nyhed om samme alarm.
const OBJEKT = /lejlighed|etage|villa|rækkehus|parcelhus|enfamiliehus|sommerhus|kolonihave|campingvogn|landbrug|stald|lade|gård|industri|fabrik|lager|butik|restaurant|skole|institution|plejehjem|kirke|skur|carport|garage|container|skraldespand|personbil|lastbil|bilbrand|\bbil\b|bus|traktor|mejetærsker|båd|skib|tog|mark|skov|halm|hede/gi;
const objekter = h => new Set((`${h.titel || ''} ${h.tekst || ''}`.toLowerCase().match(OBJEKT) || []).map(o => o === 'bilbrand' ? 'bil' : o));
function sammeObjekt(a, b) { const A = objekter(a); for (const o of objekter(b)) if (A.has(o)) return true; return false; }
const EFTERSYN = /eftersyn|efterslukning|genantænd|blusset op igen|ulmebrand/i;
export function efterBrand(ny, alle, nu = Date.now()) {
  const na = adrNøgle(ny.adresse), ns = String(ny.station || '').trim().toLowerCase();
  for (const h of [...alle].sort((x, y) => String(y.oprettet).localeCompare(String(x.oprettet)))) {
    if (h.status === 'annulleret' || h.kategori !== 'Brand' || EFTERSYN.test(h.titel) || alvor(h.titel) < 2) continue;
    if (nu - new Date(h.oprettet).getTime() > 24 * 3600e3) continue;
    const begge = ny.lat != null && h.lat != null;
    const afstand = begge ? Math.hypot((ny.lat - h.lat) * 111, (ny.lon - h.lon) * 111 * Math.cos(h.lat * Math.PI / 180)) : null;
    const præcis = begge && !ny.cirka && !h.cirka;
    if (na && na === adrNøgle(h.adresse)) return h;                                   // samme adresse
    if (præcis && afstand < 0.15) return h;                                            // under 150 m
    if (ny.gade && ny.gade === gadeAf(h) && !(afstand > 2)) return h;                  // samme vej
    // Kun stationen kendes på begge: kun inden for 6 timer (ellers kan det være en anden brand i samme by)
    if (ns && ns === stationAf(h) && !na && !adrNøgle(h.adresse) && !ny.gade && !gadeAf(h) && nu - new Date(h.oprettet).getTime() < 6 * 3600e3) return h;
  }
  return null;
}
export function findMatch(ny, aktive, nu = Date.now()) {
  const n = nøgle(ny.titel), na = adrNøgle(ny.adresse);
  // Opfølgning på samme pressemeddelelse fra politiet (fx "personen er fundet")
  const pm = pressemeddelelse(ny.url);
  if (pm) {
    // (også afsluttede, så en efterlysning bliver ryddet op, selvom kontoret allerede har lukket den)
    const h = aktive.find(h => h.status !== 'annulleret' && pressemeddelelse(h.url) === pm
      && nu - new Date(h.oprettet).getTime() < 24 * 3600e3);
    if (h) return h;
  }
  // Eftersyn efter en brand: samme sted som en brand inden for det seneste døgn (også lukkede) -> samme hændelse
  if (EFTERSYN.test(ny.titel)) {
    const h = efterBrand(ny, aktive, nu);
    if (h) return h;
  }
  // Nyeste først, så en besked uden adresse havner hos den seneste alarm med samme titel
  for (const h of [...aktive].sort((x, y) => String(y.oprettet).localeCompare(String(x.oprettet)))) {
    if (!['ny', 'taget', 'ankommet'].includes(h.status)) continue;
    const alder = nu - new Date(h.oprettet).getTime();
    if (alder > 3 * 3600e3) continue;
    const begge = ny.lat != null && h.lat != null;
    const afstand = begge ? Math.hypot((ny.lat - h.lat) * 111, (ny.lon - h.lon) * 111 * Math.cos(h.lat * Math.PI / 180)) : null;
    const præcis = begge && !ny.cirka && !h.cirka;
    // Samme gade og samme slags hændelse inden for 3 timer: politi, nyheder og 112 om samme ulykke
    //   (kun når mindst én mangler husnummer; præcise adresser bruger reglerne herunder)
    if (ny.gade && (!na || !adrNøgle(h.adresse)) && ny.kategori === h.kategori && ny.gade === gadeAf(h) && !(afstand > (præcis ? 2 : 25))) return h;
    // Nyhed om en alarm: medierne skriver typisk 20–90 min efter alarmen og nævner kun vej/by. Samme kategori,
    // samme slags sted (lejlighed, villa, bil …) og højst 15 km fra alarmens station (alarmen kendes kun ved stationen).
    if (ny.url && !ny.station && h.cirka && stationAf(h) && ny.kategori === h.kategori && afstand != null && afstand < 15 && sammeObjekt(ny, h)) return h;
    if (alder > 45 * 60e3) continue;
    if (na && na === adrNøgle(h.adresse)) return h;
    const a = nøgle(h.titel), kort = Math.min(a.length, n.length), fælles = fællesStart(a, n);
    // (næsten ens kun for koder med tal, fx forvanskede "Assistance VB V-1 /-`Q" – ikke for "Færdselsuheld …")
    const sammeTitel = (kort >= 6 && fælles === kort) || (fælles >= 10 && fælles >= 0.8 * kort && /\d/.test(a.slice(0, fælles)));
    const hs = stationAf(h), ns = String(ny.station || '').trim().toLowerCase();
    const andenStation = hs && ns && hs !== ns;
    if (sammeTitel && !andenStation && !(afstand > (præcis ? 2 : 25))) return h;
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
// Live opdatering fra stedet: "færdige på uheldsstedet", "trafikken er åbnet op igen"
const FÆRDIG = /færdige (?:med [a-zæøå ]+ )?på (?:uhelds|ulykkes|gerningsstedet|stedet)|færdige med undersøgelserne|trafikken er (?:åbnet|genåbnet)|åbnet op igen|vejen er (?:åbnet|genåbnet)|slukket|under kontrol/i;
const klokkenDK = () => new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' }).format(new Date());

// Er beskeden allerede lagt ind? Samme tekst sendes ofte flere gange (fx af en backup-kilde hvert 20. sekund),
// med andre skilletegn, linjeskift, "for 3 minutter siden" eller et nyt klokkeslæt. Vi sammenligner kun ordene.
const kerne = s => renEmoji(s).toLowerCase()
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/\bfor\s+\d+\s+(?:sekunder|sekund|minutter|minut|timer|time)\s+siden\b/g, ' ')
  .replace(/\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b/g, ' ').replace(/\b(?:kl\.?\s*)?\d{1,2}[:.]\d{2}(?::\d{2})?\b/g, ' ')
  .replace(/\s—\s.*?:/g, ' ').replace(/[^a-zæøå0-9]+/g, ' ').trim();
export function alleredeKendt(gammel, ny) {
  const n = kerne(ny), g = kerne(gammel);
  if (!n) return true;
  if (g.includes(n.slice(0, 160))) return true;
  // Næsten alle ord findes allerede (fx samme melding fra en anden kilde med lidt andre ord)
  const ord = [...new Set(n.split(' ').filter(o => o.length > 2))];
  const kendte = new Set(g.split(' '));
  return ord.length >= 6 && ord.filter(o => kendte.has(o)).length / ord.length >= 0.9;
}

// Alvor: kommer der en mere alvorlig melding på samme hændelse (fx "Eftersyn" → "Bygn.brand"), opgraderes den.
// 3 = brand/redning/alvorlig ulykke, 2 = almindelig hændelse, 1 = eftersyn, automatisk alarm, assistance, advarsler.
const ALVOR = [
  [3, /bygn\.?\s?brand|bygningsbrand|naturbrand|skibsbrand|brand i |brand-(?!alarm)|eksplosion|redn\.|drukn|person i vand|fastklemt|omkommet|dræbt|dødsulykke|dødelig|frontal|hjertestop|skud|knivstik|bevæbnet/i],
  [1, /eftersyn|\baba\d*\b|automatisk brandalarm|forespørgsel|\bass\.|assistance|advarsel|havareret|tabt gods|dyr på vejen|kør forsigtigt|vejarbejde|(?:^|\s)kø(?:$|\s)|planlagt|cyklister på vejen|personer på vejen/i],
  [2, /uheld|ulykke|brand|\bild\b|røg|redning|politi|anholdt|efterlys/i],
];
export const alvor = t => (ALVOR.find(([, re]) => re.test(t || '')) || [1.5])[0];

export function flet(h, ny, app) {
  const kort = String(ny.tekst || '').split('\n').map(l => renEmoji(l).replace(NYHEDSKILDE, ''))
    .filter(l => l && !/^læs mere|^https?:\/\//i.test(l)).join(' · ');
  const indhold = kort.startsWith(ny.titel) ? kort : [ny.titel, kort].filter(Boolean).join(' · ');
  const opgrader = alvor(ny.titel) > alvor(h.titel);
  const linje = `— kl. ${klokkenDK()} ${String(app || 'Ekstra besked').trim()}: ${opgrader ? '⬆️ Opgraderet · ' : ''}${FÆRDIG.test(ny.tekst || '') ? '✅ ' : ''}${indhold}`;
  const felter = { tekst: alleredeKendt(h.tekst, ny.tekst) && !opgrader ? h.tekst : [h.tekst, linje].filter(Boolean).join('\n') };
  // Mere alvorlig melding: hændelsen får den nye titel og kategori (fx eftersyn → bygningsbrand)
  if (opgrader) {
    felter.titel = ny.titel;
    if (ny.kategori && ny.kategori !== 'Andet') felter.kategori = ny.kategori;
    felter.opgraderet = new Date().toISOString();
  }
  // Efterlyst person fundet: politiet beder om at slette navn og foto, så den første tekst fjernes
  if (/er fundet|slette (?:foto|billede|navn)/i.test(ny.tekst || '') && /efterlys/i.test(`${h.titel} ${h.tekst}`)) {
    felter.titel = 'Efterlysning afsluttet – personen er fundet';
    felter.tekst = `Personen er fundet. Den oprindelige tekst er fjernet efter politiets opfordring.\n${linje}`;
    if (h.status === 'ny') { felter.status = 'afsluttet'; felter.afsluttet_tid = new Date().toISOString(); }
    return felter;
  }
  // En nyhed med vejnavn ("Uglehøjen, Højby") er bedre end en alarm, der kun kendes ved stationen ("Åsum - Odense")
  const vejFremforStation = h.cirka && ny.cirka && ny.gade && !gadeAf(h) && ny.lat != null && !ny.helikopter;
  const bedreAdresse = ny.adresse && (!h.adresse || (h.cirka && !ny.cirka && !ny.helikopter) || (h.lat == null && ny.lat != null && !ny.helikopter) || vejFremforStation);
  if (bedreAdresse) felter.adresse = ny.adresse;
  // (en lægehelikopter lander ved stedet, ikke præcis på det: placeringen forbliver cirka)
  if (ny.lat != null && (h.lat == null || (h.cirka && !ny.cirka) || vejFremforStation)) { felter.lat = ny.lat; felter.lon = ny.lon; felter.cirka = !!ny.cirka || !!ny.helikopter; }
  else if (bedreAdresse && h.cirka && !ny.cirka) { felter.lat = null; felter.lon = null; felter.cirka = false; } // slås op igen
  if (!felter.kategori && (!h.kategori || h.kategori === 'Andet') && ny.kategori !== 'Andet') felter.kategori = ny.kategori;
  if (!h.url && ny.url) felter.url = ny.url;
  return felter;
}

// Slår en adresse op og giver { lat, lon, navn } eller null. Bruger OpenStreetMap (Nominatim, højst
// ca. ét kald i sekundet) og Photon (samme kortdata) som reserve, hvis Nominatim afviser eller intet finder.
// (Den danske adresseservice DAWA er lukket.)
export async function geokod(adresse, { fetchFn = fetch, headers = {}, log = () => {} } = {}) {
  if (!adresse) return null;
  if (!/[,\d]/.test(adresse) && /(?:vej|gade|allé|alle|stræde|torv|plads|boulevard)$/i.test(adresse)) return null;
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
      if (r.ok) {
        const [hit] = await r.json();
        if (hit) return { lat: +hit.lat, lon: +hit.lon, navn: hit.display_name };
      } else log(`Nominatim svarede ${r.status} på "${q}"`);
    } catch (e) { log(`Nominatim fejl på "${q}": ${e?.message || e}`); }
    const p = 'https://photon.komoot.io/api/?limit=1&bbox=7.8,54.4,15.3,57.9&q=' + encodeURIComponent(q);
    try {
      const r = await fetchFn(p, { headers });
      if (r.ok) {
        const f = (await r.json()).features?.[0];
        if (f) {
          const [lon, lat] = f.geometry.coordinates;
          if (iDK(lat, lon)) return { lat, lon, navn: [f.properties.street, f.properties.housenumber, f.properties.postcode, f.properties.city].filter(Boolean).join(' ') };
        }
      } else log(`Photon svarede ${r.status} på "${q}"`);
    } catch (e) { log(`Photon fejl på "${q}": ${e?.message || e}`); }
  }
  log(`Ingen placering fundet for "${adresse}"`);
  return null;
}
