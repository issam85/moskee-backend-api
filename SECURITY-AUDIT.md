# Security Audit Report - Moskee Backend API

**Date:** 2026-03-18
**Scope:** Full codebase review of moskee-backend Express.js REST API
**Auditor:** Automated security review
**Deployment Target:** Railway

---

## Executive Summary

This audit identified **4 CRITICAL**, **8 HIGH**, **9 MEDIUM**, and **7 LOW** severity issues across the codebase. The most urgent issues are live production secrets committed to the repository, a weak hardcoded JWT secret, unauthenticated public endpoints exposing sensitive functionality, and a complete absence of rate limiting.

---

## CRITICAL Severity Issues

### C1. Production Secrets Committed to Repository

- **File:** `C:\git\moskee-backend\.env` (lines 8-36)
- **Description:** The `.env` file is tracked in the Git repository and contains live production secrets including:
  - Supabase URL and anon key (line 11-12)
  - Resend API key: `re_YY9fE91V_...` (line 26)
  - Stripe **live** secret key: `sk_live_51RYZj9CHZ9R82JCd...` (line 29)
  - Stripe webhook secret: `whsec_ME0ALW...` (line 30)
  - Internal API key (line 8)
  - JWT secret (line 36)
- **Impact:** Anyone with repository access can make charges via Stripe, send emails via Resend, access/modify all database records, and impersonate any user. The Stripe key prefix `sk_live_` confirms this is a live production key.
- **Recommended Fix:**
  1. **Immediately rotate ALL exposed keys** (Stripe, Resend, Supabase, JWT secret, internal API key).
  2. Remove `.env` from the repository: `git rm --cached .env`.
  3. Verify `.env` is in `.gitignore` (it is listed, but the file was still committed before the rule was added).
  4. Use `git filter-branch` or `git-filter-repo` to purge `.env` from Git history.
  5. Create a `.env.example` file with placeholder values only.

### C2. Weak Hardcoded JWT Secret

- **File:** `C:\git\moskee-backend\.env` (line 36)
- **Description:** The JWT secret is `moskee-al-hijra-super-secure-secret-2024` -- a human-readable, guessable string. Combined with C1 (it is in the repository), any attacker can forge valid JWT tokens to impersonate any user including admins.
- **Impact:** Complete authentication bypass. An attacker can craft tokens for any user ID and gain full admin access to any mosque.
- **Recommended Fix:**
  1. Generate a cryptographically random secret of at least 256 bits (e.g., `openssl rand -base64 64`).
  2. Store it exclusively in Railway environment variables, never in code or `.env` files committed to Git.

### C3. Authentication Middleware Does Not Block Unauthenticated Requests

- **File:** `C:\git\moskee-backend\middleware\authMiddleware.js` (lines 5-37)
- **Description:** The `authMiddleware` sets `req.user = null` when no valid token is provided but **always calls `next()`** (line 36). It never returns a 401 response. This means all "protected" routes behind the middleware are accessible to unauthenticated users unless each individual route handler explicitly checks `if (!req.user)`.
- **Impact:** Any route that forgets to check `req.user` is publicly accessible. Several routes do check, but this defense-in-depth failure means a single missed check exposes data.
- **Affected routes with missing or weak checks:**
  - `POST /api/payments/stripe/create-checkout-session` (paymentRoutes.js line 12) -- no auth check, proceeds without `req.user`
  - `POST /api/payments/stripe/link-pending-payment` (paymentRoutes.js line 109) -- no auth check
  - `POST /api/payments/stripe/link-by-session` (paymentRoutes.js line 238) -- no auth check
  - `GET /api/payments/stripe/session/:sessionId` (paymentRoutes.js line 580) -- no auth check, exposes Stripe session details to anyone
- **Recommended Fix:**
  1. Modify `authMiddleware` to return `401 Unauthorized` when no valid token is present, with an explicit bypass list for public routes.
  2. Alternatively, create a separate `requireAuth` middleware that returns 401 if `req.user` is null, and apply it to all protected route groups.

### C4. eBoekhouden Proxy Is Completely Unauthenticated

