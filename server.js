// server.js - Versie 3.0 (Refactored with Trial Routes)
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
const debugRoutes = require('./routes/debugRoutes');
const trialRoutes = require('./routes/trialRoutes'); // ✅ ADD THIS LINE
const eboekhoudenRoutes = require('./routes/eboekhoudenRoutes');
const { handleStripeWebhook } = require('./services/stripeService');
require('./jobs/sessionRetryJob');
console.log('✅ Session retry cron job initialized');

// --- Security Checks at Startup ---
// SECURITY FIX (H1): Reject startup if JWT_SECRET is too weak
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.error('❌ FATAL: JWT_SECRET must be at least 32 characters long. Current length:', process.env.JWT_SECRET.length);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware Setup ---
const corsOptions = {
  origin: function (origin, callback) {
    const whitelist = [
      'http://localhost:3000',
      'https://mijnlvs.nl',
      'https://www.mijnlvs.nl',
      'https://al-hijra.mijnlvs.nl',
      'https://al-hijra.nl',
      'https://www.al-hijra.nl',
      'https://dashboard.al-hijra.nl',
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

// SECURITY FIX (H5): Add security headers
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Specifieke route voor Stripe Webhook MOET vóór express.json() komen.
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Algemene middleware
app.use(express.json());

// --- SECURITY FIX (H1): In-memory rate limiter ---
const rateLimitStore = new Map();

function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= maxRequests) {
      return res.status(429).json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' });
    }
    entry.count++;
    next();
  };
}

// Clean expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitStore) {
    if (now > val.resetAt) rateLimitStore.delete(key);
  }
}, 60000);

// Apply rate limits to sensitive endpoints
app.post('/api/auth/login', rateLimit(15 * 60 * 1000, 5));           // 5 per 15 min
app.post('/api/mosques/register', rateLimit(60 * 60 * 1000, 3));     // 3 per hour
app.post('/api/email/*', rateLimit(60 * 60 * 1000, 10));             // 10 per hour
app.post('/api/users/*/send-new-password', rateLimit(60 * 60 * 1000, 10)); // 10 per hour

// --- Publieke Routes & Health Check ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running',
    version: '3.0.0-refactored',
    timestamp: new Date().toISOString()
  });
});

// SECURITY FIX (H2/H3): Debug routes gated behind NODE_ENV === 'development' check
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/debug', debugRoutes);
} else {
  app.use('/api/debug', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });
}

// --- Route Setup ---
// 1. Publieke routes (geen authenticatie nodig)
app.use('/api', authRoutes); // Handelt /api/auth/login en /api/mosques/register af

// 2. eBoekhouden proxy (eigen API key verificatie, geen JWT nodig)
// SECURITY FIX (C4): eigen verifyApiKey middleware in eboekhoudenRoutes.js
app.use('/api/eboekhouden', eboekhoudenRoutes);

// 3. Moskee routes (subdomain lookup is publiek, overige routes checken req.user zelf)
app.use('/api/mosques', mosqueRoutes);

// 4. Beveiligde routes (JWT authenticatie vereist)
app.use(authMiddleware); // Authenticatie middleware
app.use(checkSubscription); // Abonnementscheck
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/lessen', lessonRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/quran', quranRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/trial', trialRoutes);

// --- Error Handling ---
app.use('*', routeNotFoundHandler);
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