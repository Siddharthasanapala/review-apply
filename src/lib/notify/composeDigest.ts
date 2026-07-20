import "server-only";

export interface DigestMatchItem {
  title: string;
  company: string;
  score: number;
  rationale: string;
  link: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function composeDigestEmail(items: DigestMatchItem[], dashboardUrl: string): { subject: string; text: string; html: string } {
  const subject = `JobPilot: ${items.length} new match${items.length === 1 ? "" : "es"} for you`;

  const text =
    items
      .map((i) => `${i.title} — ${i.company} (${i.score}/100)\n${i.rationale}\n${i.link}`)
      .join("\n\n") + `\n\n---\nFull dashboard: ${dashboardUrl}`;

  const rows = items
    .map(
      (i) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
            <p style="margin:0;font-weight:600;">${escapeHtml(i.title)} — ${escapeHtml(i.company)}</p>
            <p style="margin:4px 0;color:#374151;font-size:14px;">Score: ${i.score}/100</p>
            <p style="margin:4px 0;color:#4b5563;font-size:14px;">${escapeHtml(i.rationale)}</p>
            <a href="${i.link}" style="font-size:14px;color:#1d4ed8;">Review this match →</a>
          </td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="font-size:18px;">${items.length} new match${items.length === 1 ? "" : "es"}</h2>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <p style="margin-top:20px;font-size:13px;color:#6b7280;">
        <a href="${dashboardUrl}" style="color:#1d4ed8;">Open your full dashboard</a>
      </p>
    </div>`;

  return { subject, text, html };
}
