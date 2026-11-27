// Supabase Edge Function "push": sender push-beskeder til fotografernes telefoner.
// Databasen kalder den med { id, slags } (se supabase/push.sql). Funktionen stoler ikke på kaldet:
// den slår hændelsen op og sender kun, hvis der faktisk er noget nyt, og husker hvad der er sendt.
//   ny          -> fotografer, der står som "Ledig"
//   tildelt     -> den fotograf, kontoret har givet opgaven
//   opdatering  -> den fotograf, der har opgaven, når der er kommet ny tekst fra en anden kilde
//   opgraderet  -> mere alvorlig melding (fx eftersyn -> bygningsbrand): ledige fotografer / fotografen på opgaven
// Med { sos, slags } (se push.sql):
//   sos         -> alle på kontoret + fotografer inden for 20 km (navn, telefon og afstand i beskeden)
//   sos_set     -> den der trykkede SOS: "Din SOS er set af …"
//   sos_paa_vej -> den der trykkede SOS: "Anna (5 km væk) kører til dig"
// Med { tilbud }: tilbud om en opgave til den nærmeste fotograf (se tilbud.sql), "Tag den / Nej tak" i appen
// Med { kommentar }: ny kommentar -> kontoret og fotografen, der har opgaven (ikke den, der skrev den)
// Med { test: true } og brugerens login sendes en prøve til brugerens egne telefoner.
//
// Nøglesættet til push (VAPID) laver funktionen selv første gang og gemmer i tabellen intern.
// Telefonerne henter den offentlige del med push_noegle(). Sæt gerne FOTOVAGT_URL (appens adresse).
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

type Besked = { title: string; body: string; tag: string; url: string; sos?: boolean; ttl?: number };
const SOS_RADIUS_KM = 20;
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 111.2, (a.lon - b.lon) * 111.2 * Math.cos(a.lat * Math.PI / 180));

// Nøglesættet: fra databasen, eller laves og gemmes første gang
async function nøgler() {
  const { data } = await db.from("intern").select("vapid_public, vapid_private").eq("id", 1).single();
  if (data?.vapid_public && data?.vapid_private) return { pub: data.vapid_public, priv: data.vapid_private };
  const k = webpush.generateVAPIDKeys();
  await db.from("intern").update({ vapid_public: k.publicKey, vapid_private: k.privateKey }).eq("id", 1).is("vapid_public", null);
  const { data: igen } = await db.from("intern").select("vapid_public, vapid_private").eq("id", 1).single();
  return { pub: igen!.vapid_public, priv: igen!.vapid_private };
}

