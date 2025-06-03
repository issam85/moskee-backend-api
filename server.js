// server.js - Complete backend met Supabase database integratie
// Versie: 2.2.3 - Welkomstmail bij ouder registratie & interne e-mail functie
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase initialization
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

console.log("🚦 [INIT] Attempting to initialize Supabase client...");
console.log("🚦 [INIT] Using SUPABASE_URL:", supabaseUrl);
console.log("🚦 [INIT] Using SUPABASE_SERVICE_KEY (length):", supabaseKey ? supabaseKey.length : "NOT SET", supabaseKey ? `(starts with: ${supabaseKey.substring(0,10)}...)` : '');

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required.");
  process.exit(1);
}
let supabase;
try {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("✅ [INIT] Supabase client initialized successfully.");
} catch (initError) {
  console.error("❌ FATAL: Supabase client initialization FAILED:", initError.message, initError);
  process.exit(1);
}

async function testSupabaseConnection() {
  console.log("🚦 [DB STARTUP TEST] Attempting a simple query to Supabase...");
  try {
    const { data, error, count } = await supabase.from('mosques').select('id', { count: 'exact' }).limit(1);
    if (error) {
      console.error("❌ [DB STARTUP TEST] Supabase query FAILED. Error object:", JSON.stringify(error, null, 2));
    } else {
      console.log(`✅ [DB STARTUP TEST] Supabase query SUCCEEDED. Found ${count === null ? 'unknown (check RLS/permissions)' : count} mosque(s). Sample data:`, data);
      if ((count === 0 || (data && data.length === 0)) && count !== null) {
          console.warn("⚠️ [DB STARTUP TEST] Query succeeded but no mosques found. Ensure your 'mosques' table has data and service_role has access.");
      }
    }
  } catch (e) {
    console.error("❌ [DB STARTUP TEST] Supabase query FAILED (outer catch):", e.message);
    console.error("Full error object from outer catch:", e);
  }
}
testSupabaseConnection();

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://vercel.app',
    'https://*.vercel.app',
    'https://moskee-systeem-iujmpp594-issams-projects-83c866b9.vercel.app',
    'https://mijnlvs.nl',
    'https://www.mijnlvs.nl',
    'https://al-noor.mijnlvs.nl',
    'https://al-hijra.mijnlvs.nl',
    'https://register.mijnlvs.nl',
  ],
  credentials: true
}));
app.use(express.json());

const sendError = (res, statusCode, message, details = null, req = null) => {
  const pathInfo = req ? `${req.method} ${req.originalUrl}` : '(Unknown path)';
  console.error(`Error ${statusCode} in ${pathInfo}: ${message}`, details || '');
  res.status(statusCode).json({ success: false, error: message, details });
};

app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    version: '2.2.3', // Versie update
    supabase_connection_test_result: 'Attempted at startup, check logs for [DB STARTUP TEST]'
  });
});

