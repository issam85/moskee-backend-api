// services/emailTemplates.js - Mooie templates voor alle email types

// ✅ OPTIMIZED TEMPLATE: Ouder naar Leraar - Simplified for better deliverability
const generateParentToTeacherEmail = (parentInfo, teacherInfo, subject, body, studentInfo = null) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <!-- Header -->
            <div style="background: #10b981; padding: 20px; border-radius: 8px; color: white; text-align: center; margin-bottom: 20px;">
                <h1 style="margin: 0; font-size: 20px;">Bericht van Ouder</h1>
                <p style="margin: 5px 0 0 0; opacity: 0.9;">via MijnLVS</p>
            </div>
            
            <!-- Contact Info -->
            <div style="background: #f3f4f6; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                <p style="margin: 0; color: #374151;"><strong>Van:</strong> ${parentInfo.name} (${parentInfo.email})</p>
                ${studentInfo ? `<p style="margin: 5px 0 0 0; color: #6b7280;">Ouder van: ${studentInfo.name}</p>` : ''}
                <p style="margin: 5px 0 0 0; color: #374151;"><strong>Aan:</strong> ${teacherInfo.name}</p>
            </div>
            
            <!-- Subject -->
            <div style="margin-bottom: 20px;">
                <h2 style="color: #374151; font-size: 18px; margin: 0 0 10px 0;">Onderwerp: ${subject}</h2>
            </div>
            
            <!-- Message Content -->
            <div style="background: #ffffff; border: 1px solid #d1d5db; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
                <div style="color: #374151; line-height: 1.6;">
                    ${body.replace(/\n/g, '<br>')}
                </div>
            </div>
            
            <!-- Footer -->
            <div style="text-align: center; color: #9ca3af; font-size: 14px; margin-top: 30px;">
                <p style="margin: 0;">Dit bericht is verzonden via MijnLVS</p>
            </div>
        </div>
    `;
};

// ✅ VERBETERDE TEMPLATE: Leraar naar Ouder (individueel)
const generateTeacherToParentEmail = (teacherInfo, parentInfo, subject, body, studentInfo = null) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 12px; color: white;">
                <h1 style="margin: 0; font-size: 24px;">👨‍🏫 Bericht van Leraar</h1>
                <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Verzonden via MijnLVS</p>
            </div>
            
            <!-- Van/Naar Info -->
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <h3 style="color: #047857; margin: 0 0 8px 0; font-size: 16px;">👨‍🏫 Van:</h3>
                        <p style="color: #065f46; margin: 0; font-weight: 500;">${teacherInfo.name}</p>
                        <p style="color: #059669; margin: 4px 0 0 0; font-size: 14px;">${teacherInfo.email}</p>
                        <p style="color: #059669; margin: 4px 0 0 0; font-size: 14px;">Leraar</p>
                    </div>
                    <div>
                        <h3 style="color: #047857; margin: 0 0 8px 0; font-size: 16px;">👨‍👩‍👧‍👦 Aan:</h3>
                        <p style="color: #065f46; margin: 0; font-weight: 500;">${parentInfo.name}</p>
                        <p style="color: #059669; margin: 4px 0 0 0; font-size: 14px;">${parentInfo.email}</p>
                        ${studentInfo ? `<p style="color: #059669; margin: 4px 0 0 0; font-size: 14px;">Ouder van: <strong>${studentInfo.name}</strong></p>` : ''}
                    </div>
                </div>
            </div>
            
            <!-- Onderwerp -->
            <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #92400e; margin: 0 0 8px 0; font-size: 18px;">📝 Onderwerp:</h3>
                <p style="color: #78350f; margin: 0; font-size: 16px; font-weight: 500;">${subject}</p>
            </div>
            
            <!-- Bericht Content -->
            <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 30px; margin: 24px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="color: #374151; margin: 0 0 16px 0; font-size: 18px; border-bottom: 2px solid #f3f4f6; padding-bottom: 8px;">💬 Bericht:</h3>
                <div style="color: #4b5563; line-height: 1.7; font-size: 15px;">
                    ${body.replace(/\n/g, '<br>')}
                </div>
            </div>
            
            <!-- Reactie Instructies -->
            <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #0369a1; margin: 0 0 12px 0; font-size: 16px;">↩️ Reageren:</h3>
                <p style="color: #075985; margin: 0; font-size: 14px; line-height: 1.5;">
                    U kunt direct op deze email reageren om de leraar te antwoorden. 
                    Uw antwoord wordt automatisch naar ${teacherInfo.name} gestuurd.
                </p>
            </div>
            
            <!-- Footer -->
            <div style="text-align: center; color: #6b7280; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0; font-size: 14px;">
                    Dit bericht is verzonden via <strong style="color: #10b981;">MijnLVS</strong>
                </p>
                <p style="margin: 8px 0 0 0; font-size: 12px;">
                    Automatisch gegenereerd op ${new Date().toLocaleDateString('nl-NL', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })}
                </p>
            </div>
        </div>
    `;
};

