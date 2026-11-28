// Marken: fotografens telefon. Kort og liste over hændelser, tag en hændelse, meld status.
import { store } from './store.js';
import {
  STATUS, H_STATUS, H_STATUS_KORT, køretid, KATEGORI_IKON, ikonFor, aktiv, senesteOpdatering, esc, $, siden, klokken, km, kmTekst, navigationsLink,
  toast, prøv, bip, lavKort, haendelsesIkon, fotografIkon, markørLag, logInd,
  pushKanBruges, abonnérPush, afmeldPush, SOS_RADIUS_KM, aktiveSos, sosBoks, sosIkon, alarm, påVejTekst, nedtælling, set,
  tidslinjeHtml, gentegnMedFormular, kommentarHandlinger, kommentarerTil, senesteNyt, åbnSkiftKode,
  PRIO, prioAf, efterPrio, indsigt, indsigtHtml,
  stationsKontrol, avatar, fotoFelt, sikkerUrl, nyhederHtml, helikopterLag, vejrRisikoLinje, sikkerhedHtml,
} from './faelles.js';

const pref = {
  get(k, std) { try { const v = localStorage.getItem('fotovagt-' + k); return v == null ? std : v === '1'; } catch { return std; } },
  set(k, v) { try { localStorage.setItem('fotovagt-' + k, v ? '1' : '0'); } catch { /* ok */ } },
};
let sLag, sosWatch = null, sosSidst = 0;
const sosSet = new Set();   // alarmer, jeg har trykket "Set" på (stopper lyden)
let mig, kort, hLag, fLag, minPos = null, posWatch = null, førsteZoom = true, åbenId = null;

const navn = id => store.state.profiler.find(p => p.id === id)?.navn || 'en anden';
const minOpgave = () => store.state.haendelser.find(h => h.id === store.state.mig?.haendelse_id);
const afstand = h => km(minPos || store.state.mig, h);

// ---------------------------------------------------------------------------------
function tegn() {
  mig = store.state.mig;
  if (!mig) return;
  const st = STATUS[mig.status] || STATUS.offline;
  $('#mig-navn').textContent = mig.navn;
  const chip = $('#mig-status'); chip.textContent = st.tekst; chip.className = 'chip ' + st.klasse;
  document.querySelectorAll('.status-knapper button').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.status === mig.status));
    if (b.dataset.status === 'ankommet') b.disabled = !mig.haendelse_id;
  });
  tegnSos(); tegnTilbud(); tegnOpgave(); tegnListe(); tegnKort();
  if (åbenId && $('#dlg-haendelse').open) visHaendelse(åbenId, false);
}

function tegnOpgave() {
  const el = $('#opgave'), h = minOpgave();
  el.hidden = !h;
  if (!h) return;
  const nav = navigationsLink(h);
  el.innerHTML = `
    <div class="opgave-hoved">
      <span class="kat">${ikonFor(h)}</span>
      <div>
        <p class="lille">Din opgave · taget kl. ${klokken(h.taget_tid)}${h.ankommet_tid ? ` · ankommet kl. ${klokken(h.ankommet_tid)}` : ''}</p>
        <h2>${esc(h.titel)}</h2>
        <p class="adresse">${esc(h.adresse || 'Ingen adresse')}${h.cirka ? ' (ca.)' : ''}${afstand(h) != null ? ` · ${kmTekst(afstand(h))}` : ''}</p>
        ${(n => n ? `<p class="opdatering"><span>${n.ikon} ${esc(n.tekst)}</span></p>` : '')(senesteNyt(h))}
        ${vejrRisikoLinje(h)}
      </div>
    </div>
    <div class="knap-række">
      ${nav ? `<a class="knap" href="${nav}" target="_blank" rel="noopener">Navigér</a>` : ''}
      <button data-handling="tidslinje" class="secondary">💬 Kommentér${kommentarerTil(h.id).length ? ` (${kommentarerTil(h.id).length})` : ''}</button>
      ${h.status !== 'ankommet' ? '<button data-handling="ankommet">Ankommet</button>' : ''}
      <button data-handling="afslut" class="ok">Afslut</button>
      <button data-handling="slip" class="secondary">Slip</button>
    </div>`;
}

// Tættest på trumfer område: listen sorteres ikke efter område. Område vises kun som oplysning.
const andetOmråde = h => !!(mig.omraade_id && h.omraade_id && h.omraade_id !== mig.omraade_id);
const naboHjælp = h => andetOmråde(h) && prioAf(h) === 1 && h.status === 'ny';
const omrNavn = id => (store.state.omraader || []).find(o => o.id === id)?.navn;

