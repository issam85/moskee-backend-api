// routes/debugRoutes.js - Development troubleshooting
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');

// Only enable debug routes in development
if (process.env.NODE_ENV === 'production') {
    router.use('*', (req, res) => {
        sendError(res, 404, 'Debug routes niet beschikbaar in productie.', null, req);
    });
    module.exports = router;
    return;
}

// GET debug info about Supabase client (from monster file)
router.get('/supabase-client', (req, res) => {
    console.log("[DEBUG ROUTE] /api/debug/supabase-client HIT");
    let adminFunctionsAvailable = false;
    let getUserByEmailType = 'undefined';
    let listUsersType = 'undefined';
    let authAdminObjectExists = false;
    let availableAdminKeys = "N/A";

    if (supabase && supabase.auth && supabase.auth.admin) {
        authAdminObjectExists = true; 
        getUserByEmailType = typeof supabase.auth.admin.getUserByEmail;
        listUsersType = typeof supabase.auth.admin.listUsers;
        availableAdminKeys = Object.keys(supabase.auth.admin).join(', ');
        if (getUserByEmailType === 'function' && listUsersType === 'function') {
             adminFunctionsAvailable = true;
        }
        console.log("[DEBUG ROUTE] supabase.auth.admin object found. typeof getUserByEmail:", getUserByEmailType, "typeof listUsers:", listUsersType);
    } else {
        console.error("[DEBUG ROUTE] supabase.auth.admin object NOT found or supabase/auth is missing.");
        if (!supabase) console.error("[DEBUG ROUTE] supabase client is falsy.");
        else if (!supabase.auth) console.error("[DEBUG ROUTE] supabase.auth is falsy.");
        else if (supabase.auth && !supabase.auth.admin) console.error("[DEBUG ROUTE] supabase.auth.admin is falsy/undefined on the existing supabase.auth object.");
    }

    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    res.json({
        message: "Supabase client debug info from /api/debug/supabase-client",
        timestamp: new Date().toISOString(),
        supabaseClientExists: !!supabase,
        authObjectExists: !!(supabase && supabase.auth),
        authAdminObjectExists: authAdminObjectExists,
        adminFunctionsProperlyAvailable: adminFunctionsAvailable,
        typeOfGetUserByEmail: getUserByEmailType,
        typeOfListUsers: listUsersType,
        availableAdminKeys: availableAdminKeys,
        keyUsedForInit_Start: supabaseKey ? supabaseKey.substring(0, 10) + "..." : "KEY_NOT_SET_AT_INIT_SCOPE",
        keyUsedForInit_End: supabaseKey ? "..." + supabaseKey.substring(supabaseKey.length - 5) : "KEY_NOT_SET_AT_INIT_SCOPE"
    });
});

// GET system configuration check
router.get('/config', (req, res) => {
    res.json({
        message: "System configuration debug info",
        timestamp: new Date().toISOString(),
        environment: {
            nodeEnv: process.env.NODE_ENV || 'development',
            port: process.env.PORT || 3001,
            hasSupabaseUrl: !!process.env.SUPABASE_URL,
            hasSupabaseKey: !!process.env.SUPABASE_SERVICE_KEY,
            hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
            hasStripeWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
            hasResendKey: !!process.env.RESEND_API_KEY,
            resendDomain: process.env.RESEND_DOMAIN || 'mijnlvs.nl',
            frontendUrl: process.env.FRONTEND_URL || 'Not Set'
        },
        supabase: {
            url: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.split('.')[0] + '.supabase.co' : 'Not configured',
            keyLength: process.env.SUPABASE_SERVICE_KEY ? process.env.SUPABASE_SERVICE_KEY.length : 0,
            keyStart: process.env.SUPABASE_SERVICE_KEY ? process.env.SUPABASE_SERVICE_KEY.substring(0, 10) + '...' : 'Not Set'
        },
        email: {
            hasResendKey: !!process.env.RESEND_API_KEY,
            resendKeyLength: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.length : 0,
            resendKeyStart: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.substring(0, 12) + '...' : 'Not Set',
            domain: process.env.RESEND_DOMAIN || 'mijnlvs.nl'
        }
    });
});

