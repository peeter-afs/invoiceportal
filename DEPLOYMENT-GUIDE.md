# Invoice Portal - Deployment Guide

## Repository Links

- **Backend**: https://github.com/peeter-afs/invoiceportal-backend
- **Frontend**: https://github.com/peeter-afs/invoiceportal-frontend

---

## Quick Deployment Steps

### Step 1: Deploy Backend First

#### Option A: Heroku
```bash
cd /workspace/InvoicePortal-Backend

# Login to Heroku
heroku login

# Create app
heroku create your-app-name-backend

# Set environment variables
heroku config:set DATABASE_URL="mysql://user:password@host:3306/invoiceportal"
heroku config:set JWT_SECRET=$(openssl rand -base64 32)
heroku config:set NODE_ENV=production

# Deploy
git push heroku main

# Get your backend URL
heroku open
# Example: https://your-app-name-backend.herokuapp.com
```

#### Option B: Railway (Recommended for ease)
1. Go to https://railway.app
2. Sign in with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select `invoiceportal-backend`
5. Add a MariaDB/MySQL database (or use an external MariaDB)
6. Set environment variables:
   - `DATABASE_URL`: Your MariaDB connection string (mysql://...)
   - `JWT_SECRET`: Generate a random string
   - `NODE_ENV`: production
   - `FRONTEND_URL`: (leave empty for now, will update after frontend deploy)
   - `DEFAULT_TENANT_KEY`: (optional; defaults to `default`)
7. Railway will auto-deploy and give you a URL like: `https://invoiceportal-backend.up.railway.app`

#### Option C: Render
1. Go to https://render.com
2. Click "New" → "Web Service"
3. Connect GitHub and select `invoiceportal-backend`
4. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Add environment variables:
   - `DATABASE_URL`: Your MariaDB connection string (mysql://...)
   - `JWT_SECRET`: Generate a random string
   - `NODE_ENV`: production
   - `FRONTEND_URL`: (will update after frontend deploy)
6. Click "Create Web Service"
7. You'll get a URL like: `https://invoiceportal-backend.onrender.com`

---

### Step 2: Deploy Frontend

#### Option A: CodeSandbox.io
1. Go to https://codesandbox.io
2. Sign in with GitHub
3. Click "Import from GitHub"
4. Paste: `https://github.com/peeter-afs/invoiceportal-frontend`
5. CodeSandbox will import and build automatically
6. Click the settings icon (gear) → "Environment Variables"
7. Add:
   - **Key**: `REACT_APP_API_URL`
   - **Value**: `https://your-backend-url.com/api` (from Step 1)
8. Restart the dev server
9. You'll get a URL like: `https://xyz123.csb.app`

#### Option B: Vercel (Recommended)
```bash
cd /workspace/InvoicePortal-Frontend

# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel

# Set environment variable (in Vercel dashboard or CLI)
vercel env add REACT_APP_API_URL

# Enter your backend URL when prompted:
# https://your-backend-url.com/api

# Deploy to production
vercel --prod
```

#### Option C: Netlify
```bash
cd /workspace/InvoicePortal-Frontend

# Install Netlify CLI
npm i -g netlify-cli

# Login
netlify login

# Build
npm run build

# Deploy
netlify deploy --prod --dir=build

# Set environment variable in Netlify dashboard:
# REACT_APP_API_URL = https://your-backend-url.com/api
```

---

### Step 3: Update Backend CORS

After deploying frontend, update backend environment variable:

**Railway/Render/Heroku Dashboard:**
- Add/Update: `FRONTEND_URL` = `https://your-frontend-url.com`

**Or via CLI (Heroku):**
```bash
heroku config:set FRONTEND_URL=https://your-frontend-url.com
```

---

## Testing Deployment

### 1. Test Backend
```bash
curl https://your-backend-url.com/
curl https://your-backend-url.com/api/health
```

Should return JSON responses.

### 2. Test Frontend
1. Open `https://your-frontend-url.com`
2. Click "Register" and create a test account
3. Login with the test account
4. Create a test invoice
5. Check dashboard shows the invoice

### 3. Test Full Integration
- Register → Login → Create Invoice → View in List
- Check browser console for any CORS or API errors

---

## Environment Variables Summary

### Backend
| Variable | Required | Example | Where to Set |
|----------|----------|---------|--------------|
| PORT | No | 5000 | Auto-set by host |
| DATABASE_URL | Yes | mysql://user:pass@host:3306/db | Railway/Render/Heroku |
| JWT_SECRET | Yes | random-string-32-chars | Railway/Render/Heroku |
| NODE_ENV | Yes | production | Railway/Render/Heroku |
| FRONTEND_URL | Yes | https://your-frontend.com | Railway/Render/Heroku |
| DEFAULT_TENANT_KEY | No | default | Railway/Render/Heroku |

### Frontend
| Variable | Required | Example | Where to Set |
|----------|----------|---------|--------------|
| REACT_APP_API_URL | Yes | https://backend.com/api | Vercel/Netlify/CodeSandbox |

---

## Recommended Deployment Combo

**For Beginners:**
- Backend: Railway/Render (MariaDB/MySQL supported)
- Frontend: Vercel (free tier, perfect for React)

**For CodeSandbox:**
- Backend: Railway or Render
- Frontend: CodeSandbox.io (import from GitHub)

---

## Troubleshooting

### CORS Errors
- Ensure `FRONTEND_URL` in backend matches your deployed frontend URL exactly
- Include protocol (https://) and no trailing slash

### API Connection Failed
- Check `REACT_APP_API_URL` includes `/api` at the end
- Verify backend is running: `curl https://backend-url/api/health`

### 401 Unauthorized
- Check JWT_SECRET is set in backend
- Clear browser localStorage and re-login

### MariaDB Connection Error
- Verify `DATABASE_URL` is correct
- Ensure the database user has permissions for the target database
- Ensure the host allows inbound connections from your backend

---

## MariaDB Setup (if needed)

Provision a MariaDB database (local, managed service, or your cloud provider) and set `DATABASE_URL` in the backend to a `mysql://...` connection string.

---

## Local Testing with Deployed Backend

If you want to test frontend locally with deployed backend:

```bash
cd /workspace/InvoicePortal-Frontend

# Create .env file
echo "REACT_APP_API_URL=https://your-deployed-backend.com/api" > .env

# Start local frontend
npm start
```

Make sure backend `FRONTEND_URL` includes `http://localhost:3000` for development.

---

## Production Checklist

- [ ] Backend deployed and accessible
- [ ] MariaDB database connected
- [ ] JWT_SECRET set to strong random value
- [ ] Frontend deployed and accessible
- [ ] REACT_APP_API_URL points to backend
- [ ] FRONTEND_URL in backend points to frontend
- [ ] CORS working (no browser errors)
- [ ] Can register new user
- [ ] Can login
- [ ] Can create invoice
- [ ] Can view invoices in dashboard

---

## Next Steps

1. Deploy backend to Railway/Render/Heroku
2. Note the backend URL
3. Deploy frontend to Vercel/Netlify/CodeSandbox
4. Set REACT_APP_API_URL in frontend with backend URL
5. Update FRONTEND_URL in backend with frontend URL
6. Test complete flow
7. Monitor logs for any errors

Good luck with your deployment!
