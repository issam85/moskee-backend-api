// routes/paymentRoutes.js
const router = require('express').Router();
const { supabase } = require('../config/database');
const { stripe } = require('../config/stripe');
const { sendError } = require('../utils/errorHelper');

// === Stripe Routes ===

// POST create a stripe checkout session
router.post('/stripe/create-checkout-session', async (req, res) => {
    if (!req.user) return sendError(res, 401, "Je moet ingelogd zijn om een abonnement te starten.", null, req);
    
    const { priceId } = req.body;
    const { id: userId, email: userEmail, mosque_id: mosqueId } = req.user;

    if (!priceId) return sendError(res, 400, "Prijs-ID ontbreekt.", null, req);

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card', 'ideal'],
            customer_email: userEmail,
            line_items: [{ price: priceId, quantity: 1 }],
            subscription_data: {
                trial_period_days: 14,
                metadata: { 
                    app_user_id: userId,
                    app_mosque_id: mosqueId,
                }
            },
            success_url: `${process.env.FRONTEND_URL}/dashboard?payment_success=true`,
            cancel_url: `${process.env.FRONTEND_URL}/dashboard/instellingen/abonnement?payment_canceled=true`,
        });
        res.json({ url: session.url });
    } catch (error) {
        sendError(res, 500, 'Fout bij aanmaken Stripe checkout sessie.', error.message, req);
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
        const { mosque_id, parent_id, amount, payment_method, payment_date } = req.body;
        if (!mosque_id || !parent_id || !amount || !payment_method || !payment_date) {
            return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
        }
        if (req.user.mosque_id !== mosque_id) {
            return sendError(res, 403, "U kunt alleen betalingen registreren voor uw eigen moskee.", null, req);
        }

        const paymentData = { ...req.body, processed_by: req.user.id };
        const { data: newPayment, error } = await supabase.from('payments').insert(paymentData).select().single();
        if (error) throw error;
        res.status(201).json({ success: true, message: 'Betaling geregistreerd.', payment: newPayment });
    } catch (error) {
        sendError(res, 500, 'Fout bij registreren betaling.', error.message, req);
    }
});

router.put('/api/payments/:paymentId', authenticateUser, updatePayment);
router.delete('/api/payments/:paymentId', authenticateUser, deletePayment);

module.exports = router;