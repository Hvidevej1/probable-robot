// Test af beskedparseren med rigtige beskeder fra Pushover. Kør:  node parse.test.mjs
import { parseBesked, findMatch, flet, skalIgnoreres } from './parse.js';

const B = {
  aba112: { app: '1-1-2 Århus', message: 'ABA12 CI-M1 + CI  S1 Ny Munkegade 114 8000 Aarhus C Aarhus Kommune' },
  abaMast: { app: 'Mast', title: '🚒 Aarhus C', message: '🔥 ABA12 CI-M1 + CI-S1\nBeredskab: Østjyllands Brandvæsen\nStation: Aarhus C\nAdresse: Ny Munkegade 114, 8000 Aarhus C\n24-11-2026 15:51' },
  ass112: { app: '1-1-2 Århus', message: '@0 Ass.-A-sprøjte og tankvogn OD-M1 + OD V1 Byvej 63 8330 Beder' },
  aba112b: { app: '1-1-2 Århus', message: 'ABA11 SY-M1 + SY V1 Byvej 63 8330 Beder' },
  assMast: { app: 'Mast', title: '🚒 Assistance - Aarhus Syd', message: '🔥 Assistance: @0 Ass.-A-sprøjte og tankvogn OD-M1 + OD-V1\nBeredskab: Østjyllands Brandvæsen\nStation: Aarhus Syd\nAdresse: Byvej 63, 8330 Beder' },
  viby: { app: '1-1-2 Århus', message: 'ABA41 ISL NO(22-06) + SY-M1 + SY S1 Skovlundgårdsvej 53 8260 Viby J Aarhus Kommune' },
  radio: { app: '1-1-2 Århus', message: '24-11 26 Radioprøve fra Østjyllands Brandvæsen' },
  skejby: { app: '1-1-2 Århus', message: 'ABA42 ABA Skejby SGH (06-22) ISL + NO-M1 + NO-V1 -- (22-06) ISL + NO-M1 + NO-V1 + CI-M1 + CI-V1 Palle Juul Jensens Blv 175 8200 Aarhus N' },
  vejle: { app: 'Mast', title: '🚒 Assistance - Vejle', message: '🔥 Assistance: Assistance VB V-1 /- (VB ISL + VB MR-1) EL-instal.-Brand-Transformatorstation, Lysholt All. 11 , 7100 Vejle\nBeredskab: Vejle Brandvæsen\nStation: Vejle\n24-11-2026 14:47' },
  vejleSkæv: { app: 'Mast', title: '🚒 Vejle', message: '🔥 Assistance VB V-1 /-`Q\nBeredskab: Vejle Brandvæsen\nStation: Vejle\n24-11-2026 14:47' },
  odder: { app: 'PF-Upload', title: '🚒 Odder', message: '🔥 Bygn.brand-Lejlighed\nBeredskab: Østjyllands Brandvæsen\nStation: Odder\n24-11-2026 16:54' },
  gmaps: { app: 'Google Maps Scanner', title: '🚨 Muligt trafikuheld detekteret på Google Maps', message: '📍 Østjyske Motorvej\n🏙️ 7100 Vejle\n⚠️ AI-detektion af trafikmaengde var ikke mulig - meldingen er ikke verificeret\n🕒 Detekteret kl. 16:04' },
  trafikKø: { app: 'Trafik Server', title: 'Trafikmelding', message: '<b>Kø</b>\nE45 fra Randers mod Randers mellem &lt;44&gt; Hadsten og &lt;46&gt; Aarhus Nord\n\nKø, Forlænget rejsetid: 10-30 min., Grundet uheld\n\nForventes at vare indtil 24. nov. 2026 kl. 17:45.\n\n\n<small>FeatureID: f2aa2cff-fa77-4fef-92fd-1b330eefdf83_317340.1</small>\n\n<a href="https://www.google.com/maps/search/?api=1&amp;query=56.2511,10.0923">Se på Google Maps</a>' },
  trafikUheld: { app: 'Trafik Server', title: 'Trafikmelding', message: '<b>Uheld</b>\nE45 Nordjyske Motorvej fra Aarhus mod Randers mellem &lt;46&gt; Aarhus Nord og &lt;44&gt; Hadsten\n\nUheld, Spor blokeret, Uheldsstedet er ikke sikret\n\nI venstre spor,\nPoliti og redning er på vej' },
  pfUheld: { app: 'PF-Upload', title: 'Trafikmelding', message: '🚙 Uheld\nE45 Nordjyske Motorvej fra Aarhus mod Randers mellem [46] Aarhus Nord og [44] Hadsten\nUheld, Spor blokeret, Uheldsstedet er ikke sikret\nI venstre spor,\nPoliti og redning er på vej\n\nNordjyske Motorvej, 8380 Spørring, Aarhus Kommune\n24-11-2026 16:22:00\n\nSe placeringen her: https://112meldinger.dk/map.php?uid=abc' },
  pfDyr: { app: 'PF-Upload', title: 'Trafikmelding', message: '🚙 Levende dyr på vejen\nE45 fra Horsens mod Vejle mellem Horsens C og [57] Horsens S\nLevende dyr på vejen\nSvane i græsrabat.\nForventes at vare indtil 24. nov. 2026 kl. 16:15.\n\nØstjyske Motorvej, 8700 Hatting, Horsens Kommune\n24-11-2026 15:35:00\n\nSe placeringen her: https://112meldinger.dk/map.php?uid=oZS7s7k' },
  kolding: { titel: 'BMFM - Min. forurening-Mindre spild', adresse: 'Kolding', cirka: true, kategori: 'Miljø' },
  hørning: { titel: 'Naturbrand-Mindre brand', adresse: 'Østjyske Motorvej, 8362 Hørning', cirka: true, kategori: 'Brand' },
  akut: { titel: 'UDKALD TIL AKUTHJÆLPER', adresse: 'Fredericia', kategori: 'Redning' },
  give: { titel: 'Assistance VB MR-6 ABA', adresse: 'Danpo Tykhøjetvej 44, 7323 Give', cirka: false },
  heli: { titel: 'Lægehelikopter landet – Odder', adresse: 'Aakjærvej, 8300 Odder', kategori: 'Redning', lat: 55.908027, cirka: false, ignorer: false },
  heliAUH: { ignorer: true },
  vand: { titel: 'Akut vandafbrydelse – Silkeborg', adresse: 'Remstrupvej, 8600 Silkeborg', kategori: 'Forsyning', ignorer: false },
  varme: { adresse: 'Vibevej, 8240 Risskov', kategori: 'Forsyning' },
  viborg: { adresse: 'Stadion Allé, Viborg', kategori: 'Politi' },
  strøm: { kategori: 'Forsyning', ignorer: true },
  efterlyst: { titel: 'Efterlysning – Randers NØ', adresse: 'Falkevej, 8930 Randers NØ', kategori: 'Politi' },
  fundet: { opfoelgning: true },
  politiRandersvej: { titel: 'Færdselsuheld på Randersvej ved Djurslandsmotorvejen', adresse: 'Randersvej', kategori: 'Trafik' },
  breakingTv2: { titel: 'En person er omkommet i trafikulykke - alt er spærret', adresse: 'Randersvej, Aarhus', kategori: 'Trafik' },
  heliSkads: { titel: 'Lægehelikopter landet – Skads', adresse: 'Smørpøt Engvej, 6731 Skads', lat: 55.505909 },
  flyVojens: { titel: 'Fly - standby 1/sikkerhedslanding', adresse: 'Vojens', kategori: 'Redning' },
  tvSyd: { titel: 'Giver lang kø: Motorvejsfrakørsel spærret efter uheld', adresse: 'Kolding', kategori: 'Trafik' },
  tvMidtvest: { titel: 'Vej spærret efter uheld', adresse: 'Viborgvej, Aalestrup', kategori: 'Trafik' },
  pfE45: { app: 'PF-Upload', title: 'Trafikmelding', message: '🚙 Uheld på E45 i nordgående retning mellem Århus og Randers\n\nSe placering her: https://112meldinger.dk/map.php?uid=NKtJaLs' },
  kolding: { app: 'Mast', title: '🚒 Kolding', message: '🔥 BMFM - (ISL SYD + KO MR-1 + KO V-1) Min. forurening-Mindre spild, #1536906\nBeredskab: TrekantBrand\nStation: Kolding\n24-11-2026 11:53' },
  hørning: { app: 'Mast', title: '🚒 Hørning', message: '🔥 @6 Naturbrand-Mindre brand ISL SY + HØ-M1 + HØ-V1 + SK-R1 MTV Ø 501 M61 166 8362 Hørning\nBeredskab: Østjyllands Brandvæsen\nStation: Hørning\n24-11-2026 08:26' },
  akut: { app: 'Mast', title: '🚒 Fredericia', message: '🔥 UDKALD TIL AKUTHJÆLPER #1536900\nBeredskab: TrekantBrand\nStation: Fredericia\n24-11-2026 08:29' },
  give: { app: 'Mast', title: '🚒 Assistance - Give', message: '🔥 Assistance: Assistance VB MR-6 /- ABA - (MR-1)\nBeredskab: Vejle Brandvæsen\nStation: Give\nAdresse: Danpo Tykhøjetvej 44, 7323 Give\n24-11-2026 08:07' },
  heli: { app: 'PF-Upload', title: '🚁🛬 Lægehelikopter landet', message: '🚁🛬 Lægehelikopter landet\nLN-OTS (EC45) · DOC03\nSted: Aakjærvej, Odder (8300)\nGoogle Maps: https://maps.google.com/?q=55.908027,10.127163\nFlyvetid: 1152 sek · Distance: 62.91 km' },
  heliAUH: { app: 'PF-Upload', title: '🚁🛬 Lægehelikopter landet', message: '🚁🛬 Lægehelikopter landet\nLN-OTS (EC45) · DOC03\nSted: Aarhus Universitetshospital, Aarhus N (8200)\nGoogle Maps: https://maps.google.com/?q=56.191,10.170' },
  vand: { app: 'PF-Upload', title: '💧 Akut vandafbrydelse – Silkeborg', message: '💧 AKUT VANDAFBRYDELSE\n📮 Postnummer: 8600 Silkeborg\n🔧 Lukning af vandet Remstrupvej tirsdag d. 24. november\nPå grund af et brud på en vandledning er vi nødt til at lukke for vandet på Remstrupvej, Åhave Allé i dag tirsdag d. 24. november. Vi forventer, at vandet er tilbage igen i løbet af 2-3 timer. Vandet kan efterfølgende være let farvet og indeholde luft i en kort periode. Vi beklager de gener, det måtte give.\n🏢 Silkeborg Forsyning\nhttps://www.silkeborgforsyning.dk/driftsinfo' },
  varme: { app: 'PF-Upload', title: 'Varmeafbrydelse - Risskov', message: '🔥 Akut reparation\n\nAkut reparation. Fjernvarmen er afbrudt i dele af forsyningsområdet. Vibevej 24/11 10:15 til 24/11 11:15\n\n📍 8240 Risskov\n▶️ Start: 24/11 kl. 10:15\n⏰ Forventet slut: 24/11 kl. 11:15\n🚨 Akut: \'akut\'\n🏢 Kredsløb' },
  viborg: { app: 'PF-Upload', title: '👮🏼‍♂️ Midt- og Vestjyllands Politi', message: 'En 19-årig mand blev søndag varetægtsfængslet for forsøg på voldtægt begået omkring klokken 7.00 søndag morgen den 22. november 2026 i området ved Stadion Allé i Viborg. Vi søger i den forbindelse vidner, som kan hjælpe med oplysninger om hændelsesforløbet og tiden op til, at voldtægtsforsøget fandt sted. Har du set eller hørt noget, eller har du andre oplysninger, som kan hjælpe os i efterforskningsarbejdet, så ring til os på 114.\n\nLæs mere: https://via.ritzau.dk/pressemeddelelse/15307155/vi-soger-vidner-i-forbindelse-med-voldtaegtsforsog-i-viborg-sondag-morgen?lang=da#sm-15307155' },
  strøm: { app: 'PF-Upload', title: '⚡ Strømafbrydelse – Silkeborg', message: '⚡ STRØMAFBRYDELSE\n📍 By: Silkeborg\n📮 Postnummer: 8600\n🔔 Type: Planlagt\n👥 Berørte kunder: 109\n🔧 Årsag:\nVedligeholdelse af elnettet\n🕒 Start: 24-11-2026 kl. 09:00\n🕓 Forventet slut: 24-11-2026 kl. 13:00\n🏢 Netselskab: Elnetselskabet N1\nhttps://elnet.greenpowerdenmark.dk/#/kort/193943/view' },
  efterlyst: { app: 'PF-Upload', title: '👮🏼‍♂️ Østjyllands Politi', message: 'Østjyllands Politi efterlyser 20-årige Daniel Amin fra Randers, der er gået fra Falkevej i 8930 Randers NØ omkring kl. 2030. Den efterlyste beskrives som mand, 20 år, alm. bygning, kort sort hår, overskæg. Iført vinterhue med refleks og sort jakke. Kontakt Østjyllands Politi på 114 hvis du har set Daniel i løbet af aftenen.\n\nLæs mere: https://via.ritzau.dk/pressemeddelelse/15307670/efterlysning-af-20-arig-mand-i-randers?lang=da#sm-15307670' },
  fundet: { app: 'PF-Upload', title: '👮🏼‍♂️ Østjyllands Politi', message: 'Den unge mand fra Randers er fundet. Vi takker for hjælpen med finde ham. Vi opfordrer alle til slette foto og navn af personen, hvis det er blevet delt.  Mvh Vagtchefen. \n\nLæs mere: https://via.ritzau.dk/pressemeddelelse/15307670/efterlysning-af-20-arig-mand-i-randers?lang=da#sm-15307757' },
  politiRandersvej: { app: 'PF-Upload', title: '👮🏼‍♂️ Østjyllands Politi', message: 'Østjyllands Politi modtog kl. 1857 en anmeldelse om et færdselsuheld på Randersvej ved Djurslandsmotorvejen i nordlig retning. Politi og redningberedskab er til stede og kørebanen er lukket for al færdsel i nordlig retning i flere timer. En person er omkommet i forbindelse med uheldet. Bilinspektør er rekvirreret til stedet, som skal være med til at klarlægge årsagen til ulykken. Vi råder folk til at søge alternative veje. Vi har ikke mere for nuværende.\n\nLæs mere: https://via.ritzau.dk/pressemeddelelse/15307461/faerdselsuheld-randersvej-v-djurslandsmotorvejen?lang=da#sm-15307461' },
  breakingTv2: { app: 'PF-Upload', title: '🚨 Breaking', message: 'TV2Ostjylland.dk: En person er omkommet i trafikulykke - alt er spærret\n\nEn person er omkommet i forbindelse med en trafikulykke på Randersvej ved Djurslandsmotorvejen. Det oplyser Østjyllands Politi, som modtog en anmeldelse klokken 18.57. Ulykken skete i nordlig retning, hvor politi og redningsmandskab lige nu er til stede, mens kørebanen er lukket for al færdsel i nor... https://www.tv2ostjylland.dk/aarhus/en-person-er-omkommet-i-trafikulykke-fd8fc' },
  breakingTv2Kort: { app: 'PF-Upload', title: '🚨 Breaking', message: 'TV2Ostjylland.dk: En person er omkommet i trafikulykke - alt er spærret\n\nEn person er omkommet i forbindelse med en trafikulykke på Randersvej ved Djurslandsmotorvejen. Det oplyser Østjyllands Politi, som modtog en anmeldelse klokken 18.57. Ulykken skete i nordlig retning, hvor politi og redningsmandskab lige nu er til stede, mens kørebanen er lukket for al færdsel i nor...' },
  politiDød: { app: 'PF-Upload', title: '👮🏼‍♂️ Østjyllands Politi', message: 'En 24-årig mand er død som følge af uheldet. De pårørende er underrettet.  Vi er færdige med undersøgelserne på uheldsstedet og trafikken er åbnet op igen.  Vi har ikke mere for nuværende. \n\nLæs mere: https://via.ritzau.dk/pressemeddelelse/15307461/faerdselsuheld-randersvej-v-djurslandsmotorvejen?lang=da#sm-15307566' },
  heliSkads: { app: 'PF-Upload', title: '🚁🛬 Lægehelikopter landet', message: '🚁🛬 Lægehelikopter landet\nOY-HNL (EC45) · SHW19B\nSted: Smørpøt Engvej, Skads (6731)\nGoogle Maps: https://maps.google.com/?q=55.505909,8.58779\nFlyvetid: 225 sek · Distance: 8.03 km' },
  flyVojens: { app: 'PF-Upload', title: '🚒 Vojens', message: '🔥 Fly - standby 1/sikkerhedslanding\nBeredskab: Brand & Redning Sønderjylland\nStation: Vojens\n23-11-2026 15:03' },
  tvSyd: { app: 'PF-Upload', title: '🚨 Breaking', message: 'TVSyd.dk: Giver lang kø: Motorvejsfrakørsel spærret efter uheld\n\nEt uheld giver store trafikale udfordringer på E45 Sønderjyske Motorvej i sydgående retning. Uheldet er sket ved Kolding V, hvor man kan køre fra til Esbjergmotorvejen i vestlig retning. Køen strækker sig her ved 12.30-tiden over flere kilometer. https://www.tvsyd.dk/kolding/giver-lang-ko-motorvejsfrakorsel-spaerret-efter-uheld-dbc2b' },
  tvMidtvest: { app: 'PF-Upload', title: '🚨 Breaking', message: 'TVMidtvest.dk: Vej spærret efter uheld\n\nfor 9 minutter siden Mandag formiddag er der sket et uheld, hvor Hovedvejen bliver til Viborgvej nordøst for Aalestrup. Det skriver Vejdirektoratet på sit trafikkort Vejen er nu spærret. Politi og redningsfolk er på stedet. https://www.tvmidtvest.dk/vesthimmerland/vej-spaerret-efter-uheld-ved-aalestrup-a967e' },
  bus: { app: 'PF-Upload', title: 'Trafikmelding - Midttrafik (Bus)', message: 'Forsinkelser Pga uheld på motorvejen, er der store forsinkelser på busserne i Vejle. Rejsegarantien bortfalder. Lokation: Vejle Trafikcenter\n\nhttps://112meldinger.dk/map.php?uid=BMGJqVb' },
};

