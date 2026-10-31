import { X509Certificate, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import type { Request } from "express";
import { SAML, ValidateInResponseTo, generateServiceProviderMetadata, type Profile } from "@node-saml/node-saml";
import { db } from "../db";
import { recordRefexOnePerson } from "./accounts";

const EMAIL_CLAIMS = [
  "email",
  "mail",
  "urn:oid:0.9.2342.19200300.100.1.3",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
];

/** The Refex One SAML app for Coal & Ash: its sign-in address, and the Cloud Run address it is registered with. */
const REFEXONE_SSO_URL = "https://refexone.com/api/saml/055e4c63-8c36-46f6-bf2f-e67a84db362d/sso";
const REGISTERED_BASE_URL = "https://coal-ash-tender-api-645830234926.asia-south1.run.app";

/**
 * Refex One's signing certificate for this SAML app (public, not a secret). Paste the whole PEM between the
 * backticks, from the app's settings in Refex One ("IdP certificate" / "X.509 certificate"). Sign-in stays off
 * until it is here: every response is checked against it, so a response Refex One did not sign is refused.
 */
/**
 * The same certificate pinned by its SHA-256 fingerprint ("Security Key (Certificate Fingerprint SHA256)" in Refex One).
 * Used when the full certificate above is empty: the certificate Refex One sends inside each response is accepted
 * only when its fingerprint is exactly this one, and the response's signature is then checked with it.
 */
const REFEXONE_IDP_CERT_SHA256 = "70508ed51cac8cf9ed778943ac54e2f72e6197439cccd4897abd7fbe2d72fd8f";

const REFEXONE_IDP_CERT = `
-----BEGIN CERTIFICATE-----
-----END CERTIFICATE-----
`;

/**
 * Public origin used for the Entity ID and reply (ACS) address. Always the registered Cloud Run address,
 * so the Entity ID is https://coal-ash-tender-api-645830234926.asia-south1.run.app/auth/refexone/saml
 * wherever the request came from. REFEXONE_BASE_URL overrides it (for example, a custom domain later).
 */
export function publicBase(_req?: Request) {
  return (process.env.REFEXONE_BASE_URL || REGISTERED_BASE_URL).replace(/\/$/, "");
}

export function refexOneUrls(req: Request) {
  const base = publicBase(req);
  return {
    metadata: `${base}/auth/refexone/saml`,
    acs: `${base}/api/auth/refexone/saml/acs`,
    launch: `${base}/auth/refexone/launch`,
  };
}

/**
 * Refex One's sign-in address: the Coal & Ash app above, unless REFEXONE_SSO_URL or REFEXONE_SAML_APP_ID
 * (which gives https://refexone.com/api/saml/<id>/sso) overrides it.
 */
export function ssoUrl() {
  const direct = (process.env.REFEXONE_SSO_URL || "").trim();
  if (direct) return direct;
  const appId = (process.env.REFEXONE_SAML_APP_ID || "").trim();
  if (!appId) return REFEXONE_SSO_URL;
  const api = (process.env.REFEXONE_API_URL || "https://refexone.com/api").replace(/\/$/, "");
  return `${api}/saml/${encodeURIComponent(appId)}/sso`;
}

/** Refex One's signing certificate: the one in the code above, else REFEXONE_IDP_CERT or a PEM file at REFEXONE_IDP_CERT_FILE. */
function idpCert() {
  const inCode = REFEXONE_IDP_CERT.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").trim() ? REFEXONE_IDP_CERT.trim() : "";
  let raw = inCode || process.env.REFEXONE_IDP_CERT || "";
  const file = (process.env.REFEXONE_IDP_CERT_FILE || "").trim();
  if (!raw.trim() && file) {
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      raw = "";
    }
  }
  const text = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  const body = text.trim();
  if (!body) return "";
  if (body.includes("BEGIN CERTIFICATE")) return body;
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
}

/** The pinned fingerprint as 64 lowercase hex characters, or "" when none is set. */
function pinnedFingerprint() {
  const value = REFEXONE_IDP_CERT_SHA256.replace(/[^0-9a-f]/gi, "").toLowerCase();
  return value.length === 64 ? value : "";
}

