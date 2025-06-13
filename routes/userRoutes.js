// routes/userRoutes.js
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');
const { sendM365EmailInternal } = require('../services/emailService');

// GET all users for a mosque
router.get('/mosque/:mosqueId', async (req, res) => {
    if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    try {
        let query = supabase.from('users').select('*').eq('mosque_id', req.params.mosqueId);
        if (req.query.role) {
            query = query.eq('role', req.query.role);
        }
        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (error) {
        sendError(res, 500, `Fout bij ophalen gebruikers.`, error.message, req);
    }
});

// GET a single user by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase.from('users').select('*').eq('id', id).single();
        if (error || !data) return sendError(res, 404, `Gebruiker niet gevonden.`, null, req);
        
        // Autorisatie: Admin van dezelfde moskee, of gebruiker zelf
        const isAuthorized = (req.user.role === 'admin' && req.user.mosque_id === data.mosque_id) || (req.user.id === id);
        if (!isAuthorized) return sendError(res, 403, "Niet geautoriseerd.", null, req);

        res.json(data);
    } catch (error) {
        sendError(res, 500, `Fout bij ophalen gebruiker.`, error.message, req);
    }
});

// POST (create) a new user
router.post('/', async (req, res) => {
    if (req.user.role !== 'admin') return sendError(res, 403, "Niet geautoriseerd.", null, req);
    try {
        const { mosque_id, email, name, role, phone, address, city, zipcode, password, sendWelcomeEmail = true } = req.body;
        if (req.user.mosque_id !== mosque_id) return sendError(res, 403, "U kunt alleen gebruikers toevoegen aan uw eigen moskee.", null, req);
        if (!email || !name || !role || !password) return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
        if (password.length < 8) return sendError(res, 400, "Wachtwoord moet minimaal 8 karakters lang zijn.", null, req);

        const normalizedEmail = email.toLowerCase().trim();

        const { data: { user: supabaseAuthUser }, error: authError } = await supabase.auth.admin.createUser({ email: normalizedEmail, password, email_confirm: true });
        if (authError) {
            if (authError.message.includes('User already registered')) return sendError(res, 409, `Email ${normalizedEmail} is al geregistreerd.`, null, req);
            return sendError(res, 500, `Fout bij aanmaken auth user: ${authError.message}`, authError, req);
        }

        const appUserData = { id: supabaseAuthUser.id, mosque_id, email: normalizedEmail, name, role, phone, address, city, zipcode, amount_due: role === 'parent' ? 0 : null, is_temporary_password: true };
        const { data: appUser, error: appUserError } = await supabase.from('users').insert(appUserData).select().single();
        if (appUserError) {
            await supabase.auth.admin.deleteUser(supabaseAuthUser.id); // Rollback
            throw appUserError;
        }

        if (appUser.role === 'parent' && sendWelcomeEmail) {
            // Logica voor welkomstmail (asynchroon)
            sendWelcomeEmailForNewUser(appUser, password, req);
        }

        res.status(201).json({ success: true, user: appUser });
    } catch (error) {
        sendError(res, error.code === '23505' ? 409 : 500, error.message, error, req);
    }
});

// PUT (update) a user
// PUT (update) a user
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: userToUpdate, error: fetchErr } = await supabase.from('users').select('mosque_id').eq('id', id).single();
        if (fetchErr || !userToUpdate) return sendError(res, 404, 'Gebruiker niet gevonden.', null, req);
        
        const updateData = { ...req.body, updated_at: new Date() };
        
        // Sanitize: verwijder velden die nooit via een update mogen veranderen
        delete updateData.id;
        delete updateData.mosque_id;
        delete updateData.created_at;
        delete updateData.last_login;

        // Autorisatie en veldbeperking
        if (req.user.role === 'admin' && req.user.mosque_id === userToUpdate.mosque_id) {
            // Admin mag (bijna) alles. Bepaalde velden zoals amount_due worden apart berekend.
            delete updateData.amount_due; 
        } else if (req.user.id === id) {
            // Gebruiker mag eigen profiel bijwerken, maar met beperkingen
            delete updateData.role;
            delete updateData.amount_due;
            delete updateData.is_temporary_password;
        } else {
            return sendError(res, 403, "Niet geautoriseerd om deze gebruiker te bewerken.", null, req);
        }

        const { data, error } = await supabase
            .from('users')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
        
        if (error) throw error;
        res.json({ success: true, message: 'Gebruiker bijgewerkt.', user: data });
    } catch (error) {
        sendError(res, 500, 'Fout bij bijwerken gebruiker.', error.message, req);
    }
});

