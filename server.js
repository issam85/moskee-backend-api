// server.js - Complete backend met Supabase database integratie
// Versie: 2.2.8 - Productieklare Authenticatie + Les & Absentie (of je huidige versie)
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase initialization - VERBETERDE VERSIE
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

console.log("🚦 [INIT] Attempting to initialize Supabase client...");
console.log("🚦 [INIT] Using SUPABASE_URL:", supabaseUrl);
console.log("🚦 [INIT] Using SUPABASE_SERVICE_KEY (length):", supabaseKey ? supabaseKey.length : "NOT SET", supabaseKey ? `(starts with: ${supabaseKey.substring(0,10)}...)` : '');

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required.");
  process.exit(1);
}

// Verificeer dat het een service_role key is (niet anon key)
if (!supabaseKey.includes('eyJ') || supabaseKey.length < 100) {
  console.error("❌ FATAL: SUPABASE_SERVICE_KEY lijkt niet geldig te zijn. Zorg dat je de service_role key gebruikt, niet de anon key.");
  process.exit(1);
}

let supabase;
try {
  console.log("[INIT PRE-CREATE] Attempting Supabase client creation with explicit admin configuration...");
  
  // Expliciete configuratie voor server-side gebruik met admin rechten
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    db: {
      schema: 'public'
    },
    global: {
      headers: {
        'Authorization': `Bearer ${supabaseKey}`
      }
    }
  });

  console.log("✅ [INIT POST-CREATE] Supabase client object created.");

  // Uitgebreide admin API check
  console.log("🔍 [INIT DEBUG] Checking admin API availability...");
  console.log("🔍 [INIT DEBUG] supabase object exists:", !!supabase);
  console.log("🔍 [INIT DEBUG] supabase.auth exists:", !!(supabase && supabase.auth));
  console.log("🔍 [INIT DEBUG] supabase.auth.admin exists:", !!(supabase && supabase.auth && supabase.auth.admin));
  
  if (supabase && supabase.auth && supabase.auth.admin) {
    console.log("✅ [INIT POST-CREATE DEBUG] supabase.auth.admin object IS available.");
    console.log("✅ [INIT POST-CREATE DEBUG] Type of supabase.auth.admin.getUserByEmail:", typeof supabase.auth.admin.getUserByEmail);
    console.log("✅ [INIT POST-CREATE DEBUG] Type of supabase.auth.admin.listUsers:", typeof supabase.auth.admin.listUsers);
    console.log("✅ [INIT POST-CREATE DEBUG] Type of supabase.auth.admin.createUser:", typeof supabase.auth.admin.createUser);
    
    // Test de admin functies
    console.log("🔍 [INIT DEBUG] Available admin methods:", Object.getOwnPropertyNames(supabase.auth.admin));
    
    // Kleine test call om te verifiëren dat admin API werkt
    setTimeout(async () => {
      try {
        console.log("🧪 [INIT TEST] Testing admin.listUsers()...");
        const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
        if (error) {
          console.error("❌ [INIT TEST] Admin test failed:", error.message);
        } else {
          console.log("✅ [INIT TEST] Admin API test successful. User count:", data.users?.length || 0);
        }
      } catch (testError) {
        console.error("❌ [INIT TEST] Admin test exception:", testError.message);
      }
    }, 1000);
    
  } else {
    console.error("❌ [INIT POST-CREATE DEBUG] supabase.auth.admin object IS NOT available.");
    if (!supabase) console.error("❌ [INIT POST-CREATE DEBUG] supabase client is falsy.");
    else if (!supabase.auth) console.error("❌ [INIT POST-CREATE DEBUG] supabase.auth is falsy.");
    else if (!supabase.auth.admin) console.error("❌ [INIT POST-CREATE DEBUG] supabase.auth.admin is falsy/undefined.");
    
    // BELANGRIJK: Voeg Supabase versie check toe
    console.error("🔍 [VERSION CHECK] Checking Supabase version...");
    try {
      const packageJson = require('./package.json');
      const supabaseVersion = packageJson.dependencies['@supabase/supabase-js'];
      console.error("📦 [VERSION CHECK] package.json Supabase version:", supabaseVersion);
    } catch (e) {
      console.error("❌ [VERSION CHECK] Could not read package.json:", e.message);
    }
    
    // Check welke versie daadwerkelijk geladen is
    try {
      const supabasePackage = require('@supabase/supabase-js/package.json');
      console.error("📦 [VERSION CHECK] Actually loaded Supabase version:", supabasePackage.version);
    } catch (e) {
      console.error("❌ [VERSION CHECK] Could not read loaded Supabase version:", e.message);
    }
    
    // GEEN process.exit(1) meer - laat de app draaien voor debugging
    console.error("⚠️ [WARNING] Continuing without admin API - some features will not work!");
  }
  
} catch (initError) {
  console.error("❌ FATAL: Supabase client initialization FAILED:", initError.message, initError);
  console.error("Full initialization error object:", initError);
  process.exit(1);
}

async function testSupabaseConnection() {
  console.log("🚦 [DB STARTUP TEST] Attempting a simple query to Supabase...");
  // Voeg een check toe of supabase wel geinitialiseerd is voordat je het gebruikt
  if (!supabase) {
    console.error("❌ [DB STARTUP TEST] Supabase client not initialized. Skipping test query.");
    return;
  }
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

// ==================================
// DEBUG ROUTE (VOEG HIER TOE)
// ==================================
app.get('/api/debug-supabase-client', (req, res) => {
    console.log("[DEBUG ROUTE] /api/debug-supabase-client HIT");
    let adminFunctionsAvailable = false;
    let getUserByEmailType = 'undefined';
    let listUsersType = 'undefined';
    let authAdminObjectExists = false;
    let availableAdminKeys = "N/A";

    if (supabase && supabase.auth && supabase.auth.admin) {
        authAdminObjectExists = true; 
        getUserByEmailType = typeof supabase.auth.admin.getUserByEmail;
        listUsersType = typeof supabase.auth.admin.listUsers;
        availableAdminKeys = Object.keys(supabase.auth.admin).join(', ');
        if (getUserByEmailType === 'function' && listUsersType === 'function') {
             adminFunctionsAvailable = true;
        }
        console.log("[DEBUG ROUTE] supabase.auth.admin object found. typeof getUserByEmail:", getUserByEmailType, "typeof listUsers:", listUsersType);
    } else {
        console.error("[DEBUG ROUTE] supabase.auth.admin object NOT found or supabase/auth is missing.");
        if (!supabase) console.error("[DEBUG ROUTE] supabase client is falsy.");
        else if (!supabase.auth) console.error("[DEBUG ROUTE] supabase.auth is falsy.");
        else if (supabase.auth && !supabase.auth.admin) console.error("[DEBUG ROUTE] supabase.auth.admin is falsy/undefined on the existing supabase.auth object.");
    }

    res.json({
        message: "Supabase client debug info from /api/debug-supabase-client",
        timestamp: new Date().toISOString(),
        supabaseClientExists: !!supabase,
        authObjectExists: !!(supabase && supabase.auth),
        authAdminObjectExists: authAdminObjectExists,
        adminFunctionsProperlyAvailable: adminFunctionsAvailable,
        typeOfGetUserByEmail: getUserByEmailType,
        typeOfListUsers: listUsersType,
        availableAdminKeys: availableAdminKeys,
        keyUsedForInit_Start: supabaseKey ? supabaseKey.substring(0, 10) + "..." : "KEY_NOT_SET_AT_INIT_SCOPE",
        keyUsedForInit_End: supabaseKey ? "..." + supabaseKey.substring(supabaseKey.length - 5) : "KEY_NOT_SET_AT_INIT_SCOPE"
    });
});

// ==================================
// AUTHENTICATIE MIDDLEWARE (PRODUCTIE)
// ==================================
app.use(async (req, res, next) => {
    const authHeader = req.headers.authorization;
    req.user = null; 

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const { data: { user: supabaseUser }, error: authError } = await supabase.auth.getUser(token);

            if (authError) {
                console.warn(`[AUTH] Token validation failed for path ${req.path}: ${authError.message}`);
            } else if (supabaseUser) {
                const { data: appUser, error: appUserError } = await supabase
                    .from('users') 
                    .select('*') 
                    .eq('id', supabaseUser.id) 
                    .single();

                if (appUserError) {
                    console.error(`[AUTH] Error fetching app user from DB for Supabase ID ${supabaseUser.id}:`, appUserError.message);
                } else if (appUser) {
                    req.user = appUser; 
                } else {
                    console.warn(`[AUTH] App user not found in DB for Supabase user ID: ${supabaseUser.id}. Path: ${req.path}. Logging out Supabase session.`);
                }
            } else {
                 console.warn(`[AUTH] No Supabase user found for token. Path: ${req.path}`);
            }
        } catch (e) {
            console.error('[AUTH] Unexpected error during token processing:', e.message);
        }
    }
    next();
});
// ==================================
// EINDE AUTHENTICATIE MIDDLEWARE
// ==================================


const sendError = (res, statusCode, message, details = null, req = null) => {
  const pathInfo = req ? `${req.method} ${req.originalUrl}` : '(Unknown path)';
  console.error(`Error ${statusCode} in ${pathInfo}: ${message}`, details || '');
  res.status(statusCode).json({ success: false, error: message, details });
};

