// server.js - Complete backend met Supabase database integratie
// Versie: 2.2.6 - Les & Absentie Management
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


// TIJDELIJKE AUTH MIDDLEWARE (voor ontwikkeling)
// VERVANG DIT MET JE ECHTE AUTHENTICATIE (bijv. Supabase Auth)
// Deze middleware simuleert req.user. In productie heb je een veilige,
// token-gebaseerde authenticatie nodig.
app.use(async (req, res, next) => {
    // Haal een test user ID of token uit een header als je dat wilt voor testen,
    // bijv. 'Authorization: Bearer <USER_ID_OF_TOKEN>'
    const authHeader = req.headers.authorization;
    let userIdToSimulate;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        userIdToSimulate = authHeader.split(' ')[1];
    }
    
    // Simuleer een gebruiker als er een ID is, of een default voor testen.
    // Dit is ZEER ONVEILIG en alleen voor lokaal testen.
    if (process.env.NODE_ENV === 'development' && !req.user) { // !req.user om te voorkomen dat het overschreven wordt als al gezet
        if (userIdToSimulate) {
            const { data: simulatedUser } = await supabase
                .from('users')
                .select('*')
                .eq('id', userIdToSimulate)
                .single();
            if (simulatedUser) {
                req.user = simulatedUser;
                console.log(`[DEV AUTH SIMULATED] User: ${req.user.name} (Role: ${req.user.role}, Mosque: ${req.user.mosque_id}) for path ${req.path}`);
            } else {
                console.warn(`[DEV AUTH] Could not find user to simulate with ID: ${userIdToSimulate}`);
            }
        } else if (req.path.includes('/teacher/') || req.path.includes('/lessons') || req.path.includes('/absenties')) {
            // Fallback voor leraar-specifieke routes als er geen ID is meegegeven.
            // VERVANG 'ECHTE_LERAAR_UUID' en 'ECHTE_MOSKEE_UUID_VAN_LERAAR' met testdata uit je DB.
            // req.user = { id: 'ECHTE_LERAAR_UUID', role: 'teacher', mosque_id: 'ECHTE_MOSKEE_UUID_VAN_LERAAR', name: 'Dev Test Leraar' };
            // console.warn(`[DEV AUTH FALLBACK] Using default Teacher for path ${req.path}. User: ${req.user?.name || 'NOT SET'}`);
        } else if (req.path.includes('/admin/')) {
            // Fallback voor admin routes
            // req.user = { id: 'ECHTE_ADMIN_UUID', role: 'admin', mosque_id: 'ECHTE_MOSKEE_UUID_VAN_ADMIN', name: 'Dev Test Admin' };
            // console.warn(`[DEV AUTH FALLBACK] Using default Admin for path ${req.path}. User: ${req.user?.name || 'NOT SET'}`);
        }
    }
    next();
});
// EINDE TIJDELIJKE AUTH MIDDLEWARE


const sendError = (res, statusCode, message, details = null, req = null) => {
  const pathInfo = req ? `${req.method} ${req.originalUrl}` : '(Unknown path)';
  console.error(`Error ${statusCode} in ${pathInfo}: ${message}`, details || '');
  res.status(statusCode).json({ success: false, error: message, details });
};

app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    version: '2.2.6', // Versie update: Les & Absentie Management
    supabase_connection_test_result: 'Attempted at startup, check logs for [DB STARTUP TEST]'
  });
});

// =========================================================================================
// INTERNE E-MAIL FUNCTIE (JOUW CODE)
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
// EINDE INTERNE E-MAIL FUNCTIE (JOUW CODE)
// =========================================================================================

