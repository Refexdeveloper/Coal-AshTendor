import { X509Certificate } from "crypto";
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

/** Public origin of this service. Cloud Run's host is used so the registered Refex One URLs stay stable. */
export function publicBase(req: Request) {
  const forced = (process.env.REFEXONE_BASE_URL || "").replace(/\/$/, "");
  if (forced) return forced;
  const host = req.get("host") || "localhost";
  return `${req.protocol}://${host}`;
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
 * Refex One's sign-in address. Either REFEXONE_SSO_URL, or just the SAML app ID from Refex One
 * (REFEXONE_SAML_APP_ID), which gives https://refexone.com/api/saml/<id>/sso as in the P2P app.
 */
export function ssoUrl() {
  const direct = (process.env.REFEXONE_SSO_URL || "").trim();
  if (direct) return direct;
  const appId = (process.env.REFEXONE_SAML_APP_ID || "").trim();
  if (!appId) return "";
  const api = (process.env.REFEXONE_API_URL || "https://refexone.com/api").replace(/\/$/, "");
  return `${api}/saml/${encodeURIComponent(appId)}/sso`;
}

/** Refex One's signing certificate: REFEXONE_IDP_CERT (PEM or one line), or a PEM file at REFEXONE_IDP_CERT_FILE. */
function idpCert() {
  let raw = process.env.REFEXONE_IDP_CERT || "";
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

export function refexOneReady() {
  return Boolean(ssoUrl() && certInfo());
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
  if (!ssoUrl()) missing.push("REFEXONE_SAML_APP_ID (or REFEXONE_SSO_URL)");
  if (!certGiven) missing.push("REFEXONE_IDP_CERT (or REFEXONE_IDP_CERT_FILE)");
  else if (!cert) missing.push("a readable REFEXONE_IDP_CERT (the value is not a valid certificate)");
  return {
    ready: refexOneReady(),
    ssoUrl: ssoUrl(),
    cert: cert ? { subject: cert.subject, validTo: cert.validTo, expired: cert.expired } : null,
    missing,
    register: { entityId: urls.metadata, acsUrl: urls.acs, launchUrl: urls.launch, nameIdFormat: "Email address" },
  };
}

function samlFor(req: Request) {
  const urls = refexOneUrls(req);
  return new SAML({
    issuer: urls.metadata,
    callbackUrl: urls.acs,
    entryPoint: ssoUrl(),
    idpIssuer: (process.env.REFEXONE_IDP_ISSUER || "").trim() || undefined,
    idpCert: idpCert(),
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

export async function refexOneLoginUrl(req: Request, next: string) {
  return samlFor(req).getAuthorizeUrlAsync(safeNext(next), undefined);
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
  const { profile } = await samlFor(req).validatePostResponseAsync(body);
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
