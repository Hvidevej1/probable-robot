// Supabase Edge Function "send-push": sender push-besked til jeres telefoner.
// Databasen kalder den (se supabase/push.sql) med id på et præparat, når det
// bliver sat til "skal bestilles" eller "skal afhentes". Funktionen slår selv
// præparatet op og sender kun, hvis det netop er ændret. Derfor kan et kald
// udefra højst udløse en besked om noget, der faktisk lige er sket.
// Hver time kaldes den også med { remind: true }: alt, der har stået som
// "skal afhentes" i 3 dage uden at være hentet, giver én ny påmindelse.
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

async function sendTo(db: ReturnType<typeof createClient>, users: string[], body: string) {
  webpush.setVapidDetails(
    "https://medicin.hrc-fotos.dk",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );
  const { data: subs } = await db.from("push_subscriptions").select("*").in("user_id", users);
  const payload = JSON.stringify({ title: "Vores medicin", body });
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

const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  let body: { id?: string; remind?: boolean } = {};
  try { body = await req.json(); } catch { /* tomt kald */ }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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
