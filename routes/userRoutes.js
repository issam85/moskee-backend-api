// routes/userRoutes.js - V3.2 - Met intelligente email routing
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');
// ✅ UPDATED: Importeer de master sendEmail functie
const { sendEmail } = require('../services/emailService');

// Helper functie om een willekeurig wachtwoord te genereren.
const generateTempPassword = () => {
    return Math.random().toString(36).slice(2, 10) + 'A!b2'; // Genereert een 12-karakter wachtwoord
}

// GET all users for a mosque
router.get('/mosque/:mosqueId', async (req, res) => {
    if (!req.user || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    try {
        let query = supabase.from('users').select('*').eq('mosque_id', req.params.mosqueId);
        if (req.query.role) {
            query = query.eq('role', req.query.role);
        }
        const { data, error } = await query.order('name', { ascending: true });
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
        
        const isAuthorized = (req.user.role === 'admin' && req.user.mosque_id === data.mosque_id) || (req.user.id === id);
        if (!isAuthorized) return sendError(res, 403, "Niet geautoriseerd.", null, req);

        res.json(data);
    } catch (error) {
        sendError(res, 500, `Fout bij ophalen gebruiker.`, error.message, req);
    }
});

// ✅ UPDATED: POST (create) a new user met intelligente email routing
router.post('/', async (req, res) => {
    if (req.user.role !== 'admin') return sendError(res, 403, "Niet geautoriseerd.", null, req);
    
    try {
        const { mosque_id, email, name, role, phone, address, city, zipcode, sendWelcomeEmail = true } = req.body;

        if (req.user.mosque_id !== mosque_id) return sendError(res, 403, "U kunt alleen gebruikers toevoegen aan uw eigen moskee.", null, req);
        if (!email || !name || !role) return sendError(res, 400, "Email, naam en rol zijn verplicht.", null, req);

        // 1. Genereer hier een veilig, tijdelijk wachtwoord
        const tempPassword = generateTempPassword();
        const normalizedEmail = email.toLowerCase().trim();

        // 2. Maak de Supabase Auth gebruiker aan met het tijdelijke wachtwoord
        const { data: { user: supabaseAuthUser }, error: authError } = await supabase.auth.admin.createUser({ 
            email: normalizedEmail, 
            password: tempPassword, 
            email_confirm: true,
            user_metadata: { name: name, role: role }
        });

        if (authError) {
            if (authError.message.includes('User already registered')) return sendError(res, 409, `Email ${normalizedEmail} is al geregistreerd.`, null, req);
            return sendError(res, 500, `Fout bij aanmaken auth user: ${authError.message}`, authError, req);
        }

        // 3. Stel de data voor de 'users' tabel samen ZONDER password_hash
        const appUserData = { 
            id: supabaseAuthUser.id, 
            mosque_id, 
            email: normalizedEmail, 
            name, 
            role, 
            phone, 
            address, 
            city, 
            zipcode, 
            amount_due: role === 'parent' ? 0 : null, 
            is_temporary_password: true 
        };

        const { data: appUser, error: appUserError } = await supabase.from('users').insert(appUserData).select().single();
        if (appUserError) {
            await supabase.auth.admin.deleteUser(supabaseAuthUser.id); // Rollback
            throw appUserError;
        }

        console.log(`✅ [userRoutes] New ${role} created: ${name} (${normalizedEmail})`);

        // 4. ✅ UPDATED: Stuur welkomstmail via intelligente routing
        if (sendWelcomeEmail) {
            console.log(`📧 [userRoutes] Attempting to send welcome email to ${normalizedEmail}...`);
            try {
                await sendWelcomeEmailForNewUser(appUser, tempPassword);
                console.log(`✅ [userRoutes] Welcome email process initiated for ${normalizedEmail}`);
            } catch (emailError) {
                console.error(`❌ [userRoutes] Welcome email failed for ${normalizedEmail}:`, emailError);
                // Niet de hele operatie laten falen vanwege email problemen
            }
        }

        res.status(201).json({ 
            success: true, 
            user: appUser,
            welcome_email_attempted: sendWelcomeEmail 
        });
    } catch (error) {
        const isDuplicateError = error.code === '23505' || (error.message && error.message.includes('duplicate key'));
        sendError(res, isDuplicateError ? 409 : 500, error.message, error, req);
    }
});

// PUT (update) a user
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: userToUpdate, error: fetchErr } = await supabase.from('users').select('mosque_id').eq('id', id).single();
        if (fetchErr || !userToUpdate) return sendError(res, 404, 'Gebruiker niet gevonden.', null, req);
        
        const updateData = { ...req.body, updated_at: new Date() };
        
        delete updateData.id;
        delete updateData.mosque_id;
        delete updateData.created_at;
        delete updateData.last_login;

        if (req.user.role === 'admin' && req.user.mosque_id === userToUpdate.mosque_id) {
            delete updateData.amount_due; 
        } else if (req.user.id === id) {
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

        const { error: authDeleteError } = await supabase.auth.admin.deleteUser(id);
        if (authDeleteError && authDeleteError.message !== 'User not found') {
            return sendError(res, 500, 'Kon auth gebruiker niet verwijderen.', authDeleteError, req);
        }

        const { error: appDeleteError } = await supabase.from('users').delete().eq('id', id);
        if (appDeleteError) throw appDeleteError;

        res.json({ success: true, message: 'Gebruiker verwijderd.' });
    } catch (error) {
        sendError(res, 500, `Fout bij verwijderen gebruiker.`, error.message, req);
    }
});

