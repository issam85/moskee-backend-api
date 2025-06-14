// services/stripeService.js - Complete versie met uitgebreide webhook handling
const { stripe } = require('../config/stripe');
const { supabase } = require('../config/database');
const { sendM365EmailInternal } = require('./emailService');

const handleStripeWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    // Verify webhook signature
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error(`❌ [Stripe Webhook] Signature verification failed:`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`✅ [Stripe Webhook] Received event: ${event.type} (ID: ${event.id})`);

    try {
        // Handle the event
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                console.log(`[Stripe Webhook] Checkout session completed: ${session.id}`);
                
                if (session.mode === 'subscription') {
                    await handleCheckoutSessionCompleted(session);
                }
                break;
            }

            case 'customer.subscription.created': {
                const subscription = event.data.object;
                console.log(`[Stripe Webhook] Subscription created: ${subscription.id}`);
                await handleSubscriptionCreated(subscription);
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                console.log(`[Stripe Webhook] Subscription updated: ${subscription.id}`);
                await handleSubscriptionUpdated(subscription);
                break;
            }

            case 'customer.subscription.trial_will_end': {
                const subscription = event.data.object;
                console.log(`[Stripe Webhook] Trial ending for subscription: ${subscription.id}`);
                await handleTrialWillEnd(subscription);
                break;
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object;
                console.log(`[Stripe Webhook] Payment succeeded for invoice: ${invoice.id}`);
                
                if (invoice.subscription) {
                    await handlePaymentSucceeded(invoice);
                }
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                console.log(`[Stripe Webhook] Payment failed for invoice: ${invoice.id}`);
                
                if (invoice.subscription) {
                    await handlePaymentFailed(invoice);
                }
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                console.log(`[Stripe Webhook] Subscription deleted: ${subscription.id}`);
                await handleSubscriptionDeleted(subscription);
                break;
            }

            default:
                console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
        }

        res.json({ received: true });

    } catch (error) {
        console.error(`❌ [Stripe Webhook] Error processing event ${event.type}:`, error);
        
        // Log de error naar de database voor monitoring
        try {
            await supabase.from('webhook_logs').insert({
                event_type: event.type,
                event_id: event.id,
                error_message: error.message,
                error_stack: error.stack,
                created_at: new Date().toISOString()
            });
        } catch (logError) {
            console.error('[Stripe Webhook] Failed to log error to database:', logError);
        }
        
        // Return 200 om te voorkomen dat Stripe het webhook opnieuw probeert
        res.status(200).json({ 
            received: true, 
            error: 'Internal processing error, but webhook acknowledged' 
        });
    }
};

// Handle checkout session completed
const handleCheckoutSessionCompleted = async (session) => {
    const subscriptionId = session.subscription;
    const customerId = session.customer;
    
    if (!subscriptionId) {
        console.warn('[Stripe Webhook] No subscription ID in checkout session');
        return;
    }

    // Haal subscription details op
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const mosqueId = subscription.metadata.app_mosque_id;
    
    if (!mosqueId) {
        console.warn(`[Stripe Webhook] No mosque ID in subscription metadata for ${subscriptionId}`);
        return;
    }

    // Update moskee met Stripe gegevens
    const { error } = await supabase
        .from('mosques')
        .update({ 
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            subscription_status: subscription.status,
            trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
            updated_at: new Date().toISOString()
        })
        .eq('id', mosqueId);
    
    if (error) {
        throw new Error(`Failed to update mosque ${mosqueId}: ${error.message}`);
    }

    console.log(`✅ [Stripe Webhook] Mosque ${mosqueId} updated with subscription ${subscriptionId}`);
    
    // Verstuur welkomst e-mail
    await sendWelcomeEmail(mosqueId, subscription);
};

