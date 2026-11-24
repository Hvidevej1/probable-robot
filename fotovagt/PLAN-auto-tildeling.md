# Plan: Automatisk tildeling til nærmeste fotograf

**Status:** Kun plan. Intet er bygget endnu.

## Kort svar
Ja, det kan lade sig gøre. Fotovagt kender allerede det, der skal til:
- hvor hændelsen er
- hvor hver fotograf sidst var (når de deler position)
- hvem der er **Ledig**

Det svære er ikke at regne afstanden ud. Det svære er at sikre, at den rigtige får opgaven, og at ingen bliver sendt ud på et forkert grundlag. Derfor anbefales en trinvis løsning, hvor kontoret beholder kontrollen i starten.

## Anbefalet løsning: "Forslag → tilbud → automatik"

### Trin 1 – Forslag (lille opgave, ingen risiko)
- Hver ny hændelse får et forslag på kontoret: "Nærmeste ledige: Anna, 4,8 km (position 2 min gammel)".
- Kontoret giver opgaven med ét klik. Knappen **Tildel** findes allerede, og listen er allerede sorteret efter afstand.
- Rækkefølgen bygger på kørselsafstand i luftlinje. Er positionen over 30 minutter gammel, vises den som usikker.

### Trin 2 – Tilbud til nærmeste (fotografen siger ja/nej)
- Fotovagt sender push til den nærmeste ledige: "Opgave 4,8 km væk: Brand i etageejendom. **Tag den** / **Nej tak**".
- Svarer fotografen ikke inden for fx **90 sekunder**, eller trykker "Nej tak", går tilbuddet videre til den næstnærmeste. Det fortsætter, til 3 fotografer har fået tilbuddet.
- Tager ingen den, står den som "Ny" som i dag, og kontoret får besked.
- Fordel: Ingen får en opgave, de ikke har sagt ja til, fx fordi de sidder midt i noget andet.

### Trin 3 – Fuld automatik (valgfrit, pr. kategori)
- Kontoret kan slå "Tildel automatisk" til, fx kun for Brand og Trafik, eller kun om natten.
- Den nærmeste ledige får opgaven direkte med push "Du har fået en opgave". Fotografen kan stadig trykke **Slip**.

## Regler, der skal besluttes sammen
| Spørgsmål | Forslag |
|---|---|
| Hvem tæller med? | Kun status **Ledig** og app åben inden for 10 min |
| Maks. afstand | 40 km (ellers kun kontoret) |
| Gammel position | Over 30 min = ikke med i automatik, kun i forslag |
| Cirka-placering (kun by/station) | Kun forslag, aldrig automatik |
| Svartid ved tilbud | 90 sekunder |
| Antal forsøg | 3 fotografer, derefter kontoret |
| Fordeling | Ved lige afstand (±2 km): den, der har ventet længst siden sidste opgave |
| Hvilke kategorier | Kontoret vælger. Forsyning og Politi-pressemeddelelser er fra som standard |

## Teknisk skitse (til senere)
- **Database:** Ny tabel `tilbud` (haendelse, fotograf, sendt, svar, udløber). Ny indstilling `auto_tildeling` (fra / forslag / tilbud / automatik + kategorier).
- **Afstand:** I starten luftlinje, som i dag. Senere kan rigtig køretid fra en ruteservice (fx OSRM) give en bedre rækkefølge. Den kan kaldes fra databasen ligesom adresseopslaget.
- **Forløb:** Når en ny hændelse har fået sin placering, vælger en funktion kandidater og sender push med knapperne "Tag den" og "Nej tak". Push-handlinger virker på Android og desktop. På iPhone åbner et tryk appen på tilbuddet. Et ur hvert 15. sekund flytter udløbne tilbud videre.
- **Sikkerhed:** Kun én kan få opgaven. Det sikrer `tag_haendelse` allerede. Alt skrives i logbogen ("Tilbudt Anna 4,8 km – afvist", "Tilbudt Mads – tog den").

## Hvad det kræver af fotograferne
- Positionsdeling skal være slået til, ellers kan de ikke komme i betragtning. Det kan gøres valgfrit pr. fotograf.
- Status skal holdes ajour (Ledig/Pause). Det gør ordningen fair.

## Forslag til rækkefølge
1. Trin 1 (forslag) – kan bygges hurtigt og giver erfaring.
2. Se i nogle uger, hvor ofte forslaget er det, kontoret alligevel vælger.
3. Trin 2 (tilbud), hvis det passer.
4. Trin 3 kun for de kategorier, hvor det giver mening.
