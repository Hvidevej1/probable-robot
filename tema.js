// Farvetema. Indlæses i <head>, så farverne er på plads, før siden vises.
// "Årets gang" skifter selv efter dato: årstider og højtider.
(() => {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Påskedag (gregoriansk kalender)
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const SEASONS = {
    jul:       { emoji: '🎄', label: 'Glædelig jul' },
    nytaar:    { emoji: '✨', label: 'Godt nytår' },
    vinter:    { emoji: '❄️', label: 'Vinter' },
    fastelavn: { emoji: '🎭', label: 'God fastelavn' },
    paaske:    { emoji: '🐣', label: 'God påske' },
    foraar:    { emoji: '🌸', label: 'Forår' },
    sommer:    { emoji: '☀️', label: 'Sommer' },
    sankthans: { emoji: '🔥', label: 'God sankthans' },
    efteraar:  { emoji: '🍂', label: 'Efterår' },
  };
  function season(now = new Date()) {
    const y = now.getFullYear(), t = iso(now), md = t.slice(5);
    const e = easter(y);
    if (md >= '12-01' && md <= '12-26') return 'jul';
    if (md >= '12-27' || md <= '01-02') return 'nytaar';
    const fast = add(e, -49); // fastelavnssøndag
    if (t >= iso(add(fast, -6)) && t <= iso(fast)) return 'fastelavn';
    if (t >= iso(add(e, -7)) && t <= iso(add(e, 1))) return 'paaske';
    if (md >= '06-21' && md <= '06-24') return 'sankthans';
    const m = now.getMonth() + 1;
    if (m <= 2 || m === 12) return 'vinter';
    if (m <= 5) return 'foraar';
    if (m <= 8) return 'sommer';
    return 'efteraar';
  }
  window.Tema = { season, SEASONS };

  let t = 'skov';
  try { const s = localStorage.getItem('vores-medicin-tema'); if (s && s !== 'hav') t = s; } catch {}
  const root = document.documentElement;
  root.dataset.theme = t;
  root.dataset.season = season();
})();
