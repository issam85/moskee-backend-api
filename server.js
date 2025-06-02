// server.js - Complete backend met Supabase database integratie
// Versie: 2.0.0 - Railway + Supabase Compatible
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase initialization
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://vercel.app', 
    'https://*.vercel.app',
    'https://moskee-systeem-iujmpp594-issams-projects-83c866b9.vercel.app',
    'https://mijnlvs.nl',
    'https://www.mijnlvs.nl',
    'https://al-noor.mijnlvs.nl',
    'https://al-hijra.mijnlvs.nl'
  ],
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Server is running', 
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    supabase: !!supabaseUrl
  });
});

// ======================
// AUTHENTICATION ROUTES
// ======================

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, subdomain } = req.body;
    
    // Find mosque by subdomain
    const { data: mosque, error: mosqueError } = await supabase
      .from('mosques')
      .select('id')
      .eq('subdomain', subdomain)
      .single();
    
    if (mosqueError || !mosque) {
      return res.status(404).json({ success: false, error: 'Mosque not found' });
    }
    
    // Find user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('mosque_id', mosque.id)
      .single();
    
    if (userError || !user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date() })
      .eq('id', user.id);
    
    // Return user data (without password)
    const { password_hash, ...userWithoutPassword } = user;
    res.json({ success: true, user: userWithoutPassword });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ======================
// MOSQUE ROUTES
// ======================

