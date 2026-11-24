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
// Hemmeligheder (Edge Functions -> Secrets): FOTOVAGT_SECRET (en lang tilfældig tekst).
// "Verify JWT" skal være slået FRA for denne funktion (den tjekker selv login og hemmelighed).
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { geokod, parseBesked } from "./parse.js";

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Indgang = { title?: string; message?: string; url?: string; priority?: number; app?: string };

// Én besked -> én hændelse (med adresseopslag, hvis beskeden ikke selv har koordinater).
async function indsaet(b: Indgang, kilde: string, eksternId: string | null) {
  const h = parseBesked(b);
  if (h.lat == null && h.adresse) {
    const pos = await geokod(h.adresse, { headers: GEO_HEADERS });
    if (pos) { h.lat = pos.lat; h.lon = pos.lon; }
    await sleep(1100); // højst ét opslag i sekundet hos OpenStreetMap
  }
  const række = { ...h, kilde, ekstern_id: eksternId };
  const { error } = eksternId
    ? await db.from("haendelser").upsert(række, { onConflict: "ekstern_id", ignoreDuplicates: true })
    : await db.from("haendelser").insert(række);
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
  for (const m of beskeder) {
    const id = Number(m.id);
    højeste = Math.max(højeste, id);
    const app = String(m.app ?? "");
    if (kunApps.length && !kunApps.includes(app.toLowerCase())) continue;
    await indsaet({
      title: String(m.title ?? ""), message: String(m.message ?? ""), url: m.url ? String(m.url) : undefined,
      priority: Number(m.priority ?? 0), app,
    }, "pushover", `po:${m.id_str ?? m.id}`);
    nye++;
  }
  if (beskeder.length) {
    await fetch(`${API}/devices/${encodeURIComponent(k.device_id)}/update_highest_message.json`, {
      method: "POST",
      body: new URLSearchParams({ secret: k.secret, message: String(højeste) }),
    });
  }
  await db.from("pushover_konto").update({ highest: højeste, fejl: null, sidst_hentet: new Date().toISOString() }).eq("id", 1);
  return { ok: true, hentet: beskeder.length, nye };
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
  const korrekt = Deno.env.get("FOTOVAGT_SECRET");
  const medHemmelighed = !!korrekt && hemmelig === korrekt;

  try {
    // 1. Fra databasens ur
    if (body.hent && medHemmelighed) return json(await hent());

    // 3. Udefra (webhook) med hemmeligheden
    if (medHemmelighed && (body.title || body.message)) {
      const h = await indsaet(body, String(body.kilde || "webhook"), body.id ? `wh:${body.id}` : null);
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
    if (body.hent_nu) await hent();
    const { data: k } = await db.from("pushover_konto").select("device_id,kun_apps,sidst_hentet,fejl").eq("id", 1).single();
    return json({ ok: true, forbundet: !!k?.device_id, ...k });
  } catch (e) {
    return json({ ok: false, fejl: String((e as Error).message ?? e) }, 500);
  }
});
