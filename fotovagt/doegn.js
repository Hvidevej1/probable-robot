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

  function tegn() {
    const hs = data.haendelser || [];
    $('#dag-titel').textContent = `${dagTekst(dag)[0].toUpperCase()}${dagTekst(dag).slice(1)} · ${hs.length} hændelse${hs.length === 1 ? '' : 'r'}`;
    $('#naeste').disabled = dag >= iDag();
    $('#idag').disabled = dag === iDag();
    $('#forrige').disabled = dag <= flyt(iDag(), -60);
    // Antal pr. kategori
    const antal = {};
    for (const h of hs) antal[h.kategori] = (antal[h.kategori] || 0) + 1;
    $('#tal').innerHTML = Object.entries(antal).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `<span>${IKON[k] || '📍'} ${n} ${esc(k === 'Andet' ? 'andet' : k.toLowerCase())}</span>`).join('');
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
      : `<div class="tom">${dag === iDag() ? 'Ingen hændelser endnu i dag.' : 'Ingen hændelser denne dag.'}</div>`;
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
    if (førsteVisning && pkt.length) { kort.fitBounds(pkt, { padding: [30, 30], maxZoom: 10 }); førsteVisning = false; }
    sendHøjde();
  }

  function vælg(id, zoom = true) {
    valgt = id; tegn();
    const m = markører.get(id);
    if (m && zoom) { kort.setView(m.getLatLng(), Math.max(kort.getZoom(), 10)); m.openPopup(); }
    if (!zoom) document.querySelector(`.h[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Indlejret på hrc-fotos.dk: fortæl siden udenom, hvor høj rapporten er
  function sendHøjde() {
    if (window.parent !== window) window.parent.postMessage({ hrcDoegnrapport: true, hoejde: document.documentElement.scrollHeight }, '*');
  }
  new ResizeObserver(sendHøjde).observe(document.body);

  const skift = n => { dag = n === 0 ? iDag() : flyt(dag, n); valgt = null; førsteVisning = true; kort.fitBounds([[54.56, 8.07], [57.75, 12.69]]); hent(); };
  $('#forrige').onclick = () => skift(-1);
  $('#naeste').onclick = () => skift(1);
  $('#idag').onclick = () => skift(0);
  $('#liste').addEventListener('click', e => { const a = e.target.closest('.h'); if (a) vælg(a.dataset.id); });
  $('#liste').addEventListener('keydown', e => { const a = e.target.closest('.h'); if (a && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); vælg(a.dataset.id); } });

  hent();
  // Løbende opdatering, mens siden er fremme (kun for i dag)
  setInterval(() => { if (document.visibilityState === 'visible' && dag === iDag()) hent(); }, 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && dag === iDag()) hent(); });
})();
