// routes/classRoutes.js
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');

// GET all classes for a mosque
router.get('/mosque/:mosqueId', async (req, res) => {
    // Iedereen van de juiste moskee mag de klassenlijst ophalen.
    if (!req.user || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    try {
        const { data, error } = await supabase
            .from('classes')
            .select('*, teacher:teacher_id(id, name), students(count)')
            .eq('mosque_id', req.params.mosqueId)
            .eq('active', true) // Standaard alleen actieve klassen
            .order('name', { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen klassen.', error.message, req);
    }
});

// GET a single class by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('classes')
            .select('*, teacher:teacher_id(id, name), students:students(*, parent:parent_id(id, name, email))')
            .eq('id', id)
            .single();

        if (error || !data) return sendError(res, 404, 'Klas niet gevonden.', null, req);
        if (req.user.mosque_id !== data.mosque_id) return sendError(res, 403, "Niet geautoriseerd.", null, req);
        
        // Een leraar mag alleen zijn eigen klasdetails zien
        if (req.user.role === 'teacher' && req.user.id !== data.teacher_id) {
            return sendError(res, 403, "U heeft geen toegang tot deze klas.", null, req);
        }

        res.json(data);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen klas.', error.message, req);
    }
});

// POST (create) a new class
router.post('/', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins mogen klassen aanmaken.", null, req);
    }
    try {
        const { mosque_id, name, teacher_id, description } = req.body;
        if (!mosque_id || !name || !teacher_id) return sendError(res, 400, "Verplichte velden (mosque_id, name, teacher_id) ontbreken.", null, req);
        if (req.user.mosque_id !== mosque_id) return sendError(res, 403, "U kunt alleen klassen toevoegen aan uw eigen moskee.", null, req);

        const { data: newClass, error } = await supabase
            .from('classes')
            .insert({ mosque_id, name, teacher_id, description, active: true })
            .select()
            .single();
        if (error) throw error;
        res.status(201).json({ success: true, message: 'Klas aangemaakt.', class: newClass });
    } catch (error) {
        sendError(res, 500, 'Fout bij aanmaken klas.', error.message, req);
    }
});

// PUT (update) a class
router.put('/:id', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins mogen klassen wijzigen.", null, req);
    }
    try {
        const { id } = req.params;
        const { data: classToUpdate, error: fetchErr } = await supabase.from('classes').select('mosque_id').eq('id', id).single();
        if (fetchErr || !classToUpdate) return sendError(res, 404, 'Klas niet gevonden.', null, req);
        if (req.user.mosque_id !== classToUpdate.mosque_id) return sendError(res, 403, "Niet geautoriseerd.", null, req);

        const { name, teacher_id, description, active } = req.body;
        const { data, error } = await supabase
            .from('classes')
            .update({ name, teacher_id, description, active, updated_at: new Date() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        res.json({ success: true, message: 'Klas bijgewerkt.', class: data });
    } catch (error) {
        sendError(res, 500, 'Fout bij bijwerken klas.', error.message, req);
    }
});

// DELETE a class
router.put('/:id/deactivate', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins mogen klassen deactiveren.", null, req);
    }
    try {
        const { id } = req.params;
        const { data: classToDeactivate, error: fetchErr } = await supabase.from('classes').select('mosque_id').eq('id', id).single();
        if (fetchErr || !classToDeactivate) return sendError(res, 404, 'Klas niet gevonden.', null, req);
        if (req.user.mosque_id !== classToDeactivate.mosque_id) return sendError(res, 403, "Niet geautoriseerd.", null, req);

        const { error } = await supabase
            .from('classes')
            .update({ active: false, updated_at: new Date() })
            .eq('id', id);
        
        if (error) throw error;
        res.json({ success: true, message: 'Klas is gedeactiveerd en verborgen.' });
    } catch (error) {
        sendError(res, 500, 'Fout bij deactiveren klas.', error.message, req);
    }
});

module.exports = router;