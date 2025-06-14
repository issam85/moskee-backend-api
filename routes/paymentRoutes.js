// routes/paymentRoutes.js - GECORRIGEERD: 'parents' → 'users'
const router = require('express').Router();
const { supabase } = require('../config/database');
const { stripe } = require('../config/stripe');
const { sendError } = require('../utils/errorHelper');

// === Geautomatiseerde Stripe Routes ===

// POST create a stripe checkout session met tracking
router.post('/stripe/create-checkout-session', async (req, res) => {
    try {
        const { priceId, metadata = {} } = req.body;
        
        if (!priceId) {
            return sendError(res, 400, "Prijs-ID ontbreekt.", null, req);
        }

        // Genereer unieke tracking ID voor linking
        const trackingId = `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Basis session data
        let sessionData = {
            mode: 'subscription',
            payment_method_types: ['card', 'ideal'],
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${process.env.FRONTEND_URL}/register?payment_success=true&session_id={CHECKOUT_SESSION_ID}&tracking_id=${trackingId}`,
            cancel_url: `${process.env.FRONTEND_URL}/?payment_canceled=true`,
            subscription_data: {
                trial_period_days: 14,
                metadata: {
                    ...metadata,
                    tracking_id: trackingId,
                    source: 'mijnlvs_platform',
                    registration_pending: 'true',  // Flag voor webhook
                    created_at: new Date().toISOString()
                }
            },
            billing_address_collection: 'required',
            // Voeg custom fields toe voor extra info als gewenst
            custom_fields: [
                {
                    key: 'organization_name',
                    label: { type: 'custom', custom: 'Naam van uw moskee/organisatie' },
                    type: 'text',
                    optional: true
                }
            ]
        };

        // Voor ingelogde gebruikers (upgraden vanuit dashboard)
        if (req.user) {
            console.log(`[Stripe Checkout] Creating session for authenticated user: ${req.user.email} (mosque: ${req.user.mosque_id})`);
            
            sessionData.customer_email = req.user.email;
            sessionData.subscription_data.metadata = {
                ...sessionData.subscription_data.metadata,
                app_user_id: req.user.id,
                app_mosque_id: req.user.mosque_id,
                user_email: req.user.email,
                registration_pending: 'false'  // Al geregistreerd
            };
            
            // Directe redirect naar dashboard na betaling
            sessionData.success_url = `${process.env.FRONTEND_URL}/dashboard?payment_success=true&session_id={CHECKOUT_SESSION_ID}`;
            sessionData.cancel_url = `${process.env.FRONTEND_URL}/dashboard?payment_canceled=true`;
        } else {
            console.log(`[Stripe Checkout] Creating session for anonymous user with tracking ${trackingId}`);
        }

        // Maak de Stripe checkout session aan
        const session = await stripe.checkout.sessions.create(sessionData);
        
        console.log(`[Stripe] Created session ${session.id} with tracking ${trackingId}`);
        
        res.json({ 
            url: session.url,
            session_id: session.id,
            tracking_id: trackingId
        });
        
    } catch (error) {
        console.error('Stripe checkout session creation failed:', error);
        
        // Specifieke Stripe error handling
        if (error.type === 'StripeCardError') {
            return sendError(res, 400, 'Er is een probleem met de betaalgegevens.', error.message, req);
        } else if (error.type === 'StripeRateLimitError') {
            return sendError(res, 429, 'Te veel verzoeken. Probeer het over een moment opnieuw.', error.message, req);
        } else if (error.type === 'StripeInvalidRequestError') {
            return sendError(res, 400, 'Ongeldige betalingsaanvraag.', error.message, req);
        } else if (error.type === 'StripeAPIError') {
            return sendError(res, 500, 'Er is een probleem met de betaalservice.', null, req);
        }
        
        sendError(res, 500, 'Fout bij aanmaken Stripe checkout sessie.', error.message, req);
    }
});

