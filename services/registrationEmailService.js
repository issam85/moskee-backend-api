// services/registrationEmailService.js - Welkomstmails voor nieuwe registraties
const { sendM365EmailInternal } = require('./emailService');

// Verstuur welkomstmail voor nieuwe moskee registratie
const sendRegistrationWelcomeEmail = async (mosqueData) => {
    try {
        console.log(`📧 [Registration Email] Preparing welcome email for ${mosqueData.admin_email} (Mosque: ${mosqueData.name})`);

        // ✅ GECORRIGEERD: Voeg mosqueId en emailType toe voor sendM365EmailInternal
        const emailDetails = {
            to: mosqueData.admin_email,
            subject: '🕌 Welkom bij MijnLVS - Uw account is klaar!',
            body: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <h1 style="color: #10b981; margin: 0;">Welkom bij MijnLVS!</h1>
                        <p style="color: #6b7280; margin: 10px 0 0 0;">Het hart van uw Islamitisch onderwijs</p>
                    </div>
                    
                    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                        <h2 style="color: #15803d; margin-top: 0;">Assalamu alaykum ${mosqueData.admin_name},</h2>
                        <p style="color: #166534; margin: 0;">
                            Hartelijk welkom bij MijnLVS! Uw account voor <strong>${mosqueData.name}</strong> is succesvol aangemaakt en u kunt direct aan de slag.
                        </p>
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="https://${mosqueData.subdomain}.mijnlvs.nl/login" 
                           style="background: #10b981; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
                            🚀 Start met MijnLVS
                        </a>
                    </div>
                    
                    <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 20px; margin: 24px 0;">
                        <h3 style="color: #92400e; margin-top: 0;">📋 Uw Inloggegevens:</h3>
                        <div style="color: #78350f;">
                            <p style="margin: 5px 0;"><strong>Website:</strong> https://${mosqueData.subdomain}.mijnlvs.nl</p>
                            <p style="margin: 5px 0;"><strong>Email:</strong> ${mosqueData.admin_email}</p>
                            <p style="margin: 5px 0;"><strong>Wachtwoord:</strong> Het wachtwoord dat u heeft gekozen</p>
                        </div>
                    </div>
                    
                    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; margin: 24px 0;">
                        <h3 style="color: #0369a1; margin-top: 0;">🎯 Uw Volgende Stappen:</h3>
                        <ol style="color: #075985; margin: 0; padding-left: 20px;">
                            <li style="margin: 8px 0;">Log in op uw persoonlijke dashboard</li>
                            <li style="margin: 8px 0;">Voeg uw eerste leerlingen toe</li>
                            <li style="margin: 8px 0;">Maak klassen aan voor verschillende niveaus</li>
                            <li style="margin: 8px 0;">Nodig ouders uit om de app te gebruiken</li>
                            <li style="margin: 8px 0;">Begin met het bijhouden van lessen en voortgang</li>
                        </ol>
                    </div>
                    
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
                        <h3 style="color: #374151; margin-top: 0;">✨ Wat kunt u nu doen:</h3>
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
                    
                    <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 20px; margin: 24px 0;">
                        <h3 style="color: #047857; margin-top: 0;">💡 Upgrade naar Professional</h3>
                        <p style="color: #065f46; margin: 0 0 12px 0;">
                            Wilt u meer dan 10 leerlingen beheren? Upgrade naar Professional voor:
                        </p>
                        <ul style="color: #065f46; margin: 0; padding-left: 20px;">
                            <li>Onbeperkt aantal leerlingen</li>
                            <li>Financieel beheer en facturen</li>
                            <li>Geavanceerde rapporten</li>
                            <li>Professionele e-mail templates</li>
                            <li>Priority ondersteuning</li>
                        </ul>
                        <div style="text-align: center; margin-top: 16px;">
                            <a href="https://${mosqueData.subdomain}.mijnlvs.nl/dashboard" 
                               style="background: #047857; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px;">
                                Bekijk Professional Opties
                            </a>
                        </div>
                    </div>
                    
                    <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
                        <h3 style="color: #374151; margin-top: 0;">🤝 Hulp Nodig?</h3>
                        <p style="color: #6b7280; margin: 0 0 12px 0;">
                            Ons team staat klaar om u te helpen bij het instellen van MijnLVS:
                        </p>
                        <ul style="color: #6b7280; margin: 0; padding-left: 20px;">
                            <li>📧 Email ondersteuning: <a href="mailto:i.abdellaoui@gmail.com" style="color: #10b981;">i.abdellaoui@gmail.com</a></li>
                            <li>💬 Heeft u vragen over het platform? Neem gerust contact op!</li>
                            <li>📖 Documentatie en handleidingen vindt u in uw dashboard</li>
                        </ul>
                    </div>
                    
                    <div style="text-align: center; margin: 40px 0 20px 0; padding: 20px; background: #f9fafb; border-radius: 8px;">
                        <p style="color: #374151; margin: 0; font-style: italic;">
                            "En leer hen het Boek en de wijsheid" - Qor'aan 2:129
                        </p>
                    </div>
                    
                    <div style="text-align: center; color: #6b7280;">
                        <p style="margin: 0;">
                            Barakallahu feeki,<br>
                            <strong style="color: #374151;">Het MijnLVS Team</strong>
                        </p>
                        <p style="margin: 20px 0 0 0; font-size: 12px;">
                            Deze email is verstuurd naar ${mosqueData.admin_email} omdat u zich heeft geregistreerd bij MijnLVS.
                        </p>
                    </div>
                </div>
            `,
            mosqueId: mosqueData.id, // ✅ TOEGEVOEGD: Mosque ID voor de emailService
            emailType: 'registration_welcome' // ✅ TOEGEVOEGD: Email type voor logging
        };

        // ✅ GECORRIGEERD: Gebruik de juiste parameter structuur
        const emailResult = await sendM365EmailInternal(emailDetails);
        
        if (emailResult.success) {
            console.log(`✅ [Registration Email] Welcome email sent successfully to ${mosqueData.admin_email} for mosque: ${mosqueData.name}`);
            return { success: true, messageId: emailResult.messageId };
        } else {
            console.error(`❌ [Registration Email] Welcome email failed for ${mosqueData.admin_email}:`, emailResult.error);
            return { success: false, error: emailResult.error };
        }
        
    } catch (error) {
        console.error('❌ [Registration Email] Exception while sending welcome email:', error);
        return { success: false, error: error.message };
    }
};

// Verstuur reminder email na 24 uur als ze nog niet hebben ingelogd
const sendGettingStartedReminder = async (mosqueData) => {
    try {
        console.log(`📧 [Registration Email] Preparing reminder email for ${mosqueData.admin_email}`);

        const emailDetails = {
            to: mosqueData.admin_email,
            subject: '🚀 Klaar om te beginnen met MijnLVS?',
            body: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #10b981;">Assalamu alaykum ${mosqueData.admin_name},</h2>
                    
                    <p style="color: #374151;">
                        We zagen dat u zich gisteren heeft geregistreerd bij MijnLVS voor ${mosqueData.name}. 
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
                        <a href="https://${mosqueData.subdomain}.mijnlvs.nl/login" 
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
            `,
            mosqueId: mosqueData.id,
            emailType: 'registration_reminder'
        };

        const emailResult = await sendM365EmailInternal(emailDetails);
        
        if (emailResult.success) {
            console.log(`✅ [Registration Email] Reminder email sent successfully to ${mosqueData.admin_email}`);
            return { success: true, messageId: emailResult.messageId };
        } else {
            console.error(`❌ [Registration Email] Reminder email failed for ${mosqueData.admin_email}:`, emailResult.error);
            return { success: false, error: emailResult.error };
        }
        
    } catch (error) {
        console.error('❌ [Registration Email] Exception while sending reminder email:', error);
        return { success: false, error: error.message };
    }
};

// ✅ NIEUWE FUNCTIE: Test welkomstmail (voor debugging)
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

        // Bereid test email data voor
        const testEmailData = {
            id: mosque.id,
            name: mosque.name,
            subdomain: mosque.subdomain,
            admin_name: admin.name,
            admin_email: forceEmail || admin.email,
            email: mosque.email,
            address: mosque.address,
            city: mosque.city,
            zipcode: mosque.zipcode,
            phone: mosque.phone,
            website: mosque.website
        };

        // Verstuur test welkomstmail
        const result = await sendRegistrationWelcomeEmail(testEmailData);
        
        console.log(`🧪 [Registration Email] Test result for ${testEmailData.admin_email}:`, result);
        return result;
        
    } catch (error) {
        console.error('❌ [Registration Email] Error in test welcome email:', error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    sendRegistrationWelcomeEmail,
    sendGettingStartedReminder,
    testWelcomeEmail
};