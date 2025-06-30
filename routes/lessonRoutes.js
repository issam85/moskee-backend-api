// routes/lessonRoutes.js
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');

// GET all lessons for a specific class within a date range
router.get('/class/:classId', async (req, res) => {
    const { classId } = req.params;
    const { startDate, endDate } = req.query;
    try {
        const { data: classInfo, error: classError } = await supabase.from('classes').select('mosque_id, teacher_id').eq('id', classId).single();
        if (classError || !classInfo) return sendError(res, 404, 'Klas niet gevonden.', null, req);
        
        const isAuthorized = (req.user.role === 'admin' && req.user.mosque_id === classInfo.mosque_id) ||
                             (req.user.role === 'teacher' && req.user.id === classInfo.teacher_id);
        if (!isAuthorized) return sendError(res, 403, 'Niet geautoriseerd voor deze klas.', null, req);

        let query = supabase.from('lessen')
            .select('*, klas:klas_id(name)')
            .eq('klas_id', classId);
        if (startDate) query = query.gte('les_datum', startDate);
        if (endDate) query = query.lte('les_datum', endDate);

        const { data, error } = await query.order('les_datum', { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen lessen.', error.message, req);
    }
});

// GET details for a single lesson, including students for attendance
router.get('/:lessonId/details-for-attendance', async (req, res) => {
    try {
        const { lessonId } = req.params;
        const { data: lesson, error } = await supabase
            .from('lessen')
            .select(`*, klas:klas_id(id, name, teacher_id, students:students(id, name, active))`)
            .eq('id', lessonId)
            .single();

        if (error || !lesson) return sendError(res, 404, 'Les niet gevonden.', null, req);
        
        const isAuthorized = (req.user.role === 'admin' && req.user.mosque_id === lesson.moskee_id) ||
                             (req.user.role === 'teacher' && req.user.id === lesson.klas.teacher_id);
        if (!isAuthorized) return sendError(res, 403, 'Niet geautoriseerd.', null, req);

        // Filter out inactive students
        if (lesson.klas && lesson.klas.students) {
            lesson.klas.students = lesson.klas.students.filter(s => s.active);
        }

        res.json(lesson);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen lesdetails.', error.message, req);
    }
});

// POST (create) a new lesson for a class
router.post('/', async (req, res) => {
    const { mosque_id, klas_id, les_datum, onderwerp } = req.body;
    if (!mosque_id || !klas_id || !les_datum) return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
    try {
        const { data: classInfo, error: classError } = await supabase.from('classes').select('mosque_id, teacher_id').eq('id', klas_id).single();
        if (classError || !classInfo) return sendError(res, 404, 'Klas niet gevonden.', null, req);
        if (req.user.mosque_id !== classInfo.mosque_id) return sendError(res, 403, 'Actie niet toegestaan.', null, req);

        const isAuthorized = (req.user.role === 'admin') || (req.user.role === 'teacher' && req.user.id === classInfo.teacher_id);
        if (!isAuthorized) return sendError(res, 403, 'Niet geautoriseerd om lessen aan te maken.', null, req);

        const { data: existingLesson } = await supabase.from('lessen').select('id').eq('klas_id', klas_id).eq('les_datum', les_datum).maybeSingle();
        if (existingLesson) return sendError(res, 409, `Er bestaat al een les voor deze klas op ${les_datum}.`, null, req);

        const lesData = { 
            ...req.body, 
            moskee_id: req.body.mosque_id, // Map English field name to Dutch database field
            les_dag_van_week: new Date(les_datum).toLocaleDateString('nl-NL', { weekday: 'long' }) 
        };
        delete lesData.mosque_id; // Remove the English field name
        const { data: newLesson, error } = await supabase.from('lessen').insert(lesData).select().single();
        if (error) throw error;
        res.status(201).json({ success: true, message: 'Les aangemaakt.', data: newLesson });
    } catch (error) {
        sendError(res, 500, 'Fout bij aanmaken les.', error.message, req);
    }
});

// PUT (update) a lesson
router.put('/:lessonId', async (req, res) => {
    const { lessonId } = req.params;
    try {
        const { data: lesson, error: fetchError } = await supabase.from('lessen').select('id, moskee_id, klas:klas_id(teacher_id)').eq('id', lessonId).single();
        if (fetchError || !lesson) return sendError(res, 404, "Les niet gevonden.", null, req);
        
        const isAuthorized = (req.user.role === 'admin' && req.user.mosque_id === lesson.moskee_id) ||
                             (req.user.role === 'teacher' && req.user.id === lesson.klas.teacher_id);
        if (!isAuthorized) return sendError(res, 403, "Niet geautoriseerd.", null, req);

        const updateData = { ...req.body, gewijzigd_op: new Date() };
        if (updateData.les_datum) {
            updateData.les_dag_van_week = new Date(updateData.les_datum).toLocaleDateString('nl-NL', { weekday: 'long' });
        }

        const { data, error } = await supabase.from('lessen').update(updateData).eq('id', lessonId).select().single();
        if (error) throw error;
        res.json({ success: true, message: 'Les bijgewerkt.', data });
    } catch (error) {
        sendError(res, 500, 'Fout bij bijwerken les.', error.message, req);
    }
});

// POST (upsert) attendance for a lesson
router.post('/:lessonId/absenties', async (req, res) => {
    const { lessonId } = req.params;
    const absentieDataArray = req.body;
    if (!Array.isArray(absentieDataArray)) return sendError(res, 400, "Body moet een array zijn.", null, req);

    try {
        const { data: lesson, error: lessonError } = await supabase.from('lessen').select('id, moskee_id, klas_id, klas:klas_id(teacher_id)').eq('id', lessonId).single();
        if (lessonError || !lesson) return sendError(res, 404, "Les niet gevonden.", null, req);

        const isAuthorized = (req.user.role === 'admin' && req.user.mosque_id === lesson.moskee_id) ||
                             (req.user.role === 'teacher' && req.user.id === lesson.klas.teacher_id);
        if (!isAuthorized) return sendError(res, 403, 'Niet geautoriseerd om absenties op te slaan.', null, req);

        const recordsToUpsert = absentieDataArray.map(item => ({
            les_id: lessonId,
            leerling_id: item.leerling_id,
            moskee_id: lesson.moskee_id,
            status: item.status,
            notities_absentie: item.notities_absentie,
            geregistreerd_door_leraar_id: req.user.id,
        }));

        const { data, error } = await supabase.from('absentie_registraties').upsert(recordsToUpsert, { onConflict: 'les_id, leerling_id' }).select();
        if (error) throw error;
        res.status(200).json({ success: true, message: 'Absenties opgeslagen.', data });
    } catch (error) {
        sendError(res, 500, `Fout bij opslaan absenties.`, error.message, req);
    }
});

// GET attendance for a specific lesson
router.get('/:lessonId/absenties', async (req, res) => {
    const { lessonId } = req.params;
    try {
        const { data: lesson, error: fetchError } = await supabase.from('lessen').select('id, moskee_id, klas:klas_id(teacher_id)').eq('id', lessonId).single();
        if (fetchError || !lesson) return sendError(res, 404, "Les niet gevonden.", null, req);
        
        const isAuthorized = (req.user.role === 'admin' && req.user.mosque_id === lesson.moskee_id) ||
                             (req.user.role === 'teacher' && req.user.id === lesson.klas.teacher_id);
        if (!isAuthorized) return sendError(res, 403, "Niet geautoriseerd.", null, req);

        const { data, error } = await supabase
            .from('absentie_registraties')
            .select('*, leerling:leerling_id(name)')
            .eq('les_id', lessonId);
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen absenties.', error.message, req);
    }
});


module.exports = router;