// services/emailService.js - FIXED RESEND IMPLEMENTATION
const { Resend } = require('resend');
const { supabase } = require('../config/database');
const axios = require('axios');

// ✅ CRUCIALE FIX: Gebruik je geverifieerde domein
const RESEND_SENDER_NAME = "MijnLVS";
const RESEND_SENDER_EMAIL = `noreply@${process.env.RESEND_DOMAIN || 'mijnlvs.nl'}`;

console.log(`🔧 [EMAIL SERVICE] Configuration:
- RESEND_API_KEY: ${process.env.RESEND_API_KEY ? 'Configured' : 'Missing'}
- RESEND_DOMAIN: ${process.env.RESEND_DOMAIN || 'mijnlvs.nl (default)'}
- SENDER_EMAIL: ${RESEND_SENDER_EMAIL}`);

// Initialize Resend
let resend = null;
if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
    console.log('✅ [EMAIL SERVICE] Resend initialized successfully');
} else {
    console.error('❌ [EMAIL SERVICE] RESEND_API_KEY not found in environment variables');
}

// ✅ HOOFDFUNCTIE: Intelligente email routing
const sendEmail = async (emailDetails) => {
    const { emailType, mosqueId } = emailDetails;
    
    console.log(`📧 [EMAIL ROUTER] Processing email type: ${emailType}`);
    
    // System emails (welkomst, registratie, etc.) → Altijd via Resend
    const systemEmailTypes = [
        'registration_welcome',
        'registration_reminder', 
        'password_reset',
        'trial_ending',
        'payment_failed',
        'payment_success',
        'subscription_cancelled',
        'test_email'
    ];
    
    if (systemEmailTypes.includes(emailType)) {
        console.log(`[EMAIL ROUTER] Using Resend for system email: ${emailType}`);
        return await sendEmailViaResend(emailDetails);
    }
    
    // Moskee-specifieke emails → Probeer M365, fallback naar Resend
    if (mosqueId) {
        console.log(`[EMAIL ROUTER] Attempting M365 for mosque ${mosqueId}, fallback to Resend`);
        
        const m365Result = await sendM365EmailInternal(emailDetails);
        
        if (m365Result.success) {
            console.log(`[EMAIL ROUTER] M365 succeeded for mosque ${mosqueId}`);
            return m365Result;
        } else {
            console.log(`[EMAIL ROUTER] M365 failed (${m365Result.error}), falling back to Resend`);
            return await sendEmailViaResend(emailDetails);
        }
    }
    
    // Default: Resend
    console.log(`[EMAIL ROUTER] Using default Resend for email type: ${emailType}`);
    return await sendEmailViaResend(emailDetails);
};

// ✅ VERBETERDE RESEND EMAIL FUNCTIE - MAIN FIX
const sendEmailViaResend = async (emailDetails) => {
    const { to, subject, body, emailType, fromName = RESEND_SENDER_NAME, replyTo = null } = emailDetails;
    
    console.log(`📧 [RESEND] ================================`);
    console.log(`📧 [RESEND] Starting email send process...`);
    console.log(`📧 [RESEND] To: ${to}`);
    console.log(`📧 [RESEND] Subject: ${subject}`);
    console.log(`📧 [RESEND] EmailType: ${emailType}`);
    console.log(`📧 [RESEND] From Name: ${fromName}`);
    
    if (!resend) {
        console.error('❌ [RESEND] Resend not initialized - check RESEND_API_KEY');
        return { 
            success: false, 
            error: 'Resend service niet geconfigureerd op de server',
            service: 'resend'
        };
    }
    
    try {
        // ✅ CRUCIALE FIX: Gebruik je eigen geverifieerde domein
        const emailPayload = {
            from: `${fromName} <${RESEND_SENDER_EMAIL}>`, // Dit moet je geverifieerde domein zijn!
            to: Array.isArray(to) ? to : [to],
            subject: subject,
            html: body
        };
        
        // Voeg reply-to toe indien aanwezig
        if (replyTo) {
            emailPayload.reply_to = replyTo;
        }
        
        console.log(`📧 [RESEND] Email payload prepared:`);
        console.log(`📧 [RESEND] - From: ${emailPayload.from}`);
        console.log(`📧 [RESEND] - To: ${emailPayload.to}`);
        console.log(`📧 [RESEND] - Reply-To: ${emailPayload.reply_to || 'None'}`);
        
        // ✅ VERBETERDE ERROR HANDLING
        console.log(`📧 [RESEND] Calling Resend API...`);
        const { data, error } = await resend.emails.send(emailPayload);
        
        // Check voor Resend SDK errors
        if (error) {
            console.error(`❌ [RESEND] Resend SDK Error:`, error);
            
            // Specifieke error handling voor domein problemen
            if (error.message && error.message.includes('from')) {
                console.error(`❌ [RESEND] DOMEIN PROBLEEM: Je moet een geverifieerd domein gebruiken!`);
                console.error(`❌ [RESEND] Huidige from: ${emailPayload.from}`);
                console.error(`❌ [RESEND] Controleer je Resend Dashboard → Domains`);
                
                throw new Error(`DOMEIN ERROR: ${error.message}. Controleer je geverifieerde domein in Resend.`);
            }
            
            throw new Error(`Resend SDK Error: ${error.message || JSON.stringify(error)}`);
        }
        
        // Valideer response data
        if (!data || !data.id) {
            console.error(`❌ [RESEND] Invalid response format:`, { data, error });
            throw new Error(`Invalid Resend response: ${JSON.stringify({ data, error })}`);
        }

        console.log(`✅ [RESEND] Email sent successfully!`);
        console.log(`✅ [RESEND] Message ID: ${data.id}`);
        console.log(`📧 [RESEND] ================================`);
        
        // Log naar database
        await logEmailAttempt(
            emailDetails.mosqueId || null, 
            to, 
            subject, 
            body.substring(0, 500), // Kort houden voor logging
            emailType, 
            'sent', 
            null, 
            data.id
        );
        
        return { 
            success: true, 
            messageId: data.id,
            service: 'resend'
        };
        
    } catch (error) {
        console.error('❌ [RESEND] Email failed!');
        console.error('❌ [RESEND] Error type:', typeof error);
        console.error('❌ [RESEND] Error constructor:', error.constructor.name);
        console.error('❌ [RESEND] Error message:', error.message);
        console.error('❌ [RESEND] Full error:', error);
        console.log(`📧 [RESEND] ================================`);
        
        // Log fout naar database
        const errorMessage = error.message || error.toString() || 'Unknown error occurred';
        await logEmailAttempt(
            emailDetails.mosqueId || null, 
            to, 
            subject, 
            body.substring(0, 500),
            emailType, 
            'failed', 
            errorMessage
        );
        
        return { 
            success: false, 
            error: errorMessage,
            service: 'resend',
            debugInfo: {
                errorType: error.constructor.name,
                errorString: error.toString(),
                senderEmail: RESEND_SENDER_EMAIL,
                domainConfigured: process.env.RESEND_DOMAIN
            }
        };
    }
};