app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    version: '2.2.7', 
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
// AUTHENTICATION ROUTES (AANGEPAST voor Supabase Auth)
// ======================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, subdomain } = req.body;
    if (!email || !password || !subdomain) return sendError(res, 400, 'Email, password, and subdomain are required.', null, req);
    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedEmail = email.toLowerCase().trim();
    const { data: mosque, error: mosqueError } = await supabase.from('mosques').select('id').eq('subdomain', normalizedSubdomain).single();
    if (mosqueError || !mosque) return sendError(res, 404, `Moskee met subdomein '${normalizedSubdomain}' niet gevonden.`, null, req);
    const { data: { user: supabaseAuthUser, session }, error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password: password });
    if (signInError) { if (signInError.message === 'Invalid login credentials') return sendError(res, 401, 'Ongeldige combinatie van email/wachtwoord.', null, req); return sendError(res, 401, `Authenticatiefout: ${signInError.message}`, null, req); }
    if (!supabaseAuthUser || !session) return sendError(res, 401, 'Ongeldige inlogpoging, geen gebruiker of sessie ontvangen.', null, req);
    const { data: appUser, error: appUserError } = await supabase.from('users').select('*').eq('id', supabaseAuthUser.id).eq('mosque_id', mosque.id).single();
    if (appUserError || !appUser) { await supabase.auth.signOut(); return sendError(res, 401, 'Gebruiker gevonden in authenticatiesysteem, maar niet in applicatiedatabase voor deze moskee of gegevens inconsistent.', null, req); }
    await supabase.from('users').update({ last_login: new Date() }).eq('id', appUser.id);
    const { password_hash, ...userWithoutPassword } = appUser; 
    res.json({ success: true, user: userWithoutPassword });
  } catch (error) { console.error("Login error (outer catch):", error); sendError(res, 500, 'Interne serverfout tijdens login.', error.message, req); }
});

