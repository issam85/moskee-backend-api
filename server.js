// server.js - Complete backend met Supabase database integratie
// Versie: 2.1.0 - Railway + Supabase Compatible + CRUD
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
  console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required.");
  process.exit(1); // Stop server als Supabase niet geconfigureerd is
}
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://vercel.app',
    'https://*.vercel.app', // Toestaan van alle Vercel subdomeinen (wees voorzichtig hiermee)
    'https://moskee-systeem-iujmpp594-issams-projects-83c866b9.vercel.app', // Specifieke Vercel URL
    'https://mijnlvs.nl',
    'https://www.mijnlvs.nl',
    'https://al-noor.mijnlvs.nl',
    'https://al-hijra.mijnlvs.nl',
    // Voeg andere specifieke domeinen toe indien nodig
  ],
  credentials: true
}));
app.use(express.json()); // Voor het parsen van JSON request bodies

// Helper voor consistente error response
const sendError = (res, statusCode, message, details = null) => {
  console.error(`Error ${statusCode}: ${message}`, details || '');
  res.status(statusCode).json({ success: false, error: message, details });
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    version: '2.1.0', // Update versie
    supabase_connection: 'ok' // Simpele check, geen echte ping hier
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

    const { data: mosque, error: mosqueError } = await supabase
      .from('mosques')
      .select('id')
      .eq('subdomain', normalizedSubdomain)
      .single();

    if (mosqueError || !mosque) {
      return sendError(res, 404, `Moskee met subdomein '${normalizedSubdomain}' niet gevonden.`);
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*') // Selecteer alles voor nu, filter later
      .eq('email', normalizedEmail)
      .eq('mosque_id', mosque.id)
      .single();

    if (userError || !user) {
      return sendError(res, 401, 'Ongeldige combinatie van email/wachtwoord of gebruiker niet gevonden voor deze moskee.');
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return sendError(res, 401, 'Ongeldige combinatie van email/wachtwoord.');
    }

    // Update last login (fire and forget)
    supabase.from('users').update({ last_login: new Date() }).eq('id', user.id).then();

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
    const {
      mosqueName, subdomain, adminName, adminEmail, adminPassword,
      address, city, zipcode, phone, website, email: mosqueContactEmail // 'email' is contact email voor moskee
    } = req.body;

    if (!mosqueName || !subdomain || !adminName || !adminEmail || !adminPassword) {
      return sendError(res, 400, 'Verplichte registratievelden ontbreken (Moskeenaam, Subdomein, Admin Naam, Admin Email, Admin Wachtwoord).');
    }
    if (adminPassword.length < 8) {
      return sendError(res, 400, 'Admin wachtwoord moet minimaal 8 karakters lang zijn.');
    }

    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedAdminEmail = adminEmail.toLowerCase().trim();

    const { data: existingSubdomain, error: subdomainCheckError } = await supabase
      .from('mosques').select('id').eq('subdomain', normalizedSubdomain).maybeSingle();
    if (subdomainCheckError && subdomainCheckError.code !== 'PGRST116') throw subdomainCheckError;
    if (existingSubdomain) return sendError(res, 409, 'Dit subdomein is al in gebruik.'); // 409 Conflict

    const { data: existingAdmin, error: emailCheckError } = await supabase
      .from('users').select('id').eq('email', normalizedAdminEmail).maybeSingle();
    if (emailCheckError && emailCheckError.code !== 'PGRST116') throw emailCheckError;
    if (existingAdmin) return sendError(res, 409, 'Dit emailadres is al geregistreerd.');

    const { data: newMosque, error: mosqueCreateError } = await supabase
      .from('mosques')
      .insert([{
        name: mosqueName, subdomain: normalizedSubdomain, address, city, zipcode, phone,
        email: mosqueContactEmail || normalizedAdminEmail, // Contact email voor moskee
        website, m365_configured: false
      }])
      .select().single();
    if (mosqueCreateError) throw mosqueCreateError;

    const password_hash = await bcrypt.hash(adminPassword, 10);
    const { data: newAdmin, error: adminCreateError } = await supabase
      .from('users')
      .insert([{
        mosque_id: newMosque.id, email: normalizedAdminEmail, password_hash, name: adminName,
        role: 'admin', is_temporary_password: false
      }])
      .select('id, email, name, role').single();
    if (adminCreateError) {
      // Probeer moskee te verwijderen als admin creatie faalt (simpele rollback)
      await supabase.from('mosques').delete().eq('id', newMosque.id);
      throw adminCreateError;
    }

    res.status(201).json({ success: true, message: 'Registratie succesvol!', mosque: newMosque, admin: newAdmin });
  } catch (error) {
    sendError(res, error.code === '23505' ? 409 : (error.code ? 400 : 500), error.message || 'Fout bij registratie.', error.details || error);
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
    res.json(mosque);
  } catch (error) {
    sendError(res, 500, 'Fout bij ophalen moskee.', error.message);
  }
});

