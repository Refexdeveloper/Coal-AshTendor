import { Router, type Request } from "express";

/** Public base URL for this request (same origin the other app should call). */
function baseUrl(req: Request) {
  const configured = (process.env.APP_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:4000";
  const proto = req.get("x-forwarded-proto") || (req.secure ? "https" : "http");
  return `${proto}://${host}`;
}

type PathItem = Record<string, unknown>;

const bearer = [{ bearerAuth: [] as string[] }];
const jsonOk = { "200": { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } };
const unauthorized = { "401": { description: "Missing or revoked token / session", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } };
const notFound = { "404": { description: "Not found" } };
const forbidden = { "403": { description: "Not allowed for this role" } };
const fileOk = {
  "200": {
    description: "File bytes",
    content: {
      "application/pdf": { schema: { type: "string", format: "binary" } },
      "application/octet-stream": { schema: { type: "string", format: "binary" } },
    },
  },
};

function get(tag: string, summary: string, opts: { security?: unknown[]; params?: unknown[]; responses?: Record<string, unknown>; description?: string } = {}): PathItem {
  return {
    get: {
      tags: [tag],
      summary,
      description: opts.description,
      security: opts.security === undefined ? bearer : opts.security,
      parameters: opts.params,
      responses: { ...jsonOk, ...unauthorized, ...(opts.responses || {}) },
    },
  };
}

function post(tag: string, summary: string, opts: { security?: unknown[]; params?: unknown[]; body?: unknown; responses?: Record<string, unknown>; description?: string } = {}): PathItem {
  return {
    post: {
      tags: [tag],
      summary,
      description: opts.description,
      security: opts.security === undefined ? bearer : opts.security,
      parameters: opts.params,
      requestBody: opts.body,
      responses: { ...jsonOk, ...unauthorized, ...(opts.responses || {}) },
    },
  };
}

function idParam(name: string, description: string) {
  return { name, in: "path", required: true, schema: { type: "string" }, description };
}

function query(name: string, description: string, type = "string") {
  return { name, in: "query", required: false, schema: { type }, description };
}

const multipart = (properties: Record<string, unknown>, required?: string[]) => ({
  required: true,
  content: {
    "multipart/form-data": {
      schema: { type: "object", required, properties, additionalProperties: true },
    },
  },
});

const formUrl = (properties: Record<string, unknown>, required?: string[]) => ({
  required: true,
  content: {
    "application/x-www-form-urlencoded": {
      schema: { type: "object", required, properties, additionalProperties: true },
    },
    "multipart/form-data": {
      schema: { type: "object", required, properties, additionalProperties: true },
    },
  },
});

/** Every named POST /api/actions/<name> the server registers. */
const ACTION_DOCS: { name: string; summary: string; tag: string; fields?: Record<string, unknown>; files?: boolean; admin?: boolean }[] = [
  { name: "create-tender", summary: "Create a tender", tag: "Actions — tenders", fields: { projectName: { type: "string" }, clientName: { type: "string" }, portalName: { type: "string" }, tenderRef: { type: "string" }, externalTenderId: { type: "string" } }, files: true },
  { name: "create-sample", summary: "Create a sample tender", tag: "Actions — tenders" },
  { name: "update-fields", summary: "Save tender field values", tag: "Actions — tenders", fields: { tenderId: { type: "string" } } },
  { name: "task", summary: "Complete or advance a workflow task", tag: "Actions — tenders", fields: { tenderId: { type: "string" }, intent: { type: "string" }, taskId: { type: "string" } }, files: true },
  { name: "reextract-documents", summary: "Re-run OCR on tender documents", tag: "Actions — tenders", fields: { tenderId: { type: "string" } } },
  { name: "delete-tender", summary: "Delete one tender", tag: "Actions — admin", fields: { tenderId: { type: "string" } }, admin: true },
  { name: "clear-tenders", summary: "Delete all tenders", tag: "Actions — admin", fields: { confirm: { type: "string", description: "Type REMOVE" } }, admin: true },
  { name: "save-calendar", summary: "Save working calendar", tag: "Actions — admin", admin: true },
  { name: "add-holiday", summary: "Add a holiday", tag: "Actions — admin", fields: { date: { type: "string" }, name: { type: "string" } }, admin: true },
  { name: "delete-holiday", summary: "Remove a holiday", tag: "Actions — admin", fields: { id: { type: "string" } }, admin: true },
  { name: "save-sla", summary: "Save stage SLAs", tag: "Actions — admin", admin: true },
  { name: "save-settings", summary: "Save assignments and escalation", tag: "Actions — admin", admin: true },
  { name: "save-template", summary: "Save an email template", tag: "Actions — admin", fields: { event: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, admin: true },
  { name: "add-user", summary: "Add a person", tag: "Actions — admin", fields: { name: { type: "string" }, email: { type: "string" }, role: { type: "string" } }, admin: true },
  { name: "update-user-access", summary: "Change role / can-sign-in / phone", tag: "Actions — admin", fields: { userId: { type: "string" }, role: { type: "string" }, allow: { type: "string" }, phone: { type: "string" } }, admin: true },
  { name: "create-api-token", summary: "Create a non-expiring API token", tag: "Actions — admin", fields: { name: { type: "string" }, userId: { type: "string" } }, admin: true },
  { name: "revoke-api-token", summary: "Revoke an API token", tag: "Actions — admin", fields: { id: { type: "string" } }, admin: true },
  { name: "sync-refexone-users", summary: "Sync people from Refex One", tag: "Actions — admin", admin: true },
  { name: "resend-email", summary: "Resend a logged email", tag: "Actions — admin", fields: { id: { type: "string" } }, admin: true },
  { name: "send-today-report", summary: "Send today's report email", tag: "Actions — admin", admin: true },
  { name: "save-portal", summary: "Save / add a portal", tag: "Actions — portals" },
  { name: "toggle-portal", summary: "Enable or pause a portal", tag: "Actions — portals", fields: { portalId: { type: "string" } } },
  { name: "log-exception", summary: "Log a crawler exception", tag: "Actions — portals" },
  { name: "ingest-discovered", summary: "Ingest a discovered tender", tag: "Actions — portals" },
  { name: "gem", summary: "GeM watch actions (run, import, ignore, send-line, restore…)", tag: "Actions — portals", fields: { intent: { type: "string" }, bidId: { type: "string" }, line: { type: "string" } }, files: true },
  { name: "site-watch", summary: "Website search actions (run, import, ignore, send-line, restore…)", tag: "Actions — portals", fields: { intent: { type: "string" }, siteTenderId: { type: "string" }, line: { type: "string" }, docToken: { type: "string" } }, files: true },
  { name: "import-bonds", summary: "Import surety bonds", tag: "Actions — bonds & BG", files: true },
  { name: "import-guarantees", summary: "Import bank guarantees", tag: "Actions — bonds & BG", files: true },
  { name: "add-guarantee", summary: "Add a bank guarantee row", tag: "Actions — bonds & BG" },
  { name: "update-guarantee", summary: "Update a bank guarantee", tag: "Actions — bonds & BG" },
  { name: "guarantee-status", summary: "Set BG status", tag: "Actions — bonds & BG" },
  { name: "upload-bg-documents", summary: "Upload BG scans", tag: "Actions — bonds & BG", files: true },
  { name: "delete-guarantee", summary: "Delete one bank guarantee", tag: "Actions — bonds & BG", fields: { id: { type: "string" } }, admin: true },
  { name: "clear-guarantees", summary: "Clear the BG register", tag: "Actions — bonds & BG", admin: true },
  { name: "update-bond", summary: "Update a surety bond", tag: "Actions — bonds & BG" },
  { name: "upload-bond-documents", summary: "Upload ISB / bond documents", tag: "Actions — bonds & BG", files: true },
  { name: "delete-bond", summary: "Delete one surety bond", tag: "Actions — bonds & BG", fields: { id: { type: "string" } }, admin: true },
  { name: "clear-bonds", summary: "Clear the bond register", tag: "Actions — bonds & BG", admin: true },
  { name: "update-emd", summary: "Update EMD register fields", tag: "Actions — EMD" },
  { name: "convert-emd-sd", summary: "Convert EMD to security deposit", tag: "Actions — EMD" },
];

function actionPaths(): Record<string, PathItem> {
  const paths: Record<string, PathItem> = {};
  for (const action of ACTION_DOCS) {
    const properties: Record<string, unknown> = { ...(action.fields || {}) };
    if (action.files) properties.files = { type: "array", items: { type: "string", format: "binary" } };
    paths[`/actions/${action.name}`] = post(action.tag, action.summary, {
      description: action.admin ? "ADMIN only." : undefined,
      body: Object.keys(properties).length ? multipart(properties) : formUrl({}),
      responses: { ...(action.admin ? forbidden : {}), "404": { description: "Unknown action" } },
    });
  }
  return paths;
}

/** OpenAPI 3 description of every API on this server. */
export function openApiDocument(req: Request) {
  const server = baseUrl(req);
  const paths: Record<string, PathItem> = {
    "/health": get("System", "Health check", { security: [] }),
    "/openapi.json": get("System", "This OpenAPI document", { security: [] }),
    "/docs": get("System", "Swagger UI page", { security: [], responses: { "200": { description: "HTML" } } }),

    "/auth/login": post("Auth", "Password sign-in (sets session cookie)", {
      security: [],
      body: formUrl({ email: { type: "string" }, password: { type: "string" } }, ["email", "password"]),
    }),
    "/auth/logout": post("Auth", "Clear session cookie", { security: [] }),
    "/auth/login-as": post("Auth", "Impersonate a user", {
      description: "ADMIN only. Sets a session cookie as that person.",
      body: formUrl({ userId: { type: "string" } }, ["userId"]),
      responses: forbidden,
    }),
    "/auth/team": get("Auth", "Demo team list", { security: [] }),
    "/auth/refexone/saml/acs": post("Auth", "Refex One SAML ACS callback", {
      security: [],
      description: "Browser SSO callback from Refex One. Not for API clients.",
    }),

    "/me": get("Session", "Who the token / session acts as, plus open tasks"),
    "/dashboard": get("Tenders", "Pipeline dashboard"),
    "/worklist": get("Tenders", "Worklist for the signed-in person"),
    "/register": get("Tenders", "Tender register"),
    "/tenders/{id}": {
      ...get("Tenders", "One tender (fields, documents, tasks)", {
        params: [idParam("id", "Tender id")],
        responses: notFound,
      }),
    },
    "/tenders/{id}/gem-result": get("Tenders", "GeM bid result for a tender", {
      params: [idParam("id", "Tender id")],
      responses: notFound,
    }),

    "/documents/{id}": {
      get: {
        tags: ["Documents"],
        summary: "Download a stored tender document",
        security: bearer,
        parameters: [idParam("id", "TenderDocument id")],
        responses: { ...fileOk, ...unauthorized, ...notFound },
      },
    },
    "/bond-documents/{id}": {
      get: {
        tags: ["Documents"],
        summary: "Download an ISB / surety bond document",
        security: bearer,
        parameters: [idParam("id", "BondDocument id"), query("download", "1 to force download")],
        responses: { ...fileOk, ...unauthorized, ...notFound },
      },
    },
    "/bg-documents/{id}": {
      get: {
        tags: ["Documents"],
        summary: "Download a bank-guarantee scan",
        security: bearer,
        parameters: [idParam("id", "BgDocument id"), query("download", "1 to force download")],
        responses: { ...fileOk, ...unauthorized, ...notFound },
      },
    },
    "/gem-bids/{id}/document": {
      get: {
        tags: ["Documents"],
        summary: "GeM bid PDF (fetched from GeM)",
        security: bearer,
        parameters: [idParam("id", "GemBid id")],
        responses: { ...fileOk, ...unauthorized, ...notFound },
      },
    },
    "/gem-bids/{id}/links": get("Documents", "Documents linked from a GeM bid PDF", {
      params: [idParam("id", "GemBid id")],
      responses: notFound,
    }),
    "/gem-bids/{id}/linked/{index}": {
      get: {
        tags: ["Documents"],
        summary: "One linked GeM document by index",
        security: bearer,
        parameters: [idParam("id", "GemBid id"), idParam("index", "0-based index"), query("download", "1 to force download")],
        responses: { ...fileOk, ...unauthorized, ...notFound },
      },
    },
    "/gem-bids/{id}/result": get("Portals", "GeM bid opening / result", {
      params: [idParam("id", "GemBid id")],
      responses: notFound,
    }),
    "/ocr-files/{token}/{fileName}": {
      get: {
        tags: ["Documents"],
        summary: "OCR service download link (signed token)",
        security: [],
        description: "Public on purpose: the token is the access check.",
        parameters: [idParam("token", "Signed OCR token"), idParam("fileName", "File name")],
        responses: { ...fileOk, ...notFound },
      },
    },

    "/portals": get("Portals", "Portals page: GeM + website search results"),
    "/site-tenders/{id}/details": get("Portals", "Cached portal page details for a website result", {
      params: [idParam("id", "SiteTender id")],
      responses: notFound,
    }),
    "/site-tenders/{id}/documents/start": post("Portals", "Start a portal document session", {
      params: [idParam("id", "SiteTender id")],
    }),
    "/site-tenders/{id}/documents/unlock": post("Portals", "Unlock portal documents with CAPTCHA / code", {
      params: [idParam("id", "SiteTender id")],
      body: formUrl({ captcha: { type: "string" }, code: { type: "string" } }),
    }),
    "/site-tenders/{id}/documents/{token}/{index}/attach": post("Portals", "Attach one portal document to the tender", {
      params: [idParam("id", "SiteTender id"), idParam("token", "Session token"), idParam("index", "Document index")],
    }),
    "/site-tenders/{id}/documents/{token}/{index}": {
      get: {
        tags: ["Portals"],
        summary: "Download one portal document from a session",
        security: bearer,
        parameters: [
          idParam("id", "SiteTender id"),
          idParam("token", "Session token"),
          idParam("index", "Document index"),
          query("download", "1 to force download"),
        ],
        responses: { ...fileOk, ...unauthorized, ...notFound },
      },
    },

    "/admin": get("Admin", "Administration payload (calendar, people, API tokens, SSO…)", {
      responses: forbidden,
      description: "ADMIN only.",
    }),
    "/emd-board": get("EMD", "EMD board rows"),
    "/bonds": get("Bonds & BG", "Surety bond register"),
    "/bonds/{id}": get("Bonds & BG", "One surety bond", { params: [idParam("id", "Bond id")], responses: notFound }),
    "/guarantees": get("Bonds & BG", "Bank guarantee register"),
    "/guarantees/{id}": get("Bonds & BG", "One bank guarantee", { params: [idParam("id", "BG id")], responses: notFound }),

    "/reports": get("Reports & logs", "Reports landing data"),
    "/reports/users": get("Reports & logs", "User activity report"),
    "/reports/today": get("Reports & logs", "Today's report (HTML / JSON)"),
    "/reports/today.csv": {
      get: {
        tags: ["Reports & logs"],
        summary: "Today's report as CSV / Excel sheet",
        security: bearer,
        responses: {
          "200": { description: "CSV", content: { "text/csv": { schema: { type: "string" } } } },
          ...unauthorized,
        },
      },
    },
    "/notifications": get("Reports & logs", "In-app notifications"),
    "/email-logs": get("Reports & logs", "Email log"),
    "/email-logs/{id}": get("Reports & logs", "One email log entry", { params: [idParam("id", "NotificationLog id")], responses: notFound }),
    "/whatsapp-logs": get("Reports & logs", "WhatsApp log"),

    ...actionPaths(),
  };

  // Merge GET+POST when both exist on the same path (site-tenders documents paths are separate).
  return {
    openapi: "3.0.3",
    info: {
      title: "Coal & Ash API",
      version: "1.0.0",
      description:
        "All HTTP APIs on this server.\n\n" +
        "**Auth:** create a non-expiring token under Administration → API tokens, then click **Authorize** and paste `ca_…` as Bearer.\n\n" +
        "Browser cookie / Refex One sign-in still works for the web app. Bearer is for other apps.",
    },
    servers: [{ url: `${server}/api`, description: "This server" }],
    tags: [
      { name: "System" },
      { name: "Auth" },
      { name: "Session" },
      { name: "Tenders" },
      { name: "Documents" },
      { name: "Portals" },
      { name: "EMD" },
      { name: "Bonds & BG" },
      { name: "Admin" },
      { name: "Reports & logs" },
      { name: "Actions — tenders" },
      { name: "Actions — portals" },
      { name: "Actions — EMD" },
      { name: "Actions — bonds & BG" },
      { name: "Actions — admin" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API token",
          description: "Token from Administration → API tokens (starts with ca_). Does not expire until revoked.",
        },
      },
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" } } },
        ActionResult: {
          type: "object",
          properties: {
            ok: { type: "string" },
            error: { type: "string" },
            tenderId: { type: "string" },
            apiToken: { type: "string", description: "Returned once when creating an API token" },
          },
        },
      },
    },
    security: bearer,
    paths,
  };
}

export const openapi = Router();

openapi.get("/openapi.json", (req, res) => {
  res.json(openApiDocument(req));
});

/** Swagger UI (CDN). Authorize with the API token to try calls. */
openapi.get("/docs", (req, res) => {
  const specUrl = `${baseUrl(req)}/api/openapi.json`;
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Coal &amp; Ash API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
  <style>body{margin:0} .topbar{display:none} .swagger-ui .info{margin:20px 0}</style>
</head>
<body>
  <div id="swagger"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: ${JSON.stringify(specUrl)},
      dom_id: "#swagger",
      persistAuthorization: true,
      tryItOutEnabled: true,
      deepLinking: true,
      docExpansion: "list",
      defaultModelsExpandDepth: -1,
      tagsSorter: "alpha",
      operationsSorter: "alpha",
    });
  </script>
</body>
</html>`);
});
