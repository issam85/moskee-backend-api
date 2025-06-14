// routes/mosqueRoutes.js - GECORRIGEERD met volledige M365 velden
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');
const bcrypt = require('bcryptjs');
const { sendRegistrationWelcomeEmail } = require('../services/registrationEmailService');


router.post('/register', async (req, res) => {
    try {
        const { 
            mosqueName, 
            subdomain, 
            adminName, 
            adminEmail, 
            adminPassword, 
            address, 
            city, 
            zipcode, 
            phone, 
            website, 
            email 
        } = req.body;

        console.log('=== MOSQUE REGISTRATION START ===');
        console.log('Request body:', { mosqueName, subdomain, adminEmail, address, city });

        // Validatie van verplichte velden
        if (!mosqueName || !subdomain || !adminName || !adminEmail || !adminPassword) {
            return sendError(res, 400, "Verplichte velden ontbreken (mosqueName, subdomain, adminName, adminEmail, adminPassword).", null, req);
        }

        // Valideer subdomain format
        const subdomainPattern = /^[a-z0-9-]+$/;
        const cleanSubdomain = subdomain.trim().toLowerCase();
        
        if (!subdomainPattern.test(cleanSubdomain)) {
            return sendError(res, 400, "Subdomein mag alleen kleine letters, cijfers en streepjes bevatten.", null, req);
        }

        if (cleanSubdomain.length < 3 || cleanSubdomain.length > 30) {
            return sendError(res, 400, "Subdomein moet tussen 3 en 30 karakters lang zijn.", null, req);
        }

        // Check if subdomain already exists
        const { data: existingBySubdomain, error: subdomainError } = await supabase
            .from('mosques')
            .select('id')
            .eq('subdomain', cleanSubdomain)
            .single();

        if (!subdomainError && existingBySubdomain) {
            return sendError(res, 409, "Dit subdomein is al in gebruik. Kies een ander subdomein.", null, req);
        }

        // Check if admin email already exists in users table
        const { data: existingUser, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('email', adminEmail.trim().toLowerCase())
            .single();

        if (!userError && existingUser) {
            return sendError(res, 409, "Er bestaat al een account met dit emailadres.", null, req);
        }

        // Hash password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(adminPassword, saltRounds);

        // Prepare mosque data (aangepast voor jouw schema)
        const mosqueData = {
            name: mosqueName.trim(),
            subdomain: cleanSubdomain,
            address: address?.trim() || null,
            city: city?.trim() || null,
            zipcode: zipcode?.trim()?.toUpperCase() || null,
            phone: phone?.trim() || null,
            website: website?.trim() || null,
            email: email?.trim()?.toLowerCase() || adminEmail.trim().toLowerCase(),
            subscription_status: 'trialing', // Start met trial
            trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 dagen trial
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        console.log('Creating mosque with data:', mosqueData);

        // Insert mosque into database
        const { data: newMosque, error: mosqueInsertError } = await supabase
            .from('mosques')
            .insert(mosqueData)
            .select()
            .single();

        if (mosqueInsertError) {
            console.error('Mosque insertion error:', mosqueInsertError);
            
            if (mosqueInsertError.code === '23505') { // unique violation
                if (mosqueInsertError.detail?.includes('subdomain')) {
                    return sendError(res, 409, "Dit subdomein is al in gebruik.", null, req);
                }
            }
            
            throw mosqueInsertError;
        }

        console.log('✅ Mosque created successfully:', newMosque.id);

        // Nu maak de admin user aan in de users tabel
        const adminUserData = {
            mosque_id: newMosque.id,
            email: adminEmail.trim().toLowerCase(),
            password_hash: hashedPassword,
            name: adminName.trim(),
            role: 'admin',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data: newAdminUser, error: userInsertError } = await supabase
            .from('users')
            .insert(adminUserData)
            .select()
            .single();

        if (userInsertError) {
            console.error('Admin user insertion error:', userInsertError);
            
            // Als user aanmaken faalt, verwijder ook de mosque
            await supabase.from('mosques').delete().eq('id', newMosque.id);
            
            if (userInsertError.code === '23505') { // unique violation email
                return sendError(res, 409, "Er bestaat al een account met dit emailadres.", null, req);
            }
            
            throw userInsertError;
        }

        console.log('✅ Admin user created successfully:', newAdminUser.id);

        // Verstuur welkomstmail (async, maar blokkeer niet de response)
        const emailData = {
            ...newMosque,
            admin_email: adminEmail.trim().toLowerCase(),
            admin_name: adminName.trim()
        };
        
        sendRegistrationWelcomeEmail(emailData)
            .then((emailResult) => {
                if (emailResult.success) {
                    console.log(`✅ Welcome email sent to ${adminEmail}`);
                } else {
                    console.warn(`⚠️ Failed to send welcome email: ${emailResult.error}`);
                }
            })
            .catch((emailError) => {
                console.error('Error sending welcome email:', emailError);
            });

        // Return success response immediately (zonder gevoelige info)
        const responseData = {
            id: newMosque.id,
            name: newMosque.name,
            subdomain: newMosque.subdomain,
            admin_email: adminEmail.trim().toLowerCase(),
            admin_name: adminName.trim(),
            subscription_status: newMosque.subscription_status,
            trial_ends_at: newMosque.trial_ends_at,
            created_at: newMosque.created_at
        };

        res.status(201).json({
            success: true,
            message: `Moskee "${newMosque.name}" succesvol geregistreerd!`,
            mosque: responseData
        });

        console.log('=== MOSQUE REGISTRATION COMPLETE ===');

    } catch (error) {
        console.error('Mosque registration error:', error);
        sendError(res, 500, 'Er is een fout opgetreden bij het registreren van de moskee.', error.message, req);
    }
});

// POST resend welcome email - ✅ AANGEPAST VOOR JOUW SCHEMA
router.post('/:mosqueId/resend-welcome-email', async (req, res) => {
    try {
        // Alleen voor admins van de eigen moskee
        if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
            return sendError(res, 403, "Niet geautoriseerd.", null, req);
        }

        // Haal mosque gegevens op
        const { data: mosque, error: mosqueError } = await supabase
            .from('mosques')
            .select('*')
            .eq('id', req.params.mosqueId)
            .single();

        if (mosqueError || !mosque) {
            return sendError(res, 404, "Moskee niet gevonden.", null, req);
        }

        // Haal admin user gegevens op
        const { data: adminUser, error: userError } = await supabase
            .from('users')
            .select('name, email')
            .eq('mosque_id', req.params.mosqueId)
            .eq('role', 'admin')
            .single();

        if (userError || !adminUser) {
            return sendError(res, 404, "Admin gebruiker niet gevonden.", null, req);
        }

        // Combineer data voor email
        const emailData = {
            ...mosque,
            admin_email: adminUser.email,
            admin_name: adminUser.name
        };

        const emailResult = await sendRegistrationWelcomeEmail(emailData);

        if (emailResult.success) {
            res.json({ 
                success: true, 
                message: 'Welkomstmail opnieuw verstuurd.' 
            });
        } else {
            throw new Error(emailResult.error);
        }

    } catch (error) {
        console.error('Error resending welcome email:', error);
        sendError(res, 500, 'Fout bij versturen welkomstmail.', error.message, req);
    }
});

// POST resend welcome email - ✅ OPTIONELE EXTRA FUNCTIONALITEIT
router.post('/:mosqueId/resend-welcome-email', async (req, res) => {
    try {
        // Alleen voor admins van de eigen moskee
        if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
            return sendError(res, 403, "Niet geautoriseerd.", null, req);
        }

        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('*')
            .eq('id', req.params.mosqueId)
            .single();

        if (error || !mosque) {
            return sendError(res, 404, "Moskee niet gevonden.", null, req);
        }

        const emailResult = await sendRegistrationWelcomeEmail(mosque);

        if (emailResult.success) {
            res.json({ 
                success: true, 
                message: 'Welkomstmail opnieuw verstuurd.' 
            });
        } else {
            throw new Error(emailResult.error);
        }

    } catch (error) {
        console.error('Error resending welcome email:', error);
        sendError(res, 500, 'Fout bij versturen welkomstmail.', error.message, req);
    }
});

