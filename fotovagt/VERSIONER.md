# Fotovagts versioner

Versionsnummeret står i `version.json` og vises i appen (login, Min profil og Kontorets topmenu).
Ændres nummeret, får åbne apps besked om at opdatere.

* **Nyt hovednummer** (fx 11 → 12): kun ved store ændringer og nye funktioner.
* **Små trin** (fx 11.01, 11.02 … 11.10): rettelser og mindre justeringer.

(Supabase tæller selv hver udrulning af en serverfunktion – det tal er ikke Fotovagts version.)

| Version | Indhold |
|---|---|
| 11.05 | Sikkerhed: serverkode skjult på hjemmesiden, Content-Security-Policy, profilbilleder og links renses, push kræver hemmelighed, interne databasefunktioner lukket |
| 11.04 | Profilbilleder: fotografen (eller kontoret) vælger et lille billede, som vises i fotograflisten, kollegalisten, tildeling og på kortet |
| 11.03 | Rettet: assistentens infoboks hang på "Tænker …" (to hjælpefunktioner var faldet ud). Viser nu forventede ressourcer – også uden historik |
| 11.02 | Tabt gods: lav prioritet og ingen tilbud/blink, indtil den udvikler sig |
| 11.01 | ISL-forespørgsel: lav, hæves til normal ved assistance; assistance lægges ind i forespørgslen |
| 11.00 | Stedviden (lærer adresser, vejnavne, stationer) + 🧠 Stedviden på kontoret; eftersyn lægges ind i brand fra seneste døgn |
