/**
 * Content-Security-Policy de l'application, à nonce par requête.
 *
 * Le proxy tire un nonce pour chaque requête, le transmet au rendu (en-tête
 * de requête `x-nonce`, et `content-security-policy` d'où Next.js extrait le
 * nonce pour l'apposer sur ses propres scripts) et pose la politique sur la
 * réponse. Le layout racine la recopie en <meta>, car le CDN d'Hostinger
 * remplace l'en-tête (voir app/layout.tsx).
 *
 * Scripts : seuls ceux qui portent le nonce s'exécutent ; 'strict-dynamic'
 * étend la confiance aux morceaux que ces scripts chargent eux-mêmes (le
 * découpage de Next.js). 'self' et 'unsafe-inline' ne servent plus que de
 * repli aux navigateurs antérieurs à CSP 3, qui les ignorent sinon.
 * 'unsafe-eval' n'est accordé qu'en développement (rechargement à chaud de
 * React). Les styles gardent 'unsafe-inline' : les attributs style=… de React
 * ne peuvent pas porter de nonce.
 */
export function buildCsp(nonce: string | undefined, opts: { dev?: boolean; frameAncestors?: boolean } = {}): string {
  const script = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'${opts.dev ? " 'unsafe-eval'" : ""}`
    : `script-src 'self' 'unsafe-inline'${opts.dev ? " 'unsafe-eval'" : ""}`;
  return [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    script,
    "worker-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Ignorées en <meta> : réservées à l'en-tête HTTP.
    ...(opts.frameAncestors ? ["frame-ancestors 'none'"] : []),
    ...(opts.frameAncestors && process.env.CSP_REPORT_URI ? [`report-uri ${process.env.CSP_REPORT_URI}`] : []),
  ].join("; ");
}

/** Nonce aléatoire de 128 bits, en base64. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
