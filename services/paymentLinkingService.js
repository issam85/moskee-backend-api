// services/paymentLinkingService.js - GECORRIGEERDE VERSIE gebaseerd op jouw bestaande code

const { supabase } = require('../config/database');

const linkPendingPaymentAfterRegistration = async ({ 
  mosqueId, 
  adminEmail, 
  trackingId = null,
  sessionId = null 
}) => {
  console.log(`[Payment Linking] Enhanced linking for mosque ${mosqueId}`);
  console.log(`[Payment Linking] Email: ${adminEmail}, Tracking: ${trackingId ? 'present' : 'none'}`);

  try {
    let pendingPayment = null;
    let strategy = 'none';
    
    // ✅ STRATEGY 1: Search by tracking_id (most reliable)
    if (trackingId) {
      console.log(`[Payment Linking] Strategy 1: Searching by tracking_id`);
      
      const { data, error } = await supabase
        .from('pending_payments')
        .select('*')
        .eq('tracking_id', trackingId)
        .in('status', ['pending', 'completed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        pendingPayment = data;
        strategy = 'tracking_id';
        console.log(`✅ [Payment Linking] Found payment via tracking_id: ${data.id}`);
      }
    }
    
    // ✅ STRATEGY 2: Search by session_id
    if (!pendingPayment && sessionId) {
      console.log(`[Payment Linking] Strategy 2: Searching by session_id`);
      
      const { data, error } = await supabase
        .from('pending_payments')
        .select('*')
        .eq('stripe_session_id', sessionId)
        .in('status', ['pending', 'completed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        pendingPayment = data;
        strategy = 'session_id';
        console.log(`✅ [Payment Linking] Found payment via session_id: ${data.id}`);
      }
    }
    
    // ✅ STRATEGY 3: Search by email (extended time window)
    if (!pendingPayment && adminEmail) {
      console.log(`[Payment Linking] Strategy 3: Searching by email`);
      
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      
      const { data: emailPayments, error } = await supabase
        .from('pending_payments')
        .select('*')
        .eq('customer_email', adminEmail.toLowerCase())
        .in('status', ['pending', 'completed'])
        .gte('created_at', twoHoursAgo)
        .order('created_at', { ascending: false });

      if (!error && emailPayments && emailPayments.length > 0) {
        pendingPayment = emailPayments[0];
        strategy = 'email';
        console.log(`⚠️ [Payment Linking] Found payment via email: ${pendingPayment.id}`);
      }
    }

    // ✅ STRATEGY 4: Recent payments without email match (last resort)
    if (!pendingPayment) {
      console.log(`[Payment Linking] Strategy 4: Recent payments check`);
      
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      
      const { data, error } = await supabase
        .from('pending_payments')
        .select('*')
        .in('status', ['pending', 'completed'])
        .gte('created_at', tenMinutesAgo)
        .is('mosque_id', null)
        .order('created_at', { ascending: false })
        .limit(3);

      if (!error && data && data.length === 1) {
        pendingPayment = data[0];
        strategy = 'time_window';
        console.log(`⚠️ [Payment Linking] Using single recent payment: ${pendingPayment.id}`);
      }
    }

    if (!pendingPayment) {
      console.log(`ℹ️ [Payment Linking] No pending payment found`);
      return { 
        success: false, 
        reason: 'no_pending_payments',
        strategy: 'none'
      };
    }

    console.log(`[Payment Linking] Processing payment ${pendingPayment.id} (strategy: ${strategy})`);

    // ✅ GECORRIGEERDE PLAN DETAILS - Professional = Onbeperkt
    let planType = pendingPayment.plan_type || 'professional';
    let maxStudents = null; // null = onbeperkt
    let maxTeachers = null; // null = onbeperkt
    
    if (planType === 'trial' || planType === 'basic') {
      // Alleen trial en basic hebben restricties
      maxStudents = 10;  // Trial beperking
      maxTeachers = 2;   // Trial beperking
    }
    // Professional en Premium = geen restricties (null)

    // ✅ ATOMIC UPDATE TRANSACTION
    try {
      // Update pending payment first
      const { error: paymentUpdateError } = await supabase
        .from('pending_payments')
        .update({
          status: 'linked',
          mosque_id: mosqueId,
          linked_at: new Date().toISOString(),
          linking_strategy: strategy,
          updated_at: new Date().toISOString()
        })
        .eq('id', pendingPayment.id);

      if (paymentUpdateError) {
        throw paymentUpdateError;
      }

      // Update mosque with full payment details
      const { data: updatedMosque, error: mosqueUpdateError } = await supabase
        .from('mosques')
        .update({
          stripe_customer_id: pendingPayment.stripe_customer_id,
          stripe_subscription_id: pendingPayment.stripe_subscription_id,
          subscription_status: 'active', // ✅ IMMEDIATE ACTIVATION
          plan_type: planType,
          max_students: maxStudents, // null = onbeperkt voor Professional
          max_teachers: maxTeachers, // null = onbeperkt voor Professional
          trial_ends_at: null, // ✅ REMOVE TRIAL
          trial_started_at: null, // ✅ CLEAR TRIAL START
          updated_at: new Date().toISOString()
        })
        .eq('id', mosqueId)
        .select()
        .single();

      if (mosqueUpdateError) {
        throw mosqueUpdateError;
      }

      console.log(`✅ [Payment Linking] SUCCESS! Mosque ${mosqueId} upgraded to ${planType}`);
      console.log(`✅ Status: ${updatedMosque.subscription_status}, Students: ${maxStudents || 'Onbeperkt'}`);

      return {
        success: true,
        paymentId: pendingPayment.id,
        stripeCustomerId: pendingPayment.stripe_customer_id,
        subscriptionId: pendingPayment.stripe_subscription_id,
        planType: planType,
        strategy: strategy,
        mosque: updatedMosque
      };

    } catch (updateError) {
      console.error('[Payment Linking] Atomic update failed:', updateError);
      
      // Rollback payment update
      try {
        await supabase
          .from('pending_payments')
          .update({
            status: 'pending',
            mosque_id: null,
            linked_at: null,
            linking_strategy: null
          })
          .eq('id', pendingPayment.id);
      } catch (rollbackError) {
        console.error('[Payment Linking] Rollback failed:', rollbackError);
      }
      
      throw updateError;
    }

  } catch (error) {
    console.error('[Payment Linking] Critical error:', error);
    return { 
      success: false, 
      error: error.message,
      strategy: strategy || 'unknown'
    };
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