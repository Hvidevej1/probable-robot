// Kontoret: overblik over hændelser og fotografer, tildeling, oprettelse og Pushover-forbindelse.
import { store } from './store.js';
import { parseBesked } from './supabase/functions/pushover/parse.js';
import { åbnRapport } from './rapport.js';
import {
  STATUS, H_STATUS, KATEGORI_IKON, ikonFor, aktiv, senesteOpdatering, esc, $, siden, klokken, km, kmTekst, set,
  toast, prøv, bip, lavKort, haendelsesIkon, fotografIkon, markørLag, logInd,
  pushKanBruges, abonnérPush, afmeldPush, aktiveSos, sosBoks, sosIkon, alarm, nedtælling,
  tidslinjeHtml, gentegnMedFormular, kommentarHandlinger, kommentarerTil, senesteNyt, offentligSted, åbnSkiftKode,
} from './faelles.js';

let sLag;
let mig, kort, hLag, fLag, filter = 'aktive', valgtId = null, førsteZoom = true;
const S = () => store.state;
const P = id => S().profiler.find(p => p.id === id);
const H = id => S().haendelser.find(h => h.id === id);
const navn = id => P(id)?.navn || '–';
const STATUS_ORDEN = { ledig: 0, ankommet: 1, optaget: 2, pause: 3, offline: 4 };

// ---------------------------------------------------------------------------------
function tegn() {
  tegnSos(); tjekBlink();
  tegnNøgletal(); tegnFotografer(); tegnHaendelser(); tegnLog(); tegnKort();
}

// SOS: rød boks øverst med navn, telefon og placering; alarmen lyder, indtil nogen har trykket "Set"
let kendteBlink = new Set();
function tjekBlink() {
  const nu = S().haendelser.filter(h => h.status === 'ny' && h.tilbud_status === 'ingen_svar').map(h => h.id);
  if (nu.some(id => !kendteBlink.has(id))) { bip(); setTimeout(bip, 700); toast('⚠️ En opgave er ikke taget – tildel manuelt', 'fejl'); }
  kendteBlink = new Set(nu);
  const knap = $('#btn-auto');
  if (knap) { const til = S().indst?.auto_tilbud !== false; knap.textContent = til ? '📩 Auto: til' : '📩 Auto: fra'; knap.classList.toggle('slukket', !til); }
}

function tegnSos() {
  const aktive = aktiveSos();
  $('#sos-omraade').innerHTML = aktive.map(s => sosBoks(s, { kontor: true })).join('');
  alarm(aktive.some(s => !s.kvitteret_af));
  document.title = aktive.length ? `🆘 SOS (${aktive.length}) – Fotovagt` : 'Fotovagt – kontoret';
  if (sLag) sLag.opdater(aktive, s => ({
    ikon: sosIkon(),
    popup: `<b>🆘 SOS: ${esc(P(s.bruger)?.navn || '')}</b><br>kl. ${klokken(s.start)}${P(s.bruger)?.telefon ? `<br>📞 ${esc(P(s.bruger).telefon)}` : ''}`,
  }));
}
function visSos(id) {
  const s = (S().sos || []).find(x => x.id === id);
  if (s?.lat != null) { kort.setView([s.lat, s.lon], 16); sLag.get(id)?.openPopup(); }
  $('#sos-omraade').scrollIntoView({ block: 'start' });
}

function tegnNøgletal() {
  const h = S().haendelser, f = S().profiler.filter(p => p.rolle === 'foto');
  const tal = [
    ['Nye', h.filter(x => x.status === 'ny').length, 'ny'],
    ['I gang', h.filter(x => x.status === 'taget' || x.status === 'ankommet').length, 'taget'],
    ['Ledige', f.filter(p => p.status === 'ledig').length, 'ledig'],
    ['Aktive fotografer', f.filter(p => p.status !== 'offline').length, ''],
  ];
  $('#nøgletal').innerHTML = tal.map(([t, n, k]) => `<div class="tal ${k}"><b>${n}</b><span>${t}</span></div>`).join('');
}

function tegnFotografer() {
  const liste = S().profiler.filter(p => p.rolle === 'foto')
    .sort((a, b) => (STATUS_ORDEN[a.status] - STATUS_ORDEN[b.status]) || a.navn.localeCompare(b.navn));
  $('#fotografer').innerHTML = liste.length ? liste.map(p => {
    const st = STATUS[p.status] || STATUS.offline, h = H(p.haendelse_id);
    const gammel = p.status !== 'offline' && !set(p);
    return `
      <div class="foto-række${p.status === 'offline' ? ' offline' : ''}" data-foto="${p.id}">
        <i class="dot" style="--c:${st.farve}"></i>
        <div class="foto-info">
          <b>${esc(p.navn)}</b>${aktiveSos().some(x => x.bruger === p.id) ? ' <span class="sos-maerke">SOS</span>' : ''}
          <span class="lille"><span class="status-tekst" style="--c:${st.farve}">${st.tekst}</span> · ${siden(p.status_tid)}${gammel ? ` · <span class="advarsel">ikke set i ${siden(p.sidst_set) || 'lang tid'}</span>` : ''}</span>
          ${h ? `<button class="link opgave-link" data-zoom="${h.id}">${ikonFor(h)} ${esc(h.titel)}</button>` : ''}
        </div>
        <div class="foto-knapper">
          ${p.telefon ? `<a class="ikon-knap" href="tel:${esc(p.telefon)}" title="Ring til ${esc(p.navn)}">📞</a>` : ''}
          ${p.lat != null ? `<button class="ikon-knap" data-find-foto="${p.id}" title="Vis på kort">📍</button>` : ''}
          <button class="ikon-knap" data-ret-foto="${p.id}" title="Ret">✎</button>
        </div>
      </div>`;
  }).join('') : '<p class="tom">Ingen fotografer endnu. Opret dem i Supabase under Authentication.</p>';
}

