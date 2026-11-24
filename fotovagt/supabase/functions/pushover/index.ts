// Supabase Edge Function "pushover": henter jeres Pushover-beskeder og lægger dem ind som hændelser.
//
// Den bruger Pushovers "Open Client API": funktionen er en ekstra Pushover-enhed på jeres konto
// (ligesom Pushover på en computer), så alle beskeder kommer både på telefonen og her.
//
// Den kaldes på tre måder:
//  1. Af databasen hvert 15. sekund med { hent: true } og hemmeligheden FOTOVAGT_SECRET
//     (se supabase/pushover-cron.sql). Nye beskeder bliver til hændelser med adresse og placering.
//  2. Af kontoret i appen (med login) for at forbinde/afbryde Pushover og se status.
//  3. Udefra med { title, message, url } og hemmeligheden, fx fra Zapier eller en anden alarmtjeneste.
//
// Hemmeligheden, som databasens ur og webhooks sender med, ligger i tabellen intern (laves af databasen selv).
// Den kan også sættes som FOTOVAGT_SECRET under Edge Functions -> Secrets.
// "Verify JWT" skal være slået FRA for denne funktion (den tjekker selv login og hemmelighed).
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { findKoordinater, findMatch, flet, geokod, parseBesked, pressemeddelelseNr, række, skalIgnoreres, skalSlåsOp } from "./parse.js";

const API = "https://api.pushover.net/1";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-fotovagt-secret",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// OpenStreetMap vil have, at man fortæller, hvem man er. Kun appens navn sendes.
const GEO_HEADERS = { "User-Agent": "Fotovagt/1.0 (supabase edge function)" };
const GEO = { headers: GEO_HEADERS, log: (m: string) => console.warn("geokod:", m) };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Indgang = { title?: string; message?: string; url?: string; priority?: number; app?: string };
type Hændelse = ReturnType<typeof parseBesked>;

// Find koordinater bag et link: 112meldinger.dk-kortsider har dem i siden,
// korte Google Maps-links (maps.app.goo.gl) peger videre til et link med koordinater.
async function slåLinkOp(url: string) {
  try {
    if (/112meldinger\.dk\/map/i.test(url)) {
      const r = await fetch(url, { headers: { "User-Agent": GEO_HEADERS["User-Agent"] } });
      return r.ok ? findKoordinater(await r.text()) : null;
    }
    const r = await fetch(url, { redirect: "manual" });
    return findKoordinater(r.headers.get("location") || "");
  } catch { return null; }
}

// Placér hændelsen: først links, så adresseopslag hos OpenStreetMap
async function placér(h: Hændelse) {
  if (h.lat != null && !h.cirka) return;
  for (const u of h.links.filter(skalSlåsOp)) {
    const pos = await slåLinkOp(u);
    if (pos) { h.lat = pos.lat; h.lon = pos.lon; h.cirka = false; return; }
  }
  if (h.lat == null && h.adresse) {
    const pos = await geokod(h.adresse, GEO);
    if (pos) { h.lat = pos.lat; h.lon = pos.lon; }
    await sleep(1100); // højst ét opslag i sekundet hos OpenStreetMap
  }
}

// Aktive hændelser fra de seneste 45 minutter (til at finde dubletter)
// + hændelser fra det seneste døgn fra samme pressemeddelelse (opfølgning fra politiet)
async function nyligeAktive(h?: Hændelse) {
  const siden = new Date(Date.now() - 45 * 60e3).toISOString();
  const { data } = await db.from("haendelser").select("*")
    .in("status", ["ny", "taget", "ankommet"]).gt("oprettet", siden);
  const pm = pressemeddelelseNr(h?.url);
  if (!pm) return data ?? [];
  const døgn = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { data: pmData } = await db.from("haendelser").select("*").like("url", `%pressemeddelelse/${pm}%`).gt("oprettet", døgn);
  return [...(data ?? []), ...(pmData ?? []).filter((x) => !(data ?? []).some((y) => y.id === x.id))];
}

