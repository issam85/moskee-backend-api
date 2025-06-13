// routes/quranRoutes.js - Extended version
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');

// GET Qor'aan progress for a single student
router.get('/student/:studentId/progress', async (req, res) => {
    const { studentId } = req.params;
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
            return sendError(res, 403, 'Geen toegang tot de voortgang van deze leerling.', null, req);
        }

        const { data: progress, error: progressError } = await supabase
            .from('quran_progress')
            .select('*')
            .eq('student_id', studentId)
            .order('soerah_number', { ascending: true });

        if (progressError) throw progressError;
        res.json(progress || []);
    } catch (error) {
        sendError(res, 500, 'Serverfout bij laden voortgang.', error.message, req);
    }
});

// POST (update/upsert) Qor'aan progress for a student
router.post('/student/:studentId/progress', async (req, res) => {
    if (req.user.role !== 'teacher') return sendError(res, 403, "Alleen leraren mogen voortgang bijwerken.", null, req);
    
    const { studentId } = req.params;
    const { soerah_number, soerah_name, status, notes } = req.body;
    
    if (!soerah_number || !soerah_name || !status) {
        return sendError(res, 400, 'Soerah nummer, naam en status zijn verplicht.', null, req);
    }

    try {
        const { data: student, error: studentError } = await supabase
            .from('students')
            .select('id, class:class_id(teacher_id)')
            .eq('id', studentId)
            .single();
        if (studentError || !student) return sendError(res, 404, 'Leerling niet gevonden.', null, req);
        if (student.class?.teacher_id !== req.user.id) {
            return sendError(res, 403, 'U kunt alleen voortgang bijwerken voor leerlingen in uw eigen klassen.', null, req);
        }

        const progressData = {
            student_id: studentId,
            soerah_number: parseInt(soerah_number),
            soerah_name,
            status,
            notes,
            updated_by_teacher_id: req.user.id,
            date_completed: status === 'voltooid' ? new Date().toISOString() : null
        };

        const { data: updatedProgress, error: progressError } = await supabase
            .from('quran_progress')
            .upsert(progressData, { onConflict: 'student_id, soerah_number' })
            .select()
            .single();

        if (progressError) throw progressError;
        res.json({ success: true, message: 'Voortgang bijgewerkt.', data: updatedProgress });
    } catch (error) {
        sendError(res, 500, 'Serverfout bij bijwerken voortgang.', error.message, req);
    }
});

// NEW: GET Quran progress for mosque/student (from monster file)
router.get('/mosque/:mosqueId/students/:studentId/progress', async (req, res) => {
    try {
        const { mosqueId, studentId } = req.params;
        const userId = req.user.id;

        console.log(`[GET Quran Progress] User ${userId} requesting progress for student ${studentId}`);

        // Verify access: teacher of class OR parent of student
        const { data: student, error: studentError } = await supabase
            .from('students')
            .select(`
                id, 
                name, 
                parent_id,
                class_id,
                classes!inner(teacher_id)
            `)
            .eq('id', studentId)
            .eq('mosque_id', mosqueId)
            .single();

        if (studentError || !student) {
            return sendError(res, 404, 'Leerling niet gevonden', null, req);
        }

        // Check authorization
        const isTeacher = String(student.classes.teacher_id) === String(userId);
        const isParent = String(student.parent_id) === String(userId);
        const isAdmin = req.user.role === 'admin' && req.user.mosque_id === mosqueId;

        if (!isTeacher && !isParent && !isAdmin) {
            return sendError(res, 403, 'Geen toegang tot voortgang van deze leerling', null, req);
        }

        // Get Quran progress
        const { data: progress, error: progressError } = await supabase
            .from('quran_progress')
            .select('*')
            .eq('student_id', studentId)
            .order('soerah_number', { ascending: true });

        if (progressError) {
            console.error('[GET Quran Progress] Database error:', progressError);
            return sendError(res, 500, 'Kon voortgang niet laden', null, req);
        }

        console.log(`[GET Quran Progress] Found ${progress?.length || 0} progress records for student ${studentId}`);
        res.json(progress || []);

    } catch (error) {
        console.error('[GET Quran Progress] Error:', error);
        sendError(res, 500, 'Server fout bij laden voortgang', error.message, req);
    }
});

