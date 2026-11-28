# Fotovagt – gennemgang og forbedringsforslag

Gennemgået: vagt.hrc-fotos.dk (Marken `index.html` og Kontoret `kontor.html`), `style.css?v=23`,
`marken.js`, `kontor.js`, `faelles.js`, `store.js`, `rapport.js`, `sw.js` og de filer under `supabase/`,
som siden udleverer offentligt. Testet i demo-tilstand (`?demo`) på iPhone-størrelse og 1440 px skærm.
Der er ikke ændret noget i appen. Designforslaget ligger i `designforslag.html` i denne mappe.

Prioritet: **A** = gør det snart, **B** = næste runde, **C** = når der er tid.

---

## 1. CSS

| # | Prio | Fund | Forslag |
|---|---|---|---|
| 1.1 | A | **Kontrast under AA flere steder.** Hvid tekst på `--ny` (#ff7a1a) giver 2,6:1 (pillen "Ny", tælleren, toast). Hvid på `--ledig` 3,4:1, på `--offline` 3,3:1 og på `--ankommet` 3,7:1 i små chips (.7–.75rem). `.advarsel` bruger `--pause` (gul) som tekstfarve på hvid: **1,6:1** ("ikke set i …" på kontoret). | Lav et sæt *tekst*-tokens ved siden af fyldfarverne (`--ny-tekst`, `--ledig-tekst` …) og brug tonede chips med mørk tekst i stedet for mættet fyld med hvid tekst. `.advarsel` skal bruge `--pause-tekst`. Se tokens i designforslaget. |
| 1.2 | A | **Rød betyder fire ting:** SOS, "Optaget", "Høj prioritet" og fejl. På kortet ligner en optaget fotograf og en SOS næsten det samme. | Rød *flade* kun til SOS. "Optaget" får en tonet chip med mørkerød tekst. Høj prioritet får et ikon og en kant i stedet for rød fyld. |
| 1.3 | A | **Filen er bygget ved at lægge nyt nederst.** Samme ting står flere steder og overskrives længere nede: `.sos-knap` (3 gange), `.login`-baggrund (2), `.status-knapper` (2), `.toast.ny` (2), `.pin.prio-1` (2) og kontorets top i `@media (max-width: 899px)` (3 blokke). Det gør det svært at vide, hvilken regel der faktisk gælder. | Saml hver komponent ét sted. Opdel med `@layer tokens, base, komponenter, marken, kontor, hjælpere;` så rækkefølgen er bevidst. Slet de regler, der overskrives. Det fjerner også det meste af behovet for `!important` (ca. 15 i dag). |
| 1.4 | A | **Hårdkodede farver uden om tokens:** `#dc2626`, `#7c3aed`, `#16a34a`, `#d97706`, `#2563eb`, `#b00016`, `#ffd400`, `#f2c200`, `#2b0005`, `#fff4d6`, `#dfe5ec`. `var(--fare, #dc2626)` henviser til et token, der ikke findes. | Flyt alle farver til `:root`. Opret `--fare`, `--ai`, `--valgt`, `--kilde-kontor/-nyhed/-osm` og giv dem også en mørk variant. |
| 1.5 | B | **Mørk tilstand er halvfærdig:** `.demo-mærke`, `.kort`-baggrunden og "valgt"-gul er lyse faste farver. Kortfliserne fra OSM er altid lyse, så kortet bliver en hvid plet i mørk tilstand. `.pause`-chip med hvid tekst er ulæselig. | Tokens for alle flader. Kortet kan dæmpes i mørk tilstand med `filter: invert(1) hue-rotate(180deg) brightness(.9)` på `.leaflet-tile-pane`, eller man kan skifte til et mørkt kortlag (se 3.6). |
| 1.6 | B | **Små trykflader på kontoret og iPad:** `.prio-knap` (ca. 26 px), `.ikon-knap` (32), `.filter`- og `.popup-knapper` (32), `.h-knapper` (34). | Mindst 44 px på `(pointer: coarse)`. Prioritet kan samles i én lille vælger (se designforslaget). |
| 1.7 | B | `html, body { overflow-x: hidden }` og `#app { overflow-x: clip }` skjuler fejl, hvor noget er for bredt, i stedet for at rette dem. | Behold dem som sikkerhedsnet, men find de elementer, der flyder over (typisk lange adresser og knaprækker), og giv dem `min-width: 0` og `overflow-wrap: anywhere`. |
| 1.8 | B | `prefers-reduced-motion` slår *al* animation fra, også SOS-blink og puls på nye hændelser. Det er fint for bevægelse, men SOS skal stadig skille sig ud. | Erstat animationen med en tydelig statisk markering (tyk kant, ikon, "AKTIV SOS"-tekst), når bevægelse er slået fra. |
| 1.9 | C | Seks Inter-vægte hentes fra Google Fonts (400–900). | Hold det til 400/600/800, og **læg skriften på jeres eget domæne** ligesom Leaflet. Det er hurtigere, og så sender I ikke brugernes IP-adresse til Google (der er tysk retspraksis om det under GDPR). |
| 1.10 | C | Klassenavne med æ/ø/å (`.tæller`, `.nøgletal`, `.demo-mærke`). Det virker, men nogle værktøjer (minificering, linters, søgning) har det svært med dem, og ellers er navnene skrevet `oe`/`aa` (`.haendelser`, `.omraade`). | Vælg én skrivemåde. `ae/oe/aa` er den sikre. |
| 1.11 | C | Spacing og størrelser er "løse" tal (9, 10, 11, 12, 13, 14 px …). | En lille skala: `--r-1: 4px … --r-6: 32px`, og en typografiskala (`--fs-xs … --fs-xl`). |

## 2. Design og indhold (UX)

| # | Prio | Fund | Forslag |
|---|---|---|---|
| 2.1 | A | **Marken på telefon:** toppen og statusknapperne fylder ca. 20 % af skærmen, før man ser en hændelse. Venstre side af toppen er tom (kun logo). | Gør statusknapperne til en lavere segmentkontrol (ca. 44 px) og læg dem i toppen eller lige under. Se designforslaget. |
| 2.2 | A | **Afstanden er det vigtigste for fotografen, men den står gemt i grå tekst** ("1 min siden · 85 km · Ledig opgave"). Listen er sorteret efter prioritet og tid, ikke nærhed. | Afstand som tydelig chip ved knappen ("1,4 km · ca. 4 min"). Mulighed for at sortere efter "Nærmest". |
| 2.3 | A | "Ledig opgave" brydes over to linjer på alle kort. | Status som kort pille ("Ledig") øverst til højre, ligesom på kontoret. |
| 2.4 | A | **Kortet på telefonen** starter med hele Danmark og Nordtyskland. Fotografnåle ligger oven på hændelsesnåle (A oven på 🔥), så man ikke kan trykke på hændelsen. | Start med at zoome til "mig + aktive hændelser". Hændelser over fotografer (`zIndexOffset`), og saml nåle tæt på hinanden (Leaflet.markercluster eller en enkel forskydning). |
| 2.5 | B | **Kontorets top har ni knapper på to rækker** med blandede emoji-ikoner. | Én række: logo · nøgletal · "+ Ny hændelse" · "Værktøjer ▾" (Auto, Push, Pushover, Stedviden, Rapport) · profil-menu (Kode, Log ud). Status for Auto/Push/Pushover som små prikker i menuknappen. |
| 2.6 | B | **Panelet "Fotografer" viser fem tomme regioner** ("Ingen fotografer i området endnu" ×5), før de egentlige fotografer kommer. | Skjul tomme regioner, eller saml dem på én linje: "Uden fotografer: Hovedstaden, Midtjylland …". |
| 2.7 | B | **Prioritetsknapperne (Høj/Normal/Lav) står på hvert hændelseskort** og fylder en hel række. | Vis prioritet som en pille i kortets top. Skift prioritet via kortets menu eller en lille `<select>`. |
| 2.8 | B | Emoji som ikoner (🚒 👮 🚑 ☎ 📩 🔔 🧠 📄 🔑) ser forskellige ud på Windows, Mac og iPhone, og nogle har ingen tekst til skærmlæser. | Et lille sæt SVG-ikoner med ens streg (fx Lucide, MIT-licens) som inline-sprite. Kategori-emoji på hændelser kan godt blive, de giver et hurtigt overblik. |
| 2.9 | B | Faneblade "Kort / Hændelser" har `role="tab"` men ingen `aria-controls`/`role="tabpanel"`. Statusknapperne mangler `aria-pressed`. Status vises kun med farve på kortet. | Tilføj ARIA. Giv nåle bogstav/ikon for status (fx ✓ ved ankommet), så de ikke kun skelnes på farve. |
| 2.10 | C | Ordet "Tag" alene på knappen kan læses som et "tag" (mærke). | "Tag opgaven" eller "Jeg tager den". |

## 3. Teknisk opbygning

| # | Prio | Fund | Forslag |
|---|---|---|---|
| 3.1 | A | **Serverkoden ligger offentligt på domænet:** `/supabase/opsaetning.sql`, `/supabase/functions/pushover/index.ts` og `parse.js` kan hentes af alle. Der er ingen nøgler i dem, men de viser hele databasemodellen, alle RPC-funktioner og hvordan Pushover-hemmeligheden tjekkes. | Læg `supabase/` uden for det, der udgives: en `.vercelignore` med `supabase/`, eller flyt webfilerne til fx `public/` og sæt det som output-mappe i Vercel. |
| 3.2 | A | **Profilbillede sættes ind i HTML uden escaping:** `` `<img src="${f}">` `` i `avatar()` og `fotografIkon()` (`faelles.js` linje 244 og 251). `f` kommer fra tabellen `profilfoto`, som brugeren selv skriver i. Kan en bruger gemme en tekst med `"` direkte via API'et, kan den køre script hos kontoret. | `esc(f)`, og tjek at værdien starter med `data:image/jpeg;base64,` (både i JS og som `check`-constraint i databasen). |
| 3.3 | A | **Ingen Content-Security-Policy ud over `frame-ancestors`.** Appen bygger det meste af siden med `innerHTML` (ca. 40 steder). Det er escapet pænt med `esc()`, men én glemt variabel (som 3.2) er nok. | Tilføj i Vercel: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.dataforsyningen.dk https://nominatim.openstreetmap.org`. Afprøv med `Content-Security-Policy-Report-Only` først. |
| 3.4 | B | **Blandet versionering:** `style.css?v=23`, `marken.js?v=29`, `kontor.js?v=30`, men modulerne `store.js`, `faelles.js` og `rapport.js` hentes uden `?v`. Med `Cache-Control: no-cache` spørger browseren alligevel serveren hver gang, så `?v` gør ingenting. Til gengæld kan en telefon i et kort øjeblik få ny `marken.js` og gammel `faelles.js`. | Enten et lille byggetrin (esbuild/Vite) med hash i filnavne og lang cache, eller drop `?v` helt og stol på `no-cache` + versionstjekket, som allerede findes. |
| 3.5 | B | **Service worker har en tom `fetch`-handler.** Det giver ingen gevinst. Chrome advarer om "no-op fetch handler", og den gør navigation en anelse langsommere. Samtidig er fotografer i marken tit et sted med dårlig dækning. | Fjern handleren, *eller* gør den nyttig: cache app-skallen (HTML/CSS/JS/ikoner), så appen åbner uden net, og læg statusændringer i kø (IndexedDB), så de sendes, når nettet er tilbage. Vis "Offline – sendes når der er net". |
| 3.6 | B | **Kortfliser direkte fra tile.openstreetmap.org og opslag i Nominatim.** OSM's regler for brug af fliser og Nominatim (højst 1 opslag/sekund, ingen tung brug) passer dårligt til en arbejdsapp med polling hvert 15. sekund. | Brug Dataforsyningens *Skærmkort* (gratis, danske, har en dæmpet/mørk variant) til kortet og Dataforsyningens adresse-API til geokodning. Det sidste bruges allerede til omvendt opslag. Behold Nominatim som reserve. |
| 3.7 | B | **Store filer uden opdeling:** `faelles.js` (63 KB) blander konstanter, SOS, kort, tidslinje, beredskabs- og politidata, profilbilleder og "indsigt". `kontor.js` 57 KB, `style.css` 55 KB. | Del `faelles.js` op i moduler: `kort.js`, `sos.js`, `tidslinje.js`, `beredskab.js` (data som JSON), `ui.js`. Det kræver ikke et byggetrin, når der bruges ES-moduler. |
| 3.8 | B | **Timere kører, også når der ikke er brug for dem:** en `setInterval` hvert sekund i `faelles.js` (nedtællinger), en hvert sekund i `marken.js` (tilbud), plus 30 s/60 s gentegning, også når appen ligger i baggrunden. Det koster strøm på telefonen. | Pause timere på `visibilitychange`, og start kun sekund-timeren, når der faktisk er en nedtælling på skærmen. |
| 3.9 | B | **Realtime abonnerer på alle rækker i otte tabeller.** Hvis forbindelsen falder (tunnel, elevator), opdager appen det ikke selv. Den henter kun igen, når man skifter fane. | Lyt efter kanalens status (`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`), vis "Forbindelse tabt", og hent alt igen ved genforbindelse og på `online`-hændelsen. |
| 3.10 | C | **Ingen automatiske test.** `parse.js` (37 KB, tolker Pushover-beskeder til adresser og kategorier) er den del, der oftest går i stykker, når politiets eller beredskabets tekster ændrer sig. | En mappe med rigtige (anonymiserede) beskeder og forventet resultat, kørt med `deno test`. Også en lille test af `km()`, `nedtælling()` og prioritetssortering. |
| 3.11 | C | Funktions- og variabelnavne med æøå (`prøv`, `åbnSkiftKode`, `tæller`, `sosSet`/`sosSidst`). Det virker i moderne browsere, men det er uensartet. | Samme valg som 1.10. |
| 3.12 | C | `?demo` virker på produktionsdomænet. Det er fint og praktisk, men demoen bruger de rigtige `kontor.html`/`index.html`-sider. | Overvej `demo.vagt.hrc-fotos.dk` eller en tydelig gul ramme om hele siden i demo, så ingen tror, de ser rigtige data. |

## 4. Det, der allerede er godt

- Gennemført escaping med `esc()` i næsten al HTML-skabelon. RLS og `security definer`-funktioner for alle skrivninger.
- Gode sikkerhedsheadere (HSTS, X-Frame-Options, Permissions-Policy med geolocation kun for egen side).
- SOS med 5 sekunders fortryd, `requireInteraction` og lang vibration, og et tydeligt link til 112.
- Felter er 16 px på touch, så iPhone ikke zoomer. Safe-area håndteres. Layoutet til iPad (liste og kort side om side) virker.
- Versionstjek med "ny version"-knap. Demo-tilstand gør det let at vise og teste appen.
