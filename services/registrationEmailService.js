// services/registrationEmailService.js - FIXED met proper exports
const { sendEmail } = require('./emailService');

// Verstuur welkomstmail voor nieuwe moskee registratie
const sendRegistrationWelcomeEmail = async (emailData) => {
    try {
        const { mosque, admin } = emailData;
        console.log(`📧 [Registration Email] Preparing welcome email for ${admin.email} (Mosque: ${mosque.name})`);

        // ✅ SIMPLIFIED: Geen mosqueId nodig voor system emails
        const emailDetails = {
            to: admin.email, // ✅ GECORRIGEERD: Gebruik admin.email
            subject: '🕌 Welkom bij MijnLVS - Uw account is klaar!',
            body: generateWelcomeEmailHTML(mosque, admin),
            emailType: 'registration_welcome' // ✅ System email type
        };

        // ✅ Gebruik de nieuwe master sendEmail functie
        const emailResult = await sendEmail(emailDetails);
        
        if (emailResult.success) {
            console.log(`✅ [Registration Email] Welcome email sent successfully via ${emailResult.service} to ${admin.email}`);
            return { success: true, messageId: emailResult.messageId, service: emailResult.service };
        } else {
            console.error(`❌ [Registration Email] Welcome email failed:`, emailResult.error);
            return { success: false, error: emailResult.error, service: emailResult.service };
        }
        
    } catch (error) {
        console.error('❌ [Registration Email] Exception while sending welcome email:', error);
        return { success: false, error: error.message };
    }
};

// Verstuur reminder email na 24 uur
const sendGettingStartedReminder = async (emailData) => {
    try {
        const { mosque, admin } = emailData;
        console.log(`📧 [Registration Email] Preparing reminder email for ${admin.email}`);

        const emailDetails = {
            to: admin.email, // ✅ GECORRIGEERD: Gebruik admin.email
            subject: '🚀 Klaar om te beginnen met MijnLVS?',
            body: generateReminderEmailHTML(mosque, admin),
            emailType: 'registration_reminder'
        };

        const emailResult = await sendEmail(emailDetails);
        
        if (emailResult.success) {
            console.log(`✅ [Registration Email] Reminder email sent successfully via ${emailResult.service}`);
            return { success: true, messageId: emailResult.messageId, service: emailResult.service };
        } else {
            console.error(`❌ [Registration Email] Reminder email failed:`, emailResult.error);
            return { success: false, error: emailResult.error, service: emailResult.service };
        }
        
    } catch (error) {
        console.error('❌ [Registration Email] Exception while sending reminder email:', error);
        return { success: false, error: error.message };
    }
};

// ✅ NIEUWE FUNCTIE: Test welkomstmail
const testWelcomeEmail = async (mosqueId, forceEmail = null) => {
    try {
        console.log(`🧪 [Registration Email] Testing welcome email for mosque ${mosqueId}`);

        // Haal moskee en admin gegevens op
        const { supabase } = require('../config/database');
        
        const { data: mosque, error: mosqueError } = await supabase
            .from('mosques')
            .select('*')
            .eq('id', mosqueId)
            .single();

        if (mosqueError || !mosque) {
            throw new Error(`Mosque ${mosqueId} not found: ${mosqueError?.message || 'Unknown error'}`);
        }

        const { data: admin, error: adminError } = await supabase
            .from('users')
            .select('*')
            .eq('mosque_id', mosqueId)
            .eq('role', 'admin')
            .single();

        if (adminError || !admin) {
            throw new Error(`Admin for mosque ${mosqueId} not found: ${adminError?.message || 'Unknown error'}`);
        }

        // ✅ GECORRIGEERDE data structuur
        const testEmailData = {
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
                email: forceEmail || admin.email, // ✅ Test override mogelijk
                role: admin.role
            }
        };

        // Verstuur test welkomstmail
        const result = await sendRegistrationWelcomeEmail(testEmailData);
        
        console.log(`🧪 [Registration Email] Test result for ${testEmailData.admin.email}:`, result);
        return result;
        
    } catch (error) {
        console.error('❌ [Registration Email] Error in test welcome email:', error);
        return { success: false, error: error.message };
    }
};

