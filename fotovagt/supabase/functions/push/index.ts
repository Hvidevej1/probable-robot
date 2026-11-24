// Supabase Edge Function "push": sender push-beskeder til fotografernes telefoner.
// Databasen kalder den med { id, slags } (se supabase/push.sql). Funktionen stoler ikke på kaldet:
// den slår hændelsen op og sender kun, hvis der faktisk er noget nyt, og husker hvad der er sendt.
//   ny          -> fotografer, der står som "Ledig"
//   tildelt     -> den fotograf, kontoret har givet opgaven
//   opdatering  -> den fotograf, der har opgaven, når der er kommet ny tekst fra en anden kilde
// Med { test: true } og brugerens login sendes en prøve til brugerens egne telefoner.
//
// Hemmeligheder (Edge Functions -> Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// og gerne FOTOVAGT_URL (appens adresse, fx https://vagt.hrc-fotos.dk).
// "Verify JWT" skal være slået FRA for denne funktion.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const NYLIG = 10 * 60e3; // kun hændelser fra de sidste 10 minutter giver "ny"/"tildelt"-beskeder

const IKON: Record<string, string> = { Brand: "🔥", Trafik: "🚗", Politi: "🚓", Redning: "🛟", Miljø: "☣️", Vejr: "🌧️", Forsyning: "🔧" };
const seneste = (tekst: string | null) =>
  (String(tekst ?? "").split("\n").filter((l) => l.startsWith("— ")).pop() ?? "").slice(2).replace(/^kl\. \d\d[.:]\d\d [^:]+: /, "");

type Besked = { title: string; body: string; tag: string; url: string };

async function send(brugere: string[], besked: Besked) {
  if (!brugere.length) return 0;
  webpush.setVapidDetails(
    Deno.env.get("FOTOVAGT_URL") || "mailto:fotovagt@example.com",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );
  const { data: subs } = await db.from("push_subscriptions").select("*").in("user_id", brugere);
  let sendt = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(besked), { TTL: 600, urgency: "high" });
      sendt++;
    } catch (e) {
      const kode = (e as { statusCode?: number }).statusCode;
      if (kode === 404 || kode === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint); // telefonen har afmeldt
    }
  }
  return sendt;
}

async function håndtér(id: string, slags: string) {
  const { data: h } = await db.from("haendelser").select("*").eq("id", id).single();
  if (!h) return { sendt: 0, grund: "ukendt hændelse" };
  const sted = h.adresse ? `${h.adresse}${h.cirka ? " (ca.)" : ""}` : "Ingen adresse endnu";
  const ikon = IKON[h.kategori] ?? "📍";
  const url = `./?h=${h.id}`;

  if (slags === "ny") {
    if (h.push_ny || h.status !== "ny" || Date.now() - new Date(h.oprettet).getTime() > NYLIG) return { sendt: 0 };
    await db.from("haendelser").update({ push_ny: true }).eq("id", id);
    const { data: ledige } = await db.from("profiles").select("id").eq("rolle", "foto").eq("status", "ledig");
    return { sendt: await send((ledige ?? []).map((p) => p.id), { title: `${ikon} ${h.titel}`, body: sted, tag: h.id, url }) };
  }

  if (slags === "tildelt") {
    if (!h.taget_af || h.taget_af === h.push_tildelt || Date.now() - new Date(h.taget_tid).getTime() > NYLIG) return { sendt: 0 };
    // Kun når kontoret har givet opgaven (ikke når fotografen selv har taget den)
    const { data: log } = await db.from("logbog").select("handling").eq("haendelse_id", id).order("tid", { ascending: false }).limit(1);
    await db.from("haendelser").update({ push_tildelt: h.taget_af }).eq("id", id);
    if (!/^gav opgaven til/.test(log?.[0]?.handling ?? "")) return { sendt: 0 };
    return { sendt: await send([h.taget_af], { title: `Du har fået en opgave: ${h.titel}`, body: sted, tag: h.id, url }) };
  }

  if (slags === "opdatering") {
    const længde = String(h.tekst ?? "").length;
    if (længde <= (h.push_tekst_len ?? 0)) return { sendt: 0 };
    await db.from("haendelser").update({ push_tekst_len: længde }).eq("id", id);
    if (!h.taget_af || !["taget", "ankommet"].includes(h.status) || !seneste(h.tekst)) return { sendt: 0 };
    return { sendt: await send([h.taget_af], { title: `🔄 Opdatering: ${h.titel}`, body: seneste(h.tekst).slice(0, 180), tag: `${h.id}-opd`, url }) };
  }
  return { sendt: 0, grund: "ukendt slags" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.test) {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data } = await db.auth.getUser(token);
      if (!data?.user) return json({ ok: false, fejl: "Ikke logget ind" }, 401);
      const sendt = await send([data.user.id], { title: "Fotovagt", body: "Push-beskeder virker på denne telefon. 👍", tag: "test", url: "./" });
      return json({ ok: true, sendt });
    }
    if (!body.id || !body.slags) return json({ ok: false }, 400);
    return json({ ok: true, ...(await håndtér(String(body.id), String(body.slags))) });
  } catch (e) {
    return json({ ok: false, fejl: String((e as Error).message ?? e) }, 500);
  }
});
