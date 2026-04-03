// Vercel Serverless Function — api/verify-payment.js
// Checks Stripe for a recent successful payment by customer email,
// then marks the user as paid in Supabase.

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
    let paid = false;

    // 1. Search Stripe Checkout Sessions by email (most reliable for Payment Links)
    const sessionsRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions?` +
      `customer_details[email]=${encodeURIComponent(normalizedEmail)}&status=complete&limit=10`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    if (sessionsRes.ok) {
      const sessionsData = await sessionsRes.json();
      if ((sessionsData?.data || []).length > 0) paid = true;
    }

    // 2. Fallback: search Stripe customers by email, then check their charges
    if (!paid) {
      const custRes = await fetch(
        `https://api.stripe.com/v1/customers/search?query=email:'${normalizedEmail}'&limit=5`,
        { headers: { Authorization: `Bearer ${stripeKey}` } }
      );
      if (custRes.ok) {
        const custData = await custRes.json();
        const customers = custData?.data || [];
        for (const customer of customers) {
          const chargesRes = await fetch(
            `https://api.stripe.com/v1/charges?customer=${customer.id}&limit=10`,
            { headers: { Authorization: `Bearer ${stripeKey}` } }
          );
          if (chargesRes.ok) {
            const chargesData = await chargesRes.json();
            const succeeded = (chargesData?.data || []).some(c => c.status === "succeeded");
            if (succeeded) { paid = true; break; }
          }
        }
      }
    }

    // 3. Fallback: scan recent checkout sessions for email match (catches edge cases)
    if (!paid) {
      const recentRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions?status=complete&limit=100`,
        { headers: { Authorization: `Bearer ${stripeKey}` } }
      );
      if (recentRes.ok) {
        const recentData = await recentRes.json();
        paid = (recentData?.data || []).some(s => {
          const sEmail = (s.customer_details?.email || s.customer_email || "").toLowerCase().trim();
          return sEmail === normalizedEmail;
        });
      }
    }

    if (!paid) {
      return res.status(200).json({ paid: false });
    }

    // Payment confirmed — mark as paid in Supabase (ilike = case-insensitive)
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/accounts?email=ilike.${encodeURIComponent(normalizedEmail)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
          "Prefer": "return=representation",
        },
        body: JSON.stringify({ is_paid: true, paid_at: Date.now() }),
      }
    );

    if (!patchRes.ok) {
      return res.status(500).json({ error: "Could not update account" });
    }

    const updated = await patchRes.json();
    if (!Array.isArray(updated) || updated.length === 0) {
      // Account missing — create it as paid so they're never blocked
      await fetch(`${supabaseUrl}/rest/v1/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}`, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ email: normalizedEmail, is_paid: true, paid_at: Date.now() }),
      });
    }

    return res.status(200).json({ paid: true });
  } catch (err) {
    console.error("verify-payment error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
