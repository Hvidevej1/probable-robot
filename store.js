// Lager for appens data.
// Uden opsætning: alt gemmes i browseren på denne enhed.
// Med Supabase sat op i config.js: listen deles mellem jer, og ændringer
// fra den ene telefon dukker op på den anden med det samme.
const Store = (() => {
  const KEY = 'vores-medicin-v1';
  const cfg = window.MEDICIN_CONFIG || {};
  const cloud = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const sb = cloud ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'vores-medicin-login' },
  }) : null;

  const empty = () => ({
    settings: { people: ['Mig', 'Min kone'], remindDays: 10 },
    meds: [],
    products: [],
  });

  let data = loadLocal();
  let hooks = { onChange() {}, onError() {} };
  let channel = null;

  function loadLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const parsed = JSON.parse(raw);
      return { ...empty(), ...parsed, settings: { ...empty().settings, ...(parsed.settings || {}) } };
    } catch {
      return empty();
    }
  }
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
  }

  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---- oversættelse mellem appen og databasens kolonner ----
  const medToRow = m => ({
    id: m.id, name: m.name, strength: m.strength || null, person: m.person || null, kind: m.kind || 'recept',
    status: m.status || 'bestil', runs_out: m.runsOut || null, note: m.note || null, created: m.created, updated: m.updated,
  });
  const rowToMed = r => ({
    id: r.id, name: r.name, strength: r.strength || '', person: r.person || '', kind: r.kind, status: r.status,
    runsOut: r.runs_out || '', note: r.note || '', created: r.created, updated: r.updated,
  });
  const prodToRow = p => ({ id: p.id, name: p.name, strength: p.strength || null, pack: p.pack || null, price: p.price || null, varenr: p.varenr || null, ean: p.ean || null });
  const rowToProd = r => ({ id: r.id, name: r.name, strength: r.strength || '', pack: r.pack || '', price: r.price || '', varenr: r.varenr || '', ean: r.ean || '' });

  // Sender en ændring til databasen i baggrunden
  function push(promise, what) {
    if (!cloud) return;
    promise.then(({ error }) => { if (error) hooks.onError(`Kunne ikke gemme ${what} i den fælles liste: ${error.message}`); })
      .catch(() => hooks.onError(`Ingen forbindelse. ${what} blev ikke gemt i den fælles liste.`));
  }

  async function fetchAll(table) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error } = await sb.from(table).select('*').range(from, from + 999);
      if (error) throw error;
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  }

  async function loadCloud() {
    const [meds, products, settings] = await Promise.all([
      fetchAll('meds'), fetchAll('products'), sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (settings.error) throw settings.error;
    data.meds = meds.map(rowToMed);
    data.products = products.map(rowToProd);
    if (settings.data) data.settings = { people: settings.data.people || data.settings.people, remindDays: settings.data.remind_days ?? 10 };
    saveLocal();
    hooks.onChange();
  }

  function listen() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('faelles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meds' }, ev => {
        if (ev.eventType === 'DELETE') data.meds = data.meds.filter(m => m.id !== ev.old.id);
        else {
          const m = rowToMed(ev.new), i = data.meds.findIndex(x => x.id === m.id);
          if (i >= 0) data.meds[i] = m; else data.meds.push(m);
        }
        saveLocal(); hooks.onChange();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, ev => {
        if (ev.eventType === 'DELETE') data.products = data.products.filter(p => p.id !== ev.old.id);
        else {
          const p = rowToProd(ev.new), i = data.products.findIndex(x => x.id === p.id);
          if (i >= 0) data.products[i] = p; else data.products.push(p);
        }
        saveLocal(); hooks.onChange();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, ev => {
        if (ev.new) data.settings = { people: ev.new.people, remindDays: ev.new.remind_days };
        saveLocal(); hooks.onChange();
      })
      .subscribe();
  }

  return {
    cloud,
    get settings() { return data.settings; },
    get meds() { return data.meds; },
    get products() { return data.products; },

    // Starter lageret. Returnerer { needsLogin: true }, hvis man skal logge ind først.
    async init(h) {
      hooks = { ...hooks, ...h };
      if (!cloud) return { needsLogin: false };
      const { data: s } = await sb.auth.getSession();
      if (!s.session) return { needsLogin: true };
      try { await loadCloud(); listen(); }
      catch (e) { hooks.onError('Kunne ikke hente den fælles liste. Viser den sidst gemte.'); }
      return { needsLogin: false, email: s.session.user.email };
    },
    async login(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Forkert e-mail eller adgangskode.' : error.message);
      await loadCloud(); listen();
    },
    async logout() {
      if (channel) sb.removeChannel(channel);
      await sb.auth.signOut();
      data = empty(); localStorage.removeItem(KEY);
    },
    async refresh() { if (cloud) { try { await loadCloud(); } catch { /* bruger det gemte */ } } },
    async userEmail() { if (!cloud) return null; const { data: s } = await sb.auth.getSession(); return s.session?.user.email || null; },

    saveSettings(s) {
      data.settings = { ...data.settings, ...s };
      if (cloud) push(sb.from('settings').upsert({ id: 1, people: data.settings.people, remind_days: data.settings.remindDays }), 'indstillingerne');
      return saveLocal();
    },

    upsertMed(med) {
      const now = new Date().toISOString();
      let full;
      if (med.id) {
        const i = data.meds.findIndex(m => m.id === med.id);
        if (i < 0) return false;
        full = data.meds[i] = { ...data.meds[i], ...med, updated: now };
      } else {
        full = { ...med, id: id(), created: now, updated: now };
        data.meds.push(full);
      }
      if (cloud) push(sb.from('meds').upsert(medToRow(full)), full.name);
      return saveLocal();
    },
    deleteMed(medId) {
      data.meds = data.meds.filter(m => m.id !== medId);
      if (cloud) push(sb.from('meds').delete().eq('id', medId), 'sletningen');
      return saveLocal();
    },

    // Tilføjer/opdaterer produkter. Matcher på varenummer, ellers stregkode, ellers navn+styrke.
    mergeProducts(list) {
      const keyOf = p => p.varenr ? 'v:' + p.varenr : p.ean ? 'e:' + p.ean : 'n:' + (p.name + '|' + (p.strength || '')).toLowerCase();
      const index = new Map(data.products.map((p, i) => [keyOf(p), i]));
      let added = 0, updated = 0;
      const changed = [];
      for (const p of list) {
        const k = keyOf(p);
        if (index.has(k)) {
          const i = index.get(k);
          data.products[i] = { ...data.products[i], ...p, id: data.products[i].id };
          changed.push(data.products[i]); updated++;
        } else {
          const np = { ...p, id: id() };
          index.set(k, data.products.length); data.products.push(np); changed.push(np); added++;
        }
      }
      if (cloud) {
        for (let i = 0; i < changed.length; i += 500) {
          push(sb.from('products').upsert(changed.slice(i, i + 500).map(prodToRow)), 'produkterne');
        }
      }
      const ok = saveLocal();
      return { added, updated, ok };
    },

    exportJSON() { return JSON.stringify(data, null, 2); },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.meds)) throw new Error('Filen ligner ikke en kopi fra appen.');
      data = { ...empty(), ...parsed, settings: { ...empty().settings, ...(parsed.settings || {}) } };
      if (cloud) {
        if (data.meds.length) push(sb.from('meds').upsert(data.meds.map(medToRow)), 'medicinen');
        for (let i = 0; i < data.products.length; i += 500) push(sb.from('products').upsert(data.products.slice(i, i + 500).map(prodToRow)), 'produkterne');
        push(sb.from('settings').upsert({ id: 1, people: data.settings.people, remind_days: data.settings.remindDays }), 'indstillingerne');
      }
      return saveLocal();
    },
  };
})();