// ✅ HTML TEMPLATE FUNCTIES (updated voor nieuwe data structuur)
const generateWelcomeEmailHTML = (mosque, admin) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <h1 style="color: #10b981; margin: 0; font-size: 28px;">Welkom bij MijnLVS!</h1>
                <p style="color: #6b7280; margin: 10px 0 0 0; font-size: 16px;">Het hart van uw Islamitisch onderwijs</p>
            </div>
            
            <!-- Welcome Message -->
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <h2 style="color: #15803d; margin-top: 0; font-size: 20px;">Assalamu alaykum ${admin.name},</h2>
                <p style="color: #166534; margin: 0; font-size: 16px; line-height: 1.5;">
                    Hartelijk welkom bij MijnLVS! Uw account voor <strong>${mosque.name}</strong> is succesvol aangemaakt en u kunt direct aan de slag.
                </p>
            </div>
            
            <!-- CTA Button -->
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://${mosque.subdomain}.mijnlvs.nl/login" 
                   style="background: #10b981; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);">
                    🚀 Start met MijnLVS
                </a>
            </div>
            
            <!-- Login Credentials -->
            <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #92400e; margin-top: 0; font-size: 18px;">📋 Uw Inloggegevens:</h3>
                <div style="color: #78350f; font-size: 14px;">
                    <p style="margin: 8px 0;"><strong>Website:</strong> https://${mosque.subdomain}.mijnlvs.nl</p>
                    <p style="margin: 8px 0;"><strong>Email:</strong> ${admin.email}</p>
                    <p style="margin: 8px 0;"><strong>Wachtwoord:</strong> Het wachtwoord dat u heeft gekozen</p>
                </div>
            </div>
            
            <!-- Next Steps -->
            <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #0369a1; margin-top: 0; font-size: 18px;">🎯 Uw Volgende Stappen:</h3>
                <ol style="color: #075985; margin: 0; padding-left: 20px; font-size: 14px;">
                    <li style="margin: 8px 0;">Log in op uw persoonlijke dashboard</li>
                    <li style="margin: 8px 0;">Voeg uw eerste leerlingen toe</li>
                    <li style="margin: 8px 0;">Maak klassen aan voor verschillende niveaus</li>
                    <li style="margin: 8px 0;">Nodig ouders uit om de app te gebruiken</li>
                    <li style="margin: 8px 0;">Begin met het bijhouden van lessen en voortgang</li>
                </ol>
            </div>
            
            <!-- Features Grid -->
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #374151; margin-top: 0; font-size: 18px;">✨ Wat kunt u nu doen:</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; color: #4b5563;">
                    <div style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #e5e7eb;">
                        <strong style="color: #10b981;">👥 Leerling Beheer</strong><br>
                        <small>Tot 10 leerlingen gratis</small>
                    </div>
                    <div style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #e5e7eb;">
                        <strong style="color: #10b981;">📚 Les Planning</strong><br>
                        <small>Maak roosters en klassen</small>
                    </div>
                    <div style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #e5e7eb;">
                        <strong style="color: #10b981;">📊 Voortgang Tracking</strong><br>
                        <small>Houd Qor'aan progress bij</small>
                    </div>
                    <div style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #e5e7eb;">
                        <strong style="color: #10b981;">👨‍👩‍👧‍👦 Ouder Communicatie</strong><br>
                        <small>Houd ouders op de hoogte</small>
                    </div>
                </div>
            </div>
            
            <!-- Professional Upgrade -->
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #047857; margin-top: 0; font-size: 18px;">💡 Upgrade naar Professional</h3>
                <p style="color: #065f46; margin: 0 0 12px 0; font-size: 14px;">
                    Wilt u meer dan 10 leerlingen beheren? Upgrade naar Professional voor:
                </p>
                <ul style="color: #065f46; margin: 0; padding-left: 20px; font-size: 14px;">
                    <li>Onbeperkt aantal leerlingen</li>
                    <li>Financieel beheer en facturen</li>
                    <li>Geavanceerde rapporten</li>
                    <li>Professionele e-mail templates</li>
                    <li>Priority ondersteuning</li>
                </ul>
                <div style="text-align: center; margin-top: 16px;">
                    <a href="https://${mosque.subdomain}.mijnlvs.nl/dashboard" 
                       style="background: #047857; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px;">
                        Bekijk Professional Opties
                    </a>
                </div>
            </div>
            
            <!-- Support Info -->
            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
                <h3 style="color: #374151; margin-top: 0; font-size: 18px;">🤝 Hulp Nodig?</h3>
                <p style="color: #6b7280; margin: 0 0 12px 0; font-size: 14px;">
                    Ons team staat klaar om u te helpen bij het instellen van MijnLVS:
                </p>
                <ul style="color: #6b7280; margin: 0; padding-left: 20px; font-size: 14px;">
                    <li>📧 Email ondersteuning: <a href="mailto:i.abdellaoui@gmail.com" style="color: #10b981;">i.abdellaoui@gmail.com</a></li>
                    <li>💬 Heeft u vragen over het platform? Neem gerust contact op!</li>
                    <li>📖 Documentatie en handleidingen vindt u in uw dashboard</li>
                </ul>
            </div>
            
            <!-- Islamic Quote -->
            <div style="text-align: center; margin: 40px 0 20px 0; padding: 20px; background: #f9fafb; border-radius: 8px;">
                <p style="color: #374151; margin: 0; font-style: italic; font-size: 14px;">
                    "En leer hen het Boek en de wijsheid" - Qor'aan 2:129
                </p>
            </div>
            
            <!-- Footer -->
            <div style="text-align: center; color: #6b7280;">
                <p style="margin: 0;">
                    Barakallahu feek,<br>
                    <strong style="color: #374151;">Het MijnLVS Team</strong>
                </p>
                <p style="margin: 20px 0 0 0; font-size: 12px;">
                    Deze email is verstuurd naar ${admin.email} omdat u zich heeft geregistreerd bij MijnLVS.
                </p>
            </div>
        </div>
    `;
};

const generateReminderEmailHTML = (mosque, admin) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #10b981;">Assalamu alaykum ${admin.name},</h2>
            
            <p style="color: #374151;">
                We zagen dat u zich gisteren heeft geregistreerd bij MijnLVS voor ${mosque.name}. 
                Bent u al aan de slag gegaan?
            </p>
            
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #15803d; margin-top: 0;">📚 Snelle Start Gids</h3>
                <ol style="color: #166534; margin: 0; padding-left: 20px;">
                    <li style="margin: 8px 0;">Log in op uw dashboard</li>
                    <li style="margin: 8px 0;">Voeg uw eerste leerling toe</li>
                    <li style="margin: 8px 0;">Maak een klas aan</li>
                    <li style="margin: 8px 0;">Begin met het bijhouden van aanwezigheid</li>
                </ol>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://${mosque.subdomain}.mijnlvs.nl/login" 
                   style="background: #10b981; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                    Ga naar Dashboard
                </a>
            </div>
            
            <p style="color: #6b7280; font-size: 14px;">
                Heeft u hulp nodig? Neem contact op via <a href="mailto:i.abdellaoui@gmail.com" style="color: #10b981;">i.abdellaoui@gmail.com</a>
            </p>
            
            <p style="color: #374151;">
                Barakallahu feeki,<br>
                Het MijnLVS Team
            </p>
        </div>
    `;
};

// ✅ CRITICAL: Export all functions
module.exports = {
    sendRegistrationWelcomeEmail,
    sendGettingStartedReminder,
    testWelcomeEmail
};