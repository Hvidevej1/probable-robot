# Fotovagt

**Online:** https://vagt.hrc-fotos.dk (fotografer) · https://vagt.hrc-fotos.dk/kontor.html (kontoret)

Webapp til freelancefotografer: Pushover-alarmer bliver automatisk til hændelser på et kort.
Fotograferne i marken kan tage en hændelse og melde status, og kontoret kan se, hvem der er aktive, og hvem der har taget hvad.

- **Marken** (`index.html`) er til telefonen. Den har kort og liste over hændelser, en "Tag"-knap og statusknapperne **Ledig / Optaget / Pause / Ankommet**. Man kan navigere til stedet, afslutte med en note eller slippe opgaven igen. Fotografen kan vælge at dele sin position.
- **Kontoret** (`kontor.html`) er til skærmen. Den viser alle fotografer med status, opgave og hvornår de sidst er set, plus et kort, alle hændelser og en logbog. Herfra kan man tildele og skifte fotograf, afslutte, annullere, rette adresse eller flytte nålen og oprette hændelser selv. Der er også en "Pushover"-knap til opsætning og testbeskeder.

Alt opdateres live på alle skærme. Kun én fotograf kan tage en hændelse; den, der trykker først, får den.

## Status for opsætningen
Supabase-projektet **Fotovagt** (`uhhfqojbbslfcivykcxx`, Frankfurt) er sat op:
- database og adgangsregler
- Edge Functions `pushover` og `push`
- ure til Pushover-hentning, adresseopslag og offline-markering
- push-nøgler, som serveren selv har lavet

`config.js` peger på projektet. Der mangler:
1. **At lægge appen online på `vagt.hrc-fotos.dk`:** DNS er klar (CNAME `vagt` → `cname.vercel-dns.com` hos Simply).
   Vercel-projektet hedder **fotovagt**: *Root Directory* `fotovagt`, *Production Branch* (Settings → Environments → Production → Branch Tracking) `claude/pushover-photographer-dashboard-cufbbc`, domæne `vagt.hrc-fotos.dk` under *Domains*.
   I Supabase → *Authentication → URL Configuration* sættes *Site URL* til `https://vagt.hrc-fotos.dk`, så "Glemt adgangskode"-mails peger rigtigt.
2. **Brugere:** Opret dem under Supabase → *Authentication → Users → Add user* (e-mail + adgangskode, "Auto confirm"). Gør dig selv til kontor:
   `update profiles set rolle = 'kontor' where id = (select id from auth.users where email = 'din@mail.dk');`
3. **Pushover:** Log ind på kontorsiden → **Pushover** → forbind med jeres Pushover-login. Det kræver Pushover for Desktop-licens.

## Prøv den (demo)
Tilføj `?demo` til adressen (fx `index.html?demo` og `kontor.html?demo`), så kører appen med opdigtede fotografer og hændelser i browseren. Faner i samme browser opdaterer hinanden.

## Skærme
- **Telefon (marken):** faner med Kort og Hændelser.
- **iPad og større (marken):** liste og kort side om side.
- **Kontoret:**
  - Stor skærm: tre kolonner.
  - iPad på langs: kort til højre, fotografer og hændelser til venstre.
  - iPad på højkant: én kolonne.
- Kontor-brugere kan skifte mellem **Marken** og **Kontor** i toppen.

## SOS / alarmknap
- Fotografen trykker **SOS** øverst. Der går 5 sekunders nedtælling (eller "Send nu"), så den ikke sendes ved et uheld.
- Kontoret og fotografer inden for 20 km får push og en **rød boks** med navn, telefon, placering og afstand.
- Alarmen lyder på kontoret, indtil nogen trykker "Set".
- Flere kan trykke **🚗 Jeg kører derhen**. Kontoret ser en tabel med navn, telefon, afstand og placering for dem, der er på vej, og fotografen i nød får push for hver ny, der rykker ud.
- Positionen opdateres løbende, mens alarmen er aktiv. Fotografen stopper med "Jeg er OK", eller kontoret afslutter.
- "Ring 112" står altid fremme. Fotovagt erstatter ikke alarmcentralen.

