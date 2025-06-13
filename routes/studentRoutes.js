// routes/studentRoutes.js - Extended version
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');
const { calculateAmountDueFromStaffel } = require('../services/calculationService');

// GET all students for a mosque
router.get('/mosque/:mosqueId', async (req, res) => {
    // Iedereen van de juiste moskee mag de studentenlijst ophalen.
    if (!req.user || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }
    try {
        const { data, error } = await supabase
            .from('students')
            .select('*, parent:parent_id(id, name, email), class:class_id(id, name)')
            .eq('mosque_id', req.params.mosqueId)
            .order('name', { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen leerlingen.', error.message, req);
    }
});

// GET a single student
router.get('/:studentId', async (req, res) => {
    try {
        const { data: student, error } = await supabase
            .from('students')
            .select('*, parent:parent_id(*), class:class_id(*)')
            .eq('id', req.params.studentId)
            .single();
        if (error || !student) return sendError(res, 404, 'Leerling niet gevonden.', null, req);

        const isAuthorized = (req.user.role === 'admin' && req.user.mosque_id === student.mosque_id) ||
                             (req.user.role === 'teacher' && req.user.mosque_id === student.mosque_id) ||
                             (req.user.role === 'parent' && req.user.id === student.parent_id);
        
        if (!isAuthorized) return sendError(res, 403, "Niet geautoriseerd voor deze leerling.", null, req);
        
        res.json(student);
    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen leerling.', error.message, req);
    }
});

// POST a new student (Admin version)
router.post('/', async (req, res) => {
    const { mosque_id, parent_id, class_id, name, date_of_birth, emergency_contact, emergency_phone, notes } = req.body;
    
    if (!req.user || req.user.role !== 'admin' || req.user.mosque_id !== mosque_id) {
        return sendError(res, 403, "Niet geautoriseerd om leerlingen aan te maken voor deze moskee.", null, req);
    }
    
    try {
        if (!mosque_id || !parent_id || !class_id || !name) {
            return sendError(res, 400, "Verplichte velden (mosque_id, parent_id, class_id, name) ontbreken.", null, req);
        }
        
        const { data: student, error } = await supabase
            .from('students')
            .insert([{ mosque_id, parent_id, class_id, name, date_of_birth, emergency_contact, emergency_phone, notes }])
            .select()
            .single();
        if (error) throw error;
        
        // Update parent's amount_due
        const { data: mosqueSettings } = await supabase
            .from('mosques')
            .select('contribution_1_child, contribution_2_children, contribution_3_children, contribution_4_children, contribution_5_plus_children')
            .eq('id', mosque_id)
            .single();
        
        const { count: siblingCount } = await supabase
            .from('students')
            .select('id', { count: 'exact' })
            .eq('parent_id', parent_id)
            .eq('active', true);
        
        const newAmountDue = calculateAmountDueFromStaffel(siblingCount || 0, mosqueSettings);
        await supabase.from('users').update({ amount_due: newAmountDue }).eq('id', parent_id);
        
        res.status(201).json({ success: true, student });
    } catch (error) {
        sendError(res, 500, 'Fout bij aanmaken leerling.', error.message, req);
    }
});

// POST student by teacher (NEW - from monster file)
router.post('/mosque/:mosqueId', async (req, res) => {
    try {
        const { mosqueId } = req.params;
        const { 
            name, 
            class_id, 
            date_of_birth, 
            notes, 
            parent_email, 
            active = true 
        } = req.body;

        console.log(`[POST /api/students/mosque/${mosqueId}] Teacher adding student:`, name);

        // Validation
        if (!name || !class_id) {
            return sendError(res, 400, 'Naam en klas zijn verplicht', null, req);
        }

        if (!req.user || req.user.role !== 'teacher') {
            return sendError(res, 403, 'Alleen leraren mogen studenten toevoegen via deze route', null, req);
        }

        // Verify teacher owns the class
        const { data: classData, error: classError } = await supabase
            .from('classes')
            .select('id, name, teacher_id, mosque_id')
            .eq('id', class_id)
            .eq('mosque_id', mosqueId)
            .single();

        if (classError || !classData) {
            return sendError(res, 404, 'Klas niet gevonden', null, req);
        }

        if (String(classData.teacher_id) !== String(req.user.id)) {
            return sendError(res, 403, 'U kunt alleen leerlingen toevoegen aan uw eigen klassen', null, req);
        }

        // Find existing parent by email (optional)
        let parent_id = null;
        if (parent_email && parent_email.trim()) {
            const { data: existingParent } = await supabase
                .from('users')
                .select('id')
                .eq('email', parent_email.toLowerCase().trim())
                .eq('role', 'parent')
                .eq('mosque_id', mosqueId)
                .single();
            
            if (existingParent) {
                parent_id = existingParent.id;
                console.log(`[ADD STUDENT] Found existing parent for email: ${parent_email}`);
            }
        }

        // Add student
        const { data: newStudent, error: studentError } = await supabase
            .from('students')
            .insert({
                name: name.trim(),
                class_id,
                mosque_id: mosqueId,
                parent_id,
                date_of_birth: date_of_birth || null,
                notes: notes?.trim() || null,
                added_by_teacher_id: req.user.id,
                active,
                created_at: new Date()
            })
            .select('*')
            .single();

        if (studentError) {
            console.error('[ADD STUDENT] Database error:', studentError);
            return sendError(res, 500, 'Kon leerling niet toevoegen: ' + studentError.message, null, req);
        }

        console.log(`[ADD STUDENT] Student toegevoegd: ${newStudent.name} (ID: ${newStudent.id})`);

        res.json({
            success: true,
            data: newStudent,
            message: `Leerling ${newStudent.name} succesvol toegevoegd aan ${classData.name}`
        });

    } catch (error) {
        console.error('[ADD STUDENT] Error:', error);
        sendError(res, 500, 'Server fout bij toevoegen leerling', error.message, req);
    }
});

// PUT (update) a student
router.put('/:studentId', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins mogen leerlinggegevens wijzigen.", null, req);
    }
    try {
        const { studentId } = req.params;
        const { data: studentToUpdate, error: fetchErr } = await supabase
            .from('students').select('mosque_id').eq('id', studentId).single();
        if (fetchErr || !studentToUpdate) return sendError(res, 404, `Leerling niet gevonden.`, null, req);
        if (req.user.mosque_id !== studentToUpdate.mosque_id) return sendError(res, 403, "Niet geautoriseerd.", null, req);

        const { parent_id_before_update } = req.body;
        const updateData = { ...req.body, updated_at: new Date() };
        delete updateData.id;
        delete updateData.mosque_id;
        delete updateData.created_at;
        delete updateData.parent_id_before_update;

        const { data: updatedStudent, error: updateError } = await supabase
            .from('students').update(updateData).eq('id', studentId).select().single();
        if (updateError) throw updateError;
        
        // Recalculate contributions for old AND new parent
        const { data: mosqueSettings } = await supabase
            .from('mosques').select('*').eq('id', req.user.mosque_id).single();
        
        // Update new parent
        const { count: newParentCount } = await supabase
            .from('students').select('id', { count: 'exact' })
            .eq('parent_id', updatedStudent.parent_id).eq('active', true);
        const newAmountDue = calculateAmountDueFromStaffel(newParentCount, mosqueSettings);
        await supabase.from('users').update({ amount_due: newAmountDue }).eq('id', updatedStudent.parent_id);

        // Update old parent if different
        if (parent_id_before_update && parent_id_before_update !== updatedStudent.parent_id) {
            const { count: oldParentCount } = await supabase
                .from('students').select('id', { count: 'exact' })
                .eq('parent_id', parent_id_before_update).eq('active', true);
            const oldAmountDue = calculateAmountDueFromStaffel(oldParentCount, mosqueSettings);
            await supabase.from('users').update({ amount_due: oldAmountDue }).eq('id', parent_id_before_update);
        }

        res.json({ success: true, message: 'Leerling bijgewerkt.', student: updatedStudent });

    } catch (error) {
        sendError(res, 500, 'Fout bij bijwerken leerling.', error.message, req);
    }
});

