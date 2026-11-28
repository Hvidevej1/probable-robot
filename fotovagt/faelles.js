// Fælles for Marken og Kontoret: tekster, farver, tid, afstand, kort og log ind.
import { store } from './store.js';

export const STATUS = {
  ledig: { tekst: 'Ledig', farve: 'var(--ledig)', klasse: 's-ledig' },
  optaget: { tekst: 'Optaget', farve: 'var(--optaget)', klasse: 's-optaget' },
  pause: { tekst: 'Pause', farve: 'var(--pause)', klasse: 's-pause' },
  ankommet: { tekst: 'Ankommet', farve: 'var(--ankommet)', klasse: 's-ankommet' },
  offline: { tekst: 'Offline', farve: 'var(--offline)', klasse: 's-offline' },
};
export const H_STATUS = {
  ny: 'Ny', taget: 'Taget', ankommet: 'Fotograf ankommet', afsluttet: 'Afsluttet', annulleret: 'Annulleret',
};
// Kort statustekst til pillen på fotografens hændelseskort
export const H_STATUS_KORT = { ny: 'Ledig', taget: 'Taget', ankommet: 'På stedet', afsluttet: 'Afsluttet', annulleret: 'Annulleret' };
export const KATEGORI_IKON = {
  Brand: '🔥', Trafik: '🚗', Politi: '🚓', Redning: '🛟', Miljø: '☣️', Vejr: '🌧️', Forsyning: '🔧', Andet: '📍',
};
// Ikonet for en hændelse: kategorien, men lægehelikopter får en helikopter og indsatsleder-opgaver (ISL) en brandmand
export const ikonFor = h => /helikopter/i.test(h?.titel || '') ? '🚁'
  : erTog(h) ? '🚆'
  : /^\s*(?:ISL\b|indsatsleder)/i.test(h?.titel || '') ? '🧑‍🚒' : (KATEGORI_IKON[h?.kategori] || '📍');
// Togmeldinger (DSB, Banedanmark, Arriva, letbane …) – samme regel som er_tog() i databasen
export const erTog = h => /^tog:/i.test(h?.titel || '') || /\b(?:dsb|banedanmark|arriva|letbane|s-tog|regionaltog|lyntog|intercity)\b|\(tog\)/i.test(`${h?.titel || ''} ${h?.tekst || ''}`);
const TOG_ALVORLIG = /påkør|personulykke|ulykke|afspor|brand|røgudvikling|\brøg\b|evakuer|sammenstød|kollision|eksplosion|bombe|politi/i;
// "Hvad sker der" for en togmelding: forsinkelse/aflysning/stop, årsag og vurdering
export function togForklaring(h) {
  const t = String(h?.tekst || '').replace(/\n— kl\.[^:]*:/g, ' ');
  const min = (/ca\.?\s*(\d+)\s*min/i.exec(t) || [])[1];
  const hvad = /aflys/i.test(t) ? 'Tog aflyst' : /holder stille|kører ikke|ingen tog|spærret/i.test(t) ? 'Togene holder stille' : /forsink|senere end planlagt/i.test(t) ? `Forsinkelse${min ? ` ca. ${min} min` : ''}` : 'Togmelding';
  const årsag = ((/(?:skyldes|på grund af|pga\.?)\s+(?:at\s+)?([^.]{3,90})/i.exec(t) || [])[1] || '').trim();
  const alvorlig = TOG_ALVORLIG.test(t);
  const vurdering = alvorlig ? 'Kan være en ulykke eller politiaktion på banen – normal prioritet'
    : /ambulance/i.test(årsag) ? 'Formentlig en syg passager – ikke en ulykke, lav prioritet'
    : 'Driftsforstyrrelse – ikke en ulykke, lav prioritet';
  return { hvad, årsag, vurdering, alvorlig };
}
// Seneste live opdatering, der er lagt ind i hændelsen ("— kl. 19:42 PF-Upload: …")
export function senesteOpdatering(h) {
  const l = String(h?.tekst || '').split('\n').filter(x => x.startsWith('— ')).pop();
  return l ? l.slice(2) : '';
}
export const aktiv = h => ['ny', 'taget', 'ankommet'].includes(h.status);

