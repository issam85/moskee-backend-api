// routes/emailRoutes.js - Fixed version zonder RPC dependency
const router = require('express').Router();
const { supabase } = require('../config/database');
// ✅ UPDATED: Gebruik de intelligente sendEmail functie
const { sendEmail } = require('../services/emailService');
const { sendError } = require('../utils/errorHelper');
const axios = require('axios');
const {
    generateParentToTeacherEmail,
    generateTeacherToParentEmail,
    generateTeacherToClassEmail,
    generateGenericEmail
} = require('../services/emailTemplates');

// POST send a generic email from logged-in user to any recipient
// ✅ FIXED: POST send a generic email met mooie template
router.post('/send-generic', async (req, res) => {
    const sender = req.user;
    const { recipientEmail, subject, body } = req.body;

    if (!recipientEmail || !subject || !body) {
        return sendError(res, 400, "Ontvanger, onderwerp en bericht zijn verplicht.", null, req);
    }
    
    try {
        console.log(`📧 [EmailRoutes] Generic email from ${sender.name} to ${recipientEmail}`);

        // Haal ontvanger info op (als het een gebruiker in het systeem is)
        let recipientInfo = { name: recipientEmail, email: recipientEmail, role: 'Onbekend' };
        
        try {
            const { data: recipient } = await supabase
                .from('users')
                .select('name, email, role')
                .eq('email', recipientEmail.toLowerCase())
                .single();
            
            if (recipient) {
                recipientInfo = recipient;
            }
        } catch (lookupError) {
            console.log(`[EmailRoutes] Recipient ${recipientEmail} not found in system, using email as name`);
        }

        // Bepaal email context gebaseerd op rollen
        let emailContext = 'algemeen';
        if (sender.role === 'admin') emailContext = 'admin';
        if (sender.role === 'parent' && recipientInfo.role === 'teacher') emailContext = 'parent_to_teacher';
        if (sender.role === 'teacher' && recipientInfo.role === 'parent') emailContext = 'teacher_to_parent';

        // ✅ FIXED: ALLEEN de template logica - geen hardcoded HTML meer!
        let emailBodyHtml;
        if (emailContext === 'parent_to_teacher') {
            // Probeer studentInfo te vinden voor betere personalisatie
            let studentInfo = null;
            try {
                const { data: student } = await supabase
                    .from('students')
                    .select('name')
                    .eq('parent_id', sender.id)
                    .eq('active', true)
                    .single();
                
                if (student) {
                    studentInfo = { name: student.name };
                }
            } catch (studentError) {
                // Geen probleem als student niet gevonden - email werkt zonder
                console.log(`[EmailRoutes] No student found for parent ${sender.name}`);
            }

            emailBodyHtml = generateParentToTeacherEmail(
                { name: sender.name, email: sender.email, role: sender.role },
                recipientInfo,
                subject,
                body,
                studentInfo
            );
        } else if (emailContext === 'teacher_to_parent') {
            emailBodyHtml = generateTeacherToParentEmail(
                { name: sender.name, email: sender.email, role: sender.role },
                recipientInfo,
                subject,
                body
            );
        } else {
            emailBodyHtml = generateGenericEmail(
                { name: sender.name, email: sender.email, role: sender.role },
                recipientInfo,
                subject,
                body,
                emailContext
            );
        }
        
        const emailDetails = {
            to: recipientEmail,
            subject: subject,
            body: emailBodyHtml,
            mosqueId: sender.mosque_id,
            emailType: `generic_${sender.role}`,
            // ✅ FIX: Add reply-to header for parent emails so teachers can reply directly
            replyTo: emailContext === 'parent_to_teacher' ? sender.email : null
        };

        const emailResult = await sendEmail(emailDetails);
        
        if (emailResult.success) {
            console.log(`✅ [EmailRoutes] Generic email sent via ${emailResult.service}`);
            res.json({ 
                success: true, 
                message: `Email succesvol verstuurd naar ${recipientInfo.name || recipientEmail} via ${emailResult.service}.`,
                service: emailResult.service
            });
        } else {
            sendError(res, 500, `Email versturen mislukt: ${emailResult.error}`, emailResult.details, req);
        }
    } catch (error) {
        sendError(res, 500, 'Onverwachte serverfout bij versturen e-mail.', error.message, req);
    }
});