const fingerprintOf = (pem: string) => new X509Certificate(pem).fingerprint256.replace(/:/g, "").toLowerCase();

/**
 * Takes the certificate Refex One embedded in a sign-in response, if its SHA-256 fingerprint is the pinned one.
 * Returns "" otherwise. The signature is checked afterwards with this certificate, so a forged response that
 * copies the certificate still fails: it cannot be signed without Refex One's private key.
 */
function pinnedCertFrom(samlResponse: string) {
  const pin = pinnedFingerprint();
  if (!pin) return "";
  let xml = "";
  try {
    xml = Buffer.from(samlResponse.replace(/\s/g, ""), "base64").toString("utf8");
  } catch {
    return "";
  }
  for (const match of xml.matchAll(/<(?:[\w-]+:)?X509Certificate[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?X509Certificate>/g)) {
    const body = match[1].replace(/\s/g, "");
    if (!body) continue;
    const pem = `-----BEGIN CERTIFICATE-----\n${(body.match(/.{1,64}/g) ?? []).join("\n")}\n-----END CERTIFICATE-----`;
    try {
      const print = fingerprintOf(pem);
      if (print.length === pin.length && timingSafeEqual(Buffer.from(print), Buffer.from(pin))) return pem;
    } catch {
      // not a readable certificate; try the next one
    }
  }
  return "";
}

export function refexOneReady() {
  return Boolean(ssoUrl() && (certInfo() || pinnedFingerprint()));
}

/** The configured certificate's subject and validity, or null when it is missing or unreadable. */
function certInfo() {
  const pem = idpCert();
  if (!pem) return null;
  try {
    const cert = new X509Certificate(pem);
    return { subject: cert.subject.replace(/\n/g, ", "), validTo: new Date(cert.validTo), expired: new Date(cert.validTo).getTime() < Date.now() };
  } catch {
    return null;
  }
}

/** What the admin screen shows: what is set, what is missing, and the addresses to register in Refex One. */
export function ssoStatus(req: Request) {
  const urls = refexOneUrls(req);
  const cert = certInfo();
  const certGiven = Boolean(idpCert());
  const missing: string[] = [];
  if (!ssoUrl()) missing.push("the Refex One sign-in address (REFEXONE_SSO_URL in server/src/services/refexone.ts)");
  const pin = pinnedFingerprint();
  if (!certGiven && !pin) missing.push("Refex One's signing certificate or its SHA-256 fingerprint (REFEXONE_IDP_CERT or REFEXONE_IDP_CERT_SHA256 in server/src/services/refexone.ts)");
  else if (certGiven && !cert) missing.push("a valid certificate in REFEXONE_IDP_CERT (server/src/services/refexone.ts): the text there is not a readable certificate");
  if (cert && pin && fingerprintOf(idpCert()) !== pin) missing.push("a matching certificate: the certificate in REFEXONE_IDP_CERT does not have the SHA-256 fingerprint in REFEXONE_IDP_CERT_SHA256");
  return {
    ready: refexOneReady() && !missing.length,
    ssoUrl: ssoUrl(),
    cert: cert ? { subject: cert.subject, validTo: cert.validTo, expired: cert.expired } : null,
    fingerprint: pin ? pin.match(/.{2}/g)!.join(":").toUpperCase() : "",
    missing,
    register: { entityId: urls.metadata, acsUrl: urls.acs, launchUrl: urls.launch, nameIdFormat: "Email address" },
  };
}

function samlFor(req: Request, cert = idpCert()) {
  const urls = refexOneUrls(req);
  return new SAML({
    issuer: urls.metadata,
    callbackUrl: urls.acs,
    entryPoint: ssoUrl(),
    idpIssuer: (process.env.REFEXONE_IDP_ISSUER || "").trim() || undefined,
    idpCert: cert,
    audience: urls.metadata,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    disableRequestedAuthnContext: true,
    // Refex One may sign the whole response or only the assertion. With these two off, node-saml still demands
    // a valid signature: on the response, or else on the assertion itself. An unsigned response is never accepted.
    wantAuthnResponseSigned: false,
    wantAssertionsSigned: false,
    validateInResponseTo: ValidateInResponseTo.never,
    acceptedClockSkewMs: 5 * 60 * 1000,
  });
}

export function serviceProviderMetadata(req: Request) {
  const urls = refexOneUrls(req);
  return generateServiceProviderMetadata({
    issuer: urls.metadata,
    callbackUrl: urls.acs,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    wantAssertionsSigned: true,
  });
}

export function safeNext(value: unknown, req?: Request) {
  let next = typeof value === "string" ? value.trim() : "";
  // Refex One may send back a full address (IdP-initiated sign-in): keep it only when it is this site.
  if (/^https?:\/\//i.test(next) && req) {
    try {
      const target = new URL(next);
      next = target.origin === new URL(publicBase(req)).origin ? `${target.pathname}${target.search}${target.hash}` : "/";
    } catch {
      next = "/";
    }
  }
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/auth/refexone")) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/api")) return "/";
  return next;
}

