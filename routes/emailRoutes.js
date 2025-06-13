// routes/emailRoutes.js - Extended version
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendM365EmailInternal } = require('../services/emailService');
const { sendError } = require('../utils/errorHelper');
const axios = require('axios');

// POST send a generic email from logged-in user to any recipient
router.post('/send-generic', async (req, res) => {
    const sender = req.user;
    const { recipientEmail, subject, body } = req.body;

    if (!recipientEmail || !subject || !body) {
        return sendError(res, 400, "Ontvanger, onderwerp en bericht zijn verplicht.", null, req);
    }
    
    try {
        const emailBodyHtml = `
            <p>U heeft een bericht ontvangen van <strong>${sender.name}</strong> (${sender.email}) via het MijnLVS portaal.</p>
            <hr><div style="margin: 1rem 0;">${body.replace(/\n/g, '<br>')}</div><hr>
            <p style="font-size: small; color: grey;">U kunt direct op deze e-mail reageren.</p>`;
        
        const emailResult = await sendM365EmailInternal({
            to: recipientEmail,
            subject: subject,
            body: emailBodyHtml,
            mosqueId: sender.mosque_id,
            emailType: `m365_generic_${sender.role}`
        });
        
        if (emailResult.success) {
            res.json({ success: true, message: `Email succesvol verstuurd naar ${recipientEmail}.` });
        } else {
            sendError(res, 500, `Email versturen mislukt: ${emailResult.error}`, emailResult.details, req);
        }
    } catch (error) {
        sendError(res, 500, 'Onverwachte serverfout bij versturen e-mail.', error.message, req);
    }
});

// POST send an email from a teacher to a whole class
router.post('/send-to-class', async (req, res) => {
    if (req.user.role !== 'teacher') return sendError(res, 403, "Alleen leraren mogen deze actie uitvoeren.", null, req);

    const { classId, subject, body } = req.body;
    const sender = req.user;

    if (!classId || !subject || !body) return sendError(res, 400, "Klas ID, onderwerp en bericht zijn verplicht.", null, req);

    try {
        const { data: classInfo, error: classError } = await supabase
            .from('classes').select('id, name, teacher_id').eq('id', classId).single();
        if (classError || !classInfo) return sendError(res, 404, "Klas niet gevonden.", null, req);
        if (classInfo.teacher_id !== sender.id) return sendError(res, 403, "U kunt alleen mailen naar uw eigen klassen.", null, req);

        // Use a Supabase RPC function to get all unique parent emails from a class
        // (This function 'get_parents_of_class' must be created in Supabase)
        const { data: parents, error: parentsError } = await supabase.rpc('get_parents_of_class', { p_class_id: classId });
        if (parentsError) throw parentsError;
        if (!parents || parents.length === 0) return sendError(res, 404, "Geen ouders gevonden voor deze klas.", null, req);

        const emailBodyHtml = `
            <p>Beste ouders/verzorgers van klas ${classInfo.name},</p>
            <p>U heeft een bericht ontvangen van leraar ${sender.name}:</p>
            <div style="border-left: 2px solid #ccc; padding-left: 1rem; margin: 1rem 0;">${body.replace(/\n/g, '<br>')}</div>`;

        const emailPromises = parents.map(parent => 
            sendM365EmailInternal({
                to: parent.email,
                subject: `Bericht voor klas ${classInfo.name}: ${subject}`,
                body: emailBodyHtml,
                mosqueId: sender.mosque_id,
                emailType: 'm365_teacher_to_class_bulk'
            })
        );
        
        // Wait for all emails to be sent
        const results = await Promise.all(emailPromises);
        const successes = results.filter(r => r.success).length;
        const failures = results.length - successes;

        res.json({ success: true, message: `Verstuur-opdracht voltooid. ${successes} email(s) succesvol, ${failures} mislukt.` });

    } catch (error) {
        sendError(res, 500, 'Onverwachte serverfout bij versturen van bulk-email.', error.message, req);
    }
});