// ======================
// REGISTRATION ROUTE (AANGEPAST voor Supabase Auth)
// ======================
app.post('/api/mosques/register', async (req, res) => {
  console.log("[BACKEND /api/mosques/register] Received req.body:", JSON.stringify(req.body, null, 2));
  try {
    const { mosqueName, subdomain, adminName, adminEmail, adminPassword, address, city, zipcode, phone, website, email: mosqueContactEmail } = req.body;
    if (!mosqueName || !subdomain || !adminName || !adminEmail || !adminPassword) return sendError(res, 400, 'Verplichte registratievelden ontbreken.', null, req);
    if (adminPassword.length < 8) return sendError(res, 400, 'Admin wachtwoord moet minimaal 8 karakters lang zijn.', null, req);
    const normalizedSubdomain = subdomain.toLowerCase().trim(); 
    const normalizedAdminEmail = adminEmail.toLowerCase().trim();
    
    // Check if subdomain already exists
    const { data: existingSubdomain } = await supabase.from('mosques').select('id').eq('subdomain', normalizedSubdomain).maybeSingle();
    if (existingSubdomain) return sendError(res, 409, 'Dit subdomein is al in gebruik.', null, req);
    
    // Check if email already exists in auth system - SUPABASE V2 COMPATIBLE
    try { 
      console.log(`[REGISTER] Checking if email ${normalizedAdminEmail} already exists in auth system...`);
      const { data: { users }, error } = await supabase.auth.admin.listUsers();
      
      if (error) {
        console.error("Error checking existing auth users for registration:", error);
        return sendError(res, 500, "Fout bij controleren bestaande auth gebruiker.", error.message, req);
      }
      
      // Check if email already exists in the users list
      const existingAuthUser = users?.find(user => user.email === normalizedAdminEmail);
      if (existingAuthUser) {
        console.log(`[REGISTER] Email ${normalizedAdminEmail} already exists in auth system.`);
        return sendError(res, 409, 'Dit emailadres is al geregistreerd in het authenticatiesysteem.', null, req);
      }
      
      console.log(`[REGISTER] Email ${normalizedAdminEmail} is available for registration.`);
    } catch (error) { 
      console.error("Error checking existing auth user for registration:", error);
      return sendError(res, 500, "Fout bij controleren bestaande auth gebruiker.", error.message, req);
    }
    
    // Check if email already exists in app database
    const { data: existingAppUser } = await supabase.from('users').select('id').eq('email', normalizedAdminEmail).maybeSingle();
    if (existingAppUser) return sendError(res, 409, 'Dit emailadres is al geregistreerd voor een gebruiker in de applicatie.', null, req);
    
    // Create mosque record
    const { data: newMosque, error: mosqueCreateError } = await supabase.from('mosques').insert([{
      name: mosqueName, 
      subdomain: normalizedSubdomain, 
      address, 
      city, 
      zipcode, 
      phone, 
      email: mosqueContactEmail || normalizedAdminEmail, 
      website, 
      m365_configured: false, 
      contribution_1_child: 150, 
      contribution_2_children: 300, 
      contribution_3_children: 450, 
      contribution_4_children: 450, 
      contribution_5_plus_children: 450, 
      m365_sender_email: null
    }]).select().single();
    if (mosqueCreateError) throw mosqueCreateError;
    
    // Create auth user
    const { data: { user: supabaseAuthAdmin }, error: supabaseAuthError } = await supabase.auth.admin.createUser({ 
      email: normalizedAdminEmail, 
      password: adminPassword, 
      email_confirm: true 
    });
    if (supabaseAuthError) { 
      await supabase.from('mosques').delete().eq('id', newMosque.id); 
      return sendError(res, 500, `Fout bij aanmaken authenticatie gebruiker: ${supabaseAuthError.message}`, supabaseAuthError, req); 
    }
    if (!supabaseAuthAdmin) { 
      await supabase.from('mosques').delete().eq('id', newMosque.id); 
      return sendError(res, 500, 'Kon authenticatie gebruiker niet aanmaken (geen user object).', null, req); 
    }
    
    // Create app user record
    const password_hash = await bcrypt.hash(adminPassword, 10);
    const { data: newAppAdmin, error: appAdminCreateError } = await supabase.from('users').insert([{ 
      id: supabaseAuthAdmin.id, 
      mosque_id: newMosque.id, 
      email: normalizedAdminEmail, 
      password_hash, 
      name: adminName, 
      role: 'admin', 
      is_temporary_password: false 
    }]).select('id, email, name, role').single();
    
    if (appAdminCreateError) { 
      await supabase.from('mosques').delete().eq('id', newMosque.id); 
      await supabase.auth.admin.deleteUser(supabaseAuthAdmin.id); 
      throw appAdminCreateError; 
    }
    
    // Send welcome email if M365 is configured
    if (newAppAdmin && newMosque.m365_configured && newMosque.m365_sender_email) { 
        console.log(`[Mosque Register] New admin ${newAppAdmin.email} for mosque ${newMosque.name}. M365 configured, attempting admin welcome email.`);
        const adminWelcomeSubject = `Welkom als beheerder bij ${newMosque.name}!`;
        const adminWelcomeBody = `<h1>Welkom ${adminName},</h1><p>Uw beheerdersaccount voor het leerlingvolgsysteem van ${newMosque.name} is succesvol aangemaakt.</p><p>U kunt inloggen met de volgende gegevens:</p><ul><li><strong>Email:</strong> ${normalizedAdminEmail}</li><li><strong>Wachtwoord:</strong> ${adminPassword} (het wachtwoord dat u zojuist heeft opgegeven)</li></ul><p>Log in via: https://${normalizedSubdomain}.mijnlvs.nl</p><p>Met vriendelijke groet,</p><p>Het MijnLVS Team</p>`;
        sendM365EmailInternal({ 
          to: normalizedAdminEmail, 
          subject: adminWelcomeSubject, 
          body: adminWelcomeBody, 
          mosqueId: newMosque.id, 
          emailType: 'm365_admin_mosque_registration_welcome' 
        })
        .then(result => { 
          if (result.success) console.log(`[Mosque Register] Admin welcome email to ${normalizedAdminEmail} sent/queued. MsgID: ${result.messageId}`); 
          else console.error(`[Mosque Register] Failed to send admin welcome email to ${normalizedAdminEmail}: ${result.error}`, result.details); 
        })
        .catch(err => console.error(`[Mosque Register] Critical error sending admin welcome email:`, err));
    } else if (newAppAdmin) {
        console.log(`[Mosque Register] New admin ${newAppAdmin.email} created for ${newMosque.name}. M365 not yet configured (or sender missing), so no welcome email sent automatically.`);
    }
    
    res.status(201).json({ success: true, message: 'Registratie succesvol!', mosque: newMosque, admin: newAppAdmin });
  } catch (error) { 
    sendError(res, error.code === '23505' || (error.message && error.message.includes('already registered')) ? 409 : (error.status || 400), error.message || 'Fout bij registratie.', error.details || error.hint || error, req); 
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
      // Nieuwe, uitgebreide regel
      .select('id, name, subdomain, address, city, zipcode, phone, email, website, m365_tenant_id, m365_client_id, m365_sender_email, m365_configured, contribution_1_child, contribution_2_children, contribution_3_children, contribution_4_children, contribution_5_plus_children, contact_committee_name, contact_committee_email, created_at, updated_at')
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
// GENERIC CRUD HELPER & ENDPOINTS (MET AUTORISATIE)
// ======================
const createCrudEndpoints = (tableName, selectString = '*', singularNameOverride = null) => {
    const singularName = singularNameOverride || tableName.slice(0, -1);

    // GET all resources for a mosque
    app.get(`/api/mosques/:mosqueId/${tableName}`, async (req, res) => {
        if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
        if (req.user.mosque_id !== req.params.mosqueId && req.user.role !== 'superadmin') { // 'superadmin' als voorbeeld voor een rol die overal bij mag
            return sendError(res, 403, "Niet geautoriseerd voor data van deze moskee.", null, req);
        }
        // Leraren mogen mogelijk alleen bepaalde tabellen zien, of gefilterde data.
        // Voor nu: als je een leraar bent, en je bent van de moskee, mag je de data zien. Verfijn dit indien nodig.
        // if (req.user.role === 'teacher' && !['classes', 'students'].includes(tableName)) { 
        //    return sendError(res, 403, "Leraren hebben geen toegang tot deze data.", null, req);
        // }

        try {
            const { mosqueId } = req.params;
            let query = supabase.from(tableName).select(selectString).eq('mosque_id', mosqueId);
            if (tableName === 'users' && req.query.role) query = query.eq('role', req.query.role);
            if (tableName === 'classes' || tableName === 'students') query = query.eq('active', true); // Behoud je bestaande filters
            query = query.order('created_at', { ascending: false });
            const { data, error } = await query;
            if (error) throw error;
            res.json(data);
        } catch (error) { sendError(res, 500, `Fout bij ophalen ${tableName}.`, error.message, req); }
    });

    // GET a single resource by ID
    app.get(`/api/${tableName}/:id`, async (req, res) => {
        if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
        try {
            const { id } = req.params;
            const { data, error } = await supabase.from(tableName).select(selectString).eq('id', id).single();
            if (error || !data) return sendError(res, 404, `${singularName} niet gevonden.`, null, req);

            // Autorisatie: gebruiker moet van dezelfde moskee zijn als de resource,
            // tenzij het de user zelf is (voor profiel) of een superadmin.
            let authorized = (req.user.role === 'superadmin');
            if (!authorized && data.mosque_id) { // Als de resource een mosque_id heeft
                if (req.user.mosque_id !== data.mosque_id) {
                    // Uitzondering: een gebruiker mag zijn eigen profiel ophalen, zelfs als mosque_id check faalt (onwaarschijnlijk scenario maar defensief)
                    if (tableName === 'users' && req.user.id === id) {
                        authorized = true;
                    } else {
                        return sendError(res, 403, "Niet geautoriseerd voor deze specifieke resource (verkeerde moskee).", null, req);
                    }
                } else {
                    authorized = true; // Gebruiker is van dezelfde moskee
                }
            } else if (!authorized && tableName === 'users' && req.user.id === id) {
                authorized = true; // Gebruiker mag eigen profiel ophalen
            } else if (!authorized && !data.mosque_id && tableName !== 'users'){
                 // Resource heeft geen mosque_id, en het is niet de user zelf die zijn profiel ophaalt
                 console.warn(`Resource ${tableName}/${id} has no mosque_id for authorization check by user ${req.user.id}.`);
                 return sendError(res, 403, "Autorisatie niet mogelijk: resource mist moskee koppeling of u bent niet gemachtigd.", null, req);
            }
            
            if (!authorized) return sendError(res, 403, "Niet geautoriseerd.", null, req);
            res.json(data);
        } catch (error) { sendError(res, 500, `Fout bij ophalen ${singularName}.`, error.message, req); }
    });

    // UPDATE a resource by ID
    app.put(`/api/${tableName}/:id`, async (req, res) => {
        if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
        try {
            const { id } = req.params; 
            const { data: resource, error: fetchErr } = await supabase.from(tableName).select('mosque_id').eq('id', id).single();
            if (fetchErr || !resource) return sendError(res, 404, `${singularName} niet gevonden voor update.`, null, req);
            
            let authorizedToEdit = false;
            if (req.user.role === 'superadmin') authorizedToEdit = true;
            else if (req.user.mosque_id === resource.mosque_id) {
                if (req.user.role === 'admin') authorizedToEdit = true;
                // Een gebruiker (niet ouder) mag zijn eigen profiel (users tabel) wijzigen.
                // Ouders mogen NIET hun 'amount_due' of 'role' etc. wijzigen via deze generieke route.
                else if (tableName === 'users' && req.user.id === id && req.user.role !== 'parent') {
                    // Beperk welke velden een niet-admin gebruiker mag wijzigen
                    const allowedUserUpdates = ['name', 'phone', 'address', 'city', 'zipcode'];
                    if (req.body.password) allowedUserUpdates.push('password'); // Wachtwoord wijzigen ook (aparte logica in body)
                    for (const key in req.body) {
                        if (!allowedUserUpdates.includes(key) && key !== 'updated_at') { // updated_at wordt door server gezet
                            return sendError(res, 403, `Veld '${key}' mag niet gewijzigd worden door gebruiker.`, null, req);
                        }
                    }
                    authorizedToEdit = true;
                }
            }
            if (!authorizedToEdit) return sendError(res, 403, "Niet geautoriseerd om deze resource te bewerken.", null, req);

            const updateData = { ...req.body, updated_at: new Date() };
            delete updateData.mosque_id; delete updateData.id; delete updateData.created_at;

            if (tableName === 'users' && updateData.password) { 
                // Voor wachtwoordwijziging door gebruiker zelf, zou je Supabase Auth moeten gebruiken.
                // Admin kan hier wel een wachtwoord resetten, de hash wordt hier opgeslagen.
                updateData.password_hash = await bcrypt.hash(updateData.password, 10); 
                // Supabase Auth wachtwoord moet apart geüpdatet worden als user zelf wijzigt!
                delete updateData.password; 
                updateData.is_temporary_password = false; 
            } else if (tableName === 'users') { delete updateData.password_hash; } // Verwijder hash als er geen nieuw wachtwoord is
            
            // Voorkom dat niet-admins bepaalde velden van users wijzigen
            if (tableName === 'users' && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
                delete updateData.role;
                delete updateData.amount_due;
                delete updateData.mosque_id; // Hoewel al verwijderd, voor de zekerheid
                delete updateData.is_temporary_password;
            }
             // Voorkom dat admins amount_due van ouders direct via deze generieke route wijzigen
            if (tableName === 'users' && req.body.role === 'parent' && req.user.role === 'admin') {
                 delete updateData.amount_due; 
            }


            const { data, error } = await supabase.from(tableName).update(updateData).eq('id', id).select(selectString).single();
            if (error) throw error; 
            res.json({ success: true, message: `${singularName} bijgewerkt.`, [singularName]: data });
        } catch (error) { sendError(res, 500, `Fout bij bijwerken ${singularName}.`, error.message, req); }
    });

    // DELETE a resource by ID
    app.delete(`/api/${tableName}/:id`, async (req, res) => {
        if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
        try {
            const { id } = req.params;
            const selectStringForDelete = tableName === 'users' ? 'mosque_id, email' : 'mosque_id';
            const { data: resource, error: fetchErr } = await supabase.from(tableName).select(selectStringForDelete).eq('id', id).single(); 
            if (fetchErr || !resource) return sendError(res, 404, `${singularName} niet gevonden voor verwijdering.`, null, req);
            if (req.user.mosque_id !== resource.mosque_id && req.user.role !== 'superadmin') return sendError(res, 403, "Niet geautoriseerd voor deze resource.", null, req);
            if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return sendError(res, 403, "Alleen admins mogen dit verwijderen.", null, req);

            if (tableName === 'students') {
                const { data: studentToDelete, error: studentFetchError } = await supabase.from('students').select('parent_id, mosque_id').eq('id', id).single();
                if (studentFetchError || !studentToDelete) return sendError(res, 404, "Leerling niet gevonden.", null, req);
                const { error: deleteError } = await supabase.from(tableName).delete().eq('id', id); if (deleteError) throw deleteError;
                if (studentToDelete.parent_id && studentToDelete.mosque_id) {
                    const { data: mosqueSettings } = await supabase.from('mosques').select('contribution_1_child, contribution_2_children, contribution_3_children, contribution_4_children, contribution_5_plus_children').eq('id', studentToDelete.mosque_id).single();
                    const { count: siblingCount } = await supabase.from('students').select('id', { count: 'exact' }).eq('parent_id', studentToDelete.parent_id).eq('active', true);
                    const newAmountDue = calculateAmountDueFromStaffel(siblingCount || 0, mosqueSettings);
                    await supabase.from('users').update({ amount_due: newAmountDue }).eq('id', studentToDelete.parent_id);
                }
            } else { 
                const { error } = await supabase.from(tableName).delete().eq('id', id); if (error) throw error;
                if (tableName === 'users' && resource.email) { // resource.email was geselecteerd
                    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(id); 
                    if (authDeleteError && authDeleteError.message !== 'User not found') { 
                        console.warn(`Kon Supabase Auth user ${id} (${resource.email}) niet verwijderen: ${authDeleteError.message}`);
                    }
                }
            }
            res.status(200).json({ success: true, message: `${singularName} verwijderd.` });
        } catch (error) { sendError(res, 500, `Fout bij verwijderen ${singularName}.`, error.message, req); }
    });
};
createCrudEndpoints('users', 'id, mosque_id, email, name, role, phone, address, city, zipcode, amount_due, created_at, last_login, is_temporary_password');
createCrudEndpoints('classes', '*, teacher:teacher_id(id, name), students(count)');
createCrudEndpoints('students', 'id, name, date_of_birth, notes, mosque_id, parent_id, class_id, active, parent:parent_id(id, name, email, phone, amount_due), class:class_id(id, name, teacher_id, teacher:teacher_id(name))', 'student');
createCrudEndpoints('payments', '*, parent:parent_id(id, name, email), student:student_id(id, name), processed_by_user:processed_by(name)');

// ======================
// SPECIFIC POST ROUTES (JOUW CODE)
// ======================
app.post('/api/users', async (req, res) => {
  try {
    const { mosque_id, email, name, role, phone, address, city, zipcode, password: plainTextPassword, sendWelcomeEmail = true } = req.body;
    if (!req.user || req.user.role !== 'admin' || req.user.mosque_id !== mosque_id) return sendError(res, 403, "Niet geautoriseerd om gebruikers toe te voegen aan deze moskee.", null, req);
    if (!mosque_id || !email || !name || !role || !plainTextPassword) return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
    if (plainTextPassword.length < 8) return sendError(res, 400, "Wachtwoord moet minimaal 8 karakters lang zijn.", null, req);
    const normalizedEmail = email.toLowerCase().trim();
    const { data: { user: supabaseAuthUser }, error: supabaseAuthError } = await supabase.auth.admin.createUser({ email: normalizedEmail, password: plainTextPassword, email_confirm: true });
    if (supabaseAuthError) { if (supabaseAuthError.message.includes('User already registered')) return sendError(res, 409, `Email ${normalizedEmail} is al geregistreerd in authenticatiesysteem.`, supabaseAuthError.message, req); return sendError(res, 500, `Fout bij aanmaken auth user: ${supabaseAuthError.message}`, supabaseAuthError, req); }
    if (!supabaseAuthUser) return sendError(res, 500, 'Kon auth user niet aanmaken (geen user object).', null, req);
    const password_hash = await bcrypt.hash(plainTextPassword, 10);
    const appUserData = { id: supabaseAuthUser.id, mosque_id, email: normalizedEmail, password_hash, name, role, is_temporary_password: true, phone, address, city, zipcode, amount_due: role === 'parent' ? 0 : null };
    const { data: appUser, error: appUserCreateError } = await supabase.from('users').insert([appUserData]).select('id, email, name, role, phone, address, city, zipcode, amount_due, created_at, mosque_id').single();
    if (appUserCreateError) { await supabase.auth.admin.deleteUser(supabaseAuthUser.id); if (appUserCreateError.code === '23505' && appUserCreateError.message.includes('users_email_key')) return sendError(res, 409, `Email ${normalizedEmail} bestaat al in applicatie database.`, appUserCreateError.details, req); throw appUserCreateError; }
    if (appUser && appUser.role === 'parent' && sendWelcomeEmail) {
      let mosqueNameForEmail = 'uw moskee'; let mosqueSubdomain = ''; 
      try {
        const { data: mosqueDataLookup } = await supabase.from('mosques').select('name, subdomain, m365_configured').eq('id', appUser.mosque_id).single();
        if (mosqueDataLookup) { if (mosqueDataLookup.name) mosqueNameForEmail = mosqueDataLookup.name; if (mosqueDataLookup.subdomain) mosqueSubdomain = mosqueDataLookup.subdomain; }
        if (!mosqueDataLookup || !mosqueDataLookup.m365_configured) { console.warn(`[POST /api/users] M365 not configured for mosque ${appUser.mosque_id}. Welcome email for ${appUser.email} NOT sent.`); } else {
            const emailSubject = `Welkom bij ${mosqueNameForEmail}! Uw account is aangemaakt.`; let loginLink = `https://mijnlvs.nl`; let emailTypeForLog = 'm365_parent_welcome_email_generic_link';
            if (mosqueSubdomain) { loginLink = `https://${mosqueSubdomain}.mijnlvs.nl`; emailTypeForLog = 'm365_parent_welcome_email'; }
            const emailBody = `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>${emailSubject}</title></head><body><p>Beste ${appUser.name},</p><p>Uw account voor het leerlingvolgsysteem van ${mosqueNameForEmail} is succesvol aangemaakt.</p><p>U kunt inloggen met de volgende gegevens:</p><ul><li><strong>E-mailadres:</strong> ${appUser.email}</li><li><strong>Tijdelijk wachtwoord:</strong> ${plainTextPassword}</li></ul><p>Wij adviseren u dringend om uw wachtwoord direct na de eerste keer inloggen te wijzigen via uw profielpagina.</p><p>U kunt inloggen via: <a href="${loginLink}">${loginLink}</a>.</p><br><p>Met vriendelijke groet,</p><p>Het bestuur van ${mosqueNameForEmail}</p></body></html>`;
            sendM365EmailInternal({ to: appUser.email, subject: emailSubject, body: emailBody, mosqueId: appUser.mosque_id, emailType: emailTypeForLog })
            .then(emailResult => { if (!emailResult.success) console.error(`[POST /api/users] ASYNC ERROR sending welcome email to ${appUser.email}: ${emailResult.error}`, emailResult.details || ''); else console.log(`[POST /api/users] ASYNC SUCCESS: Welcome email to ${appUser.email} sent/queued. MsgID: ${emailResult.messageId}`);})
            .catch(emailSendingError => console.error(`[POST /api/users] ASYNC CRITICAL ERROR during welcome email:`, emailSendingError.message, emailSendingError.stack));
        }
      } catch (mosqueLookupError) { console.error(`[POST /api/users] ASYNC ERROR looking up mosque details for welcome email to ${appUser.email}:`, mosqueLookupError.message); }
    } else if (appUser && appUser.role === 'parent' && !sendWelcomeEmail) { console.log(`[POST /api/users] Parent user ${appUser.email} created, but 'sendWelcomeEmail' was false. No email sent.`);}
    res.status(201).json({ success: true, user: appUser });
  } catch (error) { sendError(res, error.status || (error.code === '23505' || (error.message && error.message.includes('already registered'))) ? 409 : 500, error.message || 'Fout bij aanmaken gebruiker.', error.details || error.hint || error.toString(), req); }
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
  const { mosque_id, parent_id, class_id, name, date_of_birth, emergency_contact, emergency_phone, notes } = req.body;
  // AUTORISATIE CHECK
  if (!req.user || req.user.role !== 'admin' || req.user.mosque_id !== mosque_id) {
      return sendError(res, 403, "Niet geautoriseerd om leerlingen aan te maken voor deze moskee.", null, req);
  }
  try {
    if (!mosque_id || !parent_id || !class_id || !name) return sendError(res, 400, "Verplichte velden (mosque_id, parent_id, class_id, name) ontbreken.", null, req);
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
  const { mosque_id, parent_id, student_id, amount, payment_method, payment_date, description, notes } = req.body;
  // AUTORISATIE CHECK (processed_by wordt nu req.user.id)
  if (!req.user || req.user.role !== 'admin' || req.user.mosque_id !== mosque_id) {
      return sendError(res, 403, "Niet geautoriseerd om betalingen te registreren voor deze moskee.", null, req);
  }
  try {
    if (!mosque_id || !parent_id || !amount || !payment_method || !payment_date) return sendError(res, 400, "Verplichte velden (mosque_id, parent_id, amount, payment_method, payment_date) ontbreken.", null, req);
    const actualProcessedBy = req.user.id; // Gebruik altijd ID van ingelogde admin
    const { data: payment, error } = await supabase.from('payments').insert([{ mosque_id, parent_id, student_id, amount, payment_method, payment_date, description, notes, processed_by: actualProcessedBy }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, payment });
  } catch (error) { sendError(res, 500, 'Fout bij aanmaken betaling.', error.message, req); }
});

// ==================================
// NIEUWE WACHTWOORD E-MAIL ROUTE (JOUW CODE)
// ==================================
app.post('/api/users/:userId/send-new-password', async (req, res) => {
  const { userId } = req.params;
  if (!req.user || req.user.role !== 'admin') return sendError(res, 403, "Niet geautoriseerd.", null, req); 
  console.log(`[SEND NEW PWD] Request by ${req.user.email} for user ID: ${userId}`);
  try {
    const { data: user, error: userError } = await supabase.from('users').select('id, email, name, role, mosque_id, mosque:mosque_id (name, subdomain, m365_configured)').eq('id', userId).single();
    if (userError || !user) return sendError(res, 404, 'Gebruiker niet gevonden.', userError ? userError.message : 'Geen data', req);
    if (req.user.mosque_id !== user.mosque_id && req.user.role !== 'superadmin') return sendError(res, 403, "Admin niet van dezelfde moskee als gebruiker.", null, req);
    if (!user.mosque || !user.mosque.name || !user.mosque.subdomain) { console.error(`[SEND NEW PWD] Incomplete mosque data for user ${userId}:`, user.mosque); return sendError(res, 500, 'Moskee informatie ontbreekt.', null, req); }
    const newTempPassword = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 4).toUpperCase() + '!';
    
    const { error: updateAuthError } = await supabase.auth.admin.updateUserById(userId, { password: newTempPassword });
    if (updateAuthError) { console.error(`[SEND NEW PWD] Error updating Supabase Auth password for user ${userId}:`, updateAuthError.message); return sendError(res, 500, 'Kon wachtwoord in authenticatiesysteem niet updaten.', updateAuthError.message, req); }
    
    const newPasswordHash = await bcrypt.hash(newTempPassword, 10);
    const { error: updateAppUserError } = await supabase.from('users').update({ password_hash: newPasswordHash, is_temporary_password: true, updated_at: new Date() }).eq('id', userId);
    if (updateAppUserError) { console.error(`[SEND NEW PWD] Error updating app user password for user ${userId}:`, updateAppUserError.message); return sendError(res, 500, 'Kon wachtwoord in applicatiedatabase niet updaten.', updateAppUserError.message, req); }
    
    console.log(`[SEND NEW PWD] Password updated in DB & Auth for user ${userId}.`);
    if (!user.mosque.m365_configured) {
        console.warn(`[SEND NEW PWD] M365 not configured for mosque ${user.mosque.name}. Email NOT sent for ${user.email}.`);
        return res.json({ success: true, message: `Wachtwoord gereset. M365 niet geconfigureerd, GEEN email verzonden. Nieuw wachtwoord: ${newTempPassword}`, newPasswordForManualDelivery: newTempPassword });
    }
    const mosqueName = user.mosque.name; const mosqueSubdomain = user.mosque.subdomain; const loginLink = `https://${mosqueSubdomain}.mijnlvs.nl`;
    const emailSubject = `Nieuw wachtwoord voor uw ${mosqueName} account`;
    const emailBody = `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>${emailSubject}</title></head><body><p>Beste ${user.name},</p><p>Een nieuw tijdelijk wachtwoord is ingesteld voor uw account bij ${mosqueName}.</p><p>Inloggegevens:</p><ul><li><strong>E-mailadres:</strong> ${user.email}</li><li><strong>Nieuw tijdelijk wachtwoord:</strong> ${newTempPassword}</li></ul><p>Wijzig uw wachtwoord na inloggen.</p><p>Login via: <a href="${loginLink}">${loginLink}</a>.</p><br><p>Met vriendelijke groet,</p><p>Bestuur ${mosqueName}</p></body></html>`;
    const emailResult = await sendM365EmailInternal({ to: user.email, subject: emailSubject, body: emailBody, mosqueId: user.mosque_id, emailType: `m365_new_temp_password_${user.role}` });
    if (emailResult.success) { res.json({ success: true, message: `Nieuw tijdelijk wachtwoord verzonden naar ${user.name} (${user.email}).` }); } 
    else { return res.status(500).json({ success: false, error: `Wachtwoord gereset, maar emailfout: ${emailResult.error || 'Onbekend'}. Nieuw wachtwoord: ${newTempPassword}`, details: { newPasswordForManualDelivery: newTempPassword }}); }
  } catch (error) { console.error(`[SEND NEW PWD] Unexpected error for user ID ${userId}:`, error); sendError(res, 500, 'Onverwachte serverfout.', error.message, req); }
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
    const { mosqueId, classId } = req.params; const { startDate, endDate } = req.query;
    if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
    if (req.user.mosque_id !== mosqueId && req.user.role !== 'superadmin') return sendError(res, 403, "Geen toegang tot data van deze moskee.", null, req);
    // TODO: Verfijn: mag deze leraar/admin deze specifieke klas zien?
    console.log(`[API GET Lessons] User: ${req.user.id}, For Mosque: ${mosqueId}, Class: ${classId}`);
    try {
        let query = supabase.from('lessen').select(`id, les_datum, les_dag_van_week, start_tijd, eind_tijd, onderwerp, notities_les, is_geannuleerd, klas_id, klas:klas_id (name)`).eq('moskee_id', mosqueId).eq('klas_id', classId);
        if (startDate) query = query.gte('les_datum', startDate); if (endDate) query = query.lte('les_datum', endDate);
        query = query.order('les_datum', { ascending: true }); const { data, error } = await query;
        if (error) throw error; res.json(data);
    } catch (error) { sendError(res, 500, 'Fout bij ophalen lessen.', error.message, req); }
});

app.get('/api/lessen/:lessonId/details-for-attendance', async (req, res) => {
    const { lessonId } = req.params; if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
    try {
        const { data: lesson, error: lessonError } = await supabase.from('lessen').select(`id, les_datum, onderwerp, is_geannuleerd, moskee_id, klas_id, klas:klas_id (id, name, students:students (id, name, active))`).eq('id', lessonId).single();
        if (lessonError) throw lessonError; if (!lesson) return sendError(res, 404, "Les niet gevonden.", null, req);
        if (req.user.mosque_id !== lesson.moskee_id && req.user.role !== 'superadmin') return sendError(res, 403, "Geen toegang tot deze lesdetails.", null, req);
        // TODO: Verfijn: is req.user de leraar van lesson.klas_id of een admin?
        if (lesson.klas && lesson.klas.students) lesson.klas.students = lesson.klas.students.filter(s => s.active); res.json(lesson);
    } catch (error) { sendError(res, 500, 'Fout bij ophalen lesdetails.', error.message, req); }
});

app.post('/api/mosques/:mosqueId/classes/:classId/lessons', async (req, res) => {
    const { mosqueId, classId } = req.params; const { les_datum, onderwerp, notities_les, start_tijd, eind_tijd, is_geannuleerd = false } = req.body;
    if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
    if ((req.user.mosque_id !== mosqueId && req.user.role !== 'superadmin') || (req.user.role !== 'admin' && req.user.role !== 'teacher')) return sendError(res, 403, "Niet geautoriseerd om lessen aan te maken.", null, req);
    // TODO: Als rol 'teacher' is, check of req.user.id de teacher_id is van classId.
    if (!les_datum) return sendError(res, 400, "Les datum is verplicht.", null, req);
    try {
        const { data: existingLesson, error: checkError } = await supabase.from('lessen').select('id').eq('klas_id', classId).eq('les_datum', les_datum).maybeSingle();
        if (checkError && checkError.code !== 'PGRST116') { throw checkError; }
        if (existingLesson) return sendError(res, 409, `Er bestaat al een les voor klas op ${les_datum}.`, { existingLessonId: existingLesson.id }, req);
        const lesData = { moskee_id: mosqueId, klas_id: classId, les_datum, onderwerp, notities_les, start_tijd, eind_tijd, is_geannuleerd, les_dag_van_week: new Date(les_datum).toLocaleDateString('nl-NL', { weekday: 'long' }) };
        const { data: newLesson, error } = await supabase.from('lessen').insert(lesData).select().single();
        if (error) throw error; res.status(201).json({ success: true, message: 'Les aangemaakt.', data: newLesson });
    } catch (error) { sendError(res, 500, 'Fout bij aanmaken les.', error.message, req); }
});

app.put('/api/lessen/:lessonId', async (req, res) => {
    const { lessonId } = req.params; const { onderwerp, notities_les, start_tijd, eind_tijd, is_geannuleerd, les_datum } = req.body;
    if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
    try {
        const { data: lessonToUpdate, error: fetchError } = await supabase.from('lessen').select('klas_id, moskee_id').eq('id', lessonId).single();
        if (fetchError || !lessonToUpdate) return sendError(res, 404, "Les niet gevonden.", null, req);
        if ((req.user.mosque_id !== lessonToUpdate.moskee_id && req.user.role !== 'superadmin') || (req.user.role !== 'admin' && req.user.role !== 'teacher')) return sendError(res, 403, "Niet geautoriseerd om deze les te bewerken.", null, req);
        // TODO: Als rol 'teacher' is, check of req.user.id de leraar is van de klas (lessonToUpdate.klas_id).
        const updateData = { onderwerp, notities_les, start_tijd, eind_tijd, is_geannuleerd, les_datum, gewijzigd_op: new Date() };
        if (les_datum) updateData.les_dag_van_week = new Date(les_datum).toLocaleDateString('nl-NL', { weekday: 'long' });
        Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);
        const { data, error } = await supabase.from('lessen').update(updateData).eq('id', lessonId).select().single();
        if (error) throw error; res.json({ success: true, message: 'Les bijgewerkt.', data });
    } catch (error) { sendError(res, 500, 'Fout bij bijwerken les.', error.message, req); }
});

// --- ABSENTIE REGISTRATIES ---
app.post('/api/lessen/:lessonId/absenties', async (req, res) => {
    const { lessonId } = req.params; const absentieDataArray = req.body;
    if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req); const leraarIdDieOpslaat = req.user.id; 
    if (!Array.isArray(absentieDataArray)) return sendError(res, 400, "Absentie data moet een array zijn.", null, req);
    try {
        const { data: lesInfo, error: lesError } = await supabase.from('lessen').select('id, moskee_id, klas_id').eq('id', lessonId).single();
        if (lesError || !lesInfo) return sendError(res, 404, "Les niet gevonden.", lesError ? lesError.message : null, req);
        if ((req.user.mosque_id !== lesInfo.moskee_id && req.user.role !== 'superadmin') || (req.user.role !== 'admin' && req.user.role !== 'teacher')) return sendError(res, 403, "Niet geautoriseerd om absenties op te slaan.", null, req);
        // TODO: Als rol 'teacher' is, check of req.user.id de leraar is van de klas (lesInfo.klas_id).
        const recordsToUpsert = absentieDataArray.map(item => ({ les_id: lessonId, leerling_id: item.leerling_id, moskee_id: lesInfo.moskee_id, status: item.status, notities_absentie: item.notities_absentie, geregistreerd_door_leraar_id: leraarIdDieOpslaat, registratie_datum_tijd: new Date() }));
        const { data, error: upsertError } = await supabase.from('absentie_registraties').upsert(recordsToUpsert, { onConflict: 'les_id, leerling_id' }).select(`id, status, notities_absentie, leerling_id, leerling:leerling_id (name)`);
        if (upsertError) throw upsertError; res.status(200).json({ success: true, message: 'Absenties opgeslagen.', data });
    } catch (error) { sendError(res, 500, `Fout bij opslaan absenties.`, error.message, req); }
});

app.get('/api/lessen/:lessonId/absenties', async (req, res) => {
    const { lessonId } = req.params; if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
    try {
        const { data: lesInfo, error: lesFetchError } = await supabase.from('lessen').select('moskee_id, klas_id').eq('id', lessonId).single();
        if (lesFetchError || !lesInfo) return sendError(res, 404, "Les niet gevonden.", null, req);
        if (req.user.mosque_id !== lesInfo.moskee_id && req.user.role !== 'superadmin') return sendError(res, 403, "Geen toegang.", null, req);
        // TODO: Verfijn autorisatie: mag leraar/ouder dit zien?
        const { data, error } = await supabase.from('absentie_registraties').select(`id, status, notities_absentie, registratie_datum_tijd, leerling_id, leerling:leerling_id ( name ), geregistreerd_door_leraar_id, leraar:geregistreerd_door_leraar_id ( name )`).eq('les_id', lessonId);
        if (error) throw error; res.json(data);
    } catch (error) { sendError(res, 500, 'Fout bij ophalen absenties voor les.', error.message, req); }
});

app.get('/api/leerlingen/:studentId/absentiehistorie', async (req, res) => {
    const { studentId } = req.params; const { startDate, endDate, limit = 50 } = req.query;
    if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
    try {
        const {data: studentInfo, error: studentInfoError} = await supabase.from('students').select('mosque_id, parent_id, class_id').eq('id', studentId).single();
        if(studentInfoError || !studentInfo) return sendError(res, 404, "Leerling niet gevonden.", null, req);
        let authorized = false;
        if (req.user.role === 'superadmin') authorized = true;
        else if (req.user.mosque_id === studentInfo.mosque_id) { // Moet van dezelfde moskee zijn
            if (req.user.role === 'admin') authorized = true;
            else if (req.user.role === 'parent' && req.user.id === studentInfo.parent_id) authorized = true;
            else if (req.user.role === 'teacher') { 
                const {data: klasInfo} = await supabase.from('classes').select('teacher_id').eq('id', studentInfo.class_id).single(); 
                if (klasInfo && klasInfo.teacher_id === req.user.id) authorized = true; 
            }
        }
        if (!authorized) return sendError(res, 403, "Niet geautoriseerd om deze absentiehistorie te bekijken.", null, req);
        
        let query = supabase.from('absentie_registraties').select(`id, status, notities_absentie, registratie_datum_tijd, les:les_id ( les_datum, onderwerp, is_geannuleerd, klas:klas_id (name) )`).eq('leerling_id', studentId).order('les_datum', { foreignTable: 'lessen', ascending: false }).limit(parseInt(limit, 10));
        if (startDate || endDate) {
            const { data: lessonsInRange, error: lessonsError } = await supabase.from('lessen').select('id').eq('moskee_id', studentInfo.mosque_id).gte('les_datum', startDate || '1900-01-01').lte('les_datum', endDate || '2999-12-31');
            if (lessonsError) throw lessonsError; const lessonIdsInRange = lessonsInRange.map(l => l.id);
            if (lessonIdsInRange.length > 0) query = query.in('les_id', lessonIdsInRange); else return res.json([]);
        }
        const { data, error } = await query; if (error) throw error; res.json(data);
    } catch (error) { sendError(res, 500, 'Fout bij ophalen absentiehistorie leerling.', error.message, req); }
});
// Voeg deze endpoint toe aan je server.js - plaats het bij de andere absentie routes

// POST absentie statistieken voor specifieke leerlingen (voor ouders)
app.post('/api/mosques/:mosqueId/students/attendance-stats', async (req, res) => {
  try {
    const { mosqueId } = req.params;
    const { student_ids } = req.body;

    if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
      return sendError(res, 400, 'student_ids array is required', null, req);
    }

    // Controleer authenticatie
    if (!req.user) {
      return sendError(res, 401, "Authenticatie vereist.", null, req);
    }

    // Controleer of de gebruiker toegang heeft tot deze moskee
    if (req.user.mosque_id !== mosqueId) {
      return sendError(res, 403, 'Geen toegang tot deze moskee', null, req);
    }

    // Voor ouders: controleer of ze alleen hun eigen kinderen opvragen
    if (req.user.role === 'parent') {
      const { data: userStudents, error: studentsError } = await supabase
        .from('students')
        .select('id')
        .eq('parent_id', req.user.id)
        .eq('mosque_id', mosqueId);

      if (studentsError) throw studentsError;

      const userStudentIds = userStudents.map(s => s.id);
      const unauthorizedIds = student_ids.filter(id => !userStudentIds.includes(id));
      
      if (unauthorizedIds.length > 0) {
        return sendError(res, 403, 'Geen toegang tot alle opgevraagde leerlingen', null, req);
      }
    }

    // Haal absentie statistieken op met SQL aggregatie query
    const { data: attendanceData, error: attendanceError } = await supabase
      .from('absentie_registraties')
      .select(`
        leerling_id,
        status
      `)
      .eq('moskee_id', mosqueId)
      .in('leerling_id', student_ids);

    if (attendanceError) throw attendanceError;

    // Verwerk de data tot statistieken per leerling
    const stats = {};
    
    // Initialiseer statistieken voor elke leerling
    student_ids.forEach(studentId => {
      stats[studentId] = {
        aanwezig: 0,
        afwezig_ongeoorloofd: 0,
        afwezig_geoorloofd: 0,
        te_laat: 0
      };
    });

    // Tel de verschillende statussen
    attendanceData.forEach(record => {
      const studentId = record.leerling_id;
      const status = record.status;
      
      if (stats[studentId] && stats[studentId].hasOwnProperty(status)) {
        stats[studentId][status]++;
      }
    });

    console.log(`[API] Attendance stats computed for ${Object.keys(stats).length} students`);
    res.json(stats);

  } catch (error) {
    console.error('[API] Error fetching attendance stats:', error);
    sendError(res, 500, 'Fout bij ophalen van absentie statistieken', error.message, req);
  }
});

