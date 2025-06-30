// services/stripeService.js - Geautomatiseerde webhook handling met buffering en linking
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

// Handle checkout session completed - KERNFUNCTIE VAN AUTOMATION
const handleCheckoutSessionCompleted = async (session) => {
    console.log(`[Enhanced Webhook] Processing session: ${session.id}`);
    
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    const trackingId = subscription.metadata.tracking_id;
    const mosqueId = subscription.metadata.app_mosque_id;
    
    // ✅ KRITIEKE VERBETERING: Store session_id als primaire key
    const pendingPaymentData = {
        tracking_id: trackingId,
        stripe_session_id: session.id,  // ✅ CRITICAL: Store session ID
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        customer_email: session.customer_email?.toLowerCase(),
        amount: (session.amount_total || 0) / 100,
        currency: session.currency || 'eur',
        metadata: subscription.metadata,
        status: 'pending',
        expires_at: new Date(Date.now() + 7200000).toISOString(),
        created_at: new Date().toISOString()
    };
    
    // ✅ UPSERT PATTERN: Voorkom duplicaten
    const { error: upsertError } = await supabase
        .from('pending_payments')
        .upsert(pendingPaymentData, { 
            onConflict: 'stripe_session_id',
            ignoreDuplicates: false 
        });
    
    if (upsertError) {
        console.error('[Enhanced Webhook] Upsert error:', upsertError);
    } else {
        console.log(`✅ [Enhanced Webhook] Stored payment with session ID: ${session.id}`);
    }
    
    // Direct linking voor ingelogde gebruikers
    if (mosqueId && mosqueId !== 'undefined') {
        await linkPaymentToMosque(mosqueId, pendingPaymentData);
    } else {
        // Check voor pending registraties
        await checkForPendingRegistrations(session.id, session.customer_email);
    }
};

// Probeer immediate linking voor recent geregistreerde moskeeën
const attemptImmediateLinking = async (customerEmail, trackingId, paymentData) => {
    try {
        console.log(`[Webhook] Attempting immediate linking for email: ${customerEmail}`);
        
        // ✅ FIXED: Use 'email' field instead of 'admin_email'
        const { data: recentMosques, error } = await supabase
            .from('mosques')
            .select('id, email, name, subscription_status, created_at')
            .eq('email', customerEmail.toLowerCase())
            .gte('created_at', new Date(Date.now() - 1800000).toISOString()) // Last 30 minutes
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[Webhook] Error searching for recent mosques:', error);
            return;
        }

        if (recentMosques && recentMosques.length > 0) {
            const mosque = recentMosques[0]; // Most recent
            console.log(`[Webhook] Found recent mosque: ${mosque.name} (${mosque.id})`);
            console.log(`[Webhook] Mosque status: ${mosque.subscription_status}`);
            
            // Only link if mosque is still trialing or has no subscription
            if (['trialing', 'trial', null, undefined].includes(mosque.subscription_status)) {
                console.log(`✅ [Webhook] Auto-linking payment to mosque: ${mosque.id}`);
                
                await linkPaymentToMosque(mosque.id, paymentData);
                
                // Update pending payment status
                await supabase
                    .from('pending_payments')
                    .update({ 
                        mosque_id: mosque.id,
                        status: 'linked',
                        linked_at: new Date().toISOString()
                    })
                    .eq('stripe_subscription_id', paymentData.stripe_subscription_id);
                
                console.log(`✅ [Webhook] Successfully auto-linked payment to mosque ${mosque.id}`);
            } else {
                console.log(`ℹ️ [Webhook] Mosque ${mosque.id} already has status: ${mosque.subscription_status}, skipping`);
            }
        } else {
            console.log(`ℹ️ [Webhook] No recent mosque registrations found for email: ${customerEmail}`);
        }
    } catch (error) {
        console.error('[Webhook] Error in immediate linking attempt:', error);
    }
};


