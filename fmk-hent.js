// "Send til appen": køres som bogmærke på fmk-online.dk, når man er logget ind.
// Læser kun det, der står på siden (recepter og CTR-saldo), og sender det til
// appen i et nyt vindue. Intet sendes andre steder hen.
(async () => {
  const APP = 'https://vores-medicin.vercel.app';
  if (location.hostname !== 'fmk-online.dk') { alert('Åbn fmk-online.dk og log ind først, og tryk så på knappen igen.'); return; }
  // Appen åbnes i et lille vindue ved siden af, så FMK-fanen bliver i forgrunden.
  // (En fane i baggrunden arbejder meget langsomt i Chrome.)
  const win = window.open(APP + '/#fmk-import', 'vores-medicin', 'popup,width=520,height=820');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => (s || '').replace(/­/g, '').replace(/\s+/g, ' ').trim();
  const iso = d => { const m = /(\d\d)-(\d\d)-(\d{4})/.exec(d || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
  const today = new Date().toISOString().slice(0, 10);
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;background:#2f6f5e;color:#fff;padding:12px 16px;border-radius:10px;font:16px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.3)';
  document.body.appendChild(box);
  const say = t => { box.textContent = t; };
  const tab = name => [...document.querySelectorAll('[role=tab]')].find(t => clean(t.innerText) === name);

  try {
    // CTR-saldo og periode
    say('Henter CTR-saldo…');
    tab('Tilskudsbevillinger')?.click();
    await sleep(2000);
    const txt = clean(document.body.innerText);
    const per = /CTR periode[^0-9]*(\d\d-\d\d-\d{4})\s*[–-]\s*(\d\d-\d\d-\d{4})/.exec(txt);
    const sal = /Saldo\s*([\d.]+(?:,\d+)?)\s*kr/.exec(txt);
    const ctr = sal ? { saldo: Number(sal[1].replace(/\./g, '').replace(',', '.')), periodStart: per ? iso(per[1]) : '', periodEnd: per ? iso(per[2]) : '' } : null;

    // Recepter
    say('Henter recepter…');
    tab('Recepter')?.click();
    await sleep(2500);
    const rows = [...document.querySelectorAll('tr')].filter(t => t.cells.length >= 10 && !t.querySelector('th'));
    const active = rows.filter(t => iso(clean(t.cells[8].innerText)) >= today);
    const recepter = [];
    for (let i = 0; i < active.length; i++) {
      say(`Henter recepter… ${i + 1} af ${active.length}`);
      const t = active[i];
      const c = [...t.cells].map(x => clean(x.innerText));
      const btn = t.cells[t.cells.length - 1].querySelector('[role=button]');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') { btn.click(); await sleep(600); }
      const d = clean(t.nextElementSibling?.innerText);
      recepter.push({
        name: c[0], stof: c[1], styrke: c[3], form: c[4], indikation: c[5], dosering: c[6],
        gyldigTil: iso(c[8]),
        total: Number((/Udleveringer i alt (\d+)/.exec(d) || [])[1] || 0),
        udleveret: Number((/Apoteksudleveringer \((\d+)\)/.exec(d) || [])[1] || 0),
        status: (/Status (.+?) Modtager/.exec(d) || [])[1] || '',
        pakning: (/Pakningsstørrelse (.+?) Antal/.exec(d) || [])[1] || '',
        varenr: (/Varenummer (\d+)/.exec(d) || [])[1] || '',
      });
      if (btn) { btn.click(); await sleep(150); }
    }

    // Send til appen, når den er klar
    say('Sender til appen…');
    const data = { type: 'fmk-data', hentet: new Date().toISOString(), ctr, recepter };
    let sent = false;
    const send = () => { if (!sent && win && !win.closed) { win.postMessage(data, APP); } };
    window.addEventListener('message', e => {
      if (e.origin !== APP) return;
      if (e.data === 'fmk-ready') send();
      if (e.data === 'fmk-done') { sent = true; say('Færdig! Appen er opdateret.'); setTimeout(() => box.remove(), 4000); }
    });
    send();
    setTimeout(() => { if (!sent) say('Appen svarede ikke. Er du logget ind i appen? Prøv igen.'); }, 20000);
  } catch (err) {
    say('Noget gik galt: ' + err.message);
  }
})();