// Update Mosque Details (Basis info)
app.put('/api/mosques/:mosqueId', async (req, res) => {
    // TODO: Autoriseer of gebruiker deze moskee mag wijzigen (admin van die moskee)
    try {
        const { mosqueId } = req.params;
        const { name, address, city, zipcode, phone, email, website } = req.body;
        if (!name) return sendError(res, 400, "Moskeenaam is verplicht.");

        const { data, error } = await supabase
            .from('mosques')
            .update({ name, address, city, zipcode, phone, email, website, updated_at: new Date() })
            .eq('id', mosqueId)
            .select()
            .single();
        if (error) throw error;
        res.json({ success: true, message: "Moskeegegevens bijgewerkt.", data });
    } catch (error) {
        sendError(res, 500, "Fout bij bijwerken moskeegegevens.", error.message);
    }
});

// Update Mosque M365 Settings
app.put('/api/mosques/:mosqueId/m365-settings', async (req, res) => {
    // TODO: Autoriseer of gebruiker deze moskee mag wijzigen (admin van die moskee)
    try {
        const { mosqueId } = req.params;
        const { m365_tenant_id, m365_client_id, m365_client_secret, m365_sender_email, m365_configured } = req.body;

        const updatePayload = {
            m365_tenant_id,
            m365_client_id,
            m365_sender_email,
            m365_configured: typeof m365_configured === 'boolean' ? m365_configured : false,
            updated_at: new Date()
        };
        // Update client_secret alleen als het meegegeven is (en niet leeg)
        if (m365_client_secret && m365_client_secret.trim() !== '') {
            // TODO: Encrypt m365_client_secret before storing in DB!
            // Voorbeeld: const encryptedSecret = encrypt(m365_client_secret);
            // updatePayload.m365_client_secret = encryptedSecret;
            // Nu, voor demo, direct opslaan (NIET VEILIG VOOR PRODUCTIE ZONDER ENCRYPTIE)
            updatePayload.m365_client_secret = m365_client_secret;
        }


        const { data, error } = await supabase
            .from('mosques')
            .update(updatePayload)
            .eq('id', mosqueId)
            .select('id, m365_tenant_id, m365_client_id, m365_sender_email, m365_configured') // Stuur geen secret terug
            .single();
        if (error) throw error;
        res.json({ success: true, message: "M365 instellingen bijgewerkt.", data });
    } catch (error) {
        sendError(res, 500, "Fout bij bijwerken M365 instellingen.", error.message);
    }
});


// ======================
// GENERIC CRUD ROUTES (voor users, classes, students, payments)
// Deze hebben autorisatie nodig om te zorgen dat alleen bevoegde users (admins van de specifieke moskee) dit kunnen doen.
// ======================

