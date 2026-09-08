import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Serverless platforms (Vercel) spin up many short-lived function instances,
// so each one should hold very few connections and rely on the database's
// own pooler (e.g. Neon's pooled connection string) for fan-out. A
// long-running server (Replit) can keep the default, larger pool.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.VERCEL ? 1 : 10,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