- **File:** `C:\git\moskee-backend\routes\eboekhoudenRoutes.js` (lines 68-113)
- **File:** `C:\git\moskee-backend\server.js` (line 82)
- **Description:** The eBoekhouden proxy routes are mounted at `/api/eboekhouden` **before** the auth middleware (server.js line 82, auth middleware is applied at line 85). The routes themselves have zero authentication or authorization checks. Any anonymous user can make arbitrary GET and PATCH requests to the eBoekhouden accounting API through this proxy, using the server's credentials.
- **Impact:** Full unauthenticated access to the bookkeeping/accounting system. An attacker can read all financial records and modify accounting entries.
- **Recommended Fix:**
  1. Move the eBoekhouden routes below the `authMiddleware` line in server.js, or add explicit authentication checks within the routes.
  2. Add authorization checks to restrict access to admin users only.
  3. Validate and whitelist the proxy path to prevent path traversal against the upstream API.

---

## HIGH Severity Issues

### H1. No Rate Limiting on Any Endpoint

- **Files:** `C:\git\moskee-backend\server.js`, all route files
- **Description:** There is no rate limiting middleware (`express-rate-limit` or similar) configured anywhere in the application. This applies to all endpoints including:
  - Login endpoint (`POST /api/auth/login`)
  - Registration endpoint (`POST /api/mosques/register`)
  - Email sending endpoints (bulk email to all parents)
  - Password reset (`POST /api/users/:userId/send-new-password`)
  - Stripe checkout session creation
- **Impact:** Vulnerable to brute-force credential attacks, account enumeration, email bombing (bulk email endpoints can be triggered repeatedly), and denial-of-service.
- **Recommended Fix:**
  1. Install `express-rate-limit` and apply global rate limiting.
  2. Apply stricter limits on authentication endpoints (e.g., 5 attempts per minute per IP).
  3. Apply limits on email-sending endpoints to prevent abuse as an email relay.

### H2. Debug Routes Exposed Without Authentication

- **File:** `C:\git\moskee-backend\routes\debugRoutes.js` (lines 7-13, 244-293)
- **File:** `C:\git\moskee-backend\server.js` (line 77)
- **Description:** Debug routes are mounted at `/api/debug` **before** the auth middleware (server.js line 77). While there is a production check at the top of the file (line 7), this relies solely on `NODE_ENV` being set correctly. The `POST /api/debug/test-resend-email` endpoint (line 244) has **no authentication check at all** -- it allows anyone to send emails to arbitrary addresses via the Resend API. Additionally, the debug routes leak API key prefixes, key lengths, and system configuration details.
- **Impact:** Open email relay (anyone can send emails via your Resend account), information disclosure of internal configuration, and potential for abuse if `NODE_ENV` is misconfigured.
- **Recommended Fix:**
  1. Move debug routes behind auth middleware and restrict to admin role.
  2. Consider removing debug routes entirely from production deployments.
  3. Never expose API key prefixes or lengths in any response.

### H3. Unauthenticated Test/Registration Email Endpoints

- **File:** `C:\git\moskee-backend\routes\authRoutes.js` (lines 401-480)
- **Description:** The endpoints `POST /api/mosques/test-welcome-email` and `POST /api/mosques/check-email` are public routes (mounted before auth middleware). The test-welcome-email endpoint allows anyone to trigger welcome emails by providing a `mosqueId`, potentially causing email spam. The check-email endpoint calls `supabase.auth.admin.listUsers()` to enumerate whether an email exists, enabling user enumeration attacks.
- **Impact:** Email spam/abuse potential, user enumeration.
- **Recommended Fix:**
  1. Move these endpoints behind authentication and restrict to admin users.
  2. For email-exists checks, return a generic response that does not reveal whether the email is registered.

### H4. Internal API Key Is Weak and Predictable

- **File:** `C:\git\moskee-backend\.env` (line 8)
- **Description:** The `INTERNAL_API_KEY` is set to `M0sk33@lh1jr@!@#` -- a short, predictable string using leet-speak substitutions of the organization name. This key protects the cron job endpoint `POST /api/payments/stripe/retry-pending-links` (paymentRoutes.js line 365).
- **Impact:** Easily guessable key allows unauthorized triggering of payment retry operations.
- **Recommended Fix:** Generate a cryptographically random API key of at least 32 characters and store it only in Railway environment variables.

### H5. No Security Headers (Helmet)

