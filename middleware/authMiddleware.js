// middleware/authMiddleware.js
const { supabase } = require('../config/database');

// Deze middleware verifieert de JWT token en koppelt de volledige gebruiker uit de 'users' tabel aan req.user.
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    req.user = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const { data: { user: supabaseUser }, error: authError } = await supabase.auth.getUser(token);

            if (authError) {
                console.warn(`[AUTH] Token validation failed for path ${req.path}: ${authError.message}`);
            } else if (supabaseUser) {
                // Haal de volledige gebruiker op uit onze eigen 'users' tabel
                const { data: appUser, error: appUserError } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', supabaseUser.id)
                    .single();

                if (appUserError) {
                    console.error(`[AUTH] DB Error fetching app user for Supabase ID ${supabaseUser.id}:`, appUserError.message);
                } else if (appUser) {
                    req.user = appUser; // Koppel de gebruiker aan het request object
                } else {
                    console.warn(`[AUTH] App user not found in DB for valid Supabase user ID: ${supabaseUser.id}.`);
                }
            }
        } catch (e) {
            console.error('[AUTH] Unexpected error during token processing:', e.message);
        }
    }
    next();
};

module.exports = authMiddleware;
