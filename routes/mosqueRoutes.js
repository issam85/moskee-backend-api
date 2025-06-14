// routes/mosqueRoutes.js - GECORRIGEERD met volledige M365 velden
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');

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