// ✅ VERBETERDE TEMPLATE: Leraar naar Klas (bulk)
const generateTeacherToClassEmail = (teacherInfo, classInfo, subject, body, parentName) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px; background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); padding: 30px; border-radius: 12px; color: white;">
                <h1 style="margin: 0; font-size: 24px;">📢 Klassenbericht</h1>
                <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Voor alle ouders van ${classInfo.name}</p>
            </div>
            
            <!-- Klas Info -->
            <div style="background: #f3e8ff; border: 1px solid #c4b5fd; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <div style="text-align: center;">
                    <h3 style="color: #6b21a8; margin: 0 0 8px 0; font-size: 20px;">🏫 ${classInfo.name}</h3>
                    <p style="color: #7c2d92; margin: 0; font-size: 16px;">Leraar: <strong>${teacherInfo.name}</strong></p>
                    <p style="color: #8b5cf6; margin: 8px 0 0 0; font-size: 14px;">Beste ${parentName || 'ouders/verzorgers'},</p>
                </div>
            </div>
            
            <!-- Onderwerp -->
            <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #92400e; margin: 0 0 8px 0; font-size: 18px;">📝 Onderwerp:</h3>
                <p style="color: #78350f; margin: 0; font-size: 16px; font-weight: 500;">${subject}</p>
            </div>
            
            <!-- Bericht Content -->
            <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 30px; margin: 24px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="color: #374151; margin: 0 0 16px 0; font-size: 18px; border-bottom: 2px solid #f3f4f6; padding-bottom: 8px;">💬 Bericht voor de klas:</h3>
                <div style="color: #4b5563; line-height: 1.7; font-size: 15px;">
                    ${body.replace(/\n/g, '<br>')}
                </div>
            </div>
            
            <!-- Reactie Instructies -->
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #047857; margin: 0 0 12px 0; font-size: 16px;">↩️ Vragen of opmerkingen?</h3>
                <p style="color: #065f46; margin: 0; font-size: 14px; line-height: 1.5;">
                    U kunt direct op deze email reageren om ${teacherInfo.name} een persoonlijk bericht te sturen. 
                    Uw antwoord wordt alleen naar de leraar gestuurd.
                </p>
            </div>
            
            <!-- Footer -->
            <div style="text-align: center; color: #6b7280; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0; font-size: 14px;">
                    Dit klassenbericht is verzonden via <strong style="color: #10b981;">MijnLVS</strong>
                </p>
                <p style="margin: 8px 0 0 0; font-size: 12px;">
                    Automatisch gegenereerd op ${new Date().toLocaleDateString('nl-NL', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })}
                </p>
            </div>
        </div>
    `;
};

// ✅ ALGEMENE TEMPLATE: Voor andere email types
const generateGenericEmail = (senderInfo, recipientInfo, subject, body, emailContext = 'algemeen') => {
    const contextColors = {
        'admin': { primary: '#dc2626', secondary: '#fef2f2', accent: '#fee2e2' },
        'system': { primary: '#7c3aed', secondary: '#faf5ff', accent: '#e9d5ff' },
        'algemeen': { primary: '#374151', secondary: '#f9fafb', accent: '#f3f4f6' }
    };
    
    const colors = contextColors[emailContext] || contextColors.algemeen;
    
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px; background: ${colors.primary}; padding: 30px; border-radius: 12px; color: white;">
                <h1 style="margin: 0; font-size: 24px;">📧 Bericht via MijnLVS</h1>
                <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Persoonlijke communicatie</p>
            </div>
            
            <!-- Van/Naar Info -->
            <div style="background: ${colors.secondary}; border: 1px solid ${colors.accent}; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <h3 style="color: ${colors.primary}; margin: 0 0 8px 0; font-size: 16px;">📤 Van:</h3>
                        <p style="color: ${colors.primary}; margin: 0; font-weight: 500;">${senderInfo.name}</p>
                        <p style="color: ${colors.primary}; margin: 4px 0 0 0; font-size: 14px; opacity: 0.8;">${senderInfo.email}</p>
                        <p style="color: ${colors.primary}; margin: 4px 0 0 0; font-size: 14px; opacity: 0.8;">${senderInfo.role || 'Gebruiker'}</p>
                    </div>
                    <div>
                        <h3 style="color: ${colors.primary}; margin: 0 0 8px 0; font-size: 16px;">📥 Aan:</h3>
                        <p style="color: ${colors.primary}; margin: 0; font-weight: 500;">${recipientInfo.name}</p>
                        <p style="color: ${colors.primary}; margin: 4px 0 0 0; font-size: 14px; opacity: 0.8;">${recipientInfo.email}</p>
                        <p style="color: ${colors.primary}; margin: 4px 0 0 0; font-size: 14px; opacity: 0.8;">${recipientInfo.role || 'Gebruiker'}</p>
                    </div>
                </div>
            </div>
            
            <!-- Onderwerp -->
            <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #92400e; margin: 0 0 8px 0; font-size: 18px;">📝 Onderwerp:</h3>
                <p style="color: #78350f; margin: 0; font-size: 16px; font-weight: 500;">${subject}</p>
            </div>
            
            <!-- Bericht Content -->
            <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 30px; margin: 24px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="color: #374151; margin: 0 0 16px 0; font-size: 18px; border-bottom: 2px solid #f3f4f6; padding-bottom: 8px;">💬 Bericht:</h3>
                <div style="color: #4b5563; line-height: 1.7; font-size: 15px;">
                    ${body.replace(/\n/g, '<br>')}
                </div>
            </div>
            
            <!-- Reactie Instructies -->
            <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #0369a1; margin: 0 0 12px 0; font-size: 16px;">↩️ Reageren:</h3>
                <p style="color: #075985; margin: 0; font-size: 14px; line-height: 1.5;">
                    U kunt direct op deze email reageren om ${senderInfo.name} te antwoorden.
                </p>
            </div>
            
            <!-- Footer -->
            <div style="text-align: center; color: #6b7280; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0; font-size: 14px;">
                    Dit bericht is verzonden via <strong style="color: #10b981;">MijnLVS</strong>
                </p>
                <p style="margin: 8px 0 0 0; font-size: 12px;">
                    Automatisch gegenereerd op ${new Date().toLocaleDateString('nl-NL', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })}
                </p>
            </div>
        </div>
    `;
};