// Kun http(s)-links godtages fra beskeder (et "javascript:"-link ville kunne køre kode, selvom det er escapet)
export const sikkerUrl = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : null;
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
// Grov køretid: 75 km/t i snit + 3 min til at komme af sted. Kun til at sammenligne opgaver.
export function køretid(d) {
  if (d == null) return '';
  const m = Math.round(d / 75 * 60 + 3);
  return m < 60 ? `ca. ${m} min` : `ca. ${Math.floor(m / 60)} t${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
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
// Profilbilleder (tabellen profilfoto): lille rundt billede – ellers initialer
// Kun rene JPEG-data godtages (databasen tjekker det samme) – og værdien escapes alligevel, før den sættes i HTML
const RENT_FOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
export const fotoAf = id => { const f = store.state.fotos?.[id]; return f && RENT_FOTO.test(f) ? f : null; };
const initialerAf = p => (p?.navn || '?').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
export function avatar(p, str = 36) {
  const f = fotoAf(p?.id), c = STATUS[p?.status]?.farve || 'var(--offline)';
  return f
    ? `<img class="avatar" src="${esc(f)}" alt="" style="--s:${str}px;--c:${c}" loading="lazy">`
    : `<span class="avatar avatar-tom" style="--s:${str}px;--c:${c}">${esc(initialerAf(p))}</span>`;
}
export function fotografIkon(p, migSelv = false) {
  const f = fotoAf(p.id);
  return L.divIcon({
    className: '',
    html: `<div class="foto-pin${migSelv ? ' mig' : ''}${set(p) ? '' : ' gammel'}${f ? ' har-foto' : ''}" style="--c:${STATUS[p.status]?.farve}">${f ? `<img src="${esc(f)}" alt="">` : esc(initialerAf(p))}</div>`,
    iconSize: [30, 30], iconAnchor: [15, 15],
  });
}

// Lægehelikoptere ("Doc") live på kortet – positioner fra adsb.lol via databasen (helikopter.sql).
// Viser kun helikoptere set inden for 6 timer; ældre end 15 min tegnes blege med "sidst set".
export function helikopterLag(kort) {
  const lag = markørLag(kort);
  kort.attributionControl?.addAttribution('Helikoptere: <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> (ODbL)');
  const tegn = () => lag.opdater((store.state.helikoptere || []).map(x => ({ ...x, id: x.hex })), x => {
    const min = (Date.now() - new Date(x.set)) / 60e3, gammel = min > 15;
    const status = x.paa_jorden ? 'på jorden' : x.hoejde_ft != null ? `i luften · ${Math.round(x.hoejde_ft * 0.3048 / 10) * 10} m · ${Math.round((x.fart_kt || 0) * 1.852)} km/t` : 'i luften';
    return {
      z: 1500,
      ikon: L.divIcon({ className: '', html: `<div class="heli-pin${gammel ? ' gammel' : ''}${x.paa_jorden ? ' jorden' : ''}" title="${esc(x.kaldesignal || 'Doc')}"><span>🚁</span><b>${esc(x.kaldesignal || '')}</b></div>`, iconSize: [44, 44], iconAnchor: [22, 22] }),
      popup: `<b>🚁 Akutlægehelikopter ${esc(x.kaldesignal || '')}</b><br>${esc([x.reg, x.type].filter(Boolean).join(' · '))}<br>${status}<br><small>${min < 1 ? 'set lige nu' : `sidst set for ${siden(x.set)} siden`}</small>`,
    };
  });
  store.lyt(tegn); tegn();
  setInterval(() => { if (!document.hidden) tegn(); }, 60e3);   // "sidst set" og blegning holdes opdateret
  return lag;
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
        const { ikon, popup, klik, z = 0 } = lav(x);
        let mk = m.get(x.id);
        if (!mk) { mk = L.marker([x.lat, x.lon], { icon: ikon, zIndexOffset: z }).addTo(lag); m.set(x.id, mk); }
        else { mk.setLatLng([x.lat, x.lon]); mk.setIcon(ikon); mk.setZIndexOffset(z); }
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
    // Kom fra et mail-link, der er udløbet eller allerede brugt (Supabase sender fejlen med i adressen)
    const linkFejl = new URLSearchParams(location.hash.slice(1));
    if (linkFejl.get('error_code') || linkFejl.get('error')) {
      msg.textContent = /expired|invalid/i.test(linkFejl.get('error_code') + linkFejl.get('error_description'))
        ? 'Linket i mailen er udløbet eller allerede brugt. Bed kontoret trykke "Send igen" – eller log ind, hvis du allerede har valgt adgangskode.'
        : `Linket virkede ikke: ${linkFejl.get('error_description') || linkFejl.get('error')}`;
      history.replaceState(null, '', location.pathname + location.search);
    }
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
        if (await lækketKode(pw)) { msg.textContent = LÆKKET_TEKST; return; }
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
setInterval(() => {
  if (document.hidden) return;
  const els = document.querySelectorAll('[data-udloeber]');
  if (els.length) els.forEach(el => { el.textContent = nedtælling(el.dataset.udloeber); });
}, 1000);

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

// Lækkede adgangskoder (HaveIBeenPwned, k-anonymitet): kun de første 5 tegn af SHA-1 sendes,
// aldrig adgangskoden. Svarer tjenesten ikke, lukkes der igennem (Supabase-reglerne gælder stadig).
export async function lækketKode(pw) {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(pw));
    const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch('https://api.pwnedpasswords.com/range/' + hex.slice(0, 5), { headers: { 'Add-Padding': 'true' }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return 0;
    const rest = hex.slice(5);
    for (const linje of (await r.text()).split('\n')) {
      const [suf, n] = linje.trim().split(':');
      if (suf === rest) return parseInt(n, 10) || 0;
    }
    return 0;
  } catch { return 0; }
}
export const LÆKKET_TEKST = 'Den adgangskode er kendt fra datalæk og kan gættes. Vælg en anden.';

// Bjælke øverst, når forbindelsen til serveren er tabt (realtime) eller telefonen er uden net
function forbindelsesBjælke() {
  let el = document.getElementById('forbindelse-bjaelke');
  const tabt = !navigator.onLine || store.state.forbindelse === 'tabt';
  if (!tabt) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'forbindelse-bjaelke'; el.className = 'forbindelse-bjaelke'; el.setAttribute('role', 'status');
    document.body.prepend(el);
  }
  el.textContent = navigator.onLine ? 'Forbindelsen til Fotovagt er tabt – prøver igen …' : 'Ingen net. Det, du ser, kan være forældet.';
  el.hidden = false;
}
if (!store.demo) {
  store.lyt(forbindelsesBjælke);
  window.addEventListener('online', forbindelsesBjælke);
  window.addEventListener('offline', forbindelsesBjælke);
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
      try {
        if (await lækketKode(f.ny.value)) { fejl.textContent = LÆKKET_TEKST; return; }
        await store.skiftKode(f.ny.value); dlg.close(); toast('Din adgangskode er skiftet.', 'ok'); }
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
    // Versionsnummer vises i appen ("Fotovagt 11.02"): store ændringer/nye funktioner = nyt hovednummer, ellers .01-trin
    document.querySelectorAll('[data-version]').forEach(e => { e.textContent = `Fotovagt ${version}`; });
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
  const c = indsigtCache.get(h.id), længde = (h.tekst || '').length + (h.prio || 0) + (h.vejr ? 1e6 : 0);   // nyt vejr = ny vurdering
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
const enhedNavn = k => { const m = /^([A-ZÆØÅ]{2,3})-/.exec(k) || /^ISL (NO|SY)$/.exec(k); return m && STATIONER[m[1]] ? `${esc(k)} <small>${k.startsWith('ISL') ? 'indsatsleder ' + STATIONER[m[1]].split(' ')[1] : STATIONER[m[1]]}</small>` : esc(k); };

// Viden fra beredskabernes egne planer for risikobaseret dimensionering. Alle 29 kommunale redningsberedskaber
// (liste fra RBIS) er med med region og hjemmeside; dem, hvis plan er læst, har også fakta og minimumsbemanding.
const B = (navn, region, web, match, ekstra = {}) => ({ navn, region, web, match, ...ekstra });
const BEREDSKABER = [
  // Hovedstaden
  B('Hovedstadens Beredskab', 'Hovedstaden', 'https://www.hbr.dk', /hovedstadens beredskab/i),
  B('Beredskab Øst', 'Hovedstaden', 'https://beros.dk', /beredskab øst/i, { kilde: 'plan 2025',
    tekst: 'Ballerup, Gentofte, Gladsaxe og Lyngby. Fire stationer med døgnhold på 1+5 (afgang ca. 1 min) og deltid 1+5 som 2. udrykning. To indsatsledere på vagt, den ene på døgnvagt i Gladsaxe.' }),
  B('Beredskab 4K', 'Hovedstaden', 'https://beredskab4k.dk/', /beredskab 4k/i),
  B('Frederiksborg Brand & Redning', 'Hovedstaden', 'http://www.fbbr.dk', /frederiksborg brand/i, { kilde: 'RBD25',
    tekst: 'Basisberedskab på alle stationer: tanksprøjte + vandtankvogn (typisk 1+5, enkelte 1+3). Båd og hurtig slukningsenhed på udvalgte stationer. Altid to indsatsledere på vagt – nærmeste tilkaldes.' }),
  B('Nordsjællands Brandvæsen', 'Hovedstaden', 'http://www.nsbv.dk/', /nordsjællands brandvæsen/i),
  B('Helsingør Kommunes Beredskab', 'Hovedstaden', 'https://beredskab.helsingor.dk/', /helsingør/i, { kilde: 'plan for RBD',
    tekst: 'Fire stationer: Helsingør, Espergærde, Tikøb og Hornbæk. Bygget på taktiske enheder på 1+3; nærmeste auto-/tanksprøjte sendes, evt. med køretøjer fra næstnærmeste station. Udrykningen er fastlagt pr. meldingskode i 112-picklisten.',
    minimum: () => '1+3 pr. taktisk enhed' }),
  B('Gribskov Beredskab', 'Hovedstaden', 'https://www.gribskov.dk/erhverv/gribskov-beredskab/', /gribskov/i),
  B('Tårnby Brandvæsen', 'Hovedstaden', 'http://tb.taarnby.dk', /tårnby/i, { tekst: 'M1–M3 er autosprøjter, S1 en 32 m stigevogn og V1 en tankvogn med knap 8.000 liter vand.', kilde: 'køretøjsliste' }),
  B('Bornholms Brandvæsen', 'Hovedstaden', 'https://www.brk.dk/Borger/beredskab/Sider/Brand-og-beredskab.aspx', /bornholm/i),
  // Sjælland
  B('Roskilde Brandvæsen', 'Sjælland', 'https://brandvaesen.roskilde.dk/', /roskilde brandvæsen/i),
  B('Vestsjællands Brandvæsen', 'Sjælland', 'https://vsbv.dk/', /vestsjællands brandvæsen/i),
  B('Slagelse Brand og Redning', 'Sjælland', 'https://beredskab.slagelse.dk/', /slagelse brand/i),
  B('Midt- og Sydsjællands Brand & Redning', 'Sjælland', 'http://www.msbr.dk/', /midt- og sydsjællands/i),
  B('Lolland-Falster Brandvæsen', 'Sjælland', 'https://www.lfbv.dk', /lolland-falster/i),
  B('Brand & Redning Køge', 'Sjælland', 'https://www.koege.dk', /redning køge/i),
  B('Brand & Redning Stevns', 'Sjælland', 'https://www.stevns.dk', /redning stevns/i),
  B('Lejre Brandvæsen', 'Sjælland', 'https://www.lejre.dk', /lejre brandvæsen/i),
  // Syddanmark
  B('Beredskab Fyn', 'Syddanmark', 'https://beredskabfyn.dk/', /beredskab fyn/i),
  B('TrekantBrand', 'Syddanmark', 'http://www.trekantbrand.dk/', /trekantbrand/i, { kilde: 'dimensioneringsplan 2023',
    tekst: '15 stationer: 2 hovedstationer (2+10), 11 lokalstationer (1+5) og 2 nærstationer (1+3). Dagligt på vagt: 1 operationschef, 3 indsatsledere, 17 holdledere og 81 brandfolk.',
    minimum: () => '1+5 fra lokalstation, 1+3 fra nærstation, 2+10 fra hovedstation' }),
  B('Vejle Brandvæsen', 'Syddanmark', 'https://www.vejlebrandvaesen.dk/', /vejle brandvæsen/i, { kilde: 'omtale af plan 2027–2030',
    tekst: 'Responstid 10 min i byer over 5.000 indbyggere. Ny plan 2027–2030 sender flere brandfolk til færdselsuheld.' }),
  B('Sydvestjysk Brandvæsen', 'Syddanmark', 'http://svjb.dk/', /sydvestjysk brandvæsen/i, { kilde: 'omtale i Esbjerg Kommunes dagsordener',
    tekst: 'Esbjerg, Varde og Fanø. Opgraderet dimensionering fra 2025 med mere mandskab og slukningsrobotter; ny plan 2026–2029.' }),
  B('Brand & Redning Sønderjylland', 'Syddanmark', 'https://www.brsj.dk/', /redning sønderjylland/i, { kilde: 'RBD 2022',
    tekst: 'Aabenraa, Haderslev og Tønder. 31 stationer, de fleste med 1+5 og autosprøjte/tanksprøjte + vandtankvogn; mindre stationer (fx Barsmark, Bedsted, Rømø, Visby) 1+3. Skæreslukker i Haderslev og Aabenraa. Indsatsledere i vagtdistrikter.',
    minimum: () => '1+5 (mindre stationer 1+3)' }),
  B('Beredskab Sønderborg', 'Syddanmark', 'https://sonderborgkommune.dk/', /beredskab sønderborg/i, { kilde: 'omtale af RBD 2026–2029',
    tekst: 'Sønderborg Kommune. Responstidsmålet på 10 min er svært at nå i Sønderborg by, Nordborg og Rinkenæs.' }),
  // Midtjylland
  B('Østjyllands Brandvæsen', 'Midtjylland', 'https://www.ostbv.dk/', /(?<!syd)østjyllands brandvæsen/i, { kilde: 'plan 2026–2030',
    tekst: 'Døgnstationer: Aarhus Nord, City og Syd; deltid bl.a. Odder, Hørning, Skanderborg, Ry. Indsatsleder Nord og Syd. Nærmeste relevante enhed sendes altid.',
    minimum: t => /højhus/.test(t) && /bygn|brand/.test(t) ? '3+4+20+2 ved bekræftet brand i højhus'
      : /\baba\d*\b|automatisk brandalarm/.test(t) ? '1+5 (nogle ABA-objekter: indsatsleder med, 1+1+5, eller 1+2+10)'
      : /bygn\.?\s?brand|bygningsbrand|campingvogn|kolonihave|sommerhus|parcelhus|villa|lejlighed|etage/.test(t) ? '1+1+5 – indsatsleder, holdleder og 5 brandfolk'
      : /knallert|skraldespand|container|affald|i det fri/.test(t) ? '1+3 – holdleder og 3 brandfolk' : null }),
  B('Beredskab & Sikkerhed', 'Midtjylland', 'http://www.bsik.dk/', /beredskab & sikkerhed|beredskab og sikkerhed/i, { kilde: 'Beredskabsstyrelsens udtalelse 2024',
    tekst: 'Randers, Favrskov, Norddjurs og Syddjurs. Ved samtidige hændelser i Randers dækker station Hadsten byen. Særligt fokus på højhuse over 22 m i Randers.' }),
  B('Midtjysk Brand & Redning', 'Midtjylland', 'http://mjbr.dk/', /midtjysk/i, { kilde: 'plan 2026–2029',
    tekst: 'Viborg og Silkeborg kommuner, 10 stationer. Alle har sprøjte og tankvogn – det er førsteudrykningen. Drejestige, redningsvogn og specialer kommer fra Viborg eller Silkeborg (CBRNE kun Viborg). Indsatsleder Nord (Viborg) og Syd (Silkeborg). Gennemsnitlig responstid 6,8 min.',
    minimum: t => /drejestige|højde|etage|lejlighed/.test(t) ? '1+3 på autosprøjten, +2 pr. specialkøretøj (fx drejestige)' : '1+3 på første autosprøjte' }),
  B('Brand & Redning MidtVest', 'Midtjylland', 'http://brmv.dk/', /midtvest/i, { kilde: 'vedtægter', tekst: 'Herning, Ikast-Brande og Ringkøbing-Skjern; hjemsted Herning.' }),
  B('Nordvestjyllands Brandvæsen', 'Midtjylland', 'https://www.nvjbrand.dk/', /nordvestjyllands brandvæsen/i, { kilde: 'plan 2022–2025',
    tekst: 'Holstebro, Skive, Lemvig og Struer. Tre udrykningsprofiler til hverdagshændelser: A = indsatsleder + holdleder + 5–7 brandfolk, B = indsatsleder + holdleder + 3 brandfolk, C = kun indsatsleder.',
    minimum: t => /bygn|brand i |villa|lejlighed|etage|industri|landbrug/.test(t) ? 'Profil A: 1+1+5–7' : /eftersyn|forespørgsel/.test(t) ? 'Profil C: kun indsatsleder' : 'Profil B: 1+1+3 (eller A ved større melding)' }),
  B('Sydøstjyllands Brandvæsen', 'Midtjylland', 'https://sojbv.dk/', /sydøstjyllands brandvæsen/i, { kilde: 'plan 2025–2028',
    tekst: 'Horsens og Hedensted kommuner (ca. 150.000 indbyggere). Seks brandstationer, drevet af Falck og Horsens; frivillige enheder på Hjarnø og Endelave. Operationschef på tilkald.' }),
  // Nordjylland
  B('Nordjyllands Beredskab', 'Nordjylland', 'https://www.nordjyllandsberedskab.dk/', /nordjyllands beredskab/i, { kilde: 'NOBR2025',
    tekst: '11 kommuner, 36 brandstationer: 35 deltidsstationer og 1 døgnbemandet station suppleret af deltid. 5 indsatsledervagter efter "taxaprincippet" – nærmeste indsatsleder kører. Op til 4 indsatsledere til store hændelser.' }),
];
// Lokale telefonnumre (ikke 112) – fra beredskabernes egne kontaktsider. "Hovednummer" = der er ikke offentliggjort
// et særskilt vagtcentralnummer; de fleste beredskaber henviser til 112 ved akut hjælp.
const BEREDSKAB_TLF = {
  'Hovedstadens Beredskab': [['Vagthavende operationschef (også presse, døgnet rundt)', '24 29 75 03'], ['Hovednummer', '70 21 02 00']],
  'Nordsjællands Brandvæsen': [['Vagtcentral (døgnbemandet)', '45 80 33 55']],
  'Midt- og Sydsjællands Brand & Redning': [['Vagtcentral', '55 78 78 00']],
  'Vestsjællands Brandvæsen': [['Døgnet rundt (tast 1)', '44 22 71 12']],
  'Lolland-Falster Brandvæsen': [['Hovednummer', '61 94 80 00']],
  'Brand & Redning Stevns': [['Døgnbemandet vagtcentral', '33 43 10 00']],
  'Beredskab Fyn': [['Vagtcentral (dag og nat)', '65 51 18 00']],
  'TrekantBrand': [['Vagtcentral', '70 23 60 61'], ['Hovednummer', '70 23 60 60']],
  'Brand & Redning Sønderjylland': [['Hovednummer', '73 77 73 77']],
  'Østjyllands Brandvæsen': [['Hovednummer', '86 76 76 76'], ['Presse', '86 76 76 49']],
  'Midtjysk Brand & Redning': [['Hovednummer', '89 70 35 99']],
  'Nordvestjyllands Brandvæsen': [['Hovednummer', '40 53 00 30']],
  'Sydøstjyllands Brandvæsen': [['Hovednummer', '76 29 27 70']],
  'Nordjyllands Beredskab': [['Hovednummer', '70 15 15 14']],
};
for (const b of BEREDSKABER) b.tlf = BEREDSKAB_TLF[b.navn] || [];

// Politikredsene: kredsens nummer (politi.dk, "Kontakt politikreds") og pressetelefon/vagtchef (kredsens pressekontaktside)
export const POLITI = [
  { navn: 'Bornholms Politi', match: /bornholm/i, tlf: [['Kredsen', '56 90 14 48'], ['Presse (døgnet rundt)', '23 23 14 48']] },
  { navn: 'Fyns Politi', match: /fyn/i, tlf: [['Kredsen', '66 14 14 48'], ['Presse (kontortid)', '91 35 79 02'], ['Vagtchef – akutte hændelser uden for kontortid', '25 47 07 35']] },
  { navn: 'Københavns Politi', match: /københavns politi/i, tlf: [['Kredsen', '33 14 14 48'], ['Presse', '35 21 92 60']] },
  { navn: 'Københavns Vestegns Politi', match: /vestegn/i, tlf: [['Kredsen', '43 86 14 48'], ['Vagtchefens pressetelefon (døgnet rundt)', '50 85 00 44']] },
  { navn: 'Midt- og Vestjyllands Politi', match: /midt- og vestjylland/i, tlf: [['Kredsen', '96 10 14 48'], ['Vagtchefens pressetelefon', '96 10 14 68']] },
  { navn: 'Midt- og Vestsjællands Politi', match: /midt- og vestsjælland/i, tlf: [['Kredsen', '46 35 14 48'], ['Presse (døgnet rundt)', '25 42 62 10']] },
  { navn: 'Nordjyllands Politi', match: /nordjylland/i, tlf: [['Kredsen', '96 30 14 48'], ['Vagtchefens pressetelefon', '51 54 15 55']] },
  { navn: 'Nordsjællands Politi', match: /nordsjælland/i, tlf: [['Kredsen', '49 27 14 48'], ['Presse', '41 33 15 76']] },
  { navn: 'Syd- og Sønderjyllands Politi', match: /sønderjylland/i, tlf: [['Kredsen', '76 11 14 48'], ['Presse', '20 52 64 60']] },
  { navn: 'Sydsjællands og Lolland-Falsters Politi', match: /sydsjælland|lolland/i, tlf: [['Kredsen', '55 31 14 48'], ['Vagtchefens pressetelefon (kl. 8–14, 16–22, 01–06)', '41 32 87 18']] },
  { navn: 'Sydøstjyllands Politi', match: /sydøstjylland/i, tlf: [['Kredsen', '76 28 14 48'], ['Presse', '40 41 52 49']] },
  { navn: 'Østjyllands Politi', match: /(?<!syd)østjylland/i, tlf: [['Kredsen', '87 31 14 48'], ['Presse (hverdage i kontortid)', '22 69 10 87'], ['Vagtchef efter kl. 16 og i weekenden', '86 18 28 77']] },
];
export const BEREDSKABSLISTE = BEREDSKABER;
export const tlfLinks = tlf => tlf.map(([hvad, nr]) => `<a href="tel:+45${nr.replace(/\s/g, '')}">📞 ${esc(nr)}</a> <small>${esc(hvad)}</small>`).join('<br>');

export function beredskabFor(h) {
  const t = `${h.titel || ''}\n${h.tekst || ''}`;
  const b = (/Beredskab:\s*([^\n·]+)/i.exec(t) || [])[1] || '';
  if (b) return BEREDSKABER.find(x => x.match.test(b)) || null;
  // Uden "Beredskab:"-linje: Østjyllands enhedskoder (fx fra 1-1-2 Århus)
  if (/\b(CI|NO|SY|OD|SK)[\s-]?(?:MR|[MVSRBTKH])[\s-]?\d/.test(t)) return BEREDSKABER.find(x => x.navn === 'Østjyllands Brandvæsen');
  return null;
}

// Typiske udrykningsprofiler pr. melding – principperne fra Beredskab Østs plan 2025 (tabel 17). De svarer til den
// gængse danske opbygning; det enkelte beredskabs pickliste kan afvige. M = sprøjte (1+3), S = drejestige (2),
// V = vandtankvogn (2), ISL = indsatsleder. "(x)" = afhænger af objekt og melding.
const PROFILER = [
  [/\baba\d*\b|automatisk brandalarm/, 'Sprøjte + drejestige + indsatsleder (ved udvalgte ABA-anlæg kun sprøjte)'],
  [/etage|højhus|institution|plejehjem|hospital|tagbrand|brand i tag/, 'Sprøjte + drejestige + 2. sprøjte + vandtankvogn, ved komplekse bygninger en 3. udrykningsenhed + indsatsleder og 2. indsatsleder'],
  [/bygn\.?\s?brand|bygningsbrand|villa|rækkehus|kædehus|lejlighed|industri|p-hus|kælder/, 'Sprøjte + drejestige + 2. sprøjte + vandtankvogn + indsatsleder'],
  [/el-?bil|elbil|hybrid/, 'Sprøjte + 2. sprøjte + vandtankvogn + specialkøretøj + indsatsleder'],
  [/(?:brand|ild|røg).*(?:\btog\b|\bfly\b|skib)|(?:\btog\b|\bfly\b|skib).*(?:brand|ild|røg)/, 'Sprøjte + drejestige + 2. sprøjte + vandtankvogn (+ specialkøretøj) + indsatsleder'],
  [/skur|carport|transformator|skorst|eftersyn/, 'Sprøjte + drejestige + indsatsleder'],
  [/gasudslip|gaslæk|gasledning/, 'Sprøjte + vandtankvogn + indsatsleder'],
  [/brand-bil|bilbrand|bil i det fri|bus|lastvogn|lastbil|landbrug|traktor|mejetærsker/, 'Sprøjte + vandtankvogn + indsatsleder'],
  [/mark|skov|halm|naturbrand/, 'Sprøjte + vandtankvogn + indsatsleder (mindre naturbrand: kun sprøjte)'],
  [/container|bål|knallert|affald|skraldespand|i det fri/, 'Sprøjte – holdleder kan opgradere med vandtankvogn og indsatsleder'],
  [/fastklemt.*(bus|lastbil|tog)|silo|jordskred|sandskred/, 'Sprøjte + 2. sprøjte + vandtankvogn + specialkøretøj + indsatsleder'],
  [/færdselsuheld|trafikuheld|fuh|fastklemt|frigørelse/, 'Sprøjte + vandtankvogn + indsatsleder'],
  [/drukn|vandredning|person i vand|redning på vand/, 'Sprøjte + vandtankvogn (+ båd) + indsatsleder – altid overfladereddere'],
  [/redn\.|redning|mast|skrænt/, 'Sprøjte (+ drejestige/vandtankvogn) + indsatsleder'],
  [/kemikalie/, 'Sprøjte + drejestige + 2. sprøjte + vandtankvogn + specialkøretøjer + indsatsleder og 2. indsatsleder'],
  [/miljø|udslip|olie|spild/, 'Mindre spild: sprøjte. Større udslip: sprøjte + vandtankvogn + indsatsleder'],
];
export function udrykningsprofil(h) {
  if (erTog(h) && !TOG_ALVORLIG.test(h.tekst || '')) return null;   // togmelding uden ulykke: beredskabet er ikke kaldt
  const t = (h.titel || '').toLowerCase();
  return (PROFILER.find(([re]) => re.test(t)) || [])[1] || null;
}
// Hændelsesniveau efter Østjyllands Brandvæsens plan 2026-2030 (hverdags-, større og ekstraordinær hændelse)
export function beredskabsNiveau(h) {
  const t = `${h.titel || ''}\n${h.tekst || ''}`;
  const isl = new Set((t.match(/\bISL\s+[A-ZÆØÅ]{2,3}\b/g) || []).map(x => x.replace(/\s+/g, ' '))).size;
  if (/\bOC\b/.test(t) || (h.antal_ass || 0) >= 3) return { navn: 'Ekstraordinær hændelse', tekst: 'operationschefen rekvirerer assistance' };
  if (h.eskaleret || isl >= 2 || (h.antal_enheder || 0) >= 5) return { navn: 'Større hændelse', tekst: 'minimum 1+2+10' };
  return { navn: 'Hverdagshændelse', tekst: 'nærmeste relevante enhed' };
}
export function minimumsbemanding(h) {
  const b = beredskabFor(h);
  return b?.minimum ? b.minimum((h.titel || '').toLowerCase()) : null;
}
const pct = x => `${Math.round((x || 0) * 100)} %`;
const varighedTekst = m => m == null ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} t ${m % 60 ? `${m % 60} min` : ''}`.trim();
// Adresseopslag med forslag: kun rigtige adresser (vej + husnummer + postnummer) fra OpenStreetMaps adressedata
// via Photon, med Nominatim som reserve. Bruges til "Kører ud fra", så udgangspunktet ikke kan være fiktivt.
const DK_BBOX = '7.9,54.5,15.3,57.8';
export async function adresseForslag(q, { signal } = {}) {
  q = String(q || '').trim();
  if (q.length < 3) return [];
  const ren = x => x.filter(a => a.vej && a.nr && /^\d{4}$/.test(a.postnr || ''))
    .filter((a, i, l) => l.findIndex(b => b.tekst === a.tekst) === i).slice(0, 6);
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&bbox=${DK_BBOX}&layer=house`, { signal });
    if (r.ok) {
      const j = await r.json();
      const l = ren((j.features || []).filter(f => f.properties?.countrycode === 'DK').map(f => {
        const p = f.properties, [lon, lat] = f.geometry.coordinates;
        return { vej: p.street, nr: p.housenumber, postnr: p.postcode, by: p.city || p.town || p.village || p.district || '', lat, lon };
      }).map(a => ({ ...a, tekst: `${a.vej} ${a.nr}, ${a.postnr} ${a.by}`.trim() })));
      if (l.length) return l;
    }
  } catch (e) { if (e.name === 'AbortError') throw e; }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&countrycodes=dk&addressdetails=1&limit=6`, { signal });
    if (!r.ok) return [];
    return ren((await r.json()).map(x => {
      const a = x.address || {};
      return { vej: a.road, nr: a.house_number, postnr: a.postcode, by: a.city || a.town || a.village || a.suburb || '', lat: +x.lat, lon: +x.lon };
    }).map(a => ({ ...a, tekst: `${a.vej} ${a.nr}, ${a.postnr} ${a.by}`.trim() })));
  } catch (e) { if (e.name === 'AbortError') throw e; return []; }
}
// Forslagsliste under et tekstfelt. vælg(a) kaldes med den valgte adresse.
export function adresseFelt(input, vælg) {
  let liste = input.parentElement.querySelector('.adr-forslag');
  if (!liste) {
    liste = document.createElement('ul'); liste.className = 'adr-forslag'; liste.setAttribute('role', 'listbox'); liste.hidden = true;
    input.parentElement.style.position = 'relative'; input.parentElement.append(liste);
  }
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  let timer = null, ctl = null, valgt = -1, fundne = [];
  const luk = () => { liste.hidden = true; input.setAttribute('aria-expanded', 'false'); valgt = -1; };
  const vis = () => {
    liste.innerHTML = fundne.length ? fundne.map((a, i) => `<li role="option" data-i="${i}"${i === valgt ? ' aria-selected="true"' : ''}>${esc(a.tekst)}</li>`).join('')
      : '<li class="tom-forslag">Ingen rigtige adresser fundet – skriv vej, husnummer og by</li>';
    liste.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  const tag = i => { const a = fundne[i]; if (!a) return; input.value = a.tekst; luk(); vælg(a); };
  input.addEventListener('input', () => {
    clearTimeout(timer); ctl?.abort();
    if (input.value.trim().length < 3) return luk();
    timer = setTimeout(async () => {
      ctl = new AbortController();
      try { fundne = await adresseForslag(input.value, { signal: ctl.signal }); valgt = -1; vis(); } catch { /* afbrudt */ }
    }, 300);
  });
  input.addEventListener('keydown', e => {
    if (liste.hidden) return;
    if (e.key === 'ArrowDown') { valgt = Math.min(fundne.length - 1, valgt + 1); vis(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { valgt = Math.max(0, valgt - 1); vis(); e.preventDefault(); }
    else if (e.key === 'Enter' && valgt >= 0) { tag(valgt); e.preventDefault(); }
    else if (e.key === 'Escape') { luk(); e.stopPropagation(); }
  });
  liste.addEventListener('mousedown', e => { const li = e.target.closest('[data-i]'); if (li) { e.preventDefault(); tag(+li.dataset.i); } });
  input.addEventListener('blur', () => setTimeout(luk, 150));
}

// Nyhedslinks på hændelsen (gemt af databasen, se supabase/nyheder.sql)
export function nyhederHtml(h) {
  const liste = (h?.nyheder || []).filter(n => sikkerUrl(n.url));
  if (!liste.length) return '';
  const kilde = u => { try { return new URL(u).hostname.replace(/^(www|via)\./, ''); } catch { return 'link'; } };
  return `<p class="lille nyheder">📰 ${liste.map(n => `<a href="${esc(sikkerUrl(n.url))}" target="_blank" rel="noopener noreferrer" title="${esc(n.titel || '')}">${esc(kilde(n.url))}</a>`).join(' · ')}</p>`;
}
// Vejret på stedet (hentes af databasen fra met.no, se supabase/vejr.sql) og assistentens fareadvarsler
const VINDRETNING = ['nord', 'nordøst', 'øst', 'sydøst', 'syd', 'sydvest', 'vest', 'nordvest'];
const komma = x => String(x).replace('.', ',');
export function vejrTekst(v) {
  if (!v) return '';
  return [v.tekst, v.temp != null ? `${komma(v.temp)} °C` : '',
    v.vind != null ? `vind ${komma(v.vind)} m/s${v.stoed != null && v.stoed > v.vind + 2 ? ` (stød ${komma(v.stoed)})` : ''}${v.retning != null ? ` fra ${VINDRETNING[Math.round(v.retning / 45) % 8]}` : ''}` : '',
    v.nedboer > 0 ? `${komma(v.nedboer)} mm nedbør/t` : ''].filter(Boolean).join(' · ');
}
function vejrHtml(h, d) {
  const v = h?.vejr || d?.vejr;
  if (!v) return '';
  const fare = d?.vejr_fare?.advarsler || [];
  return `<p><b>Vejret:</b> ${esc(vejrTekst(v))} <small>(met.no)</small></p>
    ${fare.map(f => `<p class="vejr-fare">⚠️ ${esc(f)}</p>`).join('')}`;
}
export function indsigtHtml(h, d, { kontor = false } = {}) {
  if (d === undefined) return '<div class="ai-boks"><p class="ai-top">🤖 Assistent</p><p class="lille">Tænker …</p></div>';
  // Togmelding: forklar hvad der sker – ingen brand-udrykning, medmindre det er en ulykke/brand
  if (erTog(h)) {
    const tg = togForklaring(h), forslag = tg.alvorlig ? 2 : 3, prof = udrykningsprofil(h);
    return `<div class="ai-boks"><p class="ai-top">🤖 Assistent <small>togmelding${d?.n ? ` · lærer af ${d.n} tidligere` : ''}</small></p>
      <p><b>Hvad sker der:</b> ${esc(tg.hvad)}${tg.årsag ? ` – årsag: ${esc(tg.årsag)}` : ''}</p>
      <p><b>Vurdering:</b> ${esc(tg.vurdering)}</p>
      ${vejrHtml(h, d)}
      ${prof ? `<p><b>Typisk udrykning:</b> ${esc(prof)}</p>` : ''}
      <p class="lille">${tg.alvorlig ? 'Fotograferne får tilbud som normalt.' : 'Fotograferne får ikke tilbud, og kontoret får ikke blink, før meldingen udvikler sig (fx påkørsel, ulykke, afsporing, brand, evakuering eller politiets arbejde på banen).'}
        ${d?.n ? ` Fotograf kørte på ${pct(d.andel_foto)} af de tidligere togmeldinger.` : ''}</p>
      ${kontor && aktiv(h) && forslag !== prioAf(h) ? `<button class="secondary lille-knap" data-prio="${h.id}" data-p="${forslag}">Brug forslaget: ${PRIO[forslag].navn}</button>` : ''}
    </div>`;
  }
  // Uden historik: vis stadig de forventede ressourcer (typisk udrykning, niveau, minimumsbemanding, beredskab)
  if (!d || !d.n) {
    const niv = beredskabsNiveau(h), b = beredskabFor(h);
    return `<div class="ai-boks"><p class="ai-top">🤖 Assistent</p>
      ${udrykningsprofil(h) ? `<p><b>Typisk udrykning:</b> ${esc(udrykningsprofil(h))} <small>(udrykningsprofil efter Beredskab Østs plan – lokale picklister kan afvige)</small></p>` : ''}
      <p><b>Niveau:</b> ${niv.navn} <small>(${niv.tekst})</small>${minimumsbemanding(h) ? `<br><small>Minimumsbemanding: ${minimumsbemanding(h)}</small>` : ''}</p>
      ${vejrHtml(h, d)}
      ${b ? `<p class="lille">🚒 <b>${esc(b.navn)}</b> · ${esc(b.region)}${b.tekst ? ` (${esc(b.kilde)}): ${esc(b.tekst)}` : ''}${b.tlf.length ? `<br>${tlfLinks(b.tlf)}` : ''}</p>` : ''}
      <p class="lille">Ingen lignende hændelser endnu – assistenten lærer, efterhånden som der kommer flere.</p></div>`;
  }
  const typer = (d.enhedstyper || []).filter(t => t.andel >= 0.2);
  const her = d.enheder_her || [];
  const p = d.forslag_prio, nu = prioAf(h);
  return `<div class="ai-boks">
    <p class="ai-top">🤖 Assistent <small>lærer af ${d.n} lignende (${esc(d.niveau)})</small></p>
    ${typer.length ? `<p><b>Normal førsteudrykning:</b> ${typer.map(t => `${esc(t.type)}${ENHEDSNAVN[t.type] ? ` <small>${ENHEDSNAVN[t.type]}</small>` : ''} ${pct(t.andel)}`).join(' · ')}${d.typisk_foerste ? ` · typisk ${d.typisk_foerste} enheder` : ''}</p>`
      : '<p class="lille">Ingen enheder i de lignende beskeder endnu.</p>'}
    ${her.length ? `<p><b>Plejer at køre${d.sted ? ` (${esc(d.sted)})` : ''}:</b> ${her.map(e => enhedNavn(e.enhed)).join(', ')}</p>` : ''}
    ${(niv => `<p><b>Niveau:</b> ${niv.navn} <small>(${niv.tekst})</small>${minimumsbemanding(h) ? `<br><small>Minimumsbemanding: ${minimumsbemanding(h)}</small>` : ''}</p>`)(beredskabsNiveau(h))}
    ${udrykningsprofil(h) ? `<p><b>Typisk udrykning:</b> ${esc(udrykningsprofil(h))} <small>(udrykningsprofil efter Beredskab Østs plan – lokale picklister kan afvige)</small></p>` : ''}
    ${(b => b ? `<p class="lille">🚒 <b>${esc(b.navn)}</b> · ${esc(b.region)}${b.tekst ? ` (${esc(b.kilde)}): ${esc(b.tekst)}` : ''} · <a href="${esc(b.web)}" target="_blank" rel="noopener">hjemmeside</a>${b.tlf.length ? `<br>${tlfLinks(b.tlf)}` : ''}</p>` : '')(beredskabFor(h))}
    ${d.n_med_enheder ? `<p class="lille">Ekstra enheder/assistance tilkaldt senere ved ${pct(d.andel_ekstra)} af de lignende${(d.ekstra_nu || []).length ? ` · <b>her: ${d.ekstra_nu.map(enhedNavn).join(', ')}</b>` : ''}</p>` : ''}
    ${vejrHtml(h, d)}
    <p><b>Forslag:</b> <span class="prio-tekst p${p}">${PRIO[p]?.navn || 'Normal'} prioritet</span> · alvor ${esc(d.alvor)}
      <br><small>${(d.grund || []).map(esc).join(' · ')}</small></p>
    <p class="lille">Fotograf kørte på ${pct(d.andel_foto)} af de lignende${d.varighed_min != null ? ` · de varer typisk ${varighedTekst(d.varighed_min)}` : ''}</p>
    ${kontor && aktiv(h) && p && p !== nu ? `<button class="secondary lille-knap" data-prio="${h.id}" data-p="${p}">Brug forslaget: ${PRIO[p].navn}</button>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------------
// Stationer på kortet: brand-, politi- og ambulancestationer (OpenStreetMap, tabellen stationer i databasen).
// Filter-knapper øverst til højre på kortet. Tryk på en station for adresse, telefon og "Navigér".
const STATIONSTYPER = {
  brand: { ikon: '🚒', navn: 'Brandstationer', ental: 'Brandstation', farve: '#dc2626' },
  politi: { ikon: '👮', navn: 'Politistationer', ental: 'Politistation', farve: '#1d4ed8' },
  ambulance: { ikon: '🚑', navn: 'Ambulancestationer', ental: 'Ambulancestation', farve: '#059669' },
};
let stationsData = null;
const hentStationer = () => stationsData ||= store.hentStationer().catch(() => { stationsData = null; return []; });
const læsFilter = () => { try { return JSON.parse(localStorage.getItem('fotovagt-stationer')) || {}; } catch { return {}; } };
const gemFilter = f => { try { localStorage.setItem('fotovagt-stationer', JSON.stringify(f)); } catch { /* privat vindue */ } };

function stationsTlf(st) {
  const tekst = `${st.op || ''} ${st.n || ''}`;
  if (st.t === 'politi') {
    const k = POLITI.find(p => p.match.test(tekst));
    return k ? `<b>${esc(k.navn)}</b><br>${tlfLinks(k.tlf)}` : '<small>Politiet: 114 (døgnet rundt)</small>';
  }
  if (st.t === 'brand') {
    const b = BEREDSKABER.find(x => x.match.test(tekst));
    return b ? `<b>${esc(b.navn)}</b>${b.tlf.length ? `<br>${tlfLinks(b.tlf)}` : ''}` : '';
  }
  return '<small>Ambulancerne styres af regionens AMK-vagtcentral (intet offentligt nummer)</small>';
}
// Adresse slås op, når stationen åbnes (OpenStreetMap har sjældent adressen): DAWA, ellers OpenStreetMap
async function slåAdresseOp(st) {
  if (st.a || st._adr) return;
  st._adr = true;
  try {
    const r = await fetch(`https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${st.lon}&y=${st.lat}&struktur=mini`);
    if (r.ok) { const d = await r.json(); if (d.betegnelse) { st.a = d.betegnelse; return; } }
  } catch { /* prøv næste */ }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${st.lat}&lon=${st.lon}`);
    const a = (await r.json()).address || {};
    const linje = [[a.road, a.house_number].filter(Boolean).join(' '), [a.postcode, a.town || a.city || a.village].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (linje) st.a = linje;
  } catch { /* ingen adresse */ }
}
function stationsPopup(st) {
  const T = STATIONSTYPER[st.t], nav = navigationsLink({ lat: st.lat, lon: st.lon });
  return `<div class="st-popup"><b>${T.ikon} ${esc(st.n || T.ental)}</b>
    ${st.a ? `<br>${esc(st.a)}` : '<br><small>Finder adresse …</small>'}
    ${(t => t ? `<div class="st-tlf">${t}</div>` : (st.op ? `<br><small>${esc(st.op)}</small>` : ''))(stationsTlf(st))}
    <a class="knap st-nav" href="${nav}" target="_blank" rel="noopener">🧭 Navigér hertil</a></div>`;
}
export function stationsKontrol(kort) {
  const lag = Object.fromEntries(Object.keys(STATIONSTYPER).map(t => [t, L.layerGroup()]));
  let filter = læsFilter(), fyldt = false;
  async function fyld() {
    if (fyldt) return; fyldt = true;
    for (const st of await hentStationer()) {
      const T = STATIONSTYPER[st.t]; if (!T || !lag[st.t]) continue;
      L.marker([st.lat, st.lon], {
        icon: L.divIcon({ className: 'st-ikon', html: `<span style="--c:${T.farve}">${T.ikon}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        title: st.n || T.ental, keyboard: false,
      }).bindPopup(() => stationsPopup(st), { maxWidth: 260 })
        .on('popupopen', async e => { if (st.a) return; await slåAdresseOp(st); if (st.a) e.popup.setContent(stationsPopup(st)); })
        .addTo(lag[st.t]);
    }
  }
  async function opdater() {
    if (Object.values(filter).some(Boolean)) await fyld();
    for (const [t, l] of Object.entries(lag)) { if (filter[t]) l.addTo(kort); else l.remove(); }
    boks.querySelectorAll('[data-st]').forEach(b => b.setAttribute('aria-pressed', String(!!filter[b.dataset.st])));
  }
  const Kontrol = L.Control.extend({
    onAdd() {
      const d = L.DomUtil.create('div', 'st-kontrol leaflet-bar');
      d.innerHTML = Object.entries(STATIONSTYPER).map(([t, T]) => `<button type="button" data-st="${t}" title="Vis ${T.navn.toLowerCase()}" aria-label="Vis ${T.navn.toLowerCase()}" aria-pressed="false">${T.ikon}</button>`).join('')
        + '<button type="button" data-tlfliste title="Telefonliste: vagtcentraler og politikredse" aria-label="Telefonliste: vagtcentraler og politikredse">☎</button>';
      L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
      d.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.tlfliste != null) return åbnTelefonliste();
        filter = { ...filter, [b.dataset.st]: !filter[b.dataset.st] }; gemFilter(filter); opdater();
      });
      return d;
    },
  });
  const boks = new Kontrol({ position: 'topright' }).addTo(kort).getContainer();
  opdater();
}

