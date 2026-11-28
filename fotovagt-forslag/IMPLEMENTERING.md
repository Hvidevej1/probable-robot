# Fotovagt – vejledning til at lægge ændringerne ind

Denne vejledning beskriver, hvordan forslagene i `FORSLAG.md` og demoen i `demo.html` lægges ind i
den rigtige Fotovagt-app (vagt.hrc-fotos.dk). Den kan gives direkte til en udvikler eller til Claude i
en session, der har Fotovagts eget repository.

**Sådan bruges den:** Tag ét trin ad gangen. Hvert trin kan udgives for sig, og hvert har en test til sidst.
Start med trin 1 (sikkerhed). Det er små ændringer med stor effekt. Linjenumrene passer til den
udgave, der lå på vagt.hrc-fotos.dk den 28. november 2026 (`style.css?v=23`, `marken.js?v=29`, `kontor.js?v=30`).

**Gælder for alle trin:**
- Hæv `?v=` på `style.css`, `marken.js` og `kontor.js` i `index.html` og `kontor.html`, når filerne ændres (indtil trin 6 er lavet).
- Test altid i demo-tilstand (`?demo`) på telefon (iPhone-størrelse), iPad og computer, i både lys og mørk tilstand.
- Hold øje med, at SOS, tilbud og push virker som før. Det er de vigtigste funktioner.

| Trin | Indhold | Omfang | Risiko |
|---|---|---|---|
| 1 | Sikkerhed: skjul serverkode, rens profilbilleder, CSP | Lille | Lav |
| 2 | Nye farver og bedre kontrast (CSS-tokens) | Mellem | Lav |
| 3 | Marken: ny top, statusknapper og hændelseskort | Mellem | Mellem |
| 4 | Kontoret: én række i toppen, tomme regioner, prioritet | Mellem | Mellem |
| 5 | Kort: zoom, rækkefølge af nåle, mørk tilstand | Lille | Lav |
| 6 | Teknik: versionering, service worker, timere, forbindelse | Mellem | Mellem |
| 7 | Oprydning i style.css | Stor | Lav (kun CSS) |

---

## Trin 1 – Sikkerhed

### 1a. Serverkoden må ikke udgives
I dag kan alle hente `/supabase/opsaetning.sql`, `/supabase/functions/pushover/index.ts` og `parse.js`.

Opret filen `.vercelignore` i roden af repository:
```
supabase/
*.sql
README.md
```
**Test:** Efter udgivelse skal `https://vagt.hrc-fotos.dk/supabase/opsaetning.sql` give 404. Appen skal virke som før.
(Supabase-funktionerne udgives med Supabase CLI eller dashboard og påvirkes ikke.)

### 1b. Rens profilbilleder, før de sættes ind i HTML
`faelles.js` linje 244 og 251 sætter billedet ind uden escaping. Ret `fotoAf` (linje 239), så kun rigtige billeder går igennem:
```js
// Kun JPEG/PNG/WebP som data-URL. Alt andet ignoreres.
const GYLDIGT_FOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const fotoAf = id => {
  const f = store.state.fotos?.[id];
  return typeof f === 'string' && GYLDIGT_FOTO.test(f) ? f : null;
};
```
Og brug `esc(f)` begge steder, hvor `${f}` står i en `src="…"`.

Tilføj samme regel i databasen (kør i Supabase SQL Editor):
```sql
alter table profilfoto drop constraint if exists profilfoto_gyldigt;
alter table profilfoto add constraint profilfoto_gyldigt
  check (foto ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' and length(foto) < 200000);
```
Tjek først, at eksisterende rækker overholder reglen: `select id from profilfoto where foto !~ '^data:image/(jpeg|png|webp);base64,';`

**Test:** Profilbilleder vises stadig på kontoret og i Marken. Prøv i demo at gemme et "billede" med teksten `x" onerror="alert(1)`. Der må ikke komme en alert.