// GET mosque details by subdomain (public, for login page) - ✅ GECORRIGEERD
router.get('/subdomain/:subdomain', async (req, res) => {
    try {
        const { subdomain } = req.params;
        
        // ✅ GECORRIGEERD: Selecteer ALLE velden inclusief M365 configuratie
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('*') // Selecteer alle velden
            .eq('subdomain', subdomain.toLowerCase().trim())
            .single();

        if (error || !mosque) return sendError(res, 404, 'Moskee niet gevonden.', null, req);
        
        // ✅ BELANGRIJK: Verwijder gevoelige informatie voor publieke route
        delete mosque.m365_client_secret; // Verwijder client secret uit response
        
        res.json(mosque);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen moskee.', error.message, req);
    }
});

// GET full mosque details by ID (for admins) - ✅ DEDUPLICATED
router.get('/:mosqueId', async (req, res) => {
    if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    try {
        const { mosqueId } = req.params;
        const { data: mosque, error } = await supabase
            .from('mosques')
            .select('*')
            .eq('id', mosqueId)
            .single();
        if (error || !mosque) return sendError(res, 404, 'Moskee niet gevonden.', null, req);

        // Verwijder gevoelige info voordat je terugstuurt
        delete mosque.m365_client_secret;

        res.json(mosque);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen moskee.', error.message, req);
    }
});