// Telefonliste: politikredse og beredskaber med lokale numre (ikke 112)
export function åbnTelefonliste() {
  let dlg = $('#dlg-tlfliste');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'dlg-tlfliste'; dlg.className = 'ark';
    const sekt = (titel, liste) => `<h3>${titel}</h3><div class="tlf-liste">${liste.map(x => `<div class="tlf-række"><b>${esc(x.navn)}</b><div>${tlfLinks(x.tlf)}</div></div>`).join('')}</div>`;
    dlg.innerHTML = `<div class="ark-indhold">
      <div class="ark-top"><h2>☎ Telefonliste</h2><button class="luk" data-luk-tlf aria-label="Luk">✕</button></div>
      <p class="hint">Lokale numre – ikke 112. Ved akut fare: ring 112. Politiets døgnnummer er 114. Numrene er fra politi.dk og beredskabernes egne kontaktsider.</p>
      ${sekt('👮 Politikredse', POLITI)}
      ${sekt('🚒 Beredskaber', BEREDSKABER.filter(b => b.tlf.length))}
      <p class="hint">Beredskaber uden offentligt vagtcentralnummer: ${BEREDSKABER.filter(b => !b.tlf.length).map(b => esc(b.navn)).join(', ')}.
        Ambulancer styres af regionernes AMK-vagtcentraler, som ikke har offentlige numre.</p>
    </div>`;
    document.body.append(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-luk-tlf]')) dlg.close(); });
  }
  dlg.showModal();
}

