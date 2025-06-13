// routes/paymentRoutes.js - FIXED VERSION
const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');

// ✅ FIX: Add missing import for authenticateUser middleware
const { authenticateUser } = require('../middleware/authMiddleware');

// ✅ FIX: Add missing import for subscription middleware if needed
const { checkSubscriptionLimits } = require('../middleware/subscription');

/**
 * Get all payments for a mosque (admin only)
 * GET /api/payments/mosque/:mosqueId
 */
const getPaymentsForMosque = async (req, res) => {
  try {
    const { mosqueId } = req.params;
    const { startDate, endDate, status, parentId } = req.query;

    // Verify user has access to this mosque
    if (req.user.mosque_id !== mosqueId && req.user.role !== 'admin') {
      return sendError(res, 403, 'Geen toegang tot deze moskee', null, req);
    }

    let query = supabase
      .from('payments')
      .select(`
        *,
        parent:users!payments_parent_id_fkey(id, name, email)
      `)
      .eq('mosque_id', mosqueId)
      .order('payment_date', { ascending: false });

    // Apply filters
    if (startDate) {
      query = query.gte('payment_date', startDate);
    }
    if (endDate) {
      query = query.lte('payment_date', endDate);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (parentId) {
      query = query.eq('parent_id', parentId);
    }

    const { data: payments, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      payments: payments || [],
      count: payments?.length || 0
    });

  } catch (error) {
    console.error('Error fetching payments for mosque:', error);
    sendError(res, 500, 'Fout bij ophalen betalingen', error.message, req);
  }
};

/**
 * Register a manual payment (admin only)
 * POST /api/payments
 */
const createManualPayment = async (req, res) => {
  try {
    const { parent_id, amount, payment_date, period, notes, payment_method } = req.body;

    // Validate required fields
    if (!parent_id || !amount || !payment_date) {
      return sendError(res, 400, 'parent_id, amount en payment_date zijn verplicht', null, req);
    }

    // Verify parent belongs to same mosque
    const { data: parent, error: parentError } = await supabase
      .from('users')
      .select('id, mosque_id, name')
      .eq('id', parent_id)
      .eq('role', 'parent')
      .single();

    if (parentError || !parent) {
      return sendError(res, 404, 'Ouder niet gevonden', parentError?.message, req);
    }

    if (parent.mosque_id !== req.user.mosque_id) {
      return sendError(res, 403, 'Ouder behoort niet tot uw moskee', null, req);
    }

    // Create payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        mosque_id: req.user.mosque_id,
        parent_id: parent_id,
        amount: parseFloat(amount),
        payment_date: payment_date,
        period: period || new Date().toISOString().slice(0, 7), // YYYY-MM format
        status: 'completed',
        payment_method: payment_method || 'manual',
        notes: notes || null,
        created_by: req.user.id
      })
      .select()
      .single();

    if (paymentError) throw paymentError;

    res.status(201).json({
      success: true,
      message: `Betaling van €${amount} succesvol geregistreerd voor ${parent.name}`,
      payment: {
        ...payment,
        parent: {
          id: parent.id,
          name: parent.name
        }
      }
    });

  } catch (error) {
    console.error('Error creating manual payment:', error);
    sendError(res, 500, 'Fout bij registreren betaling', error.message, req);
  }
};

/**
 * Update payment (admin only)
 * PUT /api/payments/:paymentId
 */
const updatePayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { amount, payment_date, period, notes, status } = req.body;

    // Verify payment exists and belongs to mosque
    const { data: existingPayment, error: fetchError } = await supabase
      .from('payments')
      .select('id, mosque_id, parent_id')
      .eq('id', paymentId)
      .single();

    if (fetchError || !existingPayment) {
      return sendError(res, 404, 'Betaling niet gevonden', fetchError?.message, req);
    }

    if (existingPayment.mosque_id !== req.user.mosque_id) {
      return sendError(res, 403, 'Geen toegang tot deze betaling', null, req);
    }

    // Update payment
    const updateData = {};
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (payment_date) updateData.payment_date = payment_date;
    if (period) updateData.period = period;
    if (notes !== undefined) updateData.notes = notes;
    if (status) updateData.status = status;
    updateData.updated_at = new Date().toISOString();

    const { data: updatedPayment, error: updateError } = await supabase
      .from('payments')
      .update(updateData)
      .eq('id', paymentId)
      .select(`
        *,
        parent:users!payments_parent_id_fkey(id, name, email)
      `)
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      message: 'Betaling succesvol bijgewerkt',
      payment: updatedPayment
    });

  } catch (error) {
    console.error('Error updating payment:', error);
    sendError(res, 500, 'Fout bij bijwerken betaling', error.message, req);
  }
};

