// routes/reportRoutes.js - Extended version
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');

// GET a specific report for a student (NEW - from monster file)
router.get('/student/:studentId', async (req, res) => {
    const { studentId } = req.params;
    const { period } = req.query; 

    if (!period) return sendError(res, 400, "Een rapport-periode is vereist.", null, req);

    try {
        const { data: studentInfo, error: studentError } = await supabase
            .from('students')
            .select('*, class:class_id(teacher_id)') 
            .eq('id', studentId)
            .single();

        if (studentError || !studentInfo) {
            return sendError(res, 404, "Leerling niet gevonden.", studentError?.message, req);
        }

        const isTeacherOfClass = req.user.role === 'teacher' && studentInfo.class?.teacher_id === req.user.id;
        const isParentOfStudent = req.user.role === 'parent' && studentInfo.parent_id === req.user.id;
        const isAdminOfMosque = req.user.role === 'admin' && studentInfo.mosque_id === req.user.mosque_id;

        if (!isAdminOfMosque && !isTeacherOfClass && !isParentOfStudent) {
            return sendError(res, 403, "Niet geautoriseerd om dit rapport te bekijken.", null, req);
        }

        const { data: report, error: reportError } = await supabase
            .from('student_reports')
            .select('*')
            .eq('student_id', studentId)
            .eq('report_period', period)
            .maybeSingle(); // .maybeSingle() is perfect here, gives no error if it doesn't exist

        if (reportError) throw reportError;

        // Get attendance statistics
        const getCount = async (status) => {
            const { count, error } = await supabase
                .from('absentie_registraties')
                .select('*', { count: 'exact', head: true })
                .eq('leerling_id', studentId)
                .eq('status', status);
            return error ? 0 : count;
        };

        const [aanwezig, te_laat, afwezig_geoorloofd, afwezig_ongeoorloofd] = await Promise.all([
            getCount('aanwezig'),
            getCount('te_laat'),
            getCount('afwezig_geoorloofd'),
            getCount('afwezig_ongeoorloofd')
        ]);
        
        const attendanceStats = { aanwezig, te_laat, afwezig_geoorloofd, afwezig_ongeoorloofd };

        const finalResponse = {
            report: report || { 
                student_id: studentId, 
                report_period: period, 
                grades: {}, 
                comments: '' 
            }, // Return empty report if it doesn't exist
            attendanceStats: attendanceStats
        };
        
        res.json(finalResponse);

    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen van rapport data.', error.message, req);
    }
});

// POST (save/upsert) a report
router.post('/save', async (req, res) => {
    if (req.user.role !== 'teacher') {
        return sendError(res, 403, "Alleen leraren mogen rapporten opslaan.", null, req);
    }
    
    const { studentId, classId, mosqueId, period, grades, comments } = req.body;
    const teacherId = req.user.id;

    if (!studentId || !classId || !mosqueId || !period) {
        return sendError(res, 400, "Verplichte velden ontbreken.", null, req);
    }
    
    // Authorization check: is the teacher the teacher of this class?
    try {
        const { data: classInfo, error: classError } = await supabase
            .from('classes')
            .select('teacher_id')
            .eq('id', classId)
            .single();
        if (classError || !classInfo) return sendError(res, 404, "Klas niet gevonden.", null, req);
        if (classInfo.teacher_id !== teacherId) return sendError(res, 403, "U bent niet de leraar van deze klas.", null, req);

        const reportData = {
            student_id: studentId,
            class_id: classId,
            mosque_id: mosqueId,
            teacher_id: teacherId,
            report_period: period,
            grades: grades || {},
            comments: comments || ''
        };

        const { data, error } = await supabase
            .from('student_reports')
            .upsert(reportData, { onConflict: 'student_id, report_period' })
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, message: 'Rapport succesvol opgeslagen.', data });
    } catch (error) {
        sendError(res, 500, 'Fout bij opslaan van rapport.', error.message, req);
    }
});

// GET all reports for a class and period (for teachers)
router.get('/class/:classId', async (req, res) => {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen leraren en admins mogen klasrapporten bekijken.", null, req);
    }

    const { classId } = req.params;
    const { period } = req.query;

    if (!period) return sendError(res, 400, "Rapport periode is verplicht.", null, req);

    try {
        // Check if user has access to this class
        const { data: classInfo, error: classError } = await supabase
            .from('classes')
            .select('teacher_id, mosque_id, name')
            .eq('id', classId)
            .single();

        if (classError || !classInfo) return sendError(res, 404, "Klas niet gevonden.", null, req);

        const isTeacher = req.user.role === 'teacher' && classInfo.teacher_id === req.user.id;
        const isAdmin = req.user.role === 'admin' && classInfo.mosque_id === req.user.mosque_id;

        if (!isTeacher && !isAdmin) {
            return sendError(res, 403, "Geen toegang tot deze klas.", null, req);
        }

        // Get all reports for this class and period
        const { data: reports, error: reportsError } = await supabase
            .from('student_reports')
            .select(`
                *,
                student:student_id(id, name),
                teacher:teacher_id(name)
            `)
            .eq('class_id', classId)
            .eq('report_period', period)
            .order('student.name', { ascending: true });

        if (reportsError) throw reportsError;

        res.json({
            class: classInfo,
            period,
            reports: reports || []
        });

    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen klasrapporten.', error.message, req);
    }
});

// GET available report periods for a mosque
router.get('/mosque/:mosqueId/periods', async (req, res) => {
    const { mosqueId } = req.params;

    if (req.user.mosque_id !== mosqueId && req.user.role !== 'superadmin') {
        return sendError(res, 403, "Niet geautoriseerd voor deze moskee.", null, req);
    }

    try {
        const { data: periods, error } = await supabase
            .from('student_reports')
            .select('report_period')
            .eq('mosque_id', mosqueId)
            .order('report_period', { ascending: false });

        if (error) throw error;

        // Get unique periods
        const uniquePeriods = [...new Set(periods.map(p => p.report_period))];

        res.json(uniquePeriods);

    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen rapport periodes.', error.message, req);
    }
});

// DELETE a report (for teachers/admins)
router.delete('/:reportId', async (req, res) => {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen leraren en admins mogen rapporten verwijderen.", null, req);
    }

    const { reportId } = req.params;

    try {
        // Check if report exists and get details
        const { data: report, error: fetchError } = await supabase
            .from('student_reports')
            .select(`
                id,
                teacher_id,
                mosque_id,
                student:student_id(name),
                report_period
            `)
            .eq('id', reportId)
            .single();

        if (fetchError || !report) return sendError(res, 404, "Rapport niet gevonden.", null, req);

        // Authorization check
        const isTeacher = req.user.role === 'teacher' && report.teacher_id === req.user.id;
        const isAdmin = req.user.role === 'admin' && report.mosque_id === req.user.mosque_id;

        if (!isTeacher && !isAdmin) {
            return sendError(res, 403, "Geen toestemming om dit rapport te verwijderen.", null, req);
        }

        // Delete the report
        const { error: deleteError } = await supabase
            .from('student_reports')
            .delete()
            .eq('id', reportId);

        if (deleteError) throw deleteError;

        res.json({ 
            success: true, 
            message: `Rapport voor ${report.student.name} (${report.report_period}) succesvol verwijderd.` 
        });

    } catch (error) {
        sendError(res, 500, 'Fout bij verwijderen rapport.', error.message, req);
    }
});

module.exports = router;