// server.js - Complete werkende backend voor Al-Hijra Moskee Systeem
// Versie: 1.0.0 - Railway Compatible
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'https://vercel.app', 'https://*.vercel.app'],
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Server is running', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Microsoft 365 Email API
app.post('/api/send-email-m365', async (req, res) => {
  try {
    const { tenantId, clientId, clientSecret, to, subject, body, mosqueName } = req.body;
    
    console.log('📧 Email request received for:', to);
    
    // Validate required fields
    if (!tenantId || !clientId || !clientSecret || !to || !subject || !body) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: tenantId, clientId, clientSecret, to, subject, body' 
      });
    }

    // Get access token from Microsoft
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
    
    // Get sender email from environment or use default
    const senderEmail = process.env.M365_SENDER_EMAIL || 'onderwijs@al-hijra.nl';
    
    // Send email via Microsoft Graph
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
    
    res.json({ 
      success: true, 
      messageId: emailResponse.headers['request-id'] || 'sent_' + Date.now(),
      service: 'Microsoft Graph API',
      sender: senderEmail,
      recipient: to
    });
    
  } catch (error) {
    console.error('❌ Email send error:', error.response?.data || error.message);
    
    // Provide specific error details
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

// Test endpoint for checking environment variables
app.get('/api/config-check', (req, res) => {
  res.json({
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_ANON_KEY,
    hasM365TenantId: !!process.env.M365_TENANT_ID,
    hasM365ClientId: !!process.env.M365_CLIENT_ID,
    hasM365Secret: !!process.env.M365_CLIENT_SECRET,
    senderEmail: process.env.M365_SENDER_EMAIL || 'onderwijs@al-hijra.nl',
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3001
  });
});

// Simple mosque data endpoint (temporary - later we'll use Supabase)
app.get('/api/mosque/:subdomain', (req, res) => {
  const { subdomain } = req.params;
  
  // Mock data for testing
  const mockData = {
    'al-hijra': {
      id: 1,
      name: 'Al-Hijra Moskee',
      subdomain: 'al-hijra',
      address: 'Stationsweg 456',
      city: 'Rotterdam',
      zipcode: '3000CD',
      email: 'onderwijs@al-hijra.nl'
    },
    'al-noor': {
      id: 2,
      name: 'Al-Noor Moskee', 
      subdomain: 'al-noor',
      address: 'Hoofdstraat 123',
      city: 'Amsterdam',
      zipcode: '1234AB',
      email: 'info@al-noor.nl'
    }
  };
  
  const mosque = mockData[subdomain];
  if (!mosque) {
    return res.status(404).json({ error: 'Mosque not found' });
  }
  
  res.json(mosque);
});

// Catch all undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    available_routes: [
      'GET /api/health',
      'GET /api/config-check', 
      'POST /api/send-email-m365',
      'GET /api/mosque/:subdomain'
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
  console.log(`🚀 Moskee Backend API running on port ${PORT}`);
  console.log(`📧 Email endpoint: http://localhost:${PORT}/api/send-email-m365`);
  console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
  console.log(`⚙️  Config check: http://localhost:${PORT}/api/config-check`);
  console.log(`🕌 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;