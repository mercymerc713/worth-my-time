// Vercel Serverless Function — api/stripe-webhook.js
// Uses the official Stripe SDK for reliable webhook signature verification.

import Stripe from "stripe";

// Disable Vercel's default body parser — Stripe needs the raw bytes to verify signatures.
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function markUserAsPaid(email) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  const normalized  = email.toLowerCase().trim();

  // ilike = case-insensitive match so capitalisation differences don't break it
  const res = await fetch(
    `${supabaseUrl}/rest/v1/accounts?email=ilike.${encodeURIComponent(normalized)}`,
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

  if (!res.ok) {
    console.error("Supabase PATCH failed:", res.status, await res.text());
    return false;
  }

  const updated = await res.json();
  if (!Array.isArray(updated) || updated.length === 0) {
    // Account doesn't exist yet — create it as paid so they're never blocked
    console.warn("No account found for", normalized, "— creating paid account");
    const ins = await fetch(`${supabaseUrl}/rest/v1/accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({ email: normalized, is_paid: true, paid_at: Date.now() }),
    });
    if (!ins.ok) {
      console.error("Supabase INSERT failed:", ins.status, await ins.text());
      return false;
    }
    return true;
  }

  console.log("Marked as paid:", normalized, `(${updated.length} row updated)`);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET env var is not set");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error("STRIPE_SECRET_KEY env var is not set");
    return res.status(500).json({ error: "Stripe key not configured" });
  }

  const sigHeader = req.headers["stripe-signature"];
  if (!sigHeader) return res.status(400).json({ error: "Missing Stripe-Signature header" });

  const rawBody = await readRawBody(req);

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

  let event;
  try {
    // Official Stripe SDK handles signature verification + replay attack protection
    event = stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
  } catch (err) {
    console.error("Stripe signature verification failed:", err.message);
    // Return 400 so Stripe knows the payload was rejected (not a processing error)
    return res.status(400).json({ error: `Webhook verification failed: ${err.message}` });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    const email =
      session?.customer_details?.email ||
      session?.customer_email ||
      null;

    if (email) {
      try {
        const ok = await markUserAsPaid(email);
        if (ok) {
          console.log("Payment activated for:", email);
        } else {
          console.error("markUserAsPaid returned false for:", email);
        }
      } catch (err) {
        console.error("markUserAsPaid threw:", err.message);
        // Still return 200 — Stripe already delivered successfully,
        // re-retrying won't help if it's a Supabase issue
      }
    } else {
      console.warn("checkout.session.completed — no customer email in event:", JSON.stringify(session?.id));
    }
  }

  // Always 200 so Stripe marks the webhook as successfully delivered
  return res.status(200).json({ received: true });
}
