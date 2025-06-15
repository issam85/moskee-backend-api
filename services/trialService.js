const { supabase } = require('../config/database');

const getTrialStatus = async (mosqueId) => {
    try {
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('trial_started_at, plan_type, max_students, max_teachers, subscription_status, trial_ends_at')
            .eq('id', mosqueId)
            .single();
        
        if (error || !mosque) {
            console.error('[TrialService] Mosque not found:', error);
            return { error: 'Mosque not found' };
        }

        // ✅ FIXED: Auto-initialize trial if needed
        if (!mosque.trial_started_at && mosque.plan_type === 'trial') {
            console.log(`[TrialService] Auto-initializing trial for mosque ${mosqueId}`);
            
            const now = new Date();
            const trialEnd = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000)); // 14 days from now
            
            const { error: updateError } = await supabase
                .from('mosques')
                .update({
                    trial_started_at: now.toISOString(),
                    trial_ends_at: trialEnd.toISOString(),
                    subscription_status: 'trialing'
                })
                .eq('id', mosqueId);
            
            if (updateError) {
                console.error('[TrialService] Failed to initialize trial:', updateError);
            } else {
                console.log(`[TrialService] ✅ Trial initialized: ${now.toISOString()} -> ${trialEnd.toISOString()}`);
                // Update mosque object for calculations
                mosque.trial_started_at = now.toISOString();
                mosque.trial_ends_at = trialEnd.toISOString();
                mosque.subscription_status = 'trialing';
            }
        }

        // ✅ FIXED: Handle different subscription statuses
        if (mosque.subscription_status === 'active' || mosque.plan_type === 'professional') {
            return {
                planType: 'professional',
                daysUsed: 0,
                daysRemaining: 999,
                isExpired: false,
                maxStudents: 999,
                maxTeachers: 999,
                isProfessional: true,
                subscriptionStatus: mosque.subscription_status
            };
        }

        // ✅ FIXED: Better trial calculation
        if (!mosque.trial_started_at) {
            // No trial started yet - this shouldn't happen after auto-init above
            console.warn('[TrialService] No trial_started_at found even after auto-init attempt');
            return {
                planType: 'trial',
                daysUsed: 0,
                daysRemaining: 14,
                isExpired: false,
                maxStudents: mosque.max_students || 10,
                maxTeachers: mosque.max_teachers || 2,
                isProfessional: false,
                subscriptionStatus: mosque.subscription_status
            };
        }

        const trialStarted = new Date(mosque.trial_started_at);
        const now = new Date();
        const daysUsed = Math.floor((now - trialStarted) / (1000 * 60 * 60 * 24));
        const daysRemaining = Math.max(0, 14 - daysUsed);
        
        // ✅ FIXED: More lenient expiration check
        const isExpired = daysRemaining <= 0 && mosque.subscription_status !== 'active';
        
        console.log(`[TrialService] Trial status for mosque ${mosqueId}:`, {
            daysUsed,
            daysRemaining,
            isExpired,
            subscriptionStatus: mosque.subscription_status
        });
        
        return {
            planType: mosque.plan_type || 'trial',
            daysUsed,
            daysRemaining,
            isExpired,
            maxStudents: mosque.max_students || 10,
            maxTeachers: mosque.max_teachers || 2,
            isProfessional: false,
            subscriptionStatus: mosque.subscription_status,
            trialStartedAt: mosque.trial_started_at,
            trialEndsAt: mosque.trial_ends_at
        };
        
    } catch (error) {
        console.error('[TrialService] Error getting trial status:', error);
        return { error: error.message };
    }
};

const checkUsageLimit = async (mosqueId, resourceType) => {
    try {
        const trialStatus = await getTrialStatus(mosqueId);
        
        if (trialStatus.error) {
            console.error('[TrialService] Error in checkUsageLimit:', trialStatus.error);
            return { error: trialStatus.error };
        }
        
        // ✅ FIXED: Professional accounts have no limits
        if (trialStatus.isProfessional || trialStatus.subscriptionStatus === 'active') {
            return { allowed: true, unlimited: true };
        }
        
        // ✅ FIXED: If trial is expired, block creation but allow viewing
        if (trialStatus.isExpired) {
            return {
                allowed: false,
                currentCount: 0,
                maxAllowed: trialStatus.maxStudents,
                message: `Uw 14-dagen proefperiode is verlopen. Upgrade naar Professional voor onbeperkt aantal ${resourceType}.`,
                isTrialExpired: true
            };
        }
        
        let query;
        let maxAllowed;
        
        if (resourceType === 'students') {
            query = supabase
                .from('students')
                .select('id', { count: 'exact' })
                .eq('mosque_id', mosqueId)
                .eq('active', true);
            maxAllowed = trialStatus.maxStudents;
        } else if (resourceType === 'teachers') {
            query = supabase
                .from('users')
                .select('id', { count: 'exact' })
                .eq('mosque_id', mosqueId)
                .eq('role', 'teacher');
            maxAllowed = trialStatus.maxTeachers;
        } else {
            return { error: 'Invalid resource type' };
        }
        
        const { count, error } = await query;
        if (error) {
            console.error('[TrialService] Database error in checkUsageLimit:', error);
            return { error: error.message };
        }
        
        const isAllowed = count < maxAllowed;
        
        console.log(`[TrialService] Usage check for ${resourceType}:`, {
            currentCount: count,
            maxAllowed,
            isAllowed,
            daysRemaining: trialStatus.daysRemaining
        });
        
        return {
            allowed: isAllowed,
            currentCount: count,
            maxAllowed,
            daysRemaining: trialStatus.daysRemaining,
            message: !isAllowed ? 
                `Trial limiet bereikt: maximaal ${maxAllowed} ${resourceType}. Upgrade naar Professional voor onbeperkt aantal.` : 
                null
        };
        
    } catch (error) {
        console.error('[TrialService] Error in checkUsageLimit:', error);
        return { error: error.message };
    }
};

// ✅ NEW: Function to check if mosque access is allowed (more lenient than usage limits)
const checkMosqueAccess = async (mosqueId) => {
    try {
        const trialStatus = await getTrialStatus(mosqueId);
        
        if (trialStatus.error) {
            return { allowed: false, error: trialStatus.error };
        }
        
        // ✅ FIXED: Allow access during trial period, even if close to expiration
        if (trialStatus.isProfessional || 
            trialStatus.subscriptionStatus === 'active' || 
            trialStatus.daysRemaining > 0 ||
            !trialStatus.isExpired) {
            return { 
                allowed: true, 
                trialStatus,
                isProfessional: trialStatus.isProfessional,
                daysRemaining: trialStatus.daysRemaining
            };
        }
        
        // Only block if trial is really expired (more than 1 day past)
        const gracePeriod = trialStatus.daysRemaining >= -1; // 1 day grace period
        
        return {
            allowed: gracePeriod,
            trialStatus,
            message: gracePeriod ? 
                `Uw proefperiode verloopt binnenkort. Upgrade uw account om toegang te behouden.` :
                `Uw proefperiode is verlopen. Upgrade uw account om door te gaan.`,
            isTrialExpired: !gracePeriod
        };
        
    } catch (error) {
        console.error('[TrialService] Error in checkMosqueAccess:', error);
        return { allowed: false, error: error.message };
    }
};

module.exports = { 
    getTrialStatus, 
    checkUsageLimit,
    checkMosqueAccess  // ✅ NEW: More lenient access check
};