// Handle subscription created
const handleSubscriptionCreated = async (subscription) => {
    const mosqueId = subscription.metadata.app_mosque_id;
    
    if (!mosqueId) {
        console.warn(`[Stripe Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
        return;
    }

    const { error } = await supabase
        .from('mosques')
        .update({ 
            subscription_status: subscription.status,
            trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
            updated_at: new Date().toISOString()
        })
        .eq('id', mosqueId);
    
    if (error) {
        throw new Error(`Failed to update mosque ${mosqueId}: ${error.message}`);
    }

    console.log(`✅ [Stripe Webhook] Subscription created for mosque ${mosqueId}: ${subscription.status}`);
};

// Handle subscription updated
const handleSubscriptionUpdated = async (subscription) => {
    const mosqueId = subscription.metadata.app_mosque_id;
    
    if (!mosqueId) {
        console.warn(`[Stripe Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
        return;
    }

    const updateData = { 
        subscription_status: subscription.status,
        updated_at: new Date().toISOString()
    };

    // Update trial end date if it exists
    if (subscription.trial_end) {
        updateData.trial_ends_at = new Date(subscription.trial_end * 1000);
    }

    const { error } = await supabase
        .from('mosques')
        .update(updateData)
        .eq('id', mosqueId);
    
    if (error) {
        throw new Error(`Failed to update mosque ${mosqueId}: ${error.message}`);
    }

    console.log(`✅ [Stripe Webhook] Subscription updated for mosque ${mosqueId}: ${subscription.status}`);
    
    // Als subscription geannuleerd wordt, verstuur notificatie
    if (subscription.status === 'canceled') {
        await sendCancellationEmail(mosqueId, subscription);
    }
};

// Handle trial will end
const handleTrialWillEnd = async (subscription) => {
    const mosqueId = subscription.metadata.app_mosque_id;
    
    if (!mosqueId) {
        console.warn(`[Stripe Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
        return;
    }

    console.log(`[Stripe Webhook] Trial ending for mosque ${mosqueId} in 3 days`);
    
    // Verstuur herinneringsmail
    await sendTrialEndingEmail(mosqueId, subscription);
};

// Handle payment succeeded
const handlePaymentSucceeded = async (invoice) => {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const mosqueId = subscription.metadata.app_mosque_id;
    
    if (!mosqueId) {
        console.warn(`[Stripe Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
        return;
    }

    // Update subscription status naar 'active' na succesvolle betaling
    const { error } = await supabase
        .from('mosques')
        .update({ 
            subscription_status: 'active',
            updated_at: new Date().toISOString()
        })
        .eq('id', mosqueId);
    
    if (error) {
        throw new Error(`Failed to update mosque ${mosqueId}: ${error.message}`);
    }

    console.log(`✅ [Stripe Webhook] Payment succeeded for mosque ${mosqueId}`);
    
    // Log de betaling in de database
    await logPaymentEvent(mosqueId, invoice, 'payment_succeeded');
    
    // Verstuur bevestigingsmail
    await sendPaymentConfirmationEmail(mosqueId, invoice);
};

// Handle payment failed
const handlePaymentFailed = async (invoice) => {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const mosqueId = subscription.metadata.app_mosque_id;
    
    if (!mosqueId) {
        console.warn(`[Stripe Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
        return;
    }

    console.log(`⚠️ [Stripe Webhook] Payment failed for mosque ${mosqueId}`);
    
    // Log de mislukte betaling
    await logPaymentEvent(mosqueId, invoice, 'payment_failed');
    
    // Verstuur faalmelding email
    await sendPaymentFailedEmail(mosqueId, invoice);
};

// Handle subscription deleted
const handleSubscriptionDeleted = async (subscription) => {
    const mosqueId = subscription.metadata.app_mosque_id;
    
    if (!mosqueId) {
        console.warn(`[Stripe Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
        return;
    }

    const { error } = await supabase
        .from('mosques')
        .update({ 
            subscription_status: 'canceled',
            updated_at: new Date().toISOString()
        })
        .eq('id', mosqueId);
    
    if (error) {
        throw new Error(`Failed to update mosque ${mosqueId}: ${error.message}`);
    }

    console.log(`✅ [Stripe Webhook] Subscription canceled for mosque ${mosqueId}`);
    
    // Verstuur annuleringsbevestiging
    await sendCancellationEmail(mosqueId, subscription);
};

// Helper function to log payment events
const logPaymentEvent = async (mosqueId, invoice, eventType) => {
    try {
        await supabase.from('payment_logs').insert({
            mosque_id: mosqueId,
            stripe_invoice_id: invoice.id,
            event_type: eventType,
            amount: invoice.amount_paid / 100, // Convert cents to euros
            currency: invoice.currency,
            invoice_data: invoice,
            created_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Stripe Webhook] Failed to log payment event:', error);
    }
};

// Email notification functions
const sendWelcomeEmail = async (mosqueId, subscription) => {
    try {
        // Haal moskee gegevens op
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('name, admin_email')
            .eq('id', mosqueId)
            .single();
        
        if (error || !mosque) {
            console.warn(`[Email] Could not find mosque ${mosqueId} for welcome email`);
            return;
        }

        const emailContent = {
            to: mosque.admin_email,
            subject: 'Welkom bij MijnLVS Professional! 🎉',
            html: `
                <h2>Welkom bij MijnLVS Professional!</h2>
                <p>Beste ${mosque.name},</p>
                <p>Hartelijk dank voor uw vertrouwen in MijnLVS! Uw Professional abonnement is succesvol geactiveerd.</p>
                <h3>Wat kunt u nu doen:</h3>
                <ul>
                    <li>Onbeperkt aantal leerlingen toevoegen</li>
                    <li>Financieel beheer gebruiken</li>
                    <li>Qor'aan voortgang bijhouden</li>
                    <li>Rapporten genereren</li>
                    <li>E-mail communicatie met ouders</li>
                </ul>
                <p>Heeft u vragen? Neem gerust contact met ons op via i.abdellaoui@gmail.com</p>
                <p>Barakallahu feeki,<br>Het MijnLVS Team</p>
            `
        };

        await sendM365EmailInternal(emailContent);
        console.log(`✅ [Email] Welcome email sent to ${mosque.admin_email}`);
        
    } catch (error) {
        console.error('[Email] Failed to send welcome email:', error);
    }
};

const sendTrialEndingEmail = async (mosqueId, subscription) => {
    try {
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('name, admin_email')
            .eq('id', mosqueId)
            .single();
        
        if (error || !mosque) return;

        const emailContent = {
            to: mosque.admin_email,
            subject: 'Uw MijnLVS proefperiode eindigt binnenkort ⏰',
            html: `
                <h2>Uw proefperiode eindigt over 3 dagen</h2>
                <p>Beste ${mosque.name},</p>
                <p>Uw 14-daagse proefperiode van MijnLVS eindigt over 3 dagen op ${new Date(subscription.trial_end * 1000).toLocaleDateString('nl-NL')}.</p>
                <p>Om ononderbroken toegang te behouden tot alle Professional functies, hoeft u niets te doen - de betaling wordt automatisch verwerkt.</p>
                <p>Vragen? Neem contact met ons op via i.abdellaoui@gmail.com</p>
                <p>Barakallahu feeki,<br>Het MijnLVS Team</p>
            `
        };

        await sendM365EmailInternal(emailContent);
        console.log(`✅ [Email] Trial ending email sent to ${mosque.admin_email}`);
        
    } catch (error) {
        console.error('[Email] Failed to send trial ending email:', error);
    }
};

const sendPaymentConfirmationEmail = async (mosqueId, invoice) => {
    try {
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('name, admin_email')
            .eq('id', mosqueId)
            .single();
        
        if (error || !mosque) return;

        const amount = (invoice.amount_paid / 100).toFixed(2);
        
        const emailContent = {
            to: mosque.admin_email,
            subject: 'Betalingsbevestiging MijnLVS ✅',
            html: `
                <h2>Betaling Ontvangen</h2>
                <p>Beste ${mosque.name},</p>
                <p>Wij hebben uw betaling van €${amount} succesvol ontvangen.</p>
                <p>Uw MijnLVS Professional abonnement blijft actief.</p>
                <p>Factuur nummer: ${invoice.number}</p>
                <p>Dank voor uw vertrouwen in MijnLVS!</p>
                <p>Barakallahu feeki,<br>Het MijnLVS Team</p>
            `
        };

        await sendM365EmailInternal(emailContent);
        console.log(`✅ [Email] Payment confirmation sent to ${mosque.admin_email}`);
        
    } catch (error) {
        console.error('[Email] Failed to send payment confirmation:', error);
    }
};

const sendPaymentFailedEmail = async (mosqueId, invoice) => {
    try {
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('name, admin_email')
            .eq('id', mosqueId)
            .single();
        
        if (error || !mosque) return;

        const amount = (invoice.amount_due / 100).toFixed(2);
        
        const emailContent = {
            to: mosque.admin_email,
            subject: 'Betaling Mislukt - Actie Vereist ⚠️',
            html: `
                <h2>Betaling Mislukt</h2>
                <p>Beste ${mosque.name},</p>
                <p>Helaas is de betaling van €${amount} voor uw MijnLVS abonnement mislukt.</p>
                <p>Om service onderbreking te voorkomen, update uw betaalgegevens in uw account.</p>
                <p><a href="${process.env.FRONTEND_URL}/dashboard" style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Betaalgegevens Bijwerken</a></p>
                <p>Vragen? Neem contact met ons op via i.abdellaoui@gmail.com</p>
                <p>Het MijnLVS Team</p>
            `
        };

        await sendM365EmailInternal(emailContent);
        console.log(`✅ [Email] Payment failed email sent to ${mosque.admin_email}`);
        
    } catch (error) {
        console.error('[Email] Failed to send payment failed email:', error);
    }
};

const sendCancellationEmail = async (mosqueId, subscription) => {
    try {
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('name, admin_email')
            .eq('id', mosqueId)
            .single();
        
        if (error || !mosque) return;

        const emailContent = {
            to: mosque.admin_email,
            subject: 'Abonnement Geannuleerd - Bedankt voor uw vertrouwen',
            html: `
                <h2>Abonnement Geannuleerd</h2>
                <p>Beste ${mosque.name},</p>
                <p>Uw MijnLVS Professional abonnement is geannuleerd.</p>
                <p>U kunt nog steeds de basis functies gebruiken met maximaal 10 leerlingen.</p>
                <p>Wilt u in de toekomst weer upgraden? Dat kan altijd via uw dashboard.</p>
                <p>Bedankt voor het vertrouwen dat u ons hebt gegeven.</p>
                <p>Barakallahu feeki,<br>Het MijnLVS Team</p>
            `
        };

        await sendM365EmailInternal(emailContent);
        console.log(`✅ [Email] Cancellation email sent to ${mosque.admin_email}`);
        
    } catch (error) {
        console.error('[Email] Failed to send cancellation email:', error);
    }
};

module.exports = { 
    handleStripeWebhook,
    logPaymentEvent,
    sendWelcomeEmail,
    sendTrialEndingEmail,
    sendPaymentConfirmationEmail,
    sendPaymentFailedEmail,
    sendCancellationEmail
};