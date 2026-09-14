/*
  The email a new subscriber gets, carrying their licence key.

  Until now there was none: Paddle sends a receipt with no key in it, and this
  service sent nothing at all. A buyer who closed the tab had nothing in their
  inbox to come back to.

  Sent through Cloudflare's own Email Service (the `EMAIL` send_email binding),
  not a third-party provider - the account already has the scope, the DNS
  records are managed by Cloudflare, and there is no extra API key to keep out
  of the repository.

  On sending the key at all: the API deliberately never returns a licence key
  from an email address alone, because anyone can type an address. Mailing it
  to the address that just completed the purchase is a different act - it goes
  to a mailbox the buyer has demonstrably paid from, and it is what every
  desktop licence in the world does. The two rules are consistent.
*/

const SUPPORT = "tj.aeronautical@outlook.com";

/*
  Training-support-only, in the email as well as the app. Somebody may print
  this and file it with their notes, and it should not be the one artefact that
  omits the statement.
*/
const DISCLAIMER = "DHC-6 Trainer is training support only. It does not replace the approved AFM, QRH, MEL, company manuals, approved checklists or any regulatory or operator documentation.";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function planLabel(plan) {
  const raw = String(plan || "").trim();
  if (!raw) return "Subscription";
  return raw.replace(/[_-]+/g, " ").replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
}

/*
  Built from the licence record and nothing else. No aviation figures, no
  invented dates: the plan name and expiry are whatever Paddle told the
  webhook, and a missing expiry simply is not mentioned.
*/
export function welcomeEmail(record, origin) {
  const base = String(origin || "https://dhc6trainer.com").replace(/\/+$/, "");
  const key = String((record && record.key) || "");
  const plan = planLabel(record && record.plan);
  const trial = Boolean(record && record.trial);
  const renews = record && record.expiresAt ? String(record.expiresAt).slice(0, 10) : "";

  const opening = trial
    ? "Your trial has started. Everything below works for the whole trial."
    : "Your subscription is active.";

  const lines = [
    opening,
    "",
    "Licence key: " + key,
    "Plan: " + plan,
    renews ? (trial ? "Trial ends: " + renews : "Renews or expires: " + renews) : "",
    "",
    "Use it in the browser, no installation:",
    base + "/web-app.html",
    "You can sign in there with this key, or ask for a one-time sign-in link to this address.",
    "",
    "Manage devices, billing and Windows downloads:",
    base + "/access.html",
    "",
    "Keep this key. It activates the desktop app on up to " + (Number(record && record.activationLimit) || 3) + " devices,",
    "and you can release a device seat from the page above before moving computers.",
    "",
    "Questions: " + SUPPORT,
    "",
    DISCLAIMER
  ];

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#14202b;max-width:560px">',
    '<h1 style="font-size:20px;margin:0 0 16px">DHC-6 Trainer</h1>',
    "<p>" + escapeHtml(opening) + "</p>",
    '<div style="background:#f3f6f9;border:1px solid #d7e0e8;border-radius:10px;padding:16px;margin:20px 0">',
    '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6b7a">Licence key</div>',
    '<div style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:19px;font-weight:700;margin-top:6px">' + escapeHtml(key) + "</div>",
    '<div style="font-size:13px;color:#5b6b7a;margin-top:10px">' + escapeHtml(plan)
      + (renews ? " &middot; " + escapeHtml(trial ? "trial ends " + renews : "renews or expires " + renews) : "") + "</div>",
    "</div>",
    "<p><strong>Use it in the browser, no installation:</strong><br>",
    '<a href="' + escapeHtml(base) + '/web-app.html">' + escapeHtml(base) + "/web-app.html</a><br>",
    "Sign in with this key, or ask for a one-time sign-in link to this address.</p>",
    "<p><strong>Manage devices, billing and Windows downloads:</strong><br>",
    '<a href="' + escapeHtml(base) + '/access.html">' + escapeHtml(base) + "/access.html</a></p>",
    "<p>Keep this key. It activates the desktop app on up to "
      + escapeHtml(String(Number(record && record.activationLimit) || 3))
      + " devices, and you can release a seat from the page above before moving computers.</p>",
    "<p>Questions: " + '<a href="mailto:' + SUPPORT + '">' + SUPPORT + "</a></p>",
    '<p style="font-size:12px;color:#5b6b7a;border-top:1px solid #e2e8ee;padding-top:14px;margin-top:24px">'
      + escapeHtml(DISCLAIMER) + "</p>",
    "</div>"
  ].join("");

  return {
    subject: trial ? "Your DHC-6 Trainer trial and licence key" : "Your DHC-6 Trainer licence key",
    text: lines.filter(function (line, i) { return line !== "" || lines[i - 1] !== ""; }).join("\n"),
    html: html
  };
}

/*
  Sends once, and never at the cost of the webhook.

  Paddle retries any callback that does not return 2xx, so a mail outage must
  not turn into a redelivered purchase event. Every failure here is caught,
  written onto the licence for support to read, and swallowed.
*/
export async function sendWelcomeEmail(env, record, origin) {
  if (!record || !record.email || !record.key) return { sent: false, reason: "incomplete_record" };
  if (record.welcomeEmailAt) return { sent: false, reason: "already_sent" };
  if (!env || !env.EMAIL || typeof env.EMAIL.send !== "function") {
    return { sent: false, reason: "email_not_configured" };
  }

  const from = String(env.WELCOME_EMAIL_FROM || "noreply@dhc6trainer.com");
  const message = welcomeEmail(record, origin);
  try {
    const result = await env.EMAIL.send({
      to: record.email,
      from: from,
      subject: message.subject,
      text: message.text,
      html: message.html
    });
    record.welcomeEmailAt = new Date().toISOString();
    if (result && result.messageId) record.welcomeEmailId = String(result.messageId);
    delete record.welcomeEmailError;
    return { sent: true, messageId: record.welcomeEmailId || null };
  } catch (error) {
    /* Recorded rather than thrown: the customer has paid and the licence
       exists, which matters more than the mail. Support can see this on the
       record and resend by hand. */
    const reason = String((error && error.message) || "send_failed").slice(0, 200);
    record.welcomeEmailError = reason;
    console.warn("welcome email failed for licence " + record.key + ": " + reason);
    return { sent: false, reason: reason };
  }
}
