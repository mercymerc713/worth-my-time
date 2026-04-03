// Vercel Serverless Function — api/notify-message.js
// Sends an email notification to the recipient of a new message.
// Called fire-and-forget from the frontend after a message is saved.

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allowedOrigins = [process.env.APP_ORIGIN, "https://worthmytime.info"].filter(Boolean);
  const isAllowed = allowedOrigins.includes(origin) || origin.endsWith(".vercel.app");
  res.setHeader("Access-Control-Allow-Origin", isAllowed ? origin : allowedOrigins[0]);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to_email, from_name, preview } = req.body || {};
  if (!to_email || !from_name) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: "Email not configured" });

  // Truncate preview to 120 chars for the email snippet
  const snippet = preview ? String(preview).slice(0, 120) + (preview.length > 120 ? "…" : "") : null;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: "Worth My Time <noreply@worthmytime.info>",
        to: [to_email],
        subject: `${from_name} sent you a message on Worth My Time`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0d0d18;color:white;border-radius:16px">
            <h1 style="font-size:22px;margin:0 0 6px;color:white">Worth My Time? 🎮</h1>
            <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 24px">You have a new message</p>

            <div style="background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.3);border-radius:14px;padding:20px;margin:0 0 24px">
              <div style="font-size:13px;font-weight:700;color:#a78bfa;margin-bottom:8px">${from_name}</div>
              ${snippet ? `<div style="font-size:14px;color:rgba(255,255,255,0.8);line-height:1.6">${snippet}</div>` : ""}
            </div>

            <a href="https://worthmytime.info" style="display:inline-block;background:linear-gradient(135deg,#a78bfa,#7c3aed);color:white;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700;font-size:13px">
              Open Messages →
            </a>

            <p style="color:rgba(255,255,255,0.25);font-size:11px;margin-top:24px;line-height:1.6">
              You received this because someone sent you a message on worthmytime.info.<br>
              Reply by visiting the site — do not reply to this email.
            </p>
          </div>
        `,
      }),
    });

    if (response.ok) return res.status(200).json({ sent: true });
    const err = await response.text();
    console.error("Resend error:", err);
    return res.status(500).json({ error: err });
  } catch (err) {
    console.error("notify-message error:", err);
    return res.status(500).json({ error: err.message });
  }
}
