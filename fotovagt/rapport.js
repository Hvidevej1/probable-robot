// Indsatsrapport for kontoret: hvilke hændelser hver fotograf har kørt på i en periode.
// Kan hentes som PDF (jsPDF, indlæses først når den skal bruges) og som CSV, der åbner i Excel.
import { store } from './store.js';
import { esc, $, toast, prøv } from './faelles.js';

const dk = { timeZone: 'Europe/Copenhagen' };
const dato = iso => iso ? new Date(iso).toLocaleDateString('da-DK', { ...dk, day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const kl = iso => iso ? new Date(iso).toLocaleTimeString('da-DK', { ...dk, hour: '2-digit', minute: '2-digit' }) : '';
const ymd = d => new Intl.DateTimeFormat('sv-SE', dk).format(d);           // ÅÅÅÅ-MM-DD i dansk tid
const minutter = (a, b) => (a && b) ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60e3)) : null;
const varighed = m => m == null ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} t ${String(m % 60).padStart(2, '0')} min`;
const STATUS = { taget: 'Taget', ankommet: 'Ankommet', afsluttet: 'Afsluttet', annulleret: 'Annulleret', ny: 'Ny' };

// Starten af en dag i dansk tid som tidspunkt (håndterer sommer-/vintertid)
function dagStart(d) {
  const [y, m, dd] = d.split('-').map(Number);
  const gæt = new Date(Date.UTC(y, m - 1, dd, 0, 0));
  const vist = new Date(gæt.toLocaleString('en-US', dk));
  const forskel = vist - new Date(gæt.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(gæt.getTime() - forskel);
}
const næsteDag = d => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };

// Faste perioder
function periode(navn) {
  const i = ymd(new Date()), t = new Date(i + 'T12:00:00Z');
  const flyt = n => { const x = new Date(t); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const ugedag = (t.getUTCDay() + 6) % 7;   // mandag = 0
  const mdStart = i.slice(0, 8) + '01';
  const sidsteMd = (() => { const x = new Date(mdStart + 'T12:00:00Z'); x.setUTCDate(0); return x.toISOString().slice(0, 10); })();
  return {
    idag: [i, i], igaar: [flyt(-1), flyt(-1)],
    uge: [flyt(-ugedag), i], sidsteuge: [flyt(-ugedag - 7), flyt(-ugedag - 1)],
    maaned: [mdStart, i], sidstemaaned: [sidsteMd.slice(0, 8) + '01', sidsteMd],
    aar: [i.slice(0, 4) + '-01-01', i],
  }[navn];
}

let data = null;   // { fra, til, grupper: [{ p, rækker, sum }] }

async function byg(fra, til, foto) {
  const { haendelser, kommentarer } = await store.fotografRapport(dagStart(fra).toISOString(), dagStart(næsteDag(til)).toISOString());
  const navn = id => store.state.profiler.find(p => p.id === id)?.navn || 'Ukendt fotograf';
  const grupper = new Map();
  for (const h of haendelser) {
    if (!h.taget_af || (foto && h.taget_af !== foto)) continue;
    const egne = kommentarer.filter(k => k.haendelse_id === h.id && k.bruger === h.taget_af).map(k => k.tekst);
    const slut = h.afsluttet_tid || null;
    const r = {
      h, dato: dato(h.oprettet), kl: kl(h.oprettet), titel: h.titel || '', kategori: h.kategori || 'Andet',
      sted: h.adresse || '', taget: kl(h.taget_tid), ankommet: kl(h.ankommet_tid), afsluttet: kl(slut),
      min: minutter(h.taget_tid, slut), status: h.auto_lukket ? 'Lukket automatisk' : (STATUS[h.status] || h.status),
      note: [h.note, ...egne].filter(Boolean).join(' · '),
    };
    if (!grupper.has(h.taget_af)) grupper.set(h.taget_af, { id: h.taget_af, navn: navn(h.taget_af), rækker: [] });
    grupper.get(h.taget_af).rækker.push(r);
  }
  // Alle fotografer kommer med, også nye og dem uden opgaver i perioden
  if (!foto) for (const p of store.state.profiler.filter(p => p.rolle === 'foto')) {
    if (!grupper.has(p.id)) grupper.set(p.id, { id: p.id, navn: p.navn, rækker: [] });
  }
  const liste = [...grupper.values()].map(g => {
    g.rækker.sort((a, b) => a.h.oprettet.localeCompare(b.h.oprettet));
    const medTid = g.rækker.filter(r => r.min != null);
    const min = medTid.length ? medTid.reduce((s, r) => s + r.min, 0) : null;
    g.sum = { antal: g.rækker.length, ankommet: g.rækker.filter(r => r.h.ankommet_tid).length,
      afsluttet: g.rækker.filter(r => r.h.status === 'afsluttet').length, min };
    return g;
  }).sort((a, b) => b.sum.antal - a.sum.antal || a.navn.localeCompare(b.navn, 'da'));
  data = { fra, til, foto, grupper: liste, lavet: new Date() };
  return data;
}

const TITEL = 'Indsatsrapport', UNDERTITEL = 'Opgaver pr. fotograf';
const periodeTekst = d => d.fra === d.til ? dato(dagStart(d.fra).toISOString()) : `${dato(dagStart(d.fra).toISOString())} – ${dato(dagStart(d.til).toISOString())}`;
const nøgletal = d => {
  const aktive = d.grupper.filter(g => g.sum.antal);
  const min = aktive.reduce((s, g) => s + (g.sum.min || 0), 0);
  return { antal: aktive.reduce((s, g) => s + g.sum.antal, 0), fotografer: aktive.length, i_alt: d.grupper.length,
    ankommet: aktive.reduce((s, g) => s + g.sum.ankommet, 0), min: aktive.some(g => g.sum.min != null) ? min : null };
};

function visning(d) {
  const n = nøgletal(d);
  if (!d.grupper.length) return '<p class="tom-rapport">Der er ingen fotografer endnu.</p>';
  return `
    <div class="rapport-hoved">
      <img src="icon-192.png" alt="" width="40" height="40">
      <div><b>${TITEL}</b><span>${UNDERTITEL} · ${periodeTekst(d)}</span></div>
    </div>
    <div class="rapport-kpi">
      <div><b>${n.antal}</b><span>hændelser</span></div>
      <div><b>${n.fotografer}<small> af ${n.i_alt}</small></b><span>fotografer kørte</span></div>
      <div><b>${n.ankommet}</b><span>ankommet på stedet</span></div>
      <div><b>${varighed(n.min) || '–'}</b><span>tid på opgaver</span></div>
    </div>
    <table class="rapport-tabel oversigt">
      <thead><tr><th>Fotograf</th><th>Hændelser</th><th>Ankommet</th><th>Afsluttet</th><th>Tid på opgaver</th></tr></thead>
      <tbody>${d.grupper.map(g => `<tr class="${g.sum.antal ? '' : 'nul'}"><td>${g.sum.antal ? `<a href="#r-${g.id}">${esc(g.navn)}</a>` : esc(g.navn)}</td><td>${g.sum.antal}</td><td>${g.sum.ankommet}</td><td>${g.sum.afsluttet}</td><td>${varighed(g.sum.min) || '–'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>I alt</td><td>${n.antal}</td><td>${n.ankommet}</td><td colspan="2"></td></tr></tfoot>
    </table>
    ${d.grupper.filter(g => g.sum.antal).map(g => `
      <h3 class="rapport-navn" id="r-${g.id}">${esc(g.navn)} <small>${g.sum.antal} hændelse${g.sum.antal === 1 ? '' : 'r'} · ${varighed(g.sum.min) || '–'}</small></h3>
      <div class="rapport-rul"><table class="rapport-tabel">
        <thead><tr><th>Dato</th><th>Kl.</th><th>Hændelse</th><th>Sted</th><th>Taget</th><th>Ankom</th><th>Slut</th><th>Tid</th><th>Status</th></tr></thead>
        <tbody>${g.rækker.map(r => `<tr>
          <td>${r.dato}</td><td>${r.kl}</td><td><b>${esc(r.titel)}</b><br><small>${esc(r.kategori)}${r.note ? ` · ${esc(r.note)}` : ''}</small></td>
          <td>${esc(r.sted)}</td><td>${r.taget}</td><td>${r.ankommet}</td><td>${r.afsluttet}</td><td>${varighed(r.min)}</td><td>${esc(r.status)}</td></tr>`).join('')}</tbody>
      </table></div>`).join('')}
    ${n.antal ? '' : '<p class="tom-rapport">Ingen fotografer har kørt på hændelser i perioden.</p>'}`;
}

// ---------- PDF ----------
let pdfKlar = null;
function hentScript(src) {
  return new Promise((ok, fejl) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fejl(new Error('PDF-værktøjet kunne ikke hentes.')); document.head.append(s); });
}
const indlæsPdf = () => pdfKlar ||= hentScript('vendor/jspdf-2.5.2/jspdf.umd.min.js').then(() => hentScript('vendor/jspdf-2.5.2/jspdf.plugin.autotable.min.js'));
const filnavn = (d, ext) => `indsatsrapport_${d.fra}${d.fra === d.til ? '' : '_til_' + d.til}.${ext}`;
// Standardskrifterne i PDF kan ikke vise emojis
const ren = s => String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim();
async function billede(src) {
  const r = await fetch(src); const b = await r.blob();
  return new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); });
}
const KAT_FARVE = { Brand: [255, 90, 31], Trafik: [232, 52, 58], Politi: [47, 111, 228], Redning: [245, 158, 11], Miljø: [22, 163, 74], Vejr: [14, 165, 233], Forsyning: [139, 92, 246], Andet: [140, 140, 150] };

