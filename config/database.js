// config/database.js
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

console.log("🚦 [INIT] Initializing Supabase client...");
if (!supabaseUrl || !supabaseKey) {
  console.error("❌ FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required.");
  process.exit(1);
}
if (!supabaseKey.includes('eyJ') || supabaseKey.length < 100) {
  console.error("❌ FATAL: SUPABASE_SERVICE_KEY is not a valid service_role key. Use the service_role key, not the anon key.");
  process.exit(1);
}

let supabase;
try {
  // Expliciete configuratie voor server-side gebruik met admin rechten
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
  console.log("✅ [INIT] Supabase client created.");

  if (!supabase.auth.admin) {
      console.error("❌ FATAL: supabase.auth.admin object is NOT available. Check @supabase/supabase-js version (should be v2+).");
      process.exit(1);
  }
  
} catch (initError) {
  console.error("❌ FATAL: Supabase client initialization FAILED:", initError.message);
  process.exit(1);
}

async function testSupabaseConnection() {
  console.log("🚦 [DB STARTUP TEST] Attempting a simple query to Supabase...");
  try {
    const { error, count } = await supabase.from('mosques').select('id', { count: 'exact' }).limit(1);
    if (error) {
      console.error("❌ [DB STARTUP TEST] Supabase query FAILED. Error:", JSON.stringify(error, null, 2));
    } else {
      console.log(`✅ [DB STARTUP TEST] Supabase query SUCCEEDED. Found ${count} mosque(s).`);
    }
  } catch (e) {
    console.error("❌ [DB STARTUP TEST] Supabase query FAILED with exception:", e.message);
  }
}

testSupabaseConnection();

module.exports = { supabase };