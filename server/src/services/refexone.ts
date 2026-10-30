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

function idpCert() {
  const raw = process.env.REFEXONE_IDP_CERT || "";
  const text = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  const body = text.trim();
  if (!body) return "";
  if (body.includes("BEGIN CERTIFICATE")) return body;
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
}

export function refexOneReady() {
  return Boolean((process.env.REFEXONE_SSO_URL || "").trim() && idpCert());
}

function samlFor(req: Request) {
  const urls = refexOneUrls(req);
  return new SAML({
    issuer: urls.metadata,
    callbackUrl: urls.acs,
    entryPoint: (process.env.REFEXONE_SSO_URL || "").trim(),
    idpIssuer: (process.env.REFEXONE_IDP_ISSUER || "").trim() || undefined,
    idpCert: idpCert(),
    audience: urls.metadata,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    disableRequestedAuthnContext: true,
    wantAssertionsSigned: true,
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

export function safeNext(value: unknown) {
  const next = typeof value === "string" ? value : "";
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
export async function consumeRefexOne(req: Request, body: Record<string, string>) {
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
  return { userId: user.id, next: safeNext(body.RelayState) };
}
