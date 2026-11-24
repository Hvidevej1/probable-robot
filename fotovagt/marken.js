// Marken: fotografens telefon. Kort og liste over hændelser, tag en hændelse, meld status.
import { store } from './store.js';
import {
  STATUS, H_STATUS, KATEGORI_IKON, aktiv, esc, $, siden, klokken, km, kmTekst, navigationsLink,
  toast, prøv, bip, lavKort, haendelsesIkon, fotografIkon, markørLag, logInd,
} from './faelles.js';

const pref = {
  get(k, std) { try { const v = localStorage.getItem('fotovagt-' + k); return v == null ? std : v === '1'; } catch { return std; } },
  set(k, v) { try { localStorage.setItem('fotovagt-' + k, v ? '1' : '0'); } catch { /* ok */ } },
};
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
  const chip = $('#mig-status'); chip.textContent = st.tekst; chip.style.setProperty('--c', st.farve);
  document.querySelectorAll('.status-knapper button').forEach(b => {
    b.classList.toggle('aktiv', b.dataset.status === mig.status);
    b.style.setProperty('--c', STATUS[b.dataset.status].farve);
    if (b.dataset.status === 'ankommet') b.disabled = !mig.haendelse_id;
  });
  tegnOpgave(); tegnListe(); tegnKort();
  if (åbenId && $('#dlg-haendelse').open) visHaendelse(åbenId, false);
}

function tegnOpgave() {
  const el = $('#opgave'), h = minOpgave();
  el.hidden = !h;
  if (!h) return;
  const nav = navigationsLink(h);
  el.innerHTML = `
    <div class="opgave-hoved">
      <span class="kat">${KATEGORI_IKON[h.kategori] || '📍'}</span>
      <div>
        <p class="lille">Din opgave · taget kl. ${klokken(h.taget_tid)}${h.ankommet_tid ? ` · ankommet kl. ${klokken(h.ankommet_tid)}` : ''}</p>
        <h2>${esc(h.titel)}</h2>
        <p class="adresse">${esc(h.adresse || 'Ingen adresse')}${h.cirka ? ' (ca.)' : ''}${afstand(h) != null ? ` · ${kmTekst(afstand(h))}` : ''}</p>
      </div>
    </div>
    <div class="knap-række">
      ${nav ? `<a class="knap" href="${nav}" target="_blank" rel="noopener">Navigér</a>` : ''}
      ${h.status !== 'ankommet' ? '<button data-handling="ankommet">Ankommet</button>' : ''}
      <button data-handling="afslut" class="ok">Afslut</button>
      <button data-handling="slip" class="secondary">Slip</button>
    </div>`;
}

function kort_(h) {
  const d = afstand(h);
  const tagbar = h.status === 'ny' && !mig.haendelse_id;
  const min = h.taget_af === mig.id;
  return `
    <article class="h-kort h-${h.status}${min ? ' min' : ''}" data-id="${h.id}">
      <span class="kat">${KATEGORI_IKON[h.kategori] || '📍'}</span>
      <div class="h-tekst">
        <h3>${esc(h.titel)}</h3>
        <p class="adresse">${esc(h.adresse || (h.lat != null ? 'Placeret på kortet' : 'Ingen adresse'))}${h.cirka ? ' (ca.)' : ''}</p>
        <p class="lille">${siden(h.oprettet)} siden${d != null ? ` · ${kmTekst(d)}` : ''} ·
          <span class="h-status">${h.status === 'ny' ? 'Ledig opgave' : min ? 'Din opgave' : `${H_STATUS[h.status]} – ${esc(navn(h.taget_af))}`}</span></p>
      </div>
      ${tagbar ? `<button class="tag-knap" data-tag="${h.id}">Tag</button>` : ''}
    </article>`;
}

function tegnListe() {
  const alle = store.state.haendelser;
  const aktive = alle.filter(aktiv).sort((a, b) => (b.status === 'ny') - (a.status === 'ny') || b.oprettet.localeCompare(a.oprettet));
  const afsluttede = alle.filter(h => !aktiv(h)).slice(0, 15);
  const nye = aktive.filter(h => h.status === 'ny').length;
  const t = $('#antal-nye'); t.hidden = !nye; t.textContent = nye;
  $('#liste').innerHTML = (aktive.length ? aktive.map(kort_).join('') : '<p class="tom">Ingen aktive hændelser lige nu.</p>')
    + (afsluttede.length ? `<h4 class="sektion">Afsluttet seneste døgn</h4>${afsluttede.map(kort_).join('')}` : '');
}