- **File:** `C:\git\moskee-backend\server.js`
- **Description:** The server does not use `helmet` or any other security header middleware. Missing headers include:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Strict-Transport-Security` (HSTS)
  - `X-XSS-Protection`
  - `Content-Security-Policy`
- **Impact:** Increased exposure to clickjacking, MIME-type sniffing, and other browser-based attacks if any frontend is served from the same origin.
- **Recommended Fix:** Install and configure `helmet` middleware: `app.use(helmet())`.

### H6. CORS Wildcard Pattern Too Permissive

- **File:** `C:\git\moskee-backend\server.js` (lines 47-50)
- **Description:** The CORS configuration allows origins matching:
  - `/^https:\/\/[a-z0-9-]+\.mijnlvs\.nl$/` -- Any subdomain of mijnlvs.nl (reasonable)
  - `/^https:\/\/moskee-systeem.*\.vercel\.app$/` -- This pattern uses `.*` after `moskee-systeem`, which matches `moskee-systeem-ANYTHING.vercel.app` but also `moskee-systeemEVIL.vercel.app`. An attacker could create a Vercel deployment matching this pattern to perform cross-origin attacks.
- **Impact:** Potential cross-origin data theft if an attacker deploys a malicious site on Vercel with a matching domain name.
- **Recommended Fix:** Tighten the regex to `/^https:\/\/moskee-systeem(-[a-z0-9]+)*\.vercel\.app$/` or use an explicit whitelist of known Vercel deployment URLs.

### H7. Password Returned in API Response on Email Failure

- **File:** `C:\git\moskee-backend\routes\userRoutes.js` (lines 316-329)
- **Description:** When the password reset email fails to send, the plaintext temporary password is returned in the JSON response body via `newPasswordForManualDelivery` (lines 320, 327). This password is transmitted over the network and potentially logged by proxies, browser devtools, or monitoring tools.
- **Impact:** Plaintext password exposure in transit and in logs.
- **Recommended Fix:** Never return passwords in API responses. Instead, provide a UI mechanism for the admin to view or copy the password client-side, or require the user to go through a secure password reset flow.

### H8. Subscription Middleware Fails Open

- **File:** `C:\git\moskee-backend\middleware\subscription.js` (lines 13-14, 50-51)
- **Description:** When `req.user` is null (line 13) or when a database error occurs (line 51), the middleware calls `next()` instead of blocking the request. Combined with C3 (auth middleware not blocking), this means unauthenticated users bypass both auth and subscription checks.
- **Impact:** Subscription enforcement can be bypassed by not providing authentication tokens.
- **Recommended Fix:** Return an appropriate error (401/403) instead of calling `next()` on failure conditions.

---

## MEDIUM Severity Issues

### M1. Error Details Leaked to Clients

- **File:** `C:\git\moskee-backend\utils\errorHelper.js` (line 5)
- **Description:** The `sendError` function always includes `details` in the JSON response. In many call sites, `error.message` (which can contain database error messages, stack traces, or internal paths) is passed as the details parameter. While `globalErrorHandler` (errorMiddleware.js line 14) conditionally hides messages in production for 500 errors, the `sendError` utility used throughout the codebase does not apply this filtering.
- **Impact:** Internal error details, database schema information, and file paths can be leaked to attackers, aiding in further exploitation.
- **Recommended Fix:** Modify `sendError` to only include `details` when `NODE_ENV !== 'production'`, or omit sensitive error details from client-facing responses entirely.

### M2. No Input Validation on eBoekhouden Proxy Path

- **File:** `C:\git\moskee-backend\routes\eboekhoudenRoutes.js` (lines 68-77)
- **Description:** The proxy endpoint passes `req.params[0]` directly to construct the upstream URL path and forwards `req.query` and `req.body` without validation. While the upstream API has its own validation, the proxy trusts all input blindly.
- **Impact:** Potential for SSRF-like attacks if the path construction allows accessing unintended eBoekhouden API endpoints, or injection of unexpected parameters.
- **Recommended Fix:** Validate and whitelist allowed API paths. Sanitize query parameters before forwarding.

### M3. Infinite Retry Loop in eBoekhouden Proxy

- **File:** `C:\git\moskee-backend\routes\eboekhoudenRoutes.js` (lines 52-57)
- **Description:** The `proxyGet` function calls itself recursively on 401 errors without a retry counter. If the token is consistently rejected (e.g., invalid API key), this creates an infinite recursive loop that will crash the server with a stack overflow.
- **Impact:** Denial of service if the eBoekhouden API consistently returns 401.
- **Recommended Fix:** Add a retry counter parameter and limit to 1-2 retries.

### M4. User Enumeration via Registration and Login

- **File:** `C:\git\moskee-backend\routes\authRoutes.js` (lines 33-34, 86-89, 104-106)
- **Description:** The registration flow provides different error messages for "subdomain not found" (404), "subdomain already in use" (409), and "email already registered" (409). The login flow reveals whether a subdomain exists before checking credentials. This allows attackers to enumerate valid subdomains and email addresses.
- **Impact:** Attackers can discover which mosques use the platform and which email addresses are registered.
- **Recommended Fix:** Return generic error messages like "Registration failed" regardless of the specific reason, at least for the email-exists check.

### M5. Lesson Route Accepts Arbitrary Fields via Spread Operator

- **File:** `C:\git\moskee-backend\routes\lessonRoutes.js` (lines 75-81)
- **Description:** The lesson creation endpoint uses `...req.body` to construct the insert data. This allows an attacker to inject arbitrary fields into the database record that the developer did not intend (mass assignment).
- **Impact:** An attacker could set fields like `moskee_id` to a different mosque's ID (though this is partially mitigated by later overwrite on line 77), or inject other columns that exist in the table.
- **Recommended Fix:** Explicitly destructure and whitelist only the expected fields from `req.body`.

### M6. Student Update Route Mass Assignment

- **File:** `C:\git\moskee-backend\routes\studentRoutes.js` (lines 209-213)
- **Description:** The student update uses `...req.body` and then deletes a few known-bad fields. This allowlist-via-denylist approach is fragile -- any new sensitive column added to the table would be writable by default.
- **Impact:** Potential for modifying unintended database fields.
- **Recommended Fix:** Use an explicit allowlist of updatable fields rather than spreading the entire request body.

### M7. Lesson Update Route Mass Assignment

- **File:** `C:\git\moskee-backend\routes\lessonRoutes.js` (line 100)
- **Description:** Similar to M5/M6, the lesson update uses `...req.body` with minimal field filtering.
- **Impact:** Same as M5/M6.
- **Recommended Fix:** Use an explicit allowlist of updatable fields.

### M8. Email HTML Body Injection (XSS in Emails)

- **File:** `C:\git\moskee-backend\services\emailTemplates.js` (all template functions)
- **Description:** User-supplied input (`subject`, `body`, `parentInfo.name`, etc.) is interpolated directly into HTML email templates using template literals without HTML-escaping. For example, line 29: `${body.replace(/\n/g, '<br>')}` only replaces newlines but does not escape HTML characters like `<`, `>`, `"`, or `&`.
- **Impact:** An attacker can inject arbitrary HTML/JavaScript into emails sent to other users. While most email clients strip JavaScript, HTML injection can still be used for phishing (e.g., injecting fake login forms or malicious links that appear legitimate).
- **Recommended Fix:** HTML-escape all user-provided content before inserting into email templates. Use a library like `he` or `escape-html`.