// ✅ FIXED: POST send an email from a teacher to a whole class - using new templates
router.post('/send-to-class', async (req, res) => {
    if (req.user.role !== 'teacher') return sendError(res, 403, "Alleen leraren mogen deze actie uitvoeren.", null, req);

    const { classId, subject, body } = req.body;
    const sender = req.user;

    if (!classId || !subject || !body) return sendError(res, 400, "Klas ID, onderwerp en bericht zijn verplicht.", null, req);

    try {
        console.log(`📧 [EmailRoutes] Teacher ${sender.name} sending email to class ${classId}`);

        // Stap 1: Controleer of de leraar eigenaar is van de klas
        const { data: classInfo, error: classError } = await supabase
            .from('classes').select('id, name, teacher_id').eq('id', classId).single();
        if (classError || !classInfo) return sendError(res, 404, "Klas niet gevonden.", null, req);
        if (classInfo.teacher_id !== sender.id) return sendError(res, 403, "U kunt alleen mailen naar uw eigen klassen.", null, req);

        console.log(`✅ [EmailRoutes] Class validation passed: ${classInfo.name}`);

        // Stap 2: Haal alle studenten op die in deze klas zitten
        const { data: studentsInClass, error: studentsError } = await supabase
            .from('students')
            .select('parent_id')
            .eq('class_id', classId)
            .eq('active', true);

        if (studentsError) {
            console.error('[EmailRoutes] Error fetching students:', studentsError);
            throw studentsError;
        }

        console.log(`📚 [EmailRoutes] Found ${studentsInClass?.length || 0} active students in class`);

        if (!studentsInClass || studentsInClass.length === 0) {
            return sendError(res, 404, "Geen actieve leerlingen (en dus geen ouders) gevonden voor deze klas.", null, req);
        }

        // Stap 3: Verzamel alle unieke parent_id's
        const parentIds = [...new Set(studentsInClass.map(s => s.parent_id).filter(Boolean))];

        console.log(`👨‍👩‍👧‍👦 [EmailRoutes] Found ${parentIds.length} unique parent IDs`);

        if (parentIds.length === 0) {
            return sendError(res, 404, "Geen gekoppelde ouders gevonden voor de leerlingen in deze klas.", null, req);
        }

        // Stap 4: Haal de e-mailadressen en namen op van die specifieke ouders
        const { data: parents, error: parentsError } = await supabase
            .from('users')
            .select('id, name, email')
            .in('id', parentIds)
            .eq('role', 'parent');

        if (parentsError) {
            console.error('[EmailRoutes] Error fetching parent details:', parentsError);
            throw parentsError;
        }

        console.log(`📧 [EmailRoutes] Found email addresses for ${parents?.length || 0} parents`);

        if (!parents || parents.length === 0) {
            return sendError(res, 404, "Kon de e-mailadressen van de ouders niet vinden in de gebruikersdatabase.", null, req);
        }

        console.log(`📤 [EmailRoutes] Preparing to send emails to ${parents.length} parents...`);

        // ✅ FIXED: Gebruik intelligente sendEmail functie met nieuwe template voor elk ouder
        const emailPromises = parents.map(parent => {
            console.log(`📧 [EmailRoutes] Queueing email for parent: ${parent.name} (${parent.email})`);
            
            // ✅ Use the new beautiful template
            const emailBodyHtml = generateTeacherToClassEmail(
                { name: sender.name, email: sender.email, role: sender.role },
                classInfo,
                subject,
                body,
                parent.name // Pass parent name for personalization
            );
            
            return sendEmail({
                to: parent.email,
                subject: `Bericht voor klas ${classInfo.name}: ${subject}`,
                body: emailBodyHtml,
                mosqueId: sender.mosque_id,
                emailType: 'teacher_to_class_bulk'
            });
        });
        
        // Verstuur alle emails parallel
        console.log(`⏳ [EmailRoutes] Sending ${emailPromises.length} emails...`);
        const results = await Promise.all(emailPromises);
        
        const successes = results.filter(r => r && r.success).length;
        const failures = results.length - successes;

        console.log(`✅ [EmailRoutes] Email sending completed: ${successes} success, ${failures} failed`);

        // Log successful sends
        results.forEach((result, index) => {
            const parent = parents[index];
            if (result && result.success) {
                console.log(`✅ [EmailRoutes] Email sent to ${parent.email} via ${result.service}`);
            } else {
                console.error(`❌ [EmailRoutes] Email failed for ${parent.email}:`, result?.error || 'Unknown error');
            }
        });

        res.json({ 
            success: true, 
            message: `Verstuur-opdracht voltooid. ${successes} email(s) succesvol verzonden, ${failures} mislukt.`,
            details: {
                total_parents: parents.length,
                emails_sent: successes,
                emails_failed: failures,
                class_name: classInfo.name
            }
        });

    } catch (error) {
        console.error('[EmailRoutes] Error in send-to-class:', error);
        sendError(res, 500, 'Onverwachte serverfout bij versturen van bulk-email.', error.message, req);
    }
});