// Tilbud: hvem har fået det, hvem har sagt nej, og nærmeste ledige som forslag
function tilbudLinjer(h) {
  if (!['ny'].includes(h.status)) return '';
  const tilb = (S().tilbud || []).filter(t => t.haendelse_id === h.id).sort((a, b) => a.nr - b.nr);
  const åbent = tilb.find(t => !t.svar && new Date(t.udloeber) > new Date());
  const nej = tilb.filter(t => t.svar === 'nej' || t.svar === 'udloebet');
  let html = '';
  if (h.tilbud_status === 'ingen_svar') html += `<p class="tilbud-alarm">⚠️ Ingen svar på tilbud – tildel manuelt</p>`;
  if (åbent) html += `<p class="tilbud-linje">📩 Tilbudt <b>${esc(navn(åbent.fotograf))}</b>${åbent.afstand_km != null ? ` (${kmTekst(åbent.afstand_km)})` : ''} · <span data-udloeber="${åbent.udloeber}">${nedtælling(åbent.udloeber)}</span> tilbage</p>`;
  if (nej.length) html += `<p class="lille">${nej.map(t => `${esc(navn(t.fotograf))}: ${t.svar === 'nej' ? 'nej tak' : 'intet svar'}`).join(' · ')}</p>`;
  // Forslag: nærmeste ledige (trin 1)
  if (h.lat != null && !åbent) {
    const maks = S().indst?.max_km || 35;
    const f = S().profiler.filter(p => p.rolle === 'foto' && p.status === 'ledig' && p.lat != null && !p.haendelse_id)
      .map(p => ({ p, d: km(p, h) })).filter(x => x.d <= maks).sort((a, b) => a.d - b.d)[0];
    if (f) html += `<p class="tilbud-forslag">Nærmeste ledige: <b>${esc(f.p.navn)}</b>, ${kmTekst(f.d)} <button class="link" data-giv="${h.id}" data-til="${f.p.id}">Giv opgaven til ${esc(f.p.navn)}</button></p>`;
  }
  return html;
}

function haendelseKort(h) {
  const taget = h.taget_af ? P(h.taget_af) : null;
  return `
    <article class="h-kort h-${h.status}${valgtId === h.id ? ' valgt' : ''}${h.status === 'ny' && h.tilbud_status === 'ingen_svar' ? ' blink' : ''}" data-id="${h.id}">
      <span class="kat">${ikonFor(h)}</span>
      <div class="h-tekst">
        <div class="h-linje"><h3>${esc(h.titel)}</h3><span class="pille p-${h.status}">${H_STATUS[h.status]}</span></div>
        <p class="adresse">${esc(h.adresse || '')}${h.lat == null ? ' <span class="advarsel">⚠ mangler placering</span>' : h.cirka ? ' <span class="advarsel">(cirka – ret placering)</span>' : ''}</p>
        <p class="lille">kl. ${klokken(h.oprettet)} · ${siden(h.oprettet)} siden · ${esc(h.kilde)}${h.app ? ` (${esc(h.app)})` : ''}</p>
        ${taget ? `<p class="lille taget-linje">👤 ${esc(taget.navn)}${h.taget_tid ? ` · taget kl. ${klokken(h.taget_tid)}` : ''}${h.ankommet_tid ? ` · ankommet kl. ${klokken(h.ankommet_tid)}` : ''}</p>` : ''}
        ${tilbudLinjer(h)}
        ${(n => n ? `<p class="opdatering"><span>${n.ikon} ${esc(n.tekst)}</span></p>` : '')(senesteNyt(h))}
        <p class="lille doegn-linje">${h.offentlig === false ? '🚫 Ikke på døgnrapporten' : `🌐 Døgnrapport: <b>${esc(h.offentlig_titel || (h.kategori === 'Andet' || !h.kategori ? 'Hændelse' : h.kategori))}</b>${offentligSted(h) ? ` · ${esc(offentligSted(h))}` : ''}`}</p>
        ${h.note ? `<p class="lille note">Note: ${esc(h.note)}</p>` : ''}
        ${h.auto_lukket && !aktiv(h) ? `<p class="lille auto-lukket">⏱ Lukket automatisk kl. ${klokken(h.afsluttet_tid)} – ingen opdateringer i ${String((S().indst?.luk_efter_min || 90) / 60).replace('.', ',')} time. Tryk <b>Genåbn</b> for at åbne den igen.</p>` : ''}
        <div class="h-knapper">
          ${aktiv(h) ? `<button data-tildel="${h.id}">${h.taget_af ? 'Skift fotograf' : 'Tildel'}</button>
            <button class="secondary" data-luk="${h.id}" data-s="afsluttet">Afslut</button>
            <button class="secondary" data-luk="${h.id}" data-s="annulleret">Annullér</button>`
            : `<button class="secondary" data-luk="${h.id}" data-s="ny">Genåbn</button>`}
          <button class="secondary" data-ret="${h.id}">Ret</button>
          <button class="secondary" data-kommentarer="${h.id}">💬${kommentarerTil(h.id).length ? ` ${kommentarerTil(h.id).length}` : ' Kommentér'}</button>
        </div>
      </div>
    </article>`;
}

function tegnHaendelser() {
  const liste = S().haendelser.filter(h => filter === 'alle' || aktiv(h))
    .sort((a, b) => (b.status === 'ny') - (a.status === 'ny') || b.oprettet.localeCompare(a.oprettet));
  $('#haendelser').innerHTML = liste.length ? liste.map(haendelseKort).join('') : '<p class="tom">Ingen hændelser.</p>';
}

