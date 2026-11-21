// Forbindelse til den fælles database (Supabase).
// Står felterne tomme, gemmes alt kun på den enhed, man bruger.
// Nøglen her er Supabases offentlige "anon/publishable" nøgle. Den må gerne stå her,
// fordi databasen selv kun lukker jeres to e-mailadresser ind.
// Læg ALDRIG "service_role"/"secret"-nøglen her.
window.MEDICIN_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