// ✅ M365 EMAIL FUNCTIE (bestaand, voor moskee-specifieke emails)
const sendM365EmailInternal = async (emailDetails) => {
    const { to, subject, body, mosqueId, emailType = 'm365_app_email' } = emailDetails;
    console.log(`[M365 EMAIL] Sending ${emailType} to: ${to} for mosqueId: ${mosqueId}`);

    if (!to || !subject || !body || !mosqueId) {
        console.error(`[M365 EMAIL] Missing params: to, subject, body, or mosqueId`);
        return { success: false, error: "M365 e-mail: verplichte parameters ontbreken." };
    }

    let mosqueConfig;
    try {
        const { data, error } = await supabase
            .from('mosques')
            .select('name, m365_tenant_id, m365_client_id, m365_sender_email, m365_client_secret, m365_configured')
            .eq('id', mosqueId)
            .single();
        if (error) throw error;
        if (!data) throw new Error("Moskee niet gevonden in database.");
        mosqueConfig = data;
    } catch (dbError) {
        console.error(`[M365 EMAIL] DB Error fetching mosque ${mosqueId}:`, dbError.message);
        return { success: false, error: `Databasefout: ${dbError.message}` };
    }

    if (!mosqueConfig.m365_configured) {
        console.warn(`[M365 EMAIL] M365 not configured for mosque ${mosqueId}`);
        return { success: false, error: "M365 is niet geconfigureerd voor deze moskee." };
    }
    
    if (!mosqueConfig.m365_tenant_id || !mosqueConfig.m365_client_id || !mosqueConfig.m365_client_secret || !mosqueConfig.m365_sender_email) {
        console.error(`[M365 EMAIL] M365 config incomplete for mosque ${mosqueId}`);
        return { success: false, error: "M365 configuratie onvolledig in DB." };
    }

    const tokenUrl = `https://login.microsoftonline.com/${mosqueConfig.m365_tenant_id}/oauth2/v2.0/token`;
    const tokenParams = new URLSearchParams({
        client_id: mosqueConfig.m365_client_id,
        scope: 'https://graph.microsoft.com/.default',
        client_secret: mosqueConfig.m365_client_secret,
        grant_type: 'client_credentials'
    });

    let accessToken;
    try {
        const tokenResponse = await axios.post(tokenUrl, tokenParams);
        accessToken = tokenResponse.data.access_token;
        if (!accessToken) throw new Error("Access token missing in response.");
    } catch (error) {
        const errorMsg = error.response?.data?.error_description || error.message;
        console.error("[M365 EMAIL] M365 token request failed:", errorMsg, error.response?.data);
        await logEmailAttempt(mosqueId, to, subject, body, `${emailType}_token_fail`, 'failed', `Token Error: ${errorMsg}`);
        return { success: false, error: `M365 token error: ${errorMsg}`, details: error.response?.data };
    }
    
    const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${mosqueConfig.m365_sender_email}/sendMail`;
    const emailPayloadGraph = {
        message: { subject, body: { contentType: 'HTML', content: body }, toRecipients: [{ emailAddress: { address: to } }] },
        saveToSentItems: 'true'
    };

    try {
        const emailApiResponse = await axios.post(sendMailUrl, emailPayloadGraph, { headers: { Authorization: `Bearer ${accessToken}` } });
        const msRequestId = emailApiResponse.headers['request-id'];
        console.log(`[M365 EMAIL] Success. Email sent via Graph API. MS Request ID: ${msRequestId}`);
        await logEmailAttempt(mosqueId, to, subject, body, emailType, 'sent', null, msRequestId);
        return { success: true, messageId: msRequestId };
    } catch (error) {
        const errorMsg = error.response?.data?.error?.message || error.message;
        const msRequestId = error.response?.headers?.['request-id'];
        console.error("[M365 EMAIL] Graph API sendMail failed:", errorMsg, error.response?.data);
        await logEmailAttempt(mosqueId, to, subject, body, `${emailType}_send_fail`, 'failed', `Graph API Error: ${errorMsg}`, msRequestId);
        return { success: false, error: `Graph API sendMail error: ${errorMsg}`, details: error.response?.data };
    }
};

// ✅ EMAIL LOGGING FUNCTIE
const logEmailAttempt = async (mosqueId, to, subject, body, emailType, status, errorDetails, messageId = null) => {
    try {
        await supabase.from('email_logs').insert([{
            mosque_id: mosqueId, // Kan null zijn voor system emails
            recipient_email: to,
            subject: subject,
            body: body.substring(0, 1000), // Truncate voor logging
            email_type: emailType,
            sent_status: status,
            error_message: errorDetails,
            microsoft_message_id: messageId, // Hergebruik veld voor alle message IDs
            sent_at: new Date()
        }]);
        
        console.log(`📝 [EMAIL LOG] Logged ${status} email to ${to} (type: ${emailType})`);
    } catch (logError) {
        console.error("[EMAIL LOG] Failed to log email attempt:", logError.message);
    }
};

// ✅ VERBETERDE TEST EMAIL FUNCTIE
const sendTestEmail = async (testEmailAddress) => {
    console.log(`🧪 [RESEND TEST] Sending test email to ${testEmailAddress}`);
    
    const testEmailData = {
        to: testEmailAddress,
        subject: '🧪 Test Email van MijnLVS - Resend Configuratie',
        body: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #10b981;">✅ Resend Test Succesvol!</h1>
                <p>Deze email werd verstuurd via Resend om de configuratie te testen.</p>
                
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <h3 style="color: #15803d; margin-top: 0;">📋 Configuratie Details:</h3>
                    <ul style="color: #166534;">
                        <li><strong>Resend API Key:</strong> Geconfigureerd ✅</li>
                        <li><strong>Email Service:</strong> Actief ✅</li>
                        <li><strong>Domein:</strong> ${process.env.RESEND_DOMAIN || 'mijnlvs.nl'}</li>
                        <li><strong>Sender Email:</strong> ${RESEND_SENDER_EMAIL}</li>
                        <li><strong>Database Logging:</strong> Werkend ✅</li>
                    </ul>
                </div>
                
                <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <h3 style="color: #d97706; margin-top: 0;">⚠️ Belangrijk:</h3>
                    <p style="color: #92400e; margin: 5px 0;">
                        Zorg ervoor dat het domein <strong>${process.env.RESEND_DOMAIN || 'mijnlvs.nl'}</strong> 
                        is geverifieerd in je Resend Dashboard.
                    </p>
                </div>
                
                <p><strong>Testtijd:</strong> ${new Date().toLocaleString('nl-NL')}</p>
                <p>
                    Met vriendelijke groet,<br>
                    <strong>Het MijnLVS Team</strong>
                </p>
            </div>
        `,
        emailType: 'test_email'
    };
    
    return await sendEmailViaResend(testEmailData);
};

// ✅ BULK EMAIL FUNCTIE (voor later gebruik)
const sendBulkEmails = async (emailList) => {
    if (!resend) {
        console.error('[RESEND BULK] Resend not initialized');
        return { success: false, error: 'Resend service niet geconfigureerd' };
    }

    try {
        const response = await resend.batch.send(emailList);
        
        console.log(`✅ [RESEND BULK] Sent ${emailList.length} emails`);
        return { success: true, data: response.data };
        
    } catch (error) {
        console.error('[RESEND BULK] Bulk email failed:', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = { 
    sendEmail,                    // ✅ Master functie - gebruikt door registratie
    sendEmailViaResend,          // ✅ Direct Resend access
    sendM365EmailInternal,        // ✅ Bestaande M365 functie
    sendBulkEmails,              // ✅ Bulk email functie
    sendTestEmail,               // ✅ Test functie
    logEmailAttempt              // ✅ Logging functie
};