// Én besked -> én hændelse. Er det samme alarm som en, der allerede er kommet fra en anden kilde,
// lægges beskeden ind i den. Radioprøver og kontorets ignorér-liste (fx "(Bus)") springes over.
async function indsaet(b: Indgang, kilde: string, eksternId: string | null, ignorer: string[] = []) {
  const h = parseBesked(b);
  if (skalIgnoreres(h, ignorer)) return { ...h, ignoreret: true };
  const aktive = await nyligeAktive(h);
  let match = findMatch(h, aktive);
  if (!match) {
    await placér(h);
    match = findMatch(h, aktive);
  } else if (match.cirka || match.lat == null) {
    await placér(h); // den eksisterende har kun en cirka-placering: måske kan denne besked gøre den præcis
  }
  if (match) {
    const felter = flet(match, h, b.app);
    if (felter.adresse && felter.lat === null) {        // bedre adresse: slå den op
      const pos = await geokod(felter.adresse, GEO);
      if (pos) { felter.lat = pos.lat; felter.lon = pos.lon; }
    }
    await db.from("haendelser").update(felter).eq("id", match.id);
    await db.from("logbog").insert({ haendelse_id: match.id, handling: `ekstra besked fra ${b.app || kilde}` });
    return { ...h, slaaet_sammen_med: match.id };
  }
  if (h.opfoelgning) return { ...h, ignoreret: true }; // fx "personen er fundet" uden efterlysning at høre til
  const ny = { ...række(h), kilde, ekstern_id: eksternId };
  const { error } = eksternId
    ? await db.from("haendelser").upsert(ny, { onConflict: "ekstern_id", ignoreDuplicates: true })
    : await db.from("haendelser").insert(ny);
  if (error) throw new Error(error.message);
  return h;
}

// Hent nye beskeder fra Pushover og slet dem derefter fra Pushovers server (kun for denne enhed).
async function hent() {
  const { data: k } = await db.from("pushover_konto").select("*").eq("id", 1).single();
  if (!k?.secret || !k?.device_id) return { ok: false, grund: "Pushover er ikke forbundet" };
  const r = await fetch(`${API}/messages.json?secret=${encodeURIComponent(k.secret)}&device_id=${encodeURIComponent(k.device_id)}`);
  const svar = await r.json().catch(() => ({}));
  if (!r.ok || svar.status !== 1) {
    const fejl = (svar.errors ?? []).join(", ") || `Pushover svarede ${r.status}`;
    await db.from("pushover_konto").update({ fejl, sidst_hentet: new Date().toISOString() }).eq("id", 1);
    return { ok: false, fejl };
  }
  const beskeder = (svar.messages ?? []) as Array<Record<string, unknown>>;
  const kunApps = (k.kun_apps ?? []).map((a: string) => a.toLowerCase().trim()).filter(Boolean);
  let nye = 0, højeste = Number(k.highest) || 0;
  const fejl: string[] = [];
  for (const m of beskeder) {
    const id = Number(m.id);
    højeste = Math.max(højeste, id);
    const app = String(m.app ?? "");
    if (kunApps.length && !kunApps.includes(app.toLowerCase())) continue;
    try {
      const r = await indsaet({
        title: String(m.title ?? ""), message: String(m.message ?? ""), url: m.url ? String(m.url) : undefined,
        priority: Number(m.priority ?? 0), app,
      }, "pushover", `po:${m.id_str ?? m.id}`, k.ignorer ?? []);
      if (!("ignoreret" in r)) nye++;
    } catch (e) { fejl.push(String((e as Error).message ?? e)); } // én dårlig besked må ikke stoppe resten
  }
  if (beskeder.length) {
    await fetch(`${API}/devices/${encodeURIComponent(k.device_id)}/update_highest_message.json`, {
      method: "POST",
      body: new URLSearchParams({ secret: k.secret, message: String(højeste) }),
    });
  }
  await db.from("pushover_konto").update({
    highest: højeste, fejl: fejl.length ? fejl.join("; ").slice(0, 500) : null, sidst_hentet: new Date().toISOString(),
  }).eq("id", 1);
  return { ok: true, hentet: beskeder.length, nye, fejl };
}

