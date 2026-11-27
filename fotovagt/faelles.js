// Fælles for Marken og Kontoret: tekster, farver, tid, afstand, kort og log ind.
import { store } from './store.js';

export const STATUS = {
  ledig: { tekst: 'Ledig', farve: 'var(--ledig)' },
  optaget: { tekst: 'Optaget', farve: 'var(--optaget)' },
  pause: { tekst: 'Pause', farve: 'var(--pause)' },
  ankommet: { tekst: 'Ankommet', farve: 'var(--ankommet)' },
  offline: { tekst: 'Offline', farve: 'var(--offline)' },
};
export const H_STATUS = {
  ny: 'Ny', taget: 'Taget', ankommet: 'Fotograf ankommet', afsluttet: 'Afsluttet', annulleret: 'Annulleret',
};
export const KATEGORI_IKON = {
  Brand: '🔥', Trafik: '🚗', Politi: '🚓', Redning: '🛟', Miljø: '☣️', Vejr: '🌧️', Forsyning: '🔧', Andet: '📍',
};
// Ikonet for en hændelse: kategorien, men lægehelikopter får en helikopter og indsatsleder-opgaver (ISL) en brandmand
export const ikonFor = h => /helikopter/i.test(h?.titel || '') ? '🚁'
  : /^\s*(?:ISL\b|indsatsleder)/i.test(h?.titel || '') ? '🧑‍🚒' : (KATEGORI_IKON[h?.kategori] || '📍');
// Seneste live opdatering, der er lagt ind i hændelsen ("— kl. 19:42 PF-Upload: …")
export function senesteOpdatering(h) {
  const l = String(h?.tekst || '').split('\n').filter(x => x.startsWith('— ')).pop();
  return l ? l.slice(2) : '';
}
export const aktiv = h => ['ny', 'taget', 'ankommet'].includes(h.status);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, rod = document) => rod.querySelector(sel);

