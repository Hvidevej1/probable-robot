// Vores medicin – hovedprogram
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STATUS = {
    bestil:  { label: 'Skal bestilles hos lægen', otcLabel: 'Skal købes', group: 'Skal bestilles' },
    bestilt: { label: 'Skal afhentes på apoteket', group: 'Skal afhentes' },
    hentet:  { label: 'Hjemme', group: 'Hjemme' },
  };
  const ORDER = ['bestil', 'bestilt', 'hentet'];

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
    if (m.status === 'klar') return 'bestilt'; // gammel status, findes ikke længere
    if (m.status === 'hentet') {
      const d = daysUntil(m.runsOut);
      if (d !== null && d <= Number(Store.settings.remindDays || 10)) return 'bestil';
    }
    return m.status;
  }

  // ---------- CTR / pris ----------
  const ctrOf = owner => Store.ctrOf(owner);
  const parsePrice = v => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) && n > 0 ? n : null; };
  // Hvad koster pakken for denne person lige nu?
  function myPrice(m) {
    const price = parsePrice(m.price);
    if (price === null) return null;
    if (m.kind === 'handkob') return { pay: price, full: price, tilskud: false };
    if (isVaccine(m)) {
      // Vacciner: intet offentligt tilskud (CTR), undtagen gratis vaccinationsprogrammer.
      // "danmark" (2026) giver 50 % for medlemmer på 26 år og derover i gruppe 1, 2 og 5.
      const g = String(ctrOf(m.owner)?.danmark || '');
      const pct = ['1', '2', '5'].includes(g) ? VACCINE_PCT : 0;
      return { pay: price, full: price, tilskud: false, vaccine: true, danmark: Math.round(price * pct) / 100 };
    }
    if (m.tilskud === false) {
      // Receptmedicin uden offentligt tilskud: "danmark" gruppe 1/2 giver 50 %, gruppe 5 25 % (max 3.000/1.500 kr. pr. år)
      const pct = (DANMARK[String(ctrOf(m.owner)?.danmark || '')] || [0, 0, 0])[2];
      return { pay: price, full: price, tilskud: false, danmark: Math.round(price * pct) / 100 };
    }
    const info = ctrOf(m.owner);
    if (!info || (info.saldo == null && !info.periodEnd)) return { pay: null, full: price, tilskud: true };
    // Tilskud beregnes kun af tilskudsprisen (prisen på den billigste tilsvarende pakning).
    // Er pakken dyrere, betaler man selv forskellen fuldt ud.
    const tp = Math.min(price, parsePrice(m.tilskudspris) ?? price);
    const ctrPart = CTR.copay(tp, CTR.activeSaldo(info));
    const extra = Math.round((price - tp) * 100) / 100;
    const pay = Math.round((ctrPart + extra) * 100) / 100;
    return { pay, full: price, tilskud: true, danmark: danmarkBack(info.danmark, ctrPart, extra) };
  }
  const VACCINE_PCT = 50;
  const isVaccine = m => m.kind === 'vaccine' || /vaccin|abrysvo|arexvy|prevenar|pneumovax|capvaxive|shingrix|vaxigrip|influvac|efluelda|comirnaty|spikevax|boostrix|diteboost|twinrix|havrix|engerix|gardasil|encepur|ticovac|dukoral|vivotif|ixiaro|rabipur|verorab/i.test(m.name || '');
  // Sygeforsikringen "danmark" (2026): tilskud af egenbetalingen for medicin med
  // offentligt tilskud, købt som den billigste pakning. Gruppe 1 og 2: 100 %, gruppe 5: 50 %.
  // (Dyrere pakning end den billigste: kun en del af merprisen dækkes. Det regner appen ikke med.)
  // Merprisen over tilskudsprisen: gruppe 2 100 %, gruppe 1 50 %, gruppe 5 25 %.
  const DANMARK = { '2': [100, 100, 50], '1': [100, 50, 50], '5': [50, 25, 25], basis: [0, 0, 0] };
  function danmarkBack(gruppe, ctrPart, extra = 0) {
    const g = DANMARK[String(gruppe || '')];
    return g ? Math.round(ctrPart * g[0] + extra * g[1]) / 100 : 0;
  }
  function priceText(m) {
    let t = priceTextCore(m);
    // Findes der et billigere kopiprodukt? Så vis hvad det koster for jer.
    const own = parsePrice(m.price), cheap = parsePrice(m.billigstPris);
    if (t && own && cheap && cheap < own - 0.5 && m.billigstVarenr !== m.varenr) {
      const c = priceTextCore({ ...m, price: cheap });
      t += ` · Billigste kopi: ${m.billigstNavn} (${CTR.kr(cheap)}). ${c.replace(/^Pris: /, 'Pris ').replace(/ \(uden tilskud.*\)$/, '')}. Spørg efter den på apoteket.`;
    }
    return t && m.prisOpdateret ? `${t} · priser fra medicinpriser.dk ${fmtDate(m.prisOpdateret)}` : t;
  }
  function priceTextCore(m) {
    const p = myPrice(m);
    if (!p) return '';
    if (p.vaccine) return p.danmark
      ? `Vaccine: intet offentligt tilskud. Pris ${CTR.kr(p.full)}, “danmark” giver op til ${CTR.kr(p.danmark)} (50 %) tilbage. Reelt fra ${CTR.kr(p.full - p.danmark)}`
      : `Vaccine: intet offentligt tilskud. Pris ${CTR.kr(p.full)}`;
    if (!p.tilskud) return p.danmark ? `Pris ${CTR.kr(p.full)}, “danmark” giver ${CTR.kr(p.danmark)} tilbage. Reelt ${CTR.kr(p.full - p.danmark)}` : `Pris: ${CTR.kr(p.full)}`;
    if (p.pay === null) return `Pris uden tilskud: ${CTR.kr(p.full)} (hent CTR-saldo fra FMK for at se din pris)`;
    if (p.danmark) {
      const net = Math.max(0, p.pay - p.danmark);
      return `På apoteket ca. ${CTR.kr(p.pay)}, “danmark” giver ${CTR.kr(p.danmark)} tilbage. Reelt ${CTR.kr(net)} (uden tilskud ${CTR.kr(p.full)})`;
    }
    return `Din pris ca. ${CTR.kr(p.pay)} (uden tilskud ${CTR.kr(p.full)})`;
  }

  function renderCtrSummary() {
    const people = [Store.viewOwner];
    const lines = people.map(p => {
      const info = ctrOf(p);
      if (!info || info.saldo == null) return '';
      const saldo = CTR.activeSaldo(info);
      let end = '';
      if (info.periodEnd) {
        const d = daysUntil(info.periodEnd);
        end = d < 0 ? `<span class="gone">Perioden er udløbet. Ny periode starter ved næste køb med tilskud.</span>`
          : `Udløber ${esc(fmtDate(info.periodEnd))} ${new Date(info.periodEnd).getFullYear()} ` +
            (d <= 30 ? `<span class="soon">(om ${d} dage)</span>` : `(om ${d} dage)`);
      }
      return `<div class="line">CTR-saldo ${CTR.kr(saldo)}, ${CTR.currentPct(saldo)} % tilskud nu. ${end}</div>`;
    }).filter(Boolean);
    $('#ctr-summary').innerHTML = lines.length ? `<div class="ctr-box">${lines.join('')}</div>` : '';
  }

  // ---------- faner ----------
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
  function showView(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + name);
    document.body.dataset.view = name;
    if (name === 'handkob') renderProducts();
    if (name === 'indstillinger') { fillSettings(); showSyncStatus(); }
    if (name === 'paamind') fillReminders();
    window.scrollTo(0, 0);
  }

  // ---------- liste ----------
  // Hvis medicinliste: ens egen, eller en man har fuldmagt til
  function fillPersonSelects() {
    const owners = Store.owners();
    const filter = $('#filter-person');
    filter.innerHTML = owners.map(o => `<option value="${esc(o.id)}">${esc(o.id === Store.me ? (o.name ? o.name + ' (mig)' : 'Mig') : o.name)}</option>`).join('');
    filter.value = Store.viewOwner;
    document.querySelector('.filter').hidden = owners.length <= 1;
  }

  function renderList() {
    const meds = Store.meds.filter(m => (m.owner || '') === Store.viewOwner);
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
    const meta = [m.strength, otc ? 'Håndkøb' : isVaccine(m) ? 'Vaccine' : 'Recept'].filter(Boolean).join(' · ');

    // Altid både "skal afhentes" og "afhentet". Den knap, der passer til status, er fremhævet.
    // "Skal afhentes" sender en push-besked med det samme og igen efter 3 dage, hvis den ikke er hentet.
    const ordered = m.status === 'bestilt' || m.status === 'klar';
    const btn = (act, text, main) => `<button class="${main ? '' : 'secondary'}" data-act="${act}" data-id="${m.id}">${text}</button>`;
    let actions;
    if (otc) {
      actions = btn('bestil', 'Skal købes', false) + btn('hentet', 'Købt', eff === 'bestil');
    } else {
      actions = btn('bestilt', ordered ? 'Skal afhentes ✓' : 'Skal afhentes', eff === 'bestil')
              + btn('hentet', 'Afhentet', ordered);
    }
    const rx = otc ? '' : receptText(m);

    return `<article class="card s-${eff}">
      <div class="head"><button class="name linklike" data-act="edit" data-id="${m.id}" title="Detaljer">${esc(m.name)}</button></div>
      <div class="meta">${esc(meta)}</div>
      ${m.runsOut ? `<div class="meta">${esc(runsOutText(days))} (${esc(fmtDate(m.runsOut))})</div>` : ''}
      ${autoFlag ? `<div class="warn">Snart tom. Husk at ${otc ? 'købe ny' : 'bestille hos lægen'}.</div>` : ''}
      ${rx ? `<div class="meta ${rx.warn ? 'warn' : ''}">${esc(rx.text)}</div>` : ''}
      ${priceText(m) ? `<div class="meta price">${esc(priceText(m))}</div>` : ''}
      ${m.note ? `<div class="meta">${esc(m.note)}</div>` : ''}
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
    if (act === 'bestilt' && m.kind !== 'handkob' && m.udleveringer !== '' && Number(m.udleveringer) === 0) {
      // Ingen udleveringer tilbage: lægen skal forny recepten
      window.open('https://www.sundhed.dk/borger/min-side/min-sundhedsjournal/medicinkortet/', '_blank', 'noopener');
      toast('Recepten er brugt op. Bed lægen om fornyelse på sundhed.dk (fanen Receptfornyelse).');
    }
    if (act === 'hentet') {
      // Spørg hvornår den nye pakke slipper op
      openMed({ ...m, status: 'hentet', runsOut: '' }, 'Hvornår slipper den nye pakke op?');
      return;
    }
    saved(Store.upsertMed({ id: m.id, status: act }));
    toast(`${m.name}: ${STATUS[act].group.toLowerCase()}`);
    renderList();
  });

  $('#filter-person').addEventListener('change', e => Store.setViewOwner(e.target.value));

  // ---------- dialog: medicin ----------
  const dlgMed = $('#dlg-med'), formMed = $('#form-med');
  formMed.status.innerHTML = ORDER.map(s => `<option value="${s}">${STATUS[s].label}</option>`).join('');

  function openMed(m = null, title = null) {
    formMed.reset();
    fillOtcDatalist();
    const isNew = !m || !m.id;
    // Receptmedicin ordineres af lægen; i appen kan man kun rette sine egne noter
    const locked = !isNew && (m.kind || 'recept') !== 'handkob';
    $('#dlg-med-title').textContent = title || (isNew ? 'Tilføj medicin' : locked ? 'Dine noter' : 'Ret håndkøbsprodukt');
    formMed.name.readOnly = formMed.strength.readOnly = locked;
    formMed.kind.disabled = locked;
    $('#med-locked-hint').hidden = !locked;
    $('#btn-delete').hidden = isNew;
    formMed.dataset.id = m?.id || '';
    const v = { kind: 'recept', status: 'bestil', ...(m || {}) };
    if (v.status === 'klar') v.status = 'bestilt';
    for (const k of ['name', 'strength', 'kind', 'status', 'runsOut', 'note']) formMed[k].value = v[k] || '';
    formMed.price.value = v.price === '' || v.price == null ? '' : String(v.price).replace('.', ',');
    formMed.receptUdloeb.value = v.receptUdloeb || '';
    formMed.udleveringer.value = v.udleveringer === '' || v.udleveringer == null ? '' : v.udleveringer;
    formMed.tilskud.checked = v.tilskud !== undefined ? v.tilskud !== false : v.kind !== 'handkob';
    formMed.dataset.prevStatus = m?.id ? (Store.meds.find(x => x.id === m.id)?.status || '') : '';
    applyKind();
    formMed.status.value = v.kind === 'handkob' && v.status === 'bestilt' ? 'bestil' : v.status;
    updateCopayHint();
    $('#med-links').innerHTML = isNew ? '' : (v.kind !== 'handkob' ? `<a class="lookup" href="https://fmk-online.dk" target="_blank" rel="noopener noreferrer">Se i FMK</a> · ` : '') + lookupLink(v.name);
    dlgMed.showModal();
    if (isNew && !v.name) formMed.name.focus();
  }
  $('#btn-add').addEventListener('click', () => openMed());

  formMed.addEventListener('submit', e => {
    if (e.submitter?.value !== 'save') return;
    const med = {
      name: formMed.name.value.trim(), strength: formMed.strength.value.trim(),
      kind: formMed.kind.value, status: formMed.status.value, runsOut: formMed.runsOut.value, note: formMed.note.value.trim(),
      price: parsePrice(formMed.price.value) ?? '', tilskud: formMed.tilskud.checked,
      receptUdloeb: formMed.receptUdloeb.value,
      udleveringer: formMed.udleveringer.value === '' ? '' : Math.max(0, parseInt(formMed.udleveringer.value, 10) || 0),
    };
    if (!med.name) { e.preventDefault(); return; }
    if (formMed.dataset.id) med.id = formMed.dataset.id;
    saved(Store.upsertMed(med));
    // CTR-saldoen ændres kun via FMK-hentningen (Hans' ønske), ikke når noget hentes.
    toast('Gemt');
    renderList();
  });
  function updateCopayHint() {
    const m = { price: formMed.price.value, tilskud: formMed.tilskud.checked, kind: formMed.kind.value, owner: Store.viewOwner };
    $('#med-copay').textContent = priceText(m);
  }
  ['price', 'tilskud'].forEach(k => formMed[k].addEventListener('input', updateCopayHint));
  // Håndkøb: ingen recept- eller tilskudsfelter, og kun "skal købes" / "købt"
  function applyKind() {
    const otc = formMed.kind.value === 'handkob';
    formMed.classList.toggle('otc', otc);
    const cur = formMed.status.value;
    formMed.status.innerHTML = otc
      ? `<option value="bestil">Skal købes</option><option value="hentet">Købt, haves derhjemme</option>`
      : ORDER.map(s => `<option value="${s}">${STATUS[s].label}</option>`).join('');
    formMed.status.value = otc && cur === 'bestilt' ? 'bestil' : cur;
    if (!formMed.status.value) formMed.status.value = 'bestil';
    const vac = formMed.kind.value === 'vaccine';
    formMed.tilskud.closest('label').hidden = vac;
    if (vac) formMed.tilskud.checked = false;
    if (otc) { formMed.tilskud.checked = false; formMed.udleveringer.value = ''; formMed.receptUdloeb.value = ''; }
  }
  formMed.kind.addEventListener('change', () => { formMed.tilskud.checked = formMed.kind.value === 'recept'; applyKind(); updateCopayHint(); });

  // Når man vælger et kendt håndkøbsprodukt i navnefeltet, udfyldes styrke og type
  formMed.name.addEventListener('change', () => {
    const p = Store.products.find(p => productLabel(p) === formMed.name.value);
    if (p) {
      formMed.name.value = p.name;
      if (!formMed.strength.value) formMed.strength.value = [p.strength, p.pack].filter(Boolean).join(', ');
      formMed.kind.value = 'handkob';
      formMed.tilskud.checked = false;
      if (!formMed.price.value && p.price) formMed.price.value = String(p.price).replace('.', ',');
      applyKind();
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
  // CTR for de lister, man har adgang til. Saldo og udløb kommer kun fra FMK.
  function fillCtrFields() {
    $('#ctr-fields').innerHTML = Store.owners().map((o, i) => {
      const info = ctrOf(o.id) || {};
      return `<div class="ctr-person">
        <b>${esc(o.name)}</b>
        <p class="ctr-readonly">${info.saldo != null
          ? `Saldo: <b>${esc(CTR.kr(info.saldo))}</b> · udløber ${info.periodEnd ? esc(fmtDate(info.periodEnd) + ' ' + info.periodEnd.slice(0, 4)) : '?'}<br><span class="hint">Hentet fra FMK ${info.updatedOn ? esc(fmtDate(info.updatedOn) + ' ' + info.updatedOn.slice(0, 4)) : ''}</span>`
          : '<span class="hint">Ingen saldo endnu. Den hentes med “Send til appen” fra FMK.</span>'}</p>
        <label class="stack">Sygeforsikringen “danmark”
          <select data-ctr="danmark" data-owner="${esc(o.id)}">
            ${[['', 'Ikke medlem'], ['2', 'Gruppe 2 (højeste)'], ['1', 'Gruppe 1'], ['5', 'Gruppe 5'], ['basis', 'Basis (intet medicintilskud)']].map(([v, t]) => `<option value="${v}" ${String(info.danmark || '') === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
      </div>`;
    }).join('');
  }
  $('#btn-save-ctr').addEventListener('click', () => {
    document.querySelectorAll('[data-ctr=danmark]').forEach(sel => {
      const owner = sel.dataset.owner;
      if (!Store.ctrOf(owner) && !sel.value) return;
      saved(Store.saveCtr(owner, { danmark: sel.value }));
    });
    renderList();
    toast('Gemt');
  });

  // ---------- fuldmagt ----------
  function fillFuldmagt() {
    if (!Store.cloud) { $('#fuldmagt').innerHTML = ''; return; }
    const me = Store.me;
    const given = Store.grants.filter(g => g.owner === me);
    const got = Store.grants.filter(g => g.grantee === me);
    const others = Store.users.filter(u => u.id !== me && !given.some(g => g.grantee === u.id));
    const row = (text, owner, grantee) => `<li><span>${esc(text)}</span> <button class="secondary small" data-revoke="${esc(owner)}|${esc(grantee)}">Fjern</button></li>`;
    $('#fuldmagt').innerHTML = `
      <p class="hint">Med fuldmagt kan en anden se og passe din medicin: bestille, hente og få push-beskeder om den. Du kan altid fjerne den igen.</p>
      <h3>Har fuldmagt til min medicin</h3>
      ${given.length ? `<ul class="plain">${given.map(g => row(Store.nameOf(g.grantee), g.owner, g.grantee)).join('')}</ul>` : '<p class="hint">Ingen.</p>'}
      ${others.length ? `<div class="row"><select id="fuldmagt-ny">${others.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select><button id="btn-fuldmagt">Giv fuldmagt</button></div>` : ''}
      <h3>Jeg har fuldmagt til</h3>
      ${got.length ? `<ul class="plain">${got.map(g => row(Store.nameOf(g.owner), g.owner, g.grantee)).join('')}</ul>` : '<p class="hint">Ingen.</p>'}`;
  }
  $('#fuldmagt').addEventListener('click', async e => {
    try {
      if (e.target.id === 'btn-fuldmagt') {
        const id = $('#fuldmagt-ny').value;
        if (!confirm(`Give ${Store.nameOf(id)} fuldmagt til at se og passe din medicin?`)) return;
        await Store.grant(id); toast('Fuldmagt givet');
      }
      const r = e.target.dataset.revoke;
      if (r) {
        const [owner, grantee] = r.split('|');
        if (!confirm('Fjerne fuldmagten?')) return;
        await Store.revoke(owner, grantee); toast('Fuldmagt fjernet');
      }
    } catch (err) { toast('Det lykkedes ikke: ' + err.message); }
    fillFuldmagt(); fillCtrFields(); fillPersonSelects(); renderList();
  });

  // ---------- påmindelser om at tage medicin / fylde doseringsæsken ----------
  // Appen viser kun tidspunkter. Den regner aldrig på doser; dosis står i FMK.
  let reminders = [];
  const HVER = { 1: 'Hver dag', 7: 'Hver uge', 14: 'Hver 14. dag' };
  const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function nextSunday() { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return isoDate(d); }
  // Næste gang en påmindelse med "hver X. dag" kommer (i dag eller senere)
  function nextDate(r) {
    const start = new Date(r.start_dato + 'T00:00:00'), today = new Date(); today.setHours(0, 0, 0, 0);
    if (start >= today) return r.start_dato;
    const n = Math.round((today - start) / 86400000), add = (r.hver - n % r.hver) % r.hver;
    today.setDate(today.getDate() + add); return isoDate(today);
  }
  function reminderText(r) {
    const what = r.slags === 'doseringsaeske' ? 'Fyld doseringsæsken' : 'Tag medicin';
    const when = r.hver === 1 ? 'hver dag' : `${(HVER[r.hver] || `Hver ${r.hver}. dag`).toLowerCase()}, næste gang ${fmtDate(nextDate(r))}`;
    return `${r.tekst ? r.tekst + ': ' : ''}${what} kl. ${String(r.tid).slice(0, 5)}, ${when}`;
  }
  async function fillReminders() {
    const ul = $('#paamind-list');
    if (!Store.cloud) { ul.innerHTML = '<li class="hint">Påmindelser kræver den fælles liste.</li>'; return; }
    try { reminders = await Store.reminders(); } catch (err) { ul.innerHTML = `<li class="hint">Kunne ikke hente påmindelser: ${esc(err.message)}</li>`; return; }
    ul.innerHTML = reminders.length ? reminders.map(r => `<li class="${r.aktiv ? '' : 'off'}">
        <label class="check"><input type="checkbox" data-toggle="${esc(r.id)}" ${r.aktiv ? 'checked' : ''} aria-label="Slået til"> <span>${esc(reminderText(r))}</span></label>
        <button class="secondary small" data-edit="${esc(r.id)}">Ret</button></li>`).join('')
      : '<li class="hint">Ingen påmindelser endnu. Tryk på en knap herunder for at lave en.</li>';
  }
  const dlgPaamind = $('#dlg-paamind'), formPaamind = $('#form-paamind');
  let editingReminder = null;
  function applyHver() { $('#paamind-start-wrap').hidden = formPaamind.hver.value === '1'; }
  formPaamind.hver.addEventListener('change', applyHver);
  function openReminder(r) {
    editingReminder = r.id ? r : null;
    $('#dlg-paamind-title').textContent = r.id ? 'Ret påmindelse' : 'Ny påmindelse';
    formPaamind.slags.value = r.slags;
    formPaamind.tekst.value = r.tekst || '';
    formPaamind.tid.value = String(r.tid).slice(0, 5);
    formPaamind.hver.value = String(r.hver);
    if (!formPaamind.hver.value) formPaamind.hver.value = '1';
    formPaamind.start_dato.value = r.start_dato;
    formPaamind.aktiv.checked = r.aktiv !== false;
    $('#btn-paamind-delete').hidden = !r.id;
    applyHver();
    dlgPaamind.showModal();
  }
  $('#btn-paamind-medicin').addEventListener('click', () => openReminder({ slags: 'medicin', tid: '08:00', hver: 1, start_dato: isoDate(new Date()) }));
  $('#btn-paamind-aeske').addEventListener('click', () => openReminder({ slags: 'doseringsaeske', tid: '10:00', hver: 14, start_dato: nextSunday() }));
  dlgPaamind.addEventListener('close', async () => {
    if (dlgPaamind.returnValue !== 'save') return;
    const f = formPaamind, hver = Number(f.hver.value) || 1;
    try {
      await Store.saveReminder({
        id: editingReminder?.id, slags: f.slags.value, tekst: f.tekst.value.trim(), tid: f.tid.value,
        hver, start_dato: hver === 1 ? isoDate(new Date()) : (f.start_dato.value || isoDate(new Date())), aktiv: f.aktiv.checked,
      });
      toast('Påmindelsen er gemt');
    } catch (err) { toast('Kunne ikke gemme påmindelsen: ' + err.message); }
    fillReminders();
  });
  $('#btn-paamind-delete').addEventListener('click', async () => {
    if (!editingReminder || !confirm('Slette denne påmindelse?')) return;
    dlgPaamind.close();
    try { await Store.deleteReminder(editingReminder.id); toast('Påmindelsen er slettet'); }
    catch (err) { toast('Kunne ikke slette: ' + err.message); }
    fillReminders();
  });
  $('#paamind-list').addEventListener('click', e => {
    const id = e.target.dataset.edit;
    if (id) openReminder(reminders.find(r => r.id === id));
  });
  $('#paamind-list').addEventListener('change', async e => {
    const id = e.target.dataset.toggle;
    const r = id && reminders.find(x => x.id === id);
    if (!r) return;
    try { await Store.saveReminder({ ...r, aktiv: e.target.checked }); toast(e.target.checked ? 'Slået til' : 'Slået fra'); }
    catch (err) { toast('Kunne ikke gemme: ' + err.message); }
    fillReminders();
  });
  $('#btn-paamind-test').addEventListener('click', async () => {
    const btn = $('#btn-paamind-test'); btn.disabled = true;
    try {
      const n = await Store.testPush();
      toast(n ? 'Prøven er sendt. Den kommer om et øjeblik.' : 'Ingen telefoner fik prøven. Slå først push-beskeder til under Mere → Push-beskeder.');
    } catch (err) { toast('Kunne ikke sende prøven: ' + err.message); }
    btn.disabled = false;
  });

  // ---------- udseende (farvetema, gemmes kun på denne enhed) ----------
  const THEMES = { hav: '#0f3a4f', skov: '#17321f', hjerte: '#5c1427', skumring: '#1f1d55' };
  function applyTheme(t) {
    if (!THEMES[t]) t = 'hav';
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]').content = THEMES[t];
    document.querySelectorAll('[data-theme-pick]').forEach(b => b.classList.toggle('active', b.dataset.themePick === t));
  }
  let savedTheme = 'hav';
  try { savedTheme = localStorage.getItem('vores-medicin-tema') || 'hav'; } catch {}
  applyTheme(savedTheme);
  document.querySelectorAll('[data-theme-pick]').forEach(b => b.addEventListener('click', () => {
    applyTheme(b.dataset.themePick);
    try { localStorage.setItem('vores-medicin-tema', b.dataset.themePick); } catch {}
  }));

  function fillSettings() {
    fillReminders();
    fillCtrFields();
    fillFuldmagt();
    showPushStatus();
    $('#remind-days').value = Store.settings.remindDays;
  }
  $('#btn-save-settings').addEventListener('click', () => {
    saved(Store.saveSettings({ remindDays: Math.max(1, Number($('#remind-days').value) || 10) }));
    renderList();
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
    $('#btn-change-pw').hidden = false;
  }
  // Godmorgen / god formiddag / ... alt efter tidspunktet
  async function showGreeting() {
    const h = new Date().getHours();
    const g = h < 5 ? 'Godnat' : h < 9 ? 'Godmorgen' : h < 12 ? 'God formiddag' : h < 13 ? 'God middag'
      : h < 18 ? 'God eftermiddag' : h < 23 ? 'Godaften' : 'Godnat';
    const name = await Store.userName();
    $('#greeting').textContent = name ? `${g}, ${name}` : g;
    if (window.dagens) $('#dagens').textContent = window.dagens();
  }
  function showApp(on) {
    if (on) showGreeting();
    $('#login').hidden = on;
    document.querySelector('header.top').hidden = !on;
    document.querySelector('main').hidden = !on;
    document.querySelector('.bottombar').hidden = !on;
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
  // Glemt adgangskode: send en mail med link til at vælge en ny
  $('#btn-forgot').addEventListener('click', async () => {
    const email = $('#form-login').email.value.trim();
    if (!email) { $('#login-msg').textContent = 'Skriv din e-mail først, og tryk så "Glemt adgangskode?" igen.'; return; }
    $('#btn-forgot').disabled = true;
    try {
      await Store.resetPassword(email);
      $('#login-msg').textContent = 'Tjek din e-mail. Tryk på linket i mailen for at vælge en ny adgangskode. Kig også i spam.';
    } catch (err) {
      $('#login-msg').textContent = 'Kunne ikke sende mailen: ' + (err.message || err);
    } finally { $('#btn-forgot').disabled = false; }
  });

  // Skift adgangskode (fra Mere, eller efter linket i mailen)
  const dlgPw = $('#dlg-pw'), formPw = $('#form-pw');
  function openPw() { formPw.reset(); $('#pw-msg').textContent = ''; dlgPw.showModal(); }
  $('#btn-change-pw').addEventListener('click', openPw);
  $('#btn-pw-cancel').addEventListener('click', () => dlgPw.close());
  formPw.addEventListener('submit', async e => {
    e.preventDefault();
    if (formPw.pw1.value !== formPw.pw2.value) { $('#pw-msg').textContent = 'De to adgangskoder er ikke ens.'; return; }
    try {
      await Store.changePassword(formPw.pw1.value);
      dlgPw.close(); toast('Din nye adgangskode er gemt');
    } catch (err) { $('#pw-msg').textContent = err.message || 'Kunne ikke gemme adgangskoden.'; }
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
    // FMK-data lægges på den liste, der vises (ens egen eller en man har fuldmagt til)
    const owner = Store.viewOwner;
    const res = { updated: 0, added: [], empty: [], ctr: null, who: Store.nameOf(owner) };

    if (data.ctr && data.ctr.saldo != null) {
      Store.saveCtr(owner, { saldo: data.ctr.saldo, periodEnd: data.ctr.periodEnd || '', updatedOn: new Date().toISOString().slice(0, 10) });
      res.ctr = Store.ctrOf(owner);
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
      if (pick.varenr) fields.varenr = pick.varenr;
      const existing = Store.meds.find(m => (m.owner || '') === owner && normName(m.name) === k && m.kind !== 'handkob');
      if (existing) {
        Store.upsertMed({ id: existing.id, ...fields });
        res.updated++;
      } else if (open.length) {
        Store.upsertMed({
          name: pick.name, strength: [pick.styrke, pick.form && pick.form.toLowerCase()].filter(Boolean).join(' '),
          owner, kind: 'recept', status: 'hentet', tilskud: true,
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
    if (res.who) lines.push(`Opdateret for ${res.who}.`);
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
    $('#fmk-wait').hidden = false;
    window.addEventListener('message', e => {
      if (e.origin !== FMK_ORIGIN) return;
      const res = applyFmk(e.data);
      if (res) {
        $('#fmk-wait').hidden = true; opener.postMessage('fmk-done', FMK_ORIGIN); showFmkResult(res); clearInterval(ping);
        // Hent dagens priser fra medicinpriser.dk med det samme (ellers sker det hver morgen)
        const url = (window.MEDICIN_CONFIG || {}).supabaseUrl;
        if (url) setTimeout(() => fetch(url + '/functions/v1/opdater-priser', { method: 'POST', body: '{}', mode: 'no-cors' })
          .then(() => Store.refresh()).then(renderList).catch(() => {}), 3000);
      }
    });
    const ping = setInterval(() => { try { opener.postMessage('fmk-ready', FMK_ORIGIN); } catch { clearInterval(ping); } }, 1000);
    setTimeout(() => {
      clearInterval(ping);
      if (!$('#fmk-wait').hidden) { $('#fmk-wait').hidden = true; toast('Fik ikke noget fra FMK. Prøv at trykke på bogmærket igen.'); }
    }, 5 * 60000);
  }

  // Bogmærket bygges ud fra fmk-hent.js
  async function fillFmkBookmark() {
    try {
      const code = await (await fetch('fmk-hent.js', { cache: 'no-store' })).text();
      const body = code.replace(/^\s*\/\/.*$/gm, '');
      $('#fmk-bookmark').href = 'javascript:' + encodeURIComponent(body);
    } catch { /* uden net */ }
  }
  $('#fmk-bookmark').addEventListener('click', e => { e.preventDefault(); toast('Knappen virker ikke herinde. Træk den op i bogmærkelinjen, og tryk på den der, mens du er logget ind på fmk-online.dk.'); });

  // ---------- start ----------
  (async () => {
    const res = await Store.init({ onChange: rerenderAll, onError: toast });
    fillFmkBookmark();
    if (res.needsLogin) { showApp(false); return; }
    showApp(true);
    rerenderAll();
    showSyncStatus();
    startFmkImport();
    if (Store.recovery) openPw();
  })();
  // Hent det nyeste, når man vender tilbage til appen
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    if (!$('#login').hidden) return;
    showGreeting();
    renderList();
    await Store.refresh();
  });
})();