// POST send email to a specific parent (NEW - from monster file)
router.post('/send-to-parent', async (req, res) => {
    if (!req.user || req.user.role !== 'teacher') {
        return sendError(res, 403, "Alleen leraren mogen deze actie uitvoeren.", null, req);
    }

    const { recipientUserId, subject, body } = req.body;
    const sender = req.user; // The logged-in teacher

    if (!recipientUserId || !subject || !body) {
        return sendError(res, 400, "Ontvanger, onderwerp en bericht zijn verplicht.", null, req);
    }
    
    try {
        const { data: recipient, error: userError } = await supabase
            .from('users')
            .select('id, email, name, mosque_id')
            .eq('id', recipientUserId)
            .single();
        if (userError || !recipient) return sendError(res, 404, "Ontvanger niet gevonden.", null, req);
        if (recipient.mosque_id !== sender.mosque_id) {
            return sendError(res, 403, "U kunt alleen mailen binnen uw eigen moskee.", null, req);
        }

        const emailBodyHtml = `
            <p>Beste ${recipient.name},</p>
            <p>U heeft een bericht ontvangen van leraar ${sender.name}:</p>
            <div style="border-left: 2px solid #ccc; padding-left: 1rem; margin: 1rem 0;">${body.replace(/\n/g, '<br>')}</div>
            <p>Met vriendelijke groet,<br>Het team van MijnLVS</p>
        `;
        
        const emailResult = await sendM365EmailInternal({ 
            to: recipient.email, 
            subject, 
            body: emailBodyHtml, 
            mosqueId: sender.mosque_id, 
            emailType: 'm365_teacher_to_parent_email' 
        });

        if (emailResult.success) {
            res.json({ success: true, message: `Email succesvol verstuurd naar ${recipient.name}.` });
        } else {
            sendError(res, 500, `Email versturen mislukt: ${emailResult.error}`, emailResult.details, req);
        }
    } catch (error) {
        sendError(res, 500, 'Onverwachte serverfout bij versturen van e-mail.', error.message, req);
    }
});