// Region ud fra postnummer (samme regler som region_fra_postnr i supabase/regioner.sql)
export function regionFraPostnr(tekst) {
  const pn = +((/\b(\d{4})\b/.exec(tekst || '') || [])[1] || 0);
  if (!pn) return null;
  if (pn === 4050) return 'Hovedstaden';
  if (pn >= 1000 && pn <= 3799) return 'Hovedstaden';
  if (pn >= 4000 && pn <= 4999) return 'Sjælland';
  if (pn >= 5000 && pn <= 6899) return 'Syddanmark';
  if (pn >= 6900 && pn <= 6999) return 'Midtjylland';
  if (pn >= 7130 && pn <= 7171) return 'Midtjylland';
  if (pn >= 7000 && pn <= 7260) return 'Syddanmark';
  if (pn >= 7270 && pn <= 7280) return 'Midtjylland';
  if (pn >= 7300 && pn <= 7323) return 'Syddanmark';
  if (pn === 7790) return 'Midtjylland';
  if ((pn >= 7700 && pn <= 7799) || (pn >= 7900 && pn <= 7999)) return 'Nordjylland';
  if (pn >= 7330 && pn <= 8999) return 'Midtjylland';
  if (pn === 9632) return 'Midtjylland';
  if (pn >= 9000 && pn <= 9999) return 'Nordjylland';
  return null;
}

