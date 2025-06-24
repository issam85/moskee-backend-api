// services/paymentLinkingService.js - GECORRIGEERDE VERSIE gebaseerd op jouw bestaande code

const { supabase } = require('../config/database');

const linkPendingPaymentAfterRegistration = async ({ 
  mosqueId, 
  adminEmail, 
  trackingId = null,
  sessionId = null 
}) => {
  console.log(`[Payment Linking] Starting enhanced link process for mosque ${mosqueId}`);
  console.log(`[Payment Linking] Parameters:`, {
    adminEmail,
    trackingId: trackingId ? `${trackingId.substring(0, 15)}...` : null,
    sessionId: sessionId ? `${sessionId.substring(0, 15)}...` : null
  });

  try {
    let pendingPayment = null;
    let strategy = 'none';
    
    // ✅ STRATEGIE 1: Zoek op tracking_id (meest betrouwbaar)
    if (trackingId) {
      console.log(`[Payment Linking] Strategy 1: Searching by tracking_id`);
      
      const { data, error } = await supabase
        .from('pending_payments')
        .select('*')
        .eq('tracking_id', trackingId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[Payment Linking] Error in tracking_id search:', error);
        throw error;
      }

      if (data) {
        pendingPayment = data;
        strategy = 'tracking_id';
        console.log(`✅ [Payment Linking] Found payment via tracking_id: ${data.id}`);
      } else {
        console.log(`[Payment Linking] No payment found with tracking_id: ${trackingId}`);
      }
    }
    
    // ✅ STRATEGIE 2: Zoek op Stripe session_id (als backup)
    if (!pendingPayment && sessionId) {
      console.log(`[Payment Linking] Strategy 2: Searching by session_id`);
      
      const { data, error } = await supabase
        .from('pending_payments')
        .select('*')
        .eq('stripe_session_id', sessionId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[Payment Linking] Error in session_id search:', error);
        throw error;
      }

      if (data) {
        pendingPayment = data;
        strategy = 'session_id';
        console.log(`✅ [Payment Linking] Found payment via session_id: ${data.id}`);
      } else {
        console.log(`[Payment Linking] No payment found with session_id: ${sessionId}`);
      }
    }
    
    // ✅ STRATEGIE 3: Zoek op e-mailadres (je bestaande methode als fallback)
    if (!pendingPayment && adminEmail) {
      console.log(`[Payment Linking] Strategy 3: Searching by email (fallback)`);
      
      // Zoek naar pending payments voor dit email (laatste 30 minuten)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      
      const { data: pendingPayments, error } = await supabase
        .from('pending_payments')
        .select('*')
        .eq('customer_email', adminEmail.toLowerCase())
        .eq('status', 'pending')
        .gte('created_at', thirtyMinutesAgo)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Payment Linking] Error in email search:', error);
        throw error;
      }

      if (pendingPayments && pendingPayments.length > 0) {
        // Neem de meest recente payment
        pendingPayment = pendingPayments[0];
        strategy = 'email';
        console.log(`⚠️ [Payment Linking] Found payment via email (less reliable): ${pendingPayment.id}`);
        
        if (pendingPayments.length > 1) {
          console.warn(`[Payment Linking] Multiple payments found for email ${adminEmail}, using most recent`);
        }
      } else {
        console.log(`[Payment Linking] No recent payments found for email: ${adminEmail}`);
      }
    }

    // ✅ STRATEGIE 4: Laatste resort - zoek recente payments binnen tijdsvenster
    if (!pendingPayment) {
      console.log(`[Payment Linking] Strategy 4: Searching recent payments within time window`);
      
      // Zoek payments van de laatste 10 minuten (korter venster voor veiligheid)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      
      const { data, error } = await supabase
        .from('pending_payments')
        .select('*')
        .eq('status', 'pending')
        .gte('created_at', tenMinutesAgo)
        .order('created_at', { ascending: false })
        .limit(3); // Maximaal 3 recente payments bekijken

      if (error) {
        console.error('[Payment Linking] Error in time window search:', error);
        throw error;
      }

      if (data && data.length === 1) {
        // Alleen als er exact 1 recent payment is, kunnen we deze veilig koppelen
        pendingPayment = data[0];
        strategy = 'time_window';
        console.log(`⚠️ [Payment Linking] Found single recent payment (time-based): ${pendingPayment.id}`);
      } else if (data && data.length > 1) {
        console.log(`❌ [Payment Linking] Multiple recent payments found (${data.length}), cannot auto-link safely`);
      } else {
        console.log(`[Payment Linking] No recent payments found in time window`);
      }
    }

    if (!pendingPayment) {
      console.log(`ℹ️ [Payment Linking] No pending payment found - this is normal for free registrations`);
      return { 
        success: false, 
        reason: 'no_pending_payments',
        strategy: 'none'
      };
    }

    // ✅ VALIDEER DAT DE PAYMENT NOG GELDIG IS
    const paymentAge = Date.now() - new Date(pendingPayment.created_at).getTime();
    const maxAge = 60 * 60 * 1000; // 1 uur
    
    if (paymentAge > maxAge) {
      console.warn(`⚠️ [Payment Linking] Payment is too old (${Math.round(paymentAge / 60000)} minutes), skipping`);
      return { 
        success: false, 
        reason: 'payment_expired',
        strategy,
        payment_age_minutes: Math.round(paymentAge / 60000)
      };
    }

    console.log(`[Payment Linking] Processing payment ${pendingPayment.id} with strategy: ${strategy}`);
    console.log(`[Payment Linking] Payment details:`, {
      id: pendingPayment.id,
      customer_id: pendingPayment.stripe_customer_id,
      subscription_id: pendingPayment.stripe_subscription_id,
      plan_type: pendingPayment.plan_type,
      created_at: pendingPayment.created_at
    });

    // ✅ ATOMISCHE UPDATE VAN BEIDE TABELLEN
    try {
      // Update de pending payment status eerst
      const { error: paymentUpdateError } = await supabase
        .from('pending_payments')
        .update({
          status: 'linked', // Change from 'completed' to 'linked' to match your existing code
          mosque_id: mosqueId,
          linked_at: new Date().toISOString(),
          linking_strategy: strategy,
          updated_at: new Date().toISOString()
        })
        .eq('id', pendingPayment.id);

      if (paymentUpdateError) {
        console.error('[Payment Linking] Failed to update payment status:', paymentUpdateError);
        throw paymentUpdateError;
      }

      // Update de mosque met payment informatie
      const maxStudents = pendingPayment.plan_type === 'premium' ? 500 : 
                          pendingPayment.plan_type === 'professional' ? 100 : 50;
      const maxTeachers = pendingPayment.plan_type === 'premium' ? 20 : 
                         pendingPayment.plan_type === 'professional' ? 10 : 5;

      const { data: updatedMosque, error: mosqueUpdateError } = await supabase
        .from('mosques')
        .update({
          stripe_customer_id: pendingPayment.stripe_customer_id,
          stripe_subscription_id: pendingPayment.stripe_subscription_id,
          subscription_status: 'active', // ✅ ACTIVATE!
          plan_type: pendingPayment.plan_type || 'professional',
          trial_ends_at: null, // Remove trial
          max_students: maxStudents,
          max_teachers: maxTeachers,
          updated_at: new Date().toISOString()
        })
        .eq('id', mosqueId)
        .select()
        .single();

      if (mosqueUpdateError) {
        console.error('[Payment Linking] Failed to update mosque:', mosqueUpdateError);
        throw mosqueUpdateError;
      }

      console.log(`✅ [Payment Linking] Successfully linked payment ${pendingPayment.id} to mosque ${mosqueId}`);
      console.log(`✅ [Payment Linking] Strategy used: ${strategy}`);
      console.log(`✅ [Payment Linking] Plan: ${pendingPayment.plan_type}, Customer: ${pendingPayment.stripe_customer_id}`);

      return {
        success: true,
        paymentId: pendingPayment.id,
        stripeCustomerId: pendingPayment.stripe_customer_id,
        subscriptionId: pendingPayment.stripe_subscription_id,
        planType: pendingPayment.plan_type,
        strategy,
        mosque: updatedMosque
      };

    } catch (updateError) {
      console.error('[Payment Linking] Error during atomic update:', updateError);
      
      // Probeer rollback van payment update
      try {
        await supabase
          .from('pending_payments')
          .update({
            status: 'pending',
            mosque_id: null,
            linked_at: null,
            linking_strategy: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', pendingPayment.id);
        console.log('[Payment Linking] Rolled back payment update');
      } catch (rollbackError) {
        console.error('[Payment Linking] Failed to rollback payment update:', rollbackError);
      }
      
      throw updateError;
    }

  } catch (error) {
    console.error('[Payment Linking] Critical error during linking:', error);
    
    // Extra logging voor debugging
    console.error('[Payment Linking] Error details:', {
      message: error.message,
      code: error.code,
      details: error.details
    });

    return { success: false, error: error.message };
  }
};

