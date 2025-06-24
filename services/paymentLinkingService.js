// services/paymentLinkingService.js
const { supabase } = require('../config/database');

const linkPendingPaymentAfterRegistration = async ({ mosqueId, adminEmail }) => {
  try {
    console.log(`[Payment Linking] Searching for pending payments for ${adminEmail}`);
    
    // Zoek naar pending payments voor dit email (laatste 30 minuten)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    
    const { data: pendingPayments, error } = await supabase
      .from('pending_payments')
      .select('*')
      .eq('customer_email', adminEmail)
      .eq('status', 'pending')
      .gte('created_at', thirtyMinutesAgo)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    if (!pendingPayments || pendingPayments.length === 0) {
      console.log(`[Payment Linking] No pending payments found for ${adminEmail}`);
      return { success: false, reason: 'no_pending_payments' };
    }
    
    // Neem de meest recente payment
    const payment = pendingPayments[0];
    console.log(`[Payment Linking] Found pending payment: ${payment.tracking_id}`);
    
    // Update pending payment met mosque_id
    await supabase
      .from('pending_payments')
      .update({ 
        mosque_id: mosqueId,
        status: 'linked',
        updated_at: new Date().toISOString()
      })
      .eq('id', payment.id);
    
    // Update mosque met Stripe info
    await supabase
      .from('mosques')
      .update({
        stripe_customer_id: payment.stripe_customer_id,
        stripe_subscription_id: payment.stripe_subscription_id,
        subscription_status: 'active', // ✅ ACTIVATE!
        trial_ends_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', mosqueId);
    
    console.log(`✅ [Payment Linking] Successfully linked payment to mosque ${mosqueId}`);
    
    return { 
      success: true, 
      paymentId: payment.id,
      subscriptionId: payment.stripe_subscription_id
    };
    
  } catch (error) {
    console.error('[Payment Linking] Error:', error);
    return { success: false, error: error.message };
  }
};

module.exports = { linkPendingPaymentAfterRegistration };