// ✅ FIXED: POST send email to a specific parent - using new templates
router.post('/send-to-parent', async (req, res) => {
    if (!req.user || req.user.role !== 'teacher') {
        return sendError(res, 403, "Alleen leraren mogen deze actie uitvoeren.", null, req);
    }

    const { recipientUserId, subject, body } = req.body;
    const sender = req.user;

    if (!recipientUserId || !subject || !body) {
        return sendError(res, 400, "Ontvanger, onderwerp en bericht zijn verplicht.", null, req);
    }
    
    try {
        // Haal ontvanger info op
        const { data: recipient, error: userError } = await supabase
            .from('users')
            .select('id, email, name, mosque_id, role')
            .eq('id', recipientUserId)
            .single();
            
        if (userError || !recipient) return sendError(res, 404, "Ontvanger niet gevonden.", null, req);
        if (recipient.mosque_id !== sender.mosque_id) {
            return sendError(res, 403, "U kunt alleen mailen binnen uw eigen moskee.", null, req);
        }
        if (recipient.role !== 'parent') {
            return sendError(res, 400, "U kunt alleen emails sturen naar ouders.", null, req);
        }

        // ✅ OPTIONAL: Try to get student info for better personalization
        let studentInfo = null;
        try {
            const { data: student } = await supabase
                .from('students')
                .select('name')
                .eq('parent_id', recipient.id)
                .eq('active', true)
                .single();
            
            if (student) {
                studentInfo = { name: student.name };
            }
        } catch (studentError) {
            // No problem if student not found - email will work without it
            console.log(`[EmailRoutes] No student found for parent ${recipient.name}`);
        }

        // ✅ Use the new beautiful template
        const emailBodyHtml = generateTeacherToParentEmail(
            { name: sender.name, email: sender.email, role: sender.role },
            { name: recipient.name, email: recipient.email, role: recipient.role },
            subject,
            body,
            studentInfo // This will be null if no student found, which is fine
        );
        
        const emailDetails = {
            to: recipient.email,
            subject: subject,
            body: emailBodyHtml,
            mosqueId: sender.mosque_id,
            emailType: 'teacher_to_parent_direct'
        };

        const emailResult = await sendEmail(emailDetails);

        if (emailResult.success) {
            res.json({ 
                success: true, 
                message: `Email succesvol verstuurd naar ${recipient.name} via ${emailResult.service}.`,
                service: emailResult.service
            });
        } else {
            sendError(res, 500, `Email versturen mislukt: ${emailResult.error}`, emailResult.details, req);
        }
    } catch (error) {
        sendError(res, 500, 'Onverwachte serverfout bij versturen van e-mail.', error.message, req);
    }
});

// GET email logs for a mosque (for admins)
router.get('/logs/mosque/:mosqueId', async (req, res) => {
    if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }

    const { mosqueId } = req.params;
    const { limit = 50, offset = 0, email_type } = req.query;

    try {
        let query = supabase
            .from('email_logs')
            .select('*')
            .eq('mosque_id', mosqueId)
            .order('sent_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (email_type) {
            query = query.eq('email_type', email_type);
        }

        const { data: logs, error } = await query;
        if (error) throw error;

        res.json(logs || []);

    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen email logs.', error.message, req);
    }
});

// GET email statistics for a mosque (for admins)
router.get('/stats/mosque/:mosqueId', async (req, res) => {
    if (req.user.role !== 'admin' || req.user.mosque_id !== req.params.mosqueId) {
        return sendError(res, 403, "Niet geautoriseerd.", null, req);
    }

    const { mosqueId } = req.params;

    try {
        // Get email counts by status
        const { data: statusStats, error: statusError } = await supabase
            .from('email_logs')
            .select('sent_status')
            .eq('mosque_id', mosqueId);

        if (statusError) throw statusError;

        const stats = {
            total: statusStats.length,
            sent: statusStats.filter(log => log.sent_status === 'sent').length,
            failed: statusStats.filter(log => log.sent_status === 'failed').length
        };

        // Get recent activity (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: recentLogs, error: recentError } = await supabase
            .from('email_logs')
            .select('sent_at, sent_status')
            .eq('mosque_id', mosqueId)
            .gte('sent_at', thirtyDaysAgo.toISOString());

        if (recentError) throw recentError;

        stats.recent_30_days = {
            total: recentLogs.length,
            sent: recentLogs.filter(log => log.sent_status === 'sent').length,
            failed: recentLogs.filter(log => log.sent_status === 'failed').length
        };

        res.json(stats);

    } catch (error) {
        sendError(res, 500, 'Fout bij ophalen email statistieken.', error.message, req);
    }
});

// ✅ SIMPLIFIED: Test endpoint voor email functionaliteit
router.post('/test-simple', async (req, res) => {
    try {
        const { to, subject, body, mosqueId } = req.body;
        
        if (!to || !subject || !body) {
            return sendError(res, 400, 'To, subject en body zijn verplicht.', null, req);
        }

        console.log(`🧪 [EmailRoutes] Test email request: ${to}`);

        const emailDetails = {
            to: to,
            subject: subject || 'Test Email',
            body: body || '<p>Dit is een test email van MijnLVS.</p>',
            mosqueId: mosqueId || null,
            emailType: 'test_email'
        };

        const result = await sendEmail(emailDetails);
        
        if (result.success) {
            res.json({ 
                success: true, 
                message: `Test email verstuurd naar ${to} via ${result.service}`,
                service: result.service,
                messageId: result.messageId
            });
        } else {
            res.json({ 
                success: false, 
                error: result.error,
                service: result.service
            });
        }

    } catch (error) {
        console.error('Error in test-simple route:', error);
        sendError(res, 500, 'Test email mislukt.', error.message, req);
    }
});

module.exports = router;