const createCrudEndpoints = (tableName, selectString = '*') => {
    const singularName = tableName.slice(0, -1); // "users" -> "user"

    // GET all for a mosque
    app.get(`/api/mosques/:mosqueId/${tableName}`, async (req, res) => {
        // TODO: Authorize: is user allowed to see data for this mosqueId?
        try {
            const { mosqueId } = req.params;
            const { data, error } = await supabase.from(tableName).select(selectString).eq('mosque_id', mosqueId).order('created_at', { ascending: false });
            if (error) throw error;
            res.json(data); // Direct de array terugsturen
        } catch (error) {
            sendError(res, 500, `Fout bij ophalen ${tableName}.`, error.message);
        }
    });
    
    // GET one by ID
    app.get(`/api/${tableName}/:id`, async (req, res) => {
        // TODO: Authorize
        try {
            const { id } = req.params;
            const { data, error } = await supabase.from(tableName).select(selectString).eq('id', id).single();
            if (error || !data) return sendError(res, 404, `${singularName} niet gevonden.`);
            res.json(data);
        } catch (error) {
            sendError(res, 500, `Fout bij ophalen ${singularName}.`, error.message);
        }
    });

    // POST create new
    // Speciale POST voor /api/users, /api/classes, etc. zijn hieronder gedefinieerd met meer logica.
    // Deze generieke POST is een fallback of kan verwijderd worden als je specifieke endpoints hebt.
    // app.post(`/api/${tableName}`, async (req, res) => { ... });


    // PUT update by ID
    app.put(`/api/${tableName}/:id`, async (req, res) => {
        // TODO: Authorize
        try {
            const { id } = req.params;
            const updateData = { ...req.body, updated_at: new Date() };
            // Verwijder mosque_id en id uit updateData om te voorkomen dat die gewijzigd worden
            delete updateData.mosque_id;
            delete updateData.id;
            delete updateData.created_at; // created_at niet updaten

            // Voor users, als password wordt meegegeven, hash het
            if (tableName === 'users' && updateData.password) {
                updateData.password_hash = await bcrypt.hash(updateData.password, 10);
                delete updateData.password;
                updateData.is_temporary_password = false; // Als ww wordt geupdate, is het geen temp ww meer
            } else if (tableName === 'users') {
                 delete updateData.password_hash; // Voorkom dat lege password_hash wordt opgeslagen als ww niet meegegeven
            }


            const { data, error } = await supabase.from(tableName).update(updateData).eq('id', id).select(selectString).single();
            if (error) throw error;
            res.json({ success: true, message: `${singularName} bijgewerkt.`, [singularName]: data });
        } catch (error) {
            sendError(res, 500, `Fout bij bijwerken ${singularName}.`, error.message);
        }
    });
    
    // DELETE by ID
    app.delete(`/api/${tableName}/:id`, async (req, res) => {
        // TODO: Authorize
        try {
            const { id } = req.params;
             // Speciale logica voor student verwijderen: amount_due van ouder aanpassen
            if (tableName === 'students') {
                const { data: studentToDelete, error: studentFetchError } = await supabase
                    .from('students').select('parent_id').eq('id', id).single();
                if (studentFetchError || !studentToDelete) return sendError(res, 404, "Leerling niet gevonden voor aanpassing ouder.");
                
                const { error: deleteError } = await supabase.from(tableName).delete().eq('id', id);
                if (deleteError) throw deleteError;

                if (studentToDelete.parent_id) {
                    const { data: siblings } = await supabase.from('students').select('id', { count: 'exact' }).eq('parent_id', studentToDelete.parent_id).eq('active', true);
                    const childCount = siblings?.length || 0;
                    const amountDue = Math.min(childCount * 150, 450); // Behoud je logica
                    await supabase.from('users').update({ amount_due: amountDue }).eq('id', studentToDelete.parent_id);
                }
            } else {
                 const { error } = await supabase.from(tableName).delete().eq('id', id);
                 if (error) throw error;
            }
            res.status(200).json({ success: true, message: `${singularName} verwijderd.` }); // 200 OK met body, of 204 No Content
        } catch (error) {
            sendError(res, 500, `Fout bij verwijderen ${singularName}.`, error.message);
        }
    });
};

// Creëer CRUD endpoints voor de tabellen
// De select string is aangepast om geneste data op te halen zoals in je originele GET routes
createCrudEndpoints('users', 'id, email, name, role, phone, address, city, zipcode, amount_due, created_at, mosque_id');
createCrudEndpoints('classes', '*, teacher:teacher_id(id, name), students(count)'); // students(count) voor aantal
createCrudEndpoints('students', '*, parent:parent_id(id, name, email), class:class_id(id, name)');
createCrudEndpoints('payments', '*, parent:parent_id(id, name, email), student:student_id(id, name), processed_by_user:processed_by(name)');


// ======================
// SPECIFIC POST ROUTES (houden we apart van generieke CRUD vanwege unieke logica)
// ======================