## Pushover → hændelser automatisk
Fotovagt bruger Pushovers *Open Client API*. Appen bliver en ekstra "enhed" på jeres Pushover-konto, ligesom Pushover på en computer. Telefonerne får stadig alle beskeder som før.
Det kræver en **Pushover for Desktop-licens** på kontoen (engangskøb, ca. 5 $, efter 30 dages prøve).

1. Læg funktionen `supabase/functions/pushover` op under *Edge Functions*, med begge filer `index.ts` og `parse.js`. Med Supabase CLI: `supabase functions deploy pushover --no-verify-jwt`. Slå "Verify JWT" **fra**.
2. Under *Edge Functions → Secrets* sætter du `FOTOVAGT_SECRET` til en lang tilfældig tekst.
3. Ret de to `RET_MIG` i `supabase/pushover-cron.sql`, og kør filen. Så hentes nye beskeder hvert 15. sekund.
4. Log ind på kontorsiden, tryk **Pushover** og forbind med jeres Pushover-login. Adgangskoden gemmes ikke.
5. Kommer der også andre beskeder på kontoen (fx fra hjemmet), kan du skrive navnene på de Pushover-apps, der sender alarmer, i feltet "Kun beskeder fra disse apps".

**Sådan læses beskederne** (`supabase/functions/pushover/parse.js`, eksempler i `parse.test.mjs`):

| Kilde | Format | Bliver til |
|---|---|---|
| 1-1-2 Århus | `ABA12 CI-M1 + CI  S1 Ny Munkegade 114 8000 Aarhus C Aarhus Kommune` | "ABA12 CI-M1 + CI S1 – automatisk brandalarm", Ny Munkegade 114, 8000 Aarhus C |
| Mast | Titel = station. `🔥 ABA12 …`, `Beredskab:`, `Station:`, evt. `Adresse:` | Alarmen fra første linje, adressen fra `Adresse:`. Uden adresse: cirka ved stationen |
| PF-Upload (brand) | Som Mast | Som Mast |
| PF-Upload (trafik) | `🚙 Uheld`, vejstrækning, `Nordjyske Motorvej, 8380 Spørring, …`, link til 112meldinger.dk | "Uheld – E45 Nordjyske Motorvej", præcis placering fra 112meldinger-siden |
| Trafik Server | HTML: `<b>Kø</b>`, vejstrækning, link "Se på Google Maps" | "Kø – E45", placering fra Google Maps-linket |
| PF-Upload (lægehelikopter) | `🚁🛬 Lægehelikopter landet`, `Sted: Aakjærvej, Odder (8300)`, Google Maps-link | "Lægehelikopter landet – Odder", præcis landingsplads. Lander den under 3 km fra en aktiv hændelse, lægges den ind i den. Landing ved hospital springes over |
| PF-Upload (forsyning) | `💧 Akut vandafbrydelse – Silkeborg`, `Postnummer: 8600 Silkeborg`, "…lukke for vandet på Remstrupvej…" | Kategori Forsyning, "Remstrupvej, 8600 Silkeborg" (cirka). Planlagte afbrydelser ("Type: Planlagt") springes over |
| PF-Upload (politi) | `👮 Østjyllands Politi`, pressemeddelelse + "Læs mere: via.ritzau.dk/pressemeddelelse/…" | Titel = første sætning. Efterlysninger hedder "Efterlysning – by", så navnet ikke står i oversigten. En opfølgning med samme pressemeddelelse lægges ind i den første. Ved "personen er fundet" fjernes den oprindelige tekst, og efterlysningen lukkes |
| PF-Upload (Breaking) | `🚨 Breaking`, `TV2Ostjylland.dk: En person er omkommet …`, link til tv2ostjylland.dk/aarhus/… | Overskriften bliver titel. Byen tages fra linket (aarhus → Aarhus), gaden fra teksten: "Randersvej, Aarhus" (cirka). Samme Breaking to gange lægges sammen |
| PF-Upload (fly) | `🚒 Vojens`, `🔥 Fly - standby 1/sikkerhedslanding` | Kategori Redning, cirka ved stationen |
| Google Maps Scanner | `🚨 Muligt trafikuheld detekteret på Google Maps`, `📍 Østjyske Motorvej`, `🏙️ 7100 Vejle` | "Muligt trafikuheld – Østjyske Motorvej", cirka ved Vejle |

