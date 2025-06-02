// server.js - Complete backend met Supabase database integratie
// Versie: 2.1.1 - Railway + Supabase Compatible + CRUD + Startup DB Test
const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Voor M365 email
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase initialization
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // Gebruik SERVICE KEY voor backend operations

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required.");
  console.log("SUPABASE_URL in env:", supabaseUrl);
  console.log("SUPABASE_SERVICE_KEY in env (length):", supabaseKey ? supabaseKey.length : "NOT SET");
  process.exit(1); // Stop server als Supabase niet geconfigureerd is
}
const supabase = createClient(supabaseUrl, supabaseKey);

// DIRECTE CONNECTIVITEITSTEST (tijdelijk, draait bij server start)
async function testSupabaseConnection() {
  console.log("🚦 [DB STARTUP TEST] Attempting a simple query to Supabase...");
  try {
    // Query een tabel waarvan je weet dat die bestaat en data bevat, of een systeemtabel.
    // 'mosques' is een goede kandidaat als je er minstens één hebt.
    const { data, error, count } = await supabase
      .from('mosques') // Gebruik een tabel die zeker bestaat
      .select('id', { count: 'exact' }) // Vraag alleen ID's en het totaal aantal op
      .limit(1); // We hebben maar 1 record nodig om de verbinding te testen

    if (error) {
      console.error("❌ [DB STARTUP TEST] Supabase query FAILED. Error object:", JSON.stringify(error, null, 2));
    } else {
      console.log(`✅ [DB STARTUP TEST] Supabase query SUCCEEDED. Found ${count} mosque(s). Sample data (limit 1):`, data);
      if (count === 0) {
          console.warn("⚠️ [DB STARTUP TEST] Query succeeded but no mosques found. Ensure your 'mosques' table has data for proper testing of other routes.");
      }
    }
  } catch (e) {
    // Deze catch block wordt geraakt als createClient zelf al een error gooit of de await faalt op een dieper niveau
    console.error("❌ [DB STARTUP TEST] Supabase connection/query FAILED (outer catch block):", e.message);
    console.error("Full error object:", e);
  }
}
// Roep de test aan bij het starten van de server.
// Doe dit *nadat* de supabase client is geïnitialiseerd.
testSupabaseConnection();
// EINDE DIRECTE CONNECTIVITEITSTEST


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

// Helper voor consistente error response
const sendError = (res, statusCode, message, details = null) => {
  console.error(`Error ${statusCode} in ${req.method} ${req.originalUrl}: ${message}`, details || ''); // req toegevoegd voor context
  res.status(statusCode).json({ success: false, error: message, details });
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    version: '2.1.1',
    supabase_connection: 'Attempted at startup, check logs for [DB STARTUP TEST]'
  });
});

// ======================
// AUTHENTICATION ROUTES
// ======================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, subdomain } = req.body;
    if (!email || !password || !subdomain) {
      return sendError(res, 400, 'Email, password, and subdomain are required.');
    }
    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedEmail = email.toLowerCase().trim();

    const { data: mosque, error: mosqueError } = await supabase.from('mosques').select('id').eq('subdomain', normalizedSubdomain).single();
    if (mosqueError || !mosque) return sendError(res, 404, `Moskee met subdomein '${normalizedSubdomain}' niet gevonden.`);

    const { data: user, error: userError } = await supabase.from('users').select('*').eq('email', normalizedEmail).eq('mosque_id', mosque.id).single();
    if (userError || !user) return sendError(res, 401, 'Ongeldige combinatie van email/wachtwoord of gebruiker niet gevonden voor deze moskee.');

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return sendError(res, 401, 'Ongeldige combinatie van email/wachtwoord.');

    supabase.from('users').update({ last_login: new Date() }).eq('id', user.id).then(({error}) => { if(error) console.error("Error updating last_login:", error)});
    const { password_hash, ...userWithoutPassword } = user;
    res.json({ success: true, user: userWithoutPassword });
  } catch (error) {
    sendError(res, 500, 'Interne serverfout tijdens login.', error.message);
  }
});

