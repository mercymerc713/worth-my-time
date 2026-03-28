// Vercel Serverless Function — api/stripe-webhook.js
// Receives Stripe webhook events and marks users as paid in Supabase.
//
// Setup steps:
// 1. In your Vercel dashboard, add environment variables:
//    STRIPE_WEBHOOK_SECRET  — from Stripe Dashboard > Webhooks > your endpoint > Signing secret
//    SUPABASE_URL           — https://bibpoybwclvifqmouxsf.supabase.co
//    SUPABASE_SERVICE_KEY   — your Supabase service role key (NOT the anon key)
//
// 2. In Stripe Dashboard > Webhooks, add endpoint:
//    URL: https://your-domain.vercel.app/api/stripe-webhook
//    Events to listen for: checkout.session.completed

import crypto from "crypto";

// Disable Vercel's default body parser so we receive the raw bytes
// needed for Stripe signature verification.
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifyStripeSignature(rawBody, sigHeader, secret) {
  // Stripe signature header format: t=timestamp,v1=sig1,v1=sig2,...
  const parts = sigHeader.split(",");
  const timestampPart = parts.find(p => p.startsWith("t="));
  if (!timestampPart) return false;
  const timestamp = timestampPart.split("=")[1];

  const signatures = parts
    .filter(p => p.startsWith("v1="))
    .map(p => p.slice(3));

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  // Reject if timestamp is older than 5 minutes (replay attack protection)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  return signatures.some(sig => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(sig, "hex"),
        Buffer.from(expected, "hex")
      );
    } catch {
      return false;
    }
  });
}

async function markUserAsPaid(email) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  const res = await fetch(
    `${supabaseUrl}/rest/v1/accounts?email=eq.${encodeURIComponent(email.toLowerCase().trim())}`,
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
  return res.ok;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  const sigHeader = req.headers["stripe-signature"];
  if (!sigHeader) return res.status(400).json({ error: "Missing Stripe signature" });

  const rawBody = await readRawBody(req);

  if (!verifyStripeSignature(rawBody, sigHeader, webhookSecret)) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    const email =
      session?.customer_details?.email ||
      session?.customer_email ||
      null;

    if (email) {
      const ok = await markUserAsPaid(email);
      if (!ok) {
        console.error("Failed to mark user as paid:", email);
        // Return 200 so Stripe doesn't retry — log for manual follow-up
      } else {
        console.log("Marked as paid:", email);
      }
    } else {
      console.warn("checkout.session.completed received but no customer email found");
    }
  }

  // Always return 200 so Stripe marks the webhook as delivered
  return res.status(200).json({ received: true });
}