function tegnKort() {
  if (!kort) return;
  const aktive = store.state.haendelser.filter(aktiv);
  hLag.opdater(aktive, h => ({ ikon: haendelsesIkon(h, h.taget_af === mig.id), klik: () => visHaendelse(h.id) }));
  const kolleger = store.state.profiler.filter(p => p.rolle === 'foto' && p.status !== 'offline' && p.lat != null);
  const medMig = kolleger.map(p => p.id === mig.id && minPos ? { ...p, ...minPos } : p);
  if (minPos && !medMig.some(p => p.id === mig.id)) medMig.push({ ...mig, ...minPos });
  fLag.opdater(medMig, p => ({ ikon: fotografIkon(p, p.id === mig.id), popup: `<b>${esc(p.navn)}</b><br>${STATUS[p.status]?.tekst || ''}` }));
  if (førsteZoom) {
    const pkt = aktive.filter(h => h.lat != null).map(h => [h.lat, h.lon]);
    if (minPos) pkt.push([minPos.lat, minPos.lon]);
    if (pkt.length) { kort.fitBounds(pkt, { padding: [40, 40], maxZoom: 12 }); førsteZoom = false; }
  }
}

// ---------------------------------------------------------------------------------
function visHaendelse(id, åbn = true) {
  const h = store.state.haendelser.find(x => x.id === id);
  if (!h) return;
  åbenId = id;
  const d = afstand(h), nav = navigationsLink(h);
  const min = h.taget_af === mig.id;
  const dlg = $('#dlg-haendelse');
  dlg.querySelector('.ark-indhold').innerHTML = `
    <div class="ark-top"><span class="kat stor">${KATEGORI_IKON[h.kategori] || '📍'}</span>
      <button class="luk" data-luk aria-label="Luk">✕</button></div>
    <h2>${esc(h.titel)}</h2>
    <p class="adresse">${esc(h.adresse || 'Ingen adresse')}${d != null ? ` · ${kmTekst(d)} væk` : ''}</p>
    ${h.cirka ? '<p class="hint">Placeringen er cirka (kun by eller station kendt). Tjek adressen i teksten.</p>' : ''}
    <p class="lille">Modtaget kl. ${klokken(h.oprettet)} (${siden(h.oprettet)} siden) · ${esc(h.kategori || '')}</p>
    <p class="status-linje h-${h.status}">${h.status === 'ny' ? 'Ingen har taget den endnu' : min ? 'Det er din opgave' : `${H_STATUS[h.status]}: ${esc(navn(h.taget_af))}`}</p>
    ${h.tekst ? `<p class="brødtekst">${esc(h.tekst).replace(/\n/g, '<br>')}</p>` : ''}
    ${h.url ? `<p><a href="${esc(h.url)}" target="_blank" rel="noopener">Åbn link fra beskeden</a></p>` : ''}
    ${h.note ? `<p class="note">Note: ${esc(h.note)}</p>` : ''}
    <div class="knap-række">
      ${h.status === 'ny' && !mig.haendelse_id ? `<button data-tag="${h.id}" class="stor-knap">Tag hændelsen</button>` : ''}
      ${h.status === 'ny' && mig.haendelse_id ? '<p class="hint">Du har allerede en opgave. Afslut eller slip den først.</p>' : ''}
      ${nav ? `<a class="knap secondary" href="${nav}" target="_blank" rel="noopener">Navigér</a>` : ''}
      ${h.lat != null ? '<button class="secondary" data-vis-kort>Vis på kort</button>' : ''}
    </div>`;
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
async function start() {
  mig = await logInd();
  $('#demo-mærke').hidden = !store.demo;
  kort = lavKort($('#kort'));
  hLag = markørLag(kort); fLag = markørLag(kort);

  store.lyt(s => {
    tegn();
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

  document.querySelector('.status-knapper').onclick = e => { const b = e.target.closest('[data-status]'); if (b) meldStatus(b.dataset.status); };
  document.querySelector('.faner').onclick = e => { const b = e.target.closest('[data-fane]'); if (b) skiftFane(b.dataset.fane); };
  $('#liste').onclick = e => {
    const t = e.target.closest('[data-tag]'); if (t) { e.stopPropagation(); return tag(t.dataset.tag); }
    const k = e.target.closest('[data-id]'); if (k) visHaendelse(k.dataset.id);
  };
  $('#opgave').onclick = async e => {
    const b = e.target.closest('[data-handling]'); if (!b) return;
    const a = b.dataset.handling;
    if (a === 'ankommet') await prøv(() => store.meldStatus('ankommet'), 'Meldt ankommet.');
    if (a === 'afslut') åbnAfslut();
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

  // Profil
  $('#btn-mig').onclick = () => {
    const f = $('#form-profil');
    f.navn.value = mig.navn || ''; f.telefon.value = mig.telefon || '';
    f.position.checked = pref.get('position', false); f.lyd.checked = pref.get('lyd', true);
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
    await prøv(() => store.retProfil(f.navn.value.trim(), f.telefon.value.trim()), 'Gemt.');
  };
  $('#btn-logud').onclick = async () => {
    if (mig.haendelse_id && !confirm('Du har en opgave. Log ud alligevel?')) return;
    await prøv(() => store.meldStatus('offline'));
    await store.logout(); location.reload();
  };

  startPosition();
  setInterval(pulsSlag, 60e3);
  setInterval(() => { tegnListe(); }, 30e3); // "x min siden" holdes opdateret
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { store.hentAlt().catch(() => {}); pulsSlag(); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
