// Generates knowledge/demo-employee-handbook.pdf: a nine-page, text-selectable
// sample handbook used to demonstrate document summarization and keyword
// extraction. Run with: node scripts/generate-demo-handbook.mjs
//
// The PDF is written by hand (no external service, no binary asset in the repo)
// so the content is reviewable and the demo stays fully reproducible offline.

import fs from "node:fs";
import path from "node:path";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BODY_SIZE = 10.5;
const BODY_LEADING = 15;
const HEADING_SIZE = 13;
const TITLE_SIZE = 20;
const MAX_CHARS = 88;

const CONTENT = [
  { type: "title", text: "Employee Handbook (Demonstration Sample)" },
  {
    type: "note",
    text: "This is a demonstration document for an academic hackathon project. It is not official GAIL policy and does not create any entitlement. Always confirm details in the official employee handbook and internal portals.",
  },
  { type: "h2", text: "Contents" },
  { type: "toc", text: "1. About this handbook" },
  { type: "toc", text: "2. Working hours and attendance" },
  { type: "toc", text: "3. Leave policy" },
  { type: "toc", text: "4. Pay, benefits, and reimbursements" },
  { type: "toc", text: "5. IT support" },
  { type: "toc", text: "6. Information security and two-factor authentication" },
  { type: "toc", text: "7. Workplace conduct" },
  { type: "toc", text: "8. Travel and official duty" },
  { type: "toc", text: "9. Learning, events, and where to get help" },
  {
    type: "note",
    text: "Sections begin on a new page. Each section states the process an employee would follow and the office that owns it.",
  },
  { type: "pagebreak" },
  { type: "h2", text: "1. About this handbook" },
  {
    type: "p",
    text: "This sample handbook describes how a large public sector organisation typically organises everyday employee processes. It exists so that the Intelligent Enterprise Assistant can demonstrate document summarization, keyword extraction, and question answering over an uploaded file.",
  },
  {
    type: "p",
    text: "The handbook is organised into nine sections covering attendance, leave, pay and benefits, IT support, information security, workplace conduct, travel reimbursement, learning, and where to get help. Each section states the process an employee would follow and the office that owns it.",
  },
  { type: "h2", text: "2. Working hours and attendance" },
  {
    type: "p",
    text: "The standard working week is five days, Monday to Friday. Core hours are 09:30 to 17:30 local time. Employees may flex their start time by up to sixty minutes with the approval of their reporting manager, provided that total weekly hours are met.",
  },
  {
    type: "bullet",
    text: "Record attendance daily in the approved attendance system before leaving the office.",
  },
  {
    type: "bullet",
    text: "Inform your reporting manager before 10:00 if you will be late or absent unexpectedly.",
  },
  {
    type: "bullet",
    text: "A missed attendance record must be regularised within three working days.",
  },
  {
    type: "p",
    text: "Hybrid working is permitted for eligible roles. Employees working remotely must remain reachable during core hours, use the approved secure network, and attend scheduled reviews in person when asked.",
  },
  { type: "h2", text: "3. Leave policy" },
  {
    type: "p",
    text: "Leave is grouped into casual leave, earned leave, sick leave, and special leave. All applications are raised in the HR self-service portal. The portal routes the request to the reporting manager and then to the HR department for record keeping.",
  },
  {
    type: "p",
    text: "Planned leave should be applied for at least seven calendar days in advance. Unplanned leave should be applied for on the same day where possible. A medical certificate is required for sick leave exceeding three consecutive days.",
  },
  {
    type: "bullet",
    text: "Casual leave is intended for short personal matters and is granted in half-day units.",
  },
  {
    type: "bullet",
    text: "Earned leave accrues monthly and may be carried forward subject to the annual ceiling.",
  },
  {
    type: "bullet",
    text: "Leave is approved only when a nominated colleague accepts the handover of urgent work.",
  },
  {
    type: "p",
    text: "During probation, leave is limited to casual leave and sick leave unless the appointing authority grants an exception in writing. Leave without pay requires approval from the department head.",
  },
  { type: "h2", text: "4. Pay, benefits, and reimbursements" },
  {
    type: "p",
    text: "Salary is credited on the last working day of each month. Payslips are published in the payroll portal three days before the credit date. Employees should verify their bank account details at least once a year.",
  },
  {
    type: "p",
    text: "Medical reimbursement claims must be submitted within ninety days of treatment along with original bills, a prescription, and the claim form. Claims above the standard limit require prior approval from the medical board.",
  },
  {
    type: "bullet",
    text: "Group medical insurance covers the employee, spouse, and dependent children.",
  },
  {
    type: "bullet",
    text: "Annual health check-ups are reimbursed up to the published limit.",
  },
  {
    type: "bullet",
    text: "Queries about payslips, deductions, or tax declarations go to the payroll helpdesk.",
  },
  { type: "h2", text: "5. IT support" },
  {
    type: "p",
    text: "The IT service desk is the single point of contact for laptop, network, software, and account issues. Tickets can be raised from the internal service portal or by calling the helpdesk extension during business hours.",
  },
  {
    type: "p",
    text: "Before raising a ticket for a login problem, confirm the username, check that the device has network connectivity, and try the approved password-reset process once. Never share your password or a one-time code with support staff.",
  },
  {
    type: "bullet",
    text: "Include the exact error message, the approximate time, the device type, and the steps to reproduce the issue.",
  },
  {
    type: "bullet",
    text: "Do not attach confidential business data in a screenshot unless the ticket explicitly requires it.",
  },
  {
    type: "bullet",
    text: "Hardware replacement requires a ticket reference and manager approval.",
  },
  { type: "h2", text: "6. Information security and two-factor authentication" },
  {
    type: "p",
    text: "Access to enterprise applications requires two-factor authentication. The second factor is a six-digit one-time code delivered to the employee's registered email address. Codes expire after ten minutes and may be attempted at most five times.",
  },
  {
    type: "p",
    text: "Employees must not forward verification codes, approve authentication prompts they did not initiate, or reuse a code across sessions. If a code arrives without an active login attempt, report it to the security team immediately.",
  },
  {
    type: "bullet",
    text: "Use a unique passphrase for each enterprise account and store it in the approved password manager.",
  },
  {
    type: "bullet",
    text: "Lock the screen whenever leaving a workstation unattended.",
  },
  {
    type: "bullet",
    text: "Report suspected phishing to the security team without clicking any link.",
  },
  { type: "h2", text: "7. Workplace conduct" },
  {
    type: "p",
    text: "Every employee is entitled to a workplace free from discrimination, harassment, and intimidation. The organisation maintains an internal committee under the applicable prevention of sexual harassment framework.",
  },
  {
    type: "p",
    text: "Complaints may be raised in writing with the internal committee or with the human resources department. Complaints are handled confidentially, and retaliation against a complainant is a disciplinary matter.",
  },
  {
    type: "bullet",
    text: "Communicate respectfully in meetings, email, and internal chat channels.",
  },
  {
    type: "bullet",
    text: "Declare conflicts of interest to the reporting manager in writing.",
  },
  { type: "h2", text: "8. Travel and official duty" },
  {
    type: "p",
    text: "Official travel must be approved in advance through the travel management portal. Bookings made through the approved travel desk are covered directly; other bookings require reimbursement approval from the department head.",
  },
  {
    type: "p",
    text: "Claims for daily allowance, lodging, and local transport must be submitted within thirty days of returning from travel. Original boarding passes and tax invoices are required for air travel.",
  },
  { type: "h2", text: "9. Learning, events, and where to get help" },
  {
    type: "p",
    text: "The learning calendar publishes onboarding orientation, quarterly safety workshops, and team knowledge-sharing sessions. Employees should confirm dates, venue, registration requirements, and accessibility arrangements in the official events calendar before attending.",
  },
  {
    type: "p",
    text: "For HR policy questions contact the human resources department. For IT issues raise a service desk ticket. For payroll queries contact the payroll helpdesk. For safety concerns contact the safety officer. For security incidents contact the information security team immediately.",
  },
  {
    type: "note",
    text: "End of demonstration document. This sample is provided solely to exercise the assistant's document analysis features.",
  },
];

