// Forbindelse til Fotovagts database (Supabase).
// Står felterne tomme (eller åbnes appen med ?demo i adressen), kører den i DEMO-tilstand: alt gemmes
// kun i denne browser, med opdigtede fotografer og hændelser.
// Nøglen her er Supabases offentlige "anon/publishable" nøgle og må gerne stå her.
// Læg ALDRIG "service_role"/"secret"-nøglen her.
window.FOTOVAGT_CONFIG = {
  supabaseUrl: 'https://uhhfqojbbslfcivykcxx.supabase.co',
  supabaseAnonKey: 'sb_publishable_D84e4lonQrNoNu171hEl4w_LzoFkYLE',
  // Offentlig nøgle til push hentes fra databasen (push_noegle). Kan sættes her, hvis den skal låses fast.
  vapidPublicKey: '',
  // Hvor kortet starter (midt i Danmark) og zoom
  kortCenter: [56.1, 10.6],
  kortZoom: 7,
};
