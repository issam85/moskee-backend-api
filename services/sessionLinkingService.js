const { supabase } = require('../config/database');

const executeSessionBasedLinking = async (mosqueId, pendingPayment, sessionId) => {
    console.log(`[Session Linking] Executing atomic link for mosque ${mosqueId}`);
    
    // Bepaal plan type
    let planType = 'professional';
    if (pendingPayment.metadata?.plan_type) {
        planType = pendingPayment.metadata.plan_type;
    } else if (pendingPayment.amount >= 49) {
        planType = 'premium';
    }
    
    // Set limits (alleen trial/basic hebben restricties)
    const maxStudents = ['trial', 'basic'].includes(planType) ? 10 : null;
    const maxTeachers = ['trial', 'basic'].includes(planType) ? 2 : null;
    
    try {
        // ✅ ATOMISCHE TRANSACTIE
        // Stap 1: Update payment
        const { error: paymentError } = await supabase
            .from('pending_payments')
            .update({
                status: 'linked',
                mosque_id: mosqueId,
                linked_at: new Date().toISOString(),
                linking_method: 'session_id',
                session_id_used: sessionId,
                updated_at: new Date().toISOString()
            })
            .eq('id', pendingPayment.id);
        
        if (paymentError) throw paymentError;
        
        // Stap 2: Update mosque
        const { data: updatedMosque, error: mosqueError } = await supabase
            .from('mosques')
            .update({
                stripe_customer_id: pendingPayment.stripe_customer_id,
                stripe_subscription_id: pendingPayment.stripe_subscription_id,
                subscription_status: 'active',
                plan_type: planType,
                max_students: maxStudents,
                max_teachers: maxTeachers,
                trial_ends_at: null,
                trial_started_at: null,
                payment_linked_at: new Date().toISOString(),
                linked_session_id: sessionId,
                updated_at: new Date().toISOString()
            })
            .eq('id', mosqueId)
            .select()
            .single();
        
        if (mosqueError) throw mosqueError;
        
        console.log(`✅ [Session Linking] SUCCESS: Mosque ${mosqueId} → ${planType} via session ${sessionId}`);
        
        return {
            mosque: updatedMosque,
            planType: planType,
            maxStudents: maxStudents,
            maxTeachers: maxTeachers
        };
        
    } catch (error) {
        console.error('[Session Linking] Atomic transaction failed:', error);
        throw error;
    }
};

const findPaymentBySession = async (sessionId) => {
    const { data, error } = await supabase
        .from('pending_payments')
        .select('*')
        .eq('stripe_session_id', sessionId)
        .in('status', ['pending', 'completed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    
    if (error) {
        console.error('[Session Lookup] Error:', error);
        return null;
    }
    
    return data;
};

const queueSessionRetry = async (mosqueId, sessionId, trackingId, adminEmail) => {
    try {
        await supabase.from('session_retry_queue').insert({
            mosque_id: mosqueId,
            session_id: sessionId,
            tracking_id: trackingId,
            admin_email: adminEmail,
            retry_count: 0,
            next_retry_at: new Date(Date.now() + 300000).toISOString(),
            created_at: new Date().toISOString()
        });
        
        console.log(`[Session Retry] Queued retry for mosque ${mosqueId}, session ${sessionId}`);
    } catch (error) {
        console.error('[Session Retry] Queue error:', error);
    }
};

module.exports = { 
    executeSessionBasedLinking,
    findPaymentBySession,
    queueSessionRetry
};