// DELETE a student
router.delete('/:studentId', async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins mogen leerlingen verwijderen.", null, req);
    }
    try {
        const { studentId } = req.params;
        const { data: studentToDelete, error: fetchErr } = await supabase
            .from('students').select('mosque_id, parent_id').eq('id', studentId).single();
        if (fetchErr || !studentToDelete) return sendError(res, 404, `Leerling niet gevonden.`, null, req);
        if (req.user.mosque_id !== studentToDelete.mosque_id) return sendError(res, 403, "Niet geautoriseerd.", null, req);

        const { error: deleteError } = await supabase.from('students').delete().eq('id', studentId);
        if (deleteError) throw deleteError;

        // Recalculate parent contribution
        if (studentToDelete.parent_id) {
            const { data: mosqueSettings } = await supabase
                .from('mosques').select('*').eq('id', req.user.mosque_id).single();
            const { count: siblingCount } = await supabase
                .from('students').select('id', { count: 'exact' })
                .eq('parent_id', studentToDelete.parent_id).eq('active', true);
            const newAmountDue = calculateAmountDueFromStaffel(siblingCount, mosqueSettings);
            await supabase.from('users').update({ amount_due: newAmountDue }).eq('id', studentToDelete.parent_id);
        }

        res.json({ success: true, message: 'Leerling verwijderd.' });
    } catch (error) {
        sendError(res, 500, 'Fout bij verwijderen leerling.', error.message, req);
    }
});

