// Kontoret: overblik over hændelser og fotografer, tildeling, oprettelse og Pushover-forbindelse.
import { store } from './store.js';
import { parseBesked } from './supabase/functions/pushover/parse.js';
import { åbnRapport } from './rapport.js';
import {
  STATUS, H_STATUS, KATEGORI_IKON, ikonFor, aktiv, senesteOpdatering, esc, $, siden, klokken, km, kmTekst, set,
  toast, prøv, bip, lavKort, haendelsesIkon, fotografIkon, markørLag, logInd,
  pushKanBruges, abonnérPush, afmeldPush, aktiveSos, sosBoks, sosIkon, alarm, nedtælling,
  tidslinjeHtml, gentegnMedFormular, kommentarHandlinger, kommentarerTil, senesteNyt, offentligSted, åbnSkiftKode,
  PRIO, prioAf, efterPrio, iNærheden, indsigt, indsigtHtml,
  stationsKontrol, regionFraPostnr, avatar, fotoFelt,
  nyhederHtml, adresseForslag, adresseFelt, helikopterLag, vejrRisikoLinje, sikkerhedHtml,
} from './faelles.js';

let sLag;
let mig, kort, hLag, fLag, filter = 'aktive', valgtId = null, førsteZoom = true;
let kendteForslag = new Set(), forslagKlar = false;
const S = () => store.state;
const P = id => S().profiler.find(p => p.id === id);
const H = id => S().haendelser.find(h => h.id === id);
const navn = id => P(id)?.navn || '–';
const O = id => (S().omraader || []).find(o => o.id === id);
const STATUS_ORDEN = { ledig: 0, ankommet: 1, optaget: 2, pause: 3, offline: 4 };

// ---------------------------------------------------------------------------------
function tegn() {
  tegnSos(); tjekBlink();
  tegnNøgletal(); tegnFotografer(); tegnHaendelser(); tegnLog(); tegnKort();
}

// SOS: rød boks øverst med navn, telefon og placering; alarmen lyder, indtil nogen har trykket "Set"
let kendteBlink = new Set();
// Prikkerne på "Værktøjer": grøn = til, gul = fejl, grå = fra
function sætPrik(navn, farve) { const i = document.querySelector(`#vaerktoej-prikker [data-prik="${navn}"]`); if (i) i.className = farve; }
function tjekBlink() {
  const nu = S().haendelser.filter(h => h.status === 'ny' && h.tilbud_status === 'ingen_svar').map(h => h.id);
  if (nu.some(id => !kendteBlink.has(id))) { bip(); setTimeout(bip, 700); toast('⚠️ En opgave er ikke taget – tildel manuelt', 'fejl'); }
  kendteBlink = new Set(nu);
  const knap = $('#btn-auto');
  if (knap) { const til = S().indst?.auto_tilbud !== false; $('#auto-tekst').textContent = til ? 'til' : 'fra'; knap.setAttribute('aria-checked', String(til)); sætPrik('auto', til ? 'grøn' : 'grå'); }
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
  const række = p => {
    const st = STATUS[p.status] || STATUS.offline, h = H(p.haendelse_id);
    const gammel = p.status !== 'offline' && !set(p);
    return `
      <div class="foto-række${p.status === 'offline' ? ' offline' : ''}" data-foto="${p.id}">
        ${avatar(p, 40)}
        <div class="foto-info">
          <b>${esc(p.navn)}</b>${aktiveSos().some(x => x.bruger === p.id) ? ' <span class="sos-maerke">SOS</span>' : ''}
          <span class="lille"><span class="status-tekst ${st.klasse}">${st.tekst}</span> · ${siden(p.status_tid)}${gammel ? ` · <span class="advarsel">ikke set i ${siden(p.sidst_set) || 'lang tid'}</span>` : ''}</span>
          ${p.base_adresse ? `<span class="lille base-lille">🏠 ${esc(p.base_adresse)}</span>` : ''}
          ${h ? `<button class="link opgave-link" data-zoom="${h.id}">${ikonFor(h)} ${esc(h.titel)}</button>` : ''}
        </div>
        <div class="foto-knapper">
          ${p.telefon ? `<a class="ikon-knap" href="tel:${esc(p.telefon)}" title="Ring til ${esc(p.navn)}">📞</a>` : ''}
          ${p.lat != null ? `<button class="ikon-knap" data-find-foto="${p.id}" title="Vis på kort">📍</button>` : ''}
          <button class="ikon-knap" data-ret-foto="${p.id}" title="Ret">✎</button>
        </div>
      </div>`;
  };
  if (!liste.length) { $('#fotografer').innerHTML = '<p class="tom">Ingen fotografer endnu. Tryk "＋ Ny bruger" for at oprette en.</p>'; return; }
  const områder = S().omraader || [];
  if (!områder.length) { $('#fotografer').innerHTML = liste.map(række).join(''); return; }
  // Grupperet efter område (fotografer uden område til sidst)
  const grupper = [...områder.map(o => [o, liste.filter(p => p.omraade_id === o.id)]), [null, liste.filter(p => !O(p.omraade_id))]]
    .filter(([o, l]) => l.length || o);
  // Tomme regioner samles på én linje øverst
  const tomme = grupper.filter(([o, l]) => o && !l.length).map(([o]) => esc(o.navn));
  $('#fotografer').innerHTML = (tomme.length ? `<p class="omraade-tomme">Ingen fotografer i ${tomme.join(', ')}.</p>` : '') + grupper.filter(([, l]) => l.length).map(([o, l]) => `
    <div class="omraade-top"><i class="dot" style="--c:${o ? esc(o.farve) : 'var(--offline)'}"></i>${o ? esc(o.navn) : 'Uden område'}
      <small>${l.filter(p => p.status === 'ledig').length} ledig af ${l.length}</small></div>
    ${l.map(række).join('')}`).join('');
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

// Forslag om opgradering, som kontoret ikke har taget stilling til endnu
const forslag = h => h.eskalering_forslag && !h.eskaleret && !h.eskalering_afvist && aktiv(h);

// Forslag om sammenlægning (databasefunktionen sammen_forslag i sammenlaeg.sql). Hentes ved ændringer og hvert minut.
let forslagSammen = [], forslagTimer = null;
function hentForslagSammen(straks = false) {
  clearTimeout(forslagTimer);
  forslagTimer = setTimeout(async () => {
    try { forslagSammen = await store.sammenForslag(); tegnHaendelser(); } catch { /* ikke kørt endnu */ }
  }, straks ? 0 : 4000);
}
function sammenForslagHtml(h) {
  const f = forslagSammen.find(x => x.b === h.id && H(x.a) && aktiv(H(x.a)));
  if (!f) return '';
  const a = H(f.a);
  return `<div class="samme-forslag">
    <p>🔗 <b>Måske samme hændelse som</b> «${esc(a.titel)}»${f.km != null ? ` · ${String(f.km).replace('.', ',')} km` : ''} · ${f.minutter} min før
      <br><small>${(f.grunde || []).map(esc).join(' · ')}</small></p>
    <div class="knap-række"><button data-slaa="${f.a}" data-fjern="${h.id}">Læg sammen</button>
      <button class="secondary" data-ikke="${h.id}" data-ikke-med="${f.a}">Ikke samme</button></div>
  </div>`;
}
// Manuel sammenlægning: vælg en anden aktiv hændelse, der lægges ind i denne
function åbnSammenlæg(id) {
  const h = H(id); if (!h) return;
  let dlg = $('#dlg-samml');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'dlg-samml'; dlg.className = 'ark';
    dlg.innerHTML = '<div class="ark-indhold"></div>'; document.body.append(dlg);
    dlg.addEventListener('click', async e => {
      if (e.target === dlg || e.target.closest('[data-luk-samml]')) return dlg.close();
      const b = e.target.closest('[data-ind]'); if (!b) return;
      const behold = dlg.dataset.behold, fjern = b.dataset.ind;
      if (!confirm(`Læg «${H(fjern)?.titel}» ind i «${H(behold)?.titel}»?`)) return;
      dlg.close();
      await prøv(() => store.slaaSammen(behold, fjern), 'Hændelserne er lagt sammen.');
      hentForslagSammen(true);
    });
  }
  dlg.dataset.behold = id;
  const andre = S().haendelser.filter(x => x.id !== id && aktiv(x))
    .map(x => ({ x, d: h.lat != null && x.lat != null ? km(h, x) : null, f: forslagSammen.find(f => (f.a === id && f.b === x.id) || (f.b === id && f.a === x.id)) }))
    .sort((p, q) => (q.f?.point || 0) - (p.f?.point || 0) || (p.d ?? 999) - (q.d ?? 999));
  dlg.querySelector('.ark-indhold').innerHTML = `
    <div class="ark-top"><h2>🔗 Læg sammen med «${esc(h.titel)}»</h2><button class="luk" data-luk-samml aria-label="Luk">✕</button></div>
    <p class="hint">Vælg den hændelse, der er den samme. Den lægges ind i denne (tekst, nyheder, placering og fotograf flyttes med), og Fotovagt husker det til næste gang.</p>
    <div class="samml-liste">${andre.length ? andre.map(({ x, d, f }) => `
      <div class="samml-række">${ikonFor(x)} <div><b>${esc(x.titel)}</b><br><small>${esc(x.adresse || '')} · kl. ${klokken(x.oprettet)}${d != null ? ` · ${kmTekst(d)}` : ''}${f ? ` · <b>forslag (${f.point} point)</b>` : ''}</small></div>
        <button class="lille-knap" data-ind="${x.id}">Læg ind her</button></div>`).join('') : '<p class="tom">Ingen andre aktive hændelser.</p>'}</div>`;
  dlg.showModal();
}