### M9. Weak Temporary Password Generation

- **File:** `C:\git\moskee-backend\routes\userRoutes.js` (lines 10-12)
- **Description:** Temporary passwords are generated with `Math.random().toString(36).slice(2, 10) + 'A!b2'`. `Math.random()` is not cryptographically secure. The password always ends with the same suffix `A!b2`, making the pattern predictable. The total entropy is approximately 40-50 bits.
- **Impact:** Temporary passwords can be predicted or brute-forced, especially if an attacker knows the generation pattern.
- **Recommended Fix:** Use `crypto.randomBytes()` or `crypto.randomUUID()` for password generation. Ensure sufficient entropy (at least 72 bits).

---

## LOW Severity Issues

### L1. No Request Body Size Limit

- **File:** `C:\git\moskee-backend\server.js` (line 65)
- **Description:** `express.json()` is used without a body size limit. The default is 100KB, which is reasonable, but should be explicitly set to prevent unexpected behavior if Express defaults change.
- **Recommended Fix:** Set explicit limit: `express.json({ limit: '100kb' })`.

### L2. Logger Utility Not Used Consistently

- **File:** `C:\git\moskee-backend\utils\logger.js`
- **Description:** A secure logger utility exists that sanitizes sensitive data in production, but it is never imported or used anywhere in the codebase. All files use `console.log/error/warn` directly, which means sensitive data (tokens, keys, user details) may be logged in production.
- **Recommended Fix:** Replace `console.log/error/warn` calls with the logger utility throughout the codebase.

### L3. bcryptjs Imported But Not Used

