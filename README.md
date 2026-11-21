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

## Persondata
Der må aldrig lægges medicinlister, sikkerhedskopier eller andre personlige oplysninger i dette repository. Opslag på min.medicin.dk sender kun produktets navn.

## Filer
- `index.html`, `style.css`, `app.js`: selve appen
- `store.js`: gemmer data lokalt eller i Supabase
- `csv.js`: indlæsning af håndkøbsprodukter fra CSV
- `vendor/`: Supabase-klient (2.119.0) og stregkodelæser til iPhone (barcode-detector 3.2.2)
