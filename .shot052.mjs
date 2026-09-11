import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./scripts/local-only.mjs";
requireLocalDb("shot052");
const BASE = process.env.BASE, S = process.env.AUTH_SECRET, KEY = "ui_v3_enabled";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-052";
const WHICH = (process.env.WHICH ?? "").split(",").filter(Boolean);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sql = async (t,p=[]) => (await pool.query(t,p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({...u, exp: Math.floor(Date.now()/1000)+3600})).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };
mkdirSync(OUT, { recursive: true });
const before = (await sql(`SELECT value FROM config WHERE key=$1`,[KEY]))[0];
let b;
try {
  await sql(`INSERT INTO config (key,value) VALUES ($1, to_jsonb(true)) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,[KEY]);
  const me = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id=a.actor_id WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-proxy-server","--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1150 } });
  await ctx.addCookies([{ name:"tb_session", domain:"127.0.0.1", path:"/", value: tok({id:me.id,actorId:me.id,name:"권정혁",role:me.role,adminGrant:me.admin_grant,email:"x@x"}) }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("  PAGEERROR:", e.message));
  for (const spec of WHICH) {
    const [name, url] = spec.split(":");
    const r = await p.goto(BASE+url, { waitUntil:"networkidle" });
    await p.waitForTimeout(1800);
    await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log(name, url, r?.status());
  }
  await ctx.close();
} finally {
  if (before === undefined) await pool.query(`DELETE FROM config WHERE key=$1`,[KEY]);
  else await pool.query(`INSERT INTO config (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,[KEY,before.value]);
  console.log("스위치 되돌림:", (await pool.query(`SELECT value FROM config WHERE key=$1`,[KEY])).rows[0] ?? "(행 없음)");
  await b?.close(); await pool.end();
}
