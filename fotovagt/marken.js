// Marken: fotografens telefon. Kort og liste over hændelser, tag en hændelse, meld status.
import { store } from './store.js';
import {
  STATUS, H_STATUS, KATEGORI_IKON, aktiv, senesteOpdatering, esc, $, siden, klokken, km, kmTekst, navigationsLink,
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
        ${senesteOpdatering(h) ? `<p class="opdatering"><span>🔄 ${esc(senesteOpdatering(h))}</span></p>` : ''}
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
// Push-beskeder til låst telefon
const erIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const påHjemmeskærm = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function pushKanBruges() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return erIOS && !påHjemmeskærm()
      ? 'På iPhone skal Fotovagt først lægges på hjemmeskærmen: tryk Del → "Føj til hjemmeskærm", og åbn den derfra.'
      : 'Denne browser kan ikke modtage push-beskeder.';
  }
  if (!window.FOTOVAGT_CONFIG?.vapidPublicKey) return 'Push er ikke sat op endnu.';
  return '';
}
const nøgleBytes = b64 => {
  const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
async function slåPushTil() {
  const grund = pushKanBruges();
  if (grund) throw new Error(grund);
  if (await Notification.requestPermission() !== 'granted') throw new Error('Du har ikke givet lov til beskeder. Det kan ændres i telefonens indstillinger.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription()
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: nøgleBytes(window.FOTOVAGT_CONFIG.vapidPublicKey) });
  await store.gemPush(sub.toJSON());
  pref.set('push', true);
}
async function slåPushFra() {
  const reg = await navigator.serviceWorker?.ready;
  const sub = await reg?.pushManager?.getSubscription();
  if (sub) { await store.sletPush(sub.endpoint).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  pref.set('push', false);
}
function visPushBanner() {
  const vis = store.cloud && !pushKanBruges() && Notification.permission !== 'denied'
    && !pref.get('push', false) && !pref.get('push-spurgt', false);
  $('#push-banner').hidden = !vis;
}

// Åbn en hændelse fra et link (push-besked): ./?h=<id>
function åbnFraLink(url = location.href) {
  const id = new URL(url, location.href).searchParams.get('h');
  if (!id) return;
  history.replaceState(null, '', location.pathname);
  if (store.state.haendelser.some(h => h.id === id)) visHaendelse(id);
}

// ---------------------------------------------------------------------------------
async function start() {
  mig = await logInd();
  $('#demo-mærke').hidden = !store.demo;
  kort = lavKort($('#kort'));
  hLag = markørLag(kort); fLag = markørLag(kort);

  // Live opdateringer: hvis teksten på min opgave (eller en ledig hændelse) bliver længere, får jeg besked
  const kendtTekst = new Map(store.state.haendelser.map(h => [h.id, h.tekst || '']));
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
  setInterval(() => { tegnListe(); }, 30e3); // "x min siden" holdes opdateret
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { store.hentAlt().catch(() => {}); pulsSlag(); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
