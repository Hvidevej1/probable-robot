// Døgnrapport: offentlig side med døgnets hændelser på kort. Kan vises alene eller indlejret på
// hrc-fotos.dk (<iframe src="https://vagt.hrc-fotos.dk/doegn.html?indlejret">). Data kommer fra
// databasefunktionen doegnrapport(), som kun giver kategori, by/område og offentlige kommentarer.
(() => {
  const cfg = window.FOTOVAGT_CONFIG || {};
  const q = new URLSearchParams(location.search);
  const indlejret = q.has('indlejret') || window.top !== window;
  if (indlejret) document.body.classList.add('indlejret');
  if (q.get('tema') === 'lys' || q.get('tema') === 'mørk') document.documentElement.dataset.theme = q.get('tema') === 'lys' ? 'light' : 'dark';

  const IKON = { Brand: '🔥', Trafik: '🚗', Politi: '🚓', Redning: '🛟', Miljø: '☣️', Vejr: '🌧️', Forsyning: '🔧', Andet: '📍' };
  const TZ = 'Europe/Copenhagen';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kl = iso => new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  const iDag = () => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date());   // ÅÅÅÅ-MM-DD
  const flyt = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const dagTekst = d => d === iDag() ? 'I dag' : d === flyt(iDag(), -1) ? 'I går'
    : new Date(d + 'T12:00:00Z').toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const $ = s => document.querySelector(s);

  let dag = /^\d{4}-\d{2}-\d{2}$/.test(q.get('dag') || '') ? q.get('dag') : iDag();
  let data = { haendelser: [] }, valgt = null;

  const kort = L.map('kort', { scrollWheelZoom: !indlejret, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(kort);
  kort.fitBounds([[54.56, 8.07], [57.75, 12.69]]);
  const lag = L.layerGroup().addTo(kort);
  // Kortet kan være skjult eller 0 px højt, når det laves (indlejret, lazy iframe). Tilpas, når det får sin størrelse,
  // så længe brugeren ikke selv har flyttet kortet.
  let brugerFlyttet = false, sidstePkt = [];
  for (const ev of ['pointerdown', 'wheel']) kort.getContainer().addEventListener(ev, () => { brugerFlyttet = true; }, { passive: true });
  const tilpas = () => {
    kort.invalidateSize();
    if (brugerFlyttet) return;
    if (sidstePkt.length > 1) kort.fitBounds(sidstePkt, { padding: [30, 30], maxZoom: 10, animate: false });
    else if (sidstePkt.length === 1) kort.setView(sidstePkt[0], 10, { animate: false });
    else kort.fitBounds([[54.56, 8.07], [57.75, 12.69]], { animate: false });
  };
  new ResizeObserver(tilpas).observe(kort.getContainer());
  const markører = new Map();
  let førsteVisning = true;

  async function hent() {
    try {
      const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/doegnrapport`, {
        method: 'POST',
        headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dag }),
      });
      if (!r.ok) throw new Error('Svar ' + r.status);
      data = await r.json();
      tegn();
      $('#opdateret').innerHTML = `<span class="live"></span><span>${dag === iDag() ? 'Opdateres automatisk · ' : ''}senest hentet kl. ${kl(new Date().toISOString())}</span>`;
    } catch {
      $('#opdateret').innerHTML = '<span>Kunne ikke hente døgnrapporten lige nu. Prøver igen om lidt.</span>';
    }
  }

  // Filtrering: tryk på en kategori for kun at se den (flere kan vælges). "I alt" viser alle igen.
  const filter = new Set((q.get('kat') || '').split(',').filter(Boolean));
  function tegn() {
    const alle = data.haendelser || [];
    for (const k of [...filter]) if (!alle.some(h => h.kategori === k)) filter.delete(k);
    const hs = filter.size ? alle.filter(h => filter.has(h.kategori)) : alle;
    const vis = filter.size ? `${hs.length} af ${alle.length}` : `${alle.length}`;
    $('#dag-titel').textContent = `${dagTekst(dag)[0].toUpperCase()}${dagTekst(dag).slice(1)} · ${vis} hændelse${alle.length === 1 ? '' : 'r'}`;
    $('#naeste').disabled = dag >= iDag();
    $('#idag').disabled = dag === iDag();
    $('#forrige').disabled = dag <= flyt(iDag(), -60);
    // Antal pr. kategori
    const antal = {};
    for (const h of alle) antal[h.kategori] = (antal[h.kategori] || 0) + 1;
    $('#tal').innerHTML = (alle.length ? `<button type="button" class="filter${filter.size ? '' : ' valgt'}" data-kat="" aria-pressed="${!filter.size}">${alle.length} i alt</button>` : '')
      + Object.entries(antal).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `<button type="button" class="filter${filter.has(k) ? ' valgt' : ''}" data-kat="${esc(k)}" aria-pressed="${filter.has(k)}" title="Vis kun ${esc(k.toLowerCase())}">${IKON[k] || '📍'} ${n} ${esc(k === 'Andet' ? 'andet' : k.toLowerCase())}</button>`).join('');
    // Liste
    $('#liste').innerHTML = hs.length ? hs.map(h => `
      <article class="h${valgt === h.id ? ' valgt' : ''}" data-id="${h.id}" tabindex="0">
        <div class="ikon" aria-hidden="true">${IKON[h.kategori] || '📍'}</div>
        <div>
          <h3>${esc(h.overskrift)} <span class="tid">kl. ${kl(h.tid)}</span></h3>
          ${h.sted ? `<p class="sted">${esc(h.sted)}</p>` : ''}
          <div class="mærker">
            <span class="mærke ${h.status === 'aktiv' ? 'aktiv' : ''}">${h.status === 'aktiv' ? 'I gang' : 'Afsluttet'}</span>
            ${h.paa_stedet ? '<span class="mærke foto">📷 HRC-Fotos på stedet</span>' : ''}
          </div>
          ${h.kommentarer?.length ? `<ul class="kommentarer">${h.kommentarer.map(k => `<li><time>${kl(k.tid)}</time>${esc(k.tekst)}</li>`).join('')}</ul>` : ''}
        </div>
      </article>`).join('')
      : `<div class="tom">${filter.size ? 'Ingen hændelser i det valgte filter.' : dag === iDag() ? 'Ingen hændelser endnu i dag.' : 'Ingen hændelser denne dag.'}</div>`;
    // Kort
    lag.clearLayers(); markører.clear();
    const pkt = [];
    for (const h of hs) {
      if (h.lat == null) continue;
      const m = L.marker([h.lat, h.lon], {
        icon: L.divIcon({ className: '', html: `<div class="pin ${h.status === 'aktiv' ? '' : 'afsluttet'}${valgt === h.id ? ' valgt' : ''}">${IKON[h.kategori] || '📍'}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
        zIndexOffset: h.status === 'aktiv' ? 500 : 0,
      }).bindPopup(`<b>${esc(h.overskrift)}</b><br>${esc(h.sted || '')}<br><small>kl. ${kl(h.tid)} · ${h.status === 'aktiv' ? 'I gang' : 'Afsluttet'}</small>`);
      m.on('click', () => vælg(h.id, false));
      m.addTo(lag); markører.set(h.id, m); pkt.push([h.lat, h.lon]);
    }
    sidstePkt = pkt;
    if (førsteVisning) { tilpas(); førsteVisning = false; }
    sendHøjde();
  }

  function vælg(id, zoom = true) {
    valgt = id; brugerFlyttet = true; tegn();
    const m = markører.get(id);
    if (m && zoom) { kort.setView(m.getLatLng(), Math.max(kort.getZoom(), 10)); m.openPopup(); }
    if (!zoom) document.querySelector(`.h[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Indlejret på hrc-fotos.dk: fortæl siden udenom, hvor høj rapporten er
  function sendHøjde() {
    if (window.parent !== window) window.parent.postMessage({ hrcDoegnrapport: true, hoejde: document.documentElement.scrollHeight }, '*');
  }
  new ResizeObserver(sendHøjde).observe(document.body);

  const skift = n => { dag = n === 0 ? iDag() : flyt(dag, n); valgt = null; førsteVisning = true; brugerFlyttet = false; hent(); };
  $('#forrige').onclick = () => skift(-1);
  $('#naeste').onclick = () => skift(1);
  $('#idag').onclick = () => skift(0);
  $('#tal').addEventListener('click', e => {
    const b = e.target.closest('[data-kat]'); if (!b) return;
    const k = b.dataset.kat;
    if (!k) filter.clear(); else if (filter.has(k)) filter.delete(k); else filter.add(k);
    valgt = null; brugerFlyttet = false; førsteVisning = true;
    try { const u = new URL(location.href); filter.size ? u.searchParams.set('kat', [...filter].join(',')) : u.searchParams.delete('kat'); history.replaceState(null, '', u); } catch { /* ok */ }
    tegn();
  });
  $('#liste').addEventListener('click', e => { const a = e.target.closest('.h'); if (a) vælg(a.dataset.id); });
  $('#liste').addEventListener('keydown', e => { const a = e.target.closest('.h'); if (a && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); vælg(a.dataset.id); } });

  hent();
  // Løbende opdatering, mens siden er fremme (kun for i dag)
  setInterval(() => { if (document.visibilityState === 'visible' && dag === iDag()) hent(); }, 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && dag === iDag()) hent(); });
})();
