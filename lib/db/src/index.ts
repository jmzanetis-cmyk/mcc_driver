import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});
export const db = drizzle(pool, { schema });

export * from "./schema";