### 1c. Content-Security-Policy
Tilføj en header i `vercel.json`. Start med `Content-Security-Policy-Report-Only` i en uge, og skift så til `Content-Security-Policy`:
```json
{
  "key": "Content-Security-Policy-Report-Only",
  "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://api.dataforsyningen.dk; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.dataforsyningen.dk https://nominatim.openstreetmap.org; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
}
```
`'unsafe-inline'` for styles er nødvendig, fordi appen bruger `style="--c:…"`. Inline scripts findes ikke i dag, så `script-src 'self'` virker.
Skiftes kortet til Dataforsyningen (trin 5), tilføjes deres fliseadresse i `img-src`.

**Test:** Åbn konsollen i Chrome på både Marken og Kontoret. Der må ikke stå "Refused to …"-fejl, når man logger ind, åbner kort, tager en opgave, sender SOS og slår push til.

---

## Trin 2 – Nye farver og bedre kontrast

Mål: Rød flade kun til SOS. Status vises som tonede chips med mørk tekst. Alle tekst/baggrund-par skal være mindst 4,5:1.

### 2a. Erstat tokens øverst i `style.css` (linje 4–28)
Behold de eksisterende navne, så resten af CSS'en virker, og tilføj de nye. Brug blokken fra `designforslag.html` (`:root` og `@media (prefers-color-scheme: dark)`). Det vigtigste:

```css
:root {
  /* fyld (prik, kant, nål) – som i dag, bortset fra optaget */
  --ledig: #1f9f4c; --optaget: #c2410c; --pause: #ffc21a; --ankommet: #2f80ff; --offline: #8c8c96;
  --ny: #ff7a1a; --taget: #8b5cf6; --sos: #d4001a;
  /* NYT: tonet baggrund og tekst til chips og piller */
  --ledig-bg: #e3f5ea;    --ledig-tekst: #146c34;
  --optaget-bg: #fdebe1;  --optaget-tekst: #9a3412;
  --pause-bg: #fff4cf;    --pause-tekst: #7a5600;
  --ankommet-bg: #e4eeff; --ankommet-tekst: #1d5fd1;
  --offline-bg: #eceef2;  --offline-tekst: #4f5562;
  --ny-bg: #fff0e3;       --ny-tekst: #a64400;
  --taget-bg: #f0ebff;    --taget-tekst: #6233c9;
  /* NYT: tokens der mangler i dag */
  --fare: #b42318; --valgt: #f2c200; --ai: #7c3aed;
  --primaer: #1c1c21; --primaer-tekst: #fff;
}
/* mørk: se designforslag.html for alle værdier */
```

### 2b. Chips og piller bruger de nye tokens
Hjælpeklasser, der sætter tre variabler på én gang (læg dem under "Grundlag"):
```css
.s-ledig    { --c: var(--ledig);    --b: var(--ledig-bg);    --t: var(--ledig-tekst); }
.s-optaget  { --c: var(--optaget);  --b: var(--optaget-bg);  --t: var(--optaget-tekst); }
.s-pause    { --c: var(--pause);    --b: var(--pause-bg);    --t: var(--pause-tekst); }
.s-ankommet { --c: var(--ankommet); --b: var(--ankommet-bg); --t: var(--ankommet-tekst); }
.s-offline  { --c: var(--offline);  --b: var(--offline-bg);  --t: var(--offline-tekst); }
.h-ny       { --c: var(--ny);       --b: var(--ny-bg);       --t: var(--ny-tekst); }
.h-taget    { --c: var(--taget);    --b: var(--taget-bg);    --t: var(--taget-tekst); }
.h-ankommet { --c: var(--ankommet); --b: var(--ankommet-bg); --t: var(--ankommet-tekst); }
```
Ret `.chip` (linje 106) og `.pille` (linje 222):
```css
.chip, .pille { display: inline-flex; align-items: center; gap: 5px; background: var(--b, var(--offline-bg)); color: var(--t, var(--offline-tekst));
  font-size: .74rem; font-weight: 700; padding: 3px 9px; border-radius: 99px; white-space: nowrap; }
.chip::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--c, var(--offline)); }
```
I JS sættes farven i dag med `style="--c:…"` eller `chip.style.setProperty('--c', st.farve)` (fx `marken.js` linje 33, `kontor.js` linje 78).
Skift til en klasse: `chip.className = 'chip s-' + mig.status`. Udvid `STATUS` i `faelles.js` linje 4 med `klasse: 's-ledig'` osv., så der kun er ét sted at rette.

