// server.js - Complete backend met Supabase database integratie
// Versie: 2.2.0 - Railway + Supabase Compatible + CRUD + Configureerbare Staffel (All-Inclusive)
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
    if (error) console.error("❌ [DB STARTUP TEST] Supabase query FAILED. Error object:", JSON.stringify(error, null, 2));
    else {
      console.log(`✅ [DB STARTUP TEST] Supabase query SUCCEEDED. Found ${count === null ? 'unknown (check RLS/permissions)' : count} mosque(s). Sample data:`, data);
      if ((count === 0 || (data && data.length === 0)) && count !== null) console.warn("⚠️ [DB STARTUP TEST] No mosques found. Ensure 'mosques' table has data and service_role has access.");
    }
  } catch (e) { console.error("❌ [DB STARTUP TEST] Supabase query FAILED (outer catch):", e.message, e); }
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
    version: '2.2.0', // Versie update
    supabase_connection_test_result: 'Attempted at startup, check logs for [DB STARTUP TEST]'
  });
});

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

    const { data: existingAdmin } = await supabase.from('users').select('id').eq('email', normalizedAdminEmail).maybeSingle();
    if (existingAdmin) return sendError(res, 409, 'Dit emailadres is al geregistreerd.', null, req);

    const { data: newMosque, error: mosqueCreateError } = await supabase.from('mosques').insert([{
        name: mosqueName, subdomain: normalizedSubdomain, address, city, zipcode, phone,
        email: mosqueContactEmail || normalizedAdminEmail, website, m365_configured: false,
        contribution_1_child: 150, contribution_2_children: 300, contribution_3_children: 450,
        contribution_4_children: 450, contribution_5_plus_children: 450,
    }]).select().single();
    if (mosqueCreateError) throw mosqueCreateError;

    const password_hash = await bcrypt.hash(adminPassword, 10);
    const { data: newAdmin, error: adminCreateError } = await supabase.from('users').insert([{ mosque_id: newMosque.id, email: normalizedAdminEmail, password_hash, name: adminName, role: 'admin', is_temporary_password: false }]).select('id, email, name, role').single();
    if (adminCreateError) { await supabase.from('mosques').delete().eq('id', newMosque.id); throw adminCreateError; }
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
    // Selecteer alle kolommen, inclusief de nieuwe contribution_ velden
    const { data: mosque, error } = await supabase.from('mosques').select('*').eq('subdomain', subdomain.toLowerCase().trim()).single();
    if (error || !mosque) return sendError(res, 404, 'Moskee niet gevonden.', null, req);
    res.json(mosque);
  } catch (error) {
    sendError(res, 500, 'Fout bij ophalen moskee.', error.message, req);
  }
});