// Alternatieve endpoint voor meer gedetailleerde statistieken (optioneel)
app.get('/api/mosques/:mosqueId/students/:studentId/attendance-history', async (req, res) => {
  try {
    const { mosqueId, studentId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // Controleer authenticatie
    if (!req.user) {
      return sendError(res, 401, "Authenticatie vereist.", null, req);
    }

    // Controleer toegang
    if (req.user.mosque_id !== mosqueId) {
      return sendError(res, 403, 'Geen toegang tot deze moskee', null, req);
    }

    // Voor ouders: controleer of het hun kind is
    if (req.user.role === 'parent') {
      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('parent_id')
        .eq('id', studentId)
        .eq('mosque_id', mosqueId)
        .single();

      if (studentError || !student || student.parent_id !== req.user.id) {
        return sendError(res, 403, 'Geen toegang tot deze leerling', null, req);
      }
    }

    // Haal gedetailleerde absentie geschiedenis op
    const { data: attendanceHistory, error: historyError } = await supabase
      .from('absentie_registraties')
      .select(`
        *,
        lessen!inner (
          les_datum,
          onderwerp,
          classes!inner (
            name
          )
        )
      `)
      .eq('moskee_id', mosqueId)
      .eq('leerling_id', studentId)
      .order('registratie_datum_tijd', { ascending: false })
      .range(offset, offset + limit - 1);

    if (historyError) throw historyError;

    console.log(`[API] Attendance history retrieved: ${attendanceHistory.length} records for student ${studentId}`);
    res.json(attendanceHistory);

  } catch (error) {
    console.error('[API] Error fetching attendance history:', error);
    sendError(res, 500, 'Fout bij ophalen van absentie geschiedenis', error.message, req);
  }
});
// ==================================
// EINDE LESSEN & ABSENTIE ROUTES
// ==================================

// Voeg deze endpoints toe aan je server.js

// ===== LEERLING TOEVOEGEN DOOR LERAAR =====
app.post('/api/mosques/:mosqueId/students', async (req, res) => {
  try {
    const { mosqueId } = req.params;
    const { 
      name, 
      class_id, 
      date_of_birth, 
      notes, 
      parent_email, 
      added_by_teacher_id,
      active = true 
    } = req.body;

    console.log(`[POST /api/mosques/${mosqueId}/students] Teacher adding student:`, name);

    // Validatie
    if (!name || !class_id || !added_by_teacher_id) {
      return res.status(400).json({ 
        error: 'Naam, klas en leraar ID zijn verplicht' 
      });
    }

    // Verificeer dat de leraar eigenaar is van de klas
    const { data: classData, error: classError } = await supabase
      .from('classes')
      .select('id, name, teacher_id, mosque_id')
      .eq('id', class_id)
      .eq('mosque_id', mosqueId)
      .single();

    if (classError || !classData) {
      return res.status(404).json({ error: 'Klas niet gevonden' });
    }

    if (String(classData.teacher_id) !== String(added_by_teacher_id)) {
      return res.status(403).json({ 
        error: 'U kunt alleen leerlingen toevoegen aan uw eigen klassen' 
      });
    }

    // Zoek bestaande ouder op basis van email (optioneel)
    let parent_id = null;
    if (parent_email && parent_email.trim()) {
      const { data: existingParent } = await supabase
        .from('users')
        .select('id')
        .eq('email', parent_email.toLowerCase().trim())
        .eq('role', 'parent')
        .eq('mosque_id', mosqueId)
        .single();
      
      if (existingParent) {
        parent_id = existingParent.id;
        console.log(`[ADD STUDENT] Found existing parent for email: ${parent_email}`);
      }
    }

    // Voeg leerling toe
    const { data: newStudent, error: studentError } = await supabase
      .from('students')
      .insert({
        name: name.trim(),
        class_id,
        mosque_id: mosqueId,
        parent_id,
        date_of_birth: date_of_birth || null,
        notes: notes?.trim() || null,
        added_by_teacher_id,
        active,
        created_at: new Date()
      })
      .select('*')
      .single();

    if (studentError) {
      console.error('[ADD STUDENT] Database error:', studentError);
      return res.status(500).json({ 
        error: 'Kon leerling niet toevoegen: ' + studentError.message 
      });
    }

    console.log(`[ADD STUDENT] Student toegevoegd: ${newStudent.name} (ID: ${newStudent.id})`);

    res.json({
      success: true,
      data: newStudent,
      message: `Leerling ${newStudent.name} succesvol toegevoegd aan ${classData.name}`
    });

  } catch (error) {
    console.error('[ADD STUDENT] Error:', error);
    res.status(500).json({ error: 'Server fout bij toevoegen leerling' });
  }
});

// ===== QOR'AAN VOORTGANG OPHALEN =====
app.get('/api/mosques/:mosqueId/students/:studentId/quran-progress', async (req, res) => {
  try {
    const { mosqueId, studentId } = req.params;
    const userId = req.user.id;

    console.log(`[GET Quran Progress] User ${userId} requesting progress for student ${studentId}`);

    // Verificeer toegang: leraar van klas OF ouder van student
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select(`
        id, 
        name, 
        parent_id,
        class_id,
        classes!inner(teacher_id)
      `)
      .eq('id', studentId)
      .eq('mosque_id', mosqueId)
      .single();

    if (studentError || !student) {
      return res.status(404).json({ error: 'Leerling niet gevonden' });
    }

    // Check autorisatie
    const isTeacher = String(student.classes.teacher_id) === String(userId);
    const isParent = String(student.parent_id) === String(userId);

    if (!isTeacher && !isParent) {
      return res.status(403).json({ 
        error: 'Geen toegang tot voortgang van deze leerling' 
      });
    }

    // Haal Qor'aan voortgang op
    const { data: progress, error: progressError } = await supabase
      .from('quran_progress')
      .select('*')
      .eq('student_id', studentId)
      .order('soerah_number', { ascending: true });

    if (progressError) {
      console.error('[GET Quran Progress] Database error:', progressError);
      return res.status(500).json({ error: 'Kon voortgang niet laden' });
    }

    console.log(`[GET Quran Progress] Found ${progress?.length || 0} progress records for student ${studentId}`);
    res.json(progress || []);

  } catch (error) {
    console.error('[GET Quran Progress] Error:', error);
    res.status(500).json({ error: 'Server fout bij laden voortgang' });
  }
});
// NIEUWE ROUTE: Haal een specifiek rapport op voor een leerling
// CONTROLEER EN VERVANG DEZE ROUTES IN server.js

// NIEUWE ROUTE: Haal een specifiek rapport op voor een leerling
app.get('/api/students/:studentId/report', async (req, res) => {
    if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
    const { studentId } = req.params;
    const { period } = req.query; 

    if (!period) return sendError(res, 400, "Een rapport-periode is vereist.", null, req);

    try {
        const { data: studentInfo, error: studentError } = await supabase
            .from('students')
            .select('*, classes(teacher_id)') 
            .eq('id', studentId)
            .single();

        if (studentError || !studentInfo) {
            return sendError(res, 403, "Leerling niet gevonden of geen toegang.", studentError?.message, req);
        }

        const isTeacherOfClass = req.user.role === 'teacher' && studentInfo.classes?.teacher_id === req.user.id;
        const isParentOfStudent = req.user.role === 'parent' && studentInfo.parent_id === req.user.id;
        const isAdminOfMosque = req.user.role === 'admin' && studentInfo.mosque_id === req.user.mosque_id;

        if (!isTeacherOfClass && !isParentOfStudent && !isAdminOfMosque) {
            return sendError(res, 403, "Niet geautoriseerd om dit rapport te bekijken.", null, req);
        }

        const { data: report, error: reportError } = await supabase.from('student_reports').select('*').eq('student_id', studentId).eq('report_period', period).maybeSingle();
        if (reportError) throw reportError;

        const getCountForStatus = async (status) => {
            const { count, error } = await supabase.from('absentie_registraties').select('*', { count: 'exact', head: true }).eq('leerling_id', studentId).eq('status', status);
            if (error) throw error;
            return count || 0;
        };
        const [aanwezigCount, teLaatCount, geoorloofdCount, ongeoorloofdCount] = await Promise.all([ getCountForStatus('aanwezig'), getCountForStatus('te_laat'), getCountForStatus('afwezig_geoorloofd'), getCountForStatus('afwezig_ongeoorloofd') ]);
        const attendanceStats = { aanwezig: aanwezigCount, te_laat: teLaatCount, afwezig_geoorloofd: geoorloofdCount, afwezig_ongeoorloofd: ongeoorloofdCount };

        const finalResponse = { ...(report || { grades: {}, comments: '' }), attendanceStats: attendanceStats };
        res.json(finalResponse);

    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen van rapport data.', error.message, req);
    }
});


// NIEUWE ROUTE: Sla een rapport op (maakt aan of update)
app.post('/api/reports/save', async (req, res) => {
    if (!req.user || req.user.role !== 'teacher') return sendError(res, 403, "Alleen leraren mogen rapporten opslaan.", null, req);
    
    const { studentId, classId, mosqueId, period, grades, comments } = req.body;
    const teacherId = req.user.id;

    if (!studentId || !classId || !mosqueId || !period) return sendError(res, 400, "Verplichte velden voor opslaan rapport ontbreken.", null, req);

    try {
        const reportData = {
            student_id: studentId, class_id: classId, mosque_id: mosqueId, teacher_id: teacherId,
            report_period: period, grades: grades || {}, comments: comments || '', updated_at: new Date()
        };

        const { data, error } = await supabase.from('student_reports')
            .upsert(reportData, { onConflict: 'student_id, report_period' })
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, message: 'Rapport succesvol opgeslagen.', data });
    } catch (error) {
        sendError(res, 500, 'Fout bij opslaan van rapport.', error.message, req);
    }
});

