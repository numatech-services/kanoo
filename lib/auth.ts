import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs"; // Attention à l'import ici pour Node.js récent
import crypto from "crypto";
import { NextRequest } from "next/server";
import { UserRole, TenantType } from "@/types";

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

/**
 * Résout le secret JWT au moment de l'utilisation (et non à l'import, pour ne
 * pas faire échouer le build). Refuse tout secret absent ou trop court en
 * production. En développement, un secret de repli explicite est toléré.
 */
function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 32 && s !== "CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS") return s;
  if (process.env.NODE_ENV !== "production") {
    return "dev-only-insecure-secret-0000000000000000000000000000";
  }
  throw new Error(
    "JWT_SECRET manquant ou invalide : au moins 32 caractères requis. Authentification refusée."
  );
}

export interface TokenPayload {
  userId: string;
  tenantId: string;
  tenantType: TenantType;
  role: UserRole;
  email: string;
  subscriptionStatus: "active" | "trial" | "suspended" | "none";
  planModules: string[];
  allowedResources?: string[];
  sessionVersion?: number;
  iat?: number;
  exp?: number;
  // iat et exp étaient en double ici, j'ai supprimé la répétition
}

export function signToken(payload: Omit<TokenPayload, "iat" | "exp">): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: "HS256",
  } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  // Algorithme épinglé : empêche toute confusion d'algorithme.
  return jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as TokenPayload;
}

export function getTokenFromRequest(req: NextRequest): string | null {
  // 1. Authorization header (Bearer)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  // 2. Cookie - Vérifie que le nom du cookie correspond à celui défini dans ton login
  const cookie = req.cookies.get("auth_token");
  return cookie?.value || null;
}

/** * Correction pour bcryptjs : 
 * Utilisation de l'accès sécurisé au module pour éviter "bcrypt.hash is not a function"
 */
export async function hashPassword(password: string): Promise<string> {
  const b = (bcrypt as any).default || bcrypt;
  return b.hash(password, 12);
}

export async function comparePassword(
  plain: string,
  hashed: string
): Promise<boolean> {
  const b = (bcrypt as any).default || bcrypt;
  return b.compare(plain, hashed);
}

export function generateSecureToken(length = 48): string {
  // Générateur cryptographique (remplace Math.random, prévisible).
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

export function generateCsrfToken(): string {
  return generateSecureToken(32);
}

/**
 * Jeton de défi 2FA (5 min) émis après le mot de passe, en attendant le code.
 * Signé avec un secret DÉRIVÉ : il ne peut donc jamais servir de session valide
 * (verifyToken, qui utilise le secret de base, le rejette).
 */
export function signTwoFactorChallenge(userId: string): string {
  return jwt.sign({ uid: userId, purpose: "2fa" }, getJwtSecret() + ":2fa", {
    expiresIn: "5m",
    algorithm: "HS256",
  });
}

export function verifyTwoFactorChallenge(token: string): { uid: string } | null {
  try {
    const d = jwt.verify(token, getJwtSecret() + ":2fa", { algorithms: ["HS256"] }) as { uid?: string; purpose?: string };
    if (d.purpose !== "2fa" || !d.uid) return null;
    return { uid: d.uid };
  } catch {
    return null;
  }
}