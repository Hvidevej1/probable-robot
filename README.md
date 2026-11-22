# Vores medicin

En lille app til at holde styr på medicin: hvad der skal bestilles hos lægen, hvad der er bestilt, hvad der er klar på apoteket, og hvad der er hjemme. Den kan også indlæse håndkøbsprodukter (navn, styrke, pakning og pris) fra en CSV-fil, ved stregkodescanning eller ved at skrive dem ind.

Appen er almindelige websider uden byggetrin. Den kan lægges på Vercel gratis og føjes til hjemmeskærmen på iPhone (Del → "Føj til hjemmeskærm").

## Uden opsætning
Står felterne i `config.js` tomme, gemmes alt kun i browseren på den enhed, man bruger.

## Fælles liste for to personer (Supabase, gratis)
1. Opret en gratis konto på supabase.com og lav et nyt projekt (vælg region i EU, fx Frankfurt).
2. Åbn **SQL Editor**, indsæt indholdet af `supabase/opsaetning.sql`, ret de to e-mailadresser nederst, og tryk **Run**.
3. Under **Authentication → Users** trykker du **Add user** for hver af jer (e-mail + adgangskode, sæt flueben i "Auto confirm").
4. Under **Authentication → Sign In / Providers** slås "Allow new users to sign up" fra.
5. Under **Project Settings → API** kopieres *Project URL* og *anon/publishable key* ind i `config.js`.

Kun e-mailadresserne i tabellen `members` kan se og rette listen. Nøglen i `config.js` er den offentlige nøgle og må gerne ligge i koden. Den hemmelige *service_role*-nøgle må aldrig lægges her.

## CTR-saldo og pris
Under "Mere" skrives hver persons CTR-saldo og udløbsdato (findes på sundhed.dk eller på apoteket). Skriver man prisen uden tilskud på en vare, viser appen jeres egenbetaling. Når en vare med tilskud markeres "Hentet", lægges prisen til saldoen. Tilskudsgrænserne for 2026 står i `ctr.js` og skal tjekkes ved årsskiftet.

## Push-beskeder
Kræver den fælles liste. På iPhone skal appen ligge på hjemmeskærmen.
1. Lav et sæt VAPID-nøgler (Claude kan lave dem). Den offentlige lægges i `config.js`.
2. Læg funktionen `supabase/functions/send-push` op under Edge Functions, slå "Verify JWT" fra, og sæt hemmelighederne `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` og `PUSH_SECRET`.
3. Ret og kør `supabase/push.sql`.

## Påmindelser om medicin
Under "Mere" → "Påmindelser" kan hver bruger lave sine egne påmindelser: "Tag medicin" (fx hver dag kl. 8) og "Fyld doseringsæsken" (fx hver 14. dag). De kommer som push-beskeder på brugerens egne telefoner. Appen viser kun tidspunkter og regner aldrig på doser.
Opsætning: kør `supabase/paamindelser.sql` og læg den nye udgave af `send-push` op.

## Persondata
Der må aldrig lægges medicinlister, sikkerhedskopier eller andre personlige oplysninger i dette repository. Opslag på min.medicin.dk sender kun produktets navn.

## Filer
- `index.html`, `style.css`, `app.js`: selve appen
- `store.js`: gemmer data lokalt eller i Supabase
- `csv.js`: indlæsning af håndkøbsprodukter fra CSV
- `vendor/`: Supabase-klient (2.119.0) og stregkodelæser til iPhone (barcode-detector 3.2.2)
