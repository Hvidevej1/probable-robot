// Vores medicin – hovedprogram
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STATUS = {
    bestil:  { label: 'Skal bestilles hos lægen', otcLabel: 'Skal købes', group: 'Skal bestilles' },
    bestilt: { label: 'Bestilt, venter på apoteket', group: 'Bestilt' },
    klar:    { label: 'Klar til afhentning på apoteket', group: 'Klar på apoteket' },
    hentet:  { label: 'Hjemme', group: 'Hjemme' },
  };
  const ORDER = ['bestil', 'bestilt', 'klar', 'hentet'];

  // Opslag på min.medicin.dk. Kun produktets navn sendes med, aldrig hvem det er til.
  const lookupUrl = name => 'https://min.medicin.dk/Search/Search/Search/' + encodeURIComponent(String(name).trim());
  const lookupLink = name => `<a class="lookup" href="${esc(lookupUrl(name))}" target="_blank" rel="noopener noreferrer">Slå op på min.medicin.dk</a>`;

  // ---------- hjælpere ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
  }
  function saved(ok) { if (!ok) toast('Kunne ikke gemme. Er browserens lager fuldt eller slået fra?'); }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
  }
  function fmtDate(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('da-DK', { day: 'numeric', month: 'long' });
  }
  function runsOutText(days) {
    if (days === null) return '';
    if (days < 0) return `Sluppet op for ${-days} dag${-days === 1 ? '' : 'e'} siden`;
    if (days === 0) return 'Slipper op i dag';
    if (days === 1) return 'Slipper op i morgen';
    return `Slipper op om ${days} dage`;
  }
  // En vare "hjemme" der snart slipper op, tæller som "skal bestilles"
  function effectiveStatus(m) {
    if (m.status === 'hentet') {
      const d = daysUntil(m.runsOut);
      if (d !== null && d <= Number(Store.settings.remindDays || 10)) return 'bestil';
    }
    return m.status;
  }

  // ---------- CTR / pris ----------
  const ctrOf = person => (Store.settings.ctr || {})[person];
  const parsePrice = v => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) && n > 0 ? n : null; };
  // Hvad koster pakken for denne person lige nu?
  function myPrice(m) {
    const price = parsePrice(m.price);
    if (price === null) return null;
    if (m.tilskud === false || m.kind === 'handkob') return { pay: price, full: price, tilskud: false };
    const info = ctrOf(m.person);
    if (!info) return { pay: null, full: price, tilskud: true };
    return { pay: CTR.copay(price, CTR.activeSaldo(info)), full: price, tilskud: true };
  }
  function priceText(m) {
    const p = myPrice(m);
    if (!p) return '';
    if (!p.tilskud) return `Pris: ${CTR.kr(p.full)}`;
    if (p.pay === null) return `Pris uden tilskud: ${CTR.kr(p.full)} (skriv CTR-saldo under “Mere” for at se jeres pris)`;
    return `Din pris ca. ${CTR.kr(p.pay)} (uden tilskud ${CTR.kr(p.full)})`;
  }

  function renderCtrSummary() {
    const who = $('#filter-person').value;
    const people = Store.settings.people.filter(p => p && (who === 'alle' || who === p));
    const lines = people.map(p => {
      const info = ctrOf(p);
      if (!info) return '';
      const saldo = CTR.activeSaldo(info);
      let end = '';
      if (info.periodEnd) {
        const d = daysUntil(info.periodEnd);
        end = d < 0 ? `<span class="gone">Perioden er udløbet. Ny periode starter ved næste køb med tilskud.</span>`
          : `Udløber ${esc(fmtDate(info.periodEnd))} ${new Date(info.periodEnd).getFullYear()} ` +
            (d <= 30 ? `<span class="soon">(om ${d} dage)</span>` : `(om ${d} dage)`);
      }
      return `<div class="line"><b>${esc(p)}</b>: CTR-saldo ${CTR.kr(saldo)}, ${CTR.currentPct(saldo)} % tilskud nu. ${end}</div>`;
    }).filter(Boolean);
    $('#ctr-summary').innerHTML = lines.length ? `<div class="ctr-box">${lines.join('')}</div>` : '';
  }

  // ---------- faner ----------
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
  function showView(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + name);
    if (name === 'handkob') renderProducts();
    if (name === 'indstillinger') { fillSettings(); showSyncStatus(); }
    window.scrollTo(0, 0);
  }

  // ---------- liste ----------
  function fillPersonSelects() {
    const people = Store.settings.people.filter(Boolean);
    const filter = $('#filter-person');
    const cur = filter.value || 'alle';
    filter.innerHTML = `<option value="alle">Begge</option>` + people.map(p => `<option>${esc(p)}</option>`).join('');
    filter.value = [...filter.options].some(o => o.value === cur) ? cur : 'alle';
    $('#form-med').person.innerHTML = people.map(p => `<option>${esc(p)}</option>`).join('') + `<option value="Fælles">Fælles</option>`;
  }

  function renderList() {
    const who = $('#filter-person').value;
    const meds = Store.meds.filter(m => who === 'alle' || m.person === who || m.person === 'Fælles');
    const groups = Object.fromEntries(ORDER.map(s => [s, []]));
    meds.forEach(m => groups[effectiveStatus(m)].push(m));
    // Mest akutte først
    const sortKey = m => { const d = daysUntil(m.runsOut); return d === null ? 9999 : d; };
    Object.values(groups).forEach(g => g.sort((a, b) => sortKey(a) - sortKey(b) || a.name.localeCompare(b.name, 'da')));

    const html = ORDER.map(s => {
      const list = groups[s];
      if (s === 'hentet' && !list.length && meds.length) return '';
      return `<div class="group">
        <h2>${STATUS[s].group} <span class="count">${list.length}</span></h2>
        ${list.length ? list.map(card).join('') : `<p class="empty">${s === 'bestil' && !meds.length ? 'Ingen medicin endnu. Tryk “+ Tilføj medicin” forneden.' : 'Intet her lige nu.'}</p>`}
      </div>`;
    }).join('');
    $('#groups').innerHTML = html;
    renderCtrSummary();
  }

  function card(m) {
    const eff = effectiveStatus(m);
    const days = daysUntil(m.runsOut);
    const otc = m.kind === 'handkob';
    const autoFlag = eff !== m.status;
    const label = eff === 'bestil' && otc ? STATUS.bestil.otcLabel : STATUS[eff].label;
    const meta = [m.strength, otc ? 'Håndkøb' : 'Recept'].filter(Boolean).join(' · ');

    // Altid både "bestil" og "afhentet". Den knap, der passer til status, er fremhævet.
    const ordered = m.status === 'bestilt' || m.status === 'klar';
    const btn = (act, text, main) => `<button class="${main ? '' : 'secondary'}" data-act="${act}" data-id="${m.id}">${text}</button>`;
    let actions;
    if (otc) {
      actions = btn('bestil', 'Skal købes', false) + btn('hentet', 'Købt', eff === 'bestil');
    } else {
      actions = btn('bestilt', ordered ? 'Bestilt ✓' : 'Bestil', eff === 'bestil')
              + btn('hentet', 'Afhentet', ordered);
      if (m.status === 'bestilt') actions += btn('klar', 'Klar på apoteket', false);
    }
    const rx = otc ? '' : receptText(m);

    return `<article class="card s-${eff}">
      <div class="head"><button class="name linklike" data-act="edit" data-id="${m.id}" title="Detaljer">${esc(m.name)}</button><span class="who">${esc(m.person || '')}</span></div>
      <div class="meta">${esc(meta)}</div>
      <div class="meta">${esc(label)}${m.runsOut ? ' · ' + esc(runsOutText(days)) + ` (${esc(fmtDate(m.runsOut))})` : ''}</div>
      ${autoFlag ? `<div class="warn">Snart tom. Husk at ${otc ? 'købe ny' : 'bestille hos lægen'}.</div>` : ''}
      ${rx ? `<div class="meta ${rx.warn ? 'warn' : ''}">${esc(rx.text)}</div>` : ''}
      ${priceText(m) ? `<div class="meta price">${esc(priceText(m))}</div>` : ''}
      ${m.note ? `<div class="meta">${esc(m.note)}</div>` : ''}
      <div class="meta links">${otc ? '' : `<a class="lookup" href="https://fmk-online.dk" target="_blank" rel="noopener noreferrer">Ret i FMK</a> · `}${lookupLink(m.name)}</div>
      <div class="actions">${actions}</div>
    </article>`;
  }

  // Receptinfo: udleveringer tilbage og udløbsdato
  function receptText(m) {
    const parts = [];
    let warn = false;
    if (m.udleveringer !== '' && m.udleveringer != null) {
      const n = Number(m.udleveringer);
      parts.push(n === 0 ? 'Ingen udleveringer tilbage, ny recept skal bestilles' : `${n} udlevering${n === 1 ? '' : 'er'} tilbage`);
      if (n <= 1) warn = true;
    }
    if (m.receptUdloeb) {
      const d = daysUntil(m.receptUdloeb);
      parts.push(d < 0 ? `recepten udløb ${fmtDate(m.receptUdloeb)}` : `recepten udløber ${fmtDate(m.receptUdloeb)} ${m.receptUdloeb.slice(0, 4)}`);
      if (d <= 30) warn = true;
    }
    return parts.length ? { text: 'Recept: ' + parts.join(' · '), warn } : null;
  }

  $('#groups').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const m = Store.meds.find(x => x.id === b.dataset.id);
    if (!m) return;
    const act = b.dataset.act;
    if (act === 'edit') return openMed(m);
    if (act === 'hentet') {
      // Spørg hvornår den nye pakke slipper op
      openMed({ ...m, status: 'hentet', runsOut: '' }, 'Hvornår slipper den nye pakke op?');
      return;
    }
    saved(Store.upsertMed({ id: m.id, status: act }));
    toast(`${m.name}: ${STATUS[act].group.toLowerCase()}`);
    renderList();
  });

  $('#filter-person').addEventListener('change', renderList);

  // ---------- dialog: medicin ----------
  const dlgMed = $('#dlg-med'), formMed = $('#form-med');
  formMed.status.innerHTML = ORDER.map(s => `<option value="${s}">${STATUS[s].label}</option>`).join('');

  function openMed(m = null, title = null) {
    formMed.reset();
    fillOtcDatalist();
    const isNew = !m || !m.id;
    $('#dlg-med-title').textContent = title || (isNew ? 'Tilføj medicin' : 'Ret medicin');
    $('#btn-delete').hidden = isNew;
    formMed.dataset.id = m?.id || '';
    const v = { kind: 'recept', status: 'bestil', person: Store.settings.people[0], ...(m || {}) };
    for (const k of ['name', 'strength', 'person', 'kind', 'status', 'runsOut', 'note']) formMed[k].value = v[k] || '';
    formMed.price.value = v.price === '' || v.price == null ? '' : String(v.price).replace('.', ',');
    formMed.receptUdloeb.value = v.receptUdloeb || '';
    formMed.udleveringer.value = v.udleveringer === '' || v.udleveringer == null ? '' : v.udleveringer;
    formMed.tilskud.checked = v.tilskud !== undefined ? v.tilskud !== false : v.kind !== 'handkob';
    formMed.dataset.prevStatus = m?.id ? (Store.meds.find(x => x.id === m.id)?.status || '') : '';
    updateCopayHint();
    dlgMed.showModal();
    if (isNew && !v.name) formMed.name.focus();
  }
  $('#btn-add').addEventListener('click', () => openMed());

  formMed.addEventListener('submit', e => {
    if (e.submitter?.value !== 'save') return;
    const med = {
      name: formMed.name.value.trim(), strength: formMed.strength.value.trim(), person: formMed.person.value,
      kind: formMed.kind.value, status: formMed.status.value, runsOut: formMed.runsOut.value, note: formMed.note.value.trim(),
      price: parsePrice(formMed.price.value) ?? '', tilskud: formMed.tilskud.checked,
      receptUdloeb: formMed.receptUdloeb.value,
      udleveringer: formMed.udleveringer.value === '' ? '' : Math.max(0, parseInt(formMed.udleveringer.value, 10) || 0),
    };
    if (!med.name) { e.preventDefault(); return; }
    if (formMed.dataset.id) med.id = formMed.dataset.id;
    saved(Store.upsertMed(med));
    // Hentet med tilskud: læg købet til CTR-saldoen
    const justPicked = med.status === 'hentet' && formMed.dataset.prevStatus && formMed.dataset.prevStatus !== 'hentet';
    if (justPicked && med.tilskud && med.kind !== 'handkob' && med.price && Store.settings.people.includes(med.person)) {
      const ctr = { ...(Store.settings.ctr || {}) };
      ctr[med.person] = CTR.afterPurchase(ctr[med.person], med.price);
      saved(Store.saveSettings({ ctr }));
      toast(`Gemt. CTR-saldo for ${med.person} er nu ${CTR.kr(ctr[med.person].saldo)}`);
    } else toast('Gemt');
    renderList();
  });
  function updateCopayHint() {
    const m = { price: formMed.price.value, tilskud: formMed.tilskud.checked, kind: formMed.kind.value, person: formMed.person.value };
    $('#med-copay').textContent = priceText(m);
  }
  ['price', 'tilskud', 'person'].forEach(k => formMed[k].addEventListener('input', updateCopayHint));
  formMed.kind.addEventListener('change', () => { formMed.tilskud.checked = formMed.kind.value !== 'handkob'; updateCopayHint(); });

  // Når man vælger et kendt håndkøbsprodukt i navnefeltet, udfyldes styrke og type
  formMed.name.addEventListener('change', () => {
    const p = Store.products.find(p => productLabel(p) === formMed.name.value);
    if (p) {
      formMed.name.value = p.name;
      if (!formMed.strength.value) formMed.strength.value = [p.strength, p.pack].filter(Boolean).join(', ');
      formMed.kind.value = 'handkob';
      formMed.tilskud.checked = false;
      if (!formMed.price.value && p.price) formMed.price.value = String(p.price).replace('.', ',');
      updateCopayHint();
    }
  });
  $('#btn-delete').addEventListener('click', () => {
    const id = formMed.dataset.id;
    const m = Store.meds.find(x => x.id === id);
    if (m && confirm(`Slet ${m.name} fra listen?`)) {
      saved(Store.deleteMed(id)); dlgMed.close(); toast('Slettet'); renderList();
    }
  });

  // ---------- håndkøb ----------
  const productLabel = p => [p.name, p.strength, p.pack].filter(Boolean).join(' – ');
  function fillOtcDatalist() {
    $('#otc-names').innerHTML = Store.products.slice(0, 2000).map(p => `<option value="${esc(productLabel(p))}">`).join('');
  }

  function renderProducts() {
    const q = $('#otc-search').value.trim().toLowerCase();
    const all = Store.products;
    const hits = q ? all.filter(p => [p.name, p.strength, p.varenr, p.ean].some(v => (v || '').toLowerCase().includes(q))) : all;
    const shown = hits.slice(0, 100);
    $('#otc-status').textContent = all.length
      ? `${all.length} produkter i alt${q ? `, ${hits.length} passer på søgningen` : ''}${hits.length > shown.length ? '. Viser de første 100.' : '.'}`
      : 'Ingen produkter endnu. Indlæs en fil, scan en stregkode eller skriv selv.';
    $('#otc-list').innerHTML = shown.map(p => `<li>
      <div><div>${esc(p.name)}</div>
        <div class="meta">${esc([p.strength, p.pack, p.price && p.price + ' kr.', p.varenr && 'vnr. ' + p.varenr].filter(Boolean).join(' · '))}</div>
        <div class="meta">${lookupLink(p.name)}</div></div>
      <button data-pid="${p.id}">Sæt på listen</button>
    </li>`).join('');
  }
  $('#otc-search').addEventListener('input', renderProducts);
  $('#otc-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-pid]');
    if (!b) return;
    const p = Store.products.find(x => x.id === b.dataset.pid);
    openMed({ name: p.name, strength: [p.strength, p.pack].filter(Boolean).join(', '), kind: 'handkob', status: 'bestil', price: p.price || '', tilskud: false });
  });

  $('#otc-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let text = await file.text();
    // Danske regneark gemmes tit som Windows-1252; prøv det, hvis æøå ser forkerte ud
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(await file.arrayBuffer());
    const res = ProductCSV.read(text);
    if (res.missingName) {
      toast('Kunne ikke finde en kolonne med produktnavn i filen.');
      $('#otc-status').textContent = 'Filen skal have en kolonne der hedder fx “Navn” eller “Produktnavn”.' +
        (res.headers ? ` Fundne kolonner: ${res.headers.join(', ')}` : '');
      return;
    }
    const r = Store.mergeProducts(res.products);
    saved(r.ok);
    toast(`Indlæst: ${r.added} nye, ${r.updated} opdateret`);
    renderProducts();
    if (res.filtered) $('#otc-status').textContent += ` ${res.filtered} receptpligtige varer i filen blev sprunget over.`;
  });

  // Skriv selv
  const dlgOtc = $('#dlg-otc'), formOtc = $('#form-otc');
  function openOtc(prefill = {}) {
    formOtc.reset();
    for (const k of ['name', 'strength', 'pack', 'price', 'varenr', 'ean']) formOtc[k].value = prefill[k] || '';
    dlgOtc.showModal();
  }
  $('#btn-otc-new').addEventListener('click', () => openOtc());
  formOtc.addEventListener('submit', e => {
    if (e.submitter?.value !== 'save') return;
    const p = {};
    for (const k of ['name', 'strength', 'pack', 'price', 'varenr', 'ean']) p[k] = formOtc[k].value.trim();
    p.varenr = p.varenr.replace(/\D/g, ''); p.ean = p.ean.replace(/\D/g, '');
    if (!p.name) { e.preventDefault(); return; }
    saved(Store.mergeProducts([p]).ok);
    toast('Produkt gemt');
    renderProducts();
  });

  // ---------- stregkode-scanner ----------
  const dlgScan = $('#dlg-scan'), video = $('#scan-video');
  let stream = null, scanning = false;
  $('#btn-scan').addEventListener('click', async () => {
    if (!('BarcodeDetector' in window)) {
      // iPhone har ikke indbygget stregkodelæser; hent en, første gang der scannes
      try { await loadScript('vendor/barcode-detector-3.2.2.js'); } catch { /* håndteres herunder */ }
    }
    if (!('BarcodeDetector' in window)) {
      toast('Kunne ikke starte scanneren. Skriv tallene under stregkoden i søgefeltet i stedet.');
      $('#otc-search').focus();
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch {
      toast('Fik ikke lov til at bruge kameraet.');
      return;
    }
    video.srcObject = stream; await video.play();
    dlgScan.showModal();
    scanning = true;
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'data_matrix', 'upc_a'] });
    const tick = async () => {
      if (!scanning) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) return found(codes[0].rawValue);
      } catch { /* prøv igen */ }
      requestAnimationFrame(tick);
    };
    tick();
  });
  function loadScript(src) {
    return new Promise((ok, fail) => {
      const el = document.createElement('script');
      el.src = src; el.onload = ok; el.onerror = fail;
      document.head.appendChild(el);
    });
  }
  function stopScan() {
    scanning = false;
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    if (dlgScan.open) dlgScan.close();
  }
  $('#btn-scan-close').addEventListener('click', stopScan);
  dlgScan.addEventListener('cancel', stopScan);

  function found(raw) {
    stopScan();
    // Medicinpakker har ofte en GS1-kode: (01) + 14 cifre. Træk stregkoden ud.
    let code = raw.replace(/[^\d]/g, '');
    const gtin = raw.match(/(?:^|\x1d|\(01\))01?(\d{14})/);
    if (gtin) code = gtin[1].replace(/^0/, '');
    const p = Store.products.find(p => p.ean && (p.ean === code || p.ean.endsWith(code) || code.endsWith(p.ean)));
    if (p) {
      $('#otc-search').value = p.name; renderProducts();
      toast(`Fundet: ${p.name}`);
    } else {
      toast('Ukendt stregkode. Skriv produktets navn, så husker appen den.');
      openOtc({ ean: code });
    }
  }

  // ---------- indstillinger ----------
  function fillCtrFields() {
    $('#ctr-fields').innerHTML = Store.settings.people.filter(Boolean).map((p, i) => {
      const info = ctrOf(p) || {};
      return `<div class="ctr-person">
        <b>${esc(p)}</b>
        <div class="row">
          <label class="stack" style="flex:1">Saldo (kr.)<input data-ctr="saldo" data-i="${i}" inputmode="decimal" value="${esc(info.saldo != null ? String(info.saldo).replace('.', ',') : '')}"></label>
          <label class="stack" style="flex:1">Udløber<input data-ctr="periodEnd" data-i="${i}" type="date" value="${esc(info.periodEnd || '')}"></label>
        </div>
      </div>`;
    }).join('');
  }
  $('#btn-save-ctr').addEventListener('click', () => {
    const ctr = { ...(Store.settings.ctr || {}) };
    Store.settings.people.forEach((p, i) => {
      if (!p) return;
      const saldoRaw = document.querySelector(`[data-ctr=saldo][data-i="${i}"]`).value.trim();
      const end = document.querySelector(`[data-ctr=periodEnd][data-i="${i}"]`).value;
      if (!saldoRaw && !end) { delete ctr[p]; return; }
      const saldo = Number(saldoRaw.replace(/\./g, '').replace(',', '.')) || 0;
      ctr[p] = { saldo, periodEnd: end, updatedOn: new Date().toISOString().slice(0, 10) };
    });
    saved(Store.saveSettings({ ctr }));
    renderList();
    toast('CTR-saldo gemt');
  });

  function fillSettings() {
    fillCtrFields();
    showPushStatus();
    $('#person1').value = Store.settings.people[0] || '';
    $('#person2').value = Store.settings.people[1] || '';
    $('#remind-days').value = Store.settings.remindDays;
  }
  $('#btn-save-settings').addEventListener('click', () => {
    const oldPeople = Store.settings.people.slice();
    const people = [$('#person1').value.trim(), $('#person2').value.trim()].map((p, i) => p || oldPeople[i] || '');
    // Omdøb personen på eksisterende medicin
    Store.meds.forEach(m => {
      const i = oldPeople.indexOf(m.person);
      if (i >= 0 && people[i] !== oldPeople[i]) Store.upsertMed({ id: m.id, person: people[i] });
    });
    const ctr = {};
    for (const [k, v] of Object.entries(Store.settings.ctr || {})) {
      const i = oldPeople.indexOf(k);
      ctr[i >= 0 ? people[i] : k] = v;
    }
    saved(Store.saveSettings({ people, ctr, remindDays: Math.max(1, Number($('#remind-days').value) || 10) }));
    fillCtrFields();
    fillPersonSelects(); renderList();
    toast('Gemt');
  });

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vores-medicin-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import-backup').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (!confirm(Store.cloud ? 'Medicinen fra kopien lægges ind i jeres fælles liste. Fortsæt?' : 'Dette erstatter listen på denne enhed med kopien. Fortsæt?')) return;
    try {
      saved(Store.importJSON(await file.text()));
      fillPersonSelects(); renderList(); fillSettings();
      toast('Kopien er hentet ind');
    } catch (err) {
      toast(err.message || 'Kunne ikke læse filen.');
    }
  });

  // ---------- push-beskeder ----------
  const vapidKey = (window.MEDICIN_CONFIG || {}).vapidPublicKey;
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

  async function showPushStatus() {
    const btn = $('#btn-push'), st = $('#push-status');
    btn.hidden = false;
    if (!Store.cloud || !vapidKey) { st.textContent = 'Push-beskeder kan slås til, når den fælles liste er sat op.'; btn.hidden = true; return; }
    if (!pushSupported()) {
      st.textContent = isIOS && !standalone()
        ? 'Læg først appen på hjemmeskærmen (Del → “Føj til hjemmeskærm”) og åbn den derfra.'
        : 'Denne browser kan ikke modtage push-beskeder.';
      btn.hidden = true; return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') {
      st.textContent = 'Push-beskeder er slået til på denne telefon.';
      btn.textContent = 'Slå push-beskeder fra';
      btn.dataset.on = '1';
    } else {
      st.textContent = Notification.permission === 'denied'
        ? 'Beskeder er blokeret. Slå dem til under Indstillinger → Notifikationer → Medicin.' : '';
      btn.textContent = 'Slå push-beskeder til';
      btn.dataset.on = '';
    }
  }
  function urlB64ToUint8Array(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  $('#btn-push').addEventListener('click', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      if ($('#btn-push').dataset.on) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) { await Store.removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
        toast('Push-beskeder er slået fra');
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { toast('Du skal tillade beskeder for at få push.'); return showPushStatus(); }
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(vapidKey) });
        await Store.savePushSubscription(sub);
        toast('Push-beskeder er slået til');
      }
    } catch (err) {
      toast('Kunne ikke slå push til: ' + (err.message || err));
    }
    showPushStatus();
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // ---------- log ind og deling ----------
  function rerenderAll() {
    fillPersonSelects();
    renderList();
    if (!$('#view-handkob').hidden) renderProducts();
  }
  async function showSyncStatus() {
    if (!Store.cloud) {
      $('#sync-status').textContent = 'Listen gemmes kun på denne enhed. Når den fælles database er sat op, kan I begge se og rette den samme liste.';
      $('#btn-logout').hidden = true;
      return;
    }
    const email = await Store.userEmail();
    $('#sync-status').textContent = `Fælles liste. Du er logget ind som ${email}. Ændringer ses med det samme på den andens telefon.`;
    $('#btn-logout').hidden = false;
  }
  function showApp(on) {
    $('#login').hidden = on;
    document.querySelector('header.top').hidden = !on;
    document.querySelector('main').hidden = !on;
  }
  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    $('#btn-login').disabled = true; $('#login-msg').textContent = '';
    try {
      await Store.login(f.email.value.trim(), f.password.value);
      f.reset(); showApp(true); rerenderAll(); showSyncStatus(); startFmkImport();
    } catch (err) {
      $('#login-msg').textContent = err.message || 'Kunne ikke logge ind.';
    } finally {
      $('#btn-login').disabled = false;
    }
  });
  $('#btn-logout').addEventListener('click', async () => {
    if (!confirm('Log ud på denne enhed?')) return;
    await Store.logout();
    showApp(false);
  });

  // ---------- hent fra FMK (bogmærket "Send til appen") ----------
  const FMK_ORIGIN = 'https://fmk-online.dk';
  const normName = n => String(n || '').toLowerCase().replace(/[®"“”']/g, '').replace(/\s+/g, ' ').trim();
  let fmkHandled = null;

  function applyFmk(data) {
    if (!data || data.type !== 'fmk-data' || fmkHandled === data.hentet) return null;
    fmkHandled = data.hentet;
    const person = Store.settings.people[0];
    const res = { updated: 0, added: [], empty: [], ctr: null };

    if (data.ctr && data.ctr.saldo != null) {
      const ctr = { ...(Store.settings.ctr || {}) };
      ctr[person] = { saldo: data.ctr.saldo, periodEnd: data.ctr.periodEnd || '', updatedOn: new Date().toISOString().slice(0, 10), kilde: 'FMK' };
      Store.saveSettings({ ctr });
      res.ctr = ctr[person];
    }

    // Saml recepter pr. præparat
    const byName = new Map();
    for (const r of data.recepter || []) {
      const k = normName(r.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(r);
    }
    const closed = s => /afsluttet|annuller|udløbet|seponeret/i.test(s || '');
    for (const [k, list] of byName) {
      const open = list.filter(r => !closed(r.status));
      const left = open.reduce((n, r) => n + Math.max(0, (r.total || 0) - (r.udleveret || 0)), 0);
      const pick = (open.length ? open : list).reduce((a, b) => (b.gyldigTil > a.gyldigTil ? b : a));
      const fields = { udleveringer: left, receptUdloeb: open.length ? pick.gyldigTil : '' };
      const existing = Store.meds.find(m => normName(m.name) === k && m.kind !== 'handkob');
      if (existing) {
        Store.upsertMed({ id: existing.id, ...fields });
        res.updated++;
      } else if (open.length) {
        Store.upsertMed({
          name: pick.name, strength: [pick.styrke, pick.form && pick.form.toLowerCase()].filter(Boolean).join(' '),
          person, kind: 'recept', status: 'hentet', tilskud: true,
          note: [pick.dosering, pick.indikation].filter(Boolean).join('. '), ...fields,
        });
        res.added.push(pick.name);
      }
      if (existing && (open.length === 0 || left === 0)) res.empty.push(existing.name);
    }
    renderList();
    return res;
  }

  function showFmkResult(res) {
    const lines = [];
    if (res.ctr) lines.push(`CTR-saldo: ${CTR.kr(res.ctr.saldo)}, periode til ${res.ctr.periodEnd ? fmtDate(res.ctr.periodEnd) + ' ' + res.ctr.periodEnd.slice(0, 4) : '?'}.`);
    lines.push(`${res.updated} præparater opdateret med receptinfo.`);
    if (res.added.length) lines.push(`Nye fra FMK: ${res.added.join(', ')}.`);
    if (res.empty.length) lines.push(`Ingen udleveringer tilbage (skal fornyes hos lægen): ${res.empty.join(', ')}.`);
    $('#fmk-result').innerHTML = lines.map(l => `<p>${esc(l)}</p>`).join('');
    $('#dlg-fmk').showModal();
  }

  function startFmkImport() {
    if (location.hash !== '#fmk-import' || !window.opener) return;
    history.replaceState(null, '', location.pathname);
    const opener = window.opener;
    window.addEventListener('message', e => {
      if (e.origin !== FMK_ORIGIN) return;
      const res = applyFmk(e.data);
      if (res) { opener.postMessage('fmk-done', FMK_ORIGIN); showFmkResult(res); clearInterval(ping); }
    });
    const ping = setInterval(() => { try { opener.postMessage('fmk-ready', FMK_ORIGIN); } catch { clearInterval(ping); } }, 1000);
    setTimeout(() => clearInterval(ping), 120000);
  }

  // Bogmærket bygges ud fra fmk-hent.js
  async function fillFmkBookmark() {
    try {
      const code = await (await fetch('fmk-hent.js', { cache: 'no-store' })).text();
      const body = code.replace(/^\s*\/\/.*$/gm, '');
      $('#fmk-bookmark').href = 'javascript:' + encodeURIComponent(body);
    } catch { /* uden net */ }
  }
  $('#fmk-bookmark').addEventListener('click', e => { e.preventDefault(); toast('Træk knappen op i bogmærkelinjen i stedet for at klikke.'); });

  // ---------- start ----------
  (async () => {
    const res = await Store.init({ onChange: rerenderAll, onError: toast });
    fillFmkBookmark();
    if (res.needsLogin) { showApp(false); return; }
    showApp(true);
    rerenderAll();
    showSyncStatus();
    startFmkImport();
  })();
  // Hent det nyeste, når man vender tilbage til appen
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    renderList();
    await Store.refresh();
  });
})();
