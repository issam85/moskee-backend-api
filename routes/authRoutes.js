// routes/authRoutes.js - DEFINITIEVE VERSIE MET GECENTRALISEERDE PAYMENT LINKING
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');

// ✅ DIRECTE IMPORTS - geen lazy loading meer
const { linkPendingPaymentAfterRegistration } = require('../services/paymentLinkingService');

// Lazy load alleen voor email service (als die cyclische dependencies heeft)
let registrationEmailService = null;
const getRegistrationEmailService = () => {
  if (!registrationEmailService) {
    try {
      registrationEmailService = require('../services/registrationEmailService');
      console.log('✅ registrationEmailService geladen');
    } catch (error) {
      console.error('❌ Fout bij laden registrationEmailService:', error.message);
      registrationEmailService = { sendRegistrationWelcomeEmail: null };
    }
  }
  return registrationEmailService;
};

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password, subdomain } = req.body;
    if (!email || !password || !subdomain) return sendError(res, 400, 'Email, wachtwoord en subdomein zijn verplicht.', null, req);
    
    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedEmail = email.toLowerCase().trim();

    const { data: mosque, error: mosqueError } = await supabase.from('mosques').select('id').eq('subdomain', normalizedSubdomain).single();
    if (mosqueError || !mosque) return sendError(res, 404, `Moskee met subdomein '${normalizedSubdomain}' niet gevonden.`, null, req);

    const { data: { user: supabaseAuthUser, session }, error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (signInError) {
        if (signInError.message === 'Invalid login credentials') return sendError(res, 401, 'Ongeldige combinatie van email/wachtwoord.', null, req);
        return sendError(res, 401, `Authenticatiefout: ${signInError.message}`, null, req);
    }
    if (!supabaseAuthUser || !session) return sendError(res, 401, 'Ongeldige inlogpoging.', null, req);

    // Verifieer dat deze gebruiker bij deze moskee hoort
    const { data: appUser, error: appUserError } = await supabase.from('users').select('*').eq('id', supabaseAuthUser.id).eq('mosque_id', mosque.id).single();
    if (appUserError || !appUser) {
        await supabase.auth.signOut();
        return sendError(res, 401, 'Gebruiker is niet gekoppeld aan deze moskee.', null, req);
    }

    await supabase.from('users').update({ last_login: new Date() }).eq('id', appUser.id);
    
    res.json({ success: true, user: appUser, session });
  } catch (error) {
    sendError(res, 500, 'Interne serverfout tijdens login.', error.message, req);
  }
});

