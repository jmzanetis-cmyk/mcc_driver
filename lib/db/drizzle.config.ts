import { defineConfig } from "drizzle-kit";
import path from "path";

function resolveDbUrl(): string {
  const raw = process.env.SUPABASE_DATABASE_URL;

  if (raw) {
    if (raw.startsWith("postgresql://") || raw.startsWith("postgres://")) {
      return raw;
    }
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

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDbUrl(),
  },
});
