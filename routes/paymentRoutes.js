// routes/paymentRoutes.js - Complete versie met volledige Stripe ondersteuning
const router = require('express').Router();
const { supabase } = require('../config/database');
const { stripe } = require('../config/stripe');
const { sendError } = require('../utils/errorHelper');

// === Stripe Routes ===

// POST create a stripe checkout session
router.post('/stripe/create-checkout-session', async (req, res) => {
    try {
        const { priceId, metadata = {} } = req.body;
        
        if (!priceId) {
            return sendError(res, 400, "Prijs-ID ontbreekt.", null, req);
        }

        // Basis session data voor zowel anonieme als ingelogde gebruikers
        let sessionData = {
            mode: 'subscription',
            payment_method_types: ['card', 'ideal'],
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${process.env.FRONTEND_URL}/dashboard?payment_success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL}/?payment_canceled=true`,
            subscription_data: {
                trial_period_days: 14,
                metadata: {
                    ...metadata,
                    source: 'mijnlvs_platform',
                    created_at: new Date().toISOString()
                }
            },
            // Voeg billing address collection toe
            billing_address_collection: 'required'
        };

        // Als gebruiker ingelogd is, voeg extra metadata en email toe
        if (req.user) {
            console.log(`[Stripe Checkout] Creating session for authenticated user: ${req.user.email} (mosque: ${req.user.mosque_id})`);
            
            sessionData.customer_email = req.user.email;
            sessionData.subscription_data.metadata = {
                ...sessionData.subscription_data.metadata,
                app_user_id: req.user.id,
                app_mosque_id: req.user.mosque_id,
                user_email: req.user.email
            };
            
            // Aangepaste success URL voor ingelogde gebruikers
            sessionData.success_url = `${process.env.FRONTEND_URL}/dashboard?payment_success=true&session_id={CHECKOUT_SESSION_ID}`;
            sessionData.cancel_url = `${process.env.FRONTEND_URL}/dashboard?payment_canceled=true`;
        } else {
            console.log(`[Stripe Checkout] Creating session for anonymous user from landing page`);
            
            // Voor anonieme gebruikers, redirect naar registratie na succesvolle betaling
            sessionData.success_url = `${process.env.FRONTEND_URL}/register?payment_success=true&session_id={CHECKOUT_SESSION_ID}`;
        }

        // Maak de Stripe checkout session aan
        const session = await stripe.checkout.sessions.create(sessionData);
        
        console.log(`[Stripe Checkout] Session created successfully: ${session.id}`);
        
        res.json({ 
            url: session.url,
            session_id: session.id 
        });
        
    } catch (error) {
        console.error('Stripe checkout session creation failed:', error);
        
        // Specifieke error handling voor Stripe
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
                plan_name: subscriptionDetails.items.data[0]?.price?.nickname || 'Professional Plan'
            } : null
        });
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen subscription status.', error.message, req);
    }
});

// POST create a customer portal session (voor abonnement beheer)
router.post('/stripe/create-portal-session', async (req, res) => {
    if (!req.user) {
        return sendError(res, 401, "Je moet ingelogd zijn.", null, req);
    }
    
    try {
        // Haal de customer ID op uit de database
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('stripe_customer_id')
            .eq('id', req.user.mosque_id)
            .single();

        if (error || !mosque.stripe_customer_id) {
            return sendError(res, 400, "Geen Stripe klant gevonden voor deze moskee.", null, req);
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

// GET session details (voor payment success page)
router.get('/stripe/session/:sessionId', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
        
        // Alleen basis informatie teruggeven (geen gevoelige data)
        res.json({
            id: session.id,
            status: session.status,
            customer_email: session.customer_email,
            payment_status: session.payment_status,
            subscription: session.subscription
        });
    } catch (error) {
        console.error('Error retrieving Stripe session:', error);
        sendError(res, 404, 'Sessie niet gevonden.', error.message, req);
    }
});

// === Manual Payment Routes (for admins) ===

// GET all payments for a mosque
router.get('/mosque/:mosqueId', async (req, res) => {
    if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    
    try {
        const { data, error } = await supabase
            .from('payments')
            .select('*, parent:parent_id(name, email), processed_by_user:processed_by(name)')
            .eq('mosque_id', req.params.mosqueId)
            .order('payment_date', { ascending: false });
            
        if (error) throw error;
        
        res.json(data);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen betalingen.', error.message, req);
    }
});

// POST (register) a new manual payment
router.post('/', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    
    try {
        const { mosque_id, parent_id, amount, payment_method, payment_date, description } = req.body;
        
        // Validatie van verplichte velden
        if (!mosque_id || !parent_id || !amount || !payment_method || !payment_date) {
            return sendError(res, 400, "Verplichte velden ontbreken (mosque_id, parent_id, amount, payment_method, payment_date).", null, req);
        }
        
        // Controleer of de admin tot deze moskee behoort
        if (req.user.mosque_id !== mosque_id) {
            return sendError(res, 403, "U kunt alleen betalingen registreren voor uw eigen moskee.", null, req);
        }

        // Valideer dat de parent tot deze moskee behoort
        const { data: parent, error: parentError } = await supabase
            .from('parents')
            .select('id, name')
            .eq('id', parent_id)
            .eq('mosque_id', mosque_id)
            .single();
            
        if (parentError || !parent) {
            return sendError(res, 400, "Ouder niet gevonden of behoort niet tot deze moskee.", null, req);
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

        console.log(`[Manual Payment] Registered payment of €${amount} for parent ${parent.name} by admin ${req.user.name}`);
        
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

// PUT update an existing payment
router.put('/:paymentId', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    
    try {
        const { paymentId } = req.params;
        const { amount, payment_method, payment_date, description } = req.body;
        
        // Controleer of de betaling bestaat en tot de juiste moskee behoort
        const { data: existingPayment, error: fetchError } = await supabase
            .from('payments')
            .select('*, parent:parent_id(name)')
            .eq('id', paymentId)
            .eq('mosque_id', req.user.mosque_id)
            .single();
            
        if (fetchError || !existingPayment) {
            return sendError(res, 404, "Betaling niet gevonden of niet geautoriseerd.", null, req);
        }

        const updateData = {
            ...(amount && { amount: parseFloat(amount) }),
            ...(payment_method && { payment_method }),
            ...(payment_date && { payment_date: new Date(payment_date).toISOString() }),
            ...(description !== undefined && { description }),
            updated_at: new Date().toISOString()
        };

        const { data: updatedPayment, error } = await supabase
            .from('payments')
            .update(updateData)
            .eq('id', paymentId)
            .select(`
                *,
                parent:parent_id(name, email),
                processed_by_user:processed_by(name)
            `)
            .single();
            
        if (error) throw error;

        console.log(`[Manual Payment] Updated payment ${paymentId} for parent ${existingPayment.parent.name}`);
        
        res.json({ 
            success: true, 
            message: `Betaling bijgewerkt voor ${existingPayment.parent.name}.`, 
            payment: updatedPayment 
        });
    } catch (error) {
        console.error('Error updating manual payment:', error);
        sendError(res, 500, 'Fout bij bijwerken betaling.', error.message, req);
    }
});

// DELETE a payment
router.delete('/:paymentId', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    
    try {
        const { paymentId } = req.params;
        
        // Controleer of de betaling bestaat en tot de juiste moskee behoort
        const { data: existingPayment, error: fetchError } = await supabase
            .from('payments')
            .select('*, parent:parent_id(name)')
            .eq('id', paymentId)
            .eq('mosque_id', req.user.mosque_id)
            .single();
            
        if (fetchError || !existingPayment) {
            return sendError(res, 404, "Betaling niet gevonden of niet geautoriseerd.", null, req);
        }

        const { error } = await supabase
            .from('payments')
            .delete()
            .eq('id', paymentId);
            
        if (error) throw error;

        console.log(`[Manual Payment] Deleted payment ${paymentId} for parent ${existingPayment.parent.name}`);
        
        res.json({ 
            success: true, 
            message: `Betaling verwijderd voor ${existingPayment.parent.name}.`
        });
    } catch (error) {
        console.error('Error deleting manual payment:', error);
        sendError(res, 500, 'Fout bij verwijderen betaling.', error.message, req);
    }
});

module.exports = router;