// POST /api/mosques/register - VERBETERDE VERSIE MET GECENTRALISEERDE PAYMENT LINKING
router.post('/mosques/register', async (req, res) => {
  try {
    const { 
      mosqueName, subdomain, adminName, adminEmail, adminPassword, 
      address, city, zipcode, phone, website, contactEmail,
      trackingId, sessionId, paymentSuccess  // ✅ NIEUWE PARAMETERS
    } = req.body;
    
    // Validatie van input
    if (!mosqueName || !subdomain || !adminName || !adminEmail || !adminPassword) {
      return sendError(res, 400, 'Verplichte registratievelden ontbreken.', null, req);
    }
    if (adminPassword.length < 8) {
      return sendError(res, 400, 'Wachtwoord moet minimaal 8 karakters lang zijn.', null, req);
    }

    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedAdminEmail = adminEmail.toLowerCase().trim();
    
    // ✅ LOG PAYMENT PARAMETERS
    console.log(`[Registration] Payment parameters received:`, {
      trackingId: trackingId ? `${trackingId.substring(0, 15)}...` : null,
      sessionId: sessionId ? `${sessionId.substring(0, 15)}...` : null,
      paymentSuccess: paymentSuccess
    });
    
    // Check subdomain
    const { data: existingSubdomain, error: subdomainError } = await supabase
      .from('mosques').select('id').eq('subdomain', normalizedSubdomain).maybeSingle();
    if (subdomainError) throw subdomainError;
    if (existingSubdomain) return sendError(res, 409, 'Dit subdomein is al in gebruik.', null, req);
    
    // Check existing users
    try {
      console.log(`Checking if user exists with email: ${normalizedAdminEmail}`);
      
      const { data: existingUsers, error: userListError } = await supabase.auth.admin.listUsers();
      
      if (!userListError && existingUsers) {
        const existingActiveUser = existingUsers.users.find(user => 
          user.email === normalizedAdminEmail && 
          !user.deleted_at && 
          user.email_confirmed_at
        );
        
        if (existingActiveUser) {
          console.log(`Active user found with email ${normalizedAdminEmail}, blocking registration`);
          return sendError(res, 409, 'Dit emailadres is al geregistreerd door een actieve gebruiker.', null, req);
        }
        
        console.log(`No active user found with email ${normalizedAdminEmail}, proceeding with registration`);
      }
    } catch (adminError) {
      console.warn("Admin API check failed, proceeding with registration attempt:", adminError.message);
    }
    
    let newMosque, supabaseAuthAdmin;

    try {
        // Stap 2 - Maak het moskee-record aan
        const now = new Date();
        const trialEnd = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000));
        
        const mosqueData = {
            name: mosqueName, 
            subdomain: normalizedSubdomain,
            email: normalizedAdminEmail,
            address: address || null,
            city: city || null,
            zipcode: zipcode || null,
            phone: phone || null,
            website: website || null,
            subscription_status: 'trialing',
            plan_type: 'trial',
            trial_started_at: now.toISOString(),
            trial_ends_at: trialEnd.toISOString(),
            max_students: 10,
            max_teachers: 2,
            m365_configured: false,
            created_at: now.toISOString()
        };

        if (contactEmail && contactEmail.trim() && contactEmail.trim() !== normalizedAdminEmail) {
            mosqueData.email = contactEmail.trim().toLowerCase();
        }

        const { data, error } = await supabase.from('mosques').insert([mosqueData]).select().single();
        if (error) throw error;
        newMosque = data;

        console.log(`✅ [Registration] Mosque created with trial: ${newMosque.trial_started_at} -> ${newMosque.trial_ends_at}`);

        // Stap 3: Maak de Supabase Auth gebruiker aan
        console.log(`Creating auth user for email: ${normalizedAdminEmail}`);
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: normalizedAdminEmail,
            password: adminPassword,
            email_confirm: true,
            user_metadata: { name: adminName, role: 'admin' }
        });
        
        if (authError) {
          console.error("Auth user creation failed:", authError);
          
          if (authError.message && (
            authError.message.includes('User already registered') ||
            authError.message.includes('already been registered') ||
            authError.code === '422'
          )) {
            throw new Error('EMAIL_ALREADY_EXISTS');
          }
          
          throw authError;
        }
        
        supabaseAuthAdmin = authData.user;
        console.log(`Auth user created successfully: ${supabaseAuthAdmin.id}`);
        
        // Stap 4: Maak het profiel aan in de public.users tabel
        const { data: newAppAdmin, error: appAdminError } = await supabase.from('users').insert([{
            id: supabaseAuthAdmin.id,
            mosque_id: newMosque.id,
            email: normalizedAdminEmail,
            name: adminName,
            role: 'admin',
            created_at: new Date().toISOString()
        }]).select('id, email, name, role').single();
        
        if (appAdminError) {
          console.error("App user creation failed:", appAdminError);
          throw appAdminError;
        }

        console.log(`✅ Registration completed successfully for ${normalizedAdminEmail}`);
        
        // ✅ GECENTRALISEERDE PAYMENT LINKING - GEBRUIK DE SERVICE
        if (sessionId || trackingId) {
          try {
            console.log(`🔗 [Registration] Attempting session-based payment linking...`);
            
            // Call de nieuwe session-based endpoint direct
            const { findPaymentBySession } = require('../services/sessionLinkingService');
            
            let pendingPayment = null;
            
            if (sessionId) {
              pendingPayment = await findPaymentBySession(sessionId);
              console.log(`[Registration] Session lookup result:`, !!pendingPayment);
            }
            
            if (pendingPayment) {
              const { executeSessionBasedLinking } = require('../services/sessionLinkingService');
              const result = await executeSessionBasedLinking(newMosque.id, pendingPayment, sessionId);
              
              paymentLinked = true;
              linkingResult = {
                success: true,
                strategy: 'session_id',
                planType: result.planType,
                subscriptionId: pendingPayment.stripe_subscription_id,
                stripeCustomerId: pendingPayment.stripe_customer_id
              };
              
              // Update mosque object
              newMosque.subscription_status = 'active';
              newMosque.plan_type = result.planType;
              newMosque.trial_ends_at = null;
              
              console.log(`✅ [Registration] Payment linked via session_id!`);
            }
          } catch (linkingError) {
            console.error('[Registration] Session linking failed:', linkingError);
            linkingResult = { success: false, error: linkingError.message };
          }
        }
        
        // ✅ WELCOME EMAIL met verbeterde error handling
        let welcomeEmailSent = false;
        try {
          console.log(`📧 [Registration] Sending welcome email to ${normalizedAdminEmail}...`);
          
          const emailService = getRegistrationEmailService();
          
          if (emailService.sendRegistrationWelcomeEmail && typeof emailService.sendRegistrationWelcomeEmail === 'function') {
            const welcomeEmailData = {
              mosque: {
                id: newMosque.id,
                name: newMosque.name,
                subdomain: newMosque.subdomain,
                email: newMosque.email,
                address: newMosque.address,
                city: newMosque.city,
                zipcode: newMosque.zipcode,
                phone: newMosque.phone,
                website: newMosque.website,
                m365_configured: newMosque.m365_configured || false
              },
              admin: {
                id: newAppAdmin.id,
                name: adminName,
                email: normalizedAdminEmail,
                role: 'admin'
              }
            };

            const emailResult = await emailService.sendRegistrationWelcomeEmail(welcomeEmailData);
            
            if (emailResult && emailResult.success) {
              console.log(`✅ [Registration] Welcome email sent successfully to ${normalizedAdminEmail} via ${emailResult.service}`);
              welcomeEmailSent = true;
            } else {
              console.warn(`⚠️ [Registration] Welcome email failed for ${normalizedAdminEmail}:`, emailResult ? emailResult.error : 'Unknown error');
            }
          } else {
            console.error(`❌ [Registration] sendRegistrationWelcomeEmail is not available`);
          }
        } catch (emailError) {
          console.error(`❌ [Registration] Error sending welcome email to ${normalizedAdminEmail}:`, emailError);
        }
        
        // ✅ SUCCESS RESPONSE MET DETAILED PAYMENT INFO
        let successMessage = `Welkom bij MijnLVS, ${newMosque.name}! Uw 14-dagen proefperiode is gestart.`;
        let responseData = {
          success: true, 
          message: successMessage, 
          mosque: newMosque, 
          admin: newAppAdmin,
          welcome_email_sent: welcomeEmailSent,
          payment_linked: paymentLinked,
          subscription_status: newMosque.subscription_status,
          trial_ends_at: newMosque.trial_ends_at
        };
        
        if (paymentLinked) {
          successMessage = `Welkom bij MijnLVS, ${newMosque.name}! Uw Professional account is direct actief.`;
          responseData.message = successMessage;
          responseData.linking_strategy = linkingResult.strategy;
          responseData.plan_type = linkingResult.planType;
        } else if (linkingResult && linkingResult.reason) {
          // Provide detailed info about why linking didn't work
          responseData.linking_info = {
            reason: linkingResult.reason,
            strategy: linkingResult.strategy || 'none',
            error: linkingResult.error
          };
        }
        
        res.status(201).json(responseData);

    } catch (error) {
        // Rollback code (unchanged)
        console.error("!!! REGISTRATION ERROR - STARTING ROLLBACK !!!");
        console.error("Error details:", {
          message: error.message,
          code: error.code,
          status: error.status
        });
        
        try {
          if (supabaseAuthAdmin) {
            console.log(`Rollback: Deleting auth user ${supabaseAuthAdmin.id}...`);
            const { error: deleteError } = await supabase.auth.admin.deleteUser(
              supabaseAuthAdmin.id, 
              true
            );
            if (deleteError) {
              console.error("Failed to delete auth user during rollback:", deleteError);
            } else {
              console.log("✅ Auth user deleted successfully");
            }
          }
          
          if (newMosque) {
            console.log(`Rollback: Deleting mosque ${newMosque.id}...`);
            const { error: mosqueDeleteError } = await supabase
              .from('mosques')
              .delete()
              .eq('id', newMosque.id);
            if (mosqueDeleteError) {
              console.error("Failed to delete mosque during rollback:", mosqueDeleteError);
            } else {
              console.log("✅ Mosque deleted successfully");
            }
          }
        } catch (rollbackError) {
          console.error("!!! ROLLBACK FAILED !!!", rollbackError);
        }

        if (error.message === 'EMAIL_ALREADY_EXISTS') {
          return sendError(res, 409, 'Dit emailadres is al geregistreerd.', null, req);
        }
        
        if (error.message && error.message.includes('subdomain')) {
          return sendError(res, 409, 'Dit subdomein is al in gebruik.', null, req);
        }
        
        const friendlyMessage = 'Registratie mislukt. Probeer het opnieuw of neem contact op met support.';
        return sendError(res, 500, friendlyMessage, error.message, req);
    }
  } catch (outerError) {
    console.error("!!! OUTER REGISTRATION ERROR !!!", outerError);
    return sendError(res, 500, 'Interne serverfout tijdens registratie.', outerError.message, req);
  }
});