export function siden(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'lige nu';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} t ${Math.floor((s % 3600) / 60)} min`;
  return new Date(iso).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
}
export const klokken = iso => iso ? new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }) : '';

// Afstand i km i luftlinje
export function km(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const R = 6371, rad = Math.PI / 180;
  const dLa = (b.lat - a.lat) * rad, dLo = (b.lon - a.lon) * rad;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export const kmTekst = d => d == null ? '' : d < 1 ? `${Math.round(d * 1000)} m` : `${d < 10 ? d.toFixed(1).replace('.', ',') : Math.round(d)} km`;

// Har appen været åben for nylig? (ellers vises fotografen som "ikke set")
export const set = p => p.sidst_set && Date.now() - new Date(p.sidst_set) < 5 * 60e3;

export function navigationsLink(h) {
  if (h.lat != null) {
    const ios = /iPhone|iPad|Mac/.test(navigator.userAgent);
    return ios ? `https://maps.apple.com/?daddr=${h.lat},${h.lon}` : `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}`;
  }
  return h.adresse ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.adresse)}` : null;
}

// Lille besked nederst på skærmen
export function toast(tekst, slags = '') {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = tekst; t.className = `toast vis ${slags}`;
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('vis'), 3500);
}
export async function prøv(fn, ok) {
  try { await fn(); if (ok) toast(ok, 'ok'); return true; } catch (e) { toast(store.fejlTekst(e), 'fejl'); return false; }
}

// Kort lyd + vibration ved ny hændelse
let lydCtx;
export function bip() {
  try {
    lydCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = lydCtx.currentTime;
    [0, 0.18].forEach((d, i) => {
      const o = lydCtx.createOscillator(), g = lydCtx.createGain();
      o.frequency.value = i ? 1175 : 880; o.connect(g); g.connect(lydCtx.destination);
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.16); o.start(t + d); o.stop(t + d + 0.17);
    });
  } catch { /* ingen lyd */ }
  navigator.vibrate?.([200, 100, 200]);
}

// ------------------------------------------------------------------------------------
// Push-beskeder (også på låst telefon / lukket fane)
const erIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const påHjemmeskærm = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export function pushKanBruges() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return erIOS && !påHjemmeskærm()
      ? 'På iPhone skal Fotovagt først lægges på hjemmeskærmen: tryk Del → "Føj til hjemmeskærm", og åbn den derfra.'
      : 'Denne browser kan ikke modtage push-beskeder.';
  }
  return '';
}
const nøgleBytes = b64 => {
  const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
export async function abonnérPush() {
  const grund = pushKanBruges();
  if (grund) throw new Error(grund);
  if (await Notification.requestPermission() !== 'granted') throw new Error('Du har ikke givet lov til beskeder. Det kan ændres i indstillingerne.');
  const nøgle = window.FOTOVAGT_CONFIG?.vapidPublicKey || await store.pushNøgle();
  if (!nøgle) throw new Error('Push er ikke sat op endnu på serveren.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription()
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: nøgleBytes(nøgle) });
  await store.gemPush(sub.toJSON());
}
export async function afmeldPush() {
  const reg = await navigator.serviceWorker?.ready;
  const sub = await reg?.pushManager?.getSubscription();
  if (sub) { await store.sletPush(sub.endpoint).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
}

// ------------------------------------------------------------------------------------
// SOS: rød boks med fotografens navn, telefon og placering + alarmlyd
export const SOS_RADIUS_KM = 20;
export const aktiveSos = () => (store.state.sos || []).filter(s => s.aktiv);

// Rød boks til dem, der modtager alarmen (kontoret og kolleger)
export function sosBoks(s, { fra = null, kontor = false } = {}) {
  const p = store.state.profiler.find(x => x.id === s.bruger) || {};
  const kvit = s.kvitteret_af ? store.state.profiler.find(x => x.id === s.kvitteret_af) : null;
  const d = s.lat != null && fra?.lat != null ? km(fra, s) : null;
  const ios = /iPhone|iPad|Mac/.test(navigator.userAgent);
  const nav = s.lat != null ? (ios ? `https://maps.apple.com/?daddr=${s.lat},${s.lon}` : `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`) : null;
  return `
    <div class="sos-boks" data-sos="${s.id}" role="alert">
      <div class="sos-top"><span class="sos-ikon">🆘</span>
        <div><b class="sos-navn">${esc(p.navn || 'Ukendt fotograf')}</b> har trykket SOS
          <span class="sos-tid">kl. ${klokken(s.start)} · ${siden(s.start)} siden</span></div></div>
      <dl class="sos-info">
        <dt>Telefon</dt><dd>${p.telefon ? `<a href="tel:${esc(p.telefon)}">${esc(p.telefon)}</a>` : 'ikke oplyst'}</dd>
        <dt>Placering</dt><dd>${s.lat != null
          ? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}${s.noejagtighed ? ` (±${Math.round(s.noejagtighed)} m)` : ''}${d != null ? ` · <b>${kmTekst(d)} fra dig</b>` : ''}<br><small>opdateret ${siden(s.pos_tid || s.start)} siden</small>`
          : 'ukendt – ring til fotografen'}</dd>
        <dt>Status</dt><dd>${kvit ? `Set af ${esc(kvit.navn)} kl. ${klokken(s.kvitteret_tid)}` : '<b>Ingen har set alarmen endnu</b>'}</dd>
        <dt>På vej</dt><dd>${(s.paa_vej || []).length ? `${s.paa_vej.length} ${s.paa_vej.length === 1 ? 'person' : 'personer'}` : 'ingen endnu'}</dd>
      </dl>
      ${påVejTabel(s)}
      <div class="sos-knapper">
        ${p.telefon ? `<a class="knap" href="tel:${esc(p.telefon)}">📞 Ring til ${esc(p.navn || 'fotografen')}</a>` : ''}
        ${s.lat != null ? `<button data-sos-vis="${s.id}">📍 Vis på kortet</button>` : ''}
        ${nav ? `<a class="knap" href="${nav}" target="_blank" rel="noopener">🚗 Navigér</a>` : ''}
        ${!kontor && !(s.paa_vej || []).includes(store.state.mig?.id) ? `<button data-sos-vej="${s.id}" class="hvid">🚗 Jeg kører derhen</button>` : ''}
        ${!kvit ? `<button data-sos-set="${s.id}" class="hvid">✓ Set${kontor ? ' – vi tager os af det' : ''}</button>` : ''}
        ${kontor ? `<button data-sos-afslut="${s.id}" class="hvid">Afslut alarm</button>` : ''}
      </div>
      <p class="sos-112">Er der fare for liv: ring 112.</p>
    </div>`;
}

// "Anna (4,8 km), Ida (12 km)": hvem der kører til alarmen, og hvor langt de har
export function påVejTekst(s) {
  return (s.paa_vej || []).map(id => {
    const p = store.state.profiler.find(x => x.id === id);
    const d = p && s.lat != null && p.lat != null ? km(p, s) : null;
    return p ? `${esc(p.navn)}${d != null ? ` (${kmTekst(d)})` : ''}` : '';
  }).filter(Boolean).join(', ');
}

// Tabel over dem, der kører til alarmen: navn, telefon, afstand til SOS-stedet og placering
export function påVejTabel(s) {
  const rækker = (s.paa_vej || []).map(id => store.state.profiler.find(x => x.id === id)).filter(Boolean);
  if (!rækker.length) return '';
  return `<table class="sos-vej"><thead><tr><th>På vej</th><th>Telefon</th><th>Afstand</th><th>Placering</th></tr></thead><tbody>${rækker.map(p => {
    const d = s.lat != null && p.lat != null ? km(p, s) : null;
    return `<tr><td><b>${esc(p.navn)}</b></td>
      <td>${p.telefon ? `<a href="tel:${esc(p.telefon)}">${esc(p.telefon)}</a>` : '–'}</td>
      <td>${d != null ? kmTekst(d) : '–'}</td>
      <td>${p.lat != null ? `<a href="https://maps.google.com/?q=${p.lat},${p.lon}" target="_blank" rel="noopener">${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</a><br><small>${siden(p.pos_tid) || '?'} siden</small>` : 'ukendt'}</td></tr>`;
  }).join('')}</tbody></table>`;
}

export function sosIkon() {
  return L.divIcon({ className: '', html: '<div class="sos-pin">SOS</div>', iconSize: [54, 54], iconAnchor: [27, 27] });
}

// Alarmlyd, der gentages, indtil den stoppes
let alarmTimer = null;
export function alarm(til) {
  if (til && !alarmTimer) { bip(); alarmTimer = setInterval(() => { bip(); navigator.vibrate?.([400, 150, 400, 150, 400]); }, 1800); }
  if (!til && alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
}

// ------------------------------------------------------------------------------------
// Kort (Leaflet + OpenStreetMap)
// ------------------------------------------------------------------------------------
export function lavKort(el) {
  const cfg = window.FOTOVAGT_CONFIG || {};
  const kort = L.map(el, { zoomControl: true, attributionControl: true });
  // Start: hele Danmark passer i vinduet, uanset skærmstørrelse (præcis zoom følger, når der er punkter)
  kort.fitBounds(cfg.kortGrænser || [[54.56, 8.07], [57.75, 12.69]], { padding: [10, 10] });
  // Vis punkterne – og gør det igen, når kortet får sin rigtige størrelse (fx når appen åbnes på
  // telefonen eller fanen skiftes), så længe brugeren ikke selv har flyttet kortet
  let rørt = false;
  for (const ev of ['pointerdown', 'wheel']) el.addEventListener(ev, () => { rørt = true; }, { passive: true });
  kort.vis = (pkt, maxZoom = 12) => {
    kort._sidste = [pkt, maxZoom];
    if (!pkt.length || !el.offsetHeight || !el.offsetWidth) return;   // kortet er skjult: vent til det får en størrelse
    if (pkt.length > 1) kort.fitBounds(pkt, { padding: [40, 40], maxZoom, animate: false });
    else kort.setView(pkt[0], maxZoom, { animate: false });
  };
  new ResizeObserver(() => { kort.invalidateSize(); if (!rørt && kort._sidste) kort.vis(...kort._sidste); }).observe(el);
  setTimeout(() => kort.invalidateSize(), 200);
  window.addEventListener('resize', () => kort.invalidateSize());
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(kort);
  return kort;
}

// Kontorets prioritet: 1 = Høj, 2 = Normal, 3 = Lav
export const PRIO = { 1: { navn: 'Høj', kort: '🔴 Høj' }, 2: { navn: 'Normal', kort: 'Normal' }, 3: { navn: 'Lav', kort: '⚪ Lav' } };
export const prioAf = h => h?.prio || 2;
// Sortering: høj prioritet først, så nye før tagne, så nyeste først
export const efterPrio = (a, b) => (prioAf(a) - prioAf(b)) || ((b.status === 'ny') - (a.status === 'ny')) || b.oprettet.localeCompare(a.oprettet);
// Andre aktive hændelser i nærheden (til at prioritere, når der er mange i samme område)
export function iNærheden(h, alle, radiusKm = 10) {
  if (h.lat == null) return [];
  return alle.filter(x => x.id !== h.id && aktiv(x) && x.lat != null && km(h, x) <= radiusKm);
}

export function haendelsesIkon(h, valgt = false) {
  const ikon = ikonFor(h);
  return L.divIcon({
    className: '',
    html: `<div class="pin pin-${h.status}${valgt ? ' valgt' : ''}${h.status === 'ny' ? ' puls' : ''}${h.cirka ? ' cirka' : ''} prio-${prioAf(h)}"><span>${ikon}</span>${prioAf(h) === 1 ? '<b class="pin-prio">!</b>' : ''}</div>`,
    iconSize: [36, 36], iconAnchor: [18, 34], popupAnchor: [0, -30],
  });
}
export function fotografIkon(p, migSelv = false) {
  const initialer = (p.navn || '?').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
  return L.divIcon({
    className: '',
    html: `<div class="foto-pin${migSelv ? ' mig' : ''}${set(p) ? '' : ' gammel'}" style="--c:${STATUS[p.status]?.farve}">${esc(initialer)}</div>`,
    iconSize: [30, 30], iconAnchor: [15, 15],
  });
}

// Holder markører i sync med en liste uden at tegne alt forfra.
export function markørLag(kort) {
  const lag = L.layerGroup().addTo(kort);
  const m = new Map();
  return {
    lag,
    opdater(liste, lav) {
      const tilbage = new Set(m.keys());
      for (const x of liste) {
        if (x.lat == null || x.lon == null) continue;
        tilbage.delete(x.id);
        const { ikon, popup, klik } = lav(x);
        let mk = m.get(x.id);
        if (!mk) { mk = L.marker([x.lat, x.lon], { icon: ikon }).addTo(lag); m.set(x.id, mk); }
        else { mk.setLatLng([x.lat, x.lon]); mk.setIcon(ikon); }
        if (popup) mk.bindPopup(popup); else mk.unbindPopup();
        mk.off('click'); if (klik) mk.on('click', () => klik(x));
      }
      for (const id of tilbage) { lag.removeLayer(m.get(id)); m.delete(id); }
    },
    get: id => m.get(id),
  };
}

// ------------------------------------------------------------------------------------
// Log ind
// ------------------------------------------------------------------------------------
export async function logInd({ kunKontor = false } = {}) {
  const boks = $('#login');
  const vis = (felt) => { boks.hidden = false; $('#app').hidden = true; felt?.focus(); };
  let mig = null;
  try { mig = await store.init(); } catch (e) { $('#login-msg').textContent = store.fejlTekst(e); }
  if (mig && (!kunKontor || mig.rolle === 'kontor')) {
    boks.hidden = true; $('#app').hidden = false;
    // Kom ind via invitationsmailen: vælg adgangskode med det samme
    if (store.førsteLogin) setTimeout(() => åbnSkiftKode({ velkommen: mig.navn }), 400);
    return mig;
  }

  return new Promise(resolve => {
    const msg = $('#login-msg');
    if (mig && kunKontor) msg.textContent = 'Denne side er kun for kontoret. Log ind med en kontor-bruger.';
    if (store.demo) {
      $('#login-form').hidden = true;
      const demo = $('#login-demo'); demo.hidden = false;
      const profiler = store.profilerTilLogin().filter(p => !kunKontor || p.rolle === 'kontor');
      demo.querySelector('.demo-liste').innerHTML = profiler.map(p =>
        `<button type="button" class="${p.rolle === 'kontor' ? '' : 'secondary'}" data-id="${p.id}">${esc(p.navn)}<small>${p.rolle === 'kontor' ? 'Kontor' : 'Fotograf'}</small></button>`).join('');
      demo.onclick = async e => {
        const b = e.target.closest('[data-id]'); if (!b) return;
        const p = await store.login(b.dataset.id);
        boks.hidden = true; $('#app').hidden = false; resolve(p);
      };
      vis();
      return;
    }
    const form = $('#login-form');
    form.onsubmit = async e => {
      e.preventDefault(); msg.textContent = '';
      const knap = form.querySelector('button[type=submit]'); knap.disabled = true;
      try {
        const p = await store.login(form.email.value.trim(), form.password.value);
        if (kunKontor && p.rolle !== 'kontor') { await store.logout(); throw new Error('Din bruger er fotograf. Brug siden for marken.'); }
        boks.hidden = true; $('#app').hidden = false; resolve(p);
      } catch (err) { msg.textContent = store.fejlTekst(err); } finally { knap.disabled = false; }
    };
    $('#btn-glemt').onclick = async () => {
      const email = form.email.value.trim();
      if (!email) { msg.textContent = 'Skriv din e-mail først.'; return; }
      await prøv(() => store.glemt(email), 'Vi har sendt en mail med et link.');
    };
    // Ny bruger: kun e-mails, kontoret har inviteret, kan oprette en adgangskode
    let nyBruger = false;
    const login = form.onsubmit;
    if (!$('#btn-ny-bruger')) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'btn-ny-bruger'; b.className = 'link'; b.textContent = 'Ny bruger? Opret din adgangskode';
      $('#btn-glemt').after(b);
      const igen = document.createElement('label');
      igen.id = 'felt-igen'; igen.hidden = true;
      igen.innerHTML = 'Gentag adgangskode <input name="igen" type="password" autocomplete="new-password" minlength="8">';
      form.password.closest('label').after(igen);
    }
    const skiftTilstand = til => {
      nyBruger = til;
      $('#felt-igen').hidden = !til;
      form.password.autocomplete = til ? 'new-password' : 'current-password';
      form.querySelector('button[type=submit]').textContent = til ? 'Opret bruger' : 'Log ind';
      $('#btn-ny-bruger').textContent = til ? 'Har du allerede en bruger? Log ind' : 'Ny bruger? Opret din adgangskode';
      $('#btn-glemt').hidden = til;
      msg.textContent = til ? 'Brug den e-mail, kontoret har inviteret. Adgangskoden skal være mindst 8 tegn.' : '';
      msg.classList.toggle('info-tekst', til);
    };
    $('#btn-ny-bruger').onclick = () => skiftTilstand(!nyBruger);
    form.onsubmit = async e => {
      if (!nyBruger) return login(e);
      e.preventDefault(); msg.classList.remove('info-tekst'); msg.textContent = '';
      const email = form.email.value.trim(), pw = form.password.value;
      if (pw.length < 8) { msg.textContent = 'Adgangskoden skal være mindst 8 tegn.'; return; }
      if (pw !== form.igen.value) { msg.textContent = 'De to adgangskoder er ikke ens.'; return; }
      const knap = form.querySelector('button[type=submit]'); knap.disabled = true;
      try {
        const r = await store.opretBruger(email, pw);
        if (r?.profil) {
          if (kunKontor && r.profil.rolle !== 'kontor') { await store.logout(); throw new Error('Din bruger er fotograf. Brug siden for marken.'); }
          boks.hidden = true; $('#app').hidden = false; return resolve(r.profil);
        }
        skiftTilstand(false);
        msg.classList.add('info-tekst');
        msg.textContent = `Næsten færdig: vi har sendt en mail til ${email}. Tryk på linket i mailen, og log så ind her.`;
      } catch (err) { msg.textContent = store.fejlTekst(err); } finally { knap.disabled = false; }
    };
    vis(form.email);
  });
}

// Nedtælling: elementer med data-udloeber="<ISO-tid>" viser m:ss tilbage
export function nedtælling(iso) {
  const s = Math.max(0, Math.round((new Date(iso) - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
setInterval(() => document.querySelectorAll('[data-udloeber]').forEach(el => { el.textContent = nedtælling(el.dataset.udloeber); }), 1000);

// I demo (?demo i adressen) beholder links mellem Marken og Kontor demo-tilstanden
if (/[?&]demo\b/.test(location.search)) {
  document.querySelectorAll('a[href="index.html"], a[href="kontor.html"]').forEach(a => { a.href = a.getAttribute('href') + '?demo'; });
}

// ---------------------------------------------------------------------------------
// Tidslinje på en hændelse: første melding, live opdateringer fra andre kilder (Pushover, politi,
// nyheder) og kommentarer fra fotografer og kontoret – alt i tidsrækkefølge.
export const kommentarerTil = id => (store.state.kommentarer || []).filter(k => k.haendelse_id === id);

export function tidslinjePunkter(h, kommentarer = kommentarerTil(h.id)) {
  const linjer = String(h.tekst || '').split('\n');
  const start = new Date(h.oprettet);
  const punkter = [];
  const første = linjer.filter(l => !l.startsWith('— ')).join('\n').trim();
  punkter.push({ type: 'melding', tid: start, kilde: h.app || h.kilde || '', tekst: første });
  for (const l of linjer.filter(l => l.startsWith('— '))) {
    const m = l.match(/^— kl\. (\d\d)[.:](\d\d) ([^:]+): ([\s\S]*)$/);
    let tid = start;
    if (m) {
      tid = new Date(start); tid.setHours(+m[1], +m[2], 0, 0);
      if (tid < start - 60e3) tid = new Date(tid.getTime() + 864e5);   // over midnat
    }
    punkter.push({ type: 'opdatering', tid, kilde: m ? m[3] : 'Opdatering', tekst: m ? m[4] : l.slice(2) });
  }
  for (const k of kommentarer) punkter.push({ type: 'kommentar', tid: new Date(k.oprettet), k });
  const orden = { melding: 0, opdatering: 1, kommentar: 2 };
  return punkter.sort((a, b) => (a.tid - b.tid) || (orden[a.type] - orden[b.type]));   // første melding først ved samme minut
}

// Seneste nye ting på hændelsen (til kortene i listerne)
export function senesteNyt(h) {
  const p = tidslinjePunkter(h).filter(x => x.type !== 'melding').pop();
  if (!p) return null;
  const navn = id => store.state.profiler.find(x => x.id === id)?.navn || 'Kontoret';
  return p.type === 'kommentar'
    ? { ikon: '💬', tekst: `${navn(p.k.bruger)}: ${p.k.tekst}`, tid: p.tid }
    : { ikon: '🔄', tekst: `${p.kilde}: ${p.tekst}`, tid: p.tid };
}

export function tidslinjeHtml(h) {
  const mig = store.state.mig || {};
  const navn = id => store.state.profiler.find(x => x.id === id)?.navn || 'Ukendt';
  const kl = d => d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  const punkter = tidslinjePunkter(h);
  return `
    <section class="tidslinje-boks" aria-label="Tidslinje">
      <h3 class="tl-titel">Tidslinje <small>${punkter.length - 1 ? `${punkter.length - 1} opdatering${punkter.length > 2 ? 'er' : ''}` : 'ingen opdateringer endnu'}</small></h3>
      <ol class="tidslinje">${punkter.map(p => {
        if (p.type === 'kommentar') {
          const k = p.k, kanRette = k.bruger === mig.id || mig.rolle === 'kontor';
          return `<li class="tl-punkt tl-kommentar${k.offentlig ? ' offentlig' : ''}">
            <div class="tl-hoved"><b>💬 ${esc(navn(k.bruger))}</b><span class="tl-tid">${kl(p.tid)}</span>
              <span class="tl-maerke">${k.offentlig ? '🌐 Døgnrapport' : '🔒 Intern'}</span></div>
            <p>${esc(k.tekst).replace(/\n/g, '<br>')}</p>
            ${kanRette ? `<div class="tl-knapper">
              <button type="button" class="link" data-k-offentlig="${k.id}" data-v="${k.offentlig ? 0 : 1}">${k.offentlig ? 'Gør intern' : 'Vis på døgnrapporten'}</button>
              <button type="button" class="link fare" data-k-slet="${k.id}">Slet</button></div>` : ''}
          </li>`;
        }
        return `<li class="tl-punkt tl-${p.type}">
          <div class="tl-hoved"><b>${p.type === 'melding' ? '📟 Første melding' : '🔄 ' + esc(p.kilde)}</b><span class="tl-tid">${kl(p.tid)}</span>
            ${p.type === 'melding' && p.kilde ? `<span class="tl-kilde">${esc(p.kilde)}</span>` : ''}</div>
          ${p.tekst ? `<p>${esc(p.tekst).replace(/\n/g, '<br>')}</p>` : ''}
        </li>`;
      }).join('')}</ol>
      <form class="kommentar-form" data-kommentar="${h.id}">
        <label class="skjult-label" for="k-${h.id}">Kommentar</label>
        <textarea id="k-${h.id}" name="tekst" rows="2" maxlength="2000" placeholder="Skriv en kommentar til kontoret og kollegerne …"></textarea>
        <div class="kommentar-bund">
          <label class="check"><input type="checkbox" name="offentlig"> Vis på døgnrapporten <small>(offentlig, uden navn)</small></label>
          <button type="submit">Send</button>
        </div>
      </form>
    </section>`;
}

// Gentegn et område uden at miste det, man er ved at skrive i kommentarfeltet
export function gentegnMedFormular(el, html) {
  const f = el.querySelector('form.kommentar-form');
  const gemt = f ? { tekst: f.tekst.value, off: f.offentlig.checked, fokus: document.activeElement === f.tekst, pos: f.tekst.selectionStart } : null;
  const top = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = top;
  const ny = el.querySelector('form.kommentar-form');
  if (gemt && ny) {
    ny.tekst.value = gemt.tekst; ny.offentlig.checked = gemt.off;
    if (gemt.fokus) { ny.tekst.focus(); try { ny.tekst.setSelectionRange(gemt.pos, gemt.pos); } catch { /* ok */ } }
  }
}

// Send, gør offentlig/intern og slet – virker i alle tidslinjer inde i el
export function kommentarHandlinger(el) {
  el.addEventListener('submit', async e => {
    const f = e.target.closest('form.kommentar-form'); if (!f) return;
    e.preventDefault();
    const tekst = f.tekst.value.trim();
    if (!tekst) return toast('Skriv en kommentar først.', 'fejl');
    const off = f.offentlig.checked;
    const knap = f.querySelector('button[type=submit]'); knap.disabled = true;
    const ok = await prøv(() => store.kommenter(f.dataset.kommentar, tekst, off), off ? 'Sendt – vises også på døgnrapporten.' : 'Kommentaren er sendt.');
    knap.disabled = false;
    if (ok) { const g = el.querySelector(`form.kommentar-form[data-kommentar="${f.dataset.kommentar}"]`); if (g) { g.tekst.value = ''; g.offentlig.checked = false; } }
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.closest('form.kommentar-form')) e.target.closest('form').requestSubmit();
  });
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-k-offentlig],[data-k-slet]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.kSlet) { if (confirm('Slet kommentaren?')) await prøv(() => store.sletKommentar(b.dataset.kSlet), 'Kommentaren er slettet.'); return; }
    const off = b.dataset.v === '1';
    await prøv(() => store.retKommentar(b.dataset.kOffentlig, off), off ? 'Vises nu på døgnrapporten.' : 'Kommentaren er nu intern.');
  }, true);
}

// Sådan står stedet på døgnrapporten: aldrig vej og husnummer
export function offentligSted(h) {
  if (h.omraade) return h.omraade;
  const dele = String(h.adresse || '').split(',').map(x => x.trim()).filter(Boolean)
    .filter(d => (/^\d{4}\s/.test(d) || !/\d/.test(d)) && (/motorvej/i.test(d) || !/(vej|gade|allé|alle|stræde|torv|plads|boulevard|vænget|parken|stien|vangen|have|bakken|toften)$/i.test(d)));
  return dele.join(', ');
}

// Skift adgangskode (samme dialog i Marken og på Kontoret)
export function åbnSkiftKode({ velkommen = null } = {}) {
  let dlg = $('#dlg-kode');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'dlg-kode'; dlg.className = 'ark';
    dlg.innerHTML = `
      <form method="dialog" class="ark-indhold" id="form-kode">
        <h2 id="kode-titel">Skift adgangskode</h2>
        <p class="hint" id="kode-velkommen" hidden></p>
        <input type="text" name="brugernavn" autocomplete="username" hidden>
        <label>Ny adgangskode <input name="ny" type="password" autocomplete="new-password" minlength="8" required></label>
        <label>Gentag ny adgangskode <input name="igen" type="password" autocomplete="new-password" minlength="8" required></label>
        <p class="hint">Mindst 8 tegn. Du forbliver logget ind på denne enhed.</p>
        <p class="fejl-tekst" id="kode-fejl" role="alert"></p>
        <div class="knap-række">
          <button value="gem" type="submit">Skift adgangskode</button>
          <button value="luk" type="button" class="secondary" data-luk-kode>Annullér</button>
        </div>
      </form>`;
    document.body.append(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-luk-kode]')) dlg.close(); });
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, fejl = $('#kode-fejl');
      fejl.textContent = '';
      if (f.ny.value.length < 8) { fejl.textContent = 'Adgangskoden skal være mindst 8 tegn.'; return; }
      if (f.ny.value !== f.igen.value) { fejl.textContent = 'De to adgangskoder er ikke ens.'; return; }
      const knap = f.querySelector('button[type=submit]'); knap.disabled = true;
      try { await store.skiftKode(f.ny.value); dlg.close(); toast('Din adgangskode er skiftet.', 'ok'); }
      catch (err) { fejl.textContent = store.fejlTekst(err); }
      finally { knap.disabled = false; }
    });
  }
  const f = dlg.querySelector('form'); f.reset(); $('#kode-fejl').textContent = '';
  $('#kode-titel').textContent = velkommen ? `Velkommen til Fotovagt${typeof velkommen === 'string' ? `, ${velkommen}` : ''}` : 'Skift adgangskode';
  $('#kode-velkommen').hidden = !velkommen;
  $('#kode-velkommen').textContent = 'Vælg din adgangskode. Næste gang logger du ind med din e-mail og den.';
  f.querySelector('button[type=submit]').textContent = velkommen ? 'Gem adgangskode' : 'Skift adgangskode';
  f.brugernavn.value = store.state.mig?.navn || '';
  for (const d of document.querySelectorAll('dialog[open]')) if (d !== dlg) d.close();
  dlg.showModal();
  setTimeout(() => f.ny.focus(), 50);
}

// ---------------------------------------------------------------------------------
// Ny version af appen: en app på hjemmeskærmen genindlæses sjældent af sig selv. Vi tjekker
// version.json, når appen kommer frem igen (og hvert 10. minut), og opdaterer, når det er sikkert.
let kendtVersion = null;
async function tjekVersion() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const { version } = await r.json();
    if (!kendtVersion) { kendtVersion = version; return; }
    if (version === kendtVersion) return;
    const iGang = document.querySelector('dialog[open]') || [...document.querySelectorAll('textarea')].some(t => t.value.trim());
    if (!iGang && document.visibilityState === 'visible') return location.reload();
    if (document.getElementById('ny-version')) return;
    const b = document.createElement('button');
    b.id = 'ny-version'; b.className = 'ny-version'; b.textContent = '🔄 Ny version af Fotovagt – tryk for at opdatere';
    b.onclick = () => location.reload();
    document.body.append(b);
  } catch { /* offline: prøv senere */ }
}
tjekVersion();
setInterval(tjekVersion, 10 * 60e3);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tjekVersion(); });

// ---------------------------------------------------------------------------------
// Assistenten: lærer af tidligere hændelser og kontorets beslutninger (databasefunktionen ai_indsigt).
// Svaret gemmes et par minutter pr. hændelse og hentes igen, når der kommer nyt i teksten.
const indsigtCache = new Map();
export function indsigt(h, nårKlar) {
  const c = indsigtCache.get(h.id), længde = (h.tekst || '').length + (h.prio || 0);
  if (c && (c.henter || (c.længde === længde && Date.now() - c.t < 120e3))) return c.data;
  indsigtCache.set(h.id, { ...(c || {}), henter: true });
  store.indsigt(h.id)
    .then(data => { indsigtCache.set(h.id, { data, længde, t: Date.now() }); nårKlar?.(data); })
    .catch(() => indsigtCache.set(h.id, { data: c?.data ?? null, længde, t: Date.now() }));
  return c?.data;
}
// Køretøjsnavne som i Beredskabsstyrelsens vejledning (automobilsprøjte, vandtankvogn, drejestige)
const ENHEDSNAVN = { ISL: 'indsatsleder', OC: 'operationschef', M: 'autosprøjte', V: 'vandtankvogn', S: 'drejestige/lift' };
// Stationer i Østjyllands Brandvæsen (plan 2026-2030 og Station-feltet i jeres egne beskeder): døgnstationerne
// Nord (Lisbjerg), City og Syd (Højbjerg), deltidsstationerne Odder og Skanderborg, og indsatslederne Nord og Syd.
// Andre forkortelser vises som de står.
const STATIONER = { CI: 'Aarhus City', NO: 'Aarhus Nord', SY: 'Aarhus Syd', OD: 'Odder', SK: 'Skanderborg' };

// Viden fra beredskabernes egne planer for risikobaseret dimensionering
const BEREDSKABER = {
  ostjylland: {
    navn: 'Østjyllands Brandvæsen', kilde: 'plan 2026–2030',
    tekst: 'Døgnstationer: Aarhus Nord, City og Syd; deltid bl.a. Odder, Hørning, Skanderborg, Ry. Indsatsleder Nord og Syd. Nærmeste relevante enhed sendes altid.',
    minimum: t => /højhus/.test(t) && /bygn|brand/.test(t) ? '3+4+20+2 ved bekræftet brand i højhus'
      : /\baba\d*\b|automatisk brandalarm/.test(t) ? '1+5 (nogle ABA-objekter: indsatsleder med, 1+1+5, eller 1+2+10)'
      : /bygn\.?\s?brand|bygningsbrand|campingvogn|kolonihave|sommerhus|parcelhus|villa|lejlighed|etage/.test(t) ? '1+1+5 – indsatsleder, holdleder og 5 brandfolk'
      : /knallert|skraldespand|container|affald|i det fri/.test(t) ? '1+3 – holdleder og 3 brandfolk' : null,
  },
  midtjysk: {
    navn: 'Midtjysk Brand & Redning', kilde: 'plan 2026–2029',
    tekst: 'Viborg og Silkeborg kommuner, 10 stationer. Alle har sprøjte og tankvogn – det er førsteudrykningen. Drejestige, redningsvogn og specialer kommer fra Viborg eller Silkeborg (CBRNE kun Viborg). Indsatsleder Nord (Viborg) og Syd (Silkeborg). Gennemsnitlig responstid 6,8 min.',
    minimum: t => /drejestige|højde|etage|lejlighed/.test(t) ? '1+3 på autosprøjten, +2 pr. specialkøretøj (fx drejestige)' : '1+3 på første autosprøjte',
  },
};
export function beredskabFor(h) {
  const t = `${h.titel || ''}\n${h.tekst || ''}`;
  const b = (/Beredskab:\s*([^\n·]+)/i.exec(t) || [])[1] || '';
  if (/østjylland/i.test(b) || (!b && /\b(CI|NO|SY|OD|SK)[\s-]?(?:MR|[MVSRBTKH])[\s-]?\d/.test(t))) return BEREDSKABER.ostjylland;
  if (/midtjysk/i.test(b)) return BEREDSKABER.midtjysk;
  return null;
}
const enhedNavn = k => { const m = /^([A-ZÆØÅ]{2,3})-/.exec(k) || /^ISL (NO|SY)$/.exec(k); return m && STATIONER[m[1]] ? `${esc(k)} <small>${k.startsWith('ISL') ? 'indsatsleder ' + STATIONER[m[1]].split(' ')[1] : STATIONER[m[1]]}</small>` : esc(k); };
// Hændelsesniveau og minimumsbemanding efter Østjyllands Brandvæsens plan for risikobaseret dimensionering 2026-2030
// (holdleder + brandfolk; "1+1+5" = indsatsleder + holdleder + 5 brandfolk)
export function beredskabsNiveau(h) {
  const t = `${h.titel || ''}\n${h.tekst || ''}`;
  const isl = new Set((t.match(/\bISL\s+[A-ZÆØÅ]{2,3}\b/g) || []).map(x => x.replace(/\s+/g, ' '))).size;
  if (/\bOC\b/.test(t) || (h.antal_ass || 0) >= 3) return { navn: 'Ekstraordinær hændelse', tekst: 'operationschefen rekvirerer assistance' };
  if (h.eskaleret || isl >= 2 || (h.antal_enheder || 0) >= 5) return { navn: 'Større hændelse', tekst: 'minimum 1+2+10' };
  return { navn: 'Hverdagshændelse', tekst: 'nærmeste relevante enhed' };
}
export function minimumsbemanding(h) {
  const b = beredskabFor(h);
  return b ? b.minimum((h.titel || '').toLowerCase()) : null;
}
const pct = x => `${Math.round((x || 0) * 100)} %`;
const varighedTekst = m => m == null ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} t ${m % 60 ? `${m % 60} min` : ''}`.trim();
export function indsigtHtml(h, d, { kontor = false } = {}) {
  if (d === undefined) return '<div class="ai-boks"><p class="ai-top">🤖 Assistent</p><p class="lille">Tænker …</p></div>';
  if (!d || !d.n) return '<div class="ai-boks"><p class="ai-top">🤖 Assistent</p><p class="lille">Ingen lignende hændelser endnu – assistenten lærer, efterhånden som der kommer flere.</p></div>';
  const typer = (d.enhedstyper || []).filter(t => t.andel >= 0.2);
  const her = d.enheder_her || [];
  const p = d.forslag_prio, nu = prioAf(h);
  return `<div class="ai-boks">
    <p class="ai-top">🤖 Assistent <small>lærer af ${d.n} lignende (${esc(d.niveau)})</small></p>
    ${typer.length ? `<p><b>Normal førsteudrykning:</b> ${typer.map(t => `${esc(t.type)}${ENHEDSNAVN[t.type] ? ` <small>${ENHEDSNAVN[t.type]}</small>` : ''} ${pct(t.andel)}`).join(' · ')}${d.typisk_foerste ? ` · typisk ${d.typisk_foerste} enheder` : ''}</p>`
      : '<p class="lille">Ingen enheder i de lignende beskeder endnu.</p>'}
    ${her.length ? `<p><b>Plejer at køre${d.sted ? ` (${esc(d.sted)})` : ''}:</b> ${her.map(e => enhedNavn(e.enhed)).join(', ')}</p>` : ''}
    ${(niv => `<p><b>Niveau:</b> ${niv.navn} <small>(${niv.tekst})</small>${minimumsbemanding(h) ? `<br><small>Minimumsbemanding: ${minimumsbemanding(h)}</small>` : ''}</p>`)(beredskabsNiveau(h))}
    ${(b => b ? `<p class="lille">🚒 <b>${esc(b.navn)}</b> (${esc(b.kilde)}): ${esc(b.tekst)}</p>` : '')(beredskabFor(h))}
    ${d.n_med_enheder ? `<p class="lille">Ekstra enheder/assistance tilkaldt senere ved ${pct(d.andel_ekstra)} af de lignende${(d.ekstra_nu || []).length ? ` · <b>her: ${d.ekstra_nu.map(enhedNavn).join(', ')}</b>` : ''}</p>` : ''}
    <p><b>Forslag:</b> <span class="prio-tekst p${p}">${PRIO[p]?.navn || 'Normal'} prioritet</span> · alvor ${esc(d.alvor)}
      <br><small>${(d.grund || []).map(esc).join(' · ')}</small></p>
    <p class="lille">Fotograf kørte på ${pct(d.andel_foto)} af de lignende${d.varighed_min != null ? ` · de varer typisk ${varighedTekst(d.varighed_min)}` : ''}</p>
    ${kontor && aktiv(h) && p && p !== nu ? `<button class="secondary lille-knap" data-prio="${h.id}" data-p="${p}">Brug forslaget: ${PRIO[p].navn}</button>` : ''}
  </div>`;
}
