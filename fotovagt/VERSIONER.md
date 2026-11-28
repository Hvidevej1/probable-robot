# Fotovagts versioner

Versionsnummeret står i `version.json` og vises i appen (login, Min profil og Kontorets topmenu).
Ændres nummeret, får åbne apps besked om at opdatere.

* **Nyt hovednummer** (fx 11 → 12): kun ved store ændringer og nye funktioner.
* **Små trin** (fx 11.01, 11.02 … 11.10): rettelser og mindre justeringer.

(Supabase tæller selv hver udrulning af en serverfunktion – det tal er ikke Fotovagts version.)

| Version | Indhold |
|---|---|
| 15.20 | Nyheds-dashboard på kontoret (📰 Nyheder): 112-nyheder fra DR, de otte TV 2-regioner og Ritzau hentes hvert 5. minut, sport/politik/retssager/udland sorteres fra, og nyheder kobles automatisk til den rigtige hændelse (by, vej, gade, slags, tid). Kontoret kan koble og fjerne i hånden med forslag (★). Koblede nyheder vises på hændelsen og i døgnrapporten. |
| 15.11 | Risikovurdering for kontor og fotograf: vejr og vind på alle hændelseskort, risikoniveau, hvordan hændelsen kan udvikle sig (brand, landbrug, naturbrand, bilbrand, flysikkerhedslanding/standby, højderedning, frigørelse, vand, farlige stoffer) og sikkerhedsråd (fx stå vindop for røgen). Kontoret kan lægge hændelser sammen med en knap, får forslag om sammenlægning, og Fotovagt husker sammenlægninger og "ikke samme". Udkald til akuthjælper oprettes ikke længere. |
| 15.10 | Nye funktioner: vejret på stedet for hver hændelse (met.no) med assistentens fareadvarsel (fx hård vind ved brand, glat føre ved uheld, tåge) og forslag om højere/lavere prioritet; nyhedslinks samles på hændelsen og vises på kontoret, i Marken og i døgnrapporten; akutlægehelikopterne (DOC02–05) live på kortet (adsb.lol); "Kører ud fra" accepterer kun rigtige adresser (forslag fra adresseregister); døgnrapporten er bredere og viser vejr og nyheder; daglige døgnrapport-sider på hrc-fotos.dk (aktiveres med WordPress-adgang); AdSense-pladser klar (aktiveres med publisher-id); bilbrand fra flere brandvæsener + trafikmelding lægges sammen; rettet: "Brug forslaget"-knappen i assistenten |
| 15.00 | Nyt design fra forslagsmappen: nye farver med god kontrast (rød flade kun til SOS), Marken med status som segmentkontrol i toppen, hændelseskort med afstand og køretid, sortering Nærmest/Nyeste, kortet starter ved mig og hændelser i nærheden, hændelser ligger over fotografer, mørkt kort i mørk tilstand. Kontoret: én række i toppen med menuen "Værktøjer" (prikker for Auto/Push/Pushover), tomme regioner på én linje, prioritet i én vælger, større trykflader. Teknik: afviser kendte lækkede adgangskoder (HaveIBeenPwned), skrifttypen ligger på eget domæne (ingen Google Fonts), bjælke ved tabt forbindelse og automatisk genforbindelse, timere hviler når appen ligger i baggrunden, tom service worker-handler fjernet, ens versionering uden `?v=`. Tilbagerulning: Vercel → Deployments → udgaven med 11.06 → Instant Rollback |
| 11.06 | Togmeldinger: læsbar overskrift, 🚆, lav og uden tilbud/blink medmindre alvorlig (påkørsel, ulykke, brand, politi …); assistenten forklarer hvad der sker |
| 11.05 | Sikkerhed: serverkode skjult på hjemmesiden, Content-Security-Policy, profilbilleder og links renses, push kræver hemmelighed, interne databasefunktioner lukket |
| 11.04 | Profilbilleder: fotografen (eller kontoret) vælger et lille billede, som vises i fotograflisten, kollegalisten, tildeling og på kortet |
| 11.03 | Rettet: assistentens infoboks hang på "Tænker …" (to hjælpefunktioner var faldet ud). Viser nu forventede ressourcer – også uden historik |
| 11.02 | Tabt gods: lav prioritet og ingen tilbud/blink, indtil den udvikler sig |
| 11.01 | ISL-forespørgsel: lav, hæves til normal ved assistance; assistance lægges ind i forespørgslen |
| 11.00 | Stedviden (lærer adresser, vejnavne, stationer) + 🧠 Stedviden på kontoret; eftersyn lægges ind i brand fra seneste døgn |
