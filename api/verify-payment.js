// Vercel Serverless Function — api/verify-payment.js
// Checks Stripe for a recent successful payment by customer email,
// then marks the user as paid in Supabase.
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY      — Stripe secret key (sk_live_...)
//   SUPABASE_URL           — https://bibpoybwclvifqmouxsf.supabase.co
//   SUPABASE_SERVICE_KEY   — Supabase service role key (NOT anon key)

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { email } = req.body || {};
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Missing email" });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!stripeKey || !supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Server not configured" });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // Search Stripe Payment Intents for this customer email (last 100)
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/payment_intents?limit=100`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );

    if (!stripeRes.ok) {
      return res.status(502).json({ error: "Could not reach Stripe" });
    }

    const stripeData = await stripeRes.json();
    const intents = stripeData?.data || [];

    // Look for a succeeded payment matching this email
    const paid = intents.some(pi => {
      if (pi.status !== "succeeded") return false;
      const piEmail = (
        pi.receipt_email ||
        pi.customer_details?.email ||
        pi.metadata?.email ||
        ""
      ).toLowerCase().trim();
      return piEmail === normalizedEmail;
    });

    if (!paid) {
      // Also check Stripe Checkout Sessions (for Payment Links)
      const sessionsRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions?limit=100&status=complete`,
        { headers: { Authorization: `Bearer ${stripeKey}` } }
      );

      if (sessionsRes.ok) {
        const sessionsData = await sessionsRes.json();
        const sessions = sessionsData?.data || [];
        const paidViaCheckout = sessions.some(s => {
          const sEmail = (
            s.customer_details?.email ||
            s.customer_email ||
            ""
          ).toLowerCase().trim();
          return sEmail === normalizedEmail;
        });

        if (!paidViaCheckout) {
          return res.status(200).json({ paid: false });
        }
      } else {
        return res.status(200).json({ paid: false });
      }
    }

    // Payment confirmed — mark as paid in Supabase
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/accounts?email=eq.${encodeURIComponent(normalizedEmail)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ is_paid: true, paid_at: Date.now() }),
      }
    );

    if (!patchRes.ok) {
      return res.status(500).json({ error: "Could not update account" });
    }

    return res.status(200).json({ paid: true });
  } catch (err) {
    console.error("verify-payment error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