function tegnLog() {
  $('#logbog').innerHTML = S().log.slice(0, 60).map(l => {
    const h = l.haendelse_id ? H(l.haendelse_id) : null;
    return `<li><time>${klokken(l.tid)}</time> <b>${l.bruger ? esc(navn(l.bruger)) : 'System'}</b> ${esc(l.handling)}${h ? ` – <button class="link" data-zoom="${h.id}">${esc(h.titel)}</button>` : ''}</li>`;
  }).join('');
}

function tegnKort() {
  const vis = S().haendelser.filter(h => aktiv(h) || h.id === valgtId);
  hLag.opdater(vis, h => ({
    ikon: haendelsesIkon(h, h.id === valgtId),
    popup: `<b>${esc(h.titel)}</b><br>${esc(h.adresse || '')}<br><small>${H_STATUS[h.status]}${h.taget_af ? ' – ' + esc(navn(h.taget_af)) : ''} · ${siden(h.oprettet)} siden</small>
      <div class="popup-knapper">${aktiv(h) ? `<button data-tildel="${h.id}">${h.taget_af ? 'Skift' : 'Tildel'}</button>` : ''}<button class="secondary" data-ret="${h.id}">Ret</button></div>`,
    klik: () => vælg(h.id, false),
  }));
  fLag.opdater(S().profiler.filter(p => p.rolle === 'foto' && p.status !== 'offline'), p => ({
    ikon: fotografIkon(p),
    popup: `<b>${esc(p.navn)}</b><br>${STATUS[p.status]?.tekst}${p.pos_tid ? `<br><small>position ${siden(p.pos_tid)} siden</small>` : ''}`,
  }));
  if (førsteZoom) {
    const pkt = [...vis.filter(h => h.lat != null).map(h => [h.lat, h.lon]),
      ...S().profiler.filter(p => p.status !== 'offline' && p.lat != null).map(p => [p.lat, p.lon])];
    if (pkt.length) { kort.vis(pkt, 12); førsteZoom = false; }
  }
}

function vælg(id, zoom = true) {
  valgtId = id;
  const h = H(id);
  tegnHaendelser(); tegnKort();
  if (h?.lat != null && zoom) { kort.setView([h.lat, h.lon], Math.max(kort.getZoom(), 13)); hLag.get(id)?.openPopup(); }
  document.querySelector(`#haendelser [data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------------------------------------------------------------------------------
// Tidslinje og kommentarer
let tidslinjeId = null;
function tegnTidslinje() {
  const dlg = $('#dlg-tidslinje'), h = H(tidslinjeId);
  if (!h || !dlg.open) return;
  gentegnMedFormular(dlg.querySelector('.ark-indhold'), `
    <div class="ark-top"><span class="kat stor">${ikonFor(h)}</span><button class="luk" data-luk-tl aria-label="Luk">✕</button></div>
    <h2>${esc(h.titel)}</h2>
    <p class="adresse">${esc(h.adresse || 'Ingen adresse')}${h.cirka ? ' (ca.)' : ''}</p>
    <p class="lille">Modtaget kl. ${klokken(h.oprettet)} · ${H_STATUS[h.status]}${h.taget_af ? ` · ${esc(navn(h.taget_af))}` : ''}</p>
    ${tidslinjeHtml(h)}`);
}
function åbnTidslinje(id) {
  tidslinjeId = id;
  const dlg = $('#dlg-tidslinje');
  if (!dlg.open) dlg.showModal();
  tegnTidslinje();
  setTimeout(() => dlg.querySelector('form.kommentar-form textarea')?.focus(), 60);
}

// ---------------------------------------------------------------------------------
// Invitationer: kun inviterede e-mails kan oprette en bruger
async function åbnInvitationer() {
  let dlg = $('#dlg-inviter');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'dlg-inviter'; dlg.className = 'ark';
    dlg.innerHTML = `
      <div class="ark-indhold">
        <div class="ark-top"><h2>👥 Inviter ny bruger</h2><button class="luk" data-luk-inv aria-label="Luk">✕</button></div>
        <p class="hint">Kun e-mails på listen kan oprette en bruger i Fotovagt. Den nye åbner <b>vagt.hrc-fotos.dk</b>, trykker
          <b>"Ny bruger? Opret din adgangskode"</b> og bruger den e-mail, du skriver her. Så kommer de automatisk med på kortet, i tilbud og i rapporterne.</p>
        <form id="form-inviter" class="inviter-form">
          <label>Navn <input name="navn" required autocomplete="off"></label>
          <label>E-mail <input name="email" type="email" required autocomplete="off"></label>
          <label>Telefon <input name="telefon" type="tel" autocomplete="off"></label>
          <label>Rolle <select name="rolle"><option value="foto">Fotograf</option><option value="kontor">Kontor</option></select></label>
          <button type="submit">Inviter</button>
        </form>
        <div class="kopi-boks" id="inv-kopi" hidden></div>
        <h3 class="inv-titel">Inviterede</h3>
        <div id="inv-liste" class="inv-liste"><p class="hint">Henter …</p></div>
      </div>`;
    document.body.append(dlg);
    dlg.addEventListener('click', async e => {
      if (e.target === dlg || e.target.closest('[data-luk-inv]')) return dlg.close();
      const s = e.target.closest('[data-slet-inv]');
      if (s && confirm(`Fjern invitationen til ${s.dataset.sletInv}? (En bruger, der allerede er oprettet, beholder sin adgang – den fjernes under Fotografer.)`)) {
        await prøv(() => store.sletInvitation(s.dataset.sletInv), 'Invitationen er fjernet.'); visListe();
      }
      const c = e.target.closest('[data-kopi]');
      if (c) { try { await navigator.clipboard.writeText(c.dataset.kopi); toast('Teksten er kopieret.', 'ok'); } catch { toast('Kunne ikke kopiere – markér teksten og kopiér selv.', 'fejl'); } }
    });
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, data = { navn: f.navn.value.trim(), email: f.email.value.trim(), telefon: f.telefon.value.trim(), rolle: f.rolle.value };
      if (await prøv(() => store.inviter(data), `${data.navn} er inviteret.`)) {
        const tekst = `Hej ${data.navn}. Du er inviteret til Fotovagt. Åbn https://vagt.hrc-fotos.dk, tryk "Ny bruger? Opret din adgangskode" og brug denne e-mail: ${data.email.toLowerCase()}`;
        $('#inv-kopi').hidden = false;
        $('#inv-kopi').innerHTML = `<p>Send denne besked til ${esc(data.navn)} (sms eller mail):</p><p class="kopi-tekst">${esc(tekst)}</p><button type="button" class="secondary" data-kopi="${esc(tekst)}">📋 Kopiér beskeden</button>`;
        f.reset(); visListe();
      }
    });
  }
  async function visListe() {
    try {
      const liste = await store.hentInvitationer();
      $('#inv-liste').innerHTML = liste.length ? liste.map(i => `
        <div class="inv-række">
          <div><b>${esc(i.navn || i.email)}</b> <small>${i.rolle === 'kontor' ? 'Kontor' : 'Fotograf'}</small><br><small>${esc(i.email)}${i.telefon ? ` · ${esc(i.telefon)}` : ''}</small></div>
          <span class="pille ${i.brugt ? 'p-afsluttet' : 'p-ny'}">${i.brugt ? 'Oprettet' : 'Venter'}</span>
          ${i.brugt ? '' : `<button class="link fare" data-slet-inv="${esc(i.email)}">Fjern</button>`}
        </div>`).join('') : '<p class="hint">Ingen invitationer endnu.</p>';
    } catch (e) { $('#inv-liste').innerHTML = `<p class="fejl-tekst">${esc(store.fejlTekst(e))}</p>`; }
  }
  $('#inv-kopi').hidden = true;
  dlg.showModal();
  visListe();
}

