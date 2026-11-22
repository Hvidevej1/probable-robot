// Supabase Edge Function "send-push": sender push-besked til jeres telefoner.
// Databasen kalder den (se supabase/push.sql) med id på et præparat, når det
// bliver sat til "skal bestilles" eller "skal afhentes". Funktionen slår selv
// præparatet op og sender kun, hvis det netop er ændret. Derfor kan et kald
// udefra højst udløse en besked om noget, der faktisk lige er sket.
// Hver time kaldes den også med { remind: true }: alt, der har stået som
// "skal afhentes" i 3 dage uden at være hentet, giver én ny påmindelse.
// Hvert minut kaldes den med { paamindelser: true }, når en påmindelse om at
// tage medicin eller fylde doseringsæsken skal sendes (se paamindelser.sql).
// Den går kun til brugerens egne telefoner.
// Med { test: true } og brugerens login sendes en prøve til brugerens egne telefoner.
// Beskeden går kun til ejeren af medicinen og dem, ejeren har givet fuldmagt.
// Kræver hemmelighederne VAPID_PUBLIC_KEY og VAPID_PRIVATE_KEY.
// "Verify JWT" skal være slået FRA for denne funktion.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const TEXT: Record<string, (n: string, otc: boolean) => string> = {
  bestil: (n, otc) => (otc ? `${n} skal købes.` : `${n} skal bestilles.`),
  bestilt: (n) => `${n} skal afhentes på apoteket.`,
};
const DAYS = 3;

// Ejeren + dem med fuldmagt til ejerens medicin
async function recipients(db: ReturnType<typeof createClient>, owner: string) {
  const { data } = await db.from("fuldmagt").select("grantee").eq("owner", owner);
  return [owner, ...(data ?? []).map((r: { grantee: string }) => r.grantee)];
}

// Fornavn fra brugerens profil, så det kan ses hvis medicin det handler om
async function nameOf(db: ReturnType<typeof createClient>, owner: string) {
  const { data } = await db.auth.admin.getUserById(owner);
  return (data?.user?.user_metadata?.name as string) || "";
}

async function sendTo(db: ReturnType<typeof createClient>, users: string[], body: string, tag = "medicin") {
  webpush.setVapidDetails(
    "https://medicin.hrc-fotos.dk",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );
  const { data: subs } = await db.from("push_subscriptions").select("*").in("user_id", users);
  const payload = JSON.stringify({ title: "Vores medicin", body, tag });
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
  return sent;
}

type Paamindelse = {
  id: string; user_id: string; slags: string; tekst: string | null; sendt: string | null;
  med_ids: string[] | null; produkt_ids: string[] | null;
};
// Navn, styrke og FMK's dosering på den valgte medicin. Kun medicin, brugeren selv ejer eller har
// fuldmagt til. Pakningsstørrelse (fx "250 stk.") tages aldrig med, så den ikke forveksles med
// hvor mange man skal tage. Doseringen står præcis som i FMK og regnes eller ændres aldrig.
const noPack = (st?: string | null) => String(st || "").split(",").map((t) => t.trim())
  .filter((t) => t && !/\bstk\b|\bpk\b|pakning|\d\s*x\s*\d|\bx\s*\d/i.test(t)).join(", ");
async function chosenNames(db: ReturnType<typeof createClient>, p: Paamindelse) {
  const names: string[] = [];
  const label = (r: { name: string; strength?: string | null; dosering?: string | null }) =>
    [r.name, noPack(r.strength)].filter(Boolean).join(" ") + (r.dosering ? ` – ${r.dosering}` : "");
  if (p.med_ids?.length) {
    const { data: g } = await db.from("fuldmagt").select("owner").eq("grantee", p.user_id);
    const owners = [p.user_id, ...(g ?? []).map((r: { owner: string }) => r.owner)];
    const { data } = await db.from("meds").select("name,strength,dosering").in("id", p.med_ids).in("owner", owners);
    names.push(...(data ?? []).map(label));
  }
  if (p.produkt_ids?.length) {
    const { data } = await db.from("products").select("name,strength").in("id", p.produkt_ids);
    names.push(...(data ?? []).map(label));
  }
  return names;
}
async function paamindelseText(db: ReturnType<typeof createClient>, p: Paamindelse) {
  const pre = p.tekst ? `${p.tekst}: ` : "";
  const names = await chosenNames(db, p);
  if (p.slags === "doseringsaeske") {
    return `${pre}I dag skal doseringsæsken fyldes.` + (names.length ? ` Med: ${names.join("; ")}.` : "");
  }
  return names.length ? `${pre}Husk at tage: ${names.join("; ")}.` : `${pre}Husk at tage din medicin.`;
}