const forvent = {
  aba112: { titel: 'ABA12 CI-M1 + CI S1 – automatisk brandalarm', adresse: 'Ny Munkegade 114, 8000 Aarhus C', kategori: 'Brand', cirka: false },
  abaMast: { titel: 'ABA12 CI-M1 + CI-S1 – automatisk brandalarm', adresse: 'Ny Munkegade 114, 8000 Aarhus C', kategori: 'Brand' },
  ass112: { titel: 'Ass.-A-sprøjte og tankvogn OD-M1 + OD V1 – assistance', adresse: 'Byvej 63, 8330 Beder', kategori: 'Brand' },
  aba112b: { titel: 'ABA11 SY-M1 + SY V1 – automatisk brandalarm', adresse: 'Byvej 63, 8330 Beder' },
  assMast: { adresse: 'Byvej 63, 8330 Beder', kategori: 'Brand' },
  viby: { adresse: 'Skovlundgårdsvej 53, 8260 Viby J' },
  skejby: { adresse: 'Palle Juul Jensens Blv 175, 8200 Aarhus N', kategori: 'Brand' },
  vejle: { adresse: 'Lysholt All. 11, 7100 Vejle', kategori: 'Brand', cirka: false },
  vejleSkæv: { adresse: 'Vejle', cirka: true },
  odder: { titel: 'Bygn.brand-Lejlighed – bygningsbrand', adresse: 'Odder', cirka: true, kategori: 'Brand' },
  gmaps: { titel: 'Muligt trafikuheld – Østjyske Motorvej', adresse: 'Østjyske Motorvej, 7100 Vejle', kategori: 'Trafik' },
  trafikKø: { titel: 'Kø – E45', kategori: 'Trafik', lat: 56.2511, cirka: false },
  trafikUheld: { titel: 'Uheld – E45 Nordjyske Motorvej', adresse: 'Aarhus', kategori: 'Trafik', cirka: true },
  pfUheld: { titel: 'Uheld – E45 Nordjyske Motorvej', adresse: 'Nordjyske Motorvej, 8380 Spørring', kategori: 'Trafik', url: 'https://112meldinger.dk/map.php?uid=abc' },
  pfDyr: { titel: 'Levende dyr på vejen', adresse: 'Østjyske Motorvej, 8700 Hatting', kategori: 'Trafik' },
  kolding: { titel: 'BMFM - Min. forurening-Mindre spild', adresse: 'Kolding', cirka: true, kategori: 'Miljø' },
  hørning: { titel: 'Naturbrand-Mindre brand', adresse: 'Østjyske Motorvej, 8362 Hørning', cirka: true, kategori: 'Brand' },
  akut: { titel: 'UDKALD TIL AKUTHJÆLPER', adresse: 'Fredericia', kategori: 'Redning' },
  give: { titel: 'Assistance VB MR-6 ABA', adresse: 'Danpo Tykhøjetvej 44, 7323 Give', cirka: false },
  pfE45: { titel: 'Uheld på E45 i nordgående retning mellem Århus og Randers', adresse: 'Århus', kategori: 'Trafik' },
};

