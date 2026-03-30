// Vercel Serverless Function — api/send-code.js
// Place this file at: /api/send-code.js in your GitHub repo

export default async function handler(req, res) {
  // Allow requests from your Vercel deployment and any configured custom domain
  const origin = req.headers.origin || "";
  const allowedOrigins = [
    process.env.APP_ORIGIN,
    "https://worthmytime.info",
  ].filter(Boolean);
  const isAllowed = allowedOrigins.includes(origin) || origin.endsWith(".vercel.app");
  res.setHeader("Access-Control-Allow-Origin", isAllowed ? origin : allowedOrigins[0]);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to_email, to_name, code } = req.body;

  if (!to_email || !code) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Worth My Time <noreply@worthmytime.info>",
        to: [to_email],
        subject: "Your Worth My Time verification code",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0d0d18;color:white;border-radius:16px">
            <h1 style="font-size:24px;margin:0 0 8px;color:white">Worth My Time? 🎮</h1>
            <p style="color:rgba(255,255,255,0.6);margin:0 0 24px">Hi ${to_name || "there"}, here is your verification code:</p>
            <div style="background:rgba(167,139,250,0.15);border:2px solid rgba(167,139,250,0.4);border-radius:12px;padding:24px;text-align:center;margin:0 0 24px">
              <div style="font-size:40px;font-weight:900;letter-spacing:8px;color:#a78bfa;font-family:monospace">${code}</div>
              <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:8px">Expires in 15 minutes</div>
            </div>
            <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:0">If you didn't create an account on worthmytime.info, ignore this email.</p>
          </div>
        `,
      }),
    });

    if (response.ok) {
      return res.status(200).json({ success: true });
    } else {
      const error = await response.text();
      return res.status(500).json({ error });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