// --- Minimal text layout ----------------------------------------------------

function wrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapePdfText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

/** Convert content blocks into a list of pages, each a list of draw ops. */
function layout(blocks) {
  const pages = [];
  let ops = [];
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    pages.push(ops);
    ops = [];
    y = PAGE_HEIGHT - MARGIN;
  };

  const ensureSpace = (needed) => {
    if (y - needed < MARGIN + 24) newPage();
  };

  for (const block of blocks) {
    if (block.type === "pagebreak") {
      newPage();
      continue;
    }

    // Numbered sections start on a fresh page, like a printed handbook.
    if (block.type === "h2" && /^\d+\./.test(block.text) && y < PAGE_HEIGHT - MARGIN) {
      newPage();
    }

    let size = BODY_SIZE;
    let leading = BODY_LEADING;
    let font = "F1";
    let indent = 0;
    let maxChars = MAX_CHARS;
    let before = 6;
    let after = 4;

    if (block.type === "title") {
      size = TITLE_SIZE;
      leading = 26;
      font = "F2";
      before = 0;
      after = 10;
      maxChars = 52;
    } else if (block.type === "h2") {
      size = HEADING_SIZE;
      leading = 20;
      font = "F2";
      before = 14;
      after = 6;
      maxChars = 74;
    } else if (block.type === "toc") {
      size = BODY_SIZE;
      leading = 18;
      indent = 6;
      before = 0;
      after = 0;
      maxChars = 82;
    } else if (block.type === "note") {
      size = 9.5;
      leading = 14;
      indent = 0;
      maxChars = 96;
      before = 10;
      after = 8;
    } else if (block.type === "bullet") {
      indent = 14;
      maxChars = MAX_CHARS - 6;
      before = 2;
      after = 2;
    }

    const lines = wrap(block.text, maxChars);
    ensureSpace(before + lines.length * leading + after);
    y -= before;

    lines.forEach((line, index) => {
      const prefix = block.type === "bullet" && index === 0 ? "- " : block.type === "bullet" ? "  " : "";
      const x = MARGIN + indent;
      const text = escapePdfText(`${prefix}${line}`);
      ops.push(
        `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${text}) Tj ET`,
      );
      y -= leading;
    });

    y -= after;
  }

  if (ops.length > 0) pages.push(ops);
  return pages;
}

// --- PDF serialization ------------------------------------------------------

function buildPdf(pages) {
  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  // Reserve: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold.
  objects.push("", "", "", "");
  const fontRegular = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const fontBold = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  const pageIds = [];
  pages.forEach((ops, index) => {
    const footer = `BT /F1 8 Tf ${MARGIN} 30 Td (Employee Handbook - demonstration sample - page ${index + 1} of ${pages.length}) Tj ET`;
    const stream = [...ops, footer].join("\n");
    const contentId = addObject(
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
    const pageId = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  });

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

const pages = layout(CONTENT);
const pdf = buildPdf(pages);
const outputPath = path.join(process.cwd(), "knowledge", "demo-employee-handbook.pdf");
fs.writeFileSync(outputPath, pdf);

console.log(
  `Wrote ${outputPath} (${pages.length} pages, ${(pdf.length / 1024).toFixed(1)} KB)`,
);
