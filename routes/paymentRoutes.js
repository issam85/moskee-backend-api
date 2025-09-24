// routes/paymentRoutes.js - GECORRIGEERD: 'parents' → 'users'
const router = require('express').Router();
const { supabase } = require('../config/database');
const { stripe } = require('../config/stripe');
const { sendError } = require('../utils/errorHelper');

// === Geautomatiseerde Stripe Routes ===

// ===== STAP 1: BACKEND (routes/paymentRoutes.js) =====
// Vervang de bestaande POST /stripe/create-checkout-session route met:

router.post('/stripe/create-checkout-session', async (req, res) => {
    try {
        // ✅ Ontvang de 'skipTrial' parameter uit de request body
        const { priceId, metadata = {}, skipTrial = false } = req.body;
        
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
                metadata: {
                    ...metadata,
                    tracking_id: trackingId,
                    source: 'mijnlvs_platform',
                    registration_pending: 'true',
                    created_at: new Date().toISOString()
                }
            },
            billing_address_collection: 'required',
            custom_fields: [
                {
                    key: 'organization_name',
                    label: { type: 'custom', custom: 'Naam van uw moskee/organisatie' },
                    type: 'text',
                    optional: true
                }
            ]
        };

        // ✅ DE CRUCIALE LOGICA: Voeg alleen de trial toe als het NIET wordt overgeslagen
        if (!skipTrial) {
            sessionData.subscription_data.trial_period_days = 14;
            console.log(`[Stripe] Creating session WITH 14-day trial for tracking ${trackingId}`);
        } else {
            console.log(`[Stripe] Creating session WITHOUT trial (direct payment) for tracking ${trackingId}`);
        }

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

router.post('/stripe/link-by-session', async (req, res) => {
    try {
        const { mosque_id, session_id, tracking_id, admin_email } = req.body;
        
        if (!mosque_id || !session_id) {
            return sendError(res, 400, "Mosque ID en Session ID zijn verplicht.", null, req);
        }
        
        console.log(`[Session Linking] Attempting link for mosque ${mosque_id}, session: ${session_id}`);
        
        const { findPaymentBySession, executeSessionBasedLinking, queueSessionRetry } = require('../services/sessionLinkingService');
        
        // Strategy 1: Direct session ID lookup
        let pendingPayment = await findPaymentBySession(session_id);
        
        if (!pendingPayment && tracking_id) {
            // Strategy 2: Tracking ID fallback
            const { data } = await supabase
                .from('pending_payments')
                .select('*')
                .eq('tracking_id', tracking_id)
                .in('status', ['pending', 'completed'])
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            pendingPayment = data;
        }
        
        if (pendingPayment) {
            console.log(`✅ [Session Linking] Found payment ${pendingPayment.id} via session ${session_id}`);
            
            const result = await executeSessionBasedLinking(mosque_id, pendingPayment, session_id);
            
            res.json({
                success: true,
                message: `Betaling succesvol gekoppeld! Uw ${result.planType} account is direct actief.`,
                payment_id: pendingPayment.id,
                subscription_status: 'active',
                plan_type: result.planType,
                session_id: session_id,
                linking_method: 'session_id'
            });
            
        } else {
            console.log(`⚠️ [Session Linking] No payment found for session ${session_id}`);
            
            await queueSessionRetry(mosque_id, session_id, tracking_id, admin_email);
            
            res.json({
                success: false,
                message: 'Payment wordt nog verwerkt. Probeer over een paar minuten opnieuw.',
                session_id: session_id,
                queued_for_retry: true
            });
        }
        
    } catch (error) {
        console.error('[Session Linking] Error:', error);
        sendError(res, 500, 'Session linking failed.', error.message, req);
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

// GET all payments for a mosque (admin only)
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

// ✅ DEBUG TEST ROUTE: Simple parent test
router.get('/parent/test', async (req, res) => {
    console.log(`[Parent Test] Route hit by user: ${req.user?.id}, role: ${req.user?.role}, name: ${req.user?.name}`);
    res.json({ message: 'Parent test route working', user: req.user?.id, role: req.user?.role });
});

// ✅ NIEUWE ROUTE: GET payments for a specific parent (ouders kunnen hun eigen betalingen bekijken)
router.get('/parent/my-payments', async (req, res) => {
    if (req.user.role !== 'parent') {
        return sendError(res, 403, "Alleen ouders kunnen deze route gebruiken.", null, req);
    }

    try {
        console.log(`[Parent Payments DEBUG] Request from parent ID: ${req.user.id}, name: ${req.user.name}, email: ${req.user.email}, mosque: ${req.user.mosque_id}`);

        const { data, error } = await supabase
            .from('payments')
            .select('id, amount, payment_method, payment_date, description, notes, created_at')
            .eq('parent_id', req.user.id)
            .eq('mosque_id', req.user.mosque_id)
            .order('payment_date', { ascending: false });

        if (error) {
            console.error(`[Parent Payments ERROR] Database error for parent ${req.user.id}:`, error);
            throw error;
        }

        console.log(`[Parent Payments DEBUG] Retrieved ${data.length} payments for parent ${req.user.name} (${req.user.email})`);
        console.log(`[Parent Payments DEBUG] Payments data:`, JSON.stringify(data, null, 2));

        res.json(data);
    } catch (error) {
        console.error('Error fetching parent payments:', error);
        sendError(res, 500, 'Fout bij ophalen van uw betalingen.', error.message, req);
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

router.put('/:paymentId', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    
    try {
        const { paymentId } = req.params;
        const { parent_id, amount, payment_method, payment_date, description, notes } = req.body;
        
        // Validatie
        if (!parent_id || !amount || !payment_method || !payment_date) {
            return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
        }

        if (parseFloat(amount) <= 0) {
            return sendError(res, 400, "Bedrag moet positief zijn.", null, req);
        }

        // Controleer of betaling bestaat en bij juiste moskee hoort
        const { data: existingPayment, error: fetchError } = await supabase
            .from('payments')
            .select('id, mosque_id, parent_id')
            .eq('id', paymentId)
            .eq('mosque_id', req.user.mosque_id)
            .single();

        if (fetchError || !existingPayment) {
            return sendError(res, 404, "Betaling niet gevonden.", null, req);
        }

        // Controleer of de nieuwe ouder bestaat en bij de moskee hoort
        const { data: parent, error: parentError } = await supabase
            .from('users')
            .select('id, name')
            .eq('id', parent_id)
            .eq('mosque_id', req.user.mosque_id)
            .eq('role', 'parent')
            .single();
            
        if (parentError || !parent) {
            return sendError(res, 400, "Ouder niet gevonden.", null, req);
        }

        // Update de betaling
        const updateData = {
            parent_id,
            amount: parseFloat(amount),
            payment_method,
            payment_date: new Date(payment_date).toISOString(),
            description: description || null,
            notes: notes || null,
            updated_at: new Date().toISOString()
        };

        const { data: updatedPayment, error: updateError } = await supabase
            .from('payments')
            .update(updateData)
            .eq('id', paymentId)
            .eq('mosque_id', req.user.mosque_id)
            .select(`
                *,
                parent:parent_id(name, email),
                processed_by_user:processed_by(name)
            `)
            .single();
            
        if (updateError) throw updateError;

        console.log(`[Payment Update] Updated payment ${paymentId} by ${req.user.name}`);
        
        res.json({ 
            success: true, 
            message: `Betaling succesvol bewerkt.`, 
            payment: updatedPayment 
        });
    } catch (error) {
        console.error('Error updating payment:', error);
        sendError(res, 500, 'Fout bij bewerken betaling.', error.message, req);
    }
});

// DELETE /api/payments/:paymentId - Verwijder een betaling
router.delete('/:paymentId', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    
    try {
        const { paymentId } = req.params;

        // Controleer of betaling bestaat en bij juiste moskee hoort
        const { data: existingPayment, error: fetchError } = await supabase
            .from('payments')
            .select('id, mosque_id, parent_id, amount')
            .eq('id', paymentId)
            .eq('mosque_id', req.user.mosque_id)
            .single();

        if (fetchError || !existingPayment) {
            return sendError(res, 404, "Betaling niet gevonden.", null, req);
        }

        // Verwijder de betaling
        const { error: deleteError } = await supabase
            .from('payments')
            .delete()
            .eq('id', paymentId)
            .eq('mosque_id', req.user.mosque_id);
            
        if (deleteError) throw deleteError;

        console.log(`[Payment Delete] Deleted payment ${paymentId} (€${existingPayment.amount}) by ${req.user.name}`);
        
        res.json({ 
            success: true, 
            message: `Betaling succesvol verwijderd.`
        });
    } catch (error) {
        console.error('Error deleting payment:', error);
        sendError(res, 500, 'Fout bij verwijderen betaling.', error.message, req);
    }
});

//kan er wellicht uit
router.post('/stripe/emergency-upgrade', async (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins.", null, req);
    }

    try {
        const mosqueId = req.user.mosque_id;
        const { planType = 'professional' } = req.body;
        
        console.log(`[Emergency Upgrade] Upgrading mosque ${mosqueId} to ${planType}`);

        // ✅ GECORRIGEERDE LIMITS - Professional & Premium = Onbeperkt
        const limits = {
            trial: { students: 10, teachers: 2 },
            basic: { students: 10, teachers: 2 }, 
            professional: { students: null, teachers: null }, // ✅ ONBEPERKT
            premium: { students: null, teachers: null }       // ✅ ONBEPERKT
        };
        
        const selectedLimits = limits[planType] || limits.professional;

        // Force upgrade
        const { data: updatedMosque, error } = await supabase
            .from('mosques')
            .update({
                subscription_status: 'active',
                plan_type: planType,
                trial_ends_at: null,
                trial_started_at: null,
                max_students: selectedLimits.students, // null = onbeperkt
                max_teachers: selectedLimits.teachers,  // null = onbeperkt
                updated_at: new Date().toISOString()
            })
            .eq('id', mosqueId)
            .select()
            .single();

        if (error) throw error;

        console.log(`✅ [Emergency Upgrade] Mosque ${mosqueId} upgraded to ${planType}`);
        console.log(`✅ Students: ${selectedLimits.students || 'Onbeperkt'}, Teachers: ${selectedLimits.teachers || 'Onbeperkt'}`);

        res.json({
            success: true,
            message: `Account succesvol geüpgraded naar ${planType}! ${planType === 'professional' || planType === 'premium' ? 'Geen restricties op aantallen.' : ''}`,
            mosque: {
                id: updatedMosque.id,
                name: updatedMosque.name,
                subscription_status: updatedMosque.subscription_status,
                plan_type: updatedMosque.plan_type,
                max_students: updatedMosque.max_students,
                max_teachers: updatedMosque.max_teachers,
                trial_ends_at: updatedMosque.trial_ends_at,
                limits_description: planType === 'professional' || planType === 'premium' ? 'Onbeperkt' : `Max ${selectedLimits.students} leerlingen, ${selectedLimits.teachers} leraren`
            }
        });

    } catch (error) {
        console.error('[Emergency Upgrade] Error:', error);
        sendError(res, 500, 'Upgrade failed.', error.message, req);
    }
});

//kan er wellicht uit
router.get('/debug/my-payments', async (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins.", null, req);
    }

    try {
        const mosqueId = req.user.mosque_id;
        
        // Get mosque info
        const { data: mosque, error: mosqueError } = await supabase
            .from('mosques')
            .select('*')
            .eq('id', mosqueId)
            .single();

        if (mosqueError) throw mosqueError;

        // Get all payments for this email
        const { data: allPayments, error: paymentsError } = await supabase
            .from('pending_payments')
            .select('*')
            .eq('customer_email', mosque.email)
            .order('created_at', { ascending: false });

        if (paymentsError) throw paymentsError;

        res.json({
            mosque: {
                id: mosque.id,
                name: mosque.name,
                email: mosque.email,
                subscription_status: mosque.subscription_status,
                plan_type: mosque.plan_type,
                trial_ends_at: mosque.trial_ends_at,
                stripe_customer_id: mosque.stripe_customer_id,
                stripe_subscription_id: mosque.stripe_subscription_id,
                max_students: mosque.max_students,
                max_teachers: mosque.max_teachers
            },
            payments: allPayments,
            summary: {
                total_payments: allPayments.length,
                pending_payments: allPayments.filter(p => p.status === 'pending').length,
                linked_payments: allPayments.filter(p => p.status === 'linked').length,
                unlinked_payments: allPayments.filter(p => !p.mosque_id).length
            }
        });

    } catch (error) {
        console.error('[Debug] Error:', error);
        sendError(res, 500, 'Debug info fout.', error.message, req);
    }
});

//kan er wellicht uit
router.post('/stripe/retry-payment-linking', async (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins.", null, req);
    }

    try {
        const mosqueId = req.user.mosque_id;
        
        // Get mosque email
        const { data: mosque, error: mosqueError } = await supabase
            .from('mosques')
            .select('email, name')
            .eq('id', mosqueId)
            .single();

        if (mosqueError) throw mosqueError;

        console.log(`[Manual Retry] Attempting payment link for ${mosque.email}`);

        // Use the centralized linking service
        const { linkPendingPaymentAfterRegistration } = require('../services/paymentLinkingService');
        
        const result = await linkPendingPaymentAfterRegistration({
            mosqueId: mosqueId,
            adminEmail: mosque.email,
            trackingId: null,
            sessionId: null
        });

        if (result.success) {
            res.json({
                success: true,
                message: `Payment succesvol gelinkt! Uw ${result.planType} account is nu actief.`,
                result: result
            });
        } else {
            res.json({
                success: false,
                message: `Geen openstaande payment gevonden. Reden: ${result.reason}`,
                result: result
            });
        }

    } catch (error) {
        console.error('[Manual Retry] Error:', error);
        sendError(res, 500, 'Retry failed.', error.message, req);
    }
});

router.post('/stripe/link-by-session', async (req, res) => {
    try {
        const { mosque_id, session_id, tracking_id, admin_email } = req.body;
        
        if (!mosque_id || !session_id) {
            return sendError(res, 400, "Mosque ID en Session ID zijn verplicht.", null, req);
        }
        
        console.log(`[Session Linking] Attempting link for mosque ${mosque_id}, session: ${session_id}`);
        
        // Strategy 1: Direct session ID lookup (most reliable)
        let pendingPayment = await findPaymentBySession(session_id);
        
        if (!pendingPayment && tracking_id) {
            // Strategy 2: Tracking ID fallback
            pendingPayment = await findPaymentByTracking(tracking_id);
        }
        
        if (!pendingPayment && admin_email) {
            // Strategy 3: Recent email lookup as last resort
            pendingPayment = await findRecentPaymentByEmail(admin_email);
        }
        
        if (pendingPayment) {
            console.log(`✅ [Session Linking] Found payment ${pendingPayment.id} via session ${session_id}`);
            
            // Execute atomic linking
            const result = await executeSessionBasedLinking(mosque_id, pendingPayment, session_id);
            
            res.json({
                success: true,
                message: `Betaling succesvol gekoppeld! Uw ${result.planType} account is direct actief.`,
                payment_id: pendingPayment.id,
                subscription_status: 'active',
                plan_type: result.planType,
                session_id: session_id,
                linking_method: 'session_id'
            });
            
        } else {
            console.log(`⚠️ [Session Linking] No payment found for session ${session_id}`);
            
            // Queue for retry with session context
            await queueSessionRetry(mosque_id, session_id, tracking_id, admin_email);
            
            res.json({
                success: false,
                message: 'Payment wordt nog verwerkt. Probeer over een paar minuten opnieuw.',
                session_id: session_id,
                queued_for_retry: true
            });
        }
        
    } catch (error) {
        console.error('[Session Linking] Error:', error);
        sendError(res, 500, 'Session linking failed.', error.message, req);
    }
});

module.exports = router;