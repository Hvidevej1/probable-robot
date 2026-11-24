// Forbindelse til Fotovagts database (Supabase).
// Står felterne tomme, kører appen i DEMO-tilstand: alt gemmes kun i denne browser,
// med opdigtede fotografer og hændelser, så man kan prøve både marken og kontoret.
// Nøglen her er Supabases offentlige "anon/publishable" nøgle og må gerne stå her.
// Læg ALDRIG "service_role"/"secret"-nøglen her.
window.FOTOVAGT_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  // Offentlig nøgle til push hentes fra databasen (push_noegle). Kan sættes her, hvis den skal låses fast.
  vapidPublicKey: '',
  // Hvor kortet starter (midt i Danmark) og zoom
  kortCenter: [56.1, 10.6],
  kortZoom: 7,
};
