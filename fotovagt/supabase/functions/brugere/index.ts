// Fotovagt: kontoret opretter adgang til en ny fotograf (eller kontorbruger).
// Gemmer invitationen (navn, telefon, rolle, område) og sender en mail fra Supabase med et link til
// vagt.hrc-fotos.dk. Den nye trykker på linket, er logget ind og vælger sin adgangskode i appen.
// Kan mailen ikke sendes (fx Supabases grænse for mails pr. time), svares der med et link,
// som kontoret selv kan sende på sms.
// Kun brugere med rollen "kontor" kan kalde funktionen (tjekkes her – deploy med verify_jwt = false).
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const APP = Deno.env.get("FOTOVAGT_URL") || "https://vagt.hrc-fotos.dk";
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function kontor(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await db.from("profiles").select("id, rolle").eq("id", data.user.id).single();
  return p?.rolle === "kontor" ? p.id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const mig = await kontor(req);
  if (!mig) return json({ ok: false, fejl: "Kun kontoret kan oprette brugere." }, 401);
  const body = await req.json().catch(() => ({}));
  const i = body.inviter;
  if (!i) return json({ ok: false, fejl: "Mangler oplysninger." }, 400);

  const email = String(i.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, fejl: "Skriv en gyldig e-mail." }, 400);
  const rolle = i.rolle === "kontor" ? "kontor" : "foto";
  const redirectTo = rolle === "kontor" ? `${APP}/kontor.html` : `${APP}/`;

  // 1. Invitationen (databasen afviser alle andre, når en konto oprettes)
  const { data: findes } = await db.from("invitationer").select("email, brugt").eq("email", email).maybeSingle();
  if (findes?.brugt) return json({ ok: false, fejl: "Den e-mail har allerede en bruger i Fotovagt." }, 409);
  if (findes && !body.igen) return json({ ok: false, fejl: "Den e-mail er allerede inviteret. Brug \"Send igen\" på listen." }, 409);
  const række = {
    email, rolle, inviteret_af: mig,
    navn: String(i.navn || "").trim().slice(0, 100) || null,
    telefon: String(i.telefon || "").trim().slice(0, 30) || null,
    omraade_id: i.omraade_id || null,
  };
  const gem = findes
    ? await db.from("invitationer").update(body.igen && !i.navn ? { inviteret_af: mig } : række).eq("email", email)
    : await db.from("invitationer").insert(række);
  if (gem.error) return json({ ok: false, fejl: gem.error.message }, 500);

  // 2. Mail med link til appen
  const { error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo, data: { name: række.navn } });
  if (!error) return json({ ok: true, mail: true });

  // 3. Mailen kunne ikke sendes: lav et link, kontoret selv kan sende
  let link: string | undefined;
  for (const type of ["invite", "magiclink"] as const) {
    const r = await db.auth.admin.generateLink({ type, email, options: { redirectTo } });
    if (!r.error) { link = r.data.properties?.action_link; break; }
  }
  const grund = /rate|limit/i.test(error.message) ? "Supabase har sendt for mange mails den seneste time."
    : /already|registered|exists/i.test(error.message) ? "Brugeren findes allerede, men har ikke logget ind endnu."
    : error.message;
  return json({ ok: true, mail: false, link, fejl: grund });
});