// GET attendance history for a specific student
router.get('/:studentId/attendance-history', async (req, res) => {
    const { studentId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    
    try {
        const { data: student, error: studentError } = await supabase
            .from('students')
            .select('id, parent_id, mosque_id, class:class_id(teacher_id)')
            .eq('id', studentId)
            .single();
        if (studentError || !student) return sendError(res, 404, 'Leerling niet gevonden.', null, req);

        const isTeacher = req.user.role === 'teacher' && student.class?.teacher_id === req.user.id;
        const isParent = req.user.role === 'parent' && student.parent_id === req.user.id;
        const isAdmin = req.user.role === 'admin' && student.mosque_id === req.user.mosque_id;

        if (!isTeacher && !isParent && !isAdmin) {
            return sendError(res, 403, 'Geen toegang tot de absentiehistorie van deze leerling.', null, req);
        }

        const { data, error } = await supabase
            .from('absentie_registraties')
            .select('*, les:les_id(les_datum, onderwerp)')
            .eq('leerling_id', studentId)
            .order('les_datum', { foreignTable: 'lessen', ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;
        res.json(data);
    } catch (error) {
        sendError(res, 500, 'Serverfout bij laden absentiehistorie.', error.message, req);
    }
});

// POST attendance stats for multiple students (for parents)
router.post('/mosque/:mosqueId/attendance-stats', async (req, res) => {
    try {
        const { mosqueId } = req.params;
        const { student_ids } = req.body;

        if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
            return sendError(res, 400, 'student_ids array is required', null, req);
        }

        // Authentication check
        if (!req.user) return sendError(res, 401, "Authenticatie vereist.", null, req);
        if (req.user.mosque_id !== mosqueId) return sendError(res, 403, 'Geen toegang tot deze moskee', null, req);
        
        // For parents: check they only request their own children
        if (req.user.role === 'parent') {
            const { data: userStudents, error: studentsError } = await supabase
                .from('students')
                .select('id')
                .eq('parent_id', req.user.id);
            if (studentsError) throw studentsError;
            
            const userStudentIds = userStudents.map(s => s.id);
            if (student_ids.some(id => !userStudentIds.includes(id))) {
                return sendError(res, 403, 'Geen toegang tot alle opgevraagde leerlingen', null, req);
            }
        }

        const stats = {};

        // Helper function to get stats for ONE student
        const getStatsForStudent = async (studentId) => {
            const getCount = async (status) => {
                const { count, error } = await supabase
                    .from('absentie_registraties')
                    .select('*', { count: 'exact', head: true })
                    .eq('leerling_id', studentId)
                    .eq('status', status);
                if (error) throw error;
                return count || 0;
            };

            const [aanwezig, te_laat, afwezig_geoorloofd, afwezig_ongeoorloofd] = await Promise.all([
                getCount('aanwezig'),
                getCount('te_laat'),
                getCount('afwezig_geoorloofd'),
                getCount('afwezig_ongeoorloofd')
            ]);
            
            return { aanwezig, te_laat, afwezig_geoorloofd, afwezig_ongeoorloofd };
        };

        // Execute stats fetching for all requested students in parallel
        await Promise.all(student_ids.map(async (studentId) => {
            stats[studentId] = await getStatsForStudent(studentId);
        }));

        console.log(`[API] Correct attendance stats computed for ${Object.keys(stats).length} students`);
        res.json(stats);

    } catch (error) {
        console.error('[API] Error fetching attendance stats:', error);
        sendError(res, 500, 'Fout bij ophalen van absentie statistieken', error.message, req);
    }
});

module.exports = router;