### 2c. Ret de konkrete kontrastfejl
- `.advarsel` (linje 45): `color: var(--pause-tekst);` (i dag gul på hvid, 1,6:1). Bruges i `kontor.js` linje 78 og 131.
- `.tæller` og `.toast.ny` (linje 260 og 417): `background: var(--ny-bg); color: var(--ny-tekst);`. Toasten kan beholde mørk baggrund: `background: var(--ny-tekst); color: #fff;`.
- `.p-ny`, `.p-taget`, `.p-ankommet`, `.p-afsluttet` (linje 223): skift til `.h-*`-klasserne ovenfor.
- Statusknappen "Pause" (linje 246) og `.chip[style*="--pause"]` (linje 415) kan slettes, når chips bruger `--t`.

### 2d. Høj prioritet uden rød flade
`.prio-mærke` og `.h-kort.prio-1` (linje 659–661): brug en lille rund "!" og en rødlig kant i stedet for en rød pille med teksten "🔴 Høj prioritet":
```css
.prio-ikon { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--sos); color: #fff;
  font-size: 11px; font-weight: 900; margin-right: 5px; vertical-align: 1px; }
.h-kort.prio-1 { border-color: color-mix(in srgb, var(--sos) 45%, var(--kant)); }
```
I `marken.js` linje 76: `<span class="prio-ikon" title="Høj prioritet" aria-label="Høj prioritet">!</span>`.

**Test:** Kør Lighthouse → Accessibility på Marken og Kontoret. Der må ikke være "Background and foreground colors do not have a sufficient contrast ratio". Optaget-fotografer og SOS skal tydeligt kunne skelnes på kortet.

---

## Trin 3 – Marken (telefon)

Se `demo.html` → "Marken (telefon)" for det færdige resultat.

### 3a. Ny top med statusknapper som segmentkontrol
`index.html` linje 47–62. Flyt `.status-knapper` ind i `header.top`, så toppen får to rækker:
```html
<header class="top">
  <div class="top-række">
    <div class="brand">…uændret…</div>
    <button id="btn-mig" class="mig-knap">…uændret…</button>
    <button id="btn-sos" class="sos-knap">SOS</button>
  </div>
  <nav class="status-knapper" aria-label="Meld status">
    <button data-status="ledig" class="s-ledig" aria-pressed="false">Ledig</button>
    <button data-status="optaget" class="s-optaget" aria-pressed="false">Optaget</button>
    <button data-status="pause" class="s-pause" aria-pressed="false">Pause</button>
    <button data-status="ankommet" class="s-ankommet" aria-pressed="false">Ankommet</button>
  </nav>
</header>
```
Bemærk: navn/status flyttes til venstre og SOS til højre (i dag står SOS midt i toppen).

CSS (erstatter linje 237–247 og 470–471):
```css
body.marken .top { flex-direction: column; align-items: stretch; gap: 10px; padding-bottom: 12px; }
.top-række { display: flex; align-items: center; gap: 8px; min-width: 0; }
.top-række .sos-knap { margin-left: auto; }
.status-knapper { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; padding: 4px;
  background: rgba(255,255,255,.08); border-radius: 14px; border: 0; }
.status-knapper button { background: none; color: var(--top-dæmpet); border: 0; box-shadow: none; min-height: 40px;
  font-size: .84rem; padding: 0 2px; gap: 6px; flex-direction: row; white-space: nowrap; }
.status-knapper button::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; }
.status-knapper button[aria-pressed="true"] { background: var(--b); color: var(--t); }
.status-knapper button:disabled { opacity: .35; }
@media (max-width: 420px) { .status-knapper button { font-size: .76rem; gap: 4px; } }
```
JS i `marken.js` linje 34–38: skift `classList.toggle('aktiv', …)` til `b.setAttribute('aria-pressed', b.dataset.status === mig.status)`, og fjern `b.style.setProperty('--c', …)` (klassen sætter farven).