- **File:** `C:\git\moskee-backend\package.json` (line 22)
- **Description:** `bcryptjs` is listed as a dependency but is never imported or used in any source file. The application relies entirely on Supabase Auth for password handling, which is fine, but the unused dependency increases the attack surface.
- **Recommended Fix:** Remove `bcryptjs` from dependencies if it is not needed.

### L4. Missing HTTPS Redirect / Trust Proxy

- **File:** `C:\git\moskee-backend\server.js`
- **Description:** The Express app does not configure `app.set('trust proxy', 1)` for Railway's reverse proxy. This means `req.ip` will show the proxy IP instead of the client IP, making IP-based rate limiting ineffective when implemented. There is also no explicit HTTPS enforcement.
- **Recommended Fix:** Add `app.set('trust proxy', 1)` and consider adding HTTPS redirect middleware.

### L5. No Pagination Limits on List Endpoints

- **Files:** Multiple route files (classRoutes.js, studentRoutes.js, userRoutes.js, paymentRoutes.js)
- **Description:** Several list endpoints (e.g., `GET /api/students/mosque/:mosqueId`, `GET /api/users/mosque/:mosqueId`) do not enforce pagination limits. A mosque with thousands of records would return all of them in a single response.
- **Impact:** Potential for denial-of-service via memory exhaustion on large datasets.
- **Recommended Fix:** Add default pagination with reasonable limits (e.g., 100 records per page).

### L6. Supabase Anon Key in .env (Minor)

- **File:** `C:\git\moskee-backend\.env` (line 12)
- **Description:** The Supabase anon key is in the `.env` file. While anon keys are designed to be public (they are embedded in frontend clients), having them in the same file as secret keys increases confusion. The server uses `SUPABASE_SERVICE_KEY` (not in the file, presumably set in Railway), but the anon key's presence is unnecessary.
- **Recommended Fix:** Remove the anon key from `.env` if it is not used server-side.

### L7. Express 4.x End-of-Life Approaching

- **File:** `C:\git\moskee-backend\package.json` (line 24)
- **Description:** The application uses Express 4.18.x. While no critical CVEs are currently known, Express 5.x has been released and Express 4.x will eventually stop receiving security patches. Additionally, `cookie` < 0.7.0 (a transitive dependency of Express 4.x) had known vulnerabilities.
- **Recommended Fix:** Plan migration to Express 5.x. In the meantime, run `npm audit` regularly and update dependencies.

---

## Positive Observations

The following security measures are already in place and working correctly:

1. **Stripe webhook signature verification** (stripeService.js lines 12-16) -- properly validates the `stripe-signature` header using `stripe.webhooks.constructEvent()`.
2. **Supabase service key validation** (config/database.js lines 8-15) -- checks for key presence and format at startup.
3. **Role-based authorization** -- most routes check `req.user.role` before allowing operations.
4. **Mosque-scoped data access** -- most routes verify `req.user.mosque_id` matches the requested resource.
5. **M365 client secret redaction** -- mosque routes delete `m365_client_secret` from responses before sending to clients (mosqueRoutes.js lines 17, 34, 86, 118, 144).
6. **Production error filtering** in `globalErrorHandler` -- hides stack traces in production for 500 errors.
7. **Rollback logic** in registration -- attempts to clean up partial state on failure.
8. **Supabase Auth delegation** -- password hashing and session management are handled by Supabase Auth, which uses bcrypt and proper session management.
9. **CORS origin validation** -- uses a whitelist with explicit allowed origins (though the Vercel pattern needs tightening).
10. **Webhook body parsing** -- Stripe webhook route uses `express.raw()` before `express.json()`, ensuring signature verification works correctly.

---

## Remediation Priority

| Priority | Issues | Estimated Effort |
|----------|--------|------------------|
| **Immediate** (do today) | C1, C2 (rotate all secrets) | 1-2 hours |
| **Urgent** (this week) | C3, C4, H1, H2, H4 | 4-8 hours |
| **Soon** (within 2 weeks) | H3, H5, H6, H7, H8 | 4-6 hours |
| **Planned** (within 1 month) | M1-M9 | 8-12 hours |
| **Backlog** | L1-L7 | 4-6 hours |

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| CRITICAL | 4 |
| HIGH | 8 |
| MEDIUM | 9 |
| LOW | 7 |
| **Total** | **28** |

---

*End of Security Audit Report*