async function lavPdf(d) {
  await indlæsPdf();
  const logo = await billede('hrc-fotos-logo.png').catch(() => null);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `${TITEL} ${periodeTekst(d)}`, author: 'HRC-Fotos', creator: 'Fotovagt' });
  const B = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;
  const mørk = [28, 28, 33], tekst = [18, 23, 34], grå = [91, 101, 118], lys = [244, 246, 249], kant = [225, 230, 238], accent = [47, 128, 255];
  const farver = [[31, 159, 76], [47, 128, 255], [232, 52, 58], [255, 194, 26]];
  // Sidehoved: mørkt bånd med logo, titel og periode + logoets fire farver som en tynd stribe
  const top = () => {
    doc.setFillColor(...mørk); doc.rect(0, 0, B, 22, 'F');
    farver.forEach((f, i) => { doc.setFillColor(...f); doc.rect(i * B / 4, 22, B / 4, 1.2, 'F'); });
    if (logo) doc.addImage(logo, 'PNG', M, 4.5, 26.4, 13.6, 'hrclogo', 'FAST');
    const x = M + (logo ? 32 : 0);
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(TITEL, x, 11.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(185, 188, 198);
    doc.text(UNDERTITEL, x, 16.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255);
    doc.text(periodeTekst(d), B - M, 11.5, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(185, 188, 198);
    doc.text(`Lavet ${dato(d.lavet.toISOString())} kl. ${kl(d.lavet.toISOString())}`, B - M, 16.5, { align: 'right' });
  };
  top();
  let y = 31;
  // Nøgletal som fire kort
  const n = nøgletal(d);
  const kort = [[String(n.antal), 'hændelser'], [`${n.fotografer} af ${n.i_alt}`, 'fotografer kørte'], [String(n.ankommet), 'ankommet på stedet'], [varighed(n.min) || '–', 'tid på opgaver']];
  const kb = (B - 2 * M - 3 * 5) / 4;
  kort.forEach(([tal, navn], i) => {
    const x = M + i * (kb + 5);
    doc.setFillColor(...lys); doc.setDrawColor(...kant); doc.roundedRect(x, y, kb, 19, 2.5, 2.5, 'FD');
    doc.setFillColor(...farver[i]); doc.rect(x, y + 3, 1.2, 13, 'F');
    doc.setTextColor(...tekst); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(tal, x + 6, y + 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...grå); doc.text(navn, x + 6, y + 15.5);
  });
  y += 27;
  const fælles = {
    theme: 'plain', margin: { left: M, right: M, top: 30, bottom: 14 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 2, bottom: 2, left: 2.2, right: 2.2 }, textColor: tekst, overflow: 'linebreak', lineColor: kant },
    headStyles: { fillColor: mørk, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    bodyStyles: { lineWidth: { bottom: 0.2 } },
    didDrawPage: () => top(),
  };
  doc.setTextColor(...tekst); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Oversigt', M, y); y += 2.5;
  doc.autoTable({
    ...fælles, startY: y,
    head: [['Fotograf', 'Hændelser', 'Ankommet', 'Afsluttet', 'Tid på opgaver']],
    body: d.grupper.map(g => [ren(g.navn), g.sum.antal, g.sum.ankommet, g.sum.afsluttet, varighed(g.sum.min) || '–']),
    foot: [['I alt', n.antal, n.ankommet, '', varighed(n.min) || '–']],
    footStyles: { fillColor: lys, textColor: tekst, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 80 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    tableWidth: 190,
    didParseCell: c => {
      if (c.column.index > 0) c.cell.styles.halign = 'right';
      if (c.section === 'body' && !d.grupper[c.row.index].sum.antal) c.cell.styles.textColor = [160, 166, 178];
    },
  });
  y = doc.lastAutoTable.finalY + 10;
  for (const g of d.grupper.filter(g => g.sum.antal)) {
    if (y > H - 40) { doc.addPage(); y = 31; }
    // Fotografens bånd
    doc.setFillColor(...lys); doc.roundedRect(M, y - 5.5, B - 2 * M, 9, 2, 2, 'F');
    doc.setFillColor(...accent); doc.rect(M, y - 5.5, 1.4, 9, 'F');
    doc.setTextColor(...tekst); doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5);
    doc.text(ren(g.navn), M + 5, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...grå);
    doc.text(`${g.sum.antal} hændelse${g.sum.antal === 1 ? '' : 'r'}   ·   ${g.sum.ankommet} ankommet   ·   ${g.sum.afsluttet} afsluttet   ·   tid på opgaver ${varighed(g.sum.min) || '–'}`, B - M - 3, y, { align: 'right' });
    doc.autoTable({
      ...fælles, startY: y + 5,
      head: [['', 'Dato', 'Kl.', 'Hændelse', 'Sted', 'Taget', 'Ankom.', 'Slut', 'Tid', 'Status', 'Note / kommentarer']],
      body: g.rækker.map(r => ['', r.dato, r.kl, `${ren(r.titel)}\n${r.kategori}`, ren(r.sted), r.taget, r.ankommet, r.afsluttet, varighed(r.min), r.status, ren(r.note)]),
      columnStyles: { 0: { cellWidth: 2.5, cellPadding: 0 }, 1: { cellWidth: 19 }, 2: { cellWidth: 13 }, 3: { cellWidth: 56 }, 4: { cellWidth: 48 },
        5: { cellWidth: 13 }, 6: { cellWidth: 15 }, 7: { cellWidth: 13 }, 8: { cellWidth: 17 }, 9: { cellWidth: 22 } },
      // Farvet streg i kategoriens farve foran hver hændelse
      didDrawCell: c => {
        if (c.section !== 'body' || c.column.index !== 0) return;
        doc.setFillColor(...(KAT_FARVE[g.rækker[c.row.index].kategori] || KAT_FARVE.Andet));
        doc.rect(c.cell.x, c.cell.y + 0.6, 1.4, c.cell.height - 1.2, 'F');
      },
    });
    y = doc.lastAutoTable.finalY + 12;
  }
  if (!n.antal) { doc.setTextColor(...grå); doc.setFontSize(10); doc.text('Ingen fotografer har kørt på hændelser i perioden.', M, y + 2); }
  const sider = doc.internal.getNumberOfPages();
  for (let i = 1; i <= sider; i++) {
    doc.setPage(i); doc.setDrawColor(...kant); doc.line(M, H - 10, B - M, H - 10);
    doc.setFontSize(7.5); doc.setTextColor(...grå); doc.setFont('helvetica', 'normal');
    doc.text('© HRC-Fotos.dk · Fotovagt · Intern rapport – indeholder adresser', M, H - 6);
    doc.text(`Side ${i} af ${sider}`, B - M, H - 6, { align: 'right' });
  }
  doc.save(filnavn(d, 'pdf'));
}

// ---------- CSV (Excel) ----------
function lavCsv(d) {
  const felt = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const linjer = [['Fotograf', 'Dato', 'Kl.', 'Hændelse', 'Kategori', 'Sted', 'Taget', 'Ankommet', 'Afsluttet', 'Minutter', 'Status', 'Note / kommentarer']];
  for (const g of d.grupper) for (const r of g.rækker) linjer.push([g.navn, r.dato, r.kl, r.titel, r.kategori, r.sted, r.taget, r.ankommet, r.afsluttet, r.min ?? '', r.status, r.note]);
  const tekst = '﻿' + linjer.map(l => l.map(felt).join(';')).join('\r\n');   // BOM, så Excel læser æøå rigtigt
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([tekst], { type: 'text/csv;charset=utf-8' }));
  a.download = filnavn(d, 'csv'); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Dialog ----------
export function åbnRapport() {
  let dlg = $('#dlg-rapport');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'dlg-rapport'; dlg.className = 'ark bred rapport-dialog';
    dlg.innerHTML = `
      <div class="ark-indhold">
        <div class="ark-top"><h2>📄 Indsatsrapport</h2><button class="luk" data-luk-rapport aria-label="Luk">✕</button></div>
        <p class="hint">Hvilke hændelser hver fotograf har kørt på i en periode. Hent den som PDF, eller som CSV til Excel.</p>
        <div class="rapport-perioder">
          <button type="button" class="secondary" data-periode="idag">I dag</button>
          <button type="button" class="secondary" data-periode="igaar">I går</button>
          <button type="button" class="secondary" data-periode="uge">Denne uge</button>
          <button type="button" class="secondary" data-periode="sidsteuge">Sidste uge</button>
          <button type="button" class="secondary" data-periode="maaned">Denne måned</button>
          <button type="button" class="secondary" data-periode="sidstemaaned">Sidste måned</button>
          <button type="button" class="secondary" data-periode="aar">I år</button>
        </div>
        <form class="rapport-valg" id="form-rapport">
          <label>Fra <input type="date" name="fra" required></label>
          <label>Til <input type="date" name="til" required></label>
          <label>Fotograf <select name="foto"><option value="">Alle fotografer</option></select></label>
          <button type="submit">Vis rapport</button>
        </form>
        <div class="rapport-knapper" hidden>
          <button type="button" data-pdf>📄 Hent PDF</button>
          <button type="button" class="secondary" data-csv>📊 Hent til Excel (CSV)</button>
        </div>
        <div id="rapport-visning" class="rapport-visning"></div>
      </div>`;
    document.body.append(dlg);
    const f = dlg.querySelector('form');
    const vis = async () => {
      if (f.fra.value > f.til.value) { toast('"Fra" skal være før "Til".', 'fejl'); return; }
      $('#rapport-visning').innerHTML = '<p class="hint">Henter …</p>';
      const ok = await prøv(async () => {
        const d = await byg(f.fra.value, f.til.value, f.foto.value || null);
        $('#rapport-visning').innerHTML = visning(d);
        dlg.querySelector('.rapport-knapper').hidden = !d.grupper.some(g => g.sum.antal);
      });
      if (!ok) $('#rapport-visning').innerHTML = '';
    };
    f.addEventListener('submit', e => { e.preventDefault(); vis(); });
    dlg.addEventListener('click', async e => {
      if (e.target === dlg || e.target.closest('[data-luk-rapport]')) return dlg.close();
      const p = e.target.closest('[data-periode]');
      if (p) { [f.fra.value, f.til.value] = periode(p.dataset.periode); return vis(); }
      if (e.target.closest('[data-pdf]') && data) {
        const b = e.target.closest('[data-pdf]'); b.disabled = true; b.textContent = 'Laver PDF …';
        await prøv(() => lavPdf(data), 'PDF\'en er hentet.');
        b.disabled = false; b.textContent = '📄 Hent PDF';
      }
      if (e.target.closest('[data-csv]') && data) { lavCsv(data); toast('Filen er hentet. Den åbner i Excel.', 'ok'); }
      const a = e.target.closest('a[href^="#r-"]');
      if (a) { e.preventDefault(); dlg.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  }
  const f = dlg.querySelector('form');
  const valgt = f.foto.value;
  f.foto.innerHTML = '<option value="">Alle fotografer</option>' + store.state.profiler
    .filter(p => p.rolle === 'foto').sort((a, b) => a.navn.localeCompare(b.navn, 'da'))
    .map(p => `<option value="${p.id}">${esc(p.navn)}</option>`).join('');
  f.foto.value = valgt;
  if (!f.fra.value) [f.fra.value, f.til.value] = periode('maaned');
  dlg.showModal();
}