async function send(brugere: string[], besked: Besked) {
  if (!brugere.length) return 0;
  const { pub, priv } = await nøgler();
  webpush.setVapidDetails(Deno.env.get("FOTOVAGT_URL") || "mailto:fotovagt@example.com", pub, priv);
  const { data: subs } = await db.from("push_subscriptions").select("*").in("user_id", brugere);
  let sendt = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(besked),
        { TTL: besked.ttl ?? (besked.sos ? 3600 : 600), urgency: "high" });
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

  if (slags === "opgraderet") {
    // Mere alvorlig melding (fx eftersyn -> bygningsbrand): ledige fotografer, eller fotografen på opgaven
    if (!h.opgraderet || h.opgraderet === h.push_opgraderet) return { sendt: 0 };
    await db.from("haendelser").update({ push_opgraderet: h.opgraderet }).eq("id", id);
    if (Date.now() - new Date(h.opgraderet).getTime() > NYLIG) return { sendt: 0 };
    let modtagere: string[] = [];
    if (h.status === "ny") {
      const { data: ledige } = await db.from("profiles").select("id").eq("rolle", "foto").eq("status", "ledig");
      modtagere = (ledige ?? []).map((p) => p.id);
    } else if (h.taget_af && ["taget", "ankommet"].includes(h.status)) modtagere = [h.taget_af];
    return { sendt: await send(modtagere, { title: `⬆️ Opgraderet: ${ikon} ${h.titel}`, body: sted, tag: `${h.id}-op`, url }) };
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

// SOS fra en fotograf
async function sos(id: string, slags: string) {
  const { data: s } = await db.from("sos").select("*").eq("id", id).single();
  if (!s) return { sendt: 0, grund: "ukendt SOS" };
  const { data: afs } = await db.from("profiles").select("navn, telefon").eq("id", s.bruger).single();
  const navn = afs?.navn || "En fotograf";
  const tlf = afs?.telefon ? ` · tlf. ${afs.telefon}` : "";

  if (slags === "sos") {
    if (s.push_sendt || !s.aktiv || Date.now() - new Date(s.start).getTime() > NYLIG) return { sendt: 0 };
    await db.from("sos").update({ push_sendt: true }).eq("id", id);
    const { data: alle } = await db.from("profiles").select("id, rolle, lat, lon, status").neq("id", s.bruger);
    let sendt = 0;
    for (const p of alle ?? []) {
      let afstand: number | null = null;
      if (p.rolle === "foto") {
        if (s.lat != null) {
          if (p.lat == null) continue;                     // vi ved ikke, hvor fotografen er
          afstand = km(s, p);
          if (afstand > SOS_RADIUS_KM) continue;
        } else if (p.status === "offline") continue;        // SOS uden placering: alle aktive fotografer
      }
      const hvor = s.lat == null ? "Placering ukendt – ring til fotografen"
        : afstand != null ? `${afstand < 1 ? "under 1" : Math.round(afstand)} km fra dig` : "Tryk for at se placeringen";
      sendt += await send([p.id], {
        title: `🆘 SOS fra ${navn}`, body: `${hvor}${tlf}`, tag: `sos-${id}`, sos: true,
        url: p.rolle === "kontor" ? `./kontor.html?sos=${id}` : `./?sos=${id}`,
      });
    }
    return { sendt };
  }
  if (slags === "sos_paa_vej") {
    const vej: string[] = s.paa_vej ?? [];
    if (vej.length <= (s.push_paa_vej ?? 0)) return { sendt: 0 };
    await db.from("sos").update({ push_paa_vej: vej.length }).eq("id", id);
    const { data: pp } = await db.from("profiles").select("id, navn, lat, lon").in("id", vej.slice(s.push_paa_vej ?? 0));
    const hvem = (pp ?? []).map((p) => p.navn + (s.lat != null && p.lat != null ? ` (${Math.max(1, Math.round(km(s, p)))} km væk)` : "")).join(", ");
    return { sendt: await send([s.bruger], { title: "🚗 Hjælp er på vej", body: `${hvem} kører til dig.`, tag: `sos-${id}-vej-${vej.length}`, url: "./" }) };
  }
  if (slags === "sos_set" && s.kvitteret_af) {
    const { data: k } = await db.from("profiles").select("navn").eq("id", s.kvitteret_af).single();
    return { sendt: await send([s.bruger], { title: "✅ Din SOS er set", body: `${k?.navn ?? "Kontoret"} har set din alarm.`, tag: `sos-${id}-set`, url: "./" }) };
  }
  return { sendt: 0 };
}

// Tilbud om en opgave: push til fotografen med afstand og svarfrist
async function tilbud(id: string) {
  const { data: t } = await db.from("tilbud").select("*").eq("id", id).single();
  if (!t || t.svar || new Date(t.udloeber).getTime() < Date.now()) return { sendt: 0 };
  const { data: h } = await db.from("haendelser").select("*").eq("id", t.haendelse_id).single();
  if (!h || h.status !== "ny") return { sendt: 0 };
  const sek = Math.max(0, Math.round((new Date(t.udloeber).getTime() - Date.now()) / 1000));
  const km = t.afstand_km != null ? `${String(Math.round(t.afstand_km * 10) / 10).replace(".", ",")} km fra dig` : "";
  return { sendt: await send([t.fotograf], {
    title: `📩 Tilbud: ${IKON[h.kategori] ?? "📍"} ${h.titel}`,
    body: [km, h.adresse, `svar inden ${sek} sek.`].filter(Boolean).join(" · "),
    tag: `tilbud-${id}`, url: `./?tilbud=${id}`, sos: true, ttl: sek,
  }) };
}

// Ny kommentar: push til kontoret og til fotografen, der har opgaven (ikke til den, der selv skrev)
async function kommentar(id: string) {
  const { data: k } = await db.from("kommentarer").select("*").eq("id", id).single();
  if (!k || k.push_sendt || Date.now() - new Date(k.oprettet).getTime() > NYLIG) return { sendt: 0 };
  await db.from("kommentarer").update({ push_sendt: true }).eq("id", id);
  const { data: h } = await db.from("haendelser").select("*").eq("id", k.haendelse_id).single();
  if (!h) return { sendt: 0 };
  const { data: af } = await db.from("profiles").select("navn").eq("id", k.bruger).single();
  const navn = af?.navn ?? "Kontoret";
  const tekst = String(k.tekst).slice(0, 170);
  let sendt = 0;
  // Kontoret: alle kommentarer, og det står tydeligt, når den kommer på døgnrapporten
  const { data: kontor } = await db.from("profiles").select("id").eq("rolle", "kontor").neq("id", k.bruger ?? "00000000-0000-0000-0000-000000000000");
  const kontorIds = (kontor ?? []).map((p) => p.id);
  if (kontorIds.length) {
    sendt += await send(kontorIds, {
      title: `💬 ${navn}${k.offentlig ? " · 🌐 døgnrapport" : ""}`, body: `${h.titel}: ${tekst}`,
      tag: `${h.id}-k-${id}-kontor`, url: `./kontor.html?h=${h.id}`,
    });
  }
  // Fotografen på opgaven
  if (h.taget_af && h.taget_af !== k.bruger && !kontorIds.includes(h.taget_af) && ["taget", "ankommet"].includes(h.status)) {
    sendt += await send([h.taget_af], { title: `💬 ${navn}: ${h.titel}`, body: tekst, tag: `${h.id}-k-${id}`, url: `./?h=${h.id}` });
  }
  return { sendt };
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
    if (body.init) { await nøgler(); return json({ ok: true }); }   // laver nøglesættet, hvis det mangler
    if (body.kommentar) return json({ ok: true, ...(await kommentar(String(body.kommentar))) });
    if (body.tilbud) return json({ ok: true, ...(await tilbud(String(body.tilbud))) });
    if (body.sos && body.slags) return json({ ok: true, ...(await sos(String(body.sos), String(body.slags))) });
    if (!body.id || !body.slags) return json({ ok: false }, 400);
    return json({ ok: true, ...(await håndtér(String(body.id), String(body.slags))) });
  } catch (e) {
    return json({ ok: false, fejl: String((e as Error).message ?? e) }, 500);
  }
});
