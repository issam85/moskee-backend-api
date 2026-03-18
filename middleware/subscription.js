// middleware/subscription.js
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');

const checkSubscription = async (req, res, next) => {
    // Sla check over voor publieke routes (dit is een extra vangnet)
    const publicPaths = ['/api/auth/login', '/api/mosques/register', '/api/stripe-webhook'];
    if (publicPaths.some(path => req.path.startsWith(path))) {
        return next();
    }
    
    // SECURITY FIX (H8): Block unauthenticated requests instead of failing open
    if (!req.user) {
        return sendError(res, 401, 'Authenticatie vereist voor toegang tot deze resource.', null, req);
    }

    try {
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('subscription_status, trial_ends_at')
            .eq('id', req.user.mosque_id)
            .single();

        if (error || !mosque) {
            console.warn(`[Subscription Check] Kon moskee ${req.user.mosque_id} niet vinden voor user ${req.user.id}.`);
            // SECURITY FIX (H8): Block on DB error instead of failing open
            return sendError(res, 403, 'Kan abonnementsstatus niet verifiëren. Probeer het later opnieuw.', null, req);
        }

        // Check 1: Proefperiode verlopen
        if (mosque.subscription_status === 'trialing' && new Date(mosque.trial_ends_at) < new Date()) {
            return sendError(res, 403, "Uw proefperiode is verlopen. Upgrade uw account om door te gaan.", { code: 'TRIAL_EXPIRED' }, req);
        }

        // Check 2: Limieten voor 'Basis' of 'Proef' pakket
        if (mosque.subscription_status === 'trialing' || mosque.subscription_status === 'free') {
            // Check voor toevoegen van nieuwe leerling
            if (req.method === 'POST' && req.path.startsWith('/api/students')) {
                const { count } = await supabase.from('students').select('id', { count: 'exact' }).eq('mosque_id', req.user.mosque_id);
                
                if (count !== null && count >= 10) { // Limiet van 10
                    return sendError(res, 403, "Limiet van 10 leerlingen bereikt voor uw proefperiode. Upgrade uw account om meer leerlingen toe te voegen.", { code: 'LIMIT_REACHED' }, req);
                }
            }
        }
        
        // Alles OK, ga door.
        return next();

    } catch (error) {
        console.error("[Subscription Middleware Error]", error);
        // SECURITY FIX (H8): Block on unexpected error instead of failing open
        return sendError(res, 403, 'Fout bij controleren abonnementsstatus.', null, req);
    }
};

module.exports = checkSubscription;