app.post('/api/mosques/:mosqueId/students/attendance-stats', async (req, res) => {
  try {
    const { mosqueId } = req.params;
    const { student_ids } = req.body;

    if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
      return sendError(res, 400, 'student_ids array is required', null, req);
    }

    // Autorisatie checks (blijven ongewijzigd)
    if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
    if (req.user.mosque_id !== mosqueId) return sendError(res, 403, 'Geen toegang tot deze moskee', null, req);
    
    if (req.user.role === 'parent') {
      const { data: userStudents, error: studentsError } = await supabase.from('students').select('id').eq('parent_id', req.user.id);
      if (studentsError) throw studentsError;
      const userStudentIds = userStudents.map(s => s.id);
      if (student_ids.some(id => !userStudentIds.includes(id))) {
        return sendError(res, 403, 'Geen toegang tot alle opgevraagde leerlingen', null, req);
      }
    }

    // --- HIER BEGINT DE CORRECTIE ---

    const stats = {};

    // Een helper functie om de tellingen voor ÉÉN leerling op te halen
    const getStatsForStudent = async (studentId) => {
        const getCount = async (status) => {
            const { count, error } = await supabase
                .from('absentie_registraties')
                .select('*', { count: 'exact', head: true })
                .eq('leerling_id', studentId)
                .eq('status', status);
            if (error) throw error;
            return count || 0;
        };

        const [aanwezig, te_laat, afwezig_geoorloofd, afwezig_ongeoorloofd] = await Promise.all([
            getCount('aanwezig'),
            getCount('te_laat'),
            getCount('afwezig_geoorloofd'),
            getCount('afwezig_ongeoorloofd')
        ]);
        
        return { aanwezig, te_laat, afwezig_geoorloofd, afwezig_ongeoorloofd };
    };

    // Voer de statistiek-ophaling voor alle gevraagde studenten parallel uit
    await Promise.all(student_ids.map(async (studentId) => {
        stats[studentId] = await getStatsForStudent(studentId);
    }));

    // --- EINDE CORRECTIE ---

    console.log(`[API] Correct attendance stats computed for ${Object.keys(stats).length} students`);
    res.json(stats);

  } catch (error) {
    console.error('[API] Error fetching attendance stats:', error);
    sendError(res, 500, 'Fout bij ophalen van absentie statistieken', error.message, req);
  }
});
// ===== QOR'AAN VOORTGANG BIJWERKEN =====
app.post('/api/mosques/:mosqueId/students/:studentId/quran-progress', async (req, res) => {
  try {
    const { mosqueId, studentId } = req.params;
    const { 
      soerah_number, 
      soerah_name, 
      status, 
      updated_by_teacher_id, 
      notes 
    } = req.body;
    const userId = req.user.id;

    console.log(`[UPDATE Quran Progress] Teacher ${userId} updating soerah ${soerah_number} for student ${studentId} to status: ${status}`);

    // Validatie
    if (!soerah_number || !soerah_name || !status) {
      return res.status(400).json({ 
        error: 'Soerah nummer, naam en status zijn verplicht' 
      });
    }

    if (!['niet_begonnen', 'bezig', 'voltooid', 'herhaling'].includes(status)) {
      return res.status(400).json({ error: 'Ongeldige status' });
    }

    // Verificeer dat leraar toegang heeft tot deze leerling
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select(`
        id, 
        name, 
        class_id,
        classes!inner(teacher_id)
      `)
      .eq('id', studentId)
      .eq('mosque_id', mosqueId)
      .single();

    if (studentError || !student) {
      return res.status(404).json({ error: 'Leerling niet gevonden' });
    }

    if (String(student.classes.teacher_id) !== String(userId)) {
      return res.status(403).json({ 
        error: 'U kunt alleen voortgang bijwerken voor leerlingen in uw eigen klassen' 
      });
    }

    // Bepaal date_completed
    let date_completed = null;
    if (status === 'voltooid') {
      date_completed = new Date().toISOString().split('T')[0]; // Vandaag
    }

    // UPSERT: Update bestaand record of maak nieuw aan
    const { data: updatedProgress, error: progressError } = await supabase
      .from('quran_progress')
      .upsert({
        student_id: studentId,
        soerah_number: parseInt(soerah_number),
        soerah_name: soerah_name.trim(),
        status,
        date_completed,
        notes: notes?.trim() || null,
        updated_by_teacher_id: userId,
        updated_at: new Date()
      }, {
        onConflict: 'student_id,soerah_number'
      })
      .select('*')
      .single();

    if (progressError) {
      console.error('[UPDATE Quran Progress] Database error:', progressError);
      return res.status(500).json({ 
        error: 'Kon voortgang niet bijwerken: ' + progressError.message 
      });
    }

    console.log(`[UPDATE Quran Progress] Updated soerah ${soerah_number} for student ${student.name} to ${status}`);

    res.json({
      success: true,
      data: updatedProgress,
      message: `Voortgang bijgewerkt: ${soerah_name} - ${status}`
    });

  } catch (error) {
    console.error('[UPDATE Quran Progress] Error:', error);
    res.status(500).json({ error: 'Server fout bij bijwerken voortgang' });
  }
});

