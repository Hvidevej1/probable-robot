// Datalaget. Med Supabase-nøgler i config.js bruges den fælles database med live-opdatering.
// Uden nøgler kører DEMO: alt gemmes i browseren, og faner i samme browser opdaterer hinanden,
// så man kan have "Marken" og "Kontoret" åbne side om side og se det virke.
import { parseBesked, geokod, findMatch, flet, række, skalIgnoreres } from './supabase/functions/pushover/parse.js';

const cfg = window.FOTOVAGT_CONFIG || {};
const cloud = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
const lyttere = new Set();
const state = { haendelser: [], profiler: [], log: [], mig: null };
const fejlTekst = e => (e && (e.message || e.error_description)) || String(e);
const ændret = () => lyttere.forEach(f => f(state));

// ------------------------------------------------------------------------------------
// Supabase
// ------------------------------------------------------------------------------------
function supabaseBackend() {
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  let kanal = null;
  // Kommer man ind via "Glemt adgangskode"-mailen, vælges en ny adgangskode her
  sb.auth.onAuthStateChange(async event => {
    if (event !== 'PASSWORD_RECOVERY') return;
    const pw = prompt('Vælg en ny adgangskode (mindst 8 tegn):');
    if (pw) { const { error } = await sb.auth.updateUser({ password: pw }); alert(error ? error.message : 'Adgangskoden er skiftet.'); }
  });
  const rpc = async (fn, args) => { const { error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); };
  const upsertListe = (liste, række, nøgle = 'id') => {
    const i = liste.findIndex(x => x[nøgle] === række[nøgle]);
    if (i >= 0) liste[i] = { ...liste[i], ...række }; else liste.unshift(række);
  };

  async function hentAlt() {
    const døgn = new Date(Date.now() - 24 * 3600e3).toISOString();
    const [h, p, l] = await Promise.all([
      sb.from('haendelser').select('*').or(`status.in.(ny,taget,ankommet),oprettet.gt.${døgn}`).order('oprettet', { ascending: false }).limit(300),
      sb.from('profiles').select('*').order('navn'),
      sb.from('logbog').select('*').order('tid', { ascending: false }).limit(150),
    ]);
    for (const r of [h, p, l]) if (r.error) throw new Error(r.error.message);
    state.haendelser = h.data; state.profiler = p.data; state.log = l.data;
    state.mig = state.profiler.find(x => x.id === state.mig?.id) || state.mig;
    ændret();
  }

  function abonnér() {
    kanal?.unsubscribe();
    kanal = sb.channel('fotovagt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'haendelser' }, e => {
        if (e.eventType === 'DELETE') state.haendelser = state.haendelser.filter(x => x.id !== e.old.id);
        else { const ny = e.eventType === 'INSERT' && !state.haendelser.some(x => x.id === e.new.id); upsertListe(state.haendelser, e.new); if (ny) state.nyHaendelse = e.new; }
        state.haendelser.sort((a, b) => b.oprettet.localeCompare(a.oprettet));
        ændret(); state.nyHaendelse = null;
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, e => {
        if (e.eventType === 'DELETE') state.profiler = state.profiler.filter(x => x.id !== e.old.id);
        else upsertListe(state.profiler, e.new);
        if (state.mig && e.new?.id === state.mig.id) state.mig = { ...state.mig, ...e.new };
        ændret();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'logbog' }, e => {
        state.log.unshift(e.new); state.log.length = Math.min(state.log.length, 150); ændret();
      })
      .subscribe(s => { if (s === 'SUBSCRIBED') hentAlt().catch(() => {}); });
  }

  async function startSession(user) {
    const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
    if (error || !data) throw new Error('Din bruger har ingen profil. Kontakt kontoret.');
    state.mig = data;
    await hentAlt();
    abonnér();
    return data;
  }

  return {
    async init() {
      const { data } = await sb.auth.getSession();
      return data.session ? startSession(data.session.user) : null;
    },
    async login(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Forkert e-mail eller adgangskode.' : error.message);
      return startSession(data.user);
    },
    async glemt(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
      if (error) throw new Error(error.message);
    },
    async logout() { kanal?.unsubscribe(); await sb.auth.signOut(); },
    hentAlt,
    tag: h => rpc('tag_haendelse', { h }),
    meldStatus: s => rpc('meld_status', { s }),
    afslut: note => rpc('afslut_haendelse', { note_tekst: note || null }),
    slip: () => rpc('slip_haendelse'),
    meldPosition: (la, lo) => rpc('meld_position', { la, lo }),
    retProfil: (navn, telefon) => rpc('ret_profil', { nyt_navn: navn, ny_telefon: telefon }),
    tildel: (h, foto) => rpc('tildel_haendelse', { h, foto }),
    luk: (h, status) => rpc('luk_haendelse', { h, ny_status: status }),
    saetStatus: (foto, s) => rpc('saet_status', { foto, s }),
    async ret(id, felter) {
      const { error } = await sb.from('haendelser').update(felter).eq('id', id);
      if (error) throw new Error(error.message);
    },
    async retFotograf(id, felter) {
      const { error } = await sb.from('profiles').update(felter).eq('id', id);
      if (error) throw new Error(error.message);
    },
    async opret(felter) {
      const { error } = await sb.from('haendelser').insert({ kilde: 'manuel', ...felter });
      if (error) throw new Error(error.message);
    },
    async pushover(body) {
      const { data, error } = await sb.functions.invoke('pushover', { body });
      if (error) throw new Error(fejlTekst(error));
      return data;
    },
  };
}