// PUT update general mosque details - ✅ UITGEBREID met contactpersonen
router.put('/:mosqueId', async (req, res) => {
    if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    try {
        const { mosqueId } = req.params;
        const { 
            name, address, city, zipcode, phone, email, website,
            contact_committee_name, contact_committee_email // ✅ NIEUWE VELDEN
        } = req.body;
        
        if (!name) return sendError(res, 400, "Moskeenaam is verplicht.", null, req);
        
        const updatePayload = {
            name, address, city, zipcode, phone, email, website,
            contact_committee_name, contact_committee_email, // ✅ NIEUWE VELDEN
            updated_at: new Date()
        };
        
        const { data, error } = await supabase
            .from('mosques')
            .update(updatePayload)
            .eq('id', mosqueId)
            .select()
            .single();
            
        if (error) throw error;
        
        // Verwijder gevoelige info uit response
        delete data.m365_client_secret;
        
        res.json({ success: true, message: "Moskeegegevens bijgewerkt.", data });
    } catch (error) {
        sendError(res, 500, "Fout bij bijwerken moskeegegevens.", error.message, req);
    }
});

// PUT update M365 settings - ✅ VERBETERD met logging
router.put('/:mosqueId/m365-settings', async (req, res) => {
    if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    try {
        const { mosqueId } = req.params;
        const { m365_tenant_id, m365_client_id, m365_client_secret, m365_sender_email, m365_configured } = req.body;
        
        console.log(`[M365 Settings] Updating for mosque ${mosqueId}:`, {
            tenant_id: !!m365_tenant_id,
            client_id: !!m365_client_id,
            sender_email: !!m365_sender_email,
            client_secret_provided: !!m365_client_secret,
            configured_flag: m365_configured
        });
        
        const updatePayload = {
            m365_tenant_id,
            m365_client_id,
            m365_sender_email,
            m365_configured: !!m365_configured, // ✅ Force boolean
            updated_at: new Date()
        };
        
        // Alleen client secret updaten als het expliciet wordt meegegeven
        if (m365_client_secret && m365_client_secret.trim() !== '') {
            updatePayload.m365_client_secret = m365_client_secret;
            console.log(`[M365 Settings] Client secret will be updated`);
        }

        const { data, error } = await supabase
            .from('mosques')
            .update(updatePayload)
            .eq('id', mosqueId)
            .select() // ✅ Selecteer alle velden na update
            .single();
            
        if (error) throw error;
        
        console.log(`[M365 Settings] Update successful. New m365_configured value:`, data.m365_configured);
        
        // Verwijder de secret UITSLUITEND uit de respons die naar de frontend gaat.
        // Hij is wel opgeslagen in de database.
        delete data.m365_client_secret;

        res.json({ success: true, message: "M365 instellingen bijgewerkt.", data });
    } catch (error) {
        console.error(`[M365 Settings] Error updating settings:`, error);
        sendError(res, 500, "Fout bij bijwerken M365 instellingen.", error.message, req);
    }
});

// PUT update contribution settings - ✅ ONGEWIJZIGD
router.put('/:mosqueId/contribution-settings', async (req, res) => {
    if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    try {
        const { mosqueId } = req.params;
        const { contribution_1_child, contribution_2_children, contribution_3_children, contribution_4_children, contribution_5_plus_children } = req.body;
        
        const updatePayload = {
            contribution_1_child, contribution_2_children, contribution_3_children,
            contribution_4_children, contribution_5_plus_children, updated_at: new Date()
        };

        const { data, error } = await supabase.from('mosques').update(updatePayload).eq('id', mosqueId).select().single();
        if (error) throw error;
        
        // Verwijder gevoelige info uit response
        delete data.m365_client_secret;
        
        res.json({ success: true, message: "Instellingen voor bijdrage succesvol opgeslagen.", data });
    } catch (error) {
        sendError(res, 500, "Fout bij opslaan bijdrage-instellingen.", error.message, req);
    }
});

module.exports = router;