// POST /api/users (Create new user - leraar/ouder) - originele code behouden voor specifieke logica
app.post('/api/users', async (req, res) => {
  try {
    const { mosque_id, email, name, role, phone, address, city, zipcode, password, amount_due } = req.body;
    if (!mosque_id || !email || !name || !role || !password) {
        return sendError(res, 400, "Mosque ID, email, name, role, and password zijn verplicht.");
    }
    const password_hash = await bcrypt.hash(password, 10);
    const userData = {
        mosque_id, email: email.toLowerCase().trim(), password_hash, name, role,
        is_temporary_password: true, // Nieuwe users via deze weg krijgen een temp ww
        phone, address, city, zipcode,
        amount_due: role === 'parent' ? (parseFloat(amount_due) || 0) : null, // Alleen voor ouders
    };
    const { data: user, error } = await supabase.from('users').insert([userData]).select('id, email, name, role, phone, address, city, zipcode, amount_due, created_at, mosque_id').single();
    if (error) throw error;
    res.status(201).json({ success: true, user });
  } catch (error) {
    sendError(res, error.code === '23505' ? 409 : 500, error.message || 'Fout bij aanmaken gebruiker.', error.details);
  }
});

// POST /api/classes (Create new class) - originele code behouden
app.post('/api/classes', async (req, res) => {
  try {
    const { mosque_id, name, teacher_id, description } = req.body;
     if (!mosque_id || !name || !teacher_id ) {
        return sendError(res, 400, "Mosque ID, class name, and teacher ID zijn verplicht.");
    }
    const { data: classData, error } = await supabase.from('classes').insert([{ mosque_id, name, teacher_id, description }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, class: classData });
  } catch (error) {
    sendError(res, 500, 'Fout bij aanmaken klas.', error.message);
  }
});

// POST /api/students (Create new student) - originele code met amount_due update behouden
app.post('/api/students', async (req, res) => {
  try {
    const { mosque_id, parent_id, class_id, name, date_of_birth, emergency_contact, emergency_phone, notes } = req.body;
    if (!mosque_id || !parent_id || !class_id || !name) {
        return sendError(res, 400, "Mosque ID, parent ID, class ID, and student name zijn verplicht.");
    }
    const { data: student, error } = await supabase.from('students').insert([{ mosque_id, parent_id, class_id, name, date_of_birth, emergency_contact, emergency_phone, notes }]).select().single();
    if (error) throw error;

    // Update parent's amount due
    const { data: siblings } = await supabase.from('students').select('id', { count: 'exact' }).eq('parent_id', parent_id).eq('active', true);
    const childCount = siblings?.length || 0;
    const newAmountDue = Math.min(childCount * 150, 450); // Jouw logica
    await supabase.from('users').update({ amount_due: newAmountDue }).eq('id', parent_id);

    res.status(201).json({ success: true, student });
  } catch (error) {
    sendError(res, 500, 'Fout bij aanmaken leerling.', error.message);
  }
});

// POST /api/payments (Create new payment) - originele code behouden
app.post('/api/payments', async (req, res) => {
  try {
    const { mosque_id, parent_id, student_id, amount, payment_method, payment_date, description, notes, processed_by } = req.body;
    if (!mosque_id || !parent_id || !amount || !payment_method || !payment_date) {
        return sendError(res, 400, "Mosque ID, parent ID, amount, payment method, and payment date zijn verplicht.");
    }
    const { data: payment, error } = await supabase.from('payments').insert([{ mosque_id, parent_id, student_id, amount, payment_method, payment_date, description, notes, processed_by }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, payment });
  } catch (error) {
    sendError(res, 500, 'Fout bij aanmaken betaling.', error.message);
  }
});


