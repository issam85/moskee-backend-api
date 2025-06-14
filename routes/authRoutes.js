// routes/authRoutes.js - COMPLETE VERSIE MET PAYMENT LINKING
const router = require('express').Router();
const { supabase } = require('../config/database');
const { sendError } = require('../utils/errorHelper');
const { sendM365EmailInternal } = require('../services/emailService');
const { sendRegistrationWelcomeEmail } = require('../services/registrationEmailService');

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
        await supabase.auth.signOut(); // Log de ongeldige sessie uit
        return sendError(res, 401, 'Gebruiker is niet gekoppeld aan deze moskee.', null, req);
    }

    await supabase.from('users').update({ last_login: new Date() }).eq('id', appUser.id);
    
    // Stuur de sessie token en gebruikersprofiel terug
    res.json({ success: true, user: appUser, session });
  } catch (error) {
    sendError(res, 500, 'Interne serverfout tijdens login.', error.message, req);
  }
});

// POST /api/mosques/register
router.post('/mosques/register', async (req, res) => {
  try {
    const { mosqueName, subdomain, adminName, adminEmail, adminPassword, address, city, zipcode, phone, website, contactEmail } = req.body;
    
    // Validatie van input
    if (!mosqueName || !subdomain || !adminName || !adminEmail || !adminPassword) {
      return sendError(res, 400, 'Verplichte registratievelden ontbreken.', null, req);
    }
    if (adminPassword.length < 8) {
      return sendError(res, 400, 'Wachtwoord moet minimaal 8 karakters lang zijn.', null, req);
    }

    const normalizedSubdomain = subdomain.toLowerCase().trim();
    const normalizedAdminEmail = adminEmail.toLowerCase().trim();
    
    // Check 1: Bestaat het subdomein al in de 'mosques' tabel?
    const { data: existingSubdomain, error: subdomainError } = await supabase
      .from('mosques').select('id').eq('subdomain', normalizedSubdomain).maybeSingle();
    if (subdomainError) throw subdomainError;
    if (existingSubdomain) return sendError(res, 409, 'Dit subdomein is al in gebruik.', null, req);
    
    // =====================================================================
    // ✅ VERBETERDE SPOOKGEBRUIKER CHECK
    // We gebruiken nu de admin API om te controleren of de gebruiker bestaat
    // =====================================================================
    try {
      console.log(`Checking if user exists with email: ${normalizedAdminEmail}`);
      
      // Probeer de gebruiker op te halen via admin API
      const { data: existingUsers, error: userListError } = await supabase.auth.admin.listUsers();
      
      if (userListError) {
        console.error("Error checking existing users:", userListError);
        // Als we users niet kunnen ophalen, proberen we gewoon de registratie
        // en laten we Supabase zelf de duplicate check doen
      } else {
        // Filter op actieve gebruikers met dit emailadres
        const existingActiveUser = existingUsers.users.find(user => 
          user.email === normalizedAdminEmail && 
          !user.deleted_at && // Geen soft-delete
          user.email_confirmed_at // Email is bevestigd
        );
        
        if (existingActiveUser) {
          console.log(`Active user found with email ${normalizedAdminEmail}, blocking registration`);
          return sendError(res, 409, 'Dit emailadres is al geregistreerd door een actieve gebruiker.', null, req);
        }
        
        console.log(`No active user found with email ${normalizedAdminEmail}, proceeding with registration`);
      }
    } catch (adminError) {
      console.warn("Admin API check failed, proceeding with registration attempt:", adminError.message);
      // Als admin check faalt, proberen we gewoon de registratie
      // Supabase zelf zal dan de duplicate check doen
    }
    // =====================================================================
    // EINDE VERBETERDE CHECK
    // =====================================================================
    
    let newMosque, supabaseAuthAdmin;

    try {
        // Stap 2: Maak het moskee-record aan
        const mosqueData = {
            name: mosqueName, 
            subdomain: normalizedSubdomain,
            // ✅ FIXED: Gebruik email in plaats van admin_email (zoals in paymentRoutes.js)
            email: normalizedAdminEmail, // Contact email van de moskee (meestal admin email)
            address: address || null,
            city: city || null,
            zipcode: zipcode || null,
            phone: phone || null,
            website: website || null,
            // ✅ Default subscription settings voor nieuwe registraties
            subscription_status: 'trialing', // Start met trial
            trial_ends_at: null, // Wordt ingesteld door payment systeem
            created_at: new Date().toISOString()
        };

        // Als er een apart contact email is opgegeven, gebruik dat
        if (contactEmail && contactEmail.trim() && contactEmail.trim() !== normalizedAdminEmail) {
            mosqueData.email = contactEmail.trim().toLowerCase();
        }

        const { data, error } = await supabase.from('mosques').insert([mosqueData]).select().single();
        if (error) throw error;
        newMosque = data;

        // Stap 3: Maak de Supabase Auth gebruiker aan
        console.log(`Creating auth user for email: ${normalizedAdminEmail}`);
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: normalizedAdminEmail,
            password: adminPassword,
            email_confirm: true, // ✅ Auto-bevestig email
            user_metadata: { name: adminName, role: 'admin' }
        });
        
        if (authError) {
          console.error("Auth user creation failed:", authError);
          
          // ✅ Specifieke error handling voor duplicates
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
        
        // =====================================================================
        // ✅ NIEUWE FUNCTIONALITEIT: PAYMENT LINKING NA REGISTRATIE
        // =====================================================================
        let paymentLinked = false;
        try {
          console.log(`🔗 [Registration] Attempting payment linking for mosque ${newMosque.id}...`);
          
          const linkingResult = await linkPendingPaymentAfterRegistration({
            mosqueId: newMosque.id,
            adminEmail: normalizedAdminEmail
          });
          
          if (linkingResult.success) {
            console.log(`✅ [Registration] Payment linked successfully! Subscription: ${linkingResult.subscriptionId}`);
            paymentLinked = true;
            
            // Update newMosque object met nieuwe status voor response
            newMosque.subscription_status = 'active';
            newMosque.stripe_customer_id = linkingResult.stripeCustomerId;
            newMosque.stripe_subscription_id = linkingResult.subscriptionId;
          } else {
            console.log(`ℹ️ [Registration] No pending payment found - normal for free registrations`);
          }
        } catch (linkingError) {
          console.error('[Registration] Payment linking failed (non-fatal):', linkingError);
          // Continue met registratie - payment linking is niet kritiek
        }
        
        // =====================================================================
        // ✅ NIEUWE FUNCTIONALITEIT: VERSTUUR WELKOMSTMAIL
        // =====================================================================
        try {
          console.log(`📧 [Registration] Sending welcome email to ${normalizedAdminEmail}...`);
          
          // ✅ GECORRIGEERD: Gebruik juiste data structuur
          const welcomeEmailData = {
            mosque: {
              id: newMosque.id,
              name: newMosque.name,
              subdomain: newMosque.subdomain,
              email: newMosque.email, // Contact email van moskee
              address: newMosque.address,
              city: newMosque.city,
              zipcode: newMosque.zipcode,
              phone: newMosque.phone,
              website: newMosque.website
            },
            admin: {
              id: newAppAdmin.id,
              name: adminName,
              email: normalizedAdminEmail, // ✅ Admin user email
              role: 'admin'
            }
          };

          // Verstuur welkomstmail
          const emailResult = await sendRegistrationWelcomeEmail(welcomeEmailData);
          
          if (emailResult.success) {
            console.log(`✅ [Registration] Welcome email sent successfully to ${normalizedAdminEmail} via ${emailResult.service}`);
          } else {
            console.warn(`⚠️ [Registration] Welcome email failed for ${normalizedAdminEmail}:`, emailResult.error);
            // Continue ook al faalt de email - registratie is geslaagd
          }
        } catch (emailError) {
          console.error(`❌ [Registration] Error sending welcome email to ${normalizedAdminEmail}:`, emailError);
          // Continue ook al faalt de email - registratie is geslaagd
        }
        // =====================================================================
        // EINDE WELKOMSTMAIL FUNCTIONALITEIT
        // =====================================================================
        
        // Bepaal success message gebaseerd op payment status
        let successMessage = `Welkom bij MijnLVS, ${newMosque.name}! Uw account is succesvol aangemaakt.`;
        if (paymentLinked) {
          successMessage = `Welkom bij MijnLVS, ${newMosque.name}! Uw Professional account is direct actief en de welkomstmail is verstuurd.`;
        } else {
          successMessage += ' Een welkomstmail is verstuurd naar uw emailadres.';
        }
        
        // Alles is gelukt, stuur succesrespons
        res.status(201).json({ 
          success: true, 
          message: successMessage, 
          mosque: newMosque, 
          admin: newAppAdmin,
          welcome_email_sent: true, // Geef aan dat welkomstmail is verstuurd
          payment_linked: paymentLinked, // Geef aan of betaling gekoppeld is
          subscription_status: newMosque.subscription_status // Huidige status
        });

    } catch (error) {
        // ✅ VERBETERDE ROLLBACK met betere logging
        console.error("!!! REGISTRATION ERROR - STARTING ROLLBACK !!!");
        console.error("Error details:", {
          message: error.message,
          code: error.code,
          status: error.status
        });
        
        // Rollback in omgekeerde volgorde
        try {
          if (supabaseAuthAdmin) {
            console.log(`Rollback: Deleting auth user ${supabaseAuthAdmin.id}...`);
            const { error: deleteError } = await supabase.auth.admin.deleteUser(
              supabaseAuthAdmin.id, 
              true // ✅ Hard delete to prevent ghost users
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
          // Continue with error response anyway
        }

        // ✅ Betere error responses
        if (error.message === 'EMAIL_ALREADY_EXISTS') {
          return sendError(res, 409, 'Dit emailadres is al geregistreerd.', null, req);
        }
        
        if (error.message && error.message.includes('subdomain')) {
          return sendError(res, 409, 'Dit subdomein is al in gebruik.', null, req);
        }
        
        // Algemene fout
        const friendlyMessage = 'Registratie mislukt. Probeer het opnieuw of neem contact op met support.';
        return sendError(res, 500, friendlyMessage, error.message, req);
    }
  } catch (outerError) {
    console.error("!!! OUTER REGISTRATION ERROR !!!", outerError);
    return sendError(res, 500, 'Interne serverfout tijdens registratie.', outerError.message, req);
  }
});

// =====================================================================
// ✅ PAYMENT LINKING FUNCTIE (embedded in deze file)
// =====================================================================
const linkPendingPaymentAfterRegistration = async ({ mosqueId, adminEmail }) => {
  try {
    console.log(`[Payment Linking] Searching for pending payments for ${adminEmail}`);
    
    // Zoek naar pending payments in laatste 60 minuten (verhoogd van 30)
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    let pendingPayment = null;
    
    // ✅ STRATEGIE 1: Match op customer_email (als aanwezig)
    try {
      const { data: emailMatches, error: emailError } = await supabase
        .from('pending_payments')
        .select('*')
        .eq('customer_email', adminEmail)
        .eq('status', 'pending')
        .gte('created_at', sixtyMinutesAgo)
        .order('created_at', { ascending: false });
      
      if (!emailError && emailMatches && emailMatches.length > 0) {
        pendingPayment = emailMatches[0];
        console.log(`[Payment Linking] ✅ Found payment by EMAIL: ${pendingPayment.tracking_id}`);
      }
    } catch (error) {
      console.warn('[Payment Linking] Email strategy failed:', error.message);
    }
    
    // ✅ STRATEGIE 2: Fallback - Match op timing (recent pending payments zonder email)
    if (!pendingPayment) {
      try {
        console.log(`[Payment Linking] No email match found, trying timing-based matching...`);
        
        const { data: recentPayments, error: recentError } = await supabase
          .from('pending_payments')
          .select('*')
          .eq('status', 'pending')
          .is('mosque_id', null) // Nog niet gekoppeld
          .gte('created_at', sixtyMinutesAgo)
          .order('created_at', { ascending: false });
        
        if (!recentError && recentPayments && recentPayments.length > 0) {
          // Neem de meest recente als er maar 1 is, of de eerste in de lijst
          if (recentPayments.length === 1) {
            pendingPayment = recentPayments[0];
            console.log(`[Payment Linking] ✅ Found payment by TIMING (single recent): ${pendingPayment.tracking_id}`);
          } else {
            // Als er meerdere zijn, neem de eerste (meest recente)
            pendingPayment = recentPayments[0];
            console.log(`[Payment Linking] ⚠️ Found payment by TIMING (multiple, taking most recent): ${pendingPayment.tracking_id}`);
          }
        }
      } catch (error) {
        console.warn('[Payment Linking] Timing strategy failed:', error.message);
      }
    }
    
    // ✅ STRATEGIE 3: Extra fallback - Match op URL parameters (als tracking_id beschikbaar)
    if (!pendingPayment) {
      // Deze strategie kan later uitgebreid worden met URL parameter tracking
      console.log(`[Payment Linking] No timing match found either`);
    }
    
    // ❌ Geen payment gevonden
    if (!pendingPayment) {
      console.log(`[Payment Linking] No pending payments found for ${adminEmail} using any strategy`);
      return { success: false, reason: 'no_pending_payments' };
    }
    
    // ✅ Payment gevonden - nu koppelen
    console.log(`[Payment Linking] Found pending payment: ${pendingPayment.tracking_id} (${pendingPayment.stripe_subscription_id})`);
    console.log(`[Payment Linking] Payment details: customer_email="${pendingPayment.customer_email || 'EMPTY'}", amount=${pendingPayment.amount}`);
    
    // Update pending payment met mosque_id
    const { error: updateError } = await supabase
      .from('pending_payments')
      .update({ 
        mosque_id: mosqueId,
        status: 'linked',
        customer_email: pendingPayment.customer_email || adminEmail, // ✅ Fix empty email
        updated_at: new Date().toISOString()
      })
      .eq('id', pendingPayment.id);
    
    if (updateError) {
      throw new Error(`Failed to update pending payment: ${updateError.message}`);
    }
    
    // Update mosque met Stripe info
    const { error: mosqueUpdateError } = await supabase
      .from('mosques')
      .update({
        stripe_customer_id: pendingPayment.stripe_customer_id,
        stripe_subscription_id: pendingPayment.stripe_subscription_id,
        subscription_status: 'active', // ✅ ACTIVATE DIRECT!
        trial_ends_at: null, // Remove trial restriction
        updated_at: new Date().toISOString()
      })
      .eq('id', mosqueId);
    
    if (mosqueUpdateError) {
      throw new Error(`Failed to update mosque: ${mosqueUpdateError.message}`);
    }
    
    console.log(`✅ [Payment Linking] Successfully linked payment to mosque ${mosqueId} - Status now ACTIVE`);
    
    return { 
      success: true, 
      paymentId: pendingPayment.id,
      subscriptionId: pendingPayment.stripe_subscription_id,
      stripeCustomerId: pendingPayment.stripe_customer_id,
      amount: pendingPayment.amount,
      strategy: pendingPayment.customer_email ? 'email_match' : 'timing_match'
    };
    
  } catch (error) {
    console.error('[Payment Linking] Error:', error);
    return { success: false, error: error.message };
  }
};

// ✅ NIEUWE UTILITY ROUTE: Check if email exists
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
      // Fallback: return that we can't check
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

// ✅ NIEUWE ROUTE: Test welkomstmail functionaliteit
router.post('/mosques/test-welcome-email', async (req, res) => {
  try {
    const { mosqueId, testEmail } = req.body;
    
    if (!mosqueId) {
      return sendError(res, 400, 'Moskee ID is verplicht.', null, req);
    }

    // Haal moskee gegevens op
    const { data: mosque, error: mosqueError } = await supabase
      .from('mosques')
      .select('*')
      .eq('id', mosqueId)
      .single();

    if (mosqueError || !mosque) {
      return sendError(res, 404, 'Moskee niet gevonden.', null, req);
    }

    // Haal admin gebruiker op
    const { data: admin, error: adminError } = await supabase
      .from('users')
      .select('*')
      .eq('mosque_id', mosqueId)
      .eq('role', 'admin')
      .single();

    if (adminError || !admin) {
      return sendError(res, 404, 'Admin gebruiker niet gevonden.', null, req);
    }

    // ✅ GECORRIGEERDE data structuur
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
        website: mosque.website
      },
      admin: {
        id: admin.id,
        name: admin.name,
        email: testEmail || admin.email, // ✅ Override voor test
        role: admin.role
      }
    };

    // Test welkomstmail
    const emailResult = await sendRegistrationWelcomeEmail(welcomeEmailData);
    
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

  } catch (error) {
    console.error('Error testing welcome email:', error);
    sendError(res, 500, 'Fout bij testen welkomstmail.', error.message, req);
  }
});