// ---------------------------------------------------------------------------------
// Tildel
function åbnTildel(id) {
  const h = H(id), dlg = $('#dlg-tildel');
  const fotos = S().profiler.filter(p => p.rolle === 'foto')
    .map(p => ({ p, d: km(p, h) }))
    .sort((a, b) => ((a.p.status === 'ledig' ? 0 : a.p.status === 'offline' ? 2 : 1) - (b.p.status === 'ledig' ? 0 : b.p.status === 'offline' ? 2 : 1))
      || ((a.d ?? 1e9) - (b.d ?? 1e9)));
  dlg.querySelector('.ark-indhold').innerHTML = `
    <div class="ark-top"><h2>Tildel: ${esc(h.titel)}</h2><button class="luk" data-luk-dlg aria-label="Luk">✕</button></div>
    <p class="adresse">${esc(h.adresse || '')}</p>
    <div class="tildel-liste">
      ${fotos.map(({ p, d }) => {
        const opt = p.haendelse_id && p.haendelse_id !== id;
        return `<button class="tildel-række secondary" data-vælg="${p.id}" ${opt ? 'disabled' : ''}>
          <i class="dot" style="--c:${STATUS[p.status]?.farve}"></i>
          <span><b>${esc(p.navn)}</b> <small>${STATUS[p.status]?.tekst}${opt ? ' · har en opgave' : ''}${p.id === h.taget_af ? ' · har denne' : ''}</small></span>
          <span class="afstand">${kmTekst(d)}</span></button>`;
      }).join('')}
    </div>
    ${h.taget_af ? '<button class="link fare" data-vælg="">Fjern fotografen fra opgaven</button>' : ''}`;
  dlg.onclick = async e => {
    if (e.target === dlg || e.target.closest('[data-luk-dlg]')) return dlg.close();
    const b = e.target.closest('[data-vælg]'); if (!b) return;
    const foto = b.dataset.vælg || null;
    if (await prøv(() => store.tildel(id, foto), foto ? `Opgaven er givet til ${navn(foto)}.` : 'Fotografen er fjernet.')) dlg.close();
  };
  dlg.showModal();
}