// GET database connection test
router.get('/database-test', async (req, res) => {
    console.log("[DEBUG] Testing database connection...");
    
    try {
        // Test 1: Simple count query
        const { data: mosqueCount, error: mosqueError, count } = await supabase
            .from('mosques')
            .select('id', { count: 'exact', head: true });

        if (mosqueError) {
            return res.json({
                success: false,
                message: "Database connection failed",
                error: mosqueError,
                timestamp: new Date().toISOString()
            });
        }

        // Test 2: Try to fetch sample data
        const { data: sampleMosque, error: sampleError } = await supabase
            .from('mosques')
            .select('id, name, subdomain')
            .limit(1);

        const result = {
            success: true,
            message: "Database connection successful",
            timestamp: new Date().toISOString(),
            tests: {
                countQuery: {
                    success: !mosqueError,
                    mosqueCount: count,
                    error: mosqueError?.message
                },
                sampleQuery: {
                    success: !sampleError,
                    sampleData: sampleMosque,
                    error: sampleError?.message
                }
            }
        };

        console.log("[DEBUG] Database test completed:", result.success ? 'SUCCESS' : 'FAILED');
        res.json(result);

    } catch (error) {
        console.error("[DEBUG] Database test exception:", error);
        res.json({
            success: false,
            message: "Database test exception",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// GET auth system test
router.get('/auth-test', async (req, res) => {
    if (!req.user) {
        return res.json({
            success: false,
            message: "Geen gebruiker ingelogd voor auth test",
            timestamp: new Date().toISOString()
        });
    }

    try {
        // Test auth admin functions
        const adminTests = {};

        if (supabase.auth.admin) {
            try {
                const { data: authUsers, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
                adminTests.listUsers = {
                    success: !listError,
                    userCount: authUsers?.users?.length || 0,
                    error: listError?.message
                };
            } catch (e) {
                adminTests.listUsers = {
                    success: false,
                    error: e.message
                };
            }
        } else {
            adminTests.listUsers = {
                success: false,
                error: "supabase.auth.admin not available"
            };
        }

        res.json({
            success: true,
            message: "Auth system test completed",
            timestamp: new Date().toISOString(),
            currentUser: {
                id: req.user.id,
                email: req.user.email,
                role: req.user.role,
                mosque_id: req.user.mosque_id
            },
            adminTests
        });

    } catch (error) {
        res.json({
            success: false,
            message: "Auth test failed",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ✅ CORRECTED: POST test email functionality using M365
router.post('/test-email', async (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins mogen email tests uitvoeren.", null, req);
    }

    const { testEmail } = req.body;
    if (!testEmail) {
        return sendError(res, 400, "Test email adres is verplicht.", null, req);
    }

    try {
        const { sendM365EmailInternal } = require('../services/emailService');
        
        // ✅ CORRECTED: Use emailDetails object format
        const testResult = await sendM365EmailInternal({
            to: testEmail,
            subject: "MijnLVS Test Email",
            body: `
                <h2>Test Email van MijnLVS</h2>
                <p>Dit is een test email verzonden op ${new Date().toLocaleString('nl-NL')} door ${req.user.name}.</p>
                <p>Als u deze email ontvangt, dan werkt de M365 integratie correct.</p>
            `,
            mosqueId: req.user.mosque_id,
            emailType: 'debug_test_email'
        });

        res.json({
            success: testResult.success,
            message: testResult.success 
                ? `Test email succesvol verzonden naar ${testEmail}` 
                : `Test email mislukt: ${testResult.error}`,
            details: testResult.details,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        sendError(res, 500, 'Fout bij test email.', error.message, req);
    }
});

// ✅ NEW: POST test Resend email functionality
router.post('/test-resend-email', async (req, res) => {
    
    const { testEmail } = req.body;
    if (!testEmail) {
        return sendError(res, 400, "Test email adres is verplicht.", null, req);
    }

    try {
        console.log(`🧪 [DEBUG ROUTE] Testing Resend email to: ${testEmail}`);
        
        const { sendEmailViaResend } = require('../services/emailService');
        
        // ✅ CORRECTED: Use emailDetails object format
        const testResult = await sendEmailViaResend({
            to: testEmail,
            subject: "🧪 Resend Test Email van MijnLVS",
            body: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h1 style="color: #10b981;">🧪 Resend Test Email</h1>
                    <p>Deze test email werd verstuurd via Resend op ${new Date().toLocaleString('nl-NL')}.</p>
                    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <h3 style="color: #15803d; margin-top: 0;">✅ Test Details:</h3>
                        <ul style="color: #166534;">
                            <li>Service: Resend</li>
                            <li>Route: Debug Test Route</li>
                            <li>Verstuurd naar: ${testEmail}</li>
                        </ul>
                    </div>
                    <p>Als u deze email ontvangt, werkt de Resend integratie correct!</p>
                </div>
            `,
            emailType: 'debug_resend_test'
        });

        console.log(`🧪 [DEBUG ROUTE] Resend test result:`, testResult);

        res.json({
            success: testResult.success,
            message: testResult.success 
                ? `Resend test email succesvol verzonden naar ${testEmail}` 
                : `Resend test email mislukt: ${testResult.error}`,
            details: testResult,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [DEBUG ROUTE] Resend test error:`, error);
        sendError(res, 500, 'Fout bij Resend test email.', error.message, req);
    }
});

// ✅ NEW: POST test both email services
router.post('/test-all-email-services', async (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        return sendError(res, 403, "Alleen admins mogen email tests uitvoeren.", null, req);
    }

    const { testEmail } = req.body;
    if (!testEmail) {
        return sendError(res, 400, "Test email adres is verplicht.", null, req);
    }

    try {
        const { sendEmailViaResend, sendM365EmailInternal } = require('../services/emailService');
        
        console.log(`🧪 [DEBUG ROUTE] Testing all email services for: ${testEmail}`);
        
        const results = {
            resend: null,
            m365: null
        };

        // Test Resend
        try {
            results.resend = await sendEmailViaResend({
                to: testEmail,
                subject: "🧪 Resend Service Test",
                body: `
                    <h2>Resend Service Test</h2>
                    <p>Dit is een test van de Resend email service op ${new Date().toLocaleString('nl-NL')}.</p>
                `,
                emailType: 'debug_resend_test'
            });
        } catch (error) {
            results.resend = { success: false, error: error.message };
        }

        // Test M365 (only if user has mosque_id)
        if (req.user.mosque_id) {
            try {
                results.m365 = await sendM365EmailInternal({
                    to: testEmail,
                    subject: "🧪 M365 Service Test",
                    body: `
                        <h2>M365 Service Test</h2>
                        <p>Dit is een test van de M365 email service op ${new Date().toLocaleString('nl-NL')}.</p>
                    `,
                    mosqueId: req.user.mosque_id,
                    emailType: 'debug_m365_test'
                });
            } catch (error) {
                results.m365 = { success: false, error: error.message };
            }
        } else {
            results.m365 = { success: false, error: "Geen mosque_id beschikbaar voor M365 test" };
        }

        const overallSuccess = results.resend?.success || results.m365?.success;

        res.json({
            success: overallSuccess,
            message: `Email service tests voltooid voor ${testEmail}`,
            results: results,
            summary: {
                resendWorking: results.resend?.success || false,
                m365Working: results.m365?.success || false,
                totalSuccess: overallSuccess
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [DEBUG ROUTE] All email services test error:`, error);
        sendError(res, 500, 'Fout bij email services test.', error.message, req);
    }
});

// ✅ NEW: GET email service status
router.get('/email-service-status', (req, res) => {
    const hasResendKey = !!process.env.RESEND_API_KEY;
    const resendDomain = process.env.RESEND_DOMAIN || 'mijnlvs.nl';
    
    res.json({
        message: "Email service status check",
        timestamp: new Date().toISOString(),
        services: {
            resend: {
                configured: hasResendKey,
                domain: resendDomain,
                keyLength: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.length : 0,
                keyPrefix: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.substring(0, 12) + '...' : 'Not Set'
            },
            m365: {
                configured: "Per mosque basis",
                note: "M365 configuration is stored per mosque in database"
            }
        }
    });
});

// GET memory and performance info
router.get('/system-info', (req, res) => {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    res.json({
        message: "System information",
        timestamp: new Date().toISOString(),
        process: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            pid: process.pid,
            uptime: {
                seconds: Math.floor(uptime),
                formatted: formatUptime(uptime)
            }
        },
        memory: {
            rss: formatBytes(memUsage.rss),
            heapTotal: formatBytes(memUsage.heapTotal),
            heapUsed: formatBytes(memUsage.heapUsed),
            external: formatBytes(memUsage.external)
        },
        environment: {
            nodeEnv: process.env.NODE_ENV,
            hasDockerEnv: !!process.env.DOCKER_ENV,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
    });
});

// Helper functions
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = router;