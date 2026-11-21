// Forbindelse til den fælles database (Supabase).
// Står felterne tomme, gemmes alt kun på den enhed, man bruger.
// Nøglen her er Supabases offentlige "anon/publishable" nøgle. Den må gerne stå her,
// fordi databasen selv kun lukker jeres to e-mailadresser ind.
// Læg ALDRIG "service_role"/"secret"-nøglen her.
window.MEDICIN_CONFIG = {
  supabaseUrl: 'https://andmqexhvvidvebsosgw.supabase.co',
  supabaseAnonKey: 'sb_publishable_tJBHraZvhygUuo2XM2zRiw_U-BlK7VL',
  // Offentlig nøgle til push-beskeder (VAPID). Den private del ligger kun i Supabase.
  vapidPublicKey: 'BM1jhS2YWMTuLKzxt6UrEf86gayIhmeKx6FgdOJyL2ZQHyrewiIBmadjpm0ilSmkYTNf8QvjLE29Lw2T3JrIzb4',
};
