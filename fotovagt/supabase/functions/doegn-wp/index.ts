// Fotovagt: døgnrapporten som en side pr. dag på hrc-fotos.dk (WordPress), så den kan findes på Google.
// Siden lægges under "Døgnrapport"-siden: https://hrc-fotos.dk/doegnrapport/ÅÅÅÅ-MM-DD/
// Indhold: kun det offentlige fra databasefunktionen doegnrapport() (kategori, by/område, vejr, nyhedslinks,
// offentlige kommentarer) – aldrig adresser, navne eller interne noter.
//
// Kaldes af pg_cron hver morgen for i går (og kan kaldes med {"dag":"ÅÅÅÅ-MM-DD"} eller {"dage":30} for at efterfylde).
// Kræver headeren x-fotovagt-secret (samme hemmelighed som push), eller en bruger med rollen "kontor".
// Hemmeligheder i Supabase → Edge Functions → Secrets (lægges ind af ejeren, aldrig i koden):
//   WP_URL       fx https://hrc-fotos.dk
//   WP_BRUGER    WordPress-brugernavn
//   WP_APP_KODE  en "Application Password" fra WordPress (Brugere → Profil → Programadgangskoder)
// Deploy med verify_jwt = false (adgangen tjekkes her).
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WP = (Deno.env.get("WP_URL") || "https://hrc-fotos.dk").replace(/\/+$/, "");
const BRUGER = Deno.env.get("WP_BRUGER") || "";
const KODE = (Deno.env.get("WP_APP_KODE") || "").replace(/\s+/g, "");
const APP = "https://vagt.hrc-fotos.dk";
const MIN_HAENDELSER = 3;   // dage med meget lidt indhold får ingen side (tynde sider skader placeringen)
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const TZ = "Europe/Copenhagen";

async function adgang(req: Request) {
  const hemmelig = req.headers.get("x-fotovagt-secret");
  if (hemmelig) {
    const { data } = await db.from("intern").select("cron_secret").eq("id", 1).single();
    return !!data?.cron_secret && hemmelig === data.cron_secret;
  }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  if (!data?.user) return false;
  const { data: p } = await db.from("profiles").select("rolle").eq("id", data.user.id).single();
  return p?.rolle === "kontor";
}