// ======================
// EMAIL & CONFIG ROUTES (Behouden zoals ze waren)
// ======================
app.post('/api/send-email-m365', async (req, res) => {
  try {
    const { tenantId, clientId, clientSecret, to, subject, body, mosqueName } = req.body;
    if (!tenantId || !clientId || !clientSecret || !to || !subject || !body) {
      return sendError(res, 400, 'M365 email: Missing required fields (tenantId, clientId, clientSecret, to, subject, body).');
    }

    const tokenResponse = await axios.post(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials'}),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const accessToken = tokenResponse.data.access_token;

    // Gebruik m365_sender_email van de moskee als die bestaat, anders fallback naar env var
    let senderToUse = process.env.M365_SENDER_EMAIL || 'onderwijs@al-hijra.nl'; // Fallback
    if (mosqueName) {
        const { data: mosqueFromDb } = await supabase.from('mosques').select('m365_sender_email').eq('name', mosqueName).single();
        if (mosqueFromDb && mosqueFromDb.m365_sender_email) {
            senderToUse = mosqueFromDb.m365_sender_email;
        }
    }
    console.log(`📤 Sending email from: ${senderToUse} via Microsoft Graph...`);

    const emailResponse = await axios.post(
      `https://graph.microsoft.com/v1.0/users/${senderToUse}/sendMail`,
      { message: { subject, body: { contentType: 'Text', content: body }, toRecipients: [{ emailAddress: { address: to } }] } },
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    // Log email
    if (mosqueName) {
      const { data: mosque } = await supabase.from('mosques').select('id').eq('name', mosqueName).single();
      if (mosque) {
        await supabase.from('email_logs').insert([{
          mosque_id: mosque.id, recipient_email: to, subject, body, email_type: 'api_triggered', // or more specific
          sent_status: 'sent', microsoft_message_id: emailResponse.headers['request-id'], sent_at: new Date()
        }]);
      }
    }
    res.json({ success: true, messageId: emailResponse.headers['request-id'] || 'sent_' + Date.now(), service: 'Microsoft Graph API', sender: senderToUse });
  } catch (error) {
    sendError(res, 500, `M365 email send error: ${error.response?.data?.error?.message || error.message}`, error.response?.data);
  }
});

app.get('/api/config-check', (req, res) => {
  res.json({
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_SERVICE_KEY,
    defaultM365Sender: process.env.M365_SENDER_EMAIL || 'Not Set in Env',
    nodeEnv: process.env.NODE_ENV || 'development',
    port: PORT
  });
});


// Catch all undefined routes - update available_routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    available_routes_summary: [ // Houd deze lijst up-to-date
      'GET /api/health',
      'GET /api/config-check',
      'POST /api/auth/login',
      'POST /api/mosques/register',
      'GET /api/mosque/:subdomain',
      'PUT /api/mosques/:mosqueId',
      'PUT /api/mosques/:mosqueId/m365-settings',
      'GET /api/mosques/:mosqueId/users',      // via createCrudEndpoints('users',...)
      'GET /api/users/:id',                   // via createCrudEndpoints('users',...)
      'POST /api/users',                      // Specifiek POST
      'PUT /api/users/:id',                   // via createCrudEndpoints('users',...)
      'DELETE /api/users/:id',                // via createCrudEndpoints('users',...)
      'GET /api/mosques/:mosqueId/classes',   // via createCrudEndpoints('classes',...)
      'GET /api/classes/:id',                 // via createCrudEndpoints('classes',...)
      'POST /api/classes',                    // Specifiek POST
      'PUT /api/classes/:id',                 // via createCrudEndpoints('classes',...)
      'DELETE /api/classes/:id',              // via createCrudEndpoints('classes',...)
      'GET /api/mosques/:mosqueId/students',  // via createCrudEndpoints('students',...)
      'GET /api/students/:id',                // via createCrudEndpoints('students',...)
      'POST /api/students',                   // Specifiek POST
      'PUT /api/students/:id',                // via createCrudEndpoints('students',...)
      'DELETE /api/students/:id',             // via createCrudEndpoints('students',...)
      'GET /api/mosques/:mosqueId/payments',  // via createCrudEndpoints('payments',...)
      'GET /api/payments/:id',                // via createCrudEndpoints('payments',...)
      'POST /api/payments',                   // Specifiek POST
      'PUT /api/payments/:id',                // via createCrudEndpoints('payments',...)
      'DELETE /api/payments/:id',             // via createCrudEndpoints('payments',...)
      'POST /api/send-email-m365'
    ]
  });
});

// Global error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Unhandled Server Error:', error.stack || error);
  // Voorkom lekken van stacktrace in productie
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message;
  res.status(error.status || 500).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { details: error.stack })
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Moskee Backend API v2.1.0 running on port ${PORT}`);
  console.log(`🔗 Base URL: (Your Railway public URL)`);
  console.log(`🗄️ Supabase Project URL: ${supabaseUrl ? supabaseUrl.split('.')[0] + '.supabase.co' : 'Not configured'}`);
});

module.exports = app; // Voor eventuele testen