// ---------------------------------------------------------------------------------
// Ny / ret hændelse med lille kort
let retKort, retMarkør;
function åbnRet(id = null) {
  const h = id ? H(id) : null, f = $('#form-ret'), dlg = $('#dlg-ret');
  f.reset();
  $('#ret-titel').textContent = h ? 'Ret hændelse' : 'Ny hændelse';
  $('#indsaet-besked').hidden = !!h;
  for (const k of ['titel', 'tekst', 'adresse', 'url', 'lat', 'lon']) f[k].value = h?.[k] ?? '';
  f.kategori.value = h?.kategori || 'Andet';
  f.offentlig.checked = h ? h.offentlig !== false : true;
  f.offentlig_titel.value = h?.offentlig_titel || '';
  $('#ret-offentlig-sted').textContent = h ? (offentligSted(h) || 'ingen by kendt endnu') : 'by og postnummer findes ud fra adressen';
  dlg.showModal();
  if (!retKort) {
    retKort = lavKort($('#ret-kort'));
    retKort.on('click', e => sætNål(e.latlng.lat, e.latlng.lng));
  }
  setTimeout(() => {
    retKort.invalidateSize();
    if (h?.lat != null) { sætNål(h.lat, h.lon); retKort.setView([h.lat, h.lon], 15); }
    else { if (retMarkør) { retMarkør.remove(); retMarkør = null; } retKort.setView(kort.getCenter(), kort.getZoom()); }
  }, 60);
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'gem') return;
    const felter = {
      titel: f.titel.value.trim(), tekst: f.tekst.value.trim() || null, adresse: f.adresse.value.trim() || null,
      kategori: f.kategori.value, url: f.url.value.trim() || null,
      lat: f.lat.value ? +f.lat.value : null, lon: f.lon.value ? +f.lon.value : null,
      offentlig: f.offentlig.checked, offentlig_titel: f.offentlig_titel.value.trim() || null,
    };
    if (felter.lat != null && (!h || felter.lat !== h.lat || felter.lon !== h.lon || felter.adresse !== h.adresse)) felter.cirka = false;
    if (h) await prøv(() => store.ret(h.id, felter), 'Hændelsen er rettet.');
    else await prøv(() => store.opret(felter), 'Hændelsen er oprettet.');
  };
}
function sætNål(lat, lon) {
  const f = $('#form-ret');
  f.lat.value = lat.toFixed(6); f.lon.value = lon.toFixed(6);
  if (!retMarkør) {
    retMarkør = L.marker([lat, lon], { draggable: true }).addTo(retKort);
    retMarkør.on('dragend', () => { const p = retMarkør.getLatLng(); f.lat.value = p.lat.toFixed(6); f.lon.value = p.lng.toFixed(6); });
  } else retMarkør.setLatLng([lat, lon]);
}
async function findAdresse() {
  const f = $('#form-ret'), a = f.adresse.value.trim();
  if (!a) return toast('Skriv en adresse først.', 'fejl');
  const knap = $('#btn-find'); knap.disabled = true; knap.textContent = '…';
  const pos = await store.geokod(a).catch(() => null);
  knap.disabled = false; knap.textContent = 'Find';
  if (!pos) return toast('Adressen blev ikke fundet. Klik på kortet i stedet.', 'fejl');
  sætNål(pos.lat, pos.lon); retKort.setView([pos.lat, pos.lon], 16);
}
function læsBesked() {
  const f = $('#form-ret'), raa = f.raa.value.trim();
  if (!raa) return;
  // Kopieret fra Pushover som "Titel: besked …" (fx "🚒 Odder: 🔥 Bygn.brand-Lejlighed")
  const [første, ...rest] = raa.split('\n');
  const m = første.match(/^(.{2,60}?):\s+(.+)$/);
  const p = m && !/^(adresse|station|beredskab|lokation|sted)$/i.test(m[1].trim())
    ? parseBesked({ title: m[1], message: [m[2], ...rest].join('\n') })
    : parseBesked({ title: rest.length ? første : '', message: rest.length ? rest.join('\n') : raa });
  f.titel.value = p.titel; f.tekst.value = p.tekst; f.adresse.value = p.adresse; f.kategori.value = p.kategori;
  if (p.cirka) toast('Beskeden har kun by/station – tjek placeringen på kortet.');
  if (p.url) f.url.value = p.url;
  if (p.lat != null) { sætNål(p.lat, p.lon); retKort.setView([p.lat, p.lon], 15); }
  else if (p.adresse) findAdresse();
}

// ---------------------------------------------------------------------------------
// Fotograf
function åbnFoto(id) {
  const p = P(id), f = $('#form-foto'), dlg = $('#dlg-foto');
  f.navn.value = p.navn; f.telefon.value = p.telefon || ''; f.status.value = p.status; f.rolle.value = p.rolle;
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'gem') return;
    if (f.status.value !== p.status) await prøv(() => store.saetStatus(id, f.status.value));
    await prøv(() => store.retFotograf(id, { navn: f.navn.value.trim(), telefon: f.telefon.value.trim() || null, rolle: f.rolle.value }), 'Gemt.');
  };
  dlg.showModal();
}