// ✅ UPDATED: POST send a new password to a user met intelligente routing
router.post('/:userId/send-new-password', async (req, res) => {
    if (req.user.role !== 'admin') return sendError(res, 403, "Niet geautoriseerd.", null, req);
    const { userId } = req.params;
    try {
        const { data: user, error: userError } = await supabase.from('users').select('*').eq('id', userId).single();
        if (userError || !user) return sendError(res, 404, 'Gebruiker niet gevonden.', null, req);
        if (req.user.mosque_id !== user.mosque_id) return sendError(res, 403, "Niet van dezelfde moskee.", null, req);

        const newTempPassword = Math.random().toString(36).slice(-10) + '!A1';

        const { error: updateAuthError } = await supabase.auth.admin.updateUserById(userId, { password: newTempPassword });
        if (updateAuthError) return sendError(res, 500, 'Kon wachtwoord in auth systeem niet updaten.', updateAuthError, req);

        await supabase.from('users').update({ is_temporary_password: true }).eq('id', userId);

        console.log(`🔄 [userRoutes] Sending new password email to ${user.email}...`);

        // ✅ Gebruik de intelligente sendEmail functie
        try {
            const { data: mosque } = await supabase.from('mosques').select('name, subdomain').eq('id', user.mosque_id).single();
            
            const emailDetails = {
                to: user.email,
                subject: `Nieuw wachtwoord voor uw ${mosque.name} account`,
                body: generateNewPasswordEmailHTML(user.name, newTempPassword, mosque.subdomain),
                mosqueId: user.mosque_id,
                emailType: `new_password_${user.role}`
            };

            const emailResult = await sendEmail(emailDetails);
            
            if (emailResult.success) {
                console.log(`✅ [userRoutes] New password email sent to ${user.email} via ${emailResult.service}`);
                res.json({ 
                    success: true, 
                    message: `Nieuw wachtwoord verzonden naar ${user.email} via ${emailResult.service}.`,
                    email_service: emailResult.service
                });
            } else {
                console.warn(`⚠️ [userRoutes] New password email failed for ${user.email}:`, emailResult.error);
                res.json({ 
                    success: false, 
                    error: `Email versturen mislukt: ${emailResult.error}`,
                    newPasswordForManualDelivery: newTempPassword 
                });
            }
        } catch (emailError) {
            console.error(`❌ [userRoutes] Error sending new password email:`, emailError);
            res.json({ 
                success: false, 
                error: `Wachtwoord gereset, maar email fout: ${emailError.message}`,
                newPasswordForManualDelivery: newTempPassword 
            });
        }
    } catch (error) {
        sendError(res, 500, 'Onverwachte serverfout.', error.message, req);
    }
});