// NEW: POST Quran progress update for mosque/student (from monster file)
router.post('/mosque/:mosqueId/students/:studentId/progress', async (req, res) => {
    try {
        const { mosqueId, studentId } = req.params;
        const { 
            soerah_number, 
            soerah_name, 
            status, 
            notes 
        } = req.body;
        const userId = req.user.id;

        console.log(`[UPDATE Quran Progress] Teacher ${userId} updating soerah ${soerah_number} for student ${studentId} to status: ${status}`);

        // Validation
        if (!soerah_number || !soerah_name || !status) {
            return sendError(res, 400, 'Soerah nummer, naam en status zijn verplicht', null, req);
        }

        if (!['niet_begonnen', 'bezig', 'voltooid', 'herhaling'].includes(status)) {
            return sendError(res, 400, 'Ongeldige status', null, req);
        }

        if (req.user.role !== 'teacher') {
            return sendError(res, 403, 'Alleen leraren mogen voortgang bijwerken', null, req);
        }

        // Verify teacher has access to this student
        const { data: student, error: studentError } = await supabase
            .from('students')
            .select(`
                id, 
                name, 
                class_id,
                classes!inner(teacher_id)
            `)
            .eq('id', studentId)
            .eq('mosque_id', mosqueId)
            .single();

        if (studentError || !student) {
            return sendError(res, 404, 'Leerling niet gevonden', null, req);
        }

        if (String(student.classes.teacher_id) !== String(userId)) {
            return sendError(res, 403, 'U kunt alleen voortgang bijwerken voor leerlingen in uw eigen klassen', null, req);
        }

        // Determine date_completed
        let date_completed = null;
        if (status === 'voltooid') {
            date_completed = new Date().toISOString().split('T')[0]; // Today
        }

        // UPSERT: Update existing record or create new one
        const { data: updatedProgress, error: progressError } = await supabase
            .from('quran_progress')
            .upsert({
                student_id: studentId,
                soerah_number: parseInt(soerah_number),
                soerah_name: soerah_name.trim(),
                status,
                date_completed,
                notes: notes?.trim() || null,
                updated_by_teacher_id: userId,
                updated_at: new Date()
            }, {
                onConflict: 'student_id,soerah_number'
            })
            .select('*')
            .single();

        if (progressError) {
            console.error('[UPDATE Quran Progress] Database error:', progressError);
            return sendError(res, 500, 'Kon voortgang niet bijwerken: ' + progressError.message, null, req);
        }

        console.log(`[UPDATE Quran Progress] Updated soerah ${soerah_number} for student ${student.name} to ${status}`);

        res.json({
            success: true,
            data: updatedProgress,
            message: `Voortgang bijgewerkt: ${soerah_name} - ${status}`
        });

    } catch (error) {
        console.error('[UPDATE Quran Progress] Error:', error);
        sendError(res, 500, 'Server fout bij bijwerken voortgang', error.message, req);
    }
});

