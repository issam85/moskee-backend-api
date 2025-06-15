// services/trialService.js
const { supabase } = require('../config/database');

const getTrialStatus = async (mosqueId) => {
    const { data: mosque, error } = await supabase
        .from('mosques')
        .select('trial_started_at, plan_type, max_students, max_teachers, subscription_status')
        .eq('id', mosqueId)
        .single();
    
    if (error || !mosque) return { error: 'Mosque not found' };
    
    const trialStarted = new Date(mosque.trial_started_at);
    const now = new Date();
    const daysUsed = Math.floor((now - trialStarted) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, 14 - daysUsed);
    
    return {
        planType: mosque.plan_type,
        daysUsed,
        daysRemaining,
        isExpired: daysRemaining === 0 && mosque.plan_type === 'trial',
        maxStudents: mosque.max_students,
        maxTeachers: mosque.max_teachers,
        isProfessional: mosque.plan_type === 'professional'
    };
};

const checkUsageLimit = async (mosqueId, resourceType) => {
    const trialStatus = await getTrialStatus(mosqueId);
    if (trialStatus.isProfessional) return { allowed: true };
    
    let query;
    let maxAllowed;
    
    if (resourceType === 'students') {
        query = supabase.from('students').select('id', { count: 'exact' }).eq('mosque_id', mosqueId).eq('active', true);
        maxAllowed = trialStatus.maxStudents;
    } else if (resourceType === 'teachers') {
        query = supabase.from('users').select('id', { count: 'exact' }).eq('mosque_id', mosqueId).eq('role', 'teacher');
        maxAllowed = trialStatus.maxTeachers;
    }
    
    const { count, error } = await query;
    if (error) return { error: error.message };
    
    return {
        allowed: count < maxAllowed,
        currentCount: count,
        maxAllowed,
        message: count >= maxAllowed ? `Trial limiet bereikt: maximaal ${maxAllowed} ${resourceType}. Upgrade naar Professional voor onbeperkt aantal.` : null
    };
};

module.exports = { getTrialStatus, checkUsageLimit };