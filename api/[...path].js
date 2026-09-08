// Plain JavaScript on purpose: this file just re-exports the pre-bundled
// Express app (built by `artifacts/api-server/build-vercel.mjs`) so Vercel's
// Node.js function builder never has to compile the multi-file TypeScript
// source directly — that source doesn't use explicit ".js" extensions on
// relative imports, which Vercel's stricter (node16/nodenext) TypeScript
// settings reject.
import app from "../artifacts/api-server/dist-vercel/app.mjs";

export default app;