- **Placering:** Koordinater fra links (Google Maps, 112meldinger.dk, korte maps.app.goo.gl) bruges først. Derefter slås adressen op på OpenStreetMap. Kendes kun by, station eller vejstrækning, markeres nålen som **cirka** (stiplet kant og "ca.").
- **Samme alarm fra flere kilder bliver til én hændelse,** inden for 45 minutter, når den har
  - samme adresse (fx ABA11 og Ass.-A-sprøjte på Byvej 63),
  - samme kode/titel (fx ABA12 fra både 1-1-2 og Mast), eller
  - ligger under 300 m fra den anden, eller
  - nævner samme gade og samme slags hændelse inden for 3 timer, når den ene mangler husnummer (fx politiets melding om Randersvej og TV2's Breaking om samme ulykke).

  Den ekstra besked lægges ind i hændelsens tekst og logbog og kan forbedre en cirka-placering.
- **Springes over:** Radioprøver altid. Kontoret kan under Pushover tilføje egne ord. Som standard står "(Bus)" der, så busforsinkelser ikke bliver til hændelser.

Kør `node supabase/functions/pushover/parse.test.mjs` for at teste parseren efter ændringer. Rammer den forkert, så send beskeden, så kommer den med i testen.

**Andre kilder:** Funktionen tager også imod `POST {title, message, url}` med headeren `x-fotovagt-secret`, fx fra Zapier eller en mail-regel.

## Push-beskeder til låst telefon
Fotovagt sender selv push-beskeder, også når telefonen er låst:
- **Ny hændelse:** til alle fotografer, der står som **Ledig**. Står man som Pause, Optaget eller Offline, får man ingen.
- **Opgave fra kontoret:** "Du har fået en opgave: …" til den fotograf, kontoret giver opgaven.
- **Live opdatering:** "🔄 Opdatering: …" til den fotograf, der har opgaven, når en ny kilde lægger noget ind (fx politiets opfølgning).

Trykker man på beskeden, åbner Fotovagt direkte på hændelsen.

Opsætning:
1. Læg funktionen `supabase/functions/push` op under *Edge Functions*, og slå "Verify JWT" **fra**. Med Supabase CLI: `supabase functions deploy push --no-verify-jwt`.
2. Under *Edge Functions → Secrets* sætter du:
   - `VAPID_PUBLIC_KEY`: den samme nøgle, som står i `config.js`.
   - `VAPID_PRIVATE_KEY`: den private nøgle (fås af Claude; den står ikke i koden).
   - `FOTOVAGT_URL`: appens adresse, fx `https://vagt.hrc-fotos.dk`.
3. Ret `RET_MIG_PROJEKT` i `supabase/push.sql`, og kør filen.
4. Hver fotograf slår push til på sin telefon. Appen spørger første gang, ellers sker det under profilen. Med knappen "Send en prøve" kan man se, at det virker.

**iPhone:** Push virker kun, når Fotovagt er lagt på hjemmeskærmen (Del → "Føj til hjemmeskærm") og åbnet derfra (iOS 16.4 eller nyere). Appen forklarer det, hvis det mangler.

## Godt at vide
- Fotografer, der ikke har haft appen åben i 2 timer, sættes automatisk til "offline", hvis de ikke har en opgave. Det står i `pushover-cron.sql`.
- På kontorsiden står der "ikke set i …", hvis en fotograf ikke har haft appen åben de sidste 5 minutter.
- Mens appen er åben, bipper og vibrerer den ved nye hændelser og ved opdateringer på ens egen opgave.
- Position deles kun, når fotografen selv slår det til under sin profil.
- Kortet er OpenStreetMap og kræver ingen nøgle.

## Automatiske tilbud til nærmeste fotograf
- **Ny hændelse med præcis placering:** tilbud til den nærmeste **ledige** fotograf med frisk position (højst 30 min gammel) inden for **35 km**. Tilbuddet kommer som push og som en stor blå boks i appen med "Tag den" / "Nej tak" og en nedtælling.
- **Nej tak eller intet svar inden 60 sekunder:** tilbuddet går videre til den næstnærmeste.
- **Ved lige afstand (±2 km):** den, der har ventet længst siden sin sidste opgave, får tilbuddet først.
- **Ikke taget inden for 2 minutter**, eller ingen inden for 35 km: opgaven **blinker på kontoret** med "Ingen svar – tildel manuelt" og en alarmlyd.
- **Ingen automatiske tilbud** for cirka-placeringer, kategorien Forsyning og politiets pressemeddelelser.
- **På kontoret:** "📩 Auto" i toppen slår automatikken til og fra. Hver hændelse viser, hvem den er tilbudt, hvem der har sagt nej, og forslaget "Nærmeste ledige: … – Giv opgaven til …".
- **Indstillinger** står i tabellen `indstillinger`: svartid, blinktid, maks. afstand, positionsalder og kategorier.
- Opsætning: `supabase/tilbud.sql`.

## Kolleger
Fotograferne kan se hinanden:
- **På kortet:** kolleger, der deler position, med deres initialer.
- **Under Hændelser → Kolleger:** navn, status, afstand, aktuel opgave og telefon.

## Videre arbejde
- `PLAN-auto-tildeling.md`: plan for automatisk tildeling. **Trin 1 (forslag) og trin 2 (tilbud) er bygget.** Trin 3 (fuld automatik) er ikke.

## Filer
- `index.html`, `marken.js`: siden til marken
- `kontor.html`, `kontor.js`: siden til kontoret
- `store.js`: data, enten Supabase med live-opdatering eller demo
- `faelles.js`: kort, login og hjælpere. `style.css`: design
- `supabase/opsaetning.sql`: tabeller, adgangsregler og funktionerne tag/meld status/afslut/slip/tildel
- `supabase/push.sql`: push-beskeder (telefoner og hvornår der sendes)
- `supabase/functions/push/`: Edge Function, der sender push-beskeder
- `supabase/tilbud.sql`: automatiske tilbud til nærmeste fotograf
- `supabase/redning-kategori.sql`: redningskoder fra beredskabet (fx "Redn.-Silo/Brønd") får redningsikonet
- `supabase/kommentarer-doegnrapport.sql`: kommentarer på hændelser (interne eller til døgnrapporten), område (by/postnummer) og den offentlige døgnrapport (`doegnrapport()`)
- `supabase/luk-gamle.sql`: hændelser uden opdateringer fra kontor, fotograf eller Pushover i 1,5 time lukkes automatisk (kan genåbnes af kontoret; tiden står i `indstillinger.luk_efter_min`)
- `supabase/pushover-cron.sql`: henter Pushover hvert 15. sekund og sætter gamle fotografer offline
- `supabase/functions/pushover/`: Edge Function og beskedparser
- `vendor/`: Leaflet 1.9.4 (kort) og supabase-js 2.119.0
- `logo.svg`, `hrc-fotos-logo.png`, `icon-*.png`, `favicon.png`, `apple-touch-icon.png`: HRC-Fotos-logoet fra hrc-fotos.dk-temaet. Logoets fire farver (grøn, rød, gul, blå) er også statusfarverne Ledig, Optaget, Pause og Ankommet

© HRC-Fotos.dk

## Kommentarer og tidslinje
Hver hændelse har en tidslinje med den første melding, live opdateringer fra Pushover (politi, nyheder, 112) og kommentarer fra fotografer og kontoret. En kommentar er **intern** som standard. Sæt flueben i "Vis på døgnrapporten", hvis den må ses offentligt (uden navn). Den, der skrev kommentaren, og kontoret kan skifte mellem intern og offentlig eller slette den. Fotografen på opgaven får push, når en anden skriver en kommentar.

## Døgnrapport (hrc-fotos.dk)
`doegn.html` viser døgnets hændelser på kort og i en liste og henter nyt hvert minut. Den kan vises alene (https://vagt.hrc-fotos.dk/doegn.html) eller indlejres på hjemmesiden:

```html
<iframe id="hrc-doegn" src="https://vagt.hrc-fotos.dk/doegn.html?indlejret" title="Døgnrapport – HRC-Fotos" style="width:100%;border:0;min-height:900px"></iframe>
<script>addEventListener('message',function(e){if(e.origin==='https://vagt.hrc-fotos.dk'&&e.data&&e.data.hrcDoegnrapport)document.getElementById('hrc-doegn').style.height=e.data.hoejde+'px'})</script>
```

Rapporten viser kun kategori (eller kontorets egen overskrift), by/område og postnummer, aldrig vej og husnummer, plus en placering afrundet til ca. 1 km og de offentlige kommentarer. Kontoret kan skjule en hændelse fra rapporten under **Ret**. Annullerede hændelser vises ikke.

## Skift adgangskode
Fotografer: **Min profil → Skift adgangskode**. Kontoret: knappen **🔑 Kode** øverst.

## Fotografrapport (kontoret)
Knappen **📄 Rapport** på kontoret samler alle hændelser i en periode under den fotograf, der tog eller fik opgaven: dato, tid, hændelse, sted, hvornår opgaven blev taget, fotografen ankom og opgaven blev afsluttet, tid på opgaven, status og fotografens note/kommentarer. Vælg en fast periode (i dag, denne uge, sidste måned …) eller selv fra/til, og evt. én fotograf. Hent som **PDF** (A4 liggende) eller **CSV**, der åbner i Excel. PDF'en laves i browseren med jsPDF (`vendor/jspdf-2.5.2`).

## Filtrering på døgnrapporten
Tryk på en kategori (fx 🔥 brand) for kun at se den på kort og liste. Flere kan vælges. "I alt" viser alle igen. Filteret står i adressen (`?kat=Brand`), så et link kan deles.

## Sikkerhed og nye brugere (invitationer)
- **Kun inviterede kan oprette en bruger** (`supabase/invitationer.sql`). Kontoret inviterer under **Fotografer → ＋ Inviter** (navn, e-mail, telefon, rolle). Den nye åbner vagt.hrc-fotos.dk, trykker **"Ny bruger? Opret din adgangskode"** og bekræfter via mail. Alle andre e-mails afvises af databasen, også hvis kontoen oprettes i Supabase-dashboardet.
- Adgangsregler (RLS) er slået til på alle tabeller. Uden login kan man ikke læse tabellerne; kun den offentlige `doegnrapport()` (kategori, by, afrundet placering, offentlige kommentarer).
- Funktioner, der ændrer noget, tjekker selv, hvem der kalder (kontor eller brugerens egen profil).
- Hemmeligheder (Pushover-nøgle, push-nøgler, cron-hemmelighed) ligger kun i databasen bag adgangsregler og aldrig i koden. `config.js` indeholder kun den offentlige nøgle.
- Websiden sender sikkerheds-headers (`vercel.json`): appen kan ikke vises inde i andre sider (clickjacking); døgnrapporten må vises på hrc-fotos.dk.
- Anbefalet i Supabase-dashboardet: **Authentication → Providers/Policies → "Leaked password protection"** slås til.

## Stor hændelse (forslag til kontoret og manuel opgradering)
Databasen tæller assistancer (meldinger med "Ass."/"assistance") og forskellige enheder (fx SY-M1, OD V1, SK MR-1, ISL NO, OC = operationschef) på hver hændelse. Er der kaldt assistance **flere end 3 gange og flere end 4 enheder**, får kontoret push og en ⚠️-boks på hændelsen: **"⬆️ Opgradér for fotograferne"** eller **Afvis**. Først når kontoret opgraderer, ser fotograferne "⬆️ Stor hændelse" og får push. Grænserne står i tabellen `indstillinger` (`eskaler_ass`, `eskaler_enheder`, `eskaler_begge`). Se `supabase/eskalering.sql`.

Desuden opgraderes titel og kategori automatisk, når en mere alvorlig melding kommer på samme hændelse (fx eftersyn → bygningsbrand), se `alvor()` i `parse.js` og `supabase/opgradering.sql`.