function haendelseKort(h) {
  const taget = h.taget_af ? P(h.taget_af) : null;
  return `
    <article class="h-kort h-${h.status} prio-${prioAf(h)}${valgtId === h.id ? ' valgt' : ''}${nyeKommentarer(h) ? ' har-ny-kommentar' : ''}${forslag(h) ? ' eskalering' : ''}${h.status === 'ny' && h.tilbud_status === 'ingen_svar' ? ' blink' : ''}" data-id="${h.id}">
      <span class="kat">${ikonFor(h)}</span>
      <div class="h-tekst">
        <div class="h-linje"><h3>${esc(h.titel)}</h3><span class="pille h-${h.status}">${H_STATUS[h.status]}</span></div>
        <p class="adresse">${esc(h.adresse || '')}${h.lat == null ? ' <span class="advarsel">⚠ mangler placering</span>' : h.cirka ? ' <span class="advarsel">(cirka – ret placering)</span>' : ''}</p>
        <p class="lille">kl. ${klokken(h.oprettet)} · ${siden(h.oprettet)} siden · ${esc(h.kilde)}${h.app ? ` (${esc(h.app)})` : ''}${O(h.omraade_id) ? ` · <span class="omr-mærke" style="--c:${esc(O(h.omraade_id).farve)}">${esc(O(h.omraade_id).navn)}</span>` : ''}</p>
        ${aktiv(h) ? (valgtId === h.id ? sikkerhedHtml(h) : vejrRisikoLinje(h)) : ''}
        ${aktiv(h) ? sammenForslagHtml(h) : ''}
        ${taget ? `<p class="lille taget-linje">👤 ${esc(taget.navn)}${h.taget_tid ? ` · taget kl. ${klokken(h.taget_tid)}` : ''}${h.ankommet_tid ? ` · ankommet kl. ${klokken(h.ankommet_tid)}` : ''}</p>` : ''}
        ${aktiv(h) ? (() => {
          const nær = iNærheden(h, S().haendelser);
          return `<div class="prio-række">
            <select class="prio-vælg p${prioAf(h)}" data-prio="${h.id}" aria-label="Prioritet for ${esc(h.titel)}">
              ${[1, 2, 3].map(p => `<option value="${p}"${prioAf(h) === p ? ' selected' : ''}>Prioritet: ${PRIO[p].navn}</option>`).join('')}
            </select>
            ${nær.length ? `<span class="nær" title="${esc(nær.map(x => x.titel).join(', '))}">📍 ${nær.length} andre inden for 10 km</span>` : ''}
          </div>`;
        })() : ''}
        ${h.antal_enheder || h.antal_ass ? `<p class="lille enheder-linje">🚒 ${h.antal_ass || 0} assistance${h.antal_ass === 1 ? '' : 'r'} · ${h.antal_enheder || 0} enheder${h.eskaleret ? ' · <b class="stor-mærke">⬆️ Stor hændelse</b>' : ''}</p>` : (h.eskaleret ? '<p class="lille"><b class="stor-mærke">⬆️ Stor hændelse</b></p>' : '')}
        ${forslag(h) ? `<div class="eskalering-boks"><p>⚠️ <b>Stor hændelse?</b> ${esc(h.eskalering_grund || `${h.antal_ass} assistancer · ${h.antal_enheder} enheder`)}. Skal den opgraderes på fotografernes skærm? <small>(giver også høj prioritet)</small></p>
          <div class="knap-række"><button data-eskaler="${h.id}" data-ja="1">⬆️ Opgradér for fotograferne</button><button class="secondary" data-eskaler="${h.id}" data-ja="0">Afvis</button></div></div>` : ''}
        ${valgtId === h.id ? indsigtHtml(h, indsigt(h, () => tegnHaendelser()), { kontor: true }) : ''}
        ${tilbudLinjer(h)}
        ${(n => n ? `<p class="opdatering"><span>${n.ikon} ${esc(n.tekst)}</span></p>` : '')(senesteNyt(h))}
        ${nyhederHtml(h)}
        <p class="lille doegn-linje">${h.offentlig === false ? '🚫 Ikke på døgnrapporten' : `🌐 Døgnrapport: <b>${esc(h.offentlig_titel || (h.kategori === 'Andet' || !h.kategori ? 'Hændelse' : h.kategori))}</b>${offentligSted(h) ? ` · ${esc(offentligSted(h))}` : ''}`}</p>
        ${h.note ? `<p class="lille note">Note: ${esc(h.note)}</p>` : ''}
        ${h.auto_lukket && !aktiv(h) ? `<p class="lille auto-lukket">⏱ Lukket automatisk kl. ${klokken(h.afsluttet_tid)} – ingen opdateringer i ${String((S().indst?.luk_efter_min || 90) / 60).replace('.', ',')} time. Tryk <b>Genåbn</b> for at åbne den igen.</p>` : ''}
        <div class="h-knapper">
          ${aktiv(h) ? `<button data-tildel="${h.id}">${h.taget_af ? 'Skift fotograf' : 'Tildel'}</button>
            <button class="secondary" data-luk="${h.id}" data-s="afsluttet">Afslut</button>
            <button class="secondary" data-luk="${h.id}" data-s="annulleret">Annullér</button>`
            : `<button class="secondary" data-luk="${h.id}" data-s="ny">Genåbn</button>`}
          <button class="secondary" data-ret="${h.id}">Ret</button>
          ${aktiv(h) ? `<button class="secondary" data-saml="${h.id}" title="Læg en anden hændelse sammen med denne">🔗 Læg sammen</button>` : ''}
          ${(n => n ? `<button class="ny-kommentar-knap" data-kommentarer="${h.id}">💬 ${n} ny${n > 1 ? 'e' : ''}</button>`
            : `<button class="secondary" data-kommentarer="${h.id}">💬${kommentarerTil(h.id).length ? ` ${kommentarerTil(h.id).length}` : ' Kommentér'}</button>`)(nyeKommentarer(h))}
        </div>
      </div>
    </article>`;
}

