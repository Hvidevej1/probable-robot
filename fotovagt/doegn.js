// Døgnrapport: offentlig side med døgnets hændelser på kort. Kan vises alene eller indlejret på
// hrc-fotos.dk (<iframe src="https://vagt.hrc-fotos.dk/doegn.html?indlejret">). Data kommer fra
// databasefunktionen doegnrapport(), som kun giver kategori, by/område og offentlige kommentarer.
(() => {
  const cfg = window.FOTOVAGT_CONFIG || {};
  const q = new URLSearchParams(location.search);
  const indlejret = q.has('indlejret') || window.top !== window;
  if (indlejret) document.body.classList.add('indlejret');
  if (q.get('tema') === 'lys' || q.get('tema') === 'mørk') document.documentElement.dataset.theme = q.get('tema') === 'lys' ? 'light' : 'dark';

  const IKON = { Brand: '🔥', Trafik: '🚗', Politi: '🚓', Redning: '🛟', Lægehelikopter: '🚁', Indsatsleder: '🧑‍🚒', Miljø: '☣️', Vejr: '🌧️', Forsyning: '🔧', Andet: '📍' };
  const FARVE = { Brand: 'var(--brand)', Trafik: 'var(--trafik)', Politi: 'var(--politi)', Redning: 'var(--redning)', Lægehelikopter: 'var(--heli)', Indsatsleder: 'var(--isl)', Miljø: 'var(--miljø)', Vejr: 'var(--vejr)', Forsyning: 'var(--forsyning)', Andet: 'var(--andet)' };
  // Gruppen styrer ikon, farve, overskrift og filter, så de altid passer sammen.
  // Lægehelikopter og indsatsleder (ISL) er deres egen gruppe.
  const gruppe = h => h.ikon === 'helikopter' ? 'Lægehelikopter' : h.ikon === 'isl' ? 'Indsatsleder' : (h.kategori || 'Andet');
  const ikon = h => IKON[gruppe(h)] || '📍';
  const overskrift = h => (!h.overskrift || h.overskrift === h.kategori || h.overskrift === 'Hændelse') ? (gruppe(h) === 'Andet' ? 'Hændelse' : gruppe(h)) : h.overskrift;
  const farve = k => FARVE[k] || FARVE.Andet;
  const langDag = d => new Date(d + 'T12:00:00Z').toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const TZ = 'Europe/Copenhagen';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kl = iso => new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  const iDag = () => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date());   // ÅÅÅÅ-MM-DD
  const flyt = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const dagTekst = d => d === iDag() ? 'I dag' : d === flyt(iDag(), -1) ? 'I går'
    : new Date(d + 'T12:00:00Z').toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const $ = s => document.querySelector(s);
  // Vejret ved alarmen (met.no)
  const komma = x => String(x).replace('.', ',');
  const vejrLinje = v => [v.tekst, v.temp != null ? `${komma(v.temp)} °C` : '', v.vind != null ? `vind ${komma(v.vind)} m/s${v.retning && v.retning !== '?' ? ` fra ${v.retning}` : ''}` : '', v.nedboer > 0 ? `${komma(v.nedboer)} mm/t` : ''].filter(Boolean).join(' · ');
  const vejrIkon = s => !s ? '🌡️' : /thunder/.test(s) ? '⛈️' : /snow|sleet/.test(s) ? '🌨️' : /rain/.test(s) ? '🌧️' : /^fog/.test(s) ? '🌫️' : /^clearsky/.test(s) ? (/night/.test(s) ? '🌙' : '☀️') : /^fair|^partly/.test(s) ? '⛅' : '☁️';

  let dag = /^\d{4}-\d{2}-\d{2}$/.test(q.get('dag') || '') ? q.get('dag') : iDag();
  let data = { haendelser: [] }, valgt = null;

  // ---- Google AdSense (kun når klient-id står i config.js, og ikke indlejret i rammen på hrc-fotos.dk) ----
  const ad = cfg.adsense || {};
  const annoncer = /^ca-pub-\d{10,20}$/.test(ad.klient || '') && !indlejret;
  const annonce = (slot, cls) => annoncer && /^\d{6,12}$/.test(slot || '')
    ? `<div class="annonce ${cls}" aria-label="Annonce"><span class="annonce-mærke">Annonce</span><ins class="adsbygoogle" style="display:block" data-ad-client="${ad.klient}" data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins></div>` : '';
  const vækAnnoncer = () => { if (!annoncer) return; document.querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status])').forEach(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* blokeret */ } }); };
  if (annoncer) {
    const sc = document.createElement('script');
    sc.async = true; sc.crossOrigin = 'anonymous';
    sc.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ad.klient}`;
    document.head.append(sc);
    const top = document.getElementById('annonce-top');
    if (top) { top.innerHTML = annonce(ad.pladser?.top, 'top'); top.hidden = !top.innerHTML; }
  }

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
      const o = $('#opdateret');
      o.className = dag === iDag() ? 'live' : 'live gammel';
      o.textContent = dag === iDag() ? `Live · opdateret ${kl(new Date().toISOString())}` : 'Arkiv';
    } catch {
      const o = $('#opdateret'); o.className = 'live gammel'; o.textContent = 'Kan ikke hente lige nu – prøver igen';
    }
  }

  // Filtrering: tryk på en kategori for kun at se den (flere kan vælges). "I alt" viser alle igen.
  const filter = new Set((q.get('kat') || '').split(',').filter(Boolean));
  function tegn() {
    const alle = data.haendelser || [];
    for (const k of [...filter]) if (!alle.some(h => gruppe(h) === k)) filter.delete(k);
    const hs = filter.size ? alle.filter(h => filter.has(gruppe(h))) : alle;
    const vis = filter.size ? `${hs.length} af ${alle.length}` : `${alle.length}`;
    const dt = langDag(dag);
    $('#dag-titel').textContent = `${dag === iDag() ? 'I dag, ' : dag === flyt(iDag(), -1) ? 'I går, ' : ''}${dag === iDag() || dag === flyt(iDag(), -1) ? dt : dt[0].toUpperCase() + dt.slice(1)} · ${vis} hændelse${alle.length === 1 ? '' : 'r'}`;
    $('#naeste').disabled = dag >= iDag();
    $('#idag').disabled = dag === iDag();
    $('#forrige').disabled = dag <= flyt(iDag(), -60);
    // Antal pr. kategori
    const antal = {};
    for (const h of alle) antal[gruppe(h)] = (antal[gruppe(h)] || 0) + 1;
    $('#tal').innerHTML = !alle.length ? '' : `<span class="filtre-navn">Filtrér</span>`
      + `<button type="button" class="filter${filter.size ? '' : ' valgt'}" data-kat="" aria-pressed="${!filter.size}" style="--k: var(--accent)">Alle <b>${alle.length}</b></button>`
      + Object.entries(antal).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `<button type="button" class="filter${filter.has(k) ? ' valgt' : ''}" data-kat="${esc(k)}" aria-pressed="${filter.has(k)}" style="--k: ${farve(k)}" title="Vis kun ${esc(k.toLowerCase())}">${IKON[k] || '📍'} ${esc(k === 'Andet' ? 'Andet' : k)} <b>${n}</b></button>`).join('');
    // Liste
    $('#liste').innerHTML = hs.length ? hs.map((h, i) => (i > 0 && i % 8 === 0 ? annonce(ad.pladser?.liste, 'i-liste') : '') + `
      <article class="h${valgt === h.id ? ' valgt' : ''}" data-id="${h.id}" tabindex="0" style="--k: ${farve(gruppe(h))}">
        <div class="ikon" aria-hidden="true">${ikon(h)}</div>
        <div>
          <h3>${esc(overskrift(h))}</h3>
          ${h.sted ? `<p class="sted">${esc(h.sted)}</p>` : ''}
          <div class="mærker">
            <span class="mærke ${h.status === 'aktiv' ? 'aktiv' : ''}">${h.status === 'aktiv' ? 'I gang' : 'Afsluttet'}</span>
            ${h.paa_stedet ? '<span class="mærke foto">📷 HRC-Fotos på stedet</span>' : ''}
          </div>
          ${h.vejr ? `<p class="vejr" title="Vejret på stedet ved alarmen (met.no)">${vejrIkon(h.vejr.symbol)} ${esc(vejrLinje(h.vejr))}</p>` : ''}
          ${h.nyheder?.length ? `<p class="nyheder">📰 Læs mere: ${h.nyheder.filter(n => /^https?:\/\//i.test(n.url)).map(n => `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.kilde || 'nyhed')}</a>`).join(' · ')}</p>` : ''}
          ${h.kommentarer?.length ? `<ul class="kommentarer">${h.kommentarer.map(k => `<li><time>${kl(k.tid)}</time>${esc(k.tekst)}</li>`).join('')}</ul>` : ''}
        </div>
        <span class="tid">${kl(h.tid)}</span>
      </article>`).join('')
      : `<div class="tom">${filter.size ? 'Ingen hændelser i det valgte filter.' : dag === iDag() ? 'Ingen hændelser endnu i dag.' : 'Ingen hændelser denne dag.'}</div>`;
    // Kort
    lag.clearLayers(); markører.clear();
    const pkt = [];
    for (const h of hs) {
      if (h.lat == null) continue;
      const m = L.marker([h.lat, h.lon], {
        icon: L.divIcon({ className: '', html: `<div class="pin ${h.status === 'aktiv' ? '' : 'afsluttet'}${valgt === h.id ? ' valgt' : ''}" style="--k: ${farve(gruppe(h))}">${ikon(h)}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] }),
        zIndexOffset: h.status === 'aktiv' ? 500 : 0,
      }).bindPopup(`<b>${ikon(h)} ${esc(overskrift(h))}</b><br>${esc(h.sted || '')}<br><small>kl. ${kl(h.tid)} · ${h.status === 'aktiv' ? 'I gang' : 'Afsluttet'}</small>`);
      m.on('click', () => vælg(h.id, false));
      m.addTo(lag); markører.set(h.id, m); pkt.push([h.lat, h.lon]);
    }
    sidstePkt = pkt;
    // Hændelser uden placering (fx en pressemeddelelse uden by) står kun i listen – sig det på kortet
    const uden = hs.length - pkt.length, tom = $('#kort-tom');
    tom.hidden = !(hs.length && !pkt.length);
    tom.querySelector('span').textContent = hs.length === 1 ? 'Hændelsen har ingen placering på kortet – se listen' : 'De valgte hændelser har ingen placering på kortet – se listen';
    if (uden && pkt.length) kort.attributionControl.setPrefix(`${uden} uden placering`); else kort.attributionControl.setPrefix('');
    vækAnnoncer();
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
