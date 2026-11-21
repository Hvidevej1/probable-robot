// Supabase Edge Function: sender push-besked til jeres telefoner.
// Kaldes af databasen (se supabase/push.sql), når medicin skal bestilles eller hentes.
// Kræver disse hemmeligheder under Edge Functions -> Secrets:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SECRET
// "Verify JWT" skal være slået FRA for denne funktion (den tjekker selv PUSH_SECRET).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const TEXT: Record<string, (n: string, p: string, otc: boolean) => string> = {
  bestil: (n, p, otc) => otc ? `${n} skal købes (${p}).` : `${n} skal bestilles hos lægen (${p}).`,
  bestilt: (n, p) => `${n} er bestilt (${p}). Husk at hente den på apoteket.`,
};

Deno.serve(async (req) => {
  if (req.headers.get("x-push-secret") !== Deno.env.get("PUSH_SECRET")) {
    return new Response("Ingen adgang", { status: 401 });
  }
  const ev = await req.json();
  const make = TEXT[ev.status];
  if (!make) return new Response("Ingen besked", { status: 200 });

  webpush.setVapidDetails(
    "https://github.com/Hvidevej1/probable-robot",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: subs, error } = await db.from("push_subscriptions").select("*");
  if (error) return new Response(error.message, { status: 500 });

  const payload = JSON.stringify({
    title: "Vores medicin",
    body: make(ev.name, ev.person || "", ev.kind === "handkob"),
  });

  let sent = 0;
  for (const s of subs ?? []) {
    // Den, der selv skrev det ind, får ingen besked
    if (ev.by && s.email && s.email.toLowerCase() === String(ev.by).toLowerCase()) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      // Telefonen findes ikke længere: ryd op
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