// ✅ CLEANUP FUNCTIES (optioneel, voor onderhoud)
const cleanupDuplicatePayments = async () => {
  try {
    console.log('[Payment Cleanup] Starting duplicate payment cleanup...');
    
    const { data: payments, error } = await supabase
      .from('pending_payments')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const customerGroups = {};
    payments.forEach(payment => {
      const key = payment.stripe_customer_id;
      if (!customerGroups[key]) {
        customerGroups[key] = [];
      }
      customerGroups[key].push(payment);
    });

    let cleanedCount = 0;
    for (const [customerId, customerPayments] of Object.entries(customerGroups)) {
      if (customerPayments.length > 1) {
        // Behoud de nieuwste, markeer de rest als 'superseded'
        const newest = customerPayments[0];
        const toClean = customerPayments.slice(1);
        
        for (const oldPayment of toClean) {
          await supabase
            .from('pending_payments')
            .update({ 
              status: 'superseded',
              superseded_at: new Date().toISOString(),
              superseded_by: newest.id
            })
            .eq('id', oldPayment.id);
          
          cleanedCount++;
        }
      }
    }

    console.log(`[Payment Cleanup] Cleaned up ${cleanedCount} duplicate payments`);
    return { cleanedCount };

  } catch (error) {
    console.error('[Payment Cleanup] Error during cleanup:', error);
    throw error;
  }
};

const cleanupOrphanedPayments = async () => {
  try {
    console.log('[Payment Cleanup] Starting orphaned payment cleanup...');
    
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: orphanedPayments, error } = await supabase
      .from('pending_payments')
      .select('id')
      .eq('status', 'pending')
      .lt('created_at', oneDayAgo);

    if (error) throw error;

    if (orphanedPayments.length > 0) {
      const { error: updateError } = await supabase
        .from('pending_payments')
        .update({ 
          status: 'expired',
          expired_at: new Date().toISOString()
        })
        .in('id', orphanedPayments.map(p => p.id));

      if (updateError) throw updateError;
      
      console.log(`[Payment Cleanup] Marked ${orphanedPayments.length} payments as expired`);
    }

    return { expiredCount: orphanedPayments.length };

  } catch (error) {
    console.error('[Payment Cleanup] Error during orphaned cleanup:', error);
    throw error;
  }
};

module.exports = { 
  linkPendingPaymentAfterRegistration,
  cleanupDuplicatePayments,
  cleanupOrphanedPayments
};