// routes/userRoutes.js - V3.4 - FIXED: Clean, complete version with teacher limit check
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');
const { sendEmail } = require('../services/emailService');
// ✅ Import the checkUsageLimit function
const { checkUsageLimit } = require('../services/trialService');

// Helper functie om een willekeurig wachtwoord te genereren
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

// ✅ POST (create) a new user with teacher limit check
router.post('/', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins mogen gebruikers aanmaken.", null, req);
    }
    
    try {
        const { mosque_id, email, name, role, phone, address, city, zipcode, sendWelcomeEmail = true } = req.body;

        // Basic validation
        if (req.user.mosque_id !== mosque_id) {
            return sendError(res, 403, "U kunt alleen gebruikers toevoegen aan uw eigen moskee.", null, req);
        }
        if (!email || !name || !role) {
            return sendError(res, 400, "Email, naam en rol zijn verplicht.", null, req);
        }

        // ✅ TEACHER LIMIT CHECK
        if (role === 'teacher') {
            console.log(`🔍 [userRoutes] Checking teacher limit for mosque ${mosque_id}...`);
            const limitCheck = await checkUsageLimit(mosque_id, 'teachers');
            
            if (!limitCheck.allowed) {
                console.log(`❌ [userRoutes] Teacher limit reached: ${limitCheck.message}`);
                return sendError(res, 403, limitCheck.message || 'Limiet voor leraren bereikt.', { 
                    code: 'TEACHER_LIMIT_REACHED',
                    currentCount: limitCheck.currentCount,
                    maxAllowed: limitCheck.maxAllowed 
                }, req);
            }
            console.log(`✅ [userRoutes] Teacher limit check passed: ${limitCheck.currentCount}/${limitCheck.maxAllowed}`);
        }

        const normalizedEmail = email.toLowerCase().trim();
        const tempPassword = generateTempPassword();

        // Create Supabase Auth user
        const { data: { user: supabaseAuthUser }, error: authError } = await supabase.auth.admin.createUser({ 
            email: normalizedEmail, 
            password: tempPassword, 
            email_confirm: true,
            user_metadata: { name: name, role: role }
        });

        if (authError) {
            if (authError.message.includes('User already registered')) {
                return sendError(res, 409, `Email ${normalizedEmail} is al geregistreerd.`, null, req);
            }
            return sendError(res, 500, `Fout bij aanmaken auth user: ${authError.message}`, authError, req);
        }

        // Create app user record
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
            is_temporary_password: true,
            created_at: new Date().toISOString()
        };

        const { data: appUser, error: appUserError } = await supabase
            .from('users')
            .insert(appUserData)
            .select()
            .single();

        if (appUserError) {
            // Rollback auth user if app user creation fails
            await supabase.auth.admin.deleteUser(supabaseAuthUser.id);
            throw appUserError;
        }

        console.log(`✅ [userRoutes] New ${role} created: ${name} (${normalizedEmail})`);

        // Send welcome email
        if (sendWelcomeEmail) {
            console.log(`📧 [userRoutes] Attempting to send welcome email to ${normalizedEmail}...`);
            try {
                await sendWelcomeEmailForNewUser(appUser, tempPassword);
                console.log(`✅ [userRoutes] Welcome email process initiated for ${normalizedEmail}`);
            } catch (emailError) {
                console.error(`❌ [userRoutes] Welcome email failed for ${normalizedEmail}:`, emailError);
                // Don't fail the whole operation due to email problems
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
        const { data: userToUpdate, error: fetchErr } = await supabase
            .from('users')
            .select('mosque_id')
            .eq('id', id)
            .single();

        if (fetchErr || !userToUpdate) {
            return sendError(res, 404, 'Gebruiker niet gevonden.', null, req);
        }
        
        const updateData = { ...req.body, updated_at: new Date().toISOString() };
        
        // Remove fields that shouldn't be updated directly
        delete updateData.id;
        delete updateData.mosque_id;
        delete updateData.created_at;
        delete updateData.last_login;

        // Permission-based field restrictions
        if (req.user.role === 'admin' && req.user.mosque_id === userToUpdate.mosque_id) {
            // Admin can update most fields, but not amount_due directly
            delete updateData.amount_due; 
        } else if (req.user.id === id) {
            // Users can only update their own basic info
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
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins mogen gebruikers verwijderen.", null, req);
    }
    
    try {
        const { id } = req.params;
        const { data: userToDelete, error: fetchErr } = await supabase
            .from('users')
            .select('mosque_id, name, email')
            .eq('id', id)
            .single();

        if (fetchErr || !userToDelete) {
            return sendError(res, 404, `Gebruiker niet gevonden.`, null, req);
        }
        
        if (req.user.mosque_id !== userToDelete.mosque_id) {
            return sendError(res, 403, "Niet geautoriseerd.", null, req);
        }

        // Delete from Supabase Auth
        const { error: authDeleteError } = await supabase.auth.admin.deleteUser(id);
        if (authDeleteError && authDeleteError.message !== 'User not found') {
            return sendError(res, 500, 'Kon auth gebruiker niet verwijderen.', authDeleteError, req);
        }

        // Delete from app users table
        const { error: appDeleteError } = await supabase
            .from('users')
            .delete()
            .eq('id', id);

        if (appDeleteError) throw appDeleteError;

        console.log(`🗑️ [userRoutes] Deleted user: ${userToDelete.name} (${userToDelete.email})`);
        res.json({ success: true, message: 'Gebruiker verwijderd.' });
    } catch (error) {
        sendError(res, 500, `Fout bij verwijderen gebruiker.`, error.message, req);
    }
});

