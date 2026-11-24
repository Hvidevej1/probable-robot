// Forbindelse til Fotovagts database (Supabase).
// Står felterne tomme, kører appen i DEMO-tilstand: alt gemmes kun i denne browser,
// med opdigtede fotografer og hændelser, så man kan prøve både marken og kontoret.
// Nøglen her er Supabases offentlige "anon/publishable" nøgle og må gerne stå her.
// Læg ALDRIG "service_role"/"secret"-nøglen her.
window.FOTOVAGT_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  // Offentlig nøgle til push-beskeder (VAPID). Den private del ligger kun i Supabase.
  vapidPublicKey: 'BI-epLeYRbhLjCSqBoOggBysRaZgba5BDE5uC8t-DArN4O3KxTAZ7DxA1JRbBxzJt2unLIf5rMGWRB0fG3V4t2k',
  // Hvor kortet starter (midt i Danmark) og zoom
  kortCenter: [56.1, 10.6],
  kortZoom: 7,
};
