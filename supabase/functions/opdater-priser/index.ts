// Supabase Edge Function "opdater-priser": henter dagens priser fra medicinpriser.dk
// (Lægemiddelstyrelsen) for al receptmedicin, der har et varenummer fra FMK.
// Priserne skifter hver anden mandag. Kaldes hver morgen af databasen (se supabase/priser.sql).
// Sender intet om jer nogen steder hen: kun varenummeret bruges i opslaget.
// "Verify JWT" skal være slået FRA.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const num = (s?: string) => (s ? Number(s.replace(/\./g, "").replace(",", ".")) : null);

async function lookup(varenr: string) {
  const res = await fetch(`https://www.medicinpriser.dk/Default.aspx?id=15&vnr=${encodeURIComponent(varenr)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (vores-medicin prisopslag)" },
  });
  if (!res.ok) return null;
  const text = (await res.text()).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const pris = num(/Pris pr\. pakning\s*([\d.]+,\d+)\s*kr/.exec(text)?.[1]);
  const tilskud = num(/Tilskud beregnes af\s*([\d.]+,\d+)\s*kr/.exec(text)?.[1]);
  return pris ? { pris, tilskud } : null;
}

Deno.serve(async () => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: meds } = await db.from("meds").select("id,name,varenr,price,tilskudspris").not("varenr", "is", null);
  const today = new Date().toISOString().slice(0, 10);
  const result: string[] = [];
  for (const m of meds ?? []) {
    try {
      const p = await lookup(m.varenr);
      if (!p) { result.push(`${m.name}: ikke fundet`); continue; }
      await db.from("meds").update({ price: p.pris, tilskudspris: p.tilskud, pris_opdateret: today }).eq("id", m.id);
      result.push(`${m.name}: ${p.pris} kr.`);
    } catch (e) {
      result.push(`${m.name}: fejl ${(e as Error).message}`);
    }
  }
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
});