// Appen kalder funktionen fra browseren (prøvebesked), så den skal svare på CORS
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: { id?: string; remind?: boolean; paamindelser?: boolean; test?: boolean } = {};
  try { body = await req.json(); } catch { /* tomt kald */ }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Påmindelser om at tage medicin / fylde doseringsæsken
  if (body.paamindelser) {
    const { data: due } = await db.rpc("paamindelser_nu");
    let sent = 0;
    for (const p of (due ?? []) as Paamindelse[]) {
      // Markér som sendt først (kun hvis ingen andre har gjort det), så den aldrig sendes to gange
      let q = db.from("paamindelser").update({ sendt: new Date().toISOString() }).eq("id", p.id);
      q = p.sendt ? q.eq("sendt", p.sendt) : q.is("sendt", null);
      const { data: claimed } = await q.select("id");
      if (!claimed?.length) continue;
      sent += await sendTo(db, [p.user_id], await paamindelseText(db, p), "paamindelse-" + p.id);
    }
    return json({ sent });
  }

  // Prøvebesked til den, der er logget ind
  if (body.test) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = await db.auth.getUser(token);
    if (!data?.user) return new Response("Ikke logget ind", { status: 401, headers: CORS });
    const sent = await sendTo(db, [data.user.id], "Prøve: Sådan ser og lyder en påmindelse fra appen.", "proeve");
    return json({ sent });
  }

  // Påmindelse: står stadig som "skal afhentes" efter 3 dage
  if (body.remind) {
    const before = new Date(Date.now() - DAYS * 86400000).toISOString();
    const { data: due } = await db.from("meds").select("id,name,owner,updated,reminded")
      .eq("status", "bestilt").lt("updated", before);
    const list = (due ?? []).filter((m) => !m.reminded || m.reminded < m.updated);
    if (!list.length) return json({ sent: 0 });
    let sent = 0;
    for (const owner of new Set(list.map((m) => m.owner as string))) {
      const names = list.filter((m) => m.owner === owner).map((m) => m.name);
      const who = await nameOf(db, owner);
      const pre = who ? `${who}: ` : "";
      const text = names.length === 1
        ? `${pre}${names[0]} er stadig ikke hentet på apoteket. Tryk Afhentet i appen, når den er hentet.`
        : `${pre}Disse er stadig ikke hentet på apoteket: ${names.join(", ")}. Tryk Afhentet i appen, når de er hentet.`;
      sent += await sendTo(db, await recipients(db, owner), text);
    }
    await db.from("meds").update({ reminded: new Date().toISOString() }).in("id", list.map((m) => m.id));
    return json({ sent, reminded: list.length });
  }

  const id = String(body.id || "");
  if (!id) return new Response("Mangler id", { status: 400 });
  const { data: med } = await db.from("meds").select("name,status,kind,updated,owner").eq("id", id).maybeSingle();
  if (!med || !TEXT[med.status]) return new Response("Ingen besked", { status: 200 });
  if (Date.now() - new Date(med.updated).getTime() > 2 * 60 * 1000) return new Response("For gammel", { status: 200 });
  const who = await nameOf(db, med.owner);
  const text = (who ? `${who}: ` : "") + TEXT[med.status](med.name, med.kind === "handkob");
  return json({ sent: await sendTo(db, await recipients(db, med.owner), text) });
});