// ---------------------------------------------------------------------------------
// Pushover-forbindelse
// Eksempler fra jeres rigtige Pushover-beskeder (app, titel, besked).
// 1-1-2 Århus + Mast er samme alarm og lægges sammen. Radioprøven og busbeskeden springes over.
const DEMO_BESKEDER = [
  ['1-1-2 Århus', '', 'ABA12 CI-M1 + CI  S1 Ny Munkegade 114 8000 Aarhus C Aarhus Kommune'],
  ['Mast', '🚒 Aarhus C', '🔥 ABA12 CI-M1 + CI-S1\nBeredskab: Østjyllands Brandvæsen\nStation: Aarhus C\nAdresse: Ny Munkegade 114, 8000 Aarhus C\n24-11-2026 15:51'],
  ['1-1-2 Århus', '', '@0 Ass.-A-sprøjte og tankvogn OD-M1 + OD V1 Byvej 63 8330 Beder'],
  ['1-1-2 Århus', '', 'ABA11 SY-M1 + SY V1 Byvej 63 8330 Beder'],
  ['Mast', '🚒 Assistance - Vejle', '🔥 Assistance: Assistance VB V-1 /- (VB ISL + VB MR-1) EL-instal.-Brand-Transformatorstation, Lysholt All. 11 , 7100 Vejle\nBeredskab: Vejle Brandvæsen\nStation: Vejle\n24-11-2026 14:47'],
  ['PF-Upload', '🚒 Odder', '🔥 Bygn.brand-Lejlighed\nBeredskab: Østjyllands Brandvæsen\nStation: Odder\n24-11-2026 16:54'],
  ['Trafik Server', 'Trafikmelding', '<b>Uheld</b>\nE45 Nordjyske Motorvej fra Aarhus mod Randers mellem &lt;46&gt; Aarhus Nord og &lt;44&gt; Hadsten\n\nUheld, Spor blokeret, Uheldsstedet er ikke sikret'],
  ['PF-Upload', 'Trafikmelding', '🚙 Uheld\nE45 Nordjyske Motorvej fra Aarhus mod Randers mellem [46] Aarhus Nord og [44] Hadsten\nUheld, Spor blokeret\n\nNordjyske Motorvej, 8380 Spørring, Aarhus Kommune\n24-11-2026 16:22:00\n\nSe placeringen her: https://112meldinger.dk/map.php?uid=NKtJaLs'],
  ['Google Maps Scanner', '🚨 Muligt trafikuheld detekteret på Google Maps', '📍 Østjyske Motorvej\n🏙️ 7100 Vejle\n⚠️ AI-detektion af trafikmaengde var ikke mulig - meldingen er ikke verificeret\n🕒 Detekteret kl. 16:04'],
  ['PF-Upload', '🚁🛬 Lægehelikopter landet', '🚁🛬 Lægehelikopter landet\nLN-OTS (EC45) · DOC03\nSted: Aakjærvej, Odder (8300)\nGoogle Maps: https://maps.google.com/?q=55.908027,10.127163\nFlyvetid: 1152 sek · Distance: 62.91 km'],
  ['PF-Upload', '💧 Akut vandafbrydelse – Silkeborg', '💧 AKUT VANDAFBRYDELSE\n📮 Postnummer: 8600 Silkeborg\n🔧 Lukning af vandet Remstrupvej tirsdag d. 24. november\nPå grund af et brud på en vandledning er vi nødt til at lukke for vandet på Remstrupvej, Åhave Allé i dag.\n🏢 Silkeborg Forsyning'],
  ['PF-Upload', '👮🏼‍♂️ Østjyllands Politi', 'Østjyllands Politi efterlyser 20-årig mand fra Randers, der er gået fra Falkevej i 8930 Randers NØ omkring kl. 2030. Kontakt Østjyllands Politi på 114.\n\nLæs mere: https://via.ritzau.dk/pressemeddelelse/15307670/efterlysning-af-20-arig-mand-i-randers'],
  ['PF-Upload', '👮🏼‍♂️ Østjyllands Politi', 'Den unge mand fra Randers er fundet. Vi takker for hjælpen med finde ham. Vi opfordrer alle til slette foto og navn af personen, hvis det er blevet delt.\n\nLæs mere: https://via.ritzau.dk/pressemeddelelse/15307670/efterlysning-af-20-arig-mand-i-randers#sm-15307757'],
  ['PF-Upload', '⚡ Strømafbrydelse – Silkeborg', '⚡ STRØMAFBRYDELSE\n📍 By: Silkeborg\n📮 Postnummer: 8600\n🔔 Type: Planlagt\n👥 Berørte kunder: 109'],
  ['PF-Upload', '👮🏼‍♂️ Østjyllands Politi', 'Østjyllands Politi modtog kl. 1857 en anmeldelse om et færdselsuheld på Randersvej ved Djurslandsmotorvejen i nordlig retning. Politi og redningberedskab er til stede og kørebanen er lukket for al færdsel i nordlig retning i flere timer.\n\nLæs mere: https://via.ritzau.dk/pressemeddelelse/15307461/faerdselsuheld-randersvej-v-djurslandsmotorvejen'],
  ['PF-Upload', '🚨 Breaking', 'TV2Ostjylland.dk: En person er omkommet i trafikulykke - alt er spærret\n\nEn person er omkommet i forbindelse med en trafikulykke på Randersvej ved Djurslandsmotorvejen. Det oplyser Østjyllands Politi. https://www.tv2ostjylland.dk/aarhus/en-person-er-omkommet-i-trafikulykke-fd8fc'],
  ['PF-Upload', '🚨 Breaking', 'TVMidtvest.dk: Vej spærret efter uheld\n\nMandag formiddag er der sket et uheld, hvor Hovedvejen bliver til Viborgvej nordøst for Aalestrup. Politi og redningsfolk er på stedet. https://www.tvmidtvest.dk/vesthimmerland/vej-spaerret-efter-uheld-ved-aalestrup-a967e'],
  ['1-1-2 Århus', '', '24-11 26 Radioprøve fra Østjyllands Brandvæsen'],
  ['PF-Upload', 'Trafikmelding - Midttrafik (Bus)', 'Forsinkelser Pga uheld på motorvejen, er der store forsinkelser på busserne i Vejle. Rejsegarantien bortfalder. Lokation: Vejle Trafikcenter'],
];
let næsteEksempel = 1;
let poStatus = {};
async function hentPoStatus() {
  try { poStatus = await store.pushover({}); } catch (e) { poStatus = { fejl: store.fejlTekst(e) }; }
  const prik = $('#po-prik');
  prik.className = 'prik ' + (poStatus.forbundet ? (poStatus.fejl ? 'gul' : 'grøn') : 'grå');
  prik.title = poStatus.forbundet ? (poStatus.fejl || 'Forbundet') : 'Ikke forbundet';
  return poStatus;
}
async function åbnPushover() {
  const dlg = $('#dlg-pushover'), el = dlg.querySelector('.ark-indhold');
  const s = await hentPoStatus();
  el.innerHTML = `
    <div class="ark-top"><h2>Pushover</h2><button class="luk" data-luk-dlg aria-label="Luk">✕</button></div>
    ${s.forbundet ? `
      <p class="status-linje ${s.fejl ? 'h-ny' : 'h-afsluttet'}">${s.fejl ? '⚠ ' + esc(s.fejl) : '✓ Forbundet – nye beskeder hentes automatisk'}</p>
      <p class="lille">Senest hentet: ${s.sidst_hentet ? `kl. ${klokken(s.sidst_hentet)} (${siden(s.sidst_hentet)} siden)` : 'endnu ikke'}${s.device_id ? ` · enhed ${esc(s.device_id).slice(0, 8)}…` : ''}</p>
      <div class="knap-række">
        ${store.cloud ? '<button type="button" class="secondary" id="po-hent">Hent nu</button>' : ''}
        <button type="button" class="link fare" id="po-afbryd">Afbryd forbindelsen</button></div>` : `
      <p>Forbind jeres Pushover-konto, så alarmerne automatisk bliver til hændelser på kortet.
      Fotovagt bliver en ekstra "enhed" på kontoen (som Pushover på en computer) – telefonerne får stadig beskederne som før.</p>
      <p class="hint">Kræver Pushover for Desktop-licens på kontoen (engangsbeløb ca. 5 $ efter 30 dages prøve). Adgangskoden bliver ikke gemt.</p>
      <form id="po-forbind" class="ark-form">
        <label>Pushover e-mail <input name="email" type="email" required autocomplete="off"></label>
        <label>Pushover adgangskode <input name="password" type="password" required autocomplete="off"></label>
        <label id="po-2fa" hidden>Kode fra to-trins-login <input name="twofa" inputmode="numeric" autocomplete="one-time-code"></label>
        <button type="submit">Forbind</button>
      </form>`}
    <hr>
    <form id="po-filter" class="ark-form">
      <h3>Hvilke beskeder bliver til hændelser?</h3>
      <label>Kun fra disse Pushover-apps (adskil med komma – tom = alle)
        <input name="apps" value="${esc((s.kun_apps || []).join(', '))}" placeholder="Fx 1-1-2 Århus, Mast, PF-Upload, Trafik Server, Google Maps Scanner"></label>
      <label>Spring beskeder over, der indeholder (adskil med komma)
        <input name="ignorer" value="${esc((s.ignorer || []).join(', '))}" placeholder="Fx (Bus), Vejarbejde"></label>
      <p class="hint">Radioprøver springes altid over.</p>
      <button type="submit" class="secondary">Gem</button>
    </form>
    <hr>
    <h3>Prøv med en testbesked</h3>
    <p class="hint">Skriv en besked, som den ser ud i Pushover. Den bliver læst og placeret på kortet præcis som de rigtige.</p>
    <form id="po-test" class="ark-form">
      <label>Afsender (Pushover-app) <input name="app" value="${esc(DEMO_BESKEDER[0][0])}"></label>
      <label>Titel <input name="title" value="${esc(DEMO_BESKEDER[0][1])}" placeholder="Tom, hvis beskeden ikke har en titel"></label>
      <label>Besked <textarea name="message" rows="5">${esc(DEMO_BESKEDER[0][2])}</textarea></label>
      <div class="knap-række"><button type="submit">Send testbesked</button>
        <button type="button" class="secondary" id="po-tilfældig">Næste eksempel</button></div>
    </form>
    ${store.demo ? '<hr><button type="button" class="link fare" id="demo-nulstil">Nulstil demo-data</button>' : ''}`;

  el.onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'po-forbind') {
      const knap = f.querySelector('[type=submit]'); knap.disabled = true; knap.textContent = 'Forbinder…';
      try {
        const r = await store.pushover({ forbind: { email: f.email.value.trim(), password: f.password.value, twofa: f.twofa.value.trim() || undefined } });
        if (r.twofa) { $('#po-2fa').hidden = false; f.twofa.focus(); toast('Skriv koden fra to-trins-login.'); }
        else if (!r.ok) toast(r.fejl || 'Kunne ikke forbinde.', 'fejl');
        else { toast('Pushover er forbundet.', 'ok'); return åbnPushover(); }
      } catch (err) { toast(store.fejlTekst(err), 'fejl'); }
      knap.disabled = false; knap.textContent = 'Forbind';
    }
    if (f.id === 'po-filter') { await prøv(() => store.pushover({ kun_apps: f.apps.value, ignorer: f.ignorer.value }), 'Gemt.'); hentPoStatus(); }
    if (f.id === 'po-test') {
      const knap = f.querySelector('[type=submit]'); knap.disabled = true;
      await prøv(async () => {
        const h = await store.simulerBesked(f.title.value.trim(), f.message.value.trim(), undefined, f.app.value.trim(), poStatus.ignorer || []);
        if (h.ignoreret) return toast('Beskeden springes over (radioprøve eller på listen over beskeder, der springes over).');
        if (h.slaaetSammen) return toast(`Samme alarm som "${h.slaaetSammen.titel}" – lagt sammen med den.`, 'ok');
        if (h.lat == null) throw new Error('Testhændelsen er oprettet, men adressen blev ikke fundet. Ret den i listen.');
        toast('Testhændelsen er lagt på kortet.', 'ok');
      });
      knap.disabled = false;
    }
  };
  el.onclick = async e => {
    if (e.target.closest('[data-luk-dlg]')) return dlg.close();
    if (e.target.id === 'po-tilfældig') {
      const [a, t, m] = DEMO_BESKEDER[næsteEksempel++ % DEMO_BESKEDER.length];
      const f = el.querySelector('#po-test');
      f.app.value = a; f.title.value = t; f.message.value = m;
    }
    if (e.target.id === 'po-hent') { await prøv(() => store.pushover({ hent_nu: true }), 'Hentet.'); åbnPushover(); }
    if (e.target.id === 'po-afbryd' && confirm('Afbryd forbindelsen til Pushover? Nye alarmer kommer så ikke ind automatisk.')) {
      await prøv(() => store.pushover({ afbryd: true }), 'Forbindelsen er afbrudt.'); åbnPushover();
    }
    if (e.target.id === 'demo-nulstil' && confirm('Nulstil alle demo-data?')) { store.nulstil(); dlg.close(); }
  };
  dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
  if (!dlg.open) dlg.showModal();
}