// POST Link pending payment na registratie - KERNFUNCTIE VAN AUTOMATION
router.post('/stripe/link-pending-payment', async (req, res) => {
    try {
        const { mosqueId, userEmail, trackingId } = req.body;
        
        if (!mosqueId || !userEmail) {
            return sendError(res, 400, "Moskee ID en email zijn verplicht.", null, req);
        }

        console.log(`[Payment Linking] Attempting to link payment for mosque ${mosqueId}, email: ${userEmail}, tracking: ${trackingId || 'none'}`);

        // Probeer linking op basis van tracking ID (meest betrouwbaar)
        let linkedPayment = null;
        
        if (trackingId) {
            const { data: trackingPayment, error: trackingError } = await supabase
                .from('pending_payments')
                .select('*')
                .eq('tracking_id', trackingId)
                .eq('status', 'pending')
                .single();
                
            if (!trackingError && trackingPayment) {
                linkedPayment = trackingPayment;
                console.log(`[Payment Linking] ✅ Found payment by tracking ID: ${trackingId}`);
            }
        }

        // Fallback: probeer linking op basis van email (minder betrouwbaar maar werkt)
        if (!linkedPayment) {
            const { data: emailPayments, error: emailError } = await supabase
                .from('pending_payments')
                .select('*')
                .eq('customer_email', userEmail)
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(1);
                
            if (!emailError && emailPayments && emailPayments.length > 0) {
                linkedPayment = emailPayments[0];
                console.log(`[Payment Linking] ✅ Found payment by email: ${userEmail}`);
            }
        }

        // Fallback 2: Zoek op basis van recente sessies zonder email match
        if (!linkedPayment && trackingId) {
            const { data: recentPayments, error: recentError } = await supabase
                .from('pending_payments')
                .select('*')
                .eq('status', 'pending')
                .gte('created_at', new Date(Date.now() - 3600000).toISOString()) // Laatste uur
                .order('created_at', { ascending: false });
                
            if (!recentError && recentPayments && recentPayments.length > 0) {
                // Zoek naar payment met matching tracking ID in metadata
                for (const payment of recentPayments) {
                    if (payment.metadata && payment.metadata.tracking_id === trackingId) {
                        linkedPayment = payment;
                        console.log(`[Payment Linking] ✅ Found payment by metadata tracking: ${trackingId}`);
                        break;
                    }
                }
            }
        }

        if (linkedPayment) {
            // Update pending payment met mosque link
            await supabase
                .from('pending_payments')
                .update({ 
                    mosque_id: mosqueId,
                    status: 'linked',
                    updated_at: new Date().toISOString()
                })
                .eq('id', linkedPayment.id);

            // Update moskee met subscription info - DIRECT ACTIEF
            const updateData = {
                stripe_customer_id: linkedPayment.stripe_customer_id,
                stripe_subscription_id: linkedPayment.stripe_subscription_id,
                subscription_status: 'active',  // Direct actief na succesvolle betaling
                trial_ends_at: null,  // Remove trial restriction
                updated_at: new Date().toISOString()
            };

            const { error: updateError } = await supabase
                .from('mosques')
                .update(updateData)
                .eq('id', mosqueId);

            if (updateError) {
                console.error('[Payment Linking] Error updating mosque:', updateError);
                throw updateError;
            }

            // Process any buffered webhook events
            await processBufferedWebhookEvents(mosqueId, userEmail, linkedPayment.stripe_subscription_id);

            console.log(`[Payment Linking] ✅ Successfully linked payment ${linkedPayment.id} to mosque ${mosqueId}`);

            res.json({ 
                success: true, 
                message: 'Betaling succesvol gekoppeld! Uw Professional account is direct actief.',
                subscription_status: 'active',
                payment_details: {
                    amount: linkedPayment.amount,
                    currency: linkedPayment.currency,
                    subscription_id: linkedPayment.stripe_subscription_id
                }
            });
        } else {
            console.log(`[Payment Linking] ⚠️ No pending payment found for email: ${userEmail}, tracking: ${trackingId}`);
            
            // Check if there might be a payment still processing
            await checkForDelayedPayments(userEmail, trackingId);
            
            res.json({ 
                success: false, 
                message: 'Geen openstaande betaling gevonden. De betaling wordt mogelijk nog verwerkt.',
                subscription_status: 'trialing',
                suggestion: 'Probeer over een paar minuten opnieuw in te loggen, of neem contact met ons op als het probleem aanhoudt.'
            });
        }

    } catch (error) {
        console.error('Error linking pending payment:', error);
        sendError(res, 500, 'Fout bij koppelen betaling.', error.message, req);
    }
});