// ===== BULK QOR'AAN STATISTIEKEN VOOR OUDERS =====
app.post('/api/mosques/:mosqueId/students/quran-stats', async (req, res) => {
  try {
    const { mosqueId } = req.params;
    const { student_ids } = req.body;
    const userId = req.user.id;

    console.log(`[GET Quran Stats] Parent ${userId} requesting stats for ${student_ids?.length || 0} students`);

    if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({ error: 'student_ids array is required' });
    }

    // Verificeer dat gebruiker ouder is van alle opgevraagde leerlingen
    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('id, name, parent_id')
      .in('id', student_ids)
      .eq('mosque_id', mosqueId);

    if (studentsError) {
      return res.status(500).json({ error: 'Kon leerlingen niet laden' });
    }

    // Check dat alle leerlingen bij deze ouder horen
    const invalidStudents = students.filter(s => String(s.parent_id) !== String(userId));
    if (invalidStudents.length > 0) {
      return res.status(403).json({ 
        error: 'Geen toegang tot alle opgevraagde leerlingen' 
      });
    }

    // Haal statistieken op voor elke leerling
    const stats = {};
    
    for (const studentId of student_ids) {
      const { data: progress, error: progressError } = await supabase
        .from('quran_progress')
        .select('status, date_completed, soerah_name')
        .eq('student_id', studentId);

      if (progressError) {
        console.error(`Error fetching progress for student ${studentId}:`, progressError);
        stats[studentId] = null;
        continue;
      }

      const total_soerahs = 55; // Van Al-Modjaadalah tot Al-Fatiha
      const completed = progress?.filter(p => p.status === 'voltooid').length || 0;
      const in_progress = progress?.filter(p => p.status === 'bezig').length || 0;
      const reviewing = progress?.filter(p => p.status === 'herhaling').length || 0;
      const completion_percentage = Math.round((completed / total_soerahs) * 100);

      // Laatste voltooide soera
      const lastCompleted = progress
        ?.filter(p => p.status === 'voltooid' && p.date_completed)
        .sort((a, b) => new Date(b.date_completed) - new Date(a.date_completed))[0];

      stats[studentId] = {
        total_soerahs,
        completed,
        in_progress,
        reviewing,
        completion_percentage,
        last_completed: lastCompleted ? {
          soerah_name: lastCompleted.soerah_name,
          date_completed: lastCompleted.date_completed
        } : null
      };
    }

    console.log(`[GET Quran Stats] Returning stats for ${Object.keys(stats).length} students`);
    res.json(stats);

  } catch (error) {
    console.error('[GET Quran Stats] Error:', error);
    res.status(500).json({ error: 'Server fout bij laden statistieken' });
  }
});

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

