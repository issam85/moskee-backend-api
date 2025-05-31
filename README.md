# 🕌 Moskee Backend API

Backend API voor het Leerling Volgsysteem van Al-Hijra Moskee.

## 🚀 Quick Start

### Railway Deployment

1. **Clone/Update Repository**
   ```bash
   # Vervang jouw server.js en package.json met de nieuwe versies
   # Commit en push naar GitHub
   ```

2. **Environment Variables in Railway**
   - Ga naar Railway Dashboard → Your Project → Variables
   - Voeg alle variables toe uit `.env.example`
   
3. **Deploy**
   - Railway detecteert automatisch changes
   - Deploy duurt ~2-3 minuten

## 📋 Required Environment Variables

```bash
PORT=3001
NODE_ENV=production
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
M365_TENANT_ID=your-tenant-id
M365_CLIENT_ID=your-client-id  
M365_CLIENT_SECRET=your-client-secret
M365_SENDER_EMAIL=onderwijs@al-hijra.nl
JWT_SECRET=your-jwt-secret
```

## 🔗 API Endpoints

### Health Check
```
GET /api/health
Response: {"status": "Server is running", "timestamp": "..."}
```

### Configuration Check
```
GET /api/config-check
Response: {"hasSupabaseUrl": true, "hasM365TenantId": true, ...}
```

### Send Email (Microsoft 365)
```
POST /api/send-email-m365
Body: {
  "tenantId": "...",
  "clientId": "...", 
  "clientSecret": "...",
  "to": "recipient@example.com",
  "subject": "Email subject",
  "body": "Email content",
  "mosqueName": "Al-Hijra Moskee"
}
```

### Mosque Data (Mock)
```
GET /api/mosque/al-hijra
Response: {"id": 1, "name": "Al-Hijra Moskee", ...}
```

## 🧪 Testing

### Test Health
```bash
curl https://your-railway-url.railway.app/api/health
```

### Test Configuration  
```bash
curl https://your-railway-url.railway.app/api/config-check
```

## 🔧 Troubleshooting

### Common Issues

1. **Deployment Failed**
   - Check Railway logs
   - Verify package.json syntax
   - Ensure start script is correct

2. **Environment Variables Missing**
   - All variables must be set in Railway
   - Check /api/config-check endpoint

3. **Email Not Working**
   - Verify M365 credentials
   - Check Azure app permissions
   - Ensure admin consent granted

4. **CORS Errors**
   - Frontend domain must be in CORS whitelist
   - Update cors() configuration if needed

## 📞 Support

- **Railway Logs**: Dashboard → Your Project → Logs
- **Email Issues**: Check Azure Portal → App registrations
- **Database**: Supabase Dashboard → Logs

## 🔄 Updates

To update the backend:
1. Modify code locally
2. Commit & push to GitHub
3. Railway auto-deploys
4. Check logs for success/errors