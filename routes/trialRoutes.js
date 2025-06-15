// routes/trialRoutes.js - FIXED VERSION
const router = require('express').Router();
const { sendError } = require('../utils/errorHelper');
const { getTrialStatus, checkMosqueAccess } = require('../services/trialService');

// GET trial status for current user's mosque
router.get('/status', async (req, res) => {
    try {
        if (!req.user) {
            return sendError(res, 401, 'Authenticatie vereist', null, req);
        }
        
        if (!req.user.mosque_id) {
            return sendError(res, 400, 'Geen moskee gekoppeld aan gebruiker', null, req);
        }
        
        console.log(`[TrialRoute] Getting trial status for mosque: ${req.user.mosque_id}`);
        
        const status = await getTrialStatus(req.user.mosque_id);
        
        if (status.error) {
            return sendError(res, 500, 'Fout bij ophalen trial status', status.error, req);
        }
        
        console.log(`[TrialRoute] Trial status response:`, {
            planType: status.planType,
            daysRemaining: status.daysRemaining,
            isExpired: status.isExpired,
            isProfessional: status.isProfessional
        });
        
        res.json(status);
        
    } catch (error) {
        console.error('[TrialRoute] Error getting trial status:', error);
        sendError(res, 500, 'Server fout bij trial status', error.message, req);
    }
});

// GET mosque access check (more lenient than trial status)
router.get('/access-check', async (req, res) => {
    try {
        if (!req.user || !req.user.mosque_id) {
            return sendError(res, 401, 'Authenticatie vereist', null, req);
        }
        
        const accessCheck = await checkMosqueAccess(req.user.mosque_id);
        
        if (accessCheck.error) {
            return sendError(res, 500, 'Fout bij access check', accessCheck.error, req);
        }
        
        res.json(accessCheck);
        
    } catch (error) {
        console.error('[TrialRoute] Error in access check:', error);
        sendError(res, 500, 'Server fout bij access check', error.message, req);
    }
});

module.exports = router;