// POST M365 test email endpoint (NEW - from monster file)
router.post('/test-m365', async (req, res) => {
    console.log("\n-----------------------------------------------------");
    console.log("Backend: /api/email/test-m365 route HIT");
    console.log("Backend: Raw req.body received:", JSON.stringify(req.body, null, 2));

    let {
        to, subject, body, mosqueId,
        tenantId: explicitTenantId, 
        clientId: explicitClientId, 
        clientSecret: clientSecretFromFrontend, 
        senderEmail: explicitSenderForTest,
        mosqueName: mosqueNameFromFrontend, 
    } = req.body;

    if (!to || !subject || !body) {
        console.error("Backend: M365 email (route): To, Subject, and Body zijn verplicht.");
        return sendError(res, 400, 'M365 email (route): To, Subject, and Body zijn verplicht.', null, req);
    }

    if (clientSecretFromFrontend) { // Test scenario with explicit credentials
        console.log("[/api/email/test-m365] Handling as EXPLICIT TEST call (clientSecret provided).");
        try {
            let actualTenantId = explicitTenantId;
            let actualClientId = explicitClientId;
            let senderToUse = explicitSenderForTest;

            if (mosqueId && (!actualTenantId || !actualClientId || !senderToUse)) {
                console.log(`[/api/email/test-m365 TEST] mosqueId ${mosqueId} provided, some explicit M365 params missing. Attempting DB lookup for missing parts.`);
                const { data: mData, error: mError } = await supabase.from('mosques')
                    .select('name, m365_tenant_id, m365_client_id, m365_sender_email, m365_configured')
                    .eq('id', mosqueId).single();
                if (mError || !mData) {
                    console.error(`[/api/email/test-m365 TEST] Mosque ${mosqueId} not found for M365 config when params incomplete.`);
                    return sendError(res, 404, "Mosque not found for M365 config (when explicit params incomplete in test).", null, req);
                }
                if (!mData.m365_configured) {
                    console.warn(`[/api/email/test-m365 TEST] M365 not configured for mosque ${mosqueId} in DB. Proceeding with explicit params if available.`);
                }
                if (!actualTenantId) actualTenantId = mData.m365_tenant_id;
                if (!actualClientId) actualClientId = mData.m365_client_id;
                if (!senderToUse) senderToUse = mData.m365_sender_email;
            }

            if (!actualTenantId || !actualClientId || !clientSecretFromFrontend || !senderToUse) {
                const errorMsgDetails = `TenantID: ${!!actualTenantId}, ClientID: ${!!actualClientId}, ClientSecret (from frontend): ${!!clientSecretFromFrontend}, Sender: ${!!senderToUse}`;
                console.error(`[/api/email/test-m365 TEST] Vereiste expliciete credentials/config ontbreken. ${errorMsgDetails}`);
                return sendError(res, 400, `M365 TEST email: Vereiste expliciete credentials/config ontbreken. ${errorMsgDetails}`, null, req);
            }
            
            console.log(`[/api/email/test-m365 TEST] Final explicit credentials: Tenant=${actualTenantId}, Client=${actualClientId}, Sender=${senderToUse}, SecretProvided: Yes`);

            const tokenUrl = `https://login.microsoftonline.com/${actualTenantId}/oauth2/v2.0/token`;
            const tokenParams = new URLSearchParams();
            tokenParams.append('client_id', actualClientId);
            tokenParams.append('scope', 'https://graph.microsoft.com/.default');
            tokenParams.append('client_secret', clientSecretFromFrontend);
            tokenParams.append('grant_type', 'client_credentials');

            console.log(`[/api/email/test-m365 TEST] Attempting M365 token from ${tokenUrl} for client ${actualClientId}`);
            const tokenResponse = await axios.post(tokenUrl, tokenParams, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            console.log("[/api/email/test-m365 TEST] M365 Token received (status " + tokenResponse.status + ")");
            
            const accessToken = tokenResponse.data.access_token;
            if (!accessToken) {
                console.error("[/api/email/test-m365 TEST] Access token missing in M365 response.");
                return sendError(res, 500, "M365 error (test): Access token missing.", tokenResponse.data, req);
            }

            const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${senderToUse}/sendMail`;
            const emailPayload = {
                message: { subject, body: { contentType: 'HTML', content: body }, toRecipients: [{ emailAddress: { address: to } }] },
                saveToSentItems: 'true'
            };
            console.log(`[/api/email/test-m365 TEST] Sending email via Graph API. From: ${senderToUse}, To: ${to}`);
            const emailApiResponse = await axios.post(sendMailUrl, emailPayload, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
            const msRequestId = emailApiResponse.headers['request-id'];
            console.log(`[/api/email/test-m365 TEST] Email sent via Graph API (status ${emailApiResponse.status}). MS Request ID: ${msRequestId}`);

            if (mosqueId) { 
                try {
                    await supabase.from('email_logs').insert([{
                        mosque_id: mosqueId, recipient_email: to, subject, body: body.substring(0, 1000),
                        email_type: 'm365_test_email_explicit_params', sent_status: 'sent',
                        microsoft_message_id: msRequestId, sent_at: new Date()
                    }]);
                    console.log("[/api/email/test-m365 TEST] Test email logged to 'email_logs'.");
                } catch (logError) { console.error("[/api/email/test-m365 TEST WARN] Failed to log test email:", logError.message); }
            }
            res.json({ success: true, message: 'TEST Email sent successfully via M365 (explicit credentials).', messageId: msRequestId });

        } catch (error) { 
            console.error("Backend: ERROR during EXPLICIT M365 email sending (test scenario)!");
            const errorDetails = error.response?.data || { message: error.message, code: error.code };
            const statusCode = error.response?.status || 500;
            let errMsg = `M365 TEST email error: ${errorDetails.error_description || errorDetails.error?.message || errorDetails.message || 'Failed to send email with explicit params'}`;
            if (error.isAxiosError && error.response?.status === 401 && error.config?.url?.includes('login.microsoftonline.com')) {
                 errMsg = "M365 TEST email token error: Authentication failed. Check Tenant ID, Client ID, or Client Secret.";
            } else if (error.isAxiosError && error.response?.status === 401 && error.config?.url?.includes('graph.microsoft.com')) {
                 errMsg = "M365 TEST email Graph API error: Unauthorized. Token might be invalid or lack permissions.";
            } else if (error.isAxiosError && error.response?.status === 403 && error.config?.url?.includes('graph.microsoft.com')) {
                 errMsg = `M365 TEST email Graph API error: Forbidden. Sender ${explicitSenderForTest} may not have Mail.Send permission or mailbox not found/enabled.`;
            }
            console.error(`Backend Error (Explicit Test): Status ${statusCode}, Message: ${errMsg}`, JSON.stringify(errorDetails, null, 2));
            sendError(res, statusCode, errMsg, errorDetails, req);
        }

    } else if (mosqueId) { // App-initiated email, use internal function that fetches DB credentials
        console.log(`[/api/email/test-m365] Handling as APP-INITIATED email for mosque ${mosqueId}. Using internal function.`);
        const result = await sendM365EmailInternal({ 
            to, 
            subject, 
            body, 
            mosqueId, 
            emailType: 'm365_app_email_from_route'
        });
        if (result.success) {
            res.json({ success: true, message: 'Email sent successfully via internal M365 function.', messageId: result.messageId, service: 'M365 Internal' });
        } else {
            sendError(res, 500, result.error || 'Failed to send email via internal M365 function.', result.details, req);
        }

    } else {
        console.error("[/api/email/test-m365] Insufficient parameters: mosqueId (for app email) or full explicit M365 test parameters (including clientSecret) are required.");
        sendError(res, 400, "MosqueId (for app email) or full explicit M365 test parameters (including clientSecret) are required for this route.", null, req);
    }
    
    console.log("Backend: /api/email/test-m365 route processing FINISHED");
    console.log("-----------------------------------------------------\n");
});

// GET email logs for a mosque (for admins)
router.get('/logs/mosque/:mosqueId', async (req, res) => {
    if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }

    const { mosqueId } = req.params;
    const { limit = 50, offset = 0, email_type } = req.query;

    try {
        let query = supabase
            .from('email_logs')
            .select('*')
            .eq('mosque_id', mosqueId)
            .order('sent_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (email_type) {
            query = query.eq('email_type', email_type);
        }

        const { data: logs, error } = await query;
        if (error) throw error;

        res.json(logs || []);

    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen email logs.', error.message, req);
    }
});

// GET email statistics for a mosque (for admins)
router.get('/stats/mosque/:mosqueId', async (req, res) => {
    if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }

    const { mosqueId } = req.params;

    try {
        // Get email counts by status
        const { data: statusStats, error: statusError } = await supabase
            .from('email_logs')
            .select('sent_status')
            .eq('mosque_id', mosqueId);

        if (statusError) throw statusError;

        const stats = {
            total: statusStats.length,
            sent: statusStats.filter(log => log.sent_status === 'sent').length,
            failed: statusStats.filter(log => log.sent_status === 'failed').length
        };

        // Get recent activity (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: recentLogs, error: recentError } = await supabase
            .from('email_logs')
            .select('sent_at, sent_status')
            .eq('mosque_id', mosqueId)
            .gte('sent_at', thirtyDaysAgo.toISOString());

        if (recentError) throw recentError;

        stats.recent_30_days = {
            total: recentLogs.length,
            sent: recentLogs.filter(log => log.sent_status === 'sent').length,
            failed: recentLogs.filter(log => log.sent_status === 'failed').length
        };

        res.json(stats);

    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen email statistieken.', error.message, req);
    }
});

module.exports = router;