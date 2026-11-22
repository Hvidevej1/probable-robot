// Lager for appens data.
// Uden opsætning: alt gemmes i browseren på denne enhed.
// Med Supabase sat op i config.js: listen deles mellem jer, og ændringer
// fra den ene telefon dukker op på den anden med det samme.
const Store = (() => {
  const KEY = 'vores-medicin-v1';
  const cfg = window.MEDICIN_CONFIG || {};
  const cloud = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  // Kom man hertil fra mailen "nulstil adgangskode"? (læses før Supabase rydder adressen)
  const recovery = /type=recovery/.test(location.hash);
  const sb = cloud ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'vores-medicin-login', flowType: 'implicit' },
  }) : null;

  const empty = () => ({
    settings: { people: ['Mig', 'Min kone'], remindDays: 10, ctr: {} },
    meds: [],
    products: [],
    users: [],    // [{ id, name, email }] alle brugere af appen
    grants: [],   // fuldmagter [{ owner, grantee }], hvor man selv er part
    ctr: {},      // CTR pr. ejer-id { saldo, periodEnd, updatedOn, danmark }
  });

  let data = loadLocal();
  let hooks = { onChange() {}, onError() {} };
  let channel = null;
  let currentEmail = null;
  let me = '';          // den indloggedes bruger-id
  let viewOwner = '';   // hvis medicinliste der vises
  const VIEW_KEY = 'vores-medicin-vis';
  let nameCache = null;

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
    id: m.id, name: m.name, strength: m.strength || null, kind: m.kind || 'recept', ...(m.owner ? { owner: m.owner } : {}),
    status: m.status || 'bestil', runs_out: m.runsOut || null, note: m.note || null, created: m.created, updated: m.updated,
    price: m.price === '' || m.price == null ? null : Number(m.price), tilskud: m.tilskud !== false, updated_by: currentEmail,
    recept_udloeb: m.receptUdloeb || null, udleveringer: m.udleveringer === '' || m.udleveringer == null ? null : Number(m.udleveringer),
    varenr: m.varenr || null, tilskudspris: m.tilskudspris === '' || m.tilskudspris == null ? null : Number(m.tilskudspris), pris_opdateret: m.prisOpdateret || null,
    billigst_navn: m.billigstNavn || null, billigst_varenr: m.billigstVarenr || null, billigst_pris: m.billigstPris === '' || m.billigstPris == null ? null : Number(m.billigstPris),
    dosering: m.dosering || null,
  });
  const rowToMed = r => ({
    id: r.id, name: r.name, strength: r.strength || '', owner: r.owner || '', kind: r.kind, status: r.status,
    runsOut: r.runs_out || '', note: r.note || '', created: r.created, updated: r.updated,
    price: r.price ?? '', tilskud: r.tilskud !== false,
    receptUdloeb: r.recept_udloeb || '', udleveringer: r.udleveringer ?? '',
    varenr: r.varenr || '', tilskudspris: r.tilskudspris ?? '', prisOpdateret: r.pris_opdateret || '',
    billigstNavn: r.billigst_navn || '', billigstVarenr: r.billigst_varenr || '', billigstPris: r.billigst_pris ?? '', dosering: r.dosering || '',
  });
  const prodToRow = p => ({ id: p.id, name: p.name, strength: p.strength || null, pack: p.pack || null, price: p.price || null, varenr: p.varenr || null, ean: p.ean || null });
  const rowToProd = r => ({ id: r.id, name: r.name, strength: r.strength || '', pack: r.pack || '', price: r.price || '', varenr: r.varenr || '', ean: r.ean || '' });

  const rowToCtr = r => ({ saldo: r.saldo == null ? null : Number(r.saldo), periodEnd: r.period_end || '', updatedOn: r.updated_on || '', danmark: r.danmark || '' });
  const rowToSettings = r => ({ people: r.people || ['Mig', 'Min kone'], remindDays: r.remind_days ?? 10, ctr: r.ctr || {} });
  const settingsToRow = st => ({ id: 1, people: st.people, remind_days: st.remindDays, ctr: st.ctr || {} });

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
    const [meds, products, settings, ctr, grants, users] = await Promise.all([
      fetchAll('meds'), fetchAll('products'), sb.from('settings').select('*').eq('id', 1).maybeSingle(),
      sb.from('ctr').select('*'), sb.from('fuldmagt').select('owner,grantee'), sb.rpc('app_users'),
    ]);
    if (settings.error) throw settings.error;
    data.meds = meds.map(rowToMed);
    data.products = products.map(rowToProd);
    if (settings.data) data.settings = rowToSettings(settings.data);
    if (!ctr.error) data.ctr = Object.fromEntries(ctr.data.map(r => [r.owner, rowToCtr(r)]));
    if (!grants.error) data.grants = grants.data;
    if (!users.error) data.users = users.data;
    pickView();
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ctr' }, ev => {
        if (ev.new && ev.new.owner) data.ctr[ev.new.owner] = rowToCtr(ev.new);
        saveLocal(); hooks.onChange();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fuldmagt' }, () => { loadCloud().catch(() => {}); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, ev => {
        if (ev.new) data.settings = rowToSettings(ev.new);
        saveLocal(); hooks.onChange();
      })
      .subscribe();
  }

  // Hvem må man se medicin for: en selv + dem, der har givet en fuldmagt
  function owners() {
    if (!cloud) return [{ id: '', name: '' }];
    const ids = [me, ...data.grants.filter(g => g.grantee === me).map(g => g.owner)];
    return [...new Set(ids)].map(id => ({ id, name: nameOf(id) }));
  }
  function nameOf(id) { const u = data.users.find(u => u.id === id); return u ? u.name : ''; }
  function pickView() {
    let saved = ''; try { saved = localStorage.getItem(VIEW_KEY) || ''; } catch { /* ingen lager */ }
    const ids = owners().map(o => o.id);
    viewOwner = ids.includes(viewOwner) ? viewOwner : ids.includes(saved) ? saved : (ids[0] || '');
  }
  async function setMe() {
    const { data: s } = await sb.auth.getSession();
    me = s.session?.user.id || '';
    if (!viewOwner) viewOwner = me;
  }

  return {
    cloud,
    get me() { return me; },
    get users() { return data.users; },
    get grants() { return data.grants; },
    owners, nameOf,
    get viewOwner() { return viewOwner; },
    setViewOwner(id) { viewOwner = id; try { localStorage.setItem(VIEW_KEY, id); } catch { /* ingen lager */ } hooks.onChange(); },
    ctrOf(owner) { return data.ctr[owner] || null; },
    // Gemmer CTR for en ejer (saldo/udløb kun fra FMK; "danmark"-gruppen vælges af brugeren)
    saveCtr(owner, patch) {
      const cur = data.ctr[owner] || {};
      const c = data.ctr[owner] = { ...cur, ...patch };
      if (cloud) push(sb.from('ctr').upsert({ owner, saldo: c.saldo ?? null, period_end: c.periodEnd || null, updated_on: c.updatedOn || null, danmark: c.danmark || '' }), 'CTR-saldoen');
      return saveLocal();
    },
    async grant(grantee) {
      const { error } = await sb.from('fuldmagt').insert({ owner: me, grantee });
      if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
      await loadCloud();
    },
    async revoke(owner, grantee) {
      const { error } = await sb.from('fuldmagt').delete().eq('owner', owner).eq('grantee', grantee);
      if (error) throw new Error(error.message);
      await loadCloud();
    },
    get settings() { return data.settings; },
    get meds() { return data.meds; },
    get products() { return data.products; },

    // Starter lageret. Returnerer { needsLogin: true }, hvis man skal logge ind først.
    async init(h) {
      hooks = { ...hooks, ...h };
      if (!cloud) return { needsLogin: false };
      const { data: s } = await sb.auth.getSession();
      if (!s.session) return { needsLogin: true };
      currentEmail = s.session.user.email;
      await setMe();
      try { await loadCloud(); listen(); }
      catch (e) { hooks.onError('Kunne ikke hente den fælles liste. Viser den sidst gemte.'); }
      return { needsLogin: false, email: s.session.user.email };
    },
    async login(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Forkert e-mail eller adgangskode.' : error.message);
      currentEmail = email.toLowerCase();
      await setMe();
      await loadCloud(); listen();
    },
    async logout() {
      if (channel) sb.removeChannel(channel);
      await sb.auth.signOut();
      nameCache = null; me = ''; viewOwner = '';
      data = empty(); localStorage.removeItem(KEY);
    },
    async refresh() { if (cloud) { try { await loadCloud(); } catch { /* bruger det gemte */ } } },
    recovery,
    // Sender en mail med et link, hvor man kan vælge en ny adgangskode
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/' });
      if (error) throw new Error(error.message);
    },
    async changePassword(pw) {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw new Error(/should be different/i.test(error.message) ? 'Den nye adgangskode skal være forskellig fra den gamle.' : error.message);
    },
    // Fornavn fra brugerens profil i Supabase (sat i databasen, ligger ikke i koden)
    async userName() {
      if (!cloud) return null;
      const { data: s } = await sb.auth.getSession();
      if (!s.session) return null;
      if (!nameCache) {
        try { const { data } = await sb.auth.getUser(); nameCache = data.user?.user_metadata?.name || ''; }
        catch { nameCache = s.session.user.user_metadata?.name || ''; }
      }
      return nameCache || null;
    },
    async userEmail() { if (!cloud) return null; const { data: s } = await sb.auth.getSession(); return s.session?.user.email || null; },

    saveSettings(s) {
      data.settings = { ...data.settings, ...s };
      if (cloud) push(sb.from('settings').upsert(settingsToRow(data.settings)), 'indstillingerne');
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
        full = { owner: viewOwner || undefined, ...med, id: id(), created: now, updated: now };
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

    // Gemmer telefonens adresse til push-beskeder i den fælles database
    async savePushSubscription(sub) {
      if (!cloud) throw new Error('Push-beskeder kræver den fælles liste.');
      const j = sub.toJSON();
      const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, email: currentEmail });
      if (error) throw new Error(error.message);
    },
    async removePushSubscription(endpoint) {
      if (cloud) await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
    },

    // Påmindelser om at tage medicin / fylde doseringsæsken (kun ens egne)
    async reminders() {
      if (!cloud) return [];
      const { data: rows, error } = await sb.from('paamindelser').select('*').eq('user_id', me).order('tid');
      if (error) throw new Error(error.message);
      return rows;
    },
    async saveReminder(r) {
      const row = { slags: r.slags, tekst: r.tekst || null, tid: r.tid, start_dato: r.start_dato, hver: r.hver, aktiv: r.aktiv !== false,
        med_ids: r.med_ids || [], produkt_ids: r.produkt_ids || [] };
      const q = r.id ? sb.from('paamindelser').update(row).eq('id', r.id) : sb.from('paamindelser').insert(row);
      const { error } = await q;
      if (error) throw new Error(error.message);
    },
    async deleteReminder(rid) {
      const { error } = await sb.from('paamindelser').delete().eq('id', rid);
      if (error) throw new Error(error.message);
    },
    // Sender en prøvebesked til ens egne telefoner
    async testPush() {
      const { data: res, error } = await sb.functions.invoke('send-push', { body: { test: true } });
      if (error) throw new Error(error.message);
      return res?.sent || 0;
    },

    exportJSON() { return JSON.stringify(data, null, 2); },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.meds)) throw new Error('Filen ligner ikke en kopi fra appen.');
      data = { ...empty(), ...parsed, settings: { ...empty().settings, ...(parsed.settings || {}) } };
      if (cloud) {
        if (data.meds.length) push(sb.from('meds').upsert(data.meds.map(medToRow)), 'medicinen');
        for (let i = 0; i < data.products.length; i += 500) push(sb.from('products').upsert(data.products.slice(i, i + 500).map(prodToRow)), 'produkterne');
        push(sb.from('settings').upsert(settingsToRow(data.settings)), 'indstillingerne');
      }
      return saveLocal();
    },
  };
})();