// ======================
// AUTHENTICATION ROUTES (JOUW CODE)
// ======================
app.post('/api/auth/login', async (req, res) => {
  // JOUW BESTAANDE LOGIN LOGICA HIER (ongewijzigd)
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
// REGISTRATION ROUTE (JOUW CODE)
// ======================
app.post('/api/mosques/register', async (req, res) => {
  // JOUW BESTAANDE REGISTRATIE LOGICA HIER (ongewijzigd)
  try {
    const { mosqueName, subdomain, adminName, adminEmail, adminPassword, address, city, zipcode, phone, website, email: mosqueContactEmail } = req.body;
    if (!mosqueName || !subdomain || !adminName || !adminEmail || !adminPassword) return sendError(res, 400, 'Verplichte registratievelden ontbreken.', null, req);
    if (adminPassword.length < 8) return sendError(res, 400, 'Admin wachtwoord moet minimaal 8 karakters lang zijn.', null, req);

    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedAdminEmail = adminEmail.toLowerCase().trim();

    const { data: existingSubdomain } = await supabase.from('mosques').select('id').eq('subdomain', normalizedSubdomain).maybeSingle();
    if (existingSubdomain) return sendError(res, 409, 'Dit subdomein is al in gebruik.', null, req);

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
      await supabase.from('mosques').delete().eq('id', newMosque.id); 
      throw adminCreateError; 
    }
    
    if (newAdmin && newMosque.m365_configured && newMosque.m365_sender_email) { 
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
// MOSQUE ROUTES (JOUW CODE)
// ======================
app.get('/api/mosque/:subdomain', async (req, res) => {
    // JOUW CODE
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
    // JOUW CODE
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
    // JOUW CODE
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
    // JOUW CODE
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
    // JOUW CODE
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
// GENERIC CRUD HELPER & ENDPOINTS (JOUW CODE)
// ======================
const createCrudEndpoints = (tableName, selectString = '*', singularNameOverride = null) => {
    // JOUW CODE
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
// SPECIFIC POST ROUTES (JOUW CODE)
// ======================
app.post('/api/users', async (req, res) => {
  // JOUW CODE
  try {
    const { 
        mosque_id, email, name, role, phone, address, city, zipcode, 
        password: plainTextPassword, 
        sendWelcomeEmail = true 
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
      let mosqueSubdomain = ''; 
      
      try {
        const { data: mosqueDataLookup } = await supabase
            .from('mosques')
            .select('name, subdomain, m365_configured') 
            .eq('id', user.mosque_id)
            .single();
            
        if (mosqueDataLookup) {
          if (mosqueDataLookup.name) mosqueNameForEmail = mosqueDataLookup.name;
          if (mosqueDataLookup.subdomain) mosqueSubdomain = mosqueDataLookup.subdomain;
        }

        if (!mosqueDataLookup || !mosqueDataLookup.m365_configured) {
            console.warn(`[POST /api/users] M365 not configured for mosque ${user.mosque_id} (${mosqueNameForEmail}). Welcome email for ${user.email} will NOT be sent.`);
        } else {
            const emailSubject = `Welkom bij ${mosqueNameForEmail}! Uw account is aangemaakt.`;
            let loginLink = `https://mijnlvs.nl`; // Default generic link
            let emailTypeForLog = 'm365_parent_welcome_email_generic_link';

            if (mosqueSubdomain) {
                loginLink = `https://${mosqueSubdomain}.mijnlvs.nl`;
                emailTypeForLog = 'm365_parent_welcome_email'; // Specific link type
                console.log(`[POST /api/users] Using specific login link for ${user.email}: ${loginLink}`);
            } else {
                console.warn(`[POST /api/users] Subdomain not found for mosque ${user.mosque_id} (${mosqueNameForEmail}). Using generic login link for ${user.email}.`);
            }
            
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
                    <p>U kunt inloggen via: <a href="${loginLink}">${loginLink}</a>.</p>
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
                emailType: emailTypeForLog
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
          console.error(`[POST /api/users] ASYNC ERROR: Error looking up mosque details for welcome email to ${user.email}:`, mosqueLookupError.message);
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
  // JOUW CODE
  try {
    const { mosque_id, name, teacher_id, description } = req.body;
    if (!mosque_id || !name || !teacher_id ) return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
    const { data: classData, error } = await supabase.from('classes').insert([{ mosque_id, name, teacher_id, description }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, class: classData });
  } catch (error) { sendError(res, 500, 'Fout bij aanmaken klas.', error.message, req); }
});
app.post('/api/students', async (req, res) => {
  // JOUW CODE
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
  // JOUW CODE
  try {
    const { mosque_id, parent_id, student_id, amount, payment_method, payment_date, description, notes, processed_by } = req.body;
    if (!mosque_id || !parent_id || !amount || !payment_method || !payment_date) return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
    const { data: payment, error } = await supabase.from('payments').insert([{ mosque_id, parent_id, student_id, amount, payment_method, payment_date, description, notes, processed_by }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, payment });
  } catch (error) { sendError(res, 500, 'Fout bij aanmaken betaling.', error.message, req); }
});

// ==================================
// NIEUWE WACHTWOORD E-MAIL ROUTE (JOUW CODE)
// ==================================
app.post('/api/users/:userId/send-new-password', async (req, res) => {
  // JOUW CODE
  const { userId } = req.params;
  console.log(`[SEND NEW PWD] Request received for user ID: ${userId}`);

  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, name, role, mosque_id, mosque:mosque_id (name, subdomain, m365_configured)')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return sendError(res, 404, 'Gebruiker niet gevonden.', userError ? userError.message : 'Geen data', req);
    }
    if (!user.mosque || !user.mosque.name || !user.mosque.subdomain) {
      console.error(`[SEND NEW PWD] Incomplete mosque data for user ${userId}:`, user.mosque);
      return sendError(res, 500, 'Moskee informatie (naam/subdomein) ontbreekt voor deze gebruiker of kon niet worden geladen.', null, req);
    }
    
    console.log(`[SEND NEW PWD] Found user: ${user.email}, Role: ${user.role}, Mosque: ${user.mosque.name} (Subdomain: ${user.mosque.subdomain}, M365 Configured: ${user.mosque.m365_configured})`);
    const newTempPassword = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 4).toUpperCase() + '!';
    const newPasswordHash = await bcrypt.hash(newTempPassword, 10);

    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newPasswordHash, is_temporary_password: true, updated_at: new Date() })
      .eq('id', userId);

    if (updateError) {
      console.error(`[SEND NEW PWD] Error updating password for user ${userId}:`, updateError.message);
      return sendError(res, 500, 'Kon wachtwoord niet updaten in database.', updateError.message, req);
    }
    console.log(`[SEND NEW PWD] Password updated in DB for user ${userId}. New temp password: ${newTempPassword}`);

    if (!user.mosque.m365_configured) {
        console.warn(`[SEND NEW PWD] M365 not configured for mosque ${user.mosque.name}. Password updated, but no email sent for user ${user.email}.`);
        return res.json({ 
            success: true, 
            message: `Wachtwoord succesvol gereset voor ${user.name}. M365 is niet geconfigureerd voor deze moskee, dus er is GEEN e-mail verzonden. Het nieuwe tijdelijke wachtwoord is: ${newTempPassword}`,
            newPasswordForManualDelivery: newTempPassword 
        });
    }
    
    const mosqueName = user.mosque.name;
    const mosqueSubdomain = user.mosque.subdomain;
    const loginLink = `https://${mosqueSubdomain}.mijnlvs.nl`;
    const emailSubject = `Nieuw wachtwoord voor uw ${mosqueName} account`;
    const emailBody = `
        <!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>${emailSubject}</title></head><body>
            <p>Beste ${user.name},</p>
            <p>Op uw verzoek (of dat van een beheerder) is er een nieuw tijdelijk wachtwoord ingesteld voor uw account bij ${mosqueName}.</p>
            <p>U kunt nu inloggen met de volgende gegevens:</p><ul><li><strong>E-mailadres:</strong> ${user.email}</li><li><strong>Nieuw tijdelijk wachtwoord:</strong> ${newTempPassword}</li></ul>
            <p>Wij adviseren u dringend om uw wachtwoord direct na de eerste keer inloggen te wijzigen via uw profielpagina.</p>
            <p>U kunt inloggen via: <a href="${loginLink}">${loginLink}</a>.</p><br>
            <p>Met vriendelijke groet,</p><p>Het bestuur van ${mosqueName}</p>
        </body></html>`;

    const emailResult = await sendM365EmailInternal({
        to: user.email, subject: emailSubject, body: emailBody, mosqueId: user.mosque_id,
        emailType: `m365_new_temp_password_${user.role}` 
    });

    if (emailResult.success) {
        console.log(`[SEND NEW PWD] New password email successfully sent to ${user.email}.`);
        res.json({ success: true, message: `Nieuw tijdelijk wachtwoord succesvol verzonden naar ${user.name} (${user.email}).` });
    } else {
        console.error(`[SEND NEW PWD] Failed to send new password email to ${user.email}: ${emailResult.error}`, emailResult.details);
        return res.status(500).json({
            success: false, 
            error: `Wachtwoord wel gereset, maar e-mail kon niet worden verzonden: ${emailResult.error || 'Onbekende e-mailfout'}. Het nieuwe tijdelijke wachtwoord is: ${newTempPassword}`, 
            details: { newPasswordForManualDelivery: newTempPassword }
        });
    }
  } catch (error) {
    console.error(`[SEND NEW PWD] Unexpected error for user ID ${userId}:`, error);
    sendError(res, 500, 'Onverwachte serverfout bij het versturen van een nieuw wachtwoord.', error.message, req);
  }
});


// ==================================
// LESSEN & ABSENTIE ROUTES (NIEUW TOEGEVOEGD)
// ==================================
// Helper functies voor autorisatie (PLAATS JE EIGEN ROBUUSTE LOGICA HIER)
const isUserAuthorized = (req, requiredRole = null, targetMosqueId = null, targetClassId = null) => {
    if (!req.user) return false; // Geen gebruiker ingelogd

    // Admin van dezelfde moskee mag veel
    if (req.user.role === 'admin' && (!targetMosqueId || req.user.mosque_id === targetMosqueId)) {
        return true;
    }

    // Leraar specifieke checks
    if (req.user.role === 'teacher') {
        if (requiredRole && requiredRole !== 'teacher') return false; // Als specifieke andere rol nodig is
        if (targetMosqueId && req.user.mosque_id !== targetMosqueId) return false; // Leraar moet van dezelfde moskee zijn

        // Als classId check nodig is, moet je die nog implementeren
        // Voorbeeld: check of req.user.id de teacher_id is van targetClassId
        // Dit is complexer en vereist mogelijk een async database query hier,
        // of je haalt klasinfo op in de route en checkt daar.
        // Voor nu, basis check op rol en moskee.
        return true; 
    }
    
    // Ouder specifieke checks (indien nodig voor deze routes)
    if (req.user.role === 'parent') {
        // Voeg hier logica toe als ouders toegang moeten hebben tot bepaalde les/absentie info
    }
    
    // Als geen specifieke rol vereist is, maar wel een user
    if (!requiredRole && targetMosqueId && req.user.mosque_id === targetMosqueId) return true;

    return false; // Standaard geen toegang
};

// --- LESSEN ---
app.get('/api/mosques/:mosqueId/classes/:classId/lessons', async (req, res) => {
    const { mosqueId, classId } = req.params;
    const { startDate, endDate } = req.query;
    console.log(`[API GET Lessons] For Mosque: ${mosqueId}, Class: ${classId}, Start: ${startDate}, End: ${endDate}`);

    // Voorbeeld autorisatie: Leraar van de klas of Admin van de moskee
    // if (!isUserAuthorized(req, null, mosqueId, classId)) { // 'null' voor rol betekent elke ingelogde user van de moskee, of specifieker
    //     return sendError(res, 403, "Geen toegang tot deze lessen.", null, req);
    // }

    try {
        let query = supabase
            .from('lessen')
            .select(`id, les_datum, les_dag_van_week, start_tijd, eind_tijd, onderwerp, notities_les, is_geannuleerd, klas_id, klas:klas_id (name)`)
            .eq('moskee_id', mosqueId)
            .eq('klas_id', classId);

        if (startDate) query = query.gte('les_datum', startDate);
        if (endDate) query = query.lte('les_datum', endDate);
        query = query.order('les_datum', { ascending: true });

        const { data, error } = await query;
        if (error) throw error;
        console.log(`[API GET Lessons] Successfully fetched ${data ? data.length : 0} lessons.`);
        res.json(data);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen lessen.', error.message, req);
    }
});

app.get('/api/lessen/:lessonId/details-for-attendance', async (req, res) => {
    const { lessonId } = req.params;
    try {
        const { data: lesson, error: lessonError } = await supabase
            .from('lessen')
            .select(`id, les_datum, onderwerp, is_geannuleerd, moskee_id, klas_id, klas:klas_id (id, name, students:students (id, name, active))`)
            .eq('id', lessonId)
            .single();
        if (lessonError) throw lessonError;
        if (!lesson) return sendError(res, 404, "Les niet gevonden.", null, req);
        // if (!isUserAuthorized(req, 'teacher', lesson.moskee_id, lesson.klas_id)) return sendError(res, 403, "Geen toegang.");
        if (lesson.klas && lesson.klas.students) {
            lesson.klas.students = lesson.klas.students.filter(s => s.active);
        }
        res.json(lesson);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen lesdetails.', error.message, req);
    }
});

app.post('/api/mosques/:mosqueId/classes/:classId/lessons', async (req, res) => {
    const { mosqueId, classId } = req.params;
    const { les_datum, onderwerp, notities_les, start_tijd, eind_tijd, is_geannuleerd = false } = req.body;
    // if (!isUserAuthorized(req, 'teacher', mosqueId, classId)) return sendError(res, 403, "Niet geautoriseerd.");
    if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);


    if (!les_datum) return sendError(res, 400, "Les datum is verplicht.", null, req);
    try {
        const { data: existingLesson, error: checkError } = await supabase.from('lessen').select('id').eq('klas_id', classId).eq('les_datum', les_datum).maybeSingle();
        if (checkError && checkError.code !== 'PGRST116') { throw checkError; }
        if (existingLesson) return sendError(res, 409, `Er bestaat al een les voor klas op ${les_datum}. Les ID: ${existingLesson.id}`, { existingLessonId: existingLesson.id }, req);

        const lesData = {
            moskee_id: mosqueId, klas_id: classId, les_datum, onderwerp, notities_les, start_tijd, eind_tijd, is_geannuleerd,
            les_dag_van_week: new Date(les_datum).toLocaleDateString('nl-NL', { weekday: 'long' })
        };
        const { data: newLesson, error } = await supabase.from('lessen').insert(lesData).select().single();
        if (error) throw error;
        res.status(201).json({ success: true, message: 'Les aangemaakt.', data: newLesson });
    } catch (error) {
        sendError(res, 500, 'Fout bij aanmaken les.', error.message, req);
    }
});

app.put('/api/lessen/:lessonId', async (req, res) => {
    const { lessonId } = req.params;
    const { onderwerp, notities_les, start_tijd, eind_tijd, is_geannuleerd, les_datum } = req.body;
    try {
        const { data: lessonToUpdate, error: fetchError } = await supabase.from('lessen').select('klas_id, moskee_id').eq('id', lessonId).single();
        if (fetchError || !lessonToUpdate) return sendError(res, 404, "Les niet gevonden.", null, req);
        // if (!isUserAuthorized(req, 'teacher', lessonToUpdate.moskee_id, lessonToUpdate.klas_id)) return sendError(res, 403, "Niet geautoriseerd.");
        if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);


        const updateData = { onderwerp, notities_les, start_tijd, eind_tijd, is_geannuleerd, les_datum, gewijzigd_op: new Date() };
        if (les_datum) updateData.les_dag_van_week = new Date(les_datum).toLocaleDateString('nl-NL', { weekday: 'long' });
        Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

        const { data, error } = await supabase.from('lessen').update(updateData).eq('id', lessonId).select().single();
        if (error) throw error;
        res.json({ success: true, message: 'Les bijgewerkt.', data });
    } catch (error) {
        sendError(res, 500, 'Fout bij bijwerken les.', error.message, req);
    }
});

// --- ABSENTIE REGISTRATIES ---
app.post('/api/lessen/:lessonId/absenties', async (req, res) => {
    const { lessonId } = req.params;
    const absentieDataArray = req.body;
    const leraarId = req.user ? req.user.id : null;

    if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
    if (!Array.isArray(absentieDataArray)) return sendError(res, 400, "Absentie data moet een array zijn.", null, req);
    
    try {
        const { data: lesInfo, error: lesError } = await supabase.from('lessen').select('id, moskee_id, klas_id').eq('id', lessonId).single();
        if (lesError || !lesInfo) return sendError(res, 404, "Les niet gevonden.", lesError ? lesError.message : null, req);
        // if (!isUserAuthorized(req, 'teacher', lesInfo.moskee_id, lesInfo.klas_id)) return sendError(res, 403, "Niet geautoriseerd.");

        const recordsToUpsert = absentieDataArray.map(item => ({
            les_id: lessonId, leerling_id: item.leerling_id, moskee_id: lesInfo.moskee_id,
            status: item.status, notities_absentie: item.notities_absentie,
            geregistreerd_door_leraar_id: leraarId, registratie_datum_tijd: new Date()
        }));
        const { data, error: upsertError } = await supabase.from('absentie_registraties').upsert(recordsToUpsert, { onConflict: 'les_id, leerling_id' })
            .select(`id, status, notities_absentie, leerling_id, leerling:leerling_id (name)`);
        if (upsertError) throw upsertError;
        res.status(200).json({ success: true, message: 'Absenties opgeslagen.', data });
    } catch (error) {
        sendError(res, 500, `Fout bij opslaan absenties.`, error.message, req);
    }
});

app.get('/api/lessen/:lessonId/absenties', async (req, res) => {
    const { lessonId } = req.params;
    try {
        const { data: lesInfo, error: lesFetchError } = await supabase.from('lessen').select('moskee_id, klas_id').eq('id', lessonId).single();
        if (lesFetchError || !lesInfo) return sendError(res, 404, "Les niet gevonden om absenties op te halen.", null, req);
        // if (!isUserAuthorized(req, null, lesInfo.moskee_id, lesInfo.klas_id)) return sendError(res, 403, "Geen toegang.");
        
        const { data, error } = await supabase.from('absentie_registraties')
            .select(`id, status, notities_absentie, registratie_datum_tijd, leerling_id, leerling:leerling_id ( name ), geregistreerd_door_leraar_id, leraar:geregistreerd_door_leraar_id ( name )`)
            .eq('les_id', lessonId);
        if (error) throw error;
        res.json(data);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen absenties voor les.', error.message, req);
    }
});

app.get('/api/leerlingen/:studentId/absentiehistorie', async (req, res) => {
    const { studentId } = req.params;
    const { startDate, endDate, limit = 50 } = req.query;
    try {
        // TODO: Verfijn autorisatie: ouder van student, leraar van klas van student, of admin van moskee.
        // const {data: studentInfo} = await supabase.from('students').select('mosque_id, class_id, parent_id').eq('id', studentId).single();
        // if (!studentInfo) return sendError(res, 404, "Leerling niet gevonden.", null, req);
        // if (!isUserAuthorized(req, null, studentInfo.mosque_id, studentInfo.class_id)) { /* check ook parent_id */ }

        let query = supabase.from('absentie_registraties')
            .select(`id, status, notities_absentie, registratie_datum_tijd, les:les_id ( les_datum, onderwerp, is_geannuleerd, klas:klas_id (name) )`)
            .eq('leerling_id', studentId)
            .order('les_datum', { foreignTable: 'lessen', ascending: false })
            .limit(parseInt(limit, 10));

        if (startDate || endDate) {
            const studentMosqueId = req.user?.mosque_id; // Dit moet de moskee_id van de leerling zijn.
            if (!studentMosqueId && req.user?.role !== 'admin') { // Admin mag mogelijk breder kijken.
                 // Probeer moskee_id van student op te halen als niet via req.user
                 const {data: stud} = await supabase.from('students').select('mosque_id').eq('id', studentId).single();
                 if (!stud?.mosque_id) return sendError(res, 400, "Kon moskee ID voor student niet bepalen.", null, req);
                 // studentMosqueId = stud.mosque_id; // Dit is nu niet gezet in deze scope.
            }
            // Bovenstaande logica voor studentMosqueId is complex en moet goed. Voor nu, aanname dat req.user.mosque_id ok is voor test.

            const { data: lessonsInRange, error: lessonsError } = await supabase.from('lessen')
                .select('id')
                // .eq('moskee_id', studentMosqueId) // Scope op moskee van de leerling/context
                .gte('les_datum', startDate || '1900-01-01').lte('les_datum', endDate || '2999-12-31');
            if (lessonsError) throw lessonsError;
            const lessonIdsInRange = lessonsInRange.map(l => l.id);
            if (lessonIdsInRange.length > 0) query = query.in('les_id', lessonIdsInRange);
            else return res.json([]);
        }
        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen absentiehistorie leerling.', error.message, req);
    }
});
// ==================================
// EINDE LESSEN & ABSENTIE ROUTES
// ==================================


// EMAIL & CONFIG ROUTES (JOUW CODE)
// =========================================================================================
app.post('/api/send-email-m365', async (req, res) => {
  // JOUW CODE
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

  if (clientSecretFromFrontend) { // Test-scenario met expliciete credentials
    console.log("[/api/send-email-m365] Handling as EXPLICIT TEST call (clientSecret provided).");
    try {
        let actualTenantId = explicitTenantId;
        let actualClientId = explicitClientId;
        let senderToUse = explicitSenderForTest;

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

  } else if (mosqueId) { // App-geïnitieerde e-mail, gebruik interne functie die DB credentials haalt
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
// EINDE EMAIL ROUTES (JOUW CODE)
// =========================================================================================

app.get('/api/config-check', (req, res) => {
  // JOUW CODE
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
      'GET /api/mosques/:mosqueId/users', 'GET /api/users/:id', 'POST /api/users', 'PUT /api/users/:id', 'DELETE /api/users/:id', 'POST /api/users/:userId/send-new-password',
      'GET /api/mosques/:mosqueId/classes','GET /api/classes/:id', 'POST /api/classes', 'PUT /api/classes/:id', 'DELETE /api/classes/:id',
      'GET /api/mosques/:mosqueId/students','GET /api/students/:id', 'POST /api/students', 'PUT /api/students/:id', 'DELETE /api/students/:id',
      'GET /api/mosques/:mosqueId/payments','GET /api/payments/:id', 'POST /api/payments', 'PUT /api/payments/:id', 'DELETE /api/payments/:id',
      // NIEUWE ROUTES HIER TOEGEVOEGD:
      'GET /api/mosques/:mosqueId/classes/:classId/lessons',
      'GET /api/lessen/:lessonId/details-for-attendance',
      'POST /api/mosques/:mosqueId/classes/:classId/lessons',
      'PUT /api/lessen/:lessonId',
      'POST /api/lessen/:lessonId/absenties',
      'GET /api/lessen/:lessonId/absenties',
      'GET /api/leerlingen/:studentId/absentiehistorie',
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
  console.log(`🚀 Moskee Backend API v2.2.6 (Les & Absentie) running on port ${PORT}`);
  console.log(`🔗 Base URL for API: (Your Railway public URL, e.g., https://project-name.up.railway.app)`);
  console.log(`🗄️ Supabase Project URL: ${supabaseUrl ? supabaseUrl.split('.')[0] + '.supabase.co' : 'Not configured'}`);
  if (process.env.NODE_ENV !== 'production') {
    console.warn("⚠️ Running in development mode. Detailed errors might be exposed.");
  } else {
    console.log("🔒 Running in production mode.");
  }
});

module.exports = app;