// POST (get) bulk Qor'aan stats for multiple students (for parents)
router.post('/students/stats', async (req, res) => {
    const { student_ids } = req.body;
    if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
        return sendError(res, 400, 'student_ids array is vereist.', null, req);
    }

    try {
        // Authorization: Parents may only request their own children. Admins may request all within their mosque.
        if (req.user.role === 'parent') {
            const { data: userStudents, error } = await supabase
                .from('students').select('id').eq('parent_id', req.user.id);
            if (error) throw error;
            const userStudentIds = userStudents.map(s => s.id);
            if (student_ids.some(id => !userStudentIds.includes(id))) {
                return sendError(res, 403, 'U heeft geen toegang tot alle opgevraagde leerlingen.', null, req);
            }
        } else if (req.user.role !== 'admin') {
            return sendError(res, 403, 'Niet geautoriseerd.', null, req);
        }

        const { data: allProgress, error: progressError } = await supabase
            .from('quran_progress')
            .select('student_id, status, date_completed, soerah_name')
            .in('student_id', student_ids);
        
        if (progressError) throw progressError;

        const stats = {};
        const total_soerahs = 114;

        student_ids.forEach(studentId => {
            const studentProgress = allProgress.filter(p => p.student_id === studentId);
            const completed = studentProgress.filter(p => p.status === 'voltooid').length;
            const lastCompleted = studentProgress
                .filter(p => p.status === 'voltooid' && p.date_completed)
                .sort((a, b) => new Date(b.date_completed) - new Date(a.date_completed))[0];
            
            stats[studentId] = {
                completed,
                in_progress: studentProgress.filter(p => p.status === 'bezig').length,
                reviewing: studentProgress.filter(p => p.status === 'herhaling').length,
                completion_percentage: Math.round((completed / total_soerahs) * 100),
                last_completed: lastCompleted ? { 
                    soerah_name: lastCompleted.soerah_name, 
                    date_completed: lastCompleted.date_completed 
                } : null
            };
        });

        res.json(stats);

    } catch (error) {
        sendError(res, 500, 'Serverfout bij laden statistieken.', error.message, req);
    }
});

// NEW: Bulk Quran stats for mosque (from monster file)
router.post('/mosque/:mosqueId/students/stats', async (req, res) => {
    try {
        const { mosqueId } = req.params;
        const { student_ids } = req.body;
        const userId = req.user.id;

        console.log(`[GET Quran Stats] User ${userId} requesting stats for ${student_ids?.length || 0} students`);

        if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
            return sendError(res, 400, 'student_ids array is required', null, req);
        }

        // Verify user is parent of all requested students
        if (req.user.role === 'parent') {
            const { data: students, error: studentsError } = await supabase
                .from('students')
                .select('id, name, parent_id')
                .in('id', student_ids)
                .eq('mosque_id', mosqueId);

            if (studentsError) {
                return sendError(res, 500, 'Kon leerlingen niet laden', null, req);
            }

            // Check that all students belong to this parent
            const invalidStudents = students.filter(s => String(s.parent_id) !== String(userId));
            if (invalidStudents.length > 0) {
                return sendError(res, 403, 'Geen toegang tot alle opgevraagde leerlingen', null, req);
            }
        } else if (req.user.role !== 'admin' || req.user.mosque_id !== mosqueId) {
            return sendError(res, 403, 'Niet geautoriseerd', null, req);
        }

        // Get statistics for each student
        const stats = {};
        
        for (const studentId of student_ids) {
            const { data: progress, error: progressError } = await supabase
                .from('quran_progress')
                .select('status, date_completed, soerah_name')
                .eq('student_id', studentId);

            if (progressError) {
                console.error(`Error fetching progress for student ${studentId}:`, progressError);
                stats[studentId] = null;
                continue;
            }

            const total_soerahs = 55; // From Al-Modjaadalah to Al-Fatiha
            const completed = progress?.filter(p => p.status === 'voltooid').length || 0;
            const in_progress = progress?.filter(p => p.status === 'bezig').length || 0;
            const reviewing = progress?.filter(p => p.status === 'herhaling').length || 0;
            const completion_percentage = Math.round((completed / total_soerahs) * 100);

            // Last completed soerah
            const lastCompleted = progress
                ?.filter(p => p.status === 'voltooid' && p.date_completed)
                .sort((a, b) => new Date(b.date_completed) - new Date(a.date_completed))[0];

            stats[studentId] = {
                total_soerahs,
                completed,
                in_progress,
                reviewing,
                completion_percentage,
                last_completed: lastCompleted ? {
                    soerah_name: lastCompleted.soerah_name,
                    date_completed: lastCompleted.date_completed
                } : null
            };
        }

        console.log(`[GET Quran Stats] Returning stats for ${Object.keys(stats).length} students`);
        res.json(stats);

    } catch (error) {
        console.error('[GET Quran Stats] Error:', error);
        sendError(res, 500, 'Server fout bij laden statistieken', error.message, req);
    }
});

module.exports = router;