// Forbind til Pushover: log ind én gang og registrér "fotovagt" som enhed.
// Adgangskoden gemmes ikke, kun den nøgle Pushover giver tilbage.
async function forbind(email: string, password: string, twofa?: string) {
  const login = await fetch(`${API}/users/login.json`, {
    method: "POST",
    body: new URLSearchParams({ email, password, ...(twofa ? { twofa } : {}) }),
  });
  const l = await login.json().catch(() => ({}));
  if (login.status === 412) return { ok: false, twofa: true };
  if (!login.ok || l.status !== 1) return { ok: false, fejl: (l.errors ?? ["Login afvist"]).join(", ") };

  let navn = "fotovagt";
  for (let i = 0; i < 3; i++) {
    const d = await fetch(`${API}/devices.json`, {
      method: "POST",
      body: new URLSearchParams({ secret: l.secret, name: navn, os: "O" }),
    });
    const dv = await d.json().catch(() => ({}));
    if (d.ok && dv.status === 1) {
      await db.from("pushover_konto").update({
        secret: l.secret, device_id: dv.id, highest: 0, fejl: null,
      }).eq("id", 1);
      return { ok: true, enhed: navn };
    }
    const fejl = JSON.stringify(dv.errors ?? dv);
    if (!/taken|name/i.test(fejl)) return { ok: false, fejl: `Kunne ikke oprette enhed: ${fejl}` };
    navn = `fotovagt${Math.floor(Math.random() * 9000 + 1000)}`; // navnet er optaget: prøv et andet
  }
  return { ok: false, fejl: "Kunne ikke finde et ledigt enhedsnavn" };
}

async function erKontor(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  if (!data?.user) return false;
  const { data: p } = await db.from("profiles").select("rolle").eq("id", data.user.id).single();
  return p?.rolle === "kontor";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));
  const hemmelig = req.headers.get("x-fotovagt-secret");
  const korrekt = Deno.env.get("FOTOVAGT_SECRET")
    || (await db.from("intern").select("cron_secret").eq("id", 1).single()).data?.cron_secret;
  const medHemmelighed = !!korrekt && hemmelig === korrekt;

  try {
    // 1. Fra databasens ur
    if (body.hent && medHemmelighed) return json(await hent());

    // 3. Udefra (webhook) med hemmeligheden
    if (medHemmelighed && (body.title || body.message)) {
      const { data: k } = await db.from("pushover_konto").select("ignorer").eq("id", 1).single();
      const h = await indsaet(body, String(body.kilde || "webhook"), body.id ? `wh:${body.id}` : null, k?.ignorer ?? []);
      return json({ ok: true, haendelse: h });
    }

    // 2. Fra kontoret i appen
    if (!(await erKontor(req))) return json({ ok: false, fejl: "Ikke adgang" }, 401);
    if (body.forbind) return json(await forbind(body.forbind.email, body.forbind.password, body.forbind.twofa));
    if (body.afbryd) {
      await db.from("pushover_konto").update({ secret: null, device_id: null, fejl: null }).eq("id", 1);
      return json({ ok: true });
    }
    if ("kun_apps" in body) {
      const liste = String(body.kun_apps || "").split(",").map((s) => s.trim()).filter(Boolean);
      await db.from("pushover_konto").update({ kun_apps: liste.length ? liste : null }).eq("id", 1);
    }
    if ("ignorer" in body) {
      const liste = String(body.ignorer || "").split(",").map((s) => s.trim()).filter(Boolean);
      await db.from("pushover_konto").update({ ignorer: liste }).eq("id", 1);
    }
    if (body.hent_nu) await hent();
    const { data: k } = await db.from("pushover_konto").select("device_id,kun_apps,ignorer,sidst_hentet,fejl").eq("id", 1).single();
    return json({ ok: true, forbundet: !!k?.device_id, ...k });
  } catch (e) {
    return json({ ok: false, fejl: String((e as Error).message ?? e) }, 500);
  }
});
