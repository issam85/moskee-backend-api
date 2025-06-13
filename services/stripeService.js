// services/stripeService.js
const { stripe } = require('../config/stripe');
const { supabase } = require('../config/database');
const { sendM365EmailInternal } = require('./emailService');

const handleStripeWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error(`❌ Webhook signature verification failed.`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`✅ Stripe Webhook received: ${event.type}`);

    // Handel het event af
    switch (event.type) {
        case 'customer.subscription.trial_will_end': {
            const subscription = event.data.object;
            const mosqueId = subscription.metadata.app_mosque_id;
            console.log(`[Webhook] Trial ending for mosque ${mosqueId}.`);
            // Stuur een herinneringsmail (optioneel)
            // Implementatie hier...
            break;
        }

        case 'invoice.payment_succeeded': {
            const invoice = event.data.object;
            if (invoice.billing_reason === 'subscription_create' || invoice.billing_reason === 'subscription_cycle') {
                const subscriptionId = invoice.subscription;
                const { data: subscription } = await stripe.subscriptions.retrieve(subscriptionId);
                const mosqueId = subscription.metadata.app_mosque_id;
                const newStatus = subscription.status; // 'active' of 'trialing'

                console.log(`[Webhook] Payment success for mosque ${mosqueId}. Updating status to '${newStatus}'.`);
                
                await supabase
                    .from('mosques')
                    .update({ subscription_status: newStatus })
                    .eq('id', mosqueId);
            }
            break;
        }

        case 'customer.subscription.deleted': {
             const subscription = event.data.object;
             const mosqueId = subscription.metadata.app_mosque_id;
             console.log(`[Webhook] Subscription deleted for mosque ${mosqueId}. Setting status to 'canceled'.`);
             await supabase
                .from('mosques')
                .update({ subscription_status: 'canceled' })
                .eq('id', mosqueId);
             break;
        }

        default:
            console.log(`[Webhook] Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
};

module.exports = { handleStripeWebhook };