// ✅ NIEUWE TEMPLATE: Admin naar alle ouders (bulk)
const generateAdminToAllParentsEmail = (adminInfo, mosqueInfo, subject, body, parentName) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; border-radius: 12px; color: white;">
                <h1 style="margin: 0; font-size: 24px;">📢 Belangrijk Bericht</h1>
                <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Van ${mosqueInfo.name || 'Onderwijsinstelling'}</p>
            </div>

            <!-- Moskee Info -->
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <div style="text-align: center;">
                    <h3 style="color: #991b1b; margin: 0 0 8px 0; font-size: 20px;">🕌 ${mosqueInfo.name || 'Al-Hijra Onderwijs'}</h3>
                    <p style="color: #b91c1c; margin: 0; font-size: 16px;">Bericht van: <strong>${adminInfo.name}</strong></p>
                    <p style="color: #dc2626; margin: 8px 0 0 0; font-size: 14px;">Beste ${parentName || 'ouders/verzorgers'},</p>
                </div>
            </div>

            <!-- Onderwerp -->
            <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #92400e; margin: 0 0 8px 0; font-size: 18px;">📝 Onderwerp:</h3>
                <p style="color: #78350f; margin: 0; font-size: 16px; font-weight: 500;">${subject}</p>
            </div>

            <!-- Bericht Content -->
            <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 30px; margin: 24px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="color: #374151; margin: 0 0 16px 0; font-size: 18px; border-bottom: 2px solid #f3f4f6; padding-bottom: 8px;">💬 Bericht voor alle ouders:</h3>
                <div style="color: #4b5563; line-height: 1.7; font-size: 15px;">
                    ${body.replace(/\n/g, '<br>')}
                </div>
            </div>

            <!-- Contact Info -->
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #047857; margin: 0 0 12px 0; font-size: 16px;">📞 Contact & Vragen:</h3>
                <p style="color: #065f46; margin: 0; font-size: 14px; line-height: 1.5;">
                    Voor vragen of opmerkingen kunt u contact opnemen met ${mosqueInfo.name || 'de school'}
                    of rechtstreeks reageren op deze email naar ${adminInfo.name}.
                </p>
                <p style="color: #065f46; margin: 8px 0 0 0; font-size: 14px;">
                    📧 <strong>Email:</strong> ${adminInfo.email}
                </p>
            </div>

            <!-- Footer -->
            <div style="text-align: center; color: #6b7280; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0; font-size: 14px;">
                    Dit bericht is verzonden via <strong style="color: #10b981;">MijnLVS</strong>
                </p>
                <p style="margin: 8px 0 0 0; font-size: 12px;">
                    Verzonden op ${new Date().toLocaleDateString('nl-NL', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })} aan alle ouders
                </p>
            </div>
        </div>
    `;
};

module.exports = {
    generateParentToTeacherEmail,
    generateTeacherToParentEmail,
    generateTeacherToClassEmail,
    generateGenericEmail,
    generateAdminToAllParentsEmail
};