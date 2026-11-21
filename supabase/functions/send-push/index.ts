// Supabase Edge Function "send-push": sender push-besked til jeres telefoner.
// Databasen kalder den (se supabase/push.sql) med id på et præparat, når det
// bliver sat til "skal bestilles" eller "bestilt". Funktionen slår selv
// præparatet op og sender kun, hvis det netop er ændret. Derfor kan et kald
// udefra højst udløse en besked om noget, der faktisk lige er sket.
// Kræver hemmelighederne VAPID_PUBLIC_KEY og VAPID_PRIVATE_KEY.
// "Verify JWT" skal være slået FRA for denne funktion.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const TEXT: Record<string, (n: string, otc: boolean) => string> = {
  bestil: (n, otc) => (otc ? `${n} skal købes.` : `${n} skal bestilles.`),
  bestilt: (n) => `${n} er bestilt. Husk at hente den på apoteket.`,
};

Deno.serve(async (req) => {
  let id = "";
  try { id = String((await req.json()).id || ""); } catch { /* tomt kald */ }
  if (!id) return new Response("Mangler id", { status: 400 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: med } = await db.from("meds").select("name,status,kind,updated").eq("id", id).maybeSingle();
  if (!med || !TEXT[med.status]) return new Response("Ingen besked", { status: 200 });
  if (Date.now() - new Date(med.updated).getTime() > 2 * 60 * 1000) return new Response("For gammel", { status: 200 });

  webpush.setVapidDetails(
    "https://vores-medicin.vercel.app",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );
  const { data: subs } = await db.from("push_subscriptions").select("*");
  const payload = JSON.stringify({ title: "Vores medicin", body: TEXT[med.status](med.name, med.kind === "handkob") });

  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