// Test routes (unchanged)
router.post('/mosques/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return sendError(res, 400, 'Email is verplicht.', null, req);
    
    const normalizedEmail = email.toLowerCase().trim();
    
    try {
      const { data: users, error } = await supabase.auth.admin.listUsers();
      if (error) throw error;
      
      const existingUser = users.users.find(user => 
        user.email === normalizedEmail && 
        !user.deleted_at &&
        user.email_confirmed_at
      );
      
      res.json({ 
        exists: !!existingUser,
        message: existingUser ? 'Email bestaat al' : 'Email beschikbaar'
      });
    } catch (error) {
      res.json({ 
        exists: false, 
        message: 'Kon email niet controleren',
        warning: true 
      });
    }
  } catch (error) {
    sendError(res, 500, 'Fout bij controleren email.', error.message, req);
  }
});

router.post('/mosques/test-welcome-email', async (req, res) => {
  try {
    const { mosqueId, testEmail } = req.body;
    
    if (!mosqueId) {
      return sendError(res, 400, 'Moskee ID is verplicht.', null, req);
    }

    const { data: mosque, error: mosqueError } = await supabase
      .from('mosques')
      .select('*')
      .eq('id', mosqueId)
      .single();

    if (mosqueError || !mosque) {
      return sendError(res, 404, 'Moskee niet gevonden.', null, req);
    }

    const { data: admin, error: adminError } = await supabase
      .from('users')
      .select('*')
      .eq('mosque_id', mosqueId)
      .eq('role', 'admin')
      .single();

    if (adminError || !admin) {
      return sendError(res, 404, 'Admin gebruiker niet gevonden.', null, req);
    }

    const welcomeEmailData = {
      mosque: {
        id: mosque.id,
        name: mosque.name,
        subdomain: mosque.subdomain,
        email: mosque.email,
        address: mosque.address,
        city: mosque.city,
        zipcode: mosque.zipcode,
        phone: mosque.phone,
        website: mosque.website,
        m365_configured: mosque.m365_configured || false
      },
      admin: {
        id: admin.id,
        name: admin.name,
        email: testEmail || admin.email,
        role: admin.role
      }
    };

    const emailService = getRegistrationEmailService();
    if (emailService.sendRegistrationWelcomeEmail) {
      const emailResult = await emailService.sendRegistrationWelcomeEmail(welcomeEmailData);
      
      if (emailResult.success) {
        res.json({ 
          success: true, 
          message: `Test welkomstmail verstuurd naar ${welcomeEmailData.admin.email} via ${emailResult.service}`,
          service: emailResult.service,
          messageId: emailResult.messageId
        });
      } else {
        res.json({ 
          success: false, 
          message: `Welkomstmail versturen mislukt: ${emailResult.error}`,
          service: emailResult.service
        });
      }
    } else {
      res.json({
        success: false,
        message: 'Email service niet beschikbaar'
      });
    }

  } catch (error) {
    console.error('Error testing welcome email:', error);
    sendError(res, 500, 'Fout bij testen welkomstmail.', error.message, req);
  }
});

module.exports = router;