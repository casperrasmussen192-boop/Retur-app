// api/stripe-webhook.js
// Stripe kalder denne URL automatisk når en betaling sker eller abonnement ændres.
// Sæt STRIPE_WEBHOOK_SECRET på Vercel fra Stripe-dashboardet.

import Stripe from "stripe";
import { kv } from "@vercel/kv";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = { api: { bodyParser: false } }; // Stripe kræver raw body

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sig = req.headers["stripe-signature"];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: "Ugyldig webhook-signatur" });
  }

  // Håndter de vigtigste Stripe-events
  switch (event.type) {
    case "checkout.session.completed": {
      // Bruger har betalt — aktiver abonnement
      const session = event.data.object;
      const email = session.customer_email?.toLowerCase();
      if (email) {
        const user = await kv.get(`user:${email}`);
        if (user) {
          await kv.set(`user:${email}`, { ...user, active: true, plan: "pro", stripeCustomerId: session.customer });
        }
      }
      break;
    }
    case "customer.subscription.deleted": {
      // Abonnement opsagt — deaktiver adgang
      const sub = event.data.object;
      const customer = await stripe.customers.retrieve(sub.customer);
      const email = customer.email?.toLowerCase();
      if (email) {
        const user = await kv.get(`user:${email}`);
        if (user) {
          await kv.set(`user:${email}`, { ...user, active: false, plan: "cancelled" });
        }
      }
      break;
    }
  }

  return res.status(200).json({ received: true });
}
