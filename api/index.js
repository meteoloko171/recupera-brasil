// Plain JavaScript on purpose: this file just re-exports the pre-bundled
// Express app (built by `artifacts/api-server/build-vercel.mjs`) so Vercel's
// Node.js function builder never has to compile the multi-file TypeScript
// source directly — that source doesn't use explicit ".js" extensions on
// relative imports, which Vercel's stricter (node16/nodenext) TypeScript
// settings reject.
//
// Named `index.js` (not `[...path].js`) on purpose: `[...param]` catch-all
// filename syntax is a Next.js routing convention. This project has no
// framework preset ("Other"), so Vercel's generic function router treats
// `[...path]` as a literal single dynamic segment instead of a catch-all —
// every nested route (e.g. /api/admin/auth/login) 404s. Instead, every
// /api/* request is rewritten to this fixed function in vercel.json, and
// Express itself does the path routing from the untouched original URL.
import app from "../artifacts/api-server/dist-vercel/app.mjs";

export default app;