function tegnHaendelser() {
  const liste = S().haendelser.filter(h => filter === 'alle' || aktiv(h))
    .sort((a, b) => aktiv(a) && aktiv(b) ? efterPrio(a, b) : b.oprettet.localeCompare(a.oprettet));
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
// Ulæste kommentarer: kommentarer fra andre, som kontoret ikke har set endnu
const LÆST = 'fotovagt-kommentarer-set';
const læst = (() => { try { return JSON.parse(localStorage.getItem(LÆST)) || {}; } catch { return {}; } })();
const nyeKommentarer = h => kommentarerTil(h.id).filter(k => k.bruger !== mig?.id && k.oprettet > (læst[h.id] || '')).length;
function markérLæst(id) {
  const ks = kommentarerTil(id); if (!ks.length) return;
  læst[id] = ks[ks.length - 1].oprettet;
  try { localStorage.setItem(LÆST, JSON.stringify(læst)); } catch { /* ok */ }
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
  tidslinjeId = id; markérLæst(id); tegnHaendelser();
  const dlg = $('#dlg-tidslinje');
  if (!dlg.open) dlg.showModal();
  tegnTidslinje();
  setTimeout(() => dlg.querySelector('form.kommentar-form textarea')?.focus(), 60);
}

// ---------------------------------------------------------------------------------
// Ny bruger: kontoret opretter adgangen. Fotovagt sender en mail med et link til vagt.hrc-fotos.dk,
// hvor den nye vælger sin adgangskode. Kan mailen ikke sendes, får kontoret et link til sms.
async function åbnInvitationer() {
  let dlg = $('#dlg-inviter');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'dlg-inviter'; dlg.className = 'ark';
    dlg.innerHTML = `
      <div class="ark-indhold">
        <div class="ark-top"><h2>👥 Ny bruger</h2><button class="luk" data-luk-inv aria-label="Luk">✕</button></div>
        <p class="hint">Udfyld og tryk <b>Opret og send</b>. Den nye får en mail med et link til <b>vagt.hrc-fotos.dk</b>, vælger sin adgangskode
          og er med det samme med på kortet, i tilbud og i rapporterne. Kun e-mails på listen kan oprette en bruger.</p>
        <form id="form-inviter" class="inviter-form">
          <label>Navn <input name="navn" required autocomplete="off"></label>
          <label>E-mail <input name="email" type="email" required autocomplete="off"></label>
          <label>Telefon <input name="telefon" type="tel" autocomplete="off"></label>
          <label>Rolle <select name="rolle"><option value="foto">Fotograf</option><option value="kontor">Kontor</option></select></label>
          <label>Region <select name="omraade_id"></select></label>
          <button type="submit">Opret og send</button>
        </form>
        <div class="kopi-boks" id="inv-kopi" hidden></div>
        <h3 class="inv-titel">Brugere og invitationer</h3>
        <div id="inv-liste" class="inv-liste"><p class="hint">Henter …</p></div>
      </div>`;
    document.body.append(dlg);
    dlg.addEventListener('click', async e => {
      if (e.target === dlg || e.target.closest('[data-luk-inv]')) return dlg.close();
      const s = e.target.closest('[data-slet-inv]');
      if (s && confirm(`Fjern invitationen til ${s.dataset.sletInv}? (En bruger, der allerede er oprettet, beholder sin adgang – den fjernes under Fotografer.)`)) {
        await prøv(() => store.sletInvitation(s.dataset.sletInv), 'Invitationen er fjernet.'); visListe();
      }
      const ig = e.target.closest('[data-igen]');
      if (ig) {
        ig.disabled = true;
        const inv = (await store.hentInvitationer()).find(i => i.email === ig.dataset.igen);
        try { visSvar(inv, await store.inviter(inv, { igen: true })); } catch (err) { toast(store.fejlTekst(err), 'fejl'); }
        ig.disabled = false;
      }
      const c = e.target.closest('[data-kopi]');
      if (c) { try { await navigator.clipboard.writeText(c.dataset.kopi); toast('Kopieret.', 'ok'); } catch { toast('Kunne ikke kopiere – markér teksten og kopiér selv.', 'fejl'); } }
    });
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, knap = f.querySelector('button[type=submit]');
      const data = { navn: f.navn.value.trim(), email: f.email.value.trim().toLowerCase(), telefon: f.telefon.value.trim(), rolle: f.rolle.value, omraade_id: f.omraade_id.value || null };
      knap.disabled = true; knap.textContent = 'Sender …';
      try { visSvar(data, await store.inviter(data)); f.reset(); visListe(); }
      catch (err) { toast(store.fejlTekst(err), 'fejl'); }
      finally { knap.disabled = false; knap.textContent = 'Opret og send'; }
    });
  }
  // Svar fra serveren: mail sendt – eller et link, kontoret selv sender
  function visSvar(data, svar) {
    const boks = $('#inv-kopi'); boks.hidden = false;
    if (svar.mail) {
      boks.innerHTML = `<p>✅ <b>${esc(data.navn || data.email)}</b> er oprettet. Der er sendt en mail til ${esc(data.email)} med et link til Fotovagt.</p>
        <p class="lille">Kan de ikke finde mailen, så bed dem kigge i spam – eller tryk "Send igen" på listen.</p>`;
      toast('Mailen er sendt.', 'ok');
      return;
    }
    const tekst = svar.link
      ? `Hej ${data.navn || ''}. Du har fået adgang til Fotovagt. Tryk på linket og vælg din adgangskode: ${svar.link}`
      : `Hej ${data.navn || ''}. Du har fået adgang til Fotovagt. Åbn https://vagt.hrc-fotos.dk, tryk "Ny bruger? Opret din adgangskode" og brug denne e-mail: ${data.email}`;
    boks.innerHTML = `<p>⚠️ <b>${esc(data.navn || data.email)}</b> er oprettet, men mailen kunne ikke sendes${svar.fejl ? ` (${esc(svar.fejl)})` : ''}.
      Send i stedet denne besked på sms eller mail${svar.link ? ' – linket virker én gang og udløber efter et døgn' : ''}:</p>
      <p class="kopi-tekst">${esc(tekst)}</p><button type="button" class="secondary" data-kopi="${esc(tekst)}">📋 Kopiér beskeden</button>`;
  }
  async function visListe() {
    try {
      const liste = await store.hentInvitationer();
      $('#inv-liste').innerHTML = liste.length ? liste.map(i => `
        <div class="inv-række">
          <div><b>${esc(i.navn || i.email)}</b> <small>${i.rolle === 'kontor' ? 'Kontor' : 'Fotograf'}${O(i.omraade_id) ? ` · ${esc(O(i.omraade_id).navn)}` : ''}</small><br><small>${esc(i.email)}${i.telefon ? ` · ${esc(i.telefon)}` : ''}</small></div>
          <span class="pille ${i.brugt ? 'p-afsluttet' : 'p-ny'}">${i.brugt ? 'Oprettet' : 'Venter'}</span>
          ${i.brugt ? '<span></span>' : `<span class="inv-knapper"><button class="link" data-igen="${esc(i.email)}">Send igen</button><button class="link fare" data-slet-inv="${esc(i.email)}">Fjern</button></span>`}
        </div>`).join('') : '<p class="hint">Ingen invitationer endnu.</p>';
    } catch (e) { $('#inv-liste').innerHTML = `<p class="fejl-tekst">${esc(store.fejlTekst(e))}</p>`; }
  }
  dlg.querySelector('[name=omraade_id]').innerHTML = områdeValg(null);
  $('#inv-kopi').hidden = true;
  dlg.showModal();
  visListe();
}