// ---------------------------------------------------------------------------------
// Vælg et billede (kamera eller fotos), skær det til et kvadrat og gør det lille (160x160 JPEG, ca. 10 KB)
export function vælgFoto() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const fil = inp.files?.[0]; if (!fil) return resolve(null);
      try {
        const url = URL.createObjectURL(fil);
        const img = await new Promise((ok, fejl) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fejl(new Error('Billedet kunne ikke læses.')); i.src = url; });
        const side = Math.min(img.naturalWidth, img.naturalHeight), str = 160;
        const c = document.createElement('canvas'); c.width = c.height = str;
        c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, str, str);
        URL.revokeObjectURL(url);
        let q = 0.82, data = c.toDataURL('image/jpeg', q);
        while (data.length > 140000 && q > 0.4) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
        resolve(data);
      } catch (e) { reject(e); }
    };
    inp.click();
  });
}
// Felt med billede + "Vælg billede"/"Fjern" (bruges i Min profil og i kontorets fotograf-dialog)
export function fotoFelt(el, p) {
  const tegn = () => {
    el.innerHTML = `${avatar(p, 64)}<div class="foto-felt-knapper">
      <button type="button" class="secondary lille-knap" data-foto-vælg>📷 ${fotoAf(p.id) ? 'Skift billede' : 'Vælg billede'}</button>
      ${fotoAf(p.id) ? '<button type="button" class="link fare" data-foto-fjern>Fjern</button>' : ''}
      <small class="hint">Lille billede, som kontoret og kollegerne kan se.</small></div>`;
  };
  el.onclick = async e => {
    if (e.target.closest('[data-foto-vælg]')) {
      try {
        const data = await vælgFoto(); if (!data) return;
        if (await prøv(() => store.gemFoto(p.id, data), 'Billedet er gemt.')) tegn();
      } catch (err) { toast(err.message || String(err), 'fejl'); }
    }
    if (e.target.closest('[data-foto-fjern]') && confirm('Fjern billedet?')) {
      if (await prøv(() => store.sletFoto(p.id), 'Billedet er fjernet.')) tegn();
    }
  };
  tegn();
}