app.put('/api/mosques/:mosqueId', async (req, res) => {
    try {
        const { mosqueId } = req.params;
        // Haal alle mogelijke velden op die geüpdatet kunnen worden voor basisinfo
        const { name, address, city, zipcode, phone, email, website } = req.body;
        if (!name) return sendError(res, 400, "Moskeenaam is verplicht.", null, req);
        const updatePayload = { name, address, city, zipcode, phone, email, website, updated_at: new Date() };
        // Verwijder undefined keys om te voorkomen dat je nulls naar de DB stuurt waar je dat niet wilt
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
        const updatePayload = { m365_tenant_id, m365_client_id, m365_sender_email, m365_configured: !!m365_configured, updated_at: new Date() };
        if (m365_client_secret && m365_client_secret.trim() !== '') {
            updatePayload.m365_client_secret = m365_client_secret; // Onthoud: encrypteren in productie!
        }
        const { data, error } = await supabase.from('mosques').update(updatePayload).eq('id', mosqueId).select('id, m365_tenant_id, m365_client_id, m365_sender_email, m365_configured').single();
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

// Helper functie voor het berekenen van amount_due gebaseerd op staffel
const calculateAmountDueFromStaffel = (childCount, mosqueSettings) => {
    if (!mosqueSettings) {
        console.warn("[WARN] calculateAmountDueFromStaffel: mosqueSettings is undefined, using hardcoded fallbacks (150/kind, max 450).");
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
            // Voorkom dat amount_due direct via user update wordt gewijzigd voor ouders
            if (tableName === 'users' && req.body.role === 'parent') { // Check role uit originele body, niet updateData
                 delete updateData.amount_due;
            }
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

createCrudEndpoints('users', 'id, mosque_id, email, name, role, phone, address, city, zipcode, amount_due, created_at');
createCrudEndpoints('classes', '*, teacher:teacher_id(id, name), students(count)');
createCrudEndpoints('students', '*, parent:parent_id(id, name, email, phone, amount_due), class:class_id(id, name, teacher_id, teacher:teacher_id(name))');
createCrudEndpoints('payments', '*, parent:parent_id(id, name, email), student:student_id(id, name), processed_by_user:processed_by(name)');

// ======================
// SPECIFIC POST ROUTES
// ======================
app.post('/api/users', async (req, res) => {
  try {
    const { mosque_id, email, name, role, phone, address, city, zipcode, password /* amount_due wordt hier niet meer verwacht */ } = req.body;
    if (!mosque_id || !email || !name || !role || !password) return sendError(res, 400, "Mosque ID, email, name, role, and password zijn verplicht.", null, req);
    const password_hash = await bcrypt.hash(password, 10);
    const userData = { mosque_id, email: email.toLowerCase().trim(), password_hash, name, role, is_temporary_password: true, phone, address, city, zipcode, amount_due: role === 'parent' ? 0 : null };
    const { data: user, error } = await supabase.from('users').insert([userData]).select('id, email, name, role, phone, address, city, zipcode, amount_due, created_at, mosque_id').single();
    if (error) throw error;
    res.status(201).json({ success: true, user });
  } catch (error) { sendError(res, error.code === '23505' ? 409 : 500, error.message || 'Fout bij aanmaken gebruiker.', error.details, req); }
});

app.post('/api/classes', async (req, res) => {
  try {
    const { mosque_id, name, teacher_id, description } = req.body;
    if (!mosque_id || !name || !teacher_id ) return sendError(res, 400, "Mosque ID, class name, and teacher ID zijn verplicht.", null, req);
    const { data: classData, error } = await supabase.from('classes').insert([{ mosque_id, name, teacher_id, description }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, class: classData });
  } catch (error) { sendError(res, 500, 'Fout bij aanmaken klas.', error.message, req); }
});

app.post('/api/students', async (req, res) => {
  try {
    const { mosque_id, parent_id, class_id, name, date_of_birth, emergency_contact, emergency_phone, notes } = req.body;
    if (!mosque_id || !parent_id || !class_id || !name) return sendError(res, 400, "Verplichte velden voor student ontbreken.", null, req);
    const { data: student, error } = await supabase.from('students').insert([{ mosque_id, parent_id, class_id, name, date_of_birth, emergency_contact, emergency_phone, notes }]).select().single();
    if (error) throw error;
    const { data: mosqueSettings } = await supabase.from('mosques').select('contribution_1_child, contribution_2_children, contribution_3_children, contribution_4_children, contribution_5_plus_children').eq('id', mosque_id).single();
    if (!mosqueSettings) console.warn(`[WARN] Geen staffel instellingen voor moskee ${mosque_id}. Amount_due wordt mogelijk niet correct berekend.`);
    const { count: siblingCount } = await supabase.from('students').select('id', { count: 'exact' }).eq('parent_id', parent_id).eq('active', true);
    const newAmountDue = calculateAmountDueFromStaffel(siblingCount || 0, mosqueSettings);
    await supabase.from('users').update({ amount_due: newAmountDue }).eq('id', parent_id);
    res.status(201).json({ success: true, student });
  } catch (error) { sendError(res, 500, 'Fout bij aanmaken leerling.', error.message, req); }
});

app.post('/api/payments', async (req, res) => {
  try {
    const { mosque_id, parent_id, student_id, amount, payment_method, payment_date, description, notes, processed_by } = req.body;
    if (!mosque_id || !parent_id || !amount || !payment_method || !payment_date) return sendError(res, 400, "Verplichte velden voor betaling ontbreken.", null, req);
    const { data: payment, error } = await supabase.from('payments').insert([{ mosque_id, parent_id, student_id, amount, payment_method, payment_date, description, notes, processed_by }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, payment });
  } catch (error) { sendError(res, 500, 'Fout bij aanmaken betaling.', error.message, req); }
});

// ======================
// EMAIL & CONFIG ROUTES
// ======================
app.post('/api/send-email-m365', async (req, res) => {
  try {
    const { tenantId, clientId, clientSecret, to, subject, body, mosqueName } = req.body;
    if (!tenantId || !clientId || !clientSecret || !to || !subject || !body) return sendError(res, 400, 'M365 email: Vereiste velden ontbreken.', null, req);
    const tokenResponse = await axios.post( `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials'}), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const accessToken = tokenResponse.data.access_token;
    let senderToUse = process.env.M365_SENDER_EMAIL || 'fallback_sender@example.com'; // Gebruik een neutrale fallback
    if (mosqueName) {
        const { data: mosqueFromDb } = await supabase.from('mosques').select('m365_sender_email').eq('name', mosqueName).single();
        if (mosqueFromDb && mosqueFromDb.m365_sender_email) senderToUse = mosqueFromDb.m365_sender_email;
        else console.warn(`[M365 Email] Geen m365_sender_email gevonden voor moskee "${mosqueName}", gebruik fallback: ${senderToUse}`);
    } else {
        console.warn(`[M365 Email] Geen mosqueName meegegeven, gebruik default fallback sender: ${senderToUse}`);
    }
    console.log(`📤 Sending M365 email from: ${senderToUse} to: ${to}...`);
    const emailResponse = await axios.post( `https://graph.microsoft.com/v1.0/users/${senderToUse}/sendMail`, { message: { subject, body: { contentType: 'Text', content: body }, toRecipients: [{ emailAddress: { address: to } }] } }, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    // Log email
    if (mosqueName) {
      const { data: mosque } = await supabase.from('mosques').select('id').eq('name', mosqueName).single();
      if (mosque) {
        await supabase.from('email_logs').insert([{ mosque_id: mosque.id, recipient_email: to, subject, body, email_type: 'api_triggered', sent_status: 'sent', microsoft_message_id: emailResponse.headers['request-id'], sent_at: new Date() }]);
      }
    }
    res.json({ success: true, messageId: emailResponse.headers['request-id'] || 'sent_' + Date.now(), service: 'Microsoft Graph API', sender: senderToUse });
  } catch (error) { sendError(res, 500, `M365 email send error: ${error.response?.data?.error?.message || error.message}`, error.response?.data, req); }
});

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
      'PUT /api/mosques/:mosqueId/m365-settings', 'PUT /api/mosques/:mosqueId/contribution-settings', // Nieuwe route toegevoegd
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
  console.log(`🚀 Moskee Backend API v2.2.0 running on port ${PORT}`);
  console.log(`🔗 Base URL for API: (Your Railway public URL)`);
  console.log(`🗄️ Supabase Project URL: ${supabaseUrl ? supabaseUrl.split('.')[0] + '.supabase.co' : 'Not configured'}`);
  if (process.env.NODE_ENV !== 'production') {
    console.warn("⚠️ Running in development mode. Detailed errors might be exposed.");
  }
});

module.exports = app;