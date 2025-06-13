// config/stripe.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

if (!process.env.STRIPE_SECRET_KEY) {
    console.warn("⚠️ [STRIPE] STRIPE_SECRET_KEY is not set. Stripe functionality will fail.");
}

module.exports = { stripe };