// Link payment direct aan moskee
const linkPaymentToMosque = async (mosqueId, paymentData) => {
    try {
        console.log(`[Webhook] Linking payment to mosque ${mosqueId}...`);
        
        // ✅ GECORRIGEERDE PLAN LOGIC
        let planType = 'professional'; // default
        let maxStudents = null; // null = onbeperkt
        let maxTeachers = null; // null = onbeperkt
        
        // Bepaal plan type op basis van metadata of bedrag
        if (paymentData.metadata && paymentData.metadata.plan_type) {
            planType = paymentData.metadata.plan_type;
        } else if (paymentData.amount >= 49) {
            planType = 'premium';
        } else if (paymentData.amount >= 29) {
            planType = 'professional';
        }

        // ✅ ALLEEN TRIAL/BASIC HEBBEN RESTRICTIES
        if (planType === 'trial' || planType === 'basic') {
            maxStudents = 10;
            maxTeachers = 2;
        }
        // Professional en Premium blijven null (onbeperkt)

        console.log(`[Webhook] Upgrading mosque to ${planType} plan (${maxStudents || 'onbeperkt'} students)`);

        // ✅ ATOMIC UPDATE
        const updateData = {
            stripe_customer_id: paymentData.stripe_customer_id,
            stripe_subscription_id: paymentData.stripe_subscription_id,
            subscription_status: 'active',
            plan_type: planType,
            max_students: maxStudents, // null voor Professional/Premium
            max_teachers: maxTeachers, // null voor Professional/Premium
            trial_ends_at: null,
            trial_started_at: null,
            updated_at: new Date().toISOString()
        };

        const { data: updatedMosque, error: updateError } = await supabase
            .from('mosques')
            .update(updateData)
            .eq('id', mosqueId)
            .select()
            .single();

        if (updateError) {
            console.error('[Webhook] Error updating mosque:', updateError);
            throw updateError;
        }

        console.log(`✅ [Webhook] Mosque ${mosqueId} upgraded successfully:`);
        console.log(`   - Status: ${updatedMosque.subscription_status}`);
        console.log(`   - Plan: ${updatedMosque.plan_type}`);
        console.log(`   - Max Students: ${updatedMosque.max_students || 'Onbeperkt'}`);
        console.log(`   - Max Teachers: ${updatedMosque.max_teachers || 'Onbeperkt'}`);
        
        // Send welcome email
        await sendWelcomeEmail(mosqueId, paymentData.stripe_subscription_id);
        
        return updatedMosque;
        
    } catch (error) {
        console.error('[Webhook] Error linking payment to mosque:', error);
        throw error;
    }
};



// Buffer webhook event voor later processing
const bufferWebhookEvent = async (session, subscription, customerEmail) => {
    try {
        const bufferedEvent = {
            stripe_event_id: `session_${session.id}`,
            event_type: 'checkout.session.completed',
            stripe_session_id: session.id,
            stripe_subscription_id: subscription.id,
            customer_email: customerEmail,
            metadata: subscription.metadata,
            event_data: { session, subscription },
            processed: false
        };

        const { error } = await supabase
            .from('webhook_events_buffer')
            .insert(bufferedEvent);
            
        if (error) {
            throw error;
        }

        console.log(`[Webhook Buffer] ✅ Stored event for email: ${customerEmail}`);
    } catch (error) {
        console.error('[Webhook Buffer] Error storing buffered event:', error);
    }
};

