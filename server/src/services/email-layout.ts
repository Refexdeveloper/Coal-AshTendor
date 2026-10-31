/**
 * HTML layout for every Coal & Ash email, after the P2P app's workflow mails: Refex One logo, a coloured
 * header with the headline, the tender's key facts, "Completed step" and "Next step" boxes when a step
 * moved, remarks, and one button. Tables and inline styles only, so Outlook and Gmail render it the same.
 */

export const REFEXONE_EMAIL_LOGO_URL = "https://refexone.com/refexone-logo.png";

export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);

export type EmailFacts = { recordId: string; projectName: string; clientName?: string; value?: string; deadline?: string; status?: string };
export type EmailStep = { label: string; note?: string };

export type EmailContent = {
  headline: string;
  /** Opening sentence under the headline. Plain text. */
  intro: string;
  facts?: EmailFacts;
  completed?: EmailStep;
  next?: EmailStep;
  /** Extra paragraphs, plain text with blank lines between them. */
  body?: string;
  remarks?: string;
  /** Files attached to this email, one line each. */
  attachments?: string[];
  cta: { label: string; url: string };
  footer?: string;
  /** Test-mode notice when MAIL_REDIRECT_TO sent this to someone else. */
  banner?: string;
};

function factRow(label: string, value?: string) {
  if (!value) return "";
  return `<tr><td style="padding:3px 0;font-size:13px;color:#78716c;width:130px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:3px 0;font-size:14px;color:#1c1917;font-weight:600;vertical-align:top">${escapeHtml(value)}</td></tr>`;
}

function stepBox(kind: "completed" | "next", step: EmailStep, width: string) {
  const look =
    kind === "completed"
      ? { bg: "#ecfdf5", border: "#bbf7d0", label: "#047857", title: "#047857", note: "#065f46", caption: "Completed step" }
      : { bg: "#eff6ff", border: "#bfdbfe", label: "#1d4ed8", title: "#1e40af", note: "#1e3a8a", caption: "Next step" };
  return `<td width="${width}" valign="top" style="padding:6px;vertical-align:top">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${look.bg};border:1px solid ${look.border};border-radius:10px">
<tr><td valign="top" style="padding:12px 14px;vertical-align:top">
<div style="font-size:10px;color:${look.label};text-transform:uppercase;font-weight:700;letter-spacing:.06em;line-height:1.3">${look.caption}</div>
<div style="font-size:15px;font-weight:800;color:${look.title};margin-top:4px;line-height:1.35">${escapeHtml(step.label)}</div>
${step.note ? `<div style="font-size:12px;color:${look.note};margin-top:4px;line-height:1.4">${escapeHtml(step.note)}</div>` : ""}
</td></tr></table></td>`;
}

export function renderEmail(content: EmailContent) {
  const { facts, completed, next } = content;
  const steps =
    completed || next
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px"><tr>${[
          completed ? stepBox("completed", completed, completed && next ? "50%" : "100%") : "",
          next ? stepBox("next", next, completed && next ? "50%" : "100%") : "",
        ].join("")}</tr></table>`
      : "";
  const paragraphs = (content.body ?? "")
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block) => `<p style="margin:14px 0 0;font-size:14px;line-height:1.55;color:#44403c">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const remarks = content.remarks
    ? `<div style="margin-top:16px;padding:14px;background:#faf8f6;border-radius:8px;border:1px solid #e7e5e4">
<div style="font-size:11px;color:#78716c;text-transform:uppercase;font-weight:700;letter-spacing:.05em">Remarks</div>
<div style="font-size:14px;color:#44403c;margin-top:6px;line-height:1.5">${escapeHtml(content.remarks).replace(/\n/g, "<br>")}</div></div>`
    : "";
  const files = content.attachments?.length
    ? `<div style="margin-top:16px;padding:12px 14px;background:#fffaf5;border-radius:8px;border:1px solid #fde4cc">
<div style="font-size:11px;color:#9a3412;text-transform:uppercase;font-weight:700;letter-spacing:.05em">Attachments</div>
${content.attachments.map((line) => `<div style="font-size:13px;color:#44403c;margin-top:6px">📎 ${escapeHtml(line)}</div>`).join("")}</div>`
    : "";
  const banner = content.banner
    ? `<div style="background:#fff4e6;border:1px solid #f8d9b4;color:#9a4a0b;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px">${escapeHtml(content.banner)}</div>`
    : "";
  const factsBlock = facts
    ? `<div style="font-size:18px;font-weight:700;color:#1c1917;line-height:1.35">${escapeHtml(facts.recordId)} — ${escapeHtml(facts.projectName)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px">${factRow("Client", facts.clientName)}${factRow("Estimated value", facts.value)}${factRow("Bid deadline", facts.deadline)}${factRow("Status", facts.status)}</table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(content.headline)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f5f4f2;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e4;overflow:hidden">
<tr><td style="padding:18px 28px 14px;text-align:center;background:#ffffff">
<img src="${REFEXONE_EMAIL_LOGO_URL}" alt="RefexOne" width="160" style="max-width:160px;width:160px;height:auto;display:inline-block;border:0;outline:none;text-decoration:none" />
</td></tr>
<tr><td bgcolor="#7c2d12" style="padding:22px 28px;background:#7c2d12;background-image:linear-gradient(135deg,#292524,#c2410c)">
<div style="color:#fdba74;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Coal &amp; Ash tenders</div>
<div style="color:#ffffff;font-size:20px;font-weight:800;margin-top:6px;line-height:1.3">${escapeHtml(content.headline)}</div>
<div style="color:#fde7d4;font-size:14px;margin-top:8px;line-height:1.5">${escapeHtml(content.intro)}</div>
</td></tr>
<tr><td style="padding:24px 28px">
${banner}${factsBlock}${steps}${paragraphs}${remarks}${files}
<p style="margin:22px 0 0;text-align:center">
<a href="${escapeHtml(content.cta.url)}" style="display:inline-block;padding:12px 24px;background:#c2410c;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">${escapeHtml(content.cta.label)}</a>
</p>
<p style="margin:14px 0 0;font-size:12px;color:#a8a29e;text-align:center;line-height:1.5">${escapeHtml(content.footer ?? "Sent by the Coal & Ash tender workflow. Due times use the company working calendar.")}</p>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

/** Plain-text twin of the same email, for clients that do not show HTML. */
export function renderEmailText(content: EmailContent) {
  const { facts } = content;
  return [
    content.banner ?? "",
    content.headline,
    content.intro,
    facts ? `${facts.recordId} — ${facts.projectName}` : "",
    facts?.clientName ? `Client: ${facts.clientName}` : "",
    facts?.value ? `Estimated value: ${facts.value}` : "",
    facts?.deadline ? `Bid deadline: ${facts.deadline}` : "",
    content.completed ? `Completed: ${content.completed.label}${content.completed.note ? ` (${content.completed.note})` : ""}` : "",
    content.next ? `Next step: ${content.next.label}${content.next.note ? ` (${content.next.note})` : ""}` : "",
    content.body?.trim() ?? "",
    content.remarks ? `Remarks: ${content.remarks}` : "",
    content.attachments?.length ? `Attachments:\n${content.attachments.map((line) => `- ${line}`).join("\n")}` : "",
    `${content.cta.label}: ${content.cta.url}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
