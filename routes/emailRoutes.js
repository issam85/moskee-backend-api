// routes/emailRoutes.js - Fixed version zonder RPC dependency
const router = require('express').Router();
const { supabase } = require('../config/database');
// ✅ UPDATED: Gebruik de intelligente sendEmail functie
const { sendEmail } = require('../services/emailService');
const { sendError } = require('../utils/errorHelper');
const axios = require('axios');

// POST send a generic email from logged-in user to any recipient
router.post('/send-generic', async (req, res) => {
    const sender = req.user;
    const { recipientEmail, subject, body } = req.body;

    if (!recipientEmail || !subject || !body) {
        return sendError(res, 400, "Ontvanger, onderwerp en bericht zijn verplicht.", null, req);
    }
    
    try {
        const emailBodyHtml = `
            <p>U heeft een bericht ontvangen van <strong>${sender.name}</strong> (${sender.email}) via het MijnLVS portaal.</p>
            <hr><div style="margin: 1rem 0;">${body.replace(/\n/g, '<br>')}</div><hr>
            <p style="font-size: small; color: grey;">U kunt direct op deze e-mail reageren.</p>`;
        
        // ✅ UPDATED: Gebruik intelligente sendEmail functie
        const emailDetails = {
            to: recipientEmail,
            subject: subject,
            body: emailBodyHtml,
            mosqueId: sender.mosque_id,
            emailType: `generic_${sender.role}`
        };

        const emailResult = await sendEmail(emailDetails);
        
        if (emailResult.success) {
            res.json({ 
                success: true, 
                message: `Email succesvol verstuurd naar ${recipientEmail} via ${emailResult.service}.`,
                service: emailResult.service
            });
        } else {
            sendError(res, 500, `Email versturen mislukt: ${emailResult.error}`, emailResult.details, req);
        }
    } catch (error) {
        sendError(res, 500, 'Onverwachte serverfout bij versturen e-mail.', error.message, req);
    }
});

// ✅ COMPLETELY FIXED: POST send an email from a teacher to a whole class
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

        // ==========================================================
        // ✅ FIXED: REPLACE RPC CALL WITH DIRECT QUERIES
        // ==========================================================

        // Stap 2: Haal alle studenten op die in deze klas zitten
        const { data: studentsInClass, error: studentsError } = await supabase
            .from('students')
            .select('parent_id')
            .eq('class_id', classId)
            .eq('active', true); // Alleen emails sturen voor actieve studenten

        if (studentsError) {
            console.error('[EmailRoutes] Error fetching students:', studentsError);
            throw studentsError;
        }

        console.log(`📚 [EmailRoutes] Found ${studentsInClass?.length || 0} active students in class`);

        if (!studentsInClass || studentsInClass.length === 0) {
            return sendError(res, 404, "Geen actieve leerlingen (en dus geen ouders) gevonden voor deze klas.", null, req);
        }

        // Stap 3: Verzamel alle unieke parent_id's uit de lijst van studenten
        // De .filter(Boolean) verwijdert eventuele 'null' of 'undefined' parent_id's
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
            .eq('role', 'parent'); // Extra veiligheidscheck

        if (parentsError) {
            console.error('[EmailRoutes] Error fetching parent details:', parentsError);
            throw parentsError;
        }

        console.log(`📧 [EmailRoutes] Found email addresses for ${parents?.length || 0} parents`);

        if (!parents || parents.length === 0) {
            return sendError(res, 404, "Kon de e-mailadressen van de ouders niet vinden in de gebruikersdatabase.", null, req);
        }

        // ==========================================================
        // END OF FIX - REST OF CODE REMAINS THE SAME
        // ==========================================================

        // Maak de email content
        const emailBodyHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <h2 style="color: #15803d; margin-top: 0;">Bericht van leraar ${sender.name}</h2>
                    <p style="color: #166534; margin: 0;">Voor klas: <strong>${classInfo.name}</strong></p>
                </div>
                
                <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <h3 style="color: #374151; margin-top: 0;">📝 Onderwerp: ${subject}</h3>
                    <div style="color: #4b5563; line-height: 1.6; margin: 16px 0;">
                        ${body.replace(/\n/g, '<br>')}
                    </div>
                </div>
                
                <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="color: #6b7280; margin: 0; font-size: 14px;">
                        Dit bericht is verstuurd via MijnLVS. U kunt direct op deze email reageren om contact op te nemen met de leraar.
                    </p>
                </div>
            </div>
        `;

        console.log(`📤 [EmailRoutes] Preparing to send emails to ${parents.length} parents...`);

        // ✅ UPDATED: Gebruik intelligente sendEmail functie voor elk ouder
        const emailPromises = parents.map(parent => {
            console.log(`📧 [EmailRoutes] Queueing email for parent: ${parent.name} (${parent.email})`);
            
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

// ✅ UPDATED: POST send email to a specific parent
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

        const emailBodyHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <h2 style="color: #15803d; margin-top: 0;">Persoonlijk bericht van leraar</h2>
                    <p style="color: #166534; margin: 0;">Van: <strong>${sender.name}</strong></p>
                    <p style="color: #166534; margin: 0;">Aan: <strong>${recipient.name}</strong></p>
                </div>
                
                <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <h3 style="color: #374151; margin-top: 0;">📝 ${subject}</h3>
                    <div style="color: #4b5563; line-height: 1.6; margin: 16px 0;">
                        ${body.replace(/\n/g, '<br>')}
                    </div>
                </div>
                
                <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="color: #6b7280; margin: 0; font-size: 14px;">
                        Dit bericht is verstuurd via MijnLVS. U kunt direct op deze email reageren.
                    </p>
                </div>
            </div>
        `;
        
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