// Handle subscription created
const handleSubscriptionCreated = async (subscription) => {
    const mosqueId = subscription.metadata.app_mosque_id;
    
    if (!mosqueId || mosqueId === 'undefined' || mosqueId === 'null') {
        console.warn(`[Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
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
    
    if (!mosqueId || mosqueId === 'undefined' || mosqueId === 'null') {
        console.warn(`[Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
        return;
    }

    const updateData = { 
        subscription_status: subscription.status,
        updated_at: new Date().toISOString()
    };

    // Update trial end date if it exists
    if (subscription.trial_end) {
        updateData.trial_ends_at = new Date(subscription.trial_end * 1000);
    } else if (subscription.status === 'active') {
        // Remove trial restriction when subscription becomes active
        updateData.trial_ends_at = null;
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
    
    if (!mosqueId || mosqueId === 'undefined' || mosqueId === 'null') {
        console.warn(`[Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
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
    
    if (!mosqueId || mosqueId === 'undefined' || mosqueId === 'null') {
        console.warn(`[Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
        return;
    }

    // Update subscription status naar 'active' na succesvolle betaling
    const { error } = await supabase
        .from('mosques')
        .update({ 
            subscription_status: 'active',
            trial_ends_at: null, // Remove trial restriction
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
    
    if (!mosqueId || mosqueId === 'undefined' || mosqueId === 'null') {
        console.warn(`[Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
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
    
    if (!mosqueId || mosqueId === 'undefined' || mosqueId === 'null') {
        console.warn(`[Webhook] No mosque ID in subscription metadata for ${subscription.id}`);
        return;
    }

    const { error } = await supabase
        .from('mosques')
        .update({ 
            subscription_status: 'canceled',
            trial_ends_at: null,
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

// === EMAIL NOTIFICATION FUNCTIONS ===

const sendWelcomeEmail = async (mosqueId, subscriptionId) => {
    try {
        // Haal moskee gegevens op
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('name, admin_email, subdomain')
            .eq('id', mosqueId)
            .single();
        
        if (error || !mosque) {
            console.warn(`[Email] Could not find mosque ${mosqueId} for welcome email`);
            return;
        }

        const emailContent = {
            to: mosque.admin_email,
            subject: '🎉 Welkom bij MijnLVS Professional!',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #10b981;">Welkom bij MijnLVS Professional!</h2>
                    <p>Beste ${mosque.name},</p>
                    
                    <p>🎉 <strong>Uw betaling is succesvol verwerkt en uw Professional account is direct actief!</strong></p>
                    
                    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <h3 style="color: #15803d; margin-top: 0;">Wat kunt u nu doen:</h3>
                        <ul style="color: #166534;">
                            <li>✅ Onbeperkt aantal leerlingen toevoegen</li>
                            <li>💰 Volledige financieel beheer gebruiken</li>
                            <li>📖 Qor'aan voortgang bijhouden</li>
                            <li>📊 Gedetailleerde rapporten genereren</li>
                            <li>📧 Professionele e-mail communicatie met ouders</li>
                            <li>📱 Toegang tot mobiele app voor ouders</li>
                        </ul>
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="https://${mosque.subdomain}.mijnlvs.nl/login" 
                           style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                            Start Nu met MijnLVS Professional
                        </a>
                    </div>
                    
                    <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <h3 style="color: #92400e; margin-top: 0;">📋 Volgende Stappen:</h3>
                        <p style="color: #78350f; margin-bottom: 0;">
                            1. Log in op uw dashboard<br>
                            2. Voeg uw eerste leerlingen toe<br>
                            3. Stel uw financiële instellingen in<br>
                            4. Nodig ouders uit voor de app
                        </p>
                    </div>
                    
                    <p>Heeft u vragen of hulp nodig bij het instellen? Neem gerust contact met ons op via <a href="mailto:i.abdellaoui@gmail.com">i.abdellaoui@gmail.com</a></p>
                    
                    <p style="margin-top: 30px;">
                        Barakallahu feeki,<br>
                        <strong>Het MijnLVS Team</strong>
                    </p>
                    
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                    <p style="font-size: 12px; color: #6b7280;">
                        Dit is een geautomatiseerde bevestiging van uw MijnLVS Professional abonnement.
                        Abonnement ID: ${subscriptionId}
                    </p>
                </div>
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
            subject: '⏰ Uw MijnLVS proefperiode eindigt binnenkort',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #f59e0b;">Uw proefperiode eindigt over 3 dagen</h2>
                    <p>Beste ${mosque.name},</p>
                    
                    <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <p style="color: #92400e; margin: 0;">
                            <strong>Uw 14-daagse proefperiode van MijnLVS eindigt over 3 dagen op ${new Date(subscription.trial_end * 1000).toLocaleDateString('nl-NL')}.</strong>
                        </p>
                    </div>
                    
                    <p>Om ononderbroken toegang te behouden tot alle Professional functies, hoeft u niets te doen - de betaling wordt automatisch verwerkt.</p>
                    
                    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <h3 style="color: #15803d; margin-top: 0;">Na de proefperiode:</h3>
                        <ul style="color: #166534;">
                            <li>Automatische factuur van €${subscription.items.data[0]?.price?.unit_amount ? (subscription.items.data[0].price.unit_amount / 100) : '29'} per maand</li>
                            <li>Ononderbroken toegang tot alle functies</li>
                            <li>Geen beperking op aantal leerlingen</li>
                        </ul>
                    </div>
                    
                    <p>Vragen over uw abonnement? Neem contact met ons op via <a href="mailto:i.abdellaoui@gmail.com">i.abdellaoui@gmail.com</a></p>
                    
                    <p>Barakallahu feeki,<br><strong>Het MijnLVS Team</strong></p>
                </div>
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
            subject: '✅ Betalingsbevestiging MijnLVS Professional',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #10b981;">Betaling Succesvol Ontvangen</h2>
                    <p>Beste ${mosque.name},</p>
                    
                    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <p style="color: #15803d; margin: 0;">
                            ✅ <strong>Wij hebben uw betaling van €${amount} succesvol ontvangen.</strong>
                        </p>
                    </div>
                    
                    <p>Uw MijnLVS Professional abonnement blijft actief en alle functies zijn beschikbaar.</p>
                    
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <h3 style="margin-top: 0;">Betalingsdetails:</h3>
                        <p style="margin: 5px 0;"><strong>Bedrag:</strong> €${amount}</p>
                        <p style="margin: 5px 0;"><strong>Factuur:</strong> ${invoice.number}</p>
                        <p style="margin: 5px 0;"><strong>Datum:</strong> ${new Date(invoice.created * 1000).toLocaleDateString('nl-NL')}</p>
                        <p style="margin: 5px 0;"><strong>Volgende betaling:</strong> ${new Date(invoice.period_end * 1000).toLocaleDateString('nl-NL')}</p>
                    </div>
                    
                    <p>Dank voor uw vertrouwen in MijnLVS!</p>
                    
                    <p>Barakallahu feeki,<br><strong>Het MijnLVS Team</strong></p>
                </div>
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
            .select('name, admin_email, subdomain')
            .eq('id', mosqueId)
            .single();
        
        if (error || !mosque) return;

        const amount = (invoice.amount_due / 100).toFixed(2);
        
        const emailContent = {
            to: mosque.admin_email,
            subject: '⚠️ Betaling Mislukt - Actie Vereist',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #dc2626;">Betaling Mislukt</h2>
                    <p>Beste ${mosque.name},</p>
                    
                    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <p style="color: #dc2626; margin: 0;">
                            ⚠️ <strong>Helaas is de betaling van €${amount} voor uw MijnLVS abonnement mislukt.</strong>
                        </p>
                    </div>
                    
                    <p>Om service onderbreking te voorkomen, is het belangrijk dat u uw betaalgegevens bijwerkt.</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="https://${mosque.subdomain}.mijnlvs.nl/dashboard" 
                           style="background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                            Betaalgegevens Bijwerken
                        </a>
                    </div>
                    
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <h3 style="margin-top: 0;">Wat kunt u doen:</h3>
                        <ul>
                            <li>Controleer of uw creditcard nog geldig is</li>
                            <li>Zorg voor voldoende saldo op uw rekening</li>
                            <li>Update uw betaalgegevens in het dashboard</li>
                            <li>Neem contact op als het probleem aanhoudt</li>
                        </ul>
                    </div>
                    
                    <p>Vragen? Neem contact met ons op via <a href="mailto:i.abdellaoui@gmail.com">i.abdellaoui@gmail.com</a></p>
                    
                    <p><strong>Het MijnLVS Team</strong></p>
                </div>
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
            .select('name, admin_email, subdomain')
            .eq('id', mosqueId)
            .single();
        
        if (error || !mosque) return;

        const emailContent = {
            to: mosque.admin_email,
            subject: 'Abonnement Geannuleerd - Bedankt voor uw vertrouwen',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #6b7280;">Abonnement Geannuleerd</h2>
                    <p>Beste ${mosque.name},</p>
                    
                    <p>Uw MijnLVS Professional abonnement is geannuleerd zoals u heeft aangevraagd.</p>
                    
                    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <h3 style="color: #0369a1; margin-top: 0;">Wat betekent dit:</h3>
                        <ul style="color: #075985;">
                            <li>U kunt nog steeds de basis functies gebruiken</li>
                            <li>Maximaal 10 leerlingen blijven toegestaan</li>
                            <li>Uw gegevens blijven veilig bewaard</li>
                            <li>U kunt altijd weer upgraden</li>
                        </ul>
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="https://${mosque.subdomain}.mijnlvs.nl/dashboard" 
                           style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                            Ga naar Dashboard
                        </a>
                    </div>
                    
                    <p>Wilt u in de toekomst weer upgraden naar Professional? Dat kan altijd via uw dashboard.</p>
                    
                    <p>Bedankt voor het vertrouwen dat u ons hebt gegeven. We hopen u in de toekomst weer te mogen bedienen.</p>
                    
                    <p>Barakallahu feeki,<br><strong>Het MijnLVS Team</strong></p>
                </div>
            `
        };

        await sendM365EmailInternal(emailContent);
        console.log(`✅ [Email] Cancellation email sent to ${mosque.admin_email}`);
        
    } catch (error) {
        console.error('[Email] Failed to send cancellation email:', error);
    }
};

// === CLEANUP FUNCTIONS ===

// Cleanup expired pending payments
const cleanupExpiredPayments = async () => {
    try {
        const { data, error } = await supabase
            .from('pending_payments')
            .update({ status: 'expired' })
            .eq('status', 'pending')
            .lt('expires_at', new Date().toISOString())
            .select('count');

        if (!error && data) {
            console.log(`[Cleanup] Marked ${data.length} payments as expired`);
        }
    } catch (error) {
        console.error('[Cleanup] Error cleaning up expired payments:', error);
    }
};

// Cleanup old webhook events
const cleanupOldWebhookEvents = async () => {
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        
        const { data, error } = await supabase
            .from('webhook_events_buffer')
            .delete()
            .lt('created_at', thirtyDaysAgo)
            .select('count');

        if (!error && data) {
            console.log(`[Cleanup] Deleted ${data.length} old webhook events`);
        }
    } catch (error) {
        console.error('[Cleanup] Error cleaning up old webhook events:', error);
    }
};

const checkForPendingRegistrations = async (sessionId, customerEmail) => {
    if (!customerEmail) return;
    
    console.log(`[Pending Check] Looking for recent registrations for: ${customerEmail}`);
    
    const thirtyMinutesAgo = new Date(Date.now() - 1800000).toISOString();
    
    const { data: recentMosques } = await supabase
        .from('mosques')
        .select('id, email, name, subscription_status')
        .eq('email', customerEmail.toLowerCase())
        .gte('created_at', thirtyMinutesAgo)
        .in('subscription_status', ['trialing', 'trial', null])
        .order('created_at', { ascending: false });
    
    if (recentMosques?.length > 0) {
        const mosque = recentMosques[0];
        console.log(`✅ [Pending Check] Found recent mosque ${mosque.id}, attempting auto-link`);
        
        const { data: payment } = await supabase
            .from('pending_payments')
            .select('*')
            .eq('stripe_session_id', sessionId)
            .single();
        
        if (payment) {
            // Gebruik de nieuwe session-based linking functie
            const { executeSessionBasedLinking } = require('./sessionLinkingService');
            await executeSessionBasedLinking(mosque.id, payment, sessionId);
            console.log(`✅ [Auto Link] Successfully linked session ${sessionId} to mosque ${mosque.id}`);
        }
    }
};

module.exports = { 
    handleStripeWebhook,
    linkPaymentToMosque,
    checkForPendingRegistrations, 
    logPaymentEvent,
    sendWelcomeEmail,
    sendTrialEndingEmail,
    sendPaymentConfirmationEmail,
    sendPaymentFailedEmail,
    sendCancellationEmail,
    cleanupExpiredPayments,
    cleanupOldWebhookEvents
};