// ------------------------------------------------------------------------------------
// Demo i browseren
// ------------------------------------------------------------------------------------
function demoBackend() {
  const NØGLE = 'fotovagt-demo-v1';
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('fotovagt-demo') : null;
  const nu = () => new Date().toISOString();
  const minSiden = m => new Date(Date.now() - m * 60e3).toISOString();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

  function frø() {
    const p = (id, navn, status, lat, lon, extra = {}) => ({
      id, navn, telefon: '', rolle: 'foto', status, status_tid: minSiden(Math.random() * 60 | 0),
      haendelse_id: null, lat, lon, pos_tid: minSiden(2), sidst_set: minSiden(1), ...extra,
    });
    const profiler = [
      p('f1', 'Mads', 'ledig', 56.162, 10.203),
      p('f2', 'Sofie', 'optaget', 55.69, 12.56, { haendelse_id: 'h2' }),
      p('f3', 'Jonas', 'pause', 55.396, 10.388),
      p('f4', 'Ida', 'ledig', 57.048, 9.919),
      p('f5', 'Peter', 'ankommet', 55.47, 8.45, { haendelse_id: 'h4' }),
      p('f6', 'Line', 'offline', 55.71, 9.53, { sidst_set: minSiden(300) }),
      { id: 'k1', navn: 'Kontoret', rolle: 'kontor', status: 'offline', telefon: '' },
    ];
    const h = (id, min, titel, tekst, adresse, kategori, lat, lon, extra = {}) => ({
      id, oprettet: minSiden(min), kilde: 'pushover', titel, tekst, adresse, kategori, prioritet: 0,
      lat, lon, status: 'ny', taget_af: null, taget_tid: null, ankommet_tid: null, afsluttet_tid: null, note: null, ...extra,
    });
    const haendelser = [
      h('h1', 3, 'Brand i etageejendom', 'Melding om brand i lejlighed på 3. sal. Flere vogne kørt.', 'Frederiks Allé 40, 8000 Aarhus C', 'Brand', 56.1497, 10.2039),
      h('h2', 18, 'Større politiaktion', 'Politiet har afspærret området. Bevæbnet indsats.', 'Nørrebrogade 45, 2200 København N', 'Politi', 55.6905, 12.5527, { status: 'taget', taget_af: 'f2', taget_tid: minSiden(15) }),
      h('h3', 7, 'Færdselsuheld E45', 'Trafikuheld E45 ved Vejle, to biler involveret. Kø nordgående.', 'E45 ved Vejle', 'Trafik', 55.7255, 9.5007),
      h('h4', 40, 'Skybrud – oversvømmede veje', 'Beredskabet pumper vand i flere kældre.', 'Torvegade 1, 6700 Esbjerg', 'Vejr', 55.4677, 8.4519, { status: 'ankommet', taget_af: 'f5', taget_tid: minSiden(35), ankommet_tid: minSiden(10) }),
      h('h5', 1, 'Person i vandet', 'Redningsaktion ved havnen. Helikopter tilkaldt.', 'Havnegade, 5000 Odense C', 'Redning', 55.4085, 10.3866),
      h('h6', 200, 'Containerbrand', 'Brand i container ved skole. Slukket.', '9000 Aalborg', 'Brand', 57.0488, 9.9217, { status: 'afsluttet', taget_af: 'f4', afsluttet_tid: minSiden(150), note: '12 billeder sendt' }),
    ];
    const log = [
      { id: 3, tid: minSiden(10), bruger: 'f5', haendelse_id: 'h4', handling: 'meldte ankommet' },
      { id: 2, tid: minSiden(15), bruger: 'f2', haendelse_id: 'h2', handling: 'tog hændelsen' },
      { id: 1, tid: minSiden(18), bruger: null, haendelse_id: 'h2', handling: 'ny hændelse fra pushover' },
    ];
    return { haendelser, profiler, log, pushover: { forbundet: false, kun_apps: null, ignorer: ['(Bus)'] } };
  }

  let db;
  const læs = () => { try { db = JSON.parse(localStorage.getItem(NØGLE)) || frø(); } catch { db = frø(); } };
  const gem = () => {
    try { localStorage.setItem(NØGLE, JSON.stringify(db)); } catch { /* privat vindue */ }
    bc?.postMessage('ændret'); spejl();
  };
  const spejl = (nyH = null) => {
    state.haendelser = [...db.haendelser].sort((a, b) => b.oprettet.localeCompare(a.oprettet));
    state.profiler = [...db.profiler].sort((a, b) => a.navn.localeCompare(b.navn));
    state.log = db.log.slice(0, 150);
    if (state.mig) state.mig = db.profiler.find(p => p.id === state.mig.id) || state.mig;
    state.nyHaendelse = nyH; ændret(); state.nyHaendelse = null;
  };
  const udefra = () => {
    const før = new Set(db.haendelser.map(h => h.id)); læs();
    spejl(db.haendelser.find(h => !før.has(h.id)) || null);
  };
  bc && (bc.onmessage = udefra);
  window.addEventListener('storage', e => { if (e.key === NØGLE) udefra(); });
  læs();

  const mig = () => db.profiler.find(p => p.id === state.mig?.id);
  const H = id => db.haendelser.find(h => h.id === id);
  const P = id => db.profiler.find(p => p.id === id);
  const log = (h, handling, bruger = state.mig?.id) => db.log.unshift({ id: Date.now(), tid: nu(), bruger, haendelse_id: h, handling });
  const kontor = () => { if (mig()?.rolle !== 'kontor') throw new Error('Kun kontoret.'); };
  const kør = fn => async (...a) => { læs(); const r = await fn(...a); gem(); return r; };

  return {
    demo: true,
    profilerTilLogin: () => (læs(), db.profiler),
    async init() {
      const id = sessionStorage.getItem('fotovagt-demo-bruger');
      if (!id || !P(id)) return null;
      state.mig = P(id); spejl(); return state.mig;
    },
    async login(id) {
      sessionStorage.setItem('fotovagt-demo-bruger', id);
      state.mig = P(id); spejl(); return state.mig;
    },
    async logout() { sessionStorage.removeItem('fotovagt-demo-bruger'); state.mig = null; },
    async glemt() {},
    async hentAlt() { læs(); spejl(); },
    nulstil() { localStorage.removeItem(NØGLE); læs(); gem(); },
    tag: kør(id => {
      const m = mig(), h = H(id);
      if (m.haendelse_id && m.haendelse_id !== id) throw new Error('Du har allerede en opgave. Afslut eller slip den først.');
      if (!h || h.status !== 'ny') throw new Error('Hændelsen er allerede taget af en anden.');
      Object.assign(h, { status: 'taget', taget_af: m.id, taget_tid: nu() });
      Object.assign(m, { haendelse_id: id, status: 'optaget', status_tid: nu(), sidst_set: nu() });
      log(id, 'tog hændelsen');
    }),
    meldStatus: kør(s => {
      const m = mig();
      if (s === 'ankommet' && !m.haendelse_id) throw new Error('Du har ingen opgave at være ankommet til.');
      Object.assign(m, { status: s, status_tid: nu(), sidst_set: nu() });
      if (s === 'ankommet') { const h = H(m.haendelse_id); h.status = 'ankommet'; h.ankommet_tid ||= nu(); }
      log(m.haendelse_id, 'meldte ' + s);
    }),
    afslut: kør(note => {
      const m = mig(), h = H(m.haendelse_id);
      if (!h) throw new Error('Du har ingen opgave.');
      Object.assign(h, { status: 'afsluttet', afsluttet_tid: nu(), note: note || h.note });
      Object.assign(m, { haendelse_id: null, status: 'ledig', status_tid: nu() });
      log(h.id, 'afsluttede opgaven' + (note ? ': ' + note : ''));
    }),
    slip: kør(() => {
      const m = mig(), h = H(m.haendelse_id);
      if (!h) throw new Error('Du har ingen opgave.');
      Object.assign(h, { status: 'ny', taget_af: null, taget_tid: null, ankommet_tid: null });
      Object.assign(m, { haendelse_id: null, status: 'ledig', status_tid: nu() });
      log(h.id, 'slap opgaven');
    }),
    meldPosition: kør((la, lo) => {
      const m = mig(); m.sidst_set = nu();
      if (la != null) Object.assign(m, { lat: la, lon: lo, pos_tid: nu() });
    }),
    retProfil: kør((navn, telefon) => { const m = mig(); if (navn) m.navn = navn; m.telefon = telefon || ''; }),
    tildel: kør((id, foto) => {
      kontor(); const h = H(id);
      const gammel = h.taget_af && P(h.taget_af);
      if (gammel && gammel.haendelse_id === id) Object.assign(gammel, { haendelse_id: null, status: 'ledig', status_tid: nu() });
      if (!foto) { Object.assign(h, { status: 'ny', taget_af: null, taget_tid: null, ankommet_tid: null }); log(id, 'fjernede fotografen fra opgaven'); return; }
      const f = P(foto);
      if (f.haendelse_id && f.haendelse_id !== id) throw new Error('Fotografen har allerede en opgave.');
      Object.assign(h, { status: 'taget', taget_af: foto, taget_tid: nu(), ankommet_tid: null });
      Object.assign(f, { haendelse_id: id, status: 'optaget', status_tid: nu() });
      log(id, 'gav opgaven til ' + f.navn);
    }),
    luk: kør((id, s) => {
      kontor(); const h = H(id);
      db.profiler.filter(p => p.haendelse_id === id).forEach(p => Object.assign(p, { haendelse_id: null, status: 'ledig', status_tid: nu() }));
      Object.assign(h, { status: s, afsluttet_tid: s === 'ny' ? null : nu() });
      if (s === 'ny') h.taget_af = null;
      log(id, s === 'ny' ? 'genåbnede hændelsen' : 'satte hændelsen til ' + s);
    }),
    saetStatus: kør((foto, s) => { kontor(); const f = P(foto); Object.assign(f, { status: s, status_tid: nu() }); log(null, `satte ${f.navn} til ${s}`); }),
    ret: kør((id, felter) => { kontor(); Object.assign(H(id), felter); }),
    retFotograf: kør((id, felter) => { kontor(); Object.assign(P(id), felter); }),
    opret: kør(felter => {
      const h = { id: uid(), oprettet: nu(), kilde: 'manuel', status: 'ny', prioritet: 0, kategori: 'Andet', ...felter };
      db.haendelser.unshift(h);
      log(h.id, h.kilde === 'manuel' ? 'oprettede hændelsen' : 'ny hændelse fra ' + h.kilde, h.kilde === 'manuel' ? state.mig?.id : null);
    }),
    async pushover(body) {
      læs();
      if (body.forbind) db.pushover = { ...db.pushover, forbundet: true, device_id: 'demo', sidst_hentet: nu() };
      if (body.afbryd) db.pushover = { ...db.pushover, forbundet: false };
      const liste = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
      if ('kun_apps' in body) db.pushover.kun_apps = liste(body.kun_apps);
      if ('ignorer' in body) db.pushover.ignorer = liste(body.ignorer);
      gem();
      return { ok: true, ...db.pushover };
    },
  };
}

