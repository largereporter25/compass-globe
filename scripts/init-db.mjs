// One-off schema bootstrap: `npm run db:init`
import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const ddl = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

for (const stmt of ddl.split(";").map((s) => s.trim()).filter(Boolean)) {
  await sql(stmt);
  console.log("ok:", stmt.split("\n")[0].slice(0, 70));
}
console.log("\nSchema ready.");