// NIEUWE ROUTE: Verstuur email naar een specifieke ouder
app.post('/api/email/send-to-parent', async (req, res) => {
    if (!req.user || req.user.role !== 'teacher') return sendError(res, 403, "Alleen leraren mogen deze actie uitvoeren.", null, req);

    const { recipientUserId, subject, body } = req.body;
    const sender = req.user; // De ingelogde leraar

    if (!recipientUserId || !subject || !body) return sendError(res, 400, "Ontvanger, onderwerp en bericht zijn verplicht.", null, req);
    
    try {
        const { data: recipient, error: userError } = await supabase.from('users').select('id, email, name, mosque_id').eq('id', recipientUserId).single();
        if (userError || !recipient) return sendError(res, 404, "Ontvanger niet gevonden.", null, req);
        if (recipient.mosque_id !== sender.mosque_id) return sendError(res, 403, "U kunt alleen mailen binnen uw eigen moskee.", null, req);

        const emailBodyHtml = `
            <p>Beste ${recipient.name},</p>
            <p>U heeft een bericht ontvangen van leraar ${sender.name}:</p>
            <div style="border-left: 2px solid #ccc; padding-left: 1rem; margin: 1rem 0;">${body.replace(/\n/g, '<br>')}</div>
            <p>Met vriendelijke groet,<br>Het team van MijnLVS</p>
        `;
        
        const emailResult = await sendM365EmailInternal({ to: recipient.email, subject, body: emailBodyHtml, mosqueId: sender.mosque_id, emailType: 'm365_teacher_to_parent_email' });

        if (emailResult.success) {
            res.json({ success: true, message: `Email succesvol verstuurd naar ${recipient.name}.` });
        } else {
            sendError(res, 500, `Email versturen mislukt: ${emailResult.error}`, emailResult.details, req);
        }
    } catch (error) {
        sendError(res, 500, 'Onverwachte serverfout bij versturen van e-mail.', error.message, req);
    }
});