const backend = cloud ? supabaseBackend() : demoBackend();

// Fælles for begge: en Pushover-besked tastet ind på kontoret bliver læst præcis som de rigtige.
// Samme alarm fra en anden kilde lægges ind i den eksisterende hændelse, ligesom på serveren.
async function simulerBesked(title, message, url, app, ignorer = []) {
  const h = parseBesked({ title, message, url, app });
  if (skalIgnoreres(h, ignorer)) return { ...h, ignoreret: true };
  let match = findMatch(h, state.haendelser);
  if (!match && h.lat == null && h.adresse) {
    // (112meldinger-links kan kun slås op på serveren; her bruges adressen)
    const pos = await geokod(h.adresse).catch(() => null);
    if (pos) { h.lat = pos.lat; h.lon = pos.lon; }
    match = findMatch(h, state.haendelser);
  }
  if (match) {
    const felter = flet(match, h, app);
    if (felter.adresse && felter.lat === null) {
      const pos = await geokod(felter.adresse).catch(() => null);
      if (pos) { felter.lat = pos.lat; felter.lon = pos.lon; }
    }
    await backend.ret(match.id, felter);
    return { ...h, lat: h.lat ?? match.lat, slaaetSammen: match };
  }
  if (h.opfoelgning) return { ...h, ignoreret: true };
  await backend.opret({ ...række(h), kilde: cloud ? 'manuel' : 'pushover' });
  return h;
}

export const store = {
  cloud,
  demo: !cloud,
  state,
  lyt(fn) { lyttere.add(fn); return () => lyttere.delete(fn); },
  ...backend,
  simulerBesked,
  geokod: a => geokod(a),
  fejlTekst,
};