// Get mosque by subdomain
app.get('/api/mosque/:subdomain', async (req, res) => {
  try {
    const { subdomain } = req.params;
    
    const { data: mosque, error } = await supabase
      .from('mosques')
      .select('*')
      .eq('subdomain', subdomain)
      .single();
    
    if (error || !mosque) {
      return res.status(404).json({ error: 'Mosque not found' });
    }
    
    res.json(mosque);
  } catch (error) {
    console.error('Mosque fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ======================
// USER ROUTES
// ======================

// Get users by mosque
app.get('/api/mosques/:mosqueId/users', async (req, res) => {
  try {
    const { mosqueId } = req.params;
    const { role } = req.query;
    
    let query = supabase
      .from('users')
      .select('id, email, name, role, phone, address, city, zipcode, amount_due, created_at')
      .eq('mosque_id', mosqueId);
    
    if (role) {
      query = query.eq('role', role);
    }
    
    const { data: users, error } = await query;
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    res.json(users);
  } catch (error) {
    console.error('Users fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new user
app.post('/api/users', async (req, res) => {
  try {
    const { mosque_id, email, name, role, phone, address, city, zipcode, password } = req.body;
    
    // Hash password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);
    
    const { data: user, error } = await supabase
      .from('users')
      .insert([{
        mosque_id,
        email,
        password_hash,
        name,
        role,
        phone,
        address,
        city,
        zipcode,
        is_temporary_password: true
      }])
      .select()
      .single();
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    // Remove password from response
    const { password_hash: _, ...userWithoutPassword } = user;
    res.json({ success: true, user: userWithoutPassword });
  } catch (error) {
    console.error('User creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ======================
// CLASS ROUTES
// ======================

// Get classes by mosque
app.get('/api/mosques/:mosqueId/classes', async (req, res) => {
  try {
    const { mosqueId } = req.params;
    
    const { data: classes, error } = await supabase
      .from('classes')
      .select(`
        *,
        teacher:teacher_id(id, name),
        students(id, name, parent_id)
      `)
      .eq('mosque_id', mosqueId)
      .eq('active', true);
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    res.json(classes);
  } catch (error) {
    console.error('Classes fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new class
app.post('/api/classes', async (req, res) => {
  try {
    const { mosque_id, name, teacher_id, description } = req.body;
    
    const { data: classData, error } = await supabase
      .from('classes')
      .insert([{
        mosque_id,
        name,
        teacher_id,
        description
      }])
      .select()
      .single();
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    res.json({ success: true, class: classData });
  } catch (error) {
    console.error('Class creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ======================
// STUDENT ROUTES
// ======================

// Get students by mosque
app.get('/api/mosques/:mosqueId/students', async (req, res) => {
  try {
    const { mosqueId } = req.params;
    
    const { data: students, error } = await supabase
      .from('students')
      .select(`
        *,
        parent:parent_id(id, name, email, phone),
        class:class_id(id, name, teacher:teacher_id(name))
      `)
      .eq('mosque_id', mosqueId)
      .eq('active', true);
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    res.json(students);
  } catch (error) {
    console.error('Students fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new student
app.post('/api/students', async (req, res) => {
  try {
    const { mosque_id, parent_id, class_id, name, date_of_birth, emergency_contact, emergency_phone } = req.body;
    
    const { data: student, error } = await supabase
      .from('students')
      .insert([{
        mosque_id,
        parent_id,
        class_id,
        name,
        date_of_birth,
        emergency_contact,
        emergency_phone
      }])
      .select()
      .single();
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    // Update parent's amount due (€150 per child, max €450)
    const { data: siblings } = await supabase
      .from('students')
      .select('id')
      .eq('parent_id', parent_id)
      .eq('active', true);
    
    const childCount = siblings?.length || 0;
    const amountDue = Math.min(childCount * 150, 450);
    
    await supabase
      .from('users')
      .update({ amount_due: amountDue })
      .eq('id', parent_id);
    
    res.json({ success: true, student });
  } catch (error) {
    console.error('Student creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ======================
// PAYMENT ROUTES
// ======================

// Get payments by mosque
app.get('/api/mosques/:mosqueId/payments', async (req, res) => {
  try {
    const { mosqueId } = req.params;
    
    const { data: payments, error } = await supabase
      .from('payments')
      .select(`
        *,
        parent:parent_id(id, name, email),
        student:student_id(id, name),
        processed_by_user:processed_by(name)
      `)
      .eq('mosque_id', mosqueId)
      .order('created_at', { ascending: false });
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    res.json(payments);
  } catch (error) {
    console.error('Payments fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new payment
app.post('/api/payments', async (req, res) => {
  try {
    const { mosque_id, parent_id, student_id, amount, payment_method, payment_date, description, notes, processed_by } = req.body;
    
    const { data: payment, error } = await supabase
      .from('payments')
      .insert([{
        mosque_id,
        parent_id,
        student_id,
        amount,
        payment_method,
        payment_date: payment_date || new Date().toISOString().split('T')[0],
        description,
        notes,
        processed_by
      }])
      .select()
      .single();
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    res.json({ success: true, payment });
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ======================
// EMAIL ROUTES
// ======================

// Microsoft 365 Email API (existing)
app.post('/api/send-email-m365', async (req, res) => {
  try {
    const { tenantId, clientId, clientSecret, to, subject, body, mosqueName } = req.body;
    
    console.log('📧 Email request received for:', to);
    
    if (!tenantId || !clientId || !clientSecret || !to || !subject || !body) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    console.log('🔐 Getting access token from Microsoft...');
    const tokenResponse = await axios.post(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, 
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    
    const accessToken = tokenResponse.data.access_token;
    console.log('✅ Access token obtained successfully');
    
    const senderEmail = process.env.M365_SENDER_EMAIL || 'onderwijs@al-hijra.nl';
    
    console.log('📤 Sending email via Microsoft Graph...');
    const emailResponse = await axios.post(
      `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`,
      {
        message: {
          subject: subject,
          body: {
            contentType: 'Text',
            content: body
          },
          toRecipients: [{
            emailAddress: {
              address: to
            }
          }]
        }
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Email sent successfully via Microsoft Graph');
    
    // Log email to database
    if (mosqueName) {
      const { data: mosque } = await supabase
        .from('mosques')
        .select('id')
        .eq('name', mosqueName)
        .single();
      
      if (mosque) {
        await supabase
          .from('email_logs')
          .insert([{
            mosque_id: mosque.id,
            recipient_email: to,
            subject: subject,
            body: body,
            email_type: 'welcome',
            sent_status: 'sent',
            microsoft_message_id: emailResponse.headers['request-id'],
            sent_at: new Date()
          }]);
      }
    }
    
    res.json({ 
      success: true, 
      messageId: emailResponse.headers['request-id'] || 'sent_' + Date.now(),
      service: 'Microsoft Graph API',
      sender: senderEmail,
      recipient: to
    });
    
  } catch (error) {
    console.error('❌ Email send error:', error.response?.data || error.message);
    
    let errorMessage = 'Unknown error occurred';
    if (error.response?.data?.error) {
      errorMessage = error.response.data.error.message || error.response.data.error;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage,
      details: error.response?.data || null
    });
  }
});

// ======================
// CONFIG ROUTES
// ======================

// Test endpoint for checking environment variables
app.get('/api/config-check', (req, res) => {
  res.json({
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_SERVICE_KEY,
    hasM365TenantId: !!process.env.M365_TENANT_ID,
    hasM365ClientId: !!process.env.M365_CLIENT_ID,
    hasM365Secret: !!process.env.M365_CLIENT_SECRET,
    senderEmail: process.env.M365_SENDER_EMAIL || 'onderwijs@al-hijra.nl',
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3001
  });
});

// Catch all undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    available_routes: [
      'GET /api/health',
      'GET /api/config-check',
      'POST /api/auth/login',
      'GET /api/mosque/:subdomain',
      'GET /api/mosques/:mosqueId/users',
      'POST /api/users',
      'GET /api/mosques/:mosqueId/classes',
      'POST /api/classes',
      'GET /api/mosques/:mosqueId/students',
      'POST /api/students',
      'GET /api/mosques/:mosqueId/payments',
      'POST /api/payments',
      'POST /api/send-email-m365'
    ]
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Moskee Backend API v2.0.0 running on port ${PORT}`);
  console.log(`📧 Email endpoint: http://localhost:${PORT}/api/send-email-m365`);
  console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
  console.log(`⚙️  Config check: http://localhost:${PORT}/api/config-check`);
  console.log(`🗄️  Database: ${supabaseUrl ? 'Connected' : 'Not configured'}`);
  console.log(`🕌 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;