// Helper functie voor buffered webhook events
const processBufferedWebhookEvents = async (mosqueId, email, subscriptionId) => {
    try {
        const { data: bufferedEvents, error } = await supabase
            .from('webhook_events_buffer')
            .select('*')
            .or(`customer_email.eq.${email},stripe_subscription_id.eq.${subscriptionId}`)
            .eq('processed', false);

        if (error || !bufferedEvents || bufferedEvents.length === 0) {
            console.log('[Webhook Buffer] No buffered events found to process');
            return;
        }

        console.log(`[Webhook Buffer] Processing ${bufferedEvents.length} buffered events for mosque ${mosqueId}`);

        for (const event of bufferedEvents) {
            // Process het event nu we de moskee hebben
            console.log(`[Webhook Buffer] Processing buffered event ${event.stripe_event_id} for mosque ${mosqueId}`);
            
            // Update metadata met mosque_id als het nog niet aanwezig is
            if (event.metadata && !event.metadata.app_mosque_id) {
                event.metadata.app_mosque_id = mosqueId;
            }

            // Mark als processed
            await supabase
                .from('webhook_events_buffer')
                .update({ 
                    processed: true,
                    processed_at: new Date().toISOString(),
                    mosque_id: mosqueId
                })
                .eq('id', event.id);
        }

        console.log(`[Webhook Buffer] ✅ Processed ${bufferedEvents.length} buffered events`);
    } catch (error) {
        console.error('Error processing buffered webhook events:', error);
    }
};

// Helper functie om te checken voor vertraagde betalingen
const checkForDelayedPayments = async (email, trackingId) => {
    try {
        // Sla de poging op voor later retry
        await supabase.from('payment_retry_queue').insert({
            customer_email: email,
            tracking_id: trackingId,
            retry_count: 0,
            next_retry_at: new Date(Date.now() + 300000).toISOString(), // 5 minuten
            created_at: new Date().toISOString()
        });
        
        console.log(`[Payment Retry] Queued retry for email: ${email}, tracking: ${trackingId}`);
    } catch (error) {
        console.error('Error queuing payment retry:', error);
    }
};

// GET retry pending payments - Cron job endpoint
router.post('/stripe/retry-pending-links', async (req, res) => {
    try {
        // Alleen toegankelijk voor admins of interne calls
        const authHeader = req.headers.authorization;
        if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
            return sendError(res, 401, "Niet geautoriseerd voor interne API.", null, req);
        }

        const { data: retryQueue, error } = await supabase
            .from('payment_retry_queue')
            .select('*')
            .eq('processed', false)
            .lte('next_retry_at', new Date().toISOString())
            .lt('retry_count', 5); // Max 5 pogingen

        if (error || !retryQueue || retryQueue.length === 0) {
            return res.json({ message: 'No pending retries found', processed: 0 });
        }

        let processedCount = 0;

        for (const retry of retryQueue) {
            // Zoek naar recent geregistreerde moskeeën met dit email
            const { data: mosques, error: mosqueError } = await supabase
                .from('mosques')
                .select('id, email') // ✅ FIXED: was admin_email, nu email
                .eq('email', retry.customer_email)
                .gte('created_at', new Date(Date.now() - 86400000).toISOString()); // Laatste 24 uur

            if (!mosqueError && mosques && mosques.length > 0) {
                // Probeer linking voor elke gevonden moskee
                for (const mosque of mosques) {
                    const linkResult = await tryLinkPayment(mosque.id, mosque.email, retry.tracking_id);
                    if (linkResult.success) {
                        processedCount++;
                        
                        // Mark retry als processed
                        await supabase
                            .from('payment_retry_queue')
                            .update({ 
                                processed: true,
                                processed_at: new Date().toISOString(),
                                mosque_id: mosque.id
                            })
                            .eq('id', retry.id);
                        break;
                    }
                }
            }

            // Update retry count als niet gelukt
            if (!mosques || mosques.length === 0) {
                await supabase
                    .from('payment_retry_queue')
                    .update({ 
                        retry_count: retry.retry_count + 1,
                        next_retry_at: new Date(Date.now() + (retry.retry_count + 1) * 600000).toISOString() // Exponential backoff
                    })
                    .eq('id', retry.id);
            }
        }

        res.json({ 
            message: `Processed ${processedCount} pending payment links`,
            processed: processedCount,
            total_checked: retryQueue.length
        });

    } catch (error) {
        console.error('Error in retry pending links:', error);
        sendError(res, 500, 'Fout bij retry pending links.', error.message, req);
    }
});