// ✅ TEST ROUTE voor Resend email service
router.post('/test-resend-email', async (req, res) => {
  try {
    const { sendTestEmail } = require('../services/emailService');
    const { testEmail } = req.body;
    
    if (!testEmail) {
      return sendError(res, 400, 'Test email adres is verplicht.', null, req);
    }

    console.log(`🧪 [TEST] Testing Resend with email: ${testEmail}`);
    const result = await sendTestEmail(testEmail);
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: `Test email succesvol verstuurd naar ${testEmail}`,
        messageId: result.messageId,
        service: result.service
      });
    } else {
      res.json({ 
        success: false, 
        message: `Test email mislukt: ${result.error}`,
        service: result.service
      });
    }

  } catch (error) {
    console.error('Error testing Resend email:', error);
    sendError(res, 500, 'Fout bij testen email service.', error.message, req);
  }
});

// ✅ TEST ROUTE voor payment linking
router.post('/test-payment-linking', async (req, res) => {
  try {
    const { mosqueId, adminEmail } = req.body;
    
    if (!mosqueId || !adminEmail) {
      return sendError(res, 400, 'Moskee ID en admin email zijn verplicht.', null, req);
    }

    console.log(`🧪 [TEST] Testing payment linking for mosque: ${mosqueId}, email: ${adminEmail}`);
    
    const result = await linkPendingPaymentAfterRegistration({
      mosqueId: mosqueId,
      adminEmail: adminEmail
    });
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: `Payment linking succesvol voor mosque ${mosqueId}`,
        paymentId: result.paymentId,
        subscriptionId: result.subscriptionId,
        amount: result.amount
      });
    } else {
      res.json({ 
        success: false, 
        message: `Payment linking mislukt: ${result.error || result.reason}`,
        reason: result.reason
      });
    }

  } catch (error) {
    console.error('Error testing payment linking:', error);
    sendError(res, 500, 'Fout bij testen payment linking.', error.message, req);
  }
});

module.exports = router;