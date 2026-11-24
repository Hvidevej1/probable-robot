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

**Sådan læses beskederne** (`supabase/functions/pushover/parse.js`) – tilpasset jeres kilder:

| Kilde | Eksempel | Bliver til |
|---|---|---|
| 1-1-2 Århus | `ABA12 CI-M1 + CI  S1 Ny Munkegade 114 8000 Aarhus C Aarhus Kommune` | "ABA12 CI-M1 + CI S1 – automatisk brandalarm", Ny Munkegade 114, 8000 Aarhus C |
| Mast | `🔥 ABA12 CI-M1 + CI-S1` / `Beredskab: Østjyllands Brandvæsen` | Lægges sammen med 1-1-2-hændelsen |
| PF-Upload | `🔥 Bygn.brand-Lejlighed` / `Beredskab: …` | "Bygn.brand-Lejlighed – bygningsbrand" (lægges sammen med samme alarm fra 1-1-2) |
| Google Maps Scanner | `📍 Østjyske Motorvej` / `🏙️ 7100 Vejle` | Østjyske Motorvej, 7100 Vejle (link med koordinater bruges direkte) |
| Trafik Server | `Kø` / `E45 fra Randers mod Randers mellem <44> …` | Trafik, placeret ved Randers |

- Koordinater i teksten eller i et kortlink (også korte maps.app.goo.gl-links) bruges direkte. Ellers slås adressen op på OpenStreetMap.
- **Samme alarm fra flere kilder bliver til én hændelse.** Det sker, når titel/kode er den samme inden for 45 minutter (og de ikke ligger over 2 km fra hinanden), eller når to beskeder med samme kategori ligger under 300 m fra hinanden. De ekstra beskeder lægges ind i hændelsens tekst og logbog, og mangler den første adresse, bruges den nye.
- Kategorien gættes ud fra 🔥, ABA, Bygn.brand, Kø, E45 osv.

Rammer den forkert på en besked, så send den, så kan parseren rettes til. Med knappen "Send testbesked" under Pushover (med "Næste eksempel") kan I prøve jeres formater uden at vente på en rigtig alarm.

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