// ✅ COMPLETELY REWRITTEN: Helper voor welkomstmail met intelligente routing
async function sendWelcomeEmailForNewUser(appUser, plainTextPassword) {
    try {
        console.log(`📧 [userRoutes] Preparing welcome email for ${appUser.email} (${appUser.role})`);

        // Haal moskee gegevens op
        const { data: mosque, error: mosqueError } = await supabase
            .from('mosques')
            .select('name, subdomain')
            .eq('id', appUser.mosque_id)
            .single();

        if (mosqueError || !mosque) {
            console.error(`[userRoutes] Could not find mosque for welcome email to ${appUser.email}:`, mosqueError);
            return;
        }

        // Stel email details samen
        const emailDetails = {
            to: appUser.email,
            subject: `Welkom bij ${mosque.name}! Uw ${appUser.role === 'teacher' ? 'leraar' : 'ouder'} account is aangemaakt`,
            body: generateWelcomeEmailHTML(appUser, plainTextPassword, mosque),
            mosqueId: appUser.mosque_id,
            emailType: `welcome_${appUser.role}` // welcome_teacher of welcome_parent
        };

        console.log(`[userRoutes] Attempting to send welcome email via intelligent routing...`);
        
        // ✅ Gebruik de master sendEmail functie (zal M365 proberen, dan fallback naar Resend)
        const emailResult = await sendEmail(emailDetails);
        
        if (emailResult.success) {
            console.log(`✅ [userRoutes] Welcome email sent successfully to ${appUser.email} via ${emailResult.service}`);
        } else {
            console.error(`❌ [userRoutes] Welcome email failed for ${appUser.email}:`, emailResult.error);
        }

        return emailResult;

    } catch (error) {
        console.error(`❌ [userRoutes] Exception in sendWelcomeEmailForNewUser for ${appUser.email}:`, error);
        return { success: false, error: error.message };
    }
}