// NIEUWE ROUTE: Verstuur bulk email naar een hele klas
app.post('/api/email/send-to-class', async (req, res) => {
    if (!req.user || req.user.role !== 'teacher') return sendError(res, 403, "Alleen leraren mogen deze actie uitvoeren.", null, req);

    const { classId, subject, body } = req.body;
    const sender = req.user;

    if (!classId || !subject || !body) return sendError(res, 400, "Klas ID, onderwerp en bericht zijn verplicht.", null, req);

    try {
        // Verifieer dat de leraar eigenaar is van de klas
        const { data: classInfo, error: classError } = await supabase.from('classes').select('id, name, teacher_id, mosque_id').eq('id', classId).single();
        if (classError || !classInfo) return sendError(res, 404, "Klas niet gevonden.", null, req);
        if (classInfo.teacher_id !== sender.id) return sendError(res, 403, "U kunt alleen mailen naar uw eigen klassen.", null, req);

        // Haal alle ouders van de leerlingen in deze klas op
        const { data: parents, error: parentsError } = await supabase.rpc('get_parents_of_class', { p_class_id: classId });
        if (parentsError) throw parentsError;
        if (!parents || parents.length === 0) return sendError(res, 404, "Geen ouders gevonden voor deze klas.", null, req);

        const emailBodyHtml = `
            <p>Beste ouders/verzorgers van ${classInfo.name},</p>
            <p>U heeft een bericht ontvangen van leraar ${sender.name}:</p>
            <div style="border-left: 2px solid #ccc; padding-left: 1rem; margin: 1rem 0;">${body.replace(/\n/g, '<br>')}</div>
            <p>Met vriendelijke groet,<br>Het team van MijnLVS</p>
        `;

        // Verstuur de e-mails asynchroon
        const emailPromises = parents.map(parent => 
            sendM365EmailInternal({
                to: parent.email,
                subject: `Bericht voor ${classInfo.name}: ${subject}`,
                body: emailBodyHtml,
                mosqueId: sender.mosque_id,
                emailType: 'm365_teacher_to_class_bulk'
            })
        );
        const results = await Promise.all(emailPromises);
        const successes = results.filter(r => r.success).length;
        const failures = results.filter(r => !r.success).length;

        res.json({ success: true, message: `Verstuur-opdracht voltooid. ${successes} email(s) succesvol verstuurd, ${failures} mislukt.` });

    } catch (error) {
        sendError(res, 500, 'Onverwachte serverfout bij versturen van bulk-email.', error.message, req);
    }
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
      'GET /api/mosques/:mosqueId/classes/:classId/lessons',
      'GET /api/lessen/:lessonId/details-for-attendance',
      'POST /api/mosques/:mosqueId/classes/:classId/lessons',
      'PUT /api/lessen/:lessonId',
      'POST /api/lessen/:lessonId/absenties',
      'GET /api/lessen/:lessonId/absenties',
      'GET /api/leerlingen/:studentId/absentiehistorie',
      'POST /api/send-email-m365',
      'POST /api/mosques/:mosqueId/students',
      'GET /api/mosques/:mosqueId/students/:studentId/quran-progress', 
      'POST /api/mosques/:mosqueId/students/:studentId/quran-progress',
      'POST /api/mosques/:mosqueId/students/quran-stats'
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
