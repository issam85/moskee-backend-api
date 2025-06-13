// routes/authRoutes.js
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');
const { sendM365EmailInternal } = require('../services/emailService');

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password, subdomain } = req.body;
    if (!email || !password || !subdomain) return sendError(res, 400, 'Email, wachtwoord en subdomein zijn verplicht.', null, req);
    
    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedEmail = email.toLowerCase().trim();

    const { data: mosque, error: mosqueError } = await supabase.from('mosques').select('id').eq('subdomain', normalizedSubdomain).single();
    if (mosqueError || !mosque) return sendError(res, 404, `Moskee met subdomein '${normalizedSubdomain}' niet gevonden.`, null, req);

    const { data: { user: supabaseAuthUser, session }, error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (signInError) {
        if (signInError.message === 'Invalid login credentials') return sendError(res, 401, 'Ongeldige combinatie van email/wachtwoord.', null, req);
        return sendError(res, 401, `Authenticatiefout: ${signInError.message}`, null, req);
    }
    if (!supabaseAuthUser || !session) return sendError(res, 401, 'Ongeldige inlogpoging.', null, req);

    // Verifieer dat deze gebruiker bij deze moskee hoort
    const { data: appUser, error: appUserError } = await supabase.from('users').select('*').eq('id', supabaseAuthUser.id).eq('mosque_id', mosque.id).single();
    if (appUserError || !appUser) {
        await supabase.auth.signOut(); // Log de ongeldige sessie uit
        return sendError(res, 401, 'Gebruiker is niet gekoppeld aan deze moskee.', null, req);
    }

    await supabase.from('users').update({ last_login: new Date() }).eq('id', appUser.id);
    
    // Stuur de sessie token en gebruikersprofiel terug
    res.json({ success: true, user: appUser, session });
  } catch (error) {
    sendError(res, 500, 'Interne serverfout tijdens login.', error.message, req);
  }
});

// POST /api/mosques/register
router.post('/mosques/register', async (req, res) => {
  try {
    const { mosqueName, subdomain, adminName, adminEmail, adminPassword } = req.body;
    if (!mosqueName || !subdomain || !adminName || !adminEmail || !adminPassword) return sendError(res, 400, 'Verplichte registratievelden ontbreken.', null, req);
    if (adminPassword.length < 8) return sendError(res, 400, 'Wachtwoord moet minimaal 8 karakters lang zijn.', null, req);
    
    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedAdminEmail = adminEmail.toLowerCase().trim();
    
    const { data: existingSubdomain } = await supabase.from('mosques').select('id').eq('subdomain', normalizedSubdomain).maybeSingle();
    if (existingSubdomain) return sendError(res, 409, 'Dit subdomein is al in gebruik.', null, req);
    
    const { data: { users }, error: listUsersError } = await supabase.auth.admin.listUsers({ email: normalizedAdminEmail });
    if (listUsersError) throw listUsersError;
    if (users && users.length > 0) return sendError(res, 409, 'Dit emailadres is al geregistreerd.', null, req);

    // Maak moskee record aan
    const { data: newMosque, error: mosqueCreateError } = await supabase.from('mosques').insert([{
      name: mosqueName,
      subdomain: normalizedSubdomain,
      ...req.body // Voeg overige optionele velden toe
    }]).select().single();
    if (mosqueCreateError) throw mosqueCreateError;
    
    // Maak auth user aan
    const { data: { user: supabaseAuthAdmin }, error: authError } = await supabase.auth.admin.createUser({
      email: normalizedAdminEmail,
      password: adminPassword,
      email_confirm: true // Account is direct actief
    });
    if (authError) {
      await supabase.from('mosques').delete().eq('id', newMosque.id); // Rollback
      return sendError(res, 500, `Fout bij aanmaken gebruiker: ${authError.message}`, authError, req);
    }
    
    // Maak app user record aan
    const { data: newAppAdmin, error: appAdminError } = await supabase.from('users').insert([{
      id: supabaseAuthAdmin.id,
      mosque_id: newMosque.id,
      email: normalizedAdminEmail,
      name: adminName,
      role: 'admin'
    }]).select('id, email, name, role').single();
    if (appAdminError) {
      await supabase.from('mosques').delete().eq('id', newMosque.id); // Rollback
      await supabase.auth.admin.deleteUser(supabaseAuthAdmin.id); // Rollback
      throw appAdminError;
    }

    res.status(201).json({ success: true, message: 'Registratie succesvol!', mosque: newMosque, admin: newAppAdmin });
  } catch (error) {
    sendError(res, error.code === '23505' ? 409 : (error.status || 500), error.message || 'Fout bij registratie.', error, req);
  }
});

module.exports = router;