const wpHeaders = () => ({ Authorization: "Basic " + btoa(`${BRUGER}:${KODE}`), "Content-Type": "application/json" });
async function wp(path: string, init: RequestInit = {}) {
  const r = await fetch(`${WP}/wp-json/wp/v2/${path}`, { ...init, headers: { ...wpHeaders(), ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`WordPress ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

const dagTekst = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const kl = (iso: string) => new Date(iso).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const flyt = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const GRUPPE_FLERTAL: Record<string, string> = { Brand: "brande", Trafik: "trafikhændelser", Politi: "politisager", Redning: "redningsopgaver", Lægehelikopter: "lægehelikopterudkald", Indsatsleder: "indsatsledere sendt", Miljø: "miljøhændelser", Vejr: "vejrhændelser", Forsyning: "forsyningsfejl", Andet: "andre hændelser" };
const IKON: Record<string, string> = { Brand: "🔥", Trafik: "🚗", Politi: "🚓", Redning: "🛟", Lægehelikopter: "🚁", Indsatsleder: "🧑‍🚒", Miljø: "☣️", Vejr: "🌧️", Forsyning: "🔧", Andet: "📍" };
// deno-lint-ignore no-explicit-any
const gruppe = (h: any) => h.ikon === "helikopter" ? "Lægehelikopter" : h.ikon === "isl" ? "Indsatsleder" : (h.kategori || "Andet");
// deno-lint-ignore no-explicit-any
const overskrift = (h: any) => (!h.overskrift || h.overskrift === h.kategori || h.overskrift === "Hændelse") ? (gruppe(h) === "Andet" ? "Hændelse" : gruppe(h)) : h.overskrift;
const komma = (x: unknown) => String(x).replace(".", ",");
// deno-lint-ignore no-explicit-any
const vejr = (v: any) => !v ? "" : [v.tekst, v.temp != null ? `${komma(v.temp)} °C` : "", v.vind != null ? `vind ${komma(v.vind)} m/s${v.retning && v.retning !== "?" ? ` fra ${v.retning}` : ""}` : ""].filter(Boolean).join(", ");

// deno-lint-ignore no-explicit-any
function sideIndhold(dag: string, data: any) {
  // deno-lint-ignore no-explicit-any
  const hs = [...(data.haendelser || [])].sort((a: any, b: any) => a.tid.localeCompare(b.tid));
  const antal: Record<string, number> = {};
  for (const h of hs) antal[gruppe(h)] = (antal[gruppe(h)] || 0) + 1;
  const fordeling = Object.entries(antal).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${n === 1 ? k.toLowerCase() : (GRUPPE_FLERTAL[k] || k.toLowerCase())}`);
  // deno-lint-ignore no-explicit-any
  const byer = [...new Set(hs.map((h: any) => h.sted).filter(Boolean))].slice(0, 25) as string[];
  const fotoPåStedet = hs.filter((h) => h.paa_stedet).length;
  const dt = dagTekst(dag);
  const intro = `<p><strong>${esc(dt[0].toUpperCase() + dt.slice(1))}</strong> registrerede HRC-Fotos ${hs.length} hændelser fra beredskab, politi og trafik i Danmark: ${esc(fordeling.join(", "))}.`
    + (byer.length ? ` Hændelserne fandt bl.a. sted i ${esc(byer.slice(0, 12).join(", "))}${byer.length > 12 ? " m.fl." : ""}.` : "")
    + (fotoPåStedet ? ` HRC-Fotos var på stedet ved ${fotoPåStedet} af dem.` : "") + `</p>`;
  const kortLink = `<p>📍 <a href="${APP}/doegn.html?dag=${dag}" target="_blank" rel="noopener">Se døgnets hændelser på kort</a></p>`;
  // deno-lint-ignore no-explicit-any
  const liste = hs.map((h: any) => {
    const linjer: string[] = [];
    if (vejr(h.vejr)) linjer.push(`Vejret: ${esc(vejr(h.vejr))}.`);
    if (h.paa_stedet) linjer.push("📷 HRC-Fotos var på stedet.");
    // deno-lint-ignore no-explicit-any
    for (const k of h.kommentarer || []) linjer.push(`<em>kl. ${kl(k.tid)}:</em> ${esc(k.tekst)}`);
    // deno-lint-ignore no-explicit-any
    const nyheder = (h.nyheder || []).filter((n: any) => /^https?:\/\//i.test(n.url));
    // deno-lint-ignore no-explicit-any
    if (nyheder.length) linjer.push(`Læs mere: ${nyheder.map((n: any) => `<a href="${esc(n.url)}" target="_blank" rel="noopener nofollow">${esc(n.kilde || "nyhed")}</a>`).join(" · ")}`);
    return `<h3>kl. ${kl(h.tid)} · ${IKON[gruppe(h)] || "📍"} ${esc(overskrift(h))}${h.sted ? ` – ${esc(h.sted)}` : ""}</h3>`
      + (linjer.length ? `<p>${linjer.join("<br>")}</p>` : "");
  }).join("\n");
  const nav = `<p>← <a href="${WP}/doegnrapport/${flyt(dag, -1)}/">Dagen før</a> · <a href="${WP}/doegnrapport/">Alle døgnrapporter</a>${flyt(dag, 1) < iDag() ? ` · <a href="${WP}/doegnrapport/${flyt(dag, 1)}/">Dagen efter</a> →` : ""}</p>`;
  const fod = `<p><small>Oplysningerne kommer fra offentlige meldinger fra beredskab, politi og trafikinformation og kan være foreløbige. Placeringer er kun by eller område. Vejrdata: MET Norway (CC BY 4.0). Ved akut fare: ring 112.</small></p>`;
  return `${intro}\n${kortLink}\n<h2>Døgnets hændelser</h2>\n${liste}\n${nav}\n${fod}`;
}
const iDag = () => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());

let forælder: number | null = null;
async function forælderId() {
  if (forælder) return forælder;
  const l = await wp("pages?slug=doegnrapport&status=publish&_fields=id");
  if (!l[0]?.id) throw new Error('Siden "Døgnrapport" (slug doegnrapport) findes ikke på WordPress.');
  return (forælder = l[0].id);
}

async function lavSide(dag: string) {
  const { data, error } = await db.rpc("doegnrapport", { dag });
  if (error) throw new Error(error.message);
  const n = (data?.haendelser || []).length;
  if (n < MIN_HAENDELSER) return { dag, sprunget_over: true, haendelser: n };
  const parent = await forælderId();
  const dt = dagTekst(dag);
  const titel = `Døgnrapport ${dt} – ${n} hændelser`;
  // menu_order: nyeste dag først i listen på "Døgnrapport"-siden (sidelisten sorteres efter menu_order)
  const side = { title: titel, slug: dag, parent, status: "publish", content: sideIndhold(dag, data), comment_status: "closed",
    menu_order: 100000 - Math.round(Date.parse(dag + "T12:00:00Z") / 864e5) };
  const findes = await wp(`pages?slug=${dag}&parent=${parent}&status=any&_fields=id`);
  const r = findes[0]?.id
    ? await wp(`pages/${findes[0].id}`, { method: "POST", body: JSON.stringify(side) })
    : await wp("pages", { method: "POST", body: JSON.stringify(side) });
  return { dag, haendelser: n, id: r.id, link: r.link, ny: !findes[0]?.id };
}

Deno.serve(async (req) => {
  if (!(await adgang(req))) return json({ ok: false, fejl: "Ikke adgang" }, 401);
  if (!BRUGER || !KODE) return json({ ok: false, fejl: "WP_BRUGER og WP_APP_KODE mangler i Supabase → Edge Functions → Secrets." }, 503);
  const body = await req.json().catch(() => ({}));
  const dage: string[] = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(body.dag || "")) dage.push(body.dag);
  else {
    const antal = Math.min(Math.max(parseInt(body.dage, 10) || 1, 1), 60);
    for (let i = antal; i >= 1; i--) dage.push(flyt(iDag(), -i));   // i går og bagud – en færdig dag ad gangen
  }
  const resultat = [];
  for (const d of dage) {
    try { resultat.push(await lavSide(d)); } catch (e) { resultat.push({ dag: d, fejl: String((e as Error).message || e) }); }
  }
  return json({ ok: resultat.every((r) => !("fejl" in r)), resultat });
});
