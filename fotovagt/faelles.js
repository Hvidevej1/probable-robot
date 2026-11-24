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
  Brand: '🔥', Trafik: '🚗', Politi: '🚓', Redning: '🛟', Miljø: '☣️', Vejr: '🌧️', Andet: '📍',
};
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
// Kort (Leaflet + OpenStreetMap)
// ------------------------------------------------------------------------------------
export function lavKort(el) {
  const cfg = window.FOTOVAGT_CONFIG || {};
  const kort = L.map(el, { zoomControl: true, attributionControl: true }).setView(cfg.kortCenter || [56.1, 10.6], cfg.kortZoom || 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(kort);
  return kort;
}

export function haendelsesIkon(h, valgt = false) {
  const ikon = KATEGORI_IKON[h.kategori] || KATEGORI_IKON.Andet;
  return L.divIcon({
    className: '',
    html: `<div class="pin pin-${h.status}${valgt ? ' valgt' : ''}${h.status === 'ny' ? ' puls' : ''}"><span>${ikon}</span></div>`,
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
  if (mig && (!kunKontor || mig.rolle === 'kontor')) { boks.hidden = true; $('#app').hidden = false; return mig; }

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
    vis(form.email);
  });
}