// ---------------------------------------------------------------------------------
// Stedviden: hvad Fotovagt har lært (adresser, vejnavne, stationer). Kontoret kan søge, se på kortet og glemme forkerte.
const KILDE = { kontor: ['✋ Kontoret', 'k-kontor'], geokod: ['🔎 Opslag', 'k-geokod'], nyhed: ['📰 Nyhed', 'k-nyhed'], osm: ['🗺 Kortdata', 'k-osm'] };
const SV_TYPE = { adresse: '📍 Adresser', vej: '🛣 Vejnavne', station: '🚒 Stationer' };
let svData = [], svType = 'alle', svSøg = '';
// ---------------------------------------------------------------------------------
// Nyheds-dashboard: 112-nyheder fra medierne (databasen henter dem hvert 5. minut og kobler dem selv til
// hændelser, når by/vej/slags passer). Kontoret kan koble og fjerne i hånden.
let nyhedsFilter = 'alle', nyhedsSøg = '';
const nyhedsKat = { Brand: '🔥', Trafik: '🚗', Politi: '🚓', Redning: '🛟', Vejr: '🌧️', Miljø: '☣️', Andet: '📰' };
// Forslag til manuel kobling: hændelser fra de seneste 12 timer med samme by/kategori først
function nyhedsKandidater(a) {
  const t = `${a.titel} ${a.resume || ''}`.toLowerCase();
  const byAf = h => ((String(h.adresse || '').match(/\d{4}\s+([^,]+)$/) || [])[1] || (/\d/.test(h.adresse || '') ? '' : String(h.adresse || '').split(',').pop())).replace(/\s+[A-ZÆØÅ]{1,2}$/, '');
  return S().haendelser.filter(h => h.status !== 'annulleret' && Date.now() - new Date(h.oprettet) < 12 * 3600e3)
    .map(h => {
      const by = byAf(h).trim().toLowerCase();
      const p = (by.length >= 4 && t.includes(by) ? 3 : 0) + (h.kategori === a.kategori ? 2 : 0) + (aktiv(h) ? 1 : 0);
      return { h, p };
    }).sort((x, y) => y.p - x.p || String(y.h.oprettet).localeCompare(String(x.h.oprettet)));
}
function tegnNyheder() {
  const dlg = $('#dlg-nyheder'); if (!dlg?.open) return;
  const alle = S().nyheder || [];
  const søg = nyhedsSøg.trim().toLowerCase();
  const vis = alle.filter(a => (nyhedsFilter === 'alle' || (nyhedsFilter === 'koblet' ? a.haendelse_id : !a.haendelse_id))
    && (!søg || `${a.titel} ${a.resume || ''} ${a.kilde}`.toLowerCase().includes(søg)));
  const iDag = alle.filter(a => Date.now() - new Date(a.udgivet) < 24 * 3600e3);
  const pr = {}; for (const a of iDag) pr[a.kategori || 'Andet'] = (pr[a.kategori || 'Andet'] || 0) + 1;
  dlg.querySelector('.nyh-oversigt').innerHTML = `<b>Seneste døgn:</b> ${iDag.length} nyheder om 112-området`
    + (Object.keys(pr).length ? ` – ${Object.entries(pr).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${nyhedsKat[k] || '📰'} ${n} ${esc(k.toLowerCase())}`).join(' · ')}` : '')
    + ` · ${iDag.filter(a => a.haendelse_id).length} koblet til hændelser`;
  dlg.querySelector('.nyh-liste').innerHTML = vis.length ? vis.map(a => {
    const h = a.haendelse_id ? H(a.haendelse_id) : null;
    return `<article class="nyh" data-artikel="${a.id}">
      <div class="nyh-ikon">${nyhedsKat[a.kategori] || '📰'}</div>
      <div class="nyh-tekst">
        <p class="nyh-meta">${esc(a.kilde || '')} · kl. ${klokken(a.udgivet)} · ${siden(a.udgivet)} siden</p>
        <h3><a href="${esc(sikkerUrlK(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.titel)}</a></h3>
        ${a.resume ? `<p class="nyh-resume">${esc(a.resume)}</p>` : ''}
        ${h ? `<p class="nyh-koblet">🔗 ${a.koblet === 'auto' ? 'Koblet automatisk' : 'Koblet'} til <button class="link" data-zoom="${h.id}">${ikonFor(h)} ${esc(h.titel)}</button> <button class="link" data-afkobl="${a.id}">Fjern</button></p>`
          : `<div class="nyh-kobl"><select data-kobl="${a.id}" aria-label="Kobl nyheden til en hændelse"><option value="">Kobl til hændelse …</option>
              ${nyhedsKandidater(a).slice(0, 25).map(({ h: x, p }) => `<option value="${x.id}">${p >= 4 ? '★ ' : ''}${esc(x.titel.slice(0, 60))} – ${esc((x.adresse || '').slice(0, 30))} (kl. ${klokken(x.oprettet)})</option>`).join('')}
            </select></div>`}
      </div>
    </article>`;
  }).join('') : '<p class="tom">Ingen nyheder i det valgte filter.</p>';
}
const sikkerUrlK = u => /^https?:\/\//i.test(String(u || '')) ? u : '#';
async function åbnNyheder() {
  let dlg = $('#dlg-nyheder');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'dlg-nyheder'; dlg.className = 'ark bred';
    dlg.innerHTML = `<div class="ark-indhold">
      <div class="ark-top"><h2>📰 Nyheder fra 112-området</h2><button class="luk" data-luk-nyh aria-label="Luk">✕</button></div>
      <p class="hint">DR, TV 2-regionerne og Ritzau hentes hvert 5. minut. Fotovagt frasorterer det, der ikke handler om brand, ulykker, politi og redning, og kobler selv nyheden til den hændelse, den handler om, når by, vej og slags passer. Du kan også koble og fjerne i hånden – nyheden vises så på hændelsen og i døgnrapporten.</p>
      <p class="nyh-oversigt"></p>
      <div class="nyh-værktøj">
        <div class="filter" role="tablist">
          <button data-nyh-filter="alle" aria-selected="true">Alle</button>
          <button data-nyh-filter="ikke" aria-selected="false">Ikke koblet</button>
          <button data-nyh-filter="koblet" aria-selected="false">Koblet</button>
        </div>
        <input type="search" class="nyh-søg" placeholder="Søg i nyhederne" aria-label="Søg i nyhederne">
      </div>
      <div class="nyh-liste"></div></div>`;
    document.body.append(dlg);
    dlg.addEventListener('click', async e => {
      if (e.target === dlg || e.target.closest('[data-luk-nyh]')) return dlg.close();
      const f = e.target.closest('[data-nyh-filter]');
      if (f) { nyhedsFilter = f.dataset.nyhFilter; dlg.querySelectorAll('[data-nyh-filter]').forEach(b => b.setAttribute('aria-selected', String(b === f))); return tegnNyheder(); }
      const af = e.target.closest('[data-afkobl]');
      if (af) return prøv(() => store.koblNyhed(+af.dataset.afkobl, null), 'Koblingen er fjernet.');
      const z = e.target.closest('[data-zoom]');
      if (z) { dlg.close(); return vælg(z.dataset.zoom); }
    });
    dlg.addEventListener('change', e => {
      const s = e.target.closest('select[data-kobl]'); if (!s || !s.value) return;
      prøv(() => store.koblNyhed(+s.dataset.kobl, s.value), 'Nyheden er koblet til hændelsen.');
    });
    dlg.querySelector('.nyh-søg').addEventListener('input', e => { nyhedsSøg = e.target.value; tegnNyheder(); });
  }
  dlg.showModal();
  dlg.querySelector('.nyh-liste').innerHTML = '<p class="tom">Henter nyheder …</p>';
  try { await store.hentNyheder(); } catch (e) { dlg.querySelector('.nyh-liste').innerHTML = `<p class="tom">Kunne ikke hente nyheder: ${esc(store.fejlTekst(e))}</p>`; return; }
  tegnNyheder();
}
// Antal nye (ikke koblede) nyheder den seneste time på knappen
function tegnNyhedsAntal() {
  const el = $('#nyheder-antal'); if (!el) return;
  const n = (S().nyheder || []).filter(a => !a.haendelse_id && Date.now() - new Date(a.udgivet) < 3600e3).length;
  el.hidden = !n; el.textContent = n;
}

async function åbnStedviden() {
  let dlg = $('#dlg-stedviden');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'dlg-stedviden'; dlg.className = 'ark bred';
    dlg.innerHTML = `
      <div class="ark-indhold">
        <div class="ark-top"><h2>🧠 Stedviden</h2><button class="luk" data-luk-sv aria-label="Luk">✕</button></div>
        <p class="hint">Det Fotovagt har lært om steder. Nye beskeder slås først op her og først derefter hos OpenStreetMap.
          <b>Kontorets rettelser vinder altid:</b> flyt nålen eller ret adressen under "Ret" på en hændelse, så huskes det.
          Er noget lært forkert, så tryk <b>Glem</b>.</p>
        <div class="sv-tal" id="sv-tal"></div>
        <div class="sv-filtre">
          <div class="sv-faner" role="tablist" id="sv-faner">
            <button data-svt="alle" aria-selected="true">Alle</button>${Object.entries(SV_TYPE).map(([t, n]) => `<button data-svt="${t}" aria-selected="false">${n}</button>`).join('')}
          </div>
          <input type="search" id="sv-søg" placeholder="Søg (fx Uglehøjen, Odense)" autocomplete="off">
        </div>
        <div id="sv-liste" class="sv-liste"><p class="hint">Henter …</p></div>
      </div>`;
    document.body.append(dlg);
    dlg.addEventListener('click', async e => {
      if (e.target === dlg || e.target.closest('[data-luk-sv]')) return dlg.close();
      const t = e.target.closest('[data-svt]');
      if (t) { svType = t.dataset.svt; dlg.querySelectorAll('[data-svt]').forEach(b => b.setAttribute('aria-selected', String(b === t))); return vis(); }
      const k = e.target.closest('[data-sv-kort]');
      if (k) { const x = svData.find(v => v.noegle === k.dataset.svKort); dlg.close(); kort.setView([x.lat, x.lon], 15); L.popup().setLatLng([x.lat, x.lon]).setContent(`<b>${esc(x.navn)}</b>${x.by ? `<br>${esc(x.by)}` : ''}<br><small>${KILDE[x.kilde]?.[0] || esc(x.kilde)} · set ${x.antal} gang${x.antal === 1 ? '' : 'e'}</small>`).openOn(kort); return; }
      const g = e.target.closest('[data-sv-glem]');
      if (g) {
        const x = svData.find(v => v.noegle === g.dataset.svGlem);
        if (!confirm(`Glem "${x.navn}"? Næste gang slås stedet op igen hos OpenStreetMap.`)) return;
        if (await prøv(() => store.glemSted(x.noegle), 'Glemt.')) { svData = svData.filter(v => v !== x); vis(); }
      }
    });
    $('#sv-søg').addEventListener('input', e => { svSøg = e.target.value.trim().toLowerCase(); vis(); });
  }
  function vis() {
    const tæl = t => svData.filter(v => v.type === t).length;
    $('#sv-tal').innerHTML = `<span><b>${tæl('adresse')}</b> adresser</span><span><b>${tæl('vej')}</b> vejnavne</span><span><b>${tæl('station')}</b> stationer</span><span><b>${svData.filter(v => v.kilde === 'kontor').length}</b> rettet af kontoret</span>`;
    const liste = svData.filter(v => (svType === 'alle' || v.type === svType)
      && (!svSøg || `${v.navn} ${v.by || ''}`.toLowerCase().includes(svSøg)));
    $('#sv-liste').innerHTML = liste.length ? liste.slice(0, 300).map(v => `
      <div class="sv-række">
        <span class="sv-type" title="${esc(v.type)}">${SV_TYPE[v.type]?.split(' ')[0] || ''}</span>
        <div class="sv-navn"><b>${esc(v.navn)}</b>${v.by ? ` <small>${esc(v.by)}</small>` : ''}<br>
          <small><span class="sv-kilde ${KILDE[v.kilde]?.[1] || ''}">${KILDE[v.kilde]?.[0] || esc(v.kilde)}</span> · set ${v.antal} gang${v.antal === 1 ? '' : 'e'} · ${siden(v.opdateret)} siden</small></div>
        ${v.lat != null ? `<button class="ikon-knap" data-sv-kort="${esc(v.noegle)}" title="Vis på kortet">📍</button>` : '<span></span>'}
        <button class="link fare" data-sv-glem="${esc(v.noegle)}">Glem</button>
      </div>`).join('') + (liste.length > 300 ? `<p class="hint">Viser 300 af ${liste.length} – søg for at finde resten.</p>` : '')
      : '<p class="hint">Intet fundet.</p>';
  }
  dlg.showModal();
  try { svData = await store.hentStedviden(); } catch (e) { $('#sv-liste').innerHTML = `<p class="fejl-tekst">${esc(store.fejlTekst(e))}</p>`; return; }
  vis();
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
          ${avatar(p, 34)}
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
function områdeValg(valgt) {
  return `<option value="">– Intet område –</option>` + (S().omraader || [])
    .map(o => `<option value="${o.id}"${o.id === valgt ? ' selected' : ''}>${esc(o.navn)}</option>`).join('');
}
function åbnFoto(id) {
  const p = P(id), f = $('#form-foto'), dlg = $('#dlg-foto');
  f.navn.value = p.navn; f.telefon.value = p.telefon || ''; f.status.value = p.status; f.rolle.value = p.rolle;
  fotoFelt($('#foto-foto'), p);
  f.omraade_id.innerHTML = områdeValg(p.omraade_id);
  f.base_adresse.value = p.base_adresse || ''; f.base_lat.value = p.base_lat ?? ''; f.base_lon.value = p.base_lon ?? '';
  const hint = () => { const el = $('#base-hint'); el.classList.toggle('ok-tekst', !!f.base_lat.value); el.textContent = f.base_lat.value
    ? `✓ Rigtig adresse fundet${f.base_adresse.value ? `: ${f.base_adresse.value}` : ''}. Tilbud bruger udgangspunktet, når fotografens egen position er gammel eller mangler.`
    : 'Skriv vej, husnummer og by, og vælg adressen på listen. Kun rigtige adresser kan gemmes.'; };
  hint();
  // Kun en valgt adresse fra listen (eller et eksakt opslag) giver koordinater – ellers gemmes ingen position
  const brug = a => { f.base_adresse.value = a.tekst; f.base_lat.value = a.lat; f.base_lon.value = a.lon; hint(); sætRegion(); };
  f.base_adresse.oninput = () => { f.base_lat.value = ''; f.base_lon.value = ''; hint(); };
  adresseFelt(f.base_adresse, brug);
  const slåOp = async () => {
    const a = f.base_adresse.value.trim(); if (!a) return null;
    const l = await adresseForslag(a).catch(() => []);
    return l[0] || null;
  };
  $('#btn-find-base').onclick = async () => {
    if (!f.base_adresse.value.trim()) return toast('Skriv en adresse først.', 'fejl');
    const knap = $('#btn-find-base'); knap.disabled = true; knap.textContent = '…';
    const a = await slåOp();
    knap.disabled = false; knap.textContent = 'Find';
    if (!a) return toast('Ingen rigtig adresse fundet. Skriv vej, husnummer og postnummer/by.', 'fejl');
    brug(a); toast(`Adressen er fundet: ${a.tekst}`);
  };
  // Regionen følger udgangspunktets postnummer (kan stadig vælges om)
  function sætRegion() {
    const navn = regionFraPostnr(f.base_adresse.value), o = (S().omraader || []).find(x => x.navn === navn);
    if (o && f.omraade_id.value !== o.id) { f.omraade_id.value = o.id; toast(`Region sat til ${o.navn} ud fra adressen.`); }
  }
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'gem') return;
    if (f.status.value !== p.status) await prøv(() => store.saetStatus(id, f.status.value));
    let adr = f.base_adresse.value.trim();
    if (adr && !f.base_lat.value) {           // ikke valgt på listen: slå op, og gem kun hvis det er en rigtig adresse
      const a = await slåOp();
      if (a) { f.base_adresse.value = a.tekst; f.base_lat.value = a.lat; f.base_lon.value = a.lon; sætRegion(); }
      else { toast('Udgangspunktet er ikke gemt: adressen findes ikke. Ret den og prøv igen.', 'fejl'); }
    }
    await prøv(() => store.retFotograf(id, {
      navn: f.navn.value.trim(), telefon: f.telefon.value.trim() || null, rolle: f.rolle.value,
      omraade_id: f.omraade_id.value || null,
      // Rigtig adresse: gem den. Ugyldig: behold det gamle udgangspunkt. Tomt felt: fjern udgangspunktet.
      ...((adr = f.base_adresse.value.trim()) && f.base_lat.value ? { base_adresse: adr, base_lat: +f.base_lat.value, base_lon: +f.base_lon.value }
        : adr ? { base_adresse: p.base_adresse || null, base_lat: p.base_lat ?? null, base_lon: p.base_lon ?? null }
        : { base_adresse: null, base_lat: null, base_lon: null }),
    }), 'Gemt.');
  };
  dlg.showModal();
}

// ---------------------------------------------------------------------------------
// Områder = Danmarks 5 regioner (faste). Kontoret kan ændre farven og se, hvem der hører til hvor.
function åbnOmraader() {
  let dlg = $('#dlg-omraader');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'dlg-omraader'; dlg.className = 'ark';
    dlg.innerHTML = `
      <div class="ark-indhold">
        <div class="ark-top"><h2>🗺 Regioner</h2><button class="luk" data-luk-omr aria-label="Luk">✕</button></div>
        <p class="hint">Områderne er Danmarks fem regioner. En hændelse får sin region ud fra adressen (postnummer, bekræftet af kortopslaget).
          <b>Tættest på trumfer område:</b> tilbuddet går altid først til den nærmeste ledige fotograf; er to omtrent lige tæt på, vælges fotografen fra hændelsens region.
          Fotografens region skiftes løbende – her med ✎ på fotografen, eller af fotografen selv under "Min profil" i Marken.</p>
        <div class="omr-liste" id="omr-liste"></div>
      </div>`;
    document.body.append(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-luk-omr]')) dlg.close(); });
    dlg.addEventListener('change', async e => {
      const r = e.target.closest('[data-omr]'); if (!r) return;
      const o = O(r.dataset.omr);
      await prøv(() => store.gemOmraade({ id: o.id, navn: o.navn, farve: r.querySelector('[name=f]').value }), 'Farven er gemt.');
      vis();
    });
  }
  function vis() {
    $('#omr-liste').innerHTML = (S().omraader || []).map(o => {
      const fot = S().profiler.filter(p => p.rolle === 'foto' && p.omraade_id === o.id);
      const akt = S().haendelser.filter(h => aktiv(h) && h.omraade_id === o.id).length;
      return `<div class="omr-række" data-omr="${o.id}">
        <input type="color" name="f" value="${esc(o.farve)}" aria-label="Farve for ${esc(o.navn)}">
        <div><b>Region ${esc(o.navn)}</b><small class="base-lille">${fot.length ? fot.map(p => esc(p.navn)).join(', ') : 'Ingen fotografer endnu'}</small></div>
        <span class="pille" title="Fotografer">👤 ${fot.length}</span>
        <span class="pille" title="Aktive hændelser">${akt} aktive</span>
      </div>`;
    }).join('') || '<p class="hint">Regionerne er ikke oprettet endnu – kør supabase/regioner.sql.</p>';
  }
  vis();
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
  $('#po-tekst').textContent = poStatus.forbundet ? (poStatus.fejl ? 'fejl' : 'forbundet') : 'ikke forbundet';
  sætPrik('po', poStatus.forbundet ? (poStatus.fejl ? 'gul' : 'grøn') : 'grå');
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
      <p class="hint">Radioprøver og testalarmer springes altid over.</p>
      <button type="submit" class="secondary">Gem</button>
    </form>
    <hr>
    <h3>Sprunget over (seneste døgn)</h3>
    <p class="hint">Beskeder, der ikke blev til hændelser, og hvorfor. Står der noget her, der burde have været med, så ret listen ovenfor.</p>
    <div id="po-ignorerede" class="po-ignorerede"><p class="hint">Henter …</p></div>
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
  store.hentIgnorerede().then(l => {
    $('#po-ignorerede').innerHTML = l.length ? `<ul>${l.map(i => `<li><span class="lille">kl. ${klokken(i.tid)} · ${esc(i.app || '')}</span><br>${esc(i.titel || '')} <small>– ${esc(i.grund || '')}</small></li>`).join('')}</ul>`
      : '<p class="hint">Ingen beskeder er sprunget over det seneste døgn.</p>';
  }).catch(() => { $('#po-ignorerede').innerHTML = ''; });
}

// ---------------------------------------------------------------------------------
async function start() {
  mig = await logInd({ kunKontor: true });
  $('#demo-mærke').hidden = !store.demo;
  kort = lavKort($('#kort'));
  stationsKontrol(kort);   // brand-, politi- og ambulancestationer + telefonliste
  hLag = markørLag(kort); fLag = markørLag(kort); sLag = markørLag(kort); helikopterLag(kort);

  store.lyt(s => {
    tegn(); tegnNyheder(); tegnNyhedsAntal();
    if (s.nyHaendelse) { bip(); toast(`Ny hændelse: ${s.nyHaendelse.titel}`, 'ny'); hentForslagSammen(); }
    // Nye forslag om opgradering: lyd og besked
    const nuForslag = s.haendelser.filter(forslag).map(h => h.id);
    const nyeF = nuForslag.filter(id => !kendteForslag.has(id));
    if (nyeF.length && kendteForslag.size >= 0 && forslagKlar) {
      bip(); setTimeout(bip, 600);
      const h = H(nyeF[0]);
      toast(`⚠️ Stor hændelse? ${h.titel} – ${h.eskalering_grund || `${h.antal_ass} assistancer, ${h.antal_enheder} enheder`}`, 'fejl');
    }
    kendteForslag = new Set(nuForslag);
    if (s.nyKommentar) {
      const k = s.nyKommentar, h = H(k.haendelse_id);
      bip();
      toast(`💬 ${navn(k.bruger)}${k.offentlig ? ' (🌐 døgnrapport)' : ''}${h ? ` på "${h.titel}"` : ''}: ${k.tekst.slice(0, 100)}`, 'ny');
      // Står tidslinjen åben på den hændelse, er kommentaren set
      if ($('#dlg-tidslinje').open && tidslinjeId === k.haendelse_id) markérLæst(k.haendelse_id);
      // Fanen er ikke fremme: vis en besked på computeren
      if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification(`💬 ${navn(k.bruger)}${k.offentlig ? ' · 🌐 døgnrapport' : ''}`, { body: `${h?.titel || ''}: ${k.tekst.slice(0, 120)}`, icon: 'icon-192.png', tag: 'k-' + k.id }); } catch { /* ok */ }
      }
      document.title = `💬 Ny kommentar – Fotovagt`;
      setTimeout(() => { if (!aktiveSos().length) document.title = 'Fotovagt – kontoret'; }, 15000);
      tegnHaendelser();
    }
    tegnTidslinje();
  });
  if (!Object.keys(læst).length) { for (const h of S().haendelser) markérLæst(h.id); }
  kendteForslag = new Set(S().haendelser.filter(forslag).map(h => h.id)); forslagKlar = true;
  tegn();
  hentPoStatus();

  // Prioritet: én vælger pr. kort
  document.body.addEventListener('change', e => {
    const v = e.target.closest('select[data-prio]'); if (!v || v.closest('dialog')) return;
    const p = +v.value, h = H(v.dataset.prio);
    if (!h || ![1, 2, 3].includes(p) || prioAf(h) === p) return;
    prøv(() => store.ret(h.id, { prio: p }), `Prioritet: ${PRIO[p].navn}.`);
  });
  // Klik overalt på siden (lister, kort-popups)
  document.body.addEventListener('click', e => {
    const sl = e.target.closest('[data-slaa],[data-ikke],[data-saml]');
    if (sl && !sl.closest('dialog')) {
      if (sl.dataset.saml) return åbnSammenlæg(sl.dataset.saml);
      if (sl.dataset.slaa) return prøv(() => store.slaaSammen(sl.dataset.slaa, sl.dataset.fjern), 'Hændelserne er lagt sammen.').then(() => hentForslagSammen(true));
      if (sl.dataset.ikke) { forslagSammen = forslagSammen.filter(f => !(f.b === sl.dataset.ikke && f.a === sl.dataset.ikkeMed)); tegnHaendelser();
        return prøv(() => store.ikkeSamme(sl.dataset.ikke, sl.dataset.ikkeMed), 'Forslaget er fjernet. Fotovagt husker det.'); }
    }
    const t = e.target.closest('[data-prio],[data-eskaler],[data-giv],[data-tildel],[data-luk],[data-ret],[data-kommentarer],[data-zoom],[data-find-foto],[data-ret-foto],[data-filter],.h-kort');
    if (!t || t.closest('dialog')) return;
    const d = t.dataset;
    if (d.prio) {
      if (t.tagName === 'SELECT') return;   // vælgeren håndteres af change herunder; klik må ikke vælge kortet
      const p = +d.p, h = H(d.prio);        // "Brug forslaget"-knappen i assistentens boks
      if (!h || ![1, 2, 3].includes(p) || prioAf(h) === p) return;
      return prøv(() => store.ret(d.prio, { prio: p }), `Prioritet: ${PRIO[p].navn}.`);
    }
    if (d.eskaler) {
      const ja = d.ja === '1';
      return prøv(() => store.eskaler(d.eskaler, ja), ja ? 'Opgraderet. Fotograferne får besked.' : 'Forslaget er afvist.');
    }
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
    $('#push-tekst').textContent = sub ? 'til' : 'fra';
    $('#btn-push').setAttribute('aria-checked', String(!!sub)); sætPrik('push', sub ? 'grøn' : 'grå');
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
  // Fra push om en kommentar: kontor.html?h=<id> åbner tidslinjen
  const hLink = new URLSearchParams(location.search).get('h');
  if (hLink) { history.replaceState(null, '', location.pathname + (store.demo ? '?demo' : '')); setTimeout(() => { if (H(hLink)) { vælg(hLink); åbnTidslinje(hLink); } }, 400); }
  const sosLink = new URLSearchParams(location.search).get('sos');
  if (sosLink) { history.replaceState(null, '', location.pathname + (store.demo ? '?demo' : '')); setTimeout(() => visSos(sosLink), 300); }
  navigator.serviceWorker?.addEventListener('message', e => {
    const q = e.data?.åbn && new URL(e.data.åbn, location.href).searchParams;
    if (q?.get('sos')) visSos(q.get('sos'));
    if (q?.get('h') && H(q.get('h'))) { vælg(q.get('h')); åbnTidslinje(q.get('h')); }
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
  $('#btn-stedviden').onclick = () => åbnStedviden();
  $('#btn-nyheder').onclick = () => åbnNyheder();
  $('#btn-nyheder-menu').onclick = () => åbnNyheder();
  store.hentNyheder().catch(() => {});
  $('#btn-inviter').onclick = () => åbnInvitationer();
  $('#btn-omraader').onclick = () => åbnOmraader();
  // Telefon: knapperne ligger i en menu, så toppen ikke fylder halvdelen af skærmen
  const menuKnap = $('#btn-menu'), menu = $('#top-menu');
  const lukMenu = () => { document.body.classList.remove('menu-åben'); menuKnap.setAttribute('aria-expanded', 'false'); };
  menuKnap.onclick = e => { e.stopPropagation(); const åben = document.body.classList.toggle('menu-åben'); menuKnap.setAttribute('aria-expanded', String(åben)); };
  menu.addEventListener('click', e => { if (e.target.closest('button')) setTimeout(lukMenu, 0); });
  document.addEventListener('click', e => { if (!e.target.closest('#top-menu, #btn-menu')) lukMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('menu-åben')) { lukMenu(); menuKnap.focus(); } });
  const dlgTl = $('#dlg-tidslinje');
  kommentarHandlinger(dlgTl);
  dlgTl.addEventListener('click', e => { if (e.target === dlgTl || e.target.closest('[data-luk-tl]')) dlgTl.close(); });
  for (const id of ['#dlg-ret', '#dlg-foto']) $(id).addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  setInterval(() => { if (!document.hidden) { tegnFotografer(); tegnHaendelser(); tegnNøgletal(); } }, 30e3);
  hentForslagSammen(true);
  setInterval(() => { if (!document.hidden) hentForslagSammen(true); }, 60e3);
  setInterval(hentPoStatus, 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') store.hentAlt().catch(() => {}); });
}

start();