// POST send a new password to a user
router.post('/:userId/send-new-password', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    
    const { userId } = req.params;
    
    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            return sendError(res, 404, 'Gebruiker niet gevonden.', null, req);
        }
        
        if (req.user.mosque_id !== user.mosque_id) {
            return sendError(res, 403, "Niet van dezelfde moskee.", null, req);
        }

        const newTempPassword = generateTempPassword();

        // Update password in Supabase Auth
        const { error: updateAuthError } = await supabase.auth.admin.updateUserById(userId, { 
            password: newTempPassword 
        });

        if (updateAuthError) {
            return sendError(res, 500, 'Kon wachtwoord in auth systeem niet updaten.', updateAuthError, req);
        }

        // Mark as temporary password
        await supabase
            .from('users')
            .update({ 
                is_temporary_password: true,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);

        console.log(`🔄 [userRoutes] Sending new password email to ${user.email}...`);

        try {
            const { data: mosque } = await supabase
                .from('mosques')
                .select('name, subdomain')
                .eq('id', user.mosque_id)
                .single();
            
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

// Helper functie voor welkomstmail met intelligente routing
async function sendWelcomeEmailForNewUser(appUser, plainTextPassword) {
    try {
        console.log(`📧 [userRoutes] Preparing welcome email for ${appUser.email} (${appUser.role})`);

        const { data: mosque, error: mosqueError } = await supabase
            .from('mosques')
            .select('name, subdomain')
            .eq('id', appUser.mosque_id)
            .single();

        if (mosqueError || !mosque) {
            console.error(`[userRoutes] Could not find mosque for welcome email to ${appUser.email}:`, mosqueError);
            return { success: false, error: 'Mosque not found' };
        }

        const emailDetails = {
            to: appUser.email,
            subject: `Welkom bij ${mosque.name}! Uw ${appUser.role === 'teacher' ? 'leraar' : 'ouder'} account is aangemaakt`,
            body: generateWelcomeEmailHTML(appUser, plainTextPassword, mosque),
            mosqueId: appUser.mosque_id,
            emailType: `welcome_${appUser.role}`
        };

        console.log(`[userRoutes] Attempting to send welcome email via intelligent routing...`);
        
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

// HTML template functie voor welkomstmail nieuwe gebruiker
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
                Barakallahu feek,<br>
                Het MijnLVS Team
            </p>
        </div>
    `;
}

module.exports = router;