// Helper functie voor retry linking
const tryLinkPayment = async (mosqueId, userEmail, trackingId) => {
    try {
        // Hergebruik de bestaande linking logica
        let linkedPayment = null;
        
        if (trackingId) {
            const { data: trackingPayment, error: trackingError } = await supabase
                .from('pending_payments')
                .select('*')
                .eq('tracking_id', trackingId)
                .eq('status', 'pending')
                .single();
                
            if (!trackingError && trackingPayment) {
                linkedPayment = trackingPayment;
            }
        }

        if (!linkedPayment) {
            const { data: emailPayments, error: emailError } = await supabase
                .from('pending_payments')
                .select('*')
                .eq('customer_email', userEmail)
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(1);
                
            if (!emailError && emailPayments && emailPayments.length > 0) {
                linkedPayment = emailPayments[0];
            }
        }

        if (linkedPayment) {
            // Voer linking uit
            await supabase
                .from('pending_payments')
                .update({ 
                    mosque_id: mosqueId,
                    status: 'linked',
                    updated_at: new Date().toISOString()
                })
                .eq('id', linkedPayment.id);

            await supabase
                .from('mosques')
                .update({
                    stripe_customer_id: linkedPayment.stripe_customer_id,
                    stripe_subscription_id: linkedPayment.stripe_subscription_id,
                    subscription_status: 'active',
                    trial_ends_at: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', mosqueId);

            console.log(`[Retry Link] ✅ Successfully linked payment ${linkedPayment.id} to mosque ${mosqueId}`);
            return { success: true };
        }

        return { success: false };
    } catch (error) {
        console.error('Error in tryLinkPayment:', error);
        return { success: false, error: error.message };
    }
};

// === Bestaande Routes (subscription status, portal, etc.) ===

// GET stripe subscription status voor huidige gebruiker
router.get('/stripe/subscription-status', async (req, res) => {
    if (!req.user) {
        return sendError(res, 401, "Je moet ingelogd zijn.", null, req);
    }
    
    try {
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('subscription_status, trial_ends_at, stripe_customer_id, stripe_subscription_id')
            .eq('id', req.user.mosque_id)
            .single();

        if (error) throw error;

        let subscriptionDetails = null;
        
        // Als er een Stripe subscription ID is, haal de details op
        if (mosque.stripe_subscription_id) {
            try {
                subscriptionDetails = await stripe.subscriptions.retrieve(mosque.stripe_subscription_id);
            } catch (stripeError) {
                console.warn(`[Stripe] Kon subscription ${mosque.stripe_subscription_id} niet ophalen:`, stripeError.message);
            }
        }

        res.json({
            subscription_status: mosque.subscription_status,
            trial_ends_at: mosque.trial_ends_at,
            has_active_subscription: ['active', 'trialing'].includes(mosque.subscription_status),
            stripe_customer_id: mosque.stripe_customer_id,
            stripe_subscription_id: mosque.stripe_subscription_id,
            subscription_details: subscriptionDetails ? {
                status: subscriptionDetails.status,
                current_period_start: new Date(subscriptionDetails.current_period_start * 1000),
                current_period_end: new Date(subscriptionDetails.current_period_end * 1000),
                trial_end: subscriptionDetails.trial_end ? new Date(subscriptionDetails.trial_end * 1000) : null,
                plan_name: subscriptionDetails.items.data[0]?.price?.nickname || 'Professional Plan',
                amount: subscriptionDetails.items.data[0]?.price?.unit_amount ? (subscriptionDetails.items.data[0].price.unit_amount / 100) : 0,
                currency: subscriptionDetails.items.data[0]?.price?.currency || 'eur'
            } : null
        });
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen subscription status.', error.message, req);
    }
});

// POST create a customer portal session
router.post('/stripe/create-portal-session', async (req, res) => {
    if (!req.user) {
        return sendError(res, 401, "Je moet ingelogd zijn.", null, req);
    }
    
    try {
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('stripe_customer_id')
            .eq('id', req.user.mosque_id)
            .single();

        if (error || !mosque.stripe_customer_id) {
            return sendError(res, 400, "Geen Stripe klant gevonden. Neem contact op met support.", null, req);
        }

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: mosque.stripe_customer_id,
            return_url: `${process.env.FRONTEND_URL}/dashboard`,
        });

        res.json({ url: portalSession.url });
    } catch (error) {
        console.error('Stripe portal session creation failed:', error);
        sendError(res, 500, 'Fout bij aanmaken portal sessie.', error.message, req);
    }
});

