// services/emailService.js
const axios = require('axios');
const { supabase } = require('../config/database');

async function sendM365EmailInternal(emailDetails) {
  const { to, subject, body, mosqueId, emailType = 'm365_app_email' } = emailDetails;
  console.log(`[EMAIL SERVICE] Sending ${emailType} to: ${to} for mosqueId: ${mosqueId}.`);

  if (!to || !subject || !body || !mosqueId) {
    console.error(`[EMAIL SERVICE] Fail: Missing params: to, subject, body, or mosqueId.`);
    return { success: false, error: "Interne e-mail: verplichte parameters ontbreken." };
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
    console.error(`[EMAIL SERVICE] DB Error fetching mosque ${mosqueId}:`, dbError.message);
    return { success: false, error: `Databasefout: ${dbError.message}` };
  }

  if (!mosqueConfig.m365_configured) {
    console.warn(`[EMAIL SERVICE] M365 not configured for mosque ${mosqueId}. Email not sent.`);
    return { success: false, error: "M365 is niet geconfigureerd voor deze moskee." };
  }
  if (!mosqueConfig.m365_tenant_id || !mosqueConfig.m365_client_id || !mosqueConfig.m365_client_secret || !mosqueConfig.m365_sender_email) {
    console.error(`[EMAIL SERVICE] M365 config incomplete for mosque ${mosqueId}.`);
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
    console.error("[EMAIL SERVICE] M365 token request failed:", errorMsg, error.response?.data);
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
    console.log(`[EMAIL SERVICE] Success. Email sent via Graph API. MS Request ID: ${msRequestId}`);
    await logEmailAttempt(mosqueId, to, subject, body, emailType, 'sent', null, msRequestId);
    return { success: true, messageId: msRequestId };
  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    const msRequestId = error.response?.headers?.['request-id'];
    console.error("[EMAIL SERVICE] Graph API sendMail failed:", errorMsg, error.response?.data);
    await logEmailAttempt(mosqueId, to, subject, body, `${emailType}_send_fail`, 'failed', `Graph API Error: ${errorMsg}`, msRequestId);
    return { success: false, error: `Graph API sendMail error: ${errorMsg}`, details: error.response?.data };
  }
}

async function logEmailAttempt(mosqueId, to, subject, body, emailType, status, errorDetails, messageId = null) {
  try {
    await supabase.from('email_logs').insert([{
      mosque_id: mosqueId,
      recipient_email: to,
      subject: subject,
      body: body.substring(0, 1000), // Truncate body for logging
      email_type: emailType,
      sent_status: status,
      error_details: errorDetails,
      microsoft_message_id: messageId,
      sent_at: new Date()
    }]);
  } catch (logError) {
    console.error("[EMAIL SERVICE] CRITICAL: Failed to log email attempt to Supabase 'email_logs':", logError.message);
  }
}

module.exports = { sendM365EmailInternal };