### 3b. Hændelseskort med afstand som største tal
`marken.js` funktionen `kort_(h)` (linje 69–86). Ny opbygning:
```js
function kort_(h) {
  const d = afstand(h);
  const tagbar = h.status === 'ny' && !mig.haendelse_id;
  const min = h.taget_af === mig.id;
  const hvem = !tagbar && h.taget_af && !min ? `<span class="hvem">${esc(navn(h.taget_af))} ${h.status === 'ankommet' ? 'er på stedet' : 'er på vej'}</span>`
    : min ? '<span class="hvem">Din opgave</span>' : '';
  return `
    <article class="h-kort h-${h.status} prio-${prioAf(h)}${min ? ' min' : ''}" data-id="${h.id}">
      <span class="kat">${ikonFor(h)}</span>
      <div class="h-tekst">
        <div class="h-hoved">
          <h3>${prioAf(h) === 1 && aktiv(h) ? '<span class="prio-ikon" aria-label="Høj prioritet">!</span>' : ''}${h.eskaleret ? '<span class="stor-mærke">Stor hændelse</span> ' : ''}${esc(h.titel)}</h3>
          <span class="chip h-${h.status}">${H_STATUS_KORT[h.status]}</span>
        </div>
        <p class="adresse">${esc(h.adresse || (h.lat != null ? 'Placeret på kortet' : 'Ingen adresse'))}${h.cirka ? ' (ca.)' : ''}</p>
        ${/* nabo/andet område: uændret */ ''}
      </div>
      <div class="h-bund">
        ${d != null ? `<span class="afstand"><b>${kmTekst(d)}</b><small>${køretid(d)}</small></span>` : ''}
        <span class="lille">· ${siden(h.oprettet)} siden${kommentarerTil(h.id).length ? ` · 💬 ${kommentarerTil(h.id).length}` : ''}</span>
        ${tagbar ? `<button class="tag-knap" data-tag="${h.id}">Tag opgaven</button>` : hvem}
      </div>
    </article>`;
}
```
Nye hjælpere i `faelles.js` (ved siden af `kmTekst`, linje 48):
```js
// Grov køretid: 75 km/t i snit + 3 min til at komme af sted. Kun til at sammenligne opgaver.
export function køretid(d) {
  const m = Math.round(d / 75 * 60 + 3);
  return m < 60 ? `ca. ${m} min` : `ca. ${Math.floor(m / 60)} t${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
}
export const H_STATUS_KORT = { ny: 'Ny', taget: 'Taget', ankommet: 'På stedet', afsluttet: 'Afsluttet', annulleret: 'Annulleret' };
```
CSS (erstatter `.h-kort`-blokken linje 202–225, hvor det er nødvendigt):
```css
.h-kort { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 4px 12px; }
.h-hoved { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.h-bund { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.afstand { display: inline-flex; flex-direction: column; line-height: 1.1; white-space: nowrap; }
.afstand b { font-size: 1.15rem; font-variant-numeric: tabular-nums; }
.afstand small { color: var(--dæmpet); font-size: .74rem; }
.tag-knap { margin-left: auto; min-height: 46px; background: var(--primaer); color: var(--primaer-tekst); white-space: nowrap; }
.hvem { margin-left: auto; font-size: .84rem; font-weight: 600; color: var(--t, var(--dæmpet)); text-align: right; }
```

### 3c. Sortér efter "Nærmest" eller "Nyeste"
`marken.js` `tegnListe()` linje 88–90. I dag: `alle.filter(aktiv).sort(efterPrio)`.
```js
const sortering = pref.get('sort-naer', true) ? 'naer' : 'nyeste';
// Rækkefølge: min opgave, så ledige, så andres. Høj prioritet øverst inden for hver gruppe.
const gruppe = h => h.taget_af === mig.id ? 0 : h.status === 'ny' ? 1 : 2;
const høj = h => prioAf(h) === 1 ? 0 : 1;
const aktive = alle.filter(aktiv).sort((a, b) =>
  gruppe(a) - gruppe(b)
  || høj(a) - høj(b)
  || (sortering === 'naer'
        ? (afstand(a) ?? Infinity) - (afstand(b) ?? Infinity)
        : b.oprettet.localeCompare(a.oprettet)));
```
Øverst i listen en lille vælger (to knapper med `aria-pressed`), der kalder `pref.set('sort-naer', …)` og `tegnListe()`.
Aftal med kontoret, om høj prioritet altid skal stå øverst, også når den er langt væk. Forslaget er ja.

### 3d. Faneblade og tilgængelighed
`index.html` linje 72–75 og 78–79: tilføj `id` og `aria-controls`:
```html
<button role="tab" id="fane-kort" aria-controls="kort" data-fane="kort" aria-selected="true">Kort</button>
<button role="tab" id="fane-liste" aria-controls="liste" data-fane="liste" aria-selected="false">Hændelser …</button>
…
<div id="kort" class="kort" data-panel="kort" role="tabpanel" aria-labelledby="fane-kort"></div>
<div id="liste" class="liste" data-panel="liste" role="tabpanel" aria-labelledby="fane-liste" hidden></div>
```
Stationsknapperne på kortet (🚒 👮 🚑 ☎, `faelles.js` linje 851) har kun `title`. Tilføj `aria-label="Vis brandstationer"` osv.

**Test (Marken):** På en iPhone 13 skal den første hændelse starte mindst 80 px højere oppe end i dag. Statusknapperne skal kunne trykkes med tommelfingeren (min. 40 px). "Ankommet" er grå, når man ikke har en opgave. Sortering huskes efter genindlæsning. SOS virker som før.

---

## Trin 4 – Kontoret

Se `demo.html` → "Kontoret".

### 4a. Toppen på én række med menuen "Værktøjer"
`kontor.html` linje 48–60. I dag står 9 knapper i `.top-knapper`, og under 900 px vises de i `.top-menu`. Gør menuen til standard på alle skærmbredder:
```html
<div class="top-knapper">
  <button id="btn-ny">+ Ny hændelse</button>
  <button id="btn-menu" class="secondary menu-knap" aria-expanded="false" aria-controls="top-menu" aria-haspopup="menu">
    Værktøjer <span class="prikker" id="vaerktoej-prikker" aria-hidden="true"><i></i><i></i><i></i></span>
  </button>
  <div class="top-menu" id="top-menu" role="menu" hidden>
    <button id="btn-auto" role="menuitemcheckbox">Auto-tilbud til nærmeste <small></small></button>
    <button id="btn-push" role="menuitemcheckbox">Push på denne computer <small></small></button>
    <button id="btn-pushover" role="menuitemcheckbox">Pushover <small></small></button>
    <hr>
    <button id="btn-stedviden" role="menuitem">Stedviden</button>
    <button id="btn-rapport" role="menuitem">Indsatsrapport</button>
    <hr>
    <button id="btn-kode" role="menuitem">Skift adgangskode</button>
    <button id="btn-logud" role="menuitem">Log ud</button>
    <span class="app-version" data-version></span>
  </div>
</div>
```
Behold alle `id`'er, så eksisterende `onclick` i `kontor.js` (fx linje 36 og 803) virker uændret.
I `kontor.js` skrives status i `<small>` ("til"/"fra"/"forbundet") og i de tre prikker (grøn = til, grå = fra) de steder, hvor knappernes tekst i dag sættes (`📩 Auto: til`, `🔕 Slå push til`, `po-prik`).
Menuen lukkes ved klik udenfor og ved Escape. Den kan genbruge den eksisterende `menu-åben`-logik.

CSS: slet de tre `@media (max-width: 899px)`-blokke for kontorets top (linje 349–361, 481–484, 599–615) og erstat med én regel, hvor `.top-menu` altid er en dropdown (`position: absolute; right: 0; top: calc(100% + 8px)`).

### 4b. Tomme regioner på én linje
`kontor.js` `tegnFotografer()` linje 67–98. I dag skrives "Ingen fotografer i området endnu." for hver tom region.
```js
const tomme = områder.filter(o => !fotograferI(o).length);
const html = (tomme.length ? `<p class="omraade-tomme">Ingen fotografer i ${tomme.map(o => esc(o.navn)).join(', ')}.</p>` : '')
  + områder.filter(o => fotograferI(o).length).map(o => /* som i dag */).join('');
```
```css
.omraade-tomme { font-size: .84rem; color: var(--dæmpet); background: var(--flade2); border-radius: 8px; padding: 8px 10px; margin: 0 0 6px; }
```

### 4c. Prioritet i én vælger
`kontor.js` linje 136–138 (`.prio-række` med tre knapper). Erstat med:
```js
`<select class="prio-vælg" data-prio="${h.id}" aria-label="Prioritet for ${esc(h.titel)}">
  ${[1, 2, 3].map(p => `<option value="${p}"${prioAf(h) === p ? ' selected' : ''}>Prioritet: ${PRIO[p].navn}</option>`).join('')}
</select>`
```
Den eksisterende klik-handler på `[data-prio]` skal flyttes til et `change`-event og læse `e.target.value` i stedet for `data-p`.
Afslut, Annullér og Ret kan blive som knapper. Hvis kortene stadig fylder for meget, kan de flyttes ind under en "⋯"-knap.

### 4d. Små trykflader
Gør `.ikon-knap`, `.h-knapper button`, `.filter button` og `.popup-knapper button` mindst 44 px høje på touch-skærme:
```css
@media (pointer: coarse) {
  .ikon-knap { width: 44px; min-height: 44px; }
  .h-knapper button, .filter button, .popup-knapper button, .prio-vælg { min-height: 44px; }
}
```

**Test (Kontoret):** Ved 1440 px er toppen én række. Ved 768 px (iPad på højkant) er den højst to rækker, og menuen åbner ud over indholdet. Auto, Push og Pushover kan slås til og fra fra menuen, og prikkerne skifter farve. Prioritet ændres i vælgeren, og Marken opdateres med det samme.

---

## Trin 5 – Kortet

### 5a. Start ved "mig og aktive hændelser"
I Marken kaldes `kort.vis(...)` fra `tegnKort()` (`marken.js` linje 118). Giv den kun egen position + aktive hændelser inden for fx 150 km, så kortet ikke zoomer ud til hele landet:
```js
const nær = store.state.haendelser.filter(h => aktiv(h) && h.lat != null && (afstand(h) ?? 0) < 150);
kort.vis([...(minPos ? [[minPos.lat, minPos.lon]] : []), ...nær.map(h => [h.lat, h.lon])], 13);
```

### 5b. Hændelser over fotografer
Fotografnåle ligger i dag oven på hændelsesnåle. I `markørLag` (`faelles.js` linje 268) kan der gives et `zIndexOffset`. Giv `lav(x)` mulighed for at returnere det:
```js
const { ikon, popup, klik, z = 0 } = lav(x);
if (!mk) { mk = L.marker([x.lat, x.lon], { icon: ikon, zIndexOffset: z }).addTo(lag); … }
else { …; mk.setZIndexOffset(z); }
```
og brug `z: 1000` for hændelser og `z: 2000` for SOS.

### 5c. Mørk tilstand på kortet
Kortfliserne er altid lyse. Enkleste løsning:
```css
@media (prefers-color-scheme: dark) {
  .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(.9) contrast(.9); }
}
```

### 5d. (Valgfrit) Danske kortfliser
Overvej Dataforsyningens Skærmkort i stedet for `tile.openstreetmap.org` (`faelles.js` linje 213). Det er gratis med en token fra dataforsyningen.dk. Se deres dokumentation for den aktuelle WMTS-adresse, og husk at tilføje værten i CSP'ens `img-src` (trin 1c).

**Test:** Marken åbner zoomet ind på området omkring fotografen. En hændelse, der ligger samme sted som en fotograf, kan trykkes på. I mørk tilstand er kortet mørkt.

---

## Trin 6 – Teknik

### 6a. Ens versionering
Modulerne `store.js`, `faelles.js` og `rapport.js` importeres uden `?v`. Med `Cache-Control: no-cache` revaliderer browseren alligevel alle filer, så den simpleste løsning er:
- Fjern `?v=` overalt, og stol på `no-cache` + det eksisterende versionstjek (`tjekVersion`, `faelles.js` linje 578).
- *Eller* indfør et lille byggetrin (esbuild) med hash i filnavne og lang cache. Det er mere arbejde.

### 6b. Service worker: offline-skal
`sw.js` har en tom `fetch`-handler. Enten fjernes linje 4 helt, eller den erstattes med en simpel cache af app-skallen:
```js
const SKAL = 'fotovagt-skal-v1';
const FILER = ['./', 'index.html', 'kontor.html', 'style.css', 'marken.js', 'kontor.js', 'faelles.js', 'store.js', 'rapport.js',
  'config.js', 'logo.svg', 'icon-192.png', 'vendor/leaflet-1.9.4/leaflet.js', 'vendor/leaflet-1.9.4/leaflet.css', 'vendor/supabase-js-2.119.0.js'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(SKAL).then(c => c.addAll(FILER))); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SKAL) await caches.delete(k);
  await self.clients.claim();
})()));
// Netværk først (data og filer skal være friske), cache kun når der ikke er net. Kun egne filer.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
```
Hæv `SKAL`-navnet ved hver udgivelse.

### 6c. Statusændringer i kø uden net
I `store.js` sendes `meld_status` direkte til Supabase. Når kaldet fejler, fordi `navigator.onLine === false`:
1. Gem `{ status, tid }` i `localStorage` (`fotovagt-ko`).
2. Vis en gul bjælke: "Ingen net. Din status sendes, når der er forbindelse." (se `demo.html`).
3. Lyt på `window.addEventListener('online', …)` og send køen. Kun den seneste status skal sendes.

SOS skal **ikke** lægges i kø uden besked. Fejler SOS, skal brugeren straks se "SOS blev ikke sendt – ring 112".

### 6d. Timere kun når der er brug for dem
- `faelles.js` linje 385: sekund-timeren til nedtællinger kører altid. Start den kun, når der findes `[data-udloeber]`, og stop den på `document.hidden`.
- `marken.js` linje 489–491 og `kontor.js` linje 831–832: spring over, når `document.hidden` er sand:
```js
setInterval(() => { if (!document.hidden) tegnListe(); }, 30e3);
```

### 6e. Opdag tabt forbindelse
`store.js` `abonnér()` linje 72–108. Giv `.subscribe()` en callback:
```js
.subscribe(status => {
  state.forbindelse = status === 'SUBSCRIBED' ? 'ok' : (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') ? 'tabt' : state.forbindelse;
  if (status === 'SUBSCRIBED') hentAlt().catch(() => {});   // hent det, man gik glip af
  ændret();
});
window.addEventListener('online', () => { abonnér(); });
```
Vis "Forbindelsen er tabt – prøver igen" i toppen, når `state.forbindelse === 'tabt'`.

### 6f. Skrifttype på eget domæne
Hent Inter (400, 600, 800) som `.woff2` til `vendor/inter/` og erstat Google Fonts-linket i `index.html` og `kontor.html` med:
```css
@font-face { font-family: "Inter"; src: url("vendor/inter/Inter-400.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "Inter"; src: url("vendor/inter/Inter-600.woff2") format("woff2"); font-weight: 600; font-display: swap; }
@font-face { font-family: "Inter"; src: url("vendor/inter/Inter-800.woff2") format("woff2"); font-weight: 800; font-display: swap; }
```
Ret vægte på 650, 700, 750 og 900 i `style.css` til 600 eller 800. Fjern så `fonts.googleapis.com`/`fonts.gstatic.com` fra CSP'en.

### 6g. Test af Pushover-tolkningen
Opret `supabase/functions/pushover/parse_test.js` med rigtige, anonymiserede beskeder fra politi og beredskab og det forventede resultat (titel, adresse, kategori). Kør med `deno test supabase/functions/pushover/`.

**Test (trin 6):** Slå flytilstand til på telefonen med appen åben: Marken viser den gule bjælke, og en statusændring sendes, når nettet kommer igen. Genindlæs uden net: app-skallen åbner. Chrome DevTools → Application → Service Workers viser ingen advarsel om "no-op fetch handler".

---

## Trin 7 – Oprydning i style.css

Gøres til sidst, når de andre trin er på plads, og helst i én samlet ændring uden andre ændringer i samme udgivelse.

1. Del filen op med `@layer`:
   ```css
   @layer tokens, base, komponenter, marken, kontor, sos, hjaelpere;
   ```
2. Saml hver komponent ét sted. Disse står i dag flere gange og skal samles til én regel:
   - `.sos-knap` (linje 367, 452, 491–492)
   - `.login`-baggrund (linje 118–119 og 418)
   - `.status-knapper` (linje 237 og 470–471)
   - `.toast.ny` / `.tæller` (linje 140, 260 og 417)
   - `.pin.prio-1` (linje 665 og 668)
   - Kontorets top under 899 px (linje 349, 481 og 599)
3. Erstat hårdkodede farver med tokens: `#dc2626` → `var(--fare)`, `#7c3aed` → `var(--ai)`, `#16a34a`/`#d97706`/`#2563eb` → nye `--kilde-*`, `#ffd400`/`#f2c200` → `var(--valgt)`, `#fff4d6` (`.demo-mærke`) → `var(--pause-bg)`, `#dfe5ec` (`.kort`) → `var(--flade3)`.
4. Fjern `!important`, hvor `@layer` gør det overflødigt (behold det på `[hidden]` og `prefers-reduced-motion`).
5. `prefers-reduced-motion` (linje 410): giv SOS-boksen en statisk markering, når animationen slås fra:
   ```css
   @media (prefers-reduced-motion: reduce) { .sos-boks { outline: 3px solid #fff; outline-offset: -6px; } }
   ```

**Test:** Tag skærmbilleder af alle sider (Marken, Kontoret, login, SOS, rapport, profil) før og efter i lys og mørk tilstand og ved 390, 768 og 1440 px. De skal se ens ud, bortset fra de ændringer, der er lavet med vilje.

---

## Tjekliste før hver udgivelse
- [ ] `?v=` hævet (eller fjernet, hvis trin 6a er lavet)
- [ ] Log ind og log ud virker på Marken og Kontoret
- [ ] Ny hændelse fra Pushover dukker op på begge sider
- [ ] Tag opgave, Ankommet, Afslut virker
- [ ] SOS: nedtælling, send, fortryd, kvittering på kontoret, push på låst telefon
- [ ] Tilbud til nærmeste (Auto) virker
- [ ] Ingen fejl i browserens konsol
- [ ] Testet på iPhone (installeret på hjemmeskærm), iPad og computer
