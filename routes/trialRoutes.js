const router = require('express').Router();
const { getTrialStatus } = require('../services/trialService');

router.get('/status', async (req, res) => {
    if (!req.user) return sendError(res, 401, 'Not authenticated', null, req);
    
    const status = await getTrialStatus(req.user.mosque_id);
    res.json(status);
});

module.exports = router;