function kort_(h) {
  const d = afstand(h);
  const tagbar = h.status === 'ny' && !mig.haendelse_id;
  const min = h.taget_af === mig.id;
  const k = kommentarerTil(h.id).length;
  const hvem = h.auto_lukket && !aktiv(h) ? '<span class="hvem">Lukket automatisk</span>'
    : min ? '<span class="hvem">Din opgave</span>'
    : h.taget_af && aktiv(h) ? `<span class="hvem">${esc(navn(h.taget_af))} ${h.status === 'ankommet' ? 'er på stedet' : 'er på vej'}</span>` : '';
  return `
    <article class="h-kort h-${h.status} prio-${prioAf(h)}${min ? ' min' : ''}" data-id="${h.id}">
      <span class="kat">${ikonFor(h)}</span>
      <div class="h-tekst">
        <div class="h-hoved">
          <h3>${prioAf(h) === 1 && aktiv(h) ? '<span class="prio-ikon" title="Høj prioritet" aria-label="Høj prioritet">!</span>' : ''}${h.eskaleret ? '<span class="stor-mærke">Stor hændelse</span> ' : ''}${esc(h.titel)}</h3>
          <span class="chip h-${h.status}">${H_STATUS_KORT[h.status] || esc(h.status)}</span>
        </div>
        <p class="adresse">${esc(h.adresse || (h.lat != null ? 'Placeret på kortet' : 'Ingen adresse'))}${h.cirka ? ' (ca.)' : ''}</p>
        ${naboHjælp(h) ? `<p class="lille nabo-hjælp">🆘 Naboområdet${omrNavn(h.omraade_id) ? ` (${esc(omrNavn(h.omraade_id))})` : ''} mangler en fotograf</p>`
          : andetOmråde(h) && aktiv(h) ? `<p class="lille base-lille">Andet område${omrNavn(h.omraade_id) ? `: ${esc(omrNavn(h.omraade_id))}` : ''}</p>` : ''}
        ${aktiv(h) ? vejrRisikoLinje(h) : ''}
      </div>
      <div class="h-bund">
        ${d != null && aktiv(h) ? `<span class="afstand"><b>${kmTekst(d)}</b><small>${køretid(d)}</small></span>` : ''}
        <span class="lille">${siden(h.oprettet)} siden${k ? ` · <span class="k-antal" title="Kommentarer">💬 ${k}</span>` : ''}</span>
        ${tagbar ? `<button class="tag-knap" data-tag="${h.id}">Tag opgaven</button>` : hvem}
      </div>
    </article>`;
}

// Sortering: min opgave, så ledige, så andres. Høj prioritet øverst i hver gruppe, derefter nærmest eller nyeste.
const sorterNær = () => pref.get('sort-naer', true);
function sorterAktive(liste) {
  const gruppe = h => h.taget_af === mig.id ? 0 : h.status === 'ny' ? 1 : 2;
  const høj = h => prioAf(h) === 1 ? 0 : 1;
  const nær = sorterNær();
  return liste.sort((a, b) => gruppe(a) - gruppe(b) || høj(a) - høj(b)
    || (nær ? (afstand(a) ?? Infinity) - (afstand(b) ?? Infinity) : 0)
    || efterPrio(a, b));
}

function tegnListe() {
  const alle = store.state.haendelser;
  const aktive = sorterAktive(alle.filter(aktiv));
  const afsluttede = alle.filter(h => !aktiv(h)).slice(0, 15);
  const nye = aktive.filter(h => h.status === 'ny').length;
  const t = $('#antal-nye'); t.hidden = !nye; t.textContent = nye;
  const nær = sorterNær();
  const vælger = aktive.length > 1 ? `<div class="sortering" role="group" aria-label="Sortér hændelser">
      <span>Sortér:</span>
      <button type="button" data-sort="naer" aria-pressed="${nær}">Nærmest</button>
      <button type="button" data-sort="nyeste" aria-pressed="${!nær}">Nyeste</button>
    </div>` : '';
  $('#liste').innerHTML = vælger + (aktive.length ? aktive.map(kort_).join('') : '<p class="tom">Ingen aktive hændelser lige nu.</p>')
    + kollegaListe()
    + (afsluttede.length ? `<h4 class="sektion">Afsluttet seneste døgn</h4>${afsluttede.map(kort_).join('')}` : '');
}