// ======================
// REGISTRATION ROUTE
// ======================
app.post('/api/mosques/register', async (req, res) => {
  try {
    const { mosqueName, subdomain, adminName, adminEmail, adminPassword, address, city, zipcode, phone, website, email: mosqueContactEmail } = req.body;
    if (!mosqueName || !subdomain || !adminName || !adminEmail || !adminPassword) return sendError(res, 400, 'Verplichte registratievelden ontbreken.');
    if (adminPassword.length < 8) return sendError(res, 400, 'Admin wachtwoord moet minimaal 8 karakters lang zijn.');

    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedAdminEmail = adminEmail.toLowerCase().trim();

    const { data: existingSubdomain } = await supabase.from('mosques').select('id').eq('subdomain', normalizedSubdomain).maybeSingle();
    if (existingSubdomain) return sendError(res, 409, 'Dit subdomein is al in gebruik.');

    const { data: existingAdmin } = await supabase.from('users').select('id').eq('email', normalizedAdminEmail).maybeSingle();
    if (existingAdmin) return sendError(res, 409, 'Dit emailadres is al geregistreerd.');

    const { data: newMosque, error: mosqueCreateError } = await supabase.from('mosques').insert([{ name: mosqueName, subdomain: normalizedSubdomain, address, city, zipcode, phone, email: mosqueContactEmail || normalizedAdminEmail, website, m365_configured: false }]).select().single();
    if (mosqueCreateError) throw mosqueCreateError;

    const password_hash = await bcrypt.hash(adminPassword, 10);
    const { data: newAdmin, error: adminCreateError } = await supabase.from('users').insert([{ mosque_id: newMosque.id, email: normalizedAdminEmail, password_hash, name: adminName, role: 'admin', is_temporary_password: false }]).select('id, email, name, role').single();
    if (adminCreateError) {
      await supabase.from('mosques').delete().eq('id', newMosque.id); // Rollback
      throw adminCreateError;
    }
    res.status(201).json({ success: true, message: 'Registratie succesvol!', mosque: newMosque, admin: newAdmin });
  } catch (error) {
    sendError(res, error.code === '23505' ? 409 : (error.status || 400), error.message || 'Fout bij registratie.', error.details || error.hint || error);
  }
});

// ======================
// MOSQUE ROUTES (naast registratie)
// ======================
app.get('/api/mosque/:subdomain', async (req, res) => {
  try {
    const { subdomain } = req.params;
    const { data: mosque, error } = await supabase.from('mosques').select('*').eq('subdomain', subdomain.toLowerCase().trim()).single();
    if (error || !mosque) return sendError(res, 404, 'Moskee niet gevonden.');
    res.json(mosque); // Stuurt het volledige mosque object
  } catch (error) {
    sendError(res, 500, 'Fout bij ophalen moskee.', error.message);
  }
});

app.put('/api/mosques/:mosqueId', async (req, res) => {
    try {
        const { mosqueId } = req.params;
        const { name, address, city, zipcode, phone, email, website } = req.body;
        if (!name) return sendError(res, 400, "Moskeenaam is verplicht.");
        const { data, error } = await supabase.from('mosques').update({ name, address, city, zipcode, phone, email, website, updated_at: new Date() }).eq('id', mosqueId).select().single();
        if (error) throw error;
        res.json({ success: true, message: "Moskeegegevens bijgewerkt.", data });
    } catch (error) {
        sendError(res, 500, "Fout bij bijwerken moskeegegevens.", error.message);
    }
});

app.put('/api/mosques/:mosqueId/m365-settings', async (req, res) => {
    try {
        const { mosqueId } = req.params;
        const { m365_tenant_id, m365_client_id, m365_client_secret, m365_sender_email, m365_configured } = req.body;
        const updatePayload = { m365_tenant_id, m365_client_id, m365_sender_email, m365_configured: !!m365_configured, updated_at: new Date() };
        if (m365_client_secret && m365_client_secret.trim() !== '') {
            // In een echte productie-app zou je dit encrypteren of Supabase Vault gebruiken.
            updatePayload.m365_client_secret = m365_client_secret;
        }
        const { data, error } = await supabase.from('mosques').update(updatePayload).eq('id', mosqueId).select('id, m365_tenant_id, m365_client_id, m365_sender_email, m365_configured').single();
        if (error) throw error;
        res.json({ success: true, message: "M365 instellingen bijgewerkt.", data });
    } catch (error) {
        sendError(res, 500, "Fout bij bijwerken M365 instellingen.", error.message);
    }
});