// ✅ NEW: HTML template voor welkomstmail nieuwe gebruiker
function generateWelcomeEmailHTML(user, tempPassword, mosque) {
    const roleText = user.role === 'teacher' ? 'leraar' : 'ouder';
    const loginUrl = `https://${mosque.subdomain}.mijnlvs.nl`;

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <h1 style="color: #10b981; margin: 0; font-size: 28px;">Welkom bij ${mosque.name}!</h1>
                <p style="color: #6b7280; margin: 10px 0 0 0; font-size: 16px;">Uw ${roleText} account is aangemaakt</p>
            </div>
            
            <!-- Welcome Message -->
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <h2 style="color: #15803d; margin-top: 0; font-size: 20px;">Assalamu alaykum ${user.name},</h2>
                <p style="color: #166534; margin: 0; font-size: 16px; line-height: 1.5;">
                    Uw ${roleText} account voor <strong>${mosque.name}</strong> is succesvol aangemaakt! 
                    U kunt nu inloggen en uw wachtwoord wijzigen.
                </p>
            </div>
            
            <!-- Login Credentials -->
            <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #92400e; margin-top: 0; font-size: 18px;">🔑 Uw Inloggegevens:</h3>
                <div style="color: #78350f; font-size: 16px;">
                    <p style="margin: 8px 0;"><strong>Website:</strong> <a href="${loginUrl}" style="color: #d97706;">${loginUrl}</a></p>
                    <p style="margin: 8px 0;"><strong>Email:</strong> ${user.email}</p>
                    <p style="margin: 8px 0;"><strong>Tijdelijk wachtwoord:</strong> <code style="background: #fbbf24; padding: 4px 8px; border-radius: 4px; font-family: monospace;"><strong>${tempPassword}</strong></code></p>
                </div>
            </div>

            <!-- Important Notice -->
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #dc2626; margin-top: 0; font-size: 18px;">⚠️ Belangrijk:</h3>
                <p style="color: #991b1b; margin: 0; font-size: 14px;">
                    Dit is een tijdelijk wachtwoord. Bij uw eerste inlog wordt u gevraagd om een nieuw, eigen wachtwoord in te stellen.
                </p>
            </div>
            
            <!-- CTA Button -->
            <div style="text-align: center; margin: 30px 0;">
                <a href="${loginUrl}" 
                   style="background: #10b981; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);">
                    🚀 Inloggen en Wachtwoord Wijzigen
                </a>
            </div>
            
            ${user.role === 'teacher' ? generateTeacherSpecificContent() : generateParentSpecificContent()}
            
            <!-- Support Info -->
            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
                <h3 style="color: #374151; margin-top: 0; font-size: 18px;">🤝 Hulp Nodig?</h3>
                <p style="color: #6b7280; margin: 0 0 12px 0; font-size: 14px;">
                    Heeft u vragen of problemen met inloggen? Neem contact op:
                </p>
                <ul style="color: #6b7280; margin: 0; padding-left: 20px; font-size: 14px;">
                    <li>📧 Email: <a href="mailto:i.abdellaoui@gmail.com" style="color: #10b981;">i.abdellaoui@gmail.com</a></li>
                    <li>💬 Of neem contact op met de moskee administratie</li>
                </ul>
            </div>
            
            <!-- Footer -->
            <div style="text-align: center; color: #6b7280; margin-top: 40px;">
                <p style="margin: 0;">
                    Barakallahu feeki,<br>
                    <strong style="color: #374151;">Het ${mosque.name} Team</strong>
                </p>
                <p style="margin: 20px 0 0 0; font-size: 12px;">
                    Deze email is verstuurd naar ${user.email} omdat er een account voor u is aangemaakt.
                </p>
            </div>
        </div>
    `;
}

// ✅ NEW: Teacher-specific content
function generateTeacherSpecificContent() {
    return `
        <!-- Teacher Features -->
        <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <h3 style="color: #0369a1; margin-top: 0; font-size: 18px;">👨‍🏫 Als Leraar kunt u:</h3>
            <ul style="color: #075985; margin: 0; padding-left: 20px; font-size: 14px;">
                <li style="margin: 8px 0;">Uw leerlingen beheren en voortgang bijhouden</li>
                <li style="margin: 8px 0;">Aanwezigheid registreren per les</li>
                <li style="margin: 8px 0;">Qor'aan voortgang en memorisatie bijwerken</li>
                <li style="margin: 8px 0;">Berichten sturen naar ouders</li>
                <li style="margin: 8px 0;">Rapporten genereren voor uw klassen</li>
            </ul>
        </div>
    `;
}

// ✅ NEW: Parent-specific content
function generateParentSpecificContent() {
    return `
        <!-- Parent Features -->
        <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <h3 style="color: #0369a1; margin-top: 0; font-size: 18px;">👨‍👩‍👧‍👦 Als Ouder kunt u:</h3>
            <ul style="color: #075985; margin: 0; padding-left: 20px; font-size: 14px;">
                <li style="margin: 8px 0;">De voortgang van uw kind(eren) volgen</li>
                <li style="margin: 8px 0;">Aanwezigheidsrapporten bekijken</li>
                <li style="margin: 8px 0;">Berichten ontvangen van leraren</li>
                <li style="margin: 8px 0;">Facturen en betalingen beheren</li>
                <li style="margin: 8px 0;">Contactgegevens bijwerken</li>
            </ul>
        </div>
    `;
}

// ✅ NEW: HTML template voor nieuw wachtwoord email
function generateNewPasswordEmailHTML(userName, newPassword, subdomain) {
    const loginUrl = `https://${subdomain}.mijnlvs.nl`;
    
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #10b981;">Assalamu alaykum ${userName},</h2>
            
            <p style="color: #374151;">
                Uw wachtwoord is opnieuw ingesteld. Hier zijn uw nieuwe inloggegevens:
            </p>
            
            <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #92400e; margin-top: 0;">🔑 Nieuwe Inloggegevens:</h3>
                <p style="color: #78350f; margin: 8px 0;"><strong>Website:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
                <p style="color: #78350f; margin: 8px 0;"><strong>Nieuw tijdelijk wachtwoord:</strong> <strong>${newPassword}</strong></p>
            </div>
            
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #dc2626; margin: 0; font-size: 14px;">
                    ⚠️ <strong>Belangrijk:</strong> Wijzig dit wachtwoord direct na het inloggen voor uw veiligheid.
                </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${loginUrl}" 
                   style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Inloggen
                </a>
            </div>
            
            <p style="color: #6b7280; font-size: 14px;">
                Heeft u deze wijziging niet aangevraagd? Neem dan direct contact op met de moskee administratie.
            </p>
            
            <p style="color: #374151;">
                Barakallahu feeki,<br>
                Het MijnLVS Team
            </p>
        </div>
    `;
}

module.exports = router;