// =========================================================================================
// INTERNE E-MAIL FUNCTIE
// =========================================================================================
async function sendM365EmailInternal(emailDetails) {
  const { to, subject, body, mosqueId, emailType = 'm365_app_email' } = emailDetails;
  console.log(`[INTERNAL EMAIL START] Attempting to send ${emailType} to: ${to} for mosqueId: ${mosqueId}. Subject: ${subject.substring(0,50)}...`);

  if (!to || !subject || !body || !mosqueId) {
    console.error(`[INTERNAL EMAIL FAIL] Missing required parameters: to, subject, body, or mosqueId.`);
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
    console.error(`[INTERNAL EMAIL FAIL] DB Error fetching mosque ${mosqueId}:`, dbError.message);
    return { success: false, error: `Databasefout bij ophalen moskeeconfiguratie: ${dbError.message}` };
  }

  if (!mosqueConfig.m365_configured) {
    console.warn(`[INTERNAL EMAIL WARN] M365 is not configured (m365_configured=false) for mosque ${mosqueId} (${mosqueConfig.name}). Email not sent.`);
    return { success: false, error: "M365 is niet geconfigureerd voor deze moskee in de DB." };
  }
  if (!mosqueConfig.m365_tenant_id || !mosqueConfig.m365_client_id || !mosqueConfig.m365_client_secret || !mosqueConfig.m365_sender_email) {
    console.error(`[INTERNAL EMAIL FAIL] M365 configuration incomplete for mosque ${mosqueId} (${mosqueConfig.name}).`);
    return { success: false, error: "M365 configuratie is onvolledig in de DB (tenant, client, secret, of sender ontbreekt)." };
  }

  const actualTenantId = mosqueConfig.m365_tenant_id;
  const actualClientId = mosqueConfig.m365_client_id;
  const actualClientSecret = mosqueConfig.m365_client_secret;
  const senderToUse = mosqueConfig.m365_sender_email;

  console.log(`[INTERNAL EMAIL INFO] Using M365 config for ${mosqueConfig.name}: Sender: ${senderToUse}, Tenant: ${actualTenantId ? 'OK' : 'MISSING'}, ClientID: ${actualClientId ? 'OK' : 'MISSING'}, ClientSecret: ${actualClientSecret ? 'OK (length: ' + actualClientSecret.length + ')' : 'MISSING'}`);

  const tokenUrl = `https://login.microsoftonline.com/${actualTenantId}/oauth2/v2.0/token`;
  const tokenParams = new URLSearchParams();
  tokenParams.append('client_id', actualClientId);
  tokenParams.append('scope', 'https://graph.microsoft.com/.default');
  tokenParams.append('client_secret', actualClientSecret);
  tokenParams.append('grant_type', 'client_credentials');

  let tokenResponseData;
  console.log(`[INTERNAL EMAIL INFO] Requesting M365 token from ${tokenUrl} for client ${actualClientId}`);
  try {
    const response = await axios.post(tokenUrl, tokenParams, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    tokenResponseData = response.data;
    console.log("[INTERNAL EMAIL INFO] M365 Token received successfully.");
  } catch (error) {
    const errorMsg = error.response?.data?.error_description || error.response?.data?.error?.message || error.message;
    console.error("[INTERNAL EMAIL FAIL] M365 token request failed:", errorMsg, error.response?.data);
     try {
        await supabase.from('email_logs').insert([{
          mosque_id: mosqueId, recipient_email: to, subject, body: body.substring(0, 1000),
          email_type: `${emailType}_token_fail`, sent_status: 'failed', error_details: `Token Error: ${errorMsg}`, sent_at: new Date()
        }]);
    } catch (logError) { /* ignore */ }
    return { success: false, error: `M365 token error: ${errorMsg}`, details: error.response?.data };
  }

  const accessToken = tokenResponseData.access_token;
  if (!accessToken) {
    console.error("[INTERNAL EMAIL FAIL] Access token was not found in the M365 token response.");
    return { success: false, error: "M365 error: Access token missing in response" };
  }

  const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${senderToUse}/sendMail`;
  const emailPayloadGraph = {
    message: { subject, body: { contentType: 'HTML', content: body }, toRecipients: [{ emailAddress: { address: to } }] },
    saveToSentItems: 'true'
  };

  console.log(`[INTERNAL EMAIL INFO] Sending email via Graph API. From: ${senderToUse}, To: ${to}`);
  let emailApiResponse;
  try {
    emailApiResponse = await axios.post(sendMailUrl, emailPayloadGraph, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    const msRequestId = emailApiResponse.headers['request-id'];
    console.log(`[INTERNAL EMAIL SUCCESS] Email sent via Graph API. MS Request ID: ${msRequestId}`);

    try {
      await supabase.from('email_logs').insert([{
        mosque_id: mosqueId, recipient_email: to, subject, body: body.substring(0, 1000),
        email_type: emailType, sent_status: 'sent', microsoft_message_id: msRequestId, sent_at: new Date()
      }]);
      console.log("[INTERNAL EMAIL INFO] Email attempt logged to Supabase 'email_logs' table as sent.");
    } catch (logError) {
      console.error("[INTERNAL EMAIL WARN] Failed to log successful email to Supabase 'email_logs':", logError.message);
    }
    return { success: true, messageId: msRequestId };

  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    console.error("[INTERNAL EMAIL FAIL] Graph API sendMail request failed:", errorMsg, error.response?.data);
    try {
        await supabase.from('email_logs').insert([{
          mosque_id: mosqueId, recipient_email: to, subject, body: body.substring(0, 1000),
          email_type: `${emailType}_send_fail`, sent_status: 'failed',
          error_details: `Graph API Error: ${errorMsg}`, sent_at: new Date(),
          microsoft_message_id: error.response?.headers?.['request-id'] 
        }]);
        console.log("[INTERNAL EMAIL INFO] Failed email attempt logged to Supabase 'email_logs' table.");
    } catch (logError) {
        console.error("[INTERNAL EMAIL WARN] Failed to log failed email to Supabase 'email_logs':", logError.message);
    }
    return { success: false, error: `Graph API sendMail error: ${errorMsg}`, details: error.response?.data };
  }
}
// =========================================================================================
// EINDE INTERNE E-MAIL FUNCTIE
// =========================================================================================

// ======================
// AUTHENTICATION ROUTES
// ======================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, subdomain } = req.body;
    if (!email || !password || !subdomain) return sendError(res, 400, 'Email, password, and subdomain are required.', null, req);
    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedEmail = email.toLowerCase().trim();

    const { data: mosque, error: mosqueError } = await supabase.from('mosques').select('id').eq('subdomain', normalizedSubdomain).single();
    if (mosqueError || !mosque) return sendError(res, 404, `Moskee met subdomein '${normalizedSubdomain}' niet gevonden.`, null, req);

    const { data: user, error: userError } = await supabase.from('users').select('*').eq('email', normalizedEmail).eq('mosque_id', mosque.id).single();
    if (userError || !user) return sendError(res, 401, 'Ongeldige combinatie van email/wachtwoord of gebruiker niet gevonden voor deze moskee.', null, req);

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return sendError(res, 401, 'Ongeldige combinatie van email/wachtwoord.', null, req);

    supabase.from('users').update({ last_login: new Date() }).eq('id', user.id).then(({error: updateErr}) => { if(updateErr) console.error("Error updating last_login for user "+user.id+":", updateErr.message)});
    const { password_hash, ...userWithoutPassword } = user;
    res.json({ success: true, user: userWithoutPassword });
  } catch (error) {
    sendError(res, 500, 'Interne serverfout tijdens login.', error.message, req);
  }
});

// ======================
// REGISTRATION ROUTE
// ======================
app.post('/api/mosques/register', async (req, res) => {
  try {
    const { mosqueName, subdomain, adminName, adminEmail, adminPassword, address, city, zipcode, phone, website, email: mosqueContactEmail } = req.body;
    if (!mosqueName || !subdomain || !adminName || !adminEmail || !adminPassword) return sendError(res, 400, 'Verplichte registratievelden ontbreken.', null, req);
    if (adminPassword.length < 8) return sendError(res, 400, 'Admin wachtwoord moet minimaal 8 karakters lang zijn.', null, req);

    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedAdminEmail = adminEmail.toLowerCase().trim();

    const { data: existingSubdomain } = await supabase.from('mosques').select('id').eq('subdomain', normalizedSubdomain).maybeSingle();
    if (existingSubdomain) return sendError(res, 409, 'Dit subdomein is al in gebruik.', null, req);

    // Hier moet je controleren of de adminEmail al bestaat IN COMBINATIE MET de nieuwe mosque_id als die er al zou zijn,
    // maar aangezien de moskee nog niet bestaat, is een globale check op email voor admins ook een optie,
    // of je accepteert dat een admin email hergebruikt kan worden voor verschillende moskeeën.
    // Voor nu: check of de adminEmail al bestaat als user (kan problemen geven als een admin van moskee A zich bij B registreert).
    const { data: existingAdminEmailUser } = await supabase.from('users').select('id').eq('email', normalizedAdminEmail).maybeSingle();
    if (existingAdminEmailUser) return sendError(res, 409, 'Dit emailadres voor de beheerder is al geregistreerd in het systeem.', null, req);


    const { data: newMosque, error: mosqueCreateError } = await supabase.from('mosques').insert([{
        name: mosqueName, subdomain: normalizedSubdomain, address, city, zipcode, phone,
        email: mosqueContactEmail || normalizedAdminEmail, website, m365_configured: false,
        contribution_1_child: 150, contribution_2_children: 300, contribution_3_children: 450,
        contribution_4_children: 450, contribution_5_plus_children: 450,
        m365_sender_email: null,
    }]).select().single();
    if (mosqueCreateError) throw mosqueCreateError;

    const password_hash = await bcrypt.hash(adminPassword, 10);
    const { data: newAdmin, error: adminCreateError } = await supabase.from('users').insert([{ mosque_id: newMosque.id, email: normalizedAdminEmail, password_hash, name: adminName, role: 'admin', is_temporary_password: false }]).select('id, email, name, role').single();
    if (adminCreateError) { 
      await supabase.from('mosques').delete().eq('id', newMosque.id); // Rollback mosque creation
      throw adminCreateError; 
    }
    
    // Stuur welkomstmail naar nieuwe admin van een nieuwe moskee
    // Alleen als M365 voor DEZE moskee al geconfigureerd zou zijn (onwaarschijnlijk, maar voorbereid)
    // Echter, m365_configured wordt false gezet, dus dit zal niet triggeren tenzij je het later update.
    if (newAdmin && newMosque.m365_configured && newMosque.m365_sender_email) { // Extra check op sender_email
        console.log(`[Mosque Register] New admin ${newAdmin.email} for mosque ${newMosque.name}. M365 configured, attempting admin welcome email.`);
        const adminWelcomeSubject = `Welkom als beheerder bij ${newMosque.name}!`;
        const adminWelcomeBody = `
            <h1>Welkom ${adminName},</h1>
            <p>Uw beheerdersaccount voor het leerlingvolgsysteem van ${newMosque.name} is succesvol aangemaakt.</p>
            <p>U kunt inloggen met de volgende gegevens:</p>
            <ul>
                <li><strong>Email:</strong> ${normalizedAdminEmail}</li>
                <li><strong>Wachtwoord:</strong> ${adminPassword} (het wachtwoord dat u zojuist heeft opgegeven)</li>
            </ul>
            <p>Log in via: https://${normalizedSubdomain}.mijnlvs.nl</p>
            <p>Met vriendelijke groet,</p>
            <p>Het MijnLVS Team</p>
        `;
        sendM365EmailInternal({
            to: normalizedAdminEmail,
            subject: adminWelcomeSubject,
            body: adminWelcomeBody,
            mosqueId: newMosque.id,
            emailType: 'm365_admin_mosque_registration_welcome'
        }).then(result => {
            if (result.success) console.log(`[Mosque Register] Admin welcome email to ${normalizedAdminEmail} sent/queued. MsgID: ${result.messageId}`);
            else console.error(`[Mosque Register] Failed to send admin welcome email to ${normalizedAdminEmail}: ${result.error}`, result.details);
        }).catch(err => console.error(`[Mosque Register] Critical error sending admin welcome email:`, err));
    } else if (newAdmin) {
        console.log(`[Mosque Register] New admin ${newAdmin.email} created for ${newMosque.name}. M365 not yet configured (or sender missing), so no welcome email sent automatically.`);
    }

    res.status(201).json({ success: true, message: 'Registratie succesvol!', mosque: newMosque, admin: newAdmin });
  } catch (error) {
    sendError(res, error.code === '23505' ? 409 : (error.status || 400), error.message || 'Fout bij registratie.', error.details || error.hint || error, req);
  }
});

// ======================
// MOSQUE ROUTES
// ======================
app.get('/api/mosque/:subdomain', async (req, res) => {
  try {
    const { subdomain } = req.params;
    const { data: mosque, error } = await supabase
      .from('mosques')
      .select('id, name, subdomain, address, city, zipcode, phone, email, website, m365_tenant_id, m365_client_id, m365_sender_email, m365_configured, contribution_1_child, contribution_2_children, contribution_3_children, contribution_4_children, contribution_5_plus_children, created_at, updated_at')
      .eq('subdomain', subdomain.toLowerCase().trim())
      .single();
    if (error || !mosque) return sendError(res, 404, 'Moskee niet gevonden.', null, req);
    res.json(mosque);
  } catch (error) {
    sendError(res, 500, 'Fout bij ophalen moskee.', error.message, req);
  }
});
app.put('/api/mosques/:mosqueId', async (req, res) => {
    try {
        const { mosqueId } = req.params;
        const { name, address, city, zipcode, phone, email, website } = req.body;
        if (!name) return sendError(res, 400, "Moskeenaam is verplicht.", null, req);
        const updatePayload = { name, address, city, zipcode, phone, email, website, updated_at: new Date() };
        Object.keys(updatePayload).forEach(key => updatePayload[key] === undefined && delete updatePayload[key]);
        const { data, error } = await supabase.from('mosques').update(updatePayload).eq('id', mosqueId).select().single();
        if (error) throw error;
        res.json({ success: true, message: "Moskeegegevens bijgewerkt.", data });
    } catch (error) {
        sendError(res, 500, "Fout bij bijwerken moskeegegevens.", error.message, req);
    }
});
app.put('/api/mosques/:mosqueId/m365-settings', async (req, res) => {
    try {
        const { mosqueId } = req.params;
        const { m365_tenant_id, m365_client_id, m365_client_secret, m365_sender_email, m365_configured } = req.body;
        const updatePayload = {
            m365_tenant_id, m365_client_id, m365_sender_email,
            m365_configured: !!m365_configured, updated_at: new Date()
        };
        if (m365_client_secret && m365_client_secret.trim() !== '') {
            updatePayload.m365_client_secret = m365_client_secret;
            console.log(`[M365 Update] m365_client_secret wordt bijgewerkt voor mosque ${mosqueId}. Length: ${m365_client_secret.length}`);
        }
        const { data, error } = await supabase.from('mosques').update(updatePayload).eq('id', mosqueId)
            .select('id, m365_tenant_id, m365_client_id, m365_sender_email, m365_configured')
            .single();
        if (error) throw error;
        res.json({ success: true, message: "M365 instellingen bijgewerkt.", data });
    } catch (error) {
        sendError(res, 500, "Fout bij bijwerken M365 instellingen.", error.message, req);
    }
});
app.put('/api/mosques/:mosqueId/contribution-settings', async (req, res) => {
    try {
        const { mosqueId } = req.params;
        const { contribution_1_child, contribution_2_children, contribution_3_children, contribution_4_children, contribution_5_plus_children } = req.body;
        const contributions = [contribution_1_child, contribution_2_children, contribution_3_children, contribution_4_children, contribution_5_plus_children];
        for (const amount of contributions) {
            if (amount !== undefined && amount !== null && (isNaN(parseFloat(amount)) || parseFloat(amount) < 0)) return sendError(res, 400, "Alle bijdragebedragen moeten geldige, niet-negatieve getallen zijn.", null, req);
        }
        const updatePayload = {
            contribution_1_child: contribution_1_child !== undefined ? parseFloat(contribution_1_child) : null,
            contribution_2_children: contribution_2_children !== undefined ? parseFloat(contribution_2_children) : null,
            contribution_3_children: contribution_3_children !== undefined ? parseFloat(contribution_3_children) : null,
            contribution_4_children: contribution_4_children !== undefined ? parseFloat(contribution_4_children) : null,
            contribution_5_plus_children: contribution_5_plus_children !== undefined ? parseFloat(contribution_5_plus_children) : null,
            updated_at: new Date()
        };
        const { data, error } = await supabase.from('mosques').update(updatePayload).eq('id', mosqueId)
            .select('id, contribution_1_child, contribution_2_children, contribution_3_children, contribution_4_children, contribution_5_plus_children').single();
        if (error) throw error;
        res.json({ success: true, message: "Instellingen voor bijdrage succesvol opgeslagen.", data });
    } catch (error) {
        sendError(res, 500, "Fout bij opslaan bijdrage-instellingen.", error.message, req);
    }
});
const calculateAmountDueFromStaffel = (childCount, mosqueSettings) => {
    if (!mosqueSettings) {
        console.warn("[WARN] calculateAmountDueFromStaffel: mosqueSettings is undefined or null, using hardcoded fallbacks (150/kind, max 450). Input childCount:", childCount);
        return Math.min(childCount * 150, 450);
    }
    if (childCount <= 0) return 0;
    if (childCount === 1) return parseFloat(mosqueSettings.contribution_1_child ?? 150);
    if (childCount === 2) return parseFloat(mosqueSettings.contribution_2_children ?? 300);
    if (childCount === 3) return parseFloat(mosqueSettings.contribution_3_children ?? 450);
    if (childCount === 4) return parseFloat(mosqueSettings.contribution_4_children ?? 450);
    return parseFloat(mosqueSettings.contribution_5_plus_children ?? 450);
};

// ======================
// GENERIC CRUD HELPER & ENDPOINTS
// ======================
const createCrudEndpoints = (tableName, selectString = '*', singularNameOverride = null) => {
    const singularName = singularNameOverride || tableName.slice(0, -1);
    app.get(`/api/mosques/:mosqueId/${tableName}`, async (req, res) => {
        try {
            const { mosqueId } = req.params;
            let query = supabase.from(tableName).select(selectString).eq('mosque_id', mosqueId);
            if (tableName === 'users' && req.query.role) query = query.eq('role', req.query.role);
            if (tableName === 'classes' || tableName === 'students') query = query.eq('active', true);
            query = query.order('created_at', { ascending: false });
            const { data, error } = await query;
            if (error) throw error;
            res.json(data);
        } catch (error) { sendError(res, 500, `Fout bij ophalen ${tableName}.`, error.message, req); }
    });
    app.get(`/api/${tableName}/:id`, async (req, res) => {
        try {
            const { id } = req.params;
            const { data, error } = await supabase.from(tableName).select(selectString).eq('id', id).single();
            if (error || !data) return sendError(res, 404, `${singularName} niet gevonden.`, null, req);
            res.json(data);
        } catch (error) { sendError(res, 500, `Fout bij ophalen ${singularName}.`, error.message, req); }
    });
    app.put(`/api/${tableName}/:id`, async (req, res) => {
        try {
            const { id } = req.params;
            const updateData = { ...req.body, updated_at: new Date() };
            delete updateData.mosque_id; delete updateData.id; delete updateData.created_at;
            if (tableName === 'users' && updateData.password) {
                updateData.password_hash = await bcrypt.hash(updateData.password, 10);
                delete updateData.password;
                updateData.is_temporary_password = false;
            } else if (tableName === 'users') { delete updateData.password_hash; }
            if (tableName === 'users' && req.body.role === 'parent') { delete updateData.amount_due; }
            const { data, error } = await supabase.from(tableName).update(updateData).eq('id', id).select(selectString).single();
            if (error) throw error;
            res.json({ success: true, message: `${singularName} bijgewerkt.`, [singularName]: data });
        } catch (error) { sendError(res, 500, `Fout bij bijwerken ${singularName}.`, error.message, req); }
    });
    app.delete(`/api/${tableName}/:id`, async (req, res) => {
        try {
            const { id } = req.params;
            if (tableName === 'students') {
                const { data: studentToDelete, error: studentFetchError } = await supabase.from('students').select('parent_id, mosque_id').eq('id', id).single();
                if (studentFetchError || !studentToDelete) return sendError(res, 404, "Leerling niet gevonden.", null, req);
                const { error: deleteError } = await supabase.from(tableName).delete().eq('id', id);
                if (deleteError) throw deleteError;
                if (studentToDelete.parent_id && studentToDelete.mosque_id) {
                    const { data: mosqueSettings } = await supabase.from('mosques').select('contribution_1_child, contribution_2_children, contribution_3_children, contribution_4_children, contribution_5_plus_children').eq('id', studentToDelete.mosque_id).single();
                    const { count: siblingCount } = await supabase.from('students').select('id', { count: 'exact' }).eq('parent_id', studentToDelete.parent_id).eq('active', true);
                    const newAmountDue = calculateAmountDueFromStaffel(siblingCount || 0, mosqueSettings);
                    await supabase.from('users').update({ amount_due: newAmountDue }).eq('id', studentToDelete.parent_id);
                }
            } else {
                 const { error } = await supabase.from(tableName).delete().eq('id', id);
                 if (error) throw error;
            }
            res.status(200).json({ success: true, message: `${singularName} verwijderd.` });
        } catch (error) { sendError(res, 500, `Fout bij verwijderen ${singularName}.`, error.message, req); }
    });
};
createCrudEndpoints('users', 'id, mosque_id, email, name, role, phone, address, city, zipcode, amount_due, created_at, last_login, is_temporary_password');
createCrudEndpoints('classes', '*, teacher:teacher_id(id, name), students(count)');
createCrudEndpoints('students', '*, parent:parent_id(id, name, email, phone, amount_due), class:class_id(id, name, teacher_id, teacher:teacher_id(name))');
createCrudEndpoints('payments', '*, parent:parent_id(id, name, email), student:student_id(id, name), processed_by_user:processed_by(name)');

// ======================
// SPECIFIC POST ROUTES (users is aangepast)
// ======================
app.post('/api/users', async (req, res) => {
  try {
    const { 
        mosque_id, email, name, role, phone, address, city, zipcode, 
        password: plainTextPassword, 
        sendWelcomeEmail = true // Default naar true als het niet wordt meegegeven
    } = req.body;
    
    if (!mosque_id || !email || !name || !role || !plainTextPassword) return sendError(res, 400, "Verplichte velden (mosque_id, email, name, role, password) ontbreken.", null, req);
    if (plainTextPassword.length < 8) return sendError(res, 400, "Wachtwoord moet minimaal 8 karakters lang zijn.", null, req);

    const password_hash = await bcrypt.hash(plainTextPassword, 10);
    const userData = { mosque_id, email: email.toLowerCase().trim(), password_hash, name, role, is_temporary_password: true, phone, address, city, zipcode, amount_due: role === 'parent' ? 0 : null };
    
    const { data: user, error: userCreateError } = await supabase.from('users').insert([userData]).select('id, email, name, role, phone, address, city, zipcode, amount_due, created_at, mosque_id').single();
    
    if (userCreateError) {
      if (userCreateError.code === '23505' && userCreateError.message.includes('users_email_key')) { 
        return sendError(res, 409, `Een gebruiker met e-mailadres ${email} bestaat al in het systeem.`, userCreateError.details, req);
      }
      throw userCreateError;
    }
    
    if (user && user.role === 'parent' && sendWelcomeEmail) {
      console.log(`[POST /api/users] Parent user ${user.email} created. 'sendWelcomeEmail' is true. Attempting to send welcome email.`);
      
      let mosqueNameForEmail = 'uw moskee';
      try {
        const { data: mosqueDataLookup } = await supabase.from('mosques').select('name, m365_configured').eq('id', user.mosque_id).single();
        if (mosqueDataLookup && mosqueDataLookup.name) {
          mosqueNameForEmail = mosqueDataLookup.name;
        }
        if (!mosqueDataLookup || !mosqueDataLookup.m365_configured) {
            console.warn(`[POST /api/users] M365 not configured for mosque ${user.mosque_id} (${mosqueNameForEmail}). Welcome email for ${user.email} will NOT be sent.`);
        } else {
            const emailSubject = `Welkom bij ${mosqueNameForEmail}! Uw account is aangemaakt.`;
            const emailBody = `
                <!DOCTYPE html>
                <html lang="nl">
                <head><meta charset="UTF-8"><title>${emailSubject}</title></head>
                <body>
                    <p>Beste ${user.name},</p>
                    <p>Uw account voor het leerlingvolgsysteem van ${mosqueNameForEmail} is succesvol aangemaakt.</p>
                    <p>U kunt inloggen met de volgende gegevens:</p>
                    <ul>
                        <li><strong>E-mailadres:</strong> ${user.email}</li>
                        <li><strong>Tijdelijk wachtwoord:</strong> ${plainTextPassword}</li>
                    </ul>
                    <p>Wij adviseren u dringend om uw wachtwoord direct na de eerste keer inloggen te wijzigen via uw profielpagina.</p>
                    <p>U kunt inloggen via de website van uw moskee of via <a href="https://mijnlvs.nl">https://mijnlvs.nl</a>.</p>
                    <br>
                    <p>Met vriendelijke groet,</p>
                    <p>Het bestuur van ${mosqueNameForEmail}</p>
                </body>
                </html>
            `;

            sendM365EmailInternal({
                to: user.email,
                subject: emailSubject,
                body: emailBody,
                mosqueId: user.mosque_id,
                emailType: 'm365_parent_welcome_email'
            }).then(emailResult => {
                if (!emailResult.success) {
                  console.error(`[POST /api/users] ASYNC ERROR: Failed to send welcome email to ${user.email}. Error: ${emailResult.error}`, emailResult.details || '');
                } else {
                  console.log(`[POST /api/users] ASYNC SUCCESS: Welcome email to ${user.email} reported as sent/queued. MsgID: ${emailResult.messageId}`);
                }
            }).catch(emailSendingError => {
                console.error(`[POST /api/users] ASYNC CRITICAL ERROR during welcome email sending to ${user.email}:`, emailSendingError.message, emailSendingError.stack);
            });
        }
      } catch (mosqueLookupError) {
          console.error(`[POST /api/users] ASYNC ERROR: Error looking up mosque name for welcome email to ${user.email}:`, mosqueLookupError.message);
      }
    } else if (user && user.role === 'parent' && !sendWelcomeEmail) {
        console.log(`[POST /api/users] Parent user ${user.email} created, but 'sendWelcomeEmail' was false. No email sent.`);
    }
    
    res.status(201).json({ success: true, user });

  } catch (error) { 
    sendError(res, error.status || (error.code === '23505' ? 409 : 500), error.message || 'Fout bij aanmaken gebruiker.', error.details || error.hint || error.toString(), req);
  }
});

app.post('/api/classes', async (req, res) => {
  try {
    const { mosque_id, name, teacher_id, description } = req.body;
    if (!mosque_id || !name || !teacher_id ) return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
    const { data: classData, error } = await supabase.from('classes').insert([{ mosque_id, name, teacher_id, description }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, class: classData });
  } catch (error) { sendError(res, 500, 'Fout bij aanmaken klas.', error.message, req); }
});
app.post('/api/students', async (req, res) => {
  try {
    const { mosque_id, parent_id, class_id, name, date_of_birth, emergency_contact, emergency_phone, notes } = req.body;
    if (!mosque_id || !parent_id || !class_id || !name) return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
    const { data: student, error } = await supabase.from('students').insert([{ mosque_id, parent_id, class_id, name, date_of_birth, emergency_contact, emergency_phone, notes }]).select().single();
    if (error) throw error;
    const { data: mosqueSettings } = await supabase.from('mosques').select('contribution_1_child, contribution_2_children, contribution_3_children, contribution_4_children, contribution_5_plus_children').eq('id', mosque_id).single();
    if (!mosqueSettings) console.warn(`[WARN] Geen staffel instellingen voor moskee ${mosque_id}.`);
    const { count: siblingCount } = await supabase.from('students').select('id', { count: 'exact' }).eq('parent_id', parent_id).eq('active', true);
    const newAmountDue = calculateAmountDueFromStaffel(siblingCount || 0, mosqueSettings);
    await supabase.from('users').update({ amount_due: newAmountDue }).eq('id', parent_id);
    res.status(201).json({ success: true, student });
  } catch (error) { sendError(res, 500, 'Fout bij aanmaken leerling.', error.message, req); }
});
app.post('/api/payments', async (req, res) => {
  try {
    const { mosque_id, parent_id, student_id, amount, payment_method, payment_date, description, notes, processed_by } = req.body;
    if (!mosque_id || !parent_id || !amount || !payment_method || !payment_date) return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
    const { data: payment, error } = await supabase.from('payments').insert([{ mosque_id, parent_id, student_id, amount, payment_method, payment_date, description, notes, processed_by }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, payment });
  } catch (error) { sendError(res, 500, 'Fout bij aanmaken betaling.', error.message, req); }
});

// EMAIL & CONFIG ROUTES (send-email-m365 is aangepast)
// =========================================================================================
app.post('/api/send-email-m365', async (req, res) => {
  console.log("\n-----------------------------------------------------");
  console.log("Backend: /api/send-email-m365 route HIT");
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

  if (clientSecretFromFrontend) {
    console.log("[/api/send-email-m365] Handling as EXPLICIT TEST call (clientSecret provided).");
    try {
        let actualTenantId = explicitTenantId;
        let actualClientId = explicitClientId;
        let senderToUse = explicitSenderForTest;
        let effectiveMosqueName = mosqueNameFromFrontend;

        if (mosqueId && (!actualTenantId || !actualClientId || !senderToUse)) {
            console.log(`[/api/send-email-m365 TEST] mosqueId ${mosqueId} provided, some explicit M365 params missing. Attempting DB lookup for missing parts.`);
            const { data: mData, error: mError } = await supabase.from('mosques')
                .select('name, m365_tenant_id, m365_client_id, m365_sender_email, m365_configured')
                .eq('id', mosqueId).single();
            if (mError || !mData) {
                console.error(`[/api/send-email-m365 TEST] Mosque ${mosqueId} not found for M365 config when params incomplete.`);
                return sendError(res, 404, "Mosque not found for M365 config (when explicit params incomplete in test).", null, req);
            }
            if (!mData.m365_configured) {
                console.warn(`[/api/send-email-m365 TEST] M365 not configured for mosque ${mosqueId} in DB. Proceeding with explicit params if available.`);
            }
            if (!actualTenantId) actualTenantId = mData.m365_tenant_id;
            if (!actualClientId) actualClientId = mData.m365_client_id;
            if (!senderToUse) senderToUse = mData.m365_sender_email;
            if (!effectiveMosqueName && mData.name) effectiveMosqueName = mData.name;
        }

        if (!actualTenantId || !actualClientId || !clientSecretFromFrontend || !senderToUse) {
            const errorMsgDetails = `TenantID: ${!!actualTenantId}, ClientID: ${!!actualClientId}, ClientSecret (from frontend): ${!!clientSecretFromFrontend}, Sender: ${!!senderToUse}`;
            console.error(`[/api/send-email-m365 TEST] Vereiste expliciete credentials/config ontbreken. ${errorMsgDetails}`);
            return sendError(res, 400, `M365 TEST email: Vereiste expliciete credentials/config ontbreken. ${errorMsgDetails}`, null, req);
        }
        
        console.log(`[/api/send-email-m365 TEST] Final explicit credentials: Tenant=${actualTenantId}, Client=${actualClientId}, Sender=${senderToUse}, SecretProvided: Yes`);

        const tokenUrl = `https://login.microsoftonline.com/${actualTenantId}/oauth2/v2.0/token`;
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', actualClientId);
        tokenParams.append('scope', 'https://graph.microsoft.com/.default');
        tokenParams.append('client_secret', clientSecretFromFrontend);
        tokenParams.append('grant_type', 'client_credentials');

        console.log(`[/api/send-email-m365 TEST] Attempting M365 token from ${tokenUrl} for client ${actualClientId}`);
        const tokenResponse = await axios.post(tokenUrl, tokenParams, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        console.log("[/api/send-email-m365 TEST] M365 Token received (status " + tokenResponse.status + ")");
        
        const accessToken = tokenResponse.data.access_token;
        if (!accessToken) {
            console.error("[/api/send-email-m365 TEST] Access token missing in M365 response.");
            return sendError(res, 500, "M365 error (test): Access token missing.", tokenResponse.data, req);
        }

        const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${senderToUse}/sendMail`;
        const emailPayload = {
            message: { subject, body: { contentType: 'HTML', content: body }, toRecipients: [{ emailAddress: { address: to } }] },
            saveToSentItems: 'true'
        };
        console.log(`[/api/send-email-m365 TEST] Sending email via Graph API. From: ${senderToUse}, To: ${to}`);
        const emailApiResponse = await axios.post(sendMailUrl, emailPayload, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
        const msRequestId = emailApiResponse.headers['request-id'];
        console.log(`[/api/send-email-m365 TEST] Email sent via Graph API (status ${emailApiResponse.status}). MS Request ID: ${msRequestId}`);

        if (mosqueId) { 
            try {
                await supabase.from('email_logs').insert([{
                    mosque_id: mosqueId, recipient_email: to, subject, body: body.substring(0, 1000),
                    email_type: 'm365_test_email_explicit_params', sent_status: 'sent',
                    microsoft_message_id: msRequestId, sent_at: new Date()
                }]);
                console.log("[/api/send-email-m365 TEST] Test email logged to 'email_logs'.");
            } catch (logError) { console.error("[/api/send-email-m365 TEST WARN] Failed to log test email:", logError.message); }
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

  } else if (mosqueId) {
    console.log(`[/api/send-email-m365] Handling as APP-INITIATED email for mosque ${mosqueId}. Using internal function.`);
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
    console.error("[/api/send-email-m365] Insufficient parameters: mosqueId (for app email) or full explicit M365 test parameters (including clientSecret) are required.");
    sendError(res, 400, "MosqueId (for app email) or full explicit M365 test parameters (including clientSecret) are required for this route.", null, req);
  }
  
  console.log("Backend: /api/send-email-m365 route processing FINISHED");
  console.log("-----------------------------------------------------\n");
});
// =========================================================================================
// EINDE EMAIL ROUTES
// =========================================================================================

app.get('/api/config-check', (req, res) => {
  res.json({
    hasSupabaseUrl: !!process.env.SUPABASE_URL, hasSupabaseKey: !!process.env.SUPABASE_SERVICE_KEY,
    defaultM365Sender: process.env.M365_SENDER_EMAIL || 'Not Set in Env', nodeEnv: process.env.NODE_ENV || 'development', port: PORT
  });
});

// Catch all undefined routes
app.use('*', (req, res) => {
  sendError(res, 404, 'Route not found.', { path: req.originalUrl, method: req.method, available_routes_summary: [
      'GET /api/health', 'GET /api/config-check', 'POST /api/auth/login', 'POST /api/mosques/register',
      'GET /api/mosque/:subdomain', 'PUT /api/mosques/:mosqueId',
      'PUT /api/mosques/:mosqueId/m365-settings', 'PUT /api/mosques/:mosqueId/contribution-settings',
      'GET /api/mosques/:mosqueId/users', 'GET /api/users/:id', 'POST /api/users', 'PUT /api/users/:id', 'DELETE /api/users/:id',
      'GET /api/mosques/:mosqueId/classes','GET /api/classes/:id', 'POST /api/classes', 'PUT /api/classes/:id', 'DELETE /api/classes/:id',
      'GET /api/mosques/:mosqueId/students','GET /api/students/:id', 'POST /api/students', 'PUT /api/students/:id', 'DELETE /api/students/:id',
      'GET /api/mosques/:mosqueId/payments','GET /api/payments/:id', 'POST /api/payments', 'PUT /api/payments/:id', 'DELETE /api/payments/:id',
      'POST /api/send-email-m365'
  ]}, req);
});

// Global error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Unhandled Server Error:', error.stack || error);
  const message = process.env.NODE_ENV === 'production' && !error.status ? 'Interne serverfout.' : error.message;
  res.status(error.status || 500).json({
    success: false, error: message,
    ...(process.env.NODE_ENV !== 'production' && { details: error.stack })
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Moskee Backend API v2.2.3 (with welcome emails & internal M365 func) running on port ${PORT}`);
  console.log(`🔗 Base URL for API: (Your Railway public URL, e.g., https://project-name.up.railway.app)`);
  console.log(`🗄️ Supabase Project URL: ${supabaseUrl ? supabaseUrl.split('.')[0] + '.supabase.co' : 'Not configured'}`);
  if (process.env.NODE_ENV !== 'production') {
    console.warn("⚠️ Running in development mode. Detailed errors might be exposed.");
  }
});

module.exports = app;