# Fotovagt

Webapp til freelancefotografer: Pushover-alarmer bliver automatisk til hændelser på et kort.
Fotograferne i marken kan tage en hændelse og melde status, og kontoret kan se, hvem der er aktive, og hvem der har taget hvad.

- **Marken** (`index.html`) er til telefonen. Den har kort og liste over hændelser, en "Tag"-knap og statusknapperne **Ledig / Optaget / Pause / Ankommet**. Man kan navigere til stedet, afslutte med en note eller slippe opgaven igen. Fotografen kan vælge at dele sin position.
- **Kontoret** (`kontor.html`) er til skærmen. Den viser alle fotografer med status, opgave og hvornår de sidst er set, plus et kort, alle hændelser og en logbog. Herfra kan man tildele og skifte fotograf, afslutte, annullere, rette adresse eller flytte nålen og oprette hændelser selv. Der er også en "Pushover"-knap til opsætning og testbeskeder.

Alt opdateres live på alle skærme. Kun én fotograf kan tage en hændelse; den, der trykker først, får den.

## Prøv den nu (demo)
Står felterne i `config.js` tomme, kører appen som demo med opdigtede fotografer og hændelser, og alt gemmes kun i browseren.
Åbn `index.html` (marken) og `kontor.html` (kontoret) i hver sin fane i samme browser, så kan du se dem opdatere hinanden.

## Opsætning (gratis: Supabase + Vercel)
1. **Supabase:** Opret et *nyt* projekt på supabase.com (region EU, fx Frankfurt). Brug ikke medicin-projektet.
2. **SQL Editor:** Indsæt og kør `supabase/opsaetning.sql`.
3. **Brugere:** Under *Authentication → Users → Add user* opretter du hver fotograf og dig selv (e-mail + adgangskode, "Auto confirm"). Slå "Allow new users to sign up" fra under *Sign In / Providers*.
4. **Gør dig selv til kontor:** Kør linjen nederst i `opsaetning.sql` med din e-mail. Andre kan bagefter gøres til kontor fra kontorsiden (✎ ved fotografen).
5. **config.js:** Kopiér *Project URL* og *anon/publishable key* (Project Settings → API) ind.
6. **Vercel:** Importér repoet som et nyt projekt og sæt *Root Directory* til `fotovagt`. Giv det evt. en adresse som `vagt.hrc-fotos.dk`.

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

## Godt at vide
- Fotografer, der ikke har haft appen åben i 2 timer, sættes automatisk til "offline", hvis de ikke har en opgave. Det står i `pushover-cron.sql`.
- På kontorsiden står der "ikke set i …", hvis en fotograf ikke har haft appen åben de sidste 5 minutter.
- Mens appen er åben, bipper og vibrerer den ved nye hændelser. Pushover står stadig for beskederne, når telefonen er låst.
- Position deles kun, når fotografen selv slår det til under sin profil.
- Kortet er OpenStreetMap og kræver ingen nøgle.

## Filer
- `index.html`, `marken.js`: siden til marken
- `kontor.html`, `kontor.js`: siden til kontoret
- `store.js`: data, enten Supabase med live-opdatering eller demo
- `faelles.js`: kort, login og hjælpere. `style.css`: design
- `supabase/opsaetning.sql`: tabeller, adgangsregler og funktionerne tag/meld status/afslut/slip/tildel
- `supabase/pushover-cron.sql`: henter Pushover hvert 15. sekund og sætter gamle fotografer offline
- `supabase/functions/pushover/`: Edge Function og beskedparser
- `vendor/`: Leaflet 1.9.4 (kort) og supabase-js 2.119.0