// ======================
// GENERIC CRUD HELPER & ENDPOINTS
// ======================
const createCrudEndpoints = (tableName, selectString = '*', singularNameOverride = null) => {
    const singularName = singularNameOverride || tableName.slice(0, -1);

    app.get(`/api/mosques/:mosqueId/${tableName}`, async (req, res) => {
        try {
            const { mosqueId } = req.params;
            // Voeg role filter toe voor 'users' tabel als meegegeven
            let query = supabase.from(tableName).select(selectString).eq('mosque_id', mosqueId);
            if (tableName === 'users' && req.query.role) {
                query = query.eq('role', req.query.role);
            }
             if (tableName === 'classes' || tableName === 'students') { // Voorbeeld: alleen actieve
                query = query.eq('active', true);
            }
            query = query.order('created_at', { ascending: false });

            const { data, error } = await query;
            if (error) throw error;
            res.json(data);
        } catch (error) {
            sendError(res, 500, `Fout bij ophalen ${tableName}.`, error.message);
        }
    });
    
    app.get(`/api/${tableName}/:id`, async (req, res) => { /* ... GET one ... */ }); // Behoud als nodig

    app.put(`/api/${tableName}/:id`, async (req, res) => {
        try {
            const { id } = req.params;
            const updateData = { ...req.body, updated_at: new Date() };
            delete updateData.mosque_id; delete updateData.id; delete updateData.created_at;

            if (tableName === 'users' && updateData.password) {
                updateData.password_hash = await bcrypt.hash(updateData.password, 10);
                delete updateData.password;
                updateData.is_temporary_password = false;
            } else if (tableName === 'users') {
                delete updateData.password_hash; // Voorkom overschrijven met null als wachtwoord niet wordt geupdate
            }

            const { data, error } = await supabase.from(tableName).update(updateData).eq('id', id).select(selectString).single();
            if (error) throw error;
            res.json({ success: true, message: `${singularName} bijgewerkt.`, [singularName]: data });
        } catch (error) {
            sendError(res, 500, `Fout bij bijwerken ${singularName}.`, error.message);
        }
    });
    
    app.delete(`/api/${tableName}/:id`, async (req, res) => {
        try {
            const { id } = req.params;
            if (tableName === 'students') {
                const { data: studentToDelete } = await supabase.from('students').select('parent_id').eq('id', id).single();
                const { error: deleteError } = await supabase.from(tableName).delete().eq('id', id);
                if (deleteError) throw deleteError;
                if (studentToDelete && studentToDelete.parent_id) {
                    const { data: siblings } = await supabase.from('students').select('id', { count: 'exact' }).eq('parent_id', studentToDelete.parent_id).eq('active', true);
                    const amountDue = Math.min((siblings?.length || 0) * 150, 450);
                    await supabase.from('users').update({ amount_due: amountDue }).eq('id', studentToDelete.parent_id);
                }
            } else {
                 const { error } = await supabase.from(tableName).delete().eq('id', id);
                 if (error) throw error;
            }
            res.status(200).json({ success: true, message: `${singularName} verwijderd.` });
        } catch (error) {
            sendError(res, 500, `Fout bij verwijderen ${singularName}.`, error.message);
        }
    });
};

// Definieer welke kolommen je wilt selecteren voor elke tabel
createCrudEndpoints('users', 'id, mosque_id, email, name, role, phone, address, city, zipcode, amount_due, created_at');
createCrudEndpoints('classes', '*, teacher:teacher_id(id, name), students(count)');
createCrudEndpoints('students', '*, parent:parent_id(id, name, email, phone), class:class_id(id, name, teacher_id, teacher:teacher_id(name))'); // Uitgebreider
createCrudEndpoints('payments', '*, parent:parent_id(id, name, email), student:student_id(id, name), processed_by_user:processed_by(name)');

// ======================
// SPECIFIC POST ROUTES (voor creatie met unieke logica)
// ======================
app.post('/api/users', async (req, res) => { /* ... behouden van vorige versie ... */ });
app.post('/api/classes', async (req, res) => { /* ... behouden ... */ });
app.post('/api/students', async (req, res) => { /* ... behouden ... */ });
app.post('/api/payments', async (req, res) => { /* ... behouden ... */ });

// ======================
// EMAIL & CONFIG ROUTES
// ======================
app.post('/api/send-email-m365', async (req, res) => { /* ... behouden ... */ });
app.get('/api/config-check', (req, res) => { /* ... behouden ... */ });

// Catch all undefined routes - update available_routes
app.use('*', (req, res) => {
  sendError(res, 404, 'Route not found.', { path: req.originalUrl, method: req.method, available_routes_summary: [ /* ... lijst updaten ... */ ]});
});

// Global error handling middleware
app.use((error, req, res, next) => { // 'next' is nodig voor Express error handlers
  console.error('❌ Unhandled Server Error:', error.stack || error);
  const message = process.env.NODE_ENV === 'production' && !error.status // Alleen generiek voor echte 500s
    ? 'Interne serverfout. Probeer het later opnieuw.'
    : error.message;
  res.status(error.status || 500).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { details: error.stack })
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Moskee Backend API v2.1.1 running on port ${PORT}`);
  console.log(`🔗 Base URL for API: (Your Railway public URL, typically https://project-name.up.railway.app)`);
  console.log(`🗄️ Supabase Project URL: ${supabaseUrl ? supabaseUrl.split('.')[0] + '.supabase.co' : 'Not configured'}`);
  if (process.env.NODE_ENV !== 'production') {
    console.warn("⚠️ Running in development mode. Detailed errors might be exposed.");
  }
});

module.exports = app;