/**
 * Create Stripe checkout session
 * POST /api/payments/stripe/create-checkout-session
 */
const createStripeCheckoutSession = async (req, res) => {
  try {
    const stripe = require('../config/stripe');
    const { priceId, metadata = {} } = req.body;

    if (!priceId) {
      return sendError(res, 400, 'priceId is verplicht', null, req);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card', 'ideal'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing`,
      metadata: {
        source: 'api',
        ...metadata
      },
    });

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id
    });

  } catch (error) {
    console.error('Error creating Stripe checkout session:', error);
    sendError(res, 500, 'Fout bij aanmaken Stripe sessie', error.message, req);
  }
};

/**
 * Get payment statistics for mosque (admin only)
 * GET /api/payments/mosque/:mosqueId/stats
 */
const getPaymentStats = async (req, res) => {
  try {
    const { mosqueId } = req.params;
    const { year, month } = req.query;

    // Verify access
    if (req.user.mosque_id !== mosqueId && req.user.role !== 'admin') {
      return sendError(res, 403, 'Geen toegang tot deze moskee', null, req);
    }

    let dateFilter = {};
    if (year) {
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      dateFilter = { gte: startDate, lte: endDate };
    }
    if (month && year) {
      const startDate = `${year}-${month.padStart(2, '0')}-01`;
      const endDate = new Date(year, month, 0).toISOString().split('T')[0];
      dateFilter = { gte: startDate, lte: endDate };
    }

    // Get payments for statistics
    let query = supabase
      .from('payments')
      .select('amount, status, payment_date, payment_method')
      .eq('mosque_id', mosqueId);

    if (dateFilter.gte) {
      query = query.gte('payment_date', dateFilter.gte);
    }
    if (dateFilter.lte) {
      query = query.lte('payment_date', dateFilter.lte);
    }

    const { data: payments, error } = await query;

    if (error) throw error;

    // Calculate statistics
    const stats = {
      total_payments: payments.length,
      total_amount: payments.reduce((sum, p) => sum + (p.amount || 0), 0),
      completed_payments: payments.filter(p => p.status === 'completed').length,
      pending_payments: payments.filter(p => p.status === 'pending').length,
      by_method: {},
      by_month: {}
    };

    // Group by payment method
    payments.forEach(payment => {
      const method = payment.payment_method || 'unknown';
      if (!stats.by_method[method]) {
        stats.by_method[method] = { count: 0, amount: 0 };
      }
      stats.by_method[method].count++;
      stats.by_method[method].amount += payment.amount || 0;
    });

    // Group by month
    payments.forEach(payment => {
      const month = payment.payment_date ? payment.payment_date.slice(0, 7) : 'unknown';
      if (!stats.by_month[month]) {
        stats.by_month[month] = { count: 0, amount: 0 };
      }
      stats.by_month[month].count++;
      stats.by_month[month].amount += payment.amount || 0;
    });

    res.json({
      success: true,
      stats,
      period: { year, month }
    });

  } catch (error) {
    console.error('Error fetching payment stats:', error);
    sendError(res, 500, 'Fout bij ophalen betalingsstatistieken', error.message, req);
  }
};

// ✅ All routes now have proper middleware imports
router.get('/api/payments/mosque/:mosqueId', authenticateUser, checkSubscriptionLimits, getPaymentsForMosque);
router.post('/api/payments', authenticateUser, checkSubscriptionLimits, createManualPayment);
router.put('/api/payments/:paymentId', authenticateUser, updatePayment);
router.post('/api/payments/stripe/create-checkout-session', createStripeCheckoutSession);
router.get('/api/payments/mosque/:mosqueId/stats', authenticateUser, getPaymentStats);

module.exports = router;