// DELETE a user
router.delete('/:id', async (req, res) => {
    if (req.user.role !== 'admin') return sendError(res, 403, "Alleen admins mogen gebruikers verwijderen.", null, req);
    try {
        const { id } = req.params;
        const { data: userToDelete, error: fetchErr } = await supabase.from('users').select('mosque_id').eq('id', id).single();
        if (fetchErr || !userToDelete) return sendError(res, 404, `Gebruiker niet gevonden.`, null, req);
        if (req.user.mosque_id !== userToDelete.mosque_id) return sendError(res, 403, "Niet geautoriseerd.", null, req);

        // Eerst Auth user verwijderen
        const { error: authDeleteError } = await supabase.auth.admin.deleteUser(id);
        if (authDeleteError && authDeleteError.message !== 'User not found') {
            // Niet stoppen als auth user al weg is, maar wel als er een andere fout is
            return sendError(res, 500, 'Kon auth gebruiker niet verwijderen.', authDeleteError, req);
        }

        // Dan app user verwijderen
        const { error: appDeleteError } = await supabase.from('users').delete().eq('id', id);
        if (appDeleteError) throw appDeleteError;

        res.json({ success: true, message: 'Gebruiker verwijderd.' });
    } catch (error) {
        sendError(res, 500, `Fout bij verwijderen gebruiker.`, error.message, req);
    }
});


// POST send a new password to a user
router.post('/:userId/send-new-password', async (req, res) => {
    if (req.user.role !== 'admin') return sendError(res, 403, "Niet geautoriseerd.", null, req);
    const { userId } = req.params;
    try {
        const { data: user, error: userError } = await supabase.from('users').select('*, mosque:mosque_id(name, subdomain, m365_configured)').eq('id', userId).single();
        if (userError || !user) return sendError(res, 404, 'Gebruiker niet gevonden.', null, req);
        if (req.user.mosque_id !== user.mosque_id) return sendError(res, 403, "Niet van dezelfde moskee.", null, req);

        const newTempPassword = Math.random().toString(36).slice(-10) + '!A1';

        const { error: updateAuthError } = await supabase.auth.admin.updateUserById(userId, { password: newTempPassword });
        if (updateAuthError) return sendError(res, 500, 'Kon wachtwoord in auth systeem niet updaten.', updateAuthError, req);

        await supabase.from('users').update({ is_temporary_password: true }).eq('id', userId);

        if (!user.mosque.m365_configured) {
            return res.json({ success: true, message: `Wachtwoord gereset, maar M365 is niet geconfigureerd. Geen email verzonden.`, newPasswordForManualDelivery: newTempPassword });
        }

        const emailSubject = `Nieuw wachtwoord voor uw ${user.mosque.name} account`;
        const emailBody = `<p>Beste ${user.name},</p><p>Uw nieuwe tijdelijke wachtwoord is: <strong>${newTempPassword}</strong></p><p>Log in via https://${user.mosque.subdomain}.mijnlvs.nl en wijzig uw wachtwoord.</p>`;
        const emailResult = await sendM365EmailInternal({ to: user.email, subject: emailSubject, body: emailBody, mosqueId: user.mosque_id, emailType: 'm365_new_temp_password' });

        if (emailResult.success) {
            res.json({ success: true, message: `Nieuw wachtwoord verzonden naar ${user.email}.` });
        } else {
            res.status(500).json({ success: false, error: `Wachtwoord gereset, maar emailfout: ${emailResult.error}.`, details: { newPasswordForManualDelivery: newTempPassword } });
        }
    } catch (error) {
        sendError(res, 500, 'Onverwachte serverfout.', error.message, req);
    }
});

// Helper for sending welcome email
async function sendWelcomeEmailForNewUser(appUser, plainTextPassword, req) {
    try {
        const { data: mosque } = await supabase.from('mosques').select('name, subdomain, m365_configured').eq('id', appUser.mosque_id).single();
        if (!mosque || !mosque.m365_configured) {
            console.warn(`[POST /api/users] M365 not configured for mosque ${appUser.mosque_id}. Welcome email for ${appUser.email} NOT sent.`);
            return;
        }
        const subject = `Welkom bij ${mosque.name}!`;
        const loginLink = `https://${mosque.subdomain}.mijnlvs.nl`;
        const body = `<p>Beste ${appUser.name},</p><p>Uw account is aangemaakt.</p><p>Email: ${appUser.email}<br>Tijdelijk wachtwoord: <strong>${plainTextPassword}</strong></p><p>Log in via <a href="${loginLink}">${loginLink}</a>.</p>`;
        
        // Fire and forget
        sendM365EmailInternal({ to: appUser.email, subject, body, mosqueId: appUser.mosque_id, emailType: 'm365_parent_welcome' })
            .then(result => console.log(`Welcome email to ${appUser.email} queued. Success: ${result.success}`))
            .catch(err => console.error(`Error queuing welcome email for ${appUser.email}:`, err));

    } catch(e) {
        console.error(`Failed to send welcome email for ${appUser.email}:`, e.message);
    }
}

module.exports = router;