// Beregning af egenbetaling ud fra CTR-saldoen (Det Centrale Tilskudsregister).
// Grænserne gælder voksne over 18 år i 2026 (Lægemiddelstyrelsen).
// Ministeren kan justere dem op til to gange om året, så tjek dem ved årsskiftet.
const CTR = (() => {
  const YEAR = 2026;
  // [fra saldo, tilskud i procent]
  const STEPS = [
    [0, 0],
    [1135, 50],
    [1910, 75],
    [4155, 85],
    [22596, 100],
  ];

  // Egenbetaling for et køb med tilskudspris `price`, når saldoen før købet er `saldo`.
  function copay(price, saldo) {
    price = Number(price) || 0;
    saldo = Math.max(0, Number(saldo) || 0);
    let pay = 0, left = price, pos = saldo;
    for (let i = 0; i < STEPS.length && left > 0; i++) {
      const [from, pct] = STEPS[i];
      const to = i + 1 < STEPS.length ? STEPS[i + 1][0] : Infinity;
      if (pos >= to) continue;
      const part = Math.min(left, to - Math.max(pos, from));
      pay += part * (100 - pct) / 100;
      left -= part; pos += part;
    }
    return Math.round(pay * 100) / 100;
  }

  // Hvor mange procent tilskud man får lige nu
  function currentPct(saldo) {
    let pct = 0;
    for (const [from, p] of STEPS) if (saldo >= from) pct = p;
    return pct;
  }

  function addYear(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setFullYear(d.getFullYear() + 1); d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  const today = () => new Date().toISOString().slice(0, 10);

  // Saldo der gælder i dag (0, hvis perioden er udløbet)
  function activeSaldo(info) {
    if (!info) return 0;
    if (info.periodEnd && info.periodEnd < today()) return 0;
    return Number(info.saldo) || 0;
  }

  // Ny saldo/periode efter et køb til `price`
  function afterPurchase(info, price) {
    info = info || {};
    const expired = !info.periodEnd || info.periodEnd < today();
    if (expired) return { saldo: Number(price) || 0, periodEnd: addYear(today()), updatedOn: today() };
    return { ...info, saldo: Math.round(((Number(info.saldo) || 0) + (Number(price) || 0)) * 100) / 100, updatedOn: today() };
  }

  const kr = n => (Number(n) || 0).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr.';

  return { YEAR, STEPS, copay, currentPct, activeSaldo, afterPurchase, kr };
})();