// Kolleger: navn, status, afstand og telefon (afstand kun når begge deler position)
function kollegaListe() {
  const orden = { ledig: 0, ankommet: 1, optaget: 2, pause: 3, offline: 4 };
  const kol = store.state.profiler.filter(p => p.rolle === 'foto' && p.id !== mig.id)
    .sort((a, b) => (orden[a.status] - orden[b.status]) || a.navn.localeCompare(b.navn));
  if (!kol.length) return '';
  return `<h4 class="sektion">Kolleger</h4><div class="kolleger">${kol.map(p => {
    const st = STATUS[p.status] || STATUS.offline, d = km(minPos || mig, p);
    const opg = store.state.haendelser.find(h => h.id === p.haendelse_id);
    return `<div class="kollega${p.status === 'offline' ? ' offline' : ''}">
      ${avatar(p, 38)}
      <div class="kollega-info"><b>${esc(p.navn)}</b>
        <span class="lille">${st.tekst}${d != null && p.status !== 'offline' ? ` · ${kmTekst(d)}` : ''}${set(p) || p.status === 'offline' ? '' : ' · ikke set for nylig'}${opg ? ` · ${esc(opg.titel)}` : ''}</span></div>
      ${p.lat != null && p.status !== 'offline' ? `<button class="ikon-knap" data-vis-kollega="${p.id}" aria-label="Vis ${esc(p.navn)} på kortet">📍</button>` : ''}
      ${p.telefon ? `<a class="ikon-knap" href="tel:${esc(p.telefon)}" aria-label="Ring til ${esc(p.navn)}">📞</a>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function tegnKort() {
  if (!kort) return;
  const aktive = store.state.haendelser.filter(aktiv);
  hLag.opdater(aktive, h => ({ ikon: haendelsesIkon(h, h.taget_af === mig.id), klik: () => visHaendelse(h.id), z: 1000 }));
  const kolleger = store.state.profiler.filter(p => p.rolle === 'foto' && p.status !== 'offline' && p.lat != null);
  const medMig = kolleger.map(p => p.id === mig.id && minPos ? { ...p, ...minPos } : p);
  if (minPos && !medMig.some(p => p.id === mig.id)) medMig.push({ ...mig, ...minPos });
  fLag.opdater(medMig, p => ({ ikon: fotografIkon(p, p.id === mig.id), popup: `<b>${esc(p.navn)}</b><br>${STATUS[p.status]?.tekst || ''}` }));
  if (førsteZoom) {
    // Start ved "mig + aktive hændelser i nærheden" i stedet for hele landet
    const nær = aktive.filter(h => h.lat != null && (afstand(h) ?? 0) < 150);
    const pkt = (nær.length || minPos ? nær : aktive.filter(h => h.lat != null)).map(h => [h.lat, h.lon]);
    if (minPos) pkt.push([minPos.lat, minPos.lon]);
    if (pkt.length) { kort.vis(pkt, 12); førsteZoom = false; }
  }
}

// ---------------------------------------------------------------------------------
// SOS
const minSos = () => aktiveSos().find(s => s.bruger === mig.id);
const andresSos = () => aktiveSos().filter(s => s.bruger !== mig.id)
  .filter(s => s.lat == null || km(minPos || mig, s) == null || km(minPos || mig, s) <= SOS_RADIUS_KM);

function tegnSos() {
  const egen = minSos(), andre = andresSos();
  const kvit = egen?.kvitteret_af ? store.state.profiler.find(p => p.id === egen.kvitteret_af) : null;
  $('#sos-omraade').innerHTML = (egen ? `
    <div class="sos-mig" role="alert">
      <b>🆘 Din SOS er sendt</b>
      <p>${kvit ? `✅ ${esc(kvit.navn)} har set din alarm kl. ${klokken(egen.kvitteret_tid)}.` : 'Kontoret og fotografer inden for 20 km er alarmeret. Venter på, at nogen ser den …'}
        ${påVejTekst(egen) ? `<br><b>🚗 På vej til dig: ${påVejTekst(egen)}</b>` : ''}
        Din position sendes løbende${egen.lat != null ? '' : ' (placering ikke fundet endnu)'}.</p>
      <div class="sos-knapper">
        <a class="knap hvid" href="tel:112">📞 Ring 112</a>
        <button id="btn-sos-ok" class="hvid">Jeg er OK – stop alarmen</button>
      </div>
    </div>` : '') + andre.map(s => sosBoks(s, { fra: minPos || mig })).join('');
  $('#btn-sos').classList.toggle('aktiv', !!egen);
  // Lyd, indtil jeg har trykket "Set" (eller nogen har kvitteret)
  alarm(andre.some(s => !s.kvitteret_af && !sosSet.has(s.id)));
  if (sLag) sLag.opdater(aktiveSos(), s => ({
    ikon: sosIkon(), z: 2000,
    popup: `<b>🆘 SOS: ${esc(store.state.profiler.find(p => p.id === s.bruger)?.navn || '')}</b><br>kl. ${klokken(s.start)}`,
  }));
  // Mens min egen alarm er aktiv, sendes positionen løbende (også hvis deling ellers er slået fra)
  if (egen && sosWatch == null && navigator.geolocation) {
    sosWatch = navigator.geolocation.watchPosition(p => {
      minPos = { lat: p.coords.latitude, lon: p.coords.longitude };
      if (Date.now() - sosSidst > 10e3) { sosSidst = Date.now(); store.sosStart(minPos.lat, minPos.lon, p.coords.accuracy).catch(() => {}); }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 5e3, timeout: 20e3 });
  }
  if (!egen && sosWatch != null) { navigator.geolocation.clearWatch(sosWatch); sosWatch = null; }
}

// Tilbud om en opgave: stor boks med Tag den / Nej tak og nedtælling
const mineTilbud = () => (store.state.tilbud || []).filter(t => t.fotograf === mig.id && !t.svar && new Date(t.udloeber) > new Date());
function tegnTilbud() {
  $('#tilbud-omraade').innerHTML = mineTilbud().map(t => {
    const h = store.state.haendelser.find(x => x.id === t.haendelse_id);
    if (!h || h.status !== 'ny') return '';
    return `
      <div class="tilbud-boks" data-tilbud="${t.id}">
        <div class="tilbud-top"><span class="tilbud-mærke">📩 Tilbud til dig</span><span class="tilbud-tid" data-udloeber="${t.udloeber}">${nedtælling(t.udloeber)}</span></div>
        <div class="opgave-hoved"><span class="kat">${ikonFor(h)}</span>
          <div><h2>${esc(h.titel)}</h2>
            <p class="adresse">${esc(h.adresse || '')}${t.afstand_km != null ? ` · <b>${kmTekst(t.afstand_km)} fra dig</b>` : ''}</p></div></div>
        <div class="knap-række">
          <button data-tilbud-ja="${t.id}" class="ok stor-knap">Tag den</button>
          <button data-tilbud-nej="${t.id}" class="secondary">Nej tak</button>
          <button data-tilbud-vis="${h.id}" class="secondary">Se detaljer</button>
        </div>
      </div>`;
  }).join('');
}

let sosNedtælling = null;
function åbnSos() {
  if (minSos()) return toast('Din SOS er allerede aktiv.');
  const dlg = $('#dlg-sos'); let n = 5;
  $('#sos-tal').textContent = n;
  dlg.showModal(); navigator.vibrate?.(200);
  clearInterval(sosNedtælling);
  sosNedtælling = setInterval(() => { n--; $('#sos-tal').textContent = n; if (n <= 0) sendSos(); }, 1000);
}
async function sendSos() {
  clearInterval(sosNedtælling); $('#dlg-sos').close();
  // Send med det samme (sidst kendte position), og opdatér, så snart GPS'en svarer
  const kendt = minPos || (mig.lat != null ? { lat: mig.lat, lon: mig.lon } : null);
  const ok = await prøv(() => store.sosStart(kendt?.lat ?? null, kendt?.lon ?? null, null), 'SOS er sendt.');
  if (ok && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(p => {
      minPos = { lat: p.coords.latitude, lon: p.coords.longitude };
      store.sosStart(minPos.lat, minPos.lon, p.coords.accuracy).catch(() => {});
    }, () => toast('Din placering kunne ikke findes. Ring evt. 112 eller til kontoret.', 'fejl'),
    { enableHighAccuracy: true, timeout: 10e3, maximumAge: 30e3 });
  }
}

function visSos(id) {
  const s = (store.state.sos || []).find(x => x.id === id);
  if (!s || s.lat == null) return;
  skiftFane('kort'); kort.setView([s.lat, s.lon], 16);
}

// ---------------------------------------------------------------------------------
function visHaendelse(id, åbn = true) {
  const h = store.state.haendelser.find(x => x.id === id);
  if (!h) return;
  åbenId = id;
  const d = afstand(h), nav = navigationsLink(h);
  const min = h.taget_af === mig.id;
  const dlg = $('#dlg-haendelse');
  gentegnMedFormular(dlg.querySelector('.ark-indhold'), `
    <div class="ark-top"><span class="kat stor">${ikonFor(h)}</span>
      <button class="luk" data-luk aria-label="Luk">✕</button></div>
    ${h.eskaleret ? '<p class="stor-banner">⬆️ Stor hændelse – opgraderet af kontoret</p>' : ''}
    ${aktiv(h) && prioAf(h) !== 2 ? `<p class="prio-banner p${prioAf(h)}">${prioAf(h) === 1 ? '🔴 Kontoret har givet hændelsen høj prioritet' : '⚪ Lav prioritet fra kontoret'}</p>` : ''}
    <h2>${esc(h.titel)}</h2>
    <p class="adresse">${esc(h.adresse || 'Ingen adresse')}${d != null ? ` · ${kmTekst(d)} væk` : ''}</p>
    ${h.antal_enheder ? `<p class="lille">🚒 ${h.antal_ass || 0} assistance${h.antal_ass === 1 ? '' : 'r'} · ${h.antal_enheder} enheder</p>` : ''}
    ${aktiv(h) ? sikkerhedHtml(h) : ''}
    ${aktiv(h) ? `<div id="ai-plads">${indsigtHtml(h, indsigt(h, d => { if (åbenId === h.id) { const el = $('#ai-plads'); if (el) el.innerHTML = indsigtHtml(h, d); } }))}</div>` : ''}
    ${h.cirka ? '<p class="hint">Placeringen er cirka (kun by eller station kendt). Tjek adressen i teksten.</p>' : ''}
    <p class="lille">Modtaget kl. ${klokken(h.oprettet)} (${siden(h.oprettet)} siden) · ${esc(h.kategori || '')}</p>
    <p class="status-linje h-${h.status}">${h.status === 'ny' ? 'Ingen har taget den endnu' : min ? 'Det er din opgave' : `${H_STATUS[h.status]}: ${esc(navn(h.taget_af))}`}</p>
    ${sikkerUrl(h.url) ? `<p><a href="${esc(sikkerUrl(h.url))}" target="_blank" rel="noopener noreferrer">Åbn link fra beskeden</a></p>` : ''}
    ${nyhederHtml(h)}
    ${h.note ? `<p class="note">Note: ${esc(h.note)}</p>` : ''}
    <div class="knap-række">
      ${h.status === 'ny' && !mig.haendelse_id ? `<button data-tag="${h.id}" class="stor-knap">Tag hændelsen</button>` : ''}
      ${h.status === 'ny' && mig.haendelse_id ? '<p class="hint">Du har allerede en opgave. Afslut eller slip den først.</p>' : ''}
      ${nav ? `<a class="knap secondary" href="${nav}" target="_blank" rel="noopener">Navigér</a>` : ''}
      ${h.lat != null ? '<button class="secondary" data-vis-kort>Vis på kort</button>' : ''}
    </div>
    ${tidslinjeHtml(h)}`);
  if (åbn && !dlg.open) dlg.showModal();
}

async function tag(id) {
  const ok = await prøv(() => store.tag(id), 'Hændelsen er din. Du står som optaget.');
  if (ok) { $('#dlg-haendelse').close(); skiftFane('kort'); }
}

async function meldStatus(s) {
  if (s === mig.status) return;
  if (s === 'ledig' && mig.haendelse_id) {
    // Ledig med en opgave = færdig med opgaven
    return åbnAfslut();
  }
  await prøv(() => store.meldStatus(s), `Du er meldt ${STATUS[s].tekst.toLowerCase()}.`);
}

function åbnAfslut() {
  const dlg = $('#dlg-afslut'); dlg.querySelector('form').reset();
  dlg.onclose = async () => {
    if (dlg.returnValue === 'ok') await prøv(() => store.afslut(dlg.querySelector('[name=note]').value.trim()), 'Opgaven er afsluttet. Du er ledig.');
  };
  dlg.showModal();
}

function skiftFane(f) {
  document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.fane === f)));
  document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== f; });
  if (f === 'kort') setTimeout(() => kort.invalidateSize(), 50);
}

// ---------------------------------------------------------------------------------
// Position og "jeg er her" hvert minut
function startPosition() {
  stopPosition();
  if (!pref.get('position', false) || !navigator.geolocation) return;
  let sidst = 0;
  posWatch = navigator.geolocation.watchPosition(p => {
    minPos = { lat: p.coords.latitude, lon: p.coords.longitude };
    if (Date.now() - sidst > 30e3) { sidst = Date.now(); store.meldPosition(minPos.lat, minPos.lon).catch(() => {}); }
    tegnKort();
  }, e => { if (e.code === 1) { toast('Positionen er slået fra i telefonens indstillinger.', 'fejl'); pref.set('position', false); } },
  { enableHighAccuracy: true, maximumAge: 15e3, timeout: 30e3 });
}
function stopPosition() { if (posWatch != null) navigator.geolocation.clearWatch(posWatch); posWatch = null; }

function pulsSlag() {
  if (document.visibilityState === 'visible') store.meldPosition(minPos?.lat ?? null, minPos?.lon ?? null).catch(() => {});
}

// ---------------------------------------------------------------------------------
// Push-beskeder til låst telefon (selve abonnementet ligger i faelles.js)
async function slåPushTil() { await abonnérPush(); pref.set('push', true); }
async function slåPushFra() { await afmeldPush(); pref.set('push', false); }
function visPushBanner() {
  const vis = store.cloud && !pushKanBruges() && Notification.permission !== 'denied'
    && !pref.get('push', false) && !pref.get('push-spurgt', false);
  $('#push-banner').hidden = !vis;
}

// Åbn en hændelse fra et link (push-besked): ./?h=<id>
function åbnFraLink(url = location.href) {
  const q = new URL(url, location.href).searchParams;
  const id = q.get('h'), sos = q.get('sos'), tilbud = q.get('tilbud');
  if (!id && !sos && !tilbud) return;
  history.replaceState(null, '', location.pathname + (store.demo ? '?demo' : ''));
  if (sos) return visSos(sos);
  if (tilbud) return $('#tilbud-omraade').scrollIntoView({ block: 'start' });
  if (store.state.haendelser.some(h => h.id === id)) visHaendelse(id);
}

// ---------------------------------------------------------------------------------
async function start() {
  mig = await logInd();
  $('#demo-mærke').hidden = !store.demo;
  $('#skift').hidden = mig.rolle !== 'kontor';   // kontoret kan skifte mellem fotografens side og sit dashboard
  kort = lavKort($('#kort'));
  stationsKontrol(kort);   // brand-, politi- og ambulancestationer + telefonliste
  hLag = markørLag(kort); fLag = markørLag(kort); sLag = markørLag(kort); helikopterLag(kort);

  // Live opdateringer: hvis teksten på min opgave (eller en ledig hændelse) bliver længere, får jeg besked
  const kendtTekst = new Map(store.state.haendelser.map(h => [h.id, h.tekst || '']));
  const kendtPrio = new Map(store.state.haendelser.map(h => [h.id, prioAf(h)]));
  store.lyt(s => {
    tegn();
    for (const h of s.haendelser) {
      const før = kendtTekst.get(h.id);
      kendtTekst.set(h.id, h.tekst || '');
      if (før == null || før === (h.tekst || '') || !senesteOpdatering(h)) continue;
      const min = h.id === s.mig?.haendelse_id;
      if (min || h.status === 'ny') {
        if (min && pref.get('lyd', true)) bip();
        toast(`${min ? 'Opdatering på din opgave' : 'Opdatering'}: ${senesteOpdatering(h).replace(/^kl\. \d\d[.:]\d\d [^:]+: /, '').slice(0, 120)}`, min ? 'ny' : '');
      }
    }
    // Kontoret ændrer prioritet: besked, når en hændelse bliver høj (eller min opgave ændres)
    for (const h of s.haendelser) {
      const før = kendtPrio.get(h.id), nu = prioAf(h);
      kendtPrio.set(h.id, nu);
      if (før == null || før === nu || !aktiv(h)) continue;
      const min = h.id === s.mig?.haendelse_id;
      if (nu === 1 || min) {
        if (nu === 1 && pref.get('lyd', true)) bip();
        toast(`${nu === 1 ? '🔴 Høj prioritet' : `Prioritet: ${PRIO[nu].navn}`}${min ? ' på din opgave' : ''}: ${h.titel}`, nu === 1 ? 'ny' : '');
      }
    }
    const k = s.nyKommentar;
    if (k) {
      const h = s.haendelser.find(x => x.id === k.haendelse_id);
      const min = k.haendelse_id === s.mig?.haendelse_id;
      if (h && (min || åbenId === h.id || s.mig?.rolle === 'kontor')) {
        if (min && pref.get('lyd', true)) bip();
        const af = s.profiler.find(p => p.id === k.bruger)?.navn || 'Kontoret';
        toast(`💬 ${af}${min ? ' (din opgave)' : ''}: ${k.tekst.slice(0, 120)}`, min ? 'ny' : '');
      }
    }
    if (s.nytTilbud) { if (pref.get('lyd', true)) bip(); navigator.vibrate?.([300, 120, 300, 120, 300]); toast('📩 Du har fået et tilbud om en opgave', 'ny'); }
    if (s.nySos && s.nySos.bruger !== mig.id) toast('🆘 SOS fra en kollega – se den røde boks øverst', 'fejl');
    const ny = s.nyHaendelse;
    if (ny && ny.status === 'ny') {
      if (pref.get('lyd', true)) bip();
      toast(`Ny hændelse: ${ny.titel}`, 'ny');
      if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification('Fotovagt: ' + ny.titel, { body: ny.adresse || '', icon: 'icon-192.png', tag: ny.id }); } catch { /* ok */ }
      }
    }
  });
  tegn();

  // Første gang man er logget ind og ikke har en status: meld ledig
  if (mig.status === 'offline') await prøv(() => store.meldStatus('ledig'));

  // SOS
  $('#btn-sos').onclick = () => minSos() ? toast('Din SOS er aktiv. Stop den med "Jeg er OK".') : åbnSos();
  $('#btn-sos-nu').onclick = sendSos;
  $('#btn-sos-fortryd').onclick = () => { clearInterval(sosNedtælling); $('#dlg-sos').close(); toast('SOS er ikke sendt.'); };
  $('#dlg-sos').addEventListener('cancel', () => clearInterval(sosNedtælling));
  $('#sos-omraade').onclick = async e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'btn-sos-ok' && confirm('Stop din SOS-alarm? Kontoret får besked om, at du er OK.')) await prøv(() => store.sosStop(), 'Alarmen er stoppet.');
    if (t.dataset.sosVej) {
      sosSet.add(t.dataset.sosVej);
      const s = aktiveSos().find(x => x.id === t.dataset.sosVej);
      await prøv(() => store.sosPåVej(t.dataset.sosVej), 'Du står som på vej. Kontoret og kollegaen kan se det.');
      if (s?.lat != null) window.open(/iPhone|iPad|Mac/.test(navigator.userAgent) ? `https://maps.apple.com/?daddr=${s.lat},${s.lon}` : `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`, '_blank');
      tegnSos();
    }
    if (t.dataset.sosSet) { sosSet.add(t.dataset.sosSet); await prøv(() => store.sosKvitter(t.dataset.sosSet), 'Du har meldt, at du har set alarmen.'); tegnSos(); }
    if (t.dataset.sosVis) visSos(t.dataset.sosVis);
  };

  document.querySelector('.status-knapper').onclick = e => { const b = e.target.closest('[data-status]'); if (b) meldStatus(b.dataset.status); };
  document.querySelector('.faner').onclick = e => { const b = e.target.closest('[data-fane]'); if (b) skiftFane(b.dataset.fane); };
  $('#liste').addEventListener('click', e => {
    const b = e.target.closest('[data-vis-kollega]'); if (!b) return;
    e.stopPropagation();
    const p = store.state.profiler.find(x => x.id === b.dataset.visKollega);
    if (p?.lat != null) { skiftFane('kort'); kort.setView([p.lat, p.lon], 14); }
  }, true);
  $('#tilbud-omraade').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tilbudJa) { const ok = await prøv(() => store.svarTilbud(b.dataset.tilbudJa, true), 'Opgaven er din. Du står som optaget.'); if (ok) skiftFane('kort'); }
    if (b.dataset.tilbudNej) await prøv(() => store.svarTilbud(b.dataset.tilbudNej, false), 'Tilbuddet går videre til en kollega.');
    if (b.dataset.tilbudVis) visHaendelse(b.dataset.tilbudVis);
  };
  $('#liste').onclick = e => {
    const so = e.target.closest('[data-sort]'); if (so) { pref.set('sort-naer', so.dataset.sort === 'naer'); return tegnListe(); }
    const t = e.target.closest('[data-tag]'); if (t) { e.stopPropagation(); return tag(t.dataset.tag); }
    const k = e.target.closest('[data-id]'); if (k) visHaendelse(k.dataset.id);
  };
  $('#opgave').onclick = async e => {
    const b = e.target.closest('[data-handling]'); if (!b) return;
    const a = b.dataset.handling;
    if (a === 'ankommet') await prøv(() => store.meldStatus('ankommet'), 'Meldt ankommet.');
    if (a === 'afslut') åbnAfslut();
    if (a === 'tidslinje') { visHaendelse(minOpgave().id); setTimeout(() => $('#dlg-haendelse form.kommentar-form textarea')?.focus(), 80); }
    if (a === 'slip' && confirm('Slip opgaven, så en anden kan tage den?')) await prøv(() => store.slip(), 'Opgaven er sluppet. Du er ledig.');
  };
  const dlgH = $('#dlg-haendelse');
  dlgH.onclick = e => {
    if (e.target === dlgH || e.target.closest('[data-luk]')) return dlgH.close();
    const t = e.target.closest('[data-tag]'); if (t) return tag(t.dataset.tag);
    if (e.target.closest('[data-vis-kort]')) {
      const h = store.state.haendelser.find(x => x.id === åbenId);
      dlgH.close(); skiftFane('kort'); kort.setView([h.lat, h.lon], 15);
    }
  };
  dlgH.onclose = () => { åbenId = null; };
  kommentarHandlinger(dlgH);
  $('#btn-kode').onclick = () => åbnSkiftKode();

  // Profil
  $('#btn-mig').onclick = () => {
    const f = $('#form-profil');
    f.navn.value = mig.navn || ''; f.telefon.value = mig.telefon || '';
    fotoFelt($('#mit-foto'), store.state.profiler.find(p => p.id === mig.id) || mig);
    const sel = $('#sel-omraade'), mitOmr = store.state.profiler.find(p => p.id === mig.id)?.omraade_id ?? mig.omraade_id;
    sel.innerHTML = '<option value="">– Intet område –</option>' + (store.state.omraader || [])
      .map(o => `<option value="${o.id}"${o.id === mitOmr ? ' selected' : ''}>${esc(o.navn)}</option>`).join('');
    sel.onchange = () => prøv(() => store.skiftOmraade(sel.value), `Dit område er nu ${sel.selectedOptions[0].textContent}.`);
    f.position.checked = pref.get('position', false); f.lyd.checked = pref.get('lyd', true);
    f.push.checked = pref.get('push', false);
    const grund = store.demo ? 'Push-beskeder virker først, når Fotovagt er sat op med Supabase.' : pushKanBruges();
    $('#push-hint').hidden = !grund; $('#push-hint').textContent = grund;
    f.push.disabled = !!grund;
    $('#btn-test-push').hidden = !pref.get('push', false) || !!grund;
    $('#dlg-profil').showModal();
  };
  $('#dlg-profil').onclose = async () => {
    const dlg = $('#dlg-profil'), f = $('#form-profil');
    if (dlg.returnValue !== 'gem') return;
    pref.set('lyd', f.lyd.checked);
    const varPos = pref.get('position', false);
    pref.set('position', f.position.checked);
    if (f.position.checked !== varPos) f.position.checked ? startPosition() : (stopPosition(), minPos = null);
    if (f.lyd.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    if (f.push.checked !== pref.get('push', false)) {
      await prøv(() => f.push.checked ? slåPushTil() : slåPushFra(), f.push.checked ? 'Push-beskeder er slået til.' : 'Push-beskeder er slået fra.');
      visPushBanner();
    }
    await prøv(() => store.retProfil(f.navn.value.trim(), f.telefon.value.trim()), 'Gemt.');
  };
  $('#btn-logud').onclick = async () => {
    if (mig.haendelse_id && !confirm('Du har en opgave. Log ud alligevel?')) return;
    await prøv(() => store.meldStatus('offline'));
    await store.logout(); location.reload();
  };

  // Push: banner første gang, prøve-knap, og abonnementet fornyes ved hver start (det kan udløbe)
  visPushBanner();
  $('#btn-push-ja').onclick = async () => { pref.set('push-spurgt', true); await prøv(slåPushTil, 'Push-beskeder er slået til.'); visPushBanner(); };
  $('#btn-push-nej').onclick = () => { pref.set('push-spurgt', true); visPushBanner(); };
  $('#btn-test-push').onclick = () => prøv(async () => {
    const r = await store.testPush();
    if (!r?.sendt) throw new Error('Ingen telefon fik beskeden. Slå push fra og til igen.');
  }, 'Prøven er sendt.');
  if (store.cloud && pref.get('push', false) && !pushKanBruges() && Notification.permission === 'granted') slåPushTil().catch(() => {});
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.åbn) åbnFraLink(e.data.åbn); });
  åbnFraLink();

  startPosition();
  setInterval(pulsSlag, 60e3);
  setInterval(() => { if (!document.hidden) tegnListe(); }, 30e3);
  setInterval(() => { if (document.querySelector('#tilbud-omraade .tilbud-boks') && !mineTilbud().length) tegnTilbud(); }, 1000); // "x min siden" holdes opdateret
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { store.hentAlt().catch(() => {}); pulsSlag(); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
