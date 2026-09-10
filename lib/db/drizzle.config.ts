import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Plain relative path on purpose: an absolute path built with
  // `path.join(__dirname, ...)` produces backslashes on Windows, which
  // drizzle-kit's glob matching doesn't handle, and fails with
  // "No schema files found" even though the file exists.
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