// GET session details
router.get('/stripe/session/:sessionId', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
        
        res.json({
            id: session.id,
            status: session.status,
            customer_email: session.customer_email,
            payment_status: session.payment_status,
            subscription: session.subscription,
            metadata: session.metadata
        });
    } catch (error) {
        console.error('Error retrieving Stripe session:', error);
        sendError(res, 404, 'Sessie niet gevonden.', error.message, req);
    }
});

// === Manual Payment Routes (voor admins) ===

// GET all payments for a mosque
router.get('/mosque/:mosqueId', async (req, res) => {
    if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    
    try {
        const { data, error } = await supabase
            .from('payments')
            // ✅ FIXED: parent_id references users table with role filter
            .select('*, parent:parent_id(name, email), processed_by_user:processed_by(name)')
            .eq('mosque_id', req.params.mosqueId)
            .order('payment_date', { ascending: false });
            
        if (error) throw error;
        
        res.json(data);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen betalingen.', error.message, req);
    }
});

// POST register a new manual payment
router.post('/', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    
    try {
        const { mosque_id, parent_id, amount, payment_method, payment_date, description } = req.body;
        
        if (!mosque_id || !parent_id || !amount || !payment_method || !payment_date) {
            return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
        }
        
        if (req.user.mosque_id !== mosque_id) {
            return sendError(res, 403, "U kunt alleen betalingen registreren voor uw eigen moskee.", null, req);
        }

        // ✅ FIXED: Check users table with role filter instead of non-existent parents table
        const { data: parent, error: parentError } = await supabase
            .from('users')  // ✅ CORRECT TABLE NAME
            .select('id, name')
            .eq('id', parent_id)
            .eq('mosque_id', mosque_id)
            .eq('role', 'parent')  // ✅ FILTER ON ROLE
            .single();
            
        if (parentError || !parent) {
            return sendError(res, 400, "Ouder niet gevonden.", null, req);
        }

        const paymentData = {
            mosque_id,
            parent_id,
            amount: parseFloat(amount),
            payment_method,
            payment_date: new Date(payment_date).toISOString(),
            description: description || null,
            processed_by: req.user.id,
            created_at: new Date().toISOString()
        };

        const { data: newPayment, error } = await supabase
            .from('payments')
            .insert(paymentData)
            .select(`
                *,
                parent:parent_id(name, email),
                processed_by_user:processed_by(name)
            `)
            .single();
            
        if (error) throw error;

        console.log(`[Manual Payment] Registered €${amount} for ${parent.name} by ${req.user.name}`);
        
        res.status(201).json({ 
            success: true, 
            message: `Betaling van €${amount} geregistreerd voor ${parent.name}.`, 
            payment: newPayment 
        });
    } catch (error) {
        console.error('Error registering manual payment:', error);
        sendError(res, 500, 'Fout bij registreren betaling.', error.message, req);
    }
});

module.exports = router;