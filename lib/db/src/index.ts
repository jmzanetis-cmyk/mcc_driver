import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

/**
 * Resolves the Postgres connection URL to use.
 *
 * Priority:
 *  1. SUPABASE_DATABASE_URL — if it looks like a full connection URI, use it directly.
 *  2. SUPABASE_DATABASE_URL as password — if it's not a URI, treat it as the DB password
 *     and construct the Supabase Session Pooler URL from VITE_SUPABASE_URL + SUPABASE_DB_REGION.
 *  3. DATABASE_URL — fallback (Replit built-in Postgres, used in local dev).
 */
function resolveDbUrl(): string {
  const raw = process.env.SUPABASE_DATABASE_URL;

  if (raw) {
    if (raw.startsWith("postgresql://") || raw.startsWith("postgres://")) {
      return raw;
    }

    // Treat SUPABASE_DATABASE_URL as the DB password and construct the pooler URL.
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const region = process.env.SUPABASE_DB_REGION;

    if (supabaseUrl && region) {
      const projectRef = supabaseUrl
        .replace("https://", "")
        .replace(/\.supabase\.co.*/, "");
      return (
        `postgresql://postgres.${projectRef}:${raw}` +
        `@${region}.pooler.supabase.com:6543/postgres?sslmode=require`
      );
    }
  }

  const fallback = process.env.DATABASE_URL;
  if (!fallback) {
    throw new Error(
      "No database URL configured. Set SUPABASE_DATABASE_URL (password or full URI) " +
        "with VITE_SUPABASE_URL + SUPABASE_DB_REGION, or set DATABASE_URL directly.",
    );
  }
  return fallback;
}

const dbUrl = resolveDbUrl();
const isSupabasePooler = dbUrl.includes("pooler.supabase.com");

export const pool = new Pool({
  connectionString: dbUrl,
  ...(isSupabasePooler && { ssl: { rejectUnauthorized: false } }),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
