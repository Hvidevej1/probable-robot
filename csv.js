// Indlæsning af håndkøbsprodukter fra en CSV-fil (regneark gemt som CSV).
// Kolonnenavne genkendes løst, så filer fra forskellige kilder kan bruges.
const ProductCSV = (() => {
  function detectDelimiter(firstLine) {
    const counts = [';', ',', '\t', '|'].map(d => [d, firstLine.split(d).length]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][0];
  }

  function parse(text, delim) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim() !== ''));
  }

  const norm = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9æøå]/g, '');

  // Hvilke kolonnenavne der betyder hvad
  const FIELDS = {
    name: ['navn', 'produktnavn', 'praeparat', 'præparat', 'lægemiddel', 'laegemiddel', 'name', 'produkt', 'handelsnavn'],
    strength: ['styrke', 'strength', 'dosis'],
    form: ['form', 'formtekst', 'laegemiddelform', 'lægemiddelform', 'dosisform'],
    pack: ['pakning', 'pakningsstoerrelse', 'pakningsstørrelse', 'pakningstekst', 'pack', 'antal', 'mængde'],
    price: ['pris', 'aip', 'forbrugerpris', 'udsalgspris', 'price', 'aup', 'prisaup', 'prisinklmoms'],
    varenr: ['varenummer', 'varenr', 'vnr', 'nordicnumber', 'nordicartnr'],
    ean: ['ean', 'stregkode', 'barcode', 'gtin', 'eannummer', 'eankode'],
    otc: ['udlevering', 'udleveringsgruppe', 'udlev'],
  };

  function mapHeaders(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const n = norm(h);
      for (const [field, names] of Object.entries(FIELDS)) {
        if (map[field] !== undefined) continue;
        if (names.some(x => n === norm(x)) || names.some(x => norm(x).length > 3 && n.includes(norm(x)))) {
          map[field] = i; break;
        }
      }
    });
    return map;
  }

  // Returnerer { products, skipped, missingName, onlyOtcFiltered }
  function read(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split('\n', 1)[0];
    const rows = parse(text, detectDelimiter(firstLine));
    if (rows.length < 2) return { products: [], skipped: 0, missingName: true };
    const map = mapHeaders(rows[0]);
    if (map.name === undefined) return { products: [], skipped: rows.length - 1, missingName: true, headers: rows[0] };

    const products = [];
    let skipped = 0, filtered = 0;
    for (const r of rows.slice(1)) {
      const get = f => (map[f] !== undefined ? (r[map[f]] || '').trim() : '');
      const name = get('name');
      if (!name) { skipped++; continue; }
      // Hvis filen har en udleveringsgruppe, behold kun håndkøb (HA, HX, HF)
      const udl = get('otc').toUpperCase();
      if (udl && !udl.startsWith('H')) { filtered++; continue; }
      const strength = [get('strength'), get('form')].filter(Boolean).join(' ');
      products.push({
        name, strength, pack: get('pack'),
        price: get('price').replace(',', '.'),
        varenr: get('varenr').replace(/\D/g, ''),
        ean: get('ean').replace(/\D/g, ''),
      });
    }
    return { products, skipped, filtered };
  }

  return { read };
})();
