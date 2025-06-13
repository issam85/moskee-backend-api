// server.js - Versie 3.0 (Refactored)
// Deze file is nu de orchestrator. Het zet de server op, laadt middleware en koppelt de routes.
const express = require('express');
const cors = require('cors');

// --- Import Configuratie ---
const { supabase } = require('./config/database'); // Zorgt ervoor dat de DB verbinding als eerste wordt getest.

// --- Import Middleware ---
const authMiddleware = require('./middleware/authMiddleware');
const checkSubscription = require('./middleware/subscription');
const { routeNotFoundHandler, globalErrorHandler } = require('./middleware/errorMiddleware');

// --- Import Route Handlers ---
const authRoutes = require('./routes/authRoutes');
const mosqueRoutes = require('./routes/mosqueRoutes');
const userRoutes = require('./routes/userRoutes');
const classRoutes = require('./routes/classRoutes');
const studentRoutes = require('./routes/studentRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const lessonRoutes = require('./routes/lessonRoutes');
const reportRoutes = require('./routes/reportRoutes');
const quranRoutes = require('./routes/quranRoutes');
const emailRoutes = require('./routes/emailRoutes');
const debugRoutes = require('./routes/debugRoutes'); // NEW
const { handleStripeWebhook } = require('./services/stripeService');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware Setup ---
const corsOptions = {
  origin: function (origin, callback) {
    const whitelist = [
      'http://localhost:3000',
      'https://mijnlvs.nl',
      'https://www.mijnlvs.nl',
    ];
    const allowedOriginPatterns = [
      /^https:\/\/[a-z0-9-]+\.mijnlvs\.nl$/,
      /^https:\/\/moskee-systeem.*\.vercel\.app$/,
    ];
    if (!origin || whitelist.indexOf(origin) !== -1 || allowedOriginPatterns.some(pattern => pattern.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};
app.use(cors(corsOptions));

// Specifieke route voor Stripe Webhook MOET vóór express.json() komen.
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Algemene middleware
app.use(express.json());

// --- Publieke Routes & Health Check ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running',
    version: '3.0.0-refactored',
    timestamp: new Date().toISOString()
  });
});

// --- Debug Routes (development only) ---
app.use('/api/debug', debugRoutes);

// --- Authenticated Route Setup ---
// 1. Koppel de router voor publieke endpoints (login/register)
app.use('/api', authRoutes); // Bevat /auth/login, /mosques/register

// 2. Pas de authenticatie middleware toe op alle volgende routes
app.use(authMiddleware);

// 3. Pas de abonnementscheck toe
app.use(checkSubscription);

// 4. Koppel alle beveiligde API-routes
app.use('/api/mosques', mosqueRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/lessen', lessonRoutes); // Voor individuele les-acties
app.use('/api/reports', reportRoutes);
app.use('/api/quran', quranRoutes);
app.use('/api/email', emailRoutes);

// --- Error Handling ---
// Vang alle niet-gedefinieerde routes op
app.use('*', routeNotFoundHandler);
// Globale error handler
app.use(globalErrorHandler);


// --- Server Start ---
app.listen(PORT, () => {
  console.log(`🚀 Moskee Backend API v3.0 (Refactored) running on port ${PORT}`);
  console.log(`🔗 Base URL for API: (Your Railway public URL)`);
  console.log(`🗄️ Supabase Project URL: ${process.env.SUPABASE_URL ? process.env.SUPABASE_URL.split('.')[0] + '.supabase.co' : 'Not configured'}`);
  if (process.env.NODE_ENV !== 'production') {
    console.warn("⚠️ Running in development mode. Detailed errors might be exposed.");
  } else {
    console.log("🔒 Running in production mode.");
  }
});

module.exports = app;