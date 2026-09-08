import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function secret() {
  return process.env.SESSION_SECRET || "development-session-secret";
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function getCookie(req: Request, name: string) {
  const header = req.headers.cookie || "";
  const pair = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

export function hasAdminCredentials() {
  return Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD);
}

export function checkAdminCredentials(username: string, password: string) {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPassword || username !== expectedUser || password !== expectedPassword) return false;
  return true;
}

export function setAdminSession(res: Response) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `admin:${expiresAt}`;
  const token = `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

export function clearAdminSession(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

export function isAdminSessionValid(req: Request) {
  const token = getCookie(req, COOKIE_NAME);
  if (!token) return false;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;
  try {
    const payload = Buffer.from(encoded, "base64url").toString("utf8");
    const expectedSignature = sign(payload);
    const signaturesMatch = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    const [, expiresAt] = payload.split(":");
    return signaturesMatch && payload.startsWith("admin:") && Number(expiresAt) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!isAdminSessionValid(req)) {
    res.status(401).json({ success: false, error: "Sessão administrativa expirada." });
    return;
  }
  next();
}