// ---------------------------------------------------------------------------------
async function start() {
  mig = await logInd({ kunKontor: true });
  $('#demo-mærke').hidden = !store.demo;
  kort = lavKort($('#kort'));
  hLag = markørLag(kort); fLag = markørLag(kort); sLag = markørLag(kort);

  store.lyt(s => {
    tegn();
    if (s.nyHaendelse) { bip(); toast(`Ny hændelse: ${s.nyHaendelse.titel}`, 'ny'); }
    if (s.nyKommentar) {
      const k = s.nyKommentar, h = H(k.haendelse_id);
      toast(`💬 ${navn(k.bruger)}${h ? ` på "${h.titel}"` : ''}: ${k.tekst.slice(0, 100)}`, 'ny');
    }
    tegnTidslinje();
  });
  tegn();
  hentPoStatus();

  // Klik overalt på siden (lister, kort-popups)
  document.body.addEventListener('click', e => {
    const t = e.target.closest('[data-giv],[data-tildel],[data-luk],[data-ret],[data-kommentarer],[data-zoom],[data-find-foto],[data-ret-foto],[data-filter],.h-kort');
    if (!t || t.closest('dialog')) return;
    const d = t.dataset;
    if (d.tildel) return åbnTildel(d.tildel);
    if (d.giv) return prøv(() => store.tildel(d.giv, d.til), `Opgaven er givet til ${navn(d.til)}.`);
    if (d.luk) {
      const h = H(d.luk);
      const spørg = { afsluttet: 'Afslut', annulleret: 'Annullér', ny: 'Genåbn' }[d.s];
      if (d.s === 'ny' || confirm(`${spørg} "${h.titel}"?${h.taget_af ? ` ${navn(h.taget_af)} bliver meldt ledig.` : ''}`)) {
        prøv(() => store.luk(d.luk, d.s), 'Opdateret.');
      }
      return;
    }
    if (d.ret) return åbnRet(d.ret);
    if (d.kommentarer) return åbnTidslinje(d.kommentarer);
    if (d.zoom) return vælg(d.zoom);
    if (d.retFoto) return åbnFoto(d.retFoto);
    if (d.findFoto) { const p = P(d.findFoto); kort.setView([p.lat, p.lon], 14); fLag.get(p.id)?.openPopup(); return; }
    if (d.filter) {
      filter = d.filter;
      document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.filter === filter)));
      return tegnHaendelser();
    }
    if (t.classList.contains('h-kort') && !e.target.closest('button,a')) vælg(t.dataset.id);
  });

  // SOS-knapper i den røde boks
  $('#sos-omraade').onclick = async e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.sosSet) await prøv(() => store.sosKvitter(t.dataset.sosSet), 'Alarmen er markeret som set. Fotografen får besked.');
    if (t.dataset.sosVis) visSos(t.dataset.sosVis);
    if (t.dataset.sosAfslut && confirm('Afslut SOS-alarmen? Gør det kun, når fotografen er i sikkerhed.')) await prøv(() => store.sosAfslut(t.dataset.sosAfslut), 'Alarmen er afsluttet.');
  };
  // Push på kontorets computer (SOS-alarmer, også når fanen ikke er fremme)
  const pushTekst = async () => {
    const sub = await (await navigator.serviceWorker?.ready)?.pushManager?.getSubscription().catch(() => null);
    $('#btn-push').textContent = sub ? '🔔 Push er slået til' : '🔕 Slå push til';
    return !!sub;
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(pushTekst).catch(() => {});
  $('#btn-push').onclick = async () => {
    if (store.demo) return toast('Push-beskeder virker først, når Fotovagt er sat op med Supabase.');
    const grund = pushKanBruges(); if (grund) return toast(grund, 'fejl');
    if (await pushTekst()) { if (confirm('Slå push fra på denne computer?')) await prøv(afmeldPush, 'Push er slået fra.'); }
    else await prøv(async () => { await abonnérPush(); await store.testPush().catch(() => {}); }, 'Push er slået til. Der kommer en prøve.');
    pushTekst();
  };
  const sosLink = new URLSearchParams(location.search).get('sos');
  if (sosLink) { history.replaceState(null, '', location.pathname + (store.demo ? '?demo' : '')); setTimeout(() => visSos(sosLink), 300); }
  navigator.serviceWorker?.addEventListener('message', e => {
    const id = e.data?.åbn && new URL(e.data.åbn, location.href).searchParams.get('sos'); if (id) visSos(id);
  });

  $('#btn-auto').onclick = async () => {
    const til = S().indst?.auto_tilbud !== false;
    if (til && !confirm('Slå automatiske tilbud fra? Nye opgaver skal så tildeles manuelt.')) return;
    await prøv(() => store.sætAutoTilbud(!til), til ? 'Automatiske tilbud er slået fra.' : 'Automatiske tilbud er slået til.');
  };
  kendteBlink = new Set(S().haendelser.filter(h => h.status === 'ny' && h.tilbud_status === 'ingen_svar').map(h => h.id));

  $('#btn-ny').onclick = () => åbnRet();
  $('#btn-find').onclick = findAdresse;
  $('#btn-laes').onclick = læsBesked;
  $('#btn-pushover').onclick = åbnPushover;
  $('#btn-logud').onclick = async () => { await store.logout(); location.reload(); };
  $('#btn-kode').onclick = () => åbnSkiftKode();
  $('#btn-rapport').onclick = () => åbnRapport();
  $('#btn-inviter').onclick = () => åbnInvitationer();
  // Telefon: knapperne ligger i en menu, så toppen ikke fylder halvdelen af skærmen
  const menuKnap = $('#btn-menu'), menu = $('#top-menu');
  const lukMenu = () => { document.body.classList.remove('menu-åben'); menuKnap.setAttribute('aria-expanded', 'false'); };
  menuKnap.onclick = e => { e.stopPropagation(); const åben = document.body.classList.toggle('menu-åben'); menuKnap.setAttribute('aria-expanded', String(åben)); };
  menu.addEventListener('click', e => { if (e.target.closest('button')) setTimeout(lukMenu, 0); });
  document.addEventListener('click', e => { if (!e.target.closest('#top-menu, #btn-menu')) lukMenu(); });
  const dlgTl = $('#dlg-tidslinje');
  kommentarHandlinger(dlgTl);
  dlgTl.addEventListener('click', e => { if (e.target === dlgTl || e.target.closest('[data-luk-tl]')) dlgTl.close(); });
  for (const id of ['#dlg-ret', '#dlg-foto']) $(id).addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  setInterval(() => { tegnFotografer(); tegnHaendelser(); tegnNøgletal(); }, 30e3);
  setInterval(hentPoStatus, 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') store.hentAlt().catch(() => {}); });
}

start();