let fejl = 0;
const P = {};
for (const [navn, b] of Object.entries(B)) {
  const p = P[navn] = parseBesked(b);
  for (const [k, v] of Object.entries(forvent[navn] || {})) {
    if (p[k] !== v) { fejl++; console.log(`✗ ${navn}.${k}: fik ${JSON.stringify(p[k])}, ventede ${JSON.stringify(v)}`); }
  }
  console.log(`${p.ignorer ? '⊘' : '·'} ${navn.padEnd(12)} ${p.titel}  |  ${p.adresse}${p.cirka ? ' (cirka)' : ''}  |  ${p.kategori}`);
}
const tjek = (navn, ok) => { if (!ok) { fejl++; console.log('✗ ' + navn); } else console.log('✓ ' + navn); };
const aktiv = (p, min = 1) => ({ ...p, status: 'ny', oprettet: new Date(Date.now() - min * 60e3).toISOString() });
tjek('Radioprøve ignoreres', P.radio.ignorer);
tjek('Busbeskeder ignoreres med kontorets liste "(Bus)"', skalIgnoreres(P.bus, ['(Bus)']));
tjek('Mast lægges sammen med 1-1-2 (samme ABA-kode)', findMatch(P.abaMast, [aktiv(P.aba112)]));
tjek('ABA11 og Ass.-A-sprøjte på Byvej 63 lægges sammen (samme adresse)', findMatch(P.aba112b, [aktiv(P.ass112)]));
tjek('Mast-assistance på Byvej 63 lægges sammen', findMatch(P.assMast, [aktiv(P.ass112)]));
tjek('Vejle-assistance og den skæve Mast-besked lægges sammen', findMatch(P.vejleSkæv, [aktiv({ ...P.vejle, lat: 55.70, lon: 9.53 })]));
tjek('Trafik Server og PF-Upload om samme uheld lægges sammen', findMatch(P.pfUheld, [aktiv(P.trafikUheld)]));
tjek('ABA12 i Aarhus og ABA41 i Viby holdes adskilt', !findMatch(P.viby, [aktiv(P.aba112)]));
tjek('Lægehelikopter lægges ind i uheld 1,5 km væk', findMatch(P.heli, [aktiv({ ...P.trafikUheld, cirka: false, lat: 55.92, lon: 10.14 }), aktiv({ ...P.aba112, lat: 56.171, lon: 10.199 })])?.titel === P.trafikUheld.titel);
tjek('Lægehelikopter 7 km fra en cirka-placering lægges IKKE sammen', !findMatch(P.heli, [aktiv({ ...P.odder, lat: 55.973, lon: 10.153 })]));
tjek('Lægehelikopter langt fra alt bliver sin egen hændelse', !findMatch(P.heli, [aktiv({ ...P.aba112, lat: 56.171, lon: 10.199 })]));
tjek('"Fundet" lægges ind i efterlysningen (samme pressemeddelelse, 3 timer senere)', findMatch(P.fundet, [aktiv(P.efterlyst, 180)]));
tjek('"Fundet" fjerner teksten med navnet og lukker efterlysningen', (() => { const f = flet(aktiv(P.efterlyst), P.fundet, 'PF-Upload'); return f.status === 'afsluttet' && !/Daniel/.test(f.tekst + f.titel); })());
tjek('Efterlysningens titel indeholder ikke navnet', !/Daniel/.test(P.efterlyst.titel));
tjek('Breaking fra TV2 lægges ind i politiets melding om Randersvej (40 min senere)', findMatch(P.breakingTv2, [aktiv(P.politiRandersvej, 40)]));
tjek('Den samme Breaking to gange lægges sammen', findMatch(P.breakingTv2Kort, [aktiv(P.breakingTv2)]));
tjek('Politiets opfølgning (død) lægges ind via pressemeddelelsen', findMatch(P.politiDød, [aktiv(P.politiRandersvej, 120)]));
tjek('Breaking fra Aalestrup og Kolding holdes adskilt', !findMatch(P.tvMidtvest, [aktiv(P.tvSyd)]));
tjek('Samme Breaking-tekst tilføjes ikke to gange', (() => { const f = flet(aktiv(P.breakingTv2), P.breakingTv2Kort, 'PF-Upload'); return f.tekst === P.breakingTv2.tekst; })());
tjek('"Færdselsuheld på Randersvej" og "Færdselsuheld E45" ved Vejle holdes adskilt', !findMatch(P.politiRandersvej, [aktiv({ titel: 'Færdselsuheld E45', tekst: 'Trafikuheld E45 ved Vejle', adresse: 'E45 ved Vejle', kategori: 'Trafik', lat: 55.72, lon: 9.5 })]));
tjek('Politiets "færdige på uheldsstedet" markeres med ✅ (opgaven lukkes ikke)', (() => { const f = flet(aktiv(P.politiRandersvej), P.politiDød, 'PF-Upload'); return /✅/.test(f.tekst) && !f.status; })());
tjek('Breaking-overskriften gentages ikke i opdateringen', (() => { const f = flet(aktiv(P.politiRandersvej), P.breakingTv2, 'PF-Upload'); return (f.tekst.match(/alt er spærret/g) || []).length === 1; })());
tjek('Gammel hændelse (over 45 min) bruges ikke', !findMatch(P.abaMast, [aktiv(P.aba112, 60)]));
const redn = parseBesked({ title: '🔥 Redn.-Silo/Brønd', message: '🔥 Redn.-Silo/Brønd\nBeredskab: Midtjysk Brand & Redning\nStation: Ørum\n24-11-2026 19:41', app: 'Mast' });
tjek('"Redn.-Silo/Brønd" bliver Redning (ikke Brand)', redn.kategori === 'Redning');
const bygn = parseBesked({ title: '🔥 Bygn.brand-Villa', message: '🔥 Bygn.brand-Villa\nBeredskab: Midtjysk Brand & Redning\nStation: Ørum', app: 'Mast' });
tjek('Bygningsbrand med "Brand & Redning" i teksten er stadig Brand', bygn.kategori === 'Brand');
const kortNyt = parseBesked({ app: 'PF-Upload', title: 'TV2Nord.dk', url: 'https://www.tv2nord.dk/kort-nyt/broenderslev/mand-fik-ildebefindende-under-madlavning-vakse-naboer-reddet-ham-ud-af-braendende-hus-72030', message: 'Mand fik ildebefindende under madlavning - vakse naboer reddet ham ud af brændende hus\nLyt til artiklen Stop afspilningen Genoptag afspilning En nordjysk mand i fik et ildebefindende under madlavningen tirsdag aften.' });
console.log('  kort nyt:', kortNyt.titel, '|', kortNyt.adresse, '|', kortNyt.kategori);
tjek('TV2 "kort nyt": titlen er overskriften, ikke "TV2Nord.dk"', /^Mand fik ildebefindende/.test(kortNyt.titel));
tjek('TV2 "kort nyt": byen tages fra linket (Brønderslev)', kortNyt.adresse === 'Brønderslev' && kortNyt.cirka);
tjek('Afspillerens knaptekst fjernes', !/Lyt til artiklen/.test(kortNyt.tekst));
const isl = m => parseBesked({ app: 'PF-Upload', title: '🚒 ' + m, message: `🔥 ISL-Forespørgsel\nBeredskab: ${m === 'Jægerspris' ? 'Frederiksborg Brand og Redning' : 'Brand & Redning Køge'}\nStation: ${m}\n24-11-2026 22:17` });
tjek('ISL-Forespørgsel fra "Frederiksborg Brand og Redning" er Brand', isl('Jægerspris').kategori === 'Brand');
tjek('ISL-Forespørgsel fra Allerød og St. Lellinge holdes adskilt (forskellig station)', !findMatch(isl('St. Lellinge'), [aktiv({ ...isl('Allerød'), lat: 55.87, lon: 12.36 })]));
tjek('Samme ISL-Forespørgsel fra samme station lægges sammen', !!findMatch(isl('Allerød'), [aktiv({ ...isl('Allerød'), lat: 55.87, lon: 12.36 })]));
const nakskov = parseBesked({ app: 'PF-Upload', title: '👮🏼‍♂️ Midt- og Vestsjællands Politi', message: 'Vi er nu færdige med vores foreløbige undersøgelser i området ved Bredgade i forbindelse med det mistænkelige dødsfald.\nLæs mere: https://via.ritzau.dk/pressemeddelelse/15309885/mistaenkeligt-dodsfald-i-nakskov-vidner-soges?lang=da#sm-15310548' });
tjek('Politiets opfølgning: byen findes i linket (Bredgade, Nakskov)', nakskov.adresse === 'Bredgade, Nakskov');
const sindal = parseBesked({ app: 'PF-Upload', title: '⚡ Strømafbrydelse – Sindal', message: '⚡ STRØMAFBRYDELSE\n📍 By: Sindal\n📮 Postnummer: 9870\n🔔 Type: Planlagt\n👥 Berørte kunder: 131\n🔧 Årsag:\nPå grund af anlægsarbejde er vi nødsaget til at afbryde strømmen onsdag d. 25. november fra kl. 12:00 til 15:00\n\ni Sindal: Baldersvej (14 adr.), Frejasvej (35 adr.)\n🕒 Start: 25-11-2026 kl. 12:00\n🕓 Forventet slut: 25-11-2026 kl. 15:00\n🏢 Netselskab: KONSTANT Net A/S' });
console.log('  planlagt:', sindal.titel, '|', sindal.adresse, '|', sindal.kategori);
tjek('Planlagt strømafbrydelse kommer med (Sindal)', !sindal.ignorer && sindal.kategori === 'Forsyning' && /planlagt/.test(sindal.titel) && /12\.00–15\.00/.test(sindal.titel));
tjek('Planlagt strømafbrydelse placeres i byen (9870 Sindal)', /9870 Sindal/.test(sindal.adresse));
console.log(fejl ? `\n${fejl} fejl` : '\nAlt OK');
process.exit(fejl ? 1 : 0);