/**
 * Link to a page of this app for emails, as in P2P: through Refex One sign-in when it is set up, so a click
 * signs the person in and lands on the page. A plain link when sign-in is not ready.
 */
export function appLink(path: string) {
  const page = safeNext(path);
  const direct = `${(process.env.APP_URL || publicBase()).replace(/\/$/, "")}${page}`;
  if (!refexOneReady()) return direct;
  const url = new URL(ssoUrl());
  url.searchParams.set("RelayState", `${publicBase()}${page}`);
  return url.toString();
}

export async function refexOneLoginUrl(req: Request, next: string) {
  // As in the P2P app: open the Refex One SAML app's sign-in address with the page to come back to.
  const url = new URL(ssoUrl());
  url.searchParams.set("RelayState", `${publicBase(req)}${safeNext(next)}`);
  return url.toString();
}

function claimText(value: unknown) {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === "string" ? item.trim() : "";
}

function displayName(profile: Profile, email: string) {
  const claims = [
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    "displayName",
    "name",
  ];
  for (const key of claims) {
    const text = claimText(profile[key]);
    if (text && !text.includes("@")) return text;
  }
  const given = claimText(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"] || profile.givenName);
  const family = claimText(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"] || profile.sn);
  const combined = [given, family].filter(Boolean).join(" ");
  return combined || email;
}

function emailFrom(profile: Profile) {
  for (const key of EMAIL_CLAIMS) {
    const text = claimText(profile[key]);
    if (text.includes("@")) return text.toLowerCase();
  }
  const nameId = claimText(profile.nameID);
  return nameId.includes("@") ? nameId.toLowerCase() : "";
}

/** Checks the IdP's signed assertion and returns the matching active user. */
export async function consumeRefexOne(req: Request, body: Record<string, string>): Promise<{ error: string } | { userId: string; next: string }> {
  if (!body.SAMLResponse) return { error: "Refex One did not send a sign-in response." };
  if (!refexOneReady()) return { error: "Refex One is not configured on this server." };
  // A pasted certificate is used as it is; otherwise the certificate in the response must match the pinned fingerprint.
  const cert = idpCert() || pinnedCertFrom(body.SAMLResponse);
  if (!cert) return { error: "The certificate in Refex One's response does not match the fingerprint configured for Coal & Ash." };
  const { profile } = await samlFor(req, cert).validatePostResponseAsync(body);
  if (!profile) return { error: "Refex One did not confirm this sign-in." };
  const email = emailFrom(profile);
  if (!email) return { error: "Refex One did not include an email address." };
  let user = await db.user.findFirst({ where: { email } });
  if (!user) user = await recordRefexOnePerson(email, displayName(profile, email));
  if (!user.active) {
    return { error: `${email} is saved from Refex One. An administrator must allow this person to sign in and choose a role.` };
  }
  return { userId: user.id, next: safeNext(body.RelayState, req) };
}
