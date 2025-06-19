// services/emailService.js - FINAL RESEND IMPLEMENTATION
const { Resend } = require('resend');
const { supabase } = require('../config/database');
const axios = require('axios');
const RESEND_SENDER_NAME = "MijnLVS";
const RESEND_SENDER_EMAIL = `noreply@${process.env.RESEND_DOMAIN || 'mijnlvs.nl'}`;

// Initialize Resend
let resend = null;
if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
    console.log('✅ [EMAIL SERVICE] Resend initialized');
} else {
    console.warn('⚠️ [EMAIL SERVICE] RESEND_API_KEY not found');
}

// ✅ HOOFDFUNCTIE: Intelligente email routing
const sendEmail = async (emailDetails) => {
    const { emailType, mosqueId } = emailDetails;
    
    // System emails (welkomst, registratie, etc.) → Altijd via Resend
    const systemEmailTypes = [
        'registration_welcome',
        'registration_reminder', 
        'password_reset',
        'trial_ending',
        'payment_failed',
        'payment_success',
        'subscription_cancelled'
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
            return m365Result;
        } else {
            console.log(`[EMAIL ROUTER] M365 failed, falling back to Resend`);
            return await sendEmailViaResend(emailDetails);
        }
    }
    
    // Default: Resend
    return await sendEmailViaResend(emailDetails);
};

// ✅ VERBETERDE RESEND EMAIL FUNCTIE
const sendEmailViaResend = async (emailDetails) => {
    const { to, subject, body, emailType, fromName = 'MijnLVS', replyTo = null } = emailDetails;
    
    console.log(`📧 [RESEND] Starting email send process...`);
    console.log(`📧 [RESEND] To: ${to}`);
    console.log(`📧 [RESEND] Subject: ${subject}`);
    console.log(`📧 [RESEND] EmailType: ${emailType}`);
    
    if (!resend) {
        console.error('[RESEND] Resend not initialized - check RESEND_API_KEY');
        return { 
            success: false, 
            error: 'Resend service niet geconfigureerd',
            service: 'resend'
        };
    }
    
    try {
        console.log(`📧 [RESEND] Sending ${emailType} to: ${to}`);
        
        // ✅ VERBETERD: Gebruik de juiste configuratie in plaats van test-waarden
        const emailPayload = {
            // ✅ BELANGRIJKSTE VERBETERING: Gebruik je eigen domein in plaats van test domein
            from: `${fromName} <${RESEND_SENDER_EMAIL}>`,
            
            to: Array.isArray(to) ? to : [to],
            subject: subject,
            html: body
        };
        
        // Voeg reply-to toe indien aanwezig
        if (replyTo) {
            emailPayload.reply_to = replyTo;
        }
        
        console.log(`📧 [RESEND] Using sender: ${emailPayload.from}`);
        console.log(`📧 [RESEND] Domain configured: ${process.env.RESEND_DOMAIN || 'mijnlvs.nl'}`);
        
        // ✅ VERBETERD: Gebruik de correcte Resend API call
        const { data, error } = await resend.emails.send(emailPayload);
        
        // ✅ VERBETERD: Check voor Resend SDK errors
        if (error) {
            console.error(`❌ [RESEND] Resend SDK Error:`, error);
            throw new Error(`Resend SDK Error: ${error.message || JSON.stringify(error)}`);
        }
        
        // ✅ VERBETERD: Valideer response data
        if (!data || !data.id) {
            console.error(`❌ [RESEND] Invalid response format:`, { data, error });
            throw new Error(`Invalid Resend response format: ${JSON.stringify({ data, error })}`);
        }

        console.log(`✅ [RESEND] Email sent successfully, ID: ${data.id}`);
        
        // Log naar database
        await logEmailAttempt(
            emailDetails.mosqueId || null, 
            to, 
            subject, 
            body, 
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
        console.error('❌ [RESEND] Email failed:');
        console.error('❌ [RESEND] Error type:', typeof error);
        console.error('❌ [RESEND] Error constructor:', error.constructor.name);
        console.error('❌ [RESEND] Error message:', error.message);
        
        // Log fout naar database
        const errorMessage = error.message || error.toString() || 'Unknown error occurred';
        await logEmailAttempt(
            emailDetails.mosqueId || null, 
            to, 
            subject, 
            body, 
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
                errorString: error.toString()
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

// ✅ VERBETERDE TEST EMAIL FUNCTIE
const sendTestEmail = async (testEmailAddress) => {
    console.log(`🧪 [RESEND TEST] Sending test email to ${testEmailAddress}`);
    
    const testEmailData = {
        to: testEmailAddress,
        subject: '🧪 Test Email van MijnLVS',
        body: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #10b981;">Test Email Succesvol!</h1>
                <p>Deze email werd verstuurd via Resend om de configuratie te testen.</p>
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <h3 style="color: #15803d; margin-top: 0;">✅ Configuratie Status:</h3>
                    <ul style="color: #166534;">
                        <li>Resend API Key: Geconfigureerd</li>
                        <li>Email Service: Actief</li>
                        <li>Database Logging: Werkend</li>
                        <li>Domein: ${process.env.RESEND_DOMAIN || 'mijnlvs.nl'}</li>
                    </ul>
                </div>
                <p>Tijd: ${new Date().toLocaleString('nl-NL')}</p>
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

module.exports = { 
    sendEmail,                    // ✅ Master functie
    sendEmailViaResend,          // ✅ Direct Resend access
    sendM365EmailInternal,        // ✅ Bestaande M365 functie
    sendBulkEmails,              // ✅ Bulk email functie
    sendTestEmail,               // ✅ Test functie
    logEmailAttempt              // ✅ Logging functie
};