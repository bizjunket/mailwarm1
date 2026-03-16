# MailWarm — Hostinger Deployment Guide

## Folder structure
```
mailwarm-deploy/
├── server.js          ← Node.js backend (entry point)
├── package.json       ← Dependencies + start script
├── .gitignore
└── public/
    └── index.html     ← Frontend app (served by server.js)
```

---

## Deploy to Hostinger (Node.js Web App)

### Step 1 — Push to GitHub

1. Create a new repository on **github.com** (e.g. `mailwarm`)
2. Upload all these files (drag & drop on GitHub, or use Git):

```bash
git init
git add .
git commit -m "MailWarm v1.0"
git remote add origin https://github.com/YOURUSERNAME/mailwarm.git
git push -u origin main
```

---

### Step 2 — Create Node.js app on Hostinger

1. Log into **hPanel** (hpanel.hostinger.com)
2. Go to **Hosting → Manage**
3. Find **Node.js** in the sidebar (under "Advanced")
4. Click **Create Application**
5. Fill in:
   - **Node.js version**: 18 (or latest LTS)
   - **Application root**: `/` (root of your repo)
   - **Application URL**: your domain or subdomain (e.g. `mail.yourdomain.com`)
   - **Application startup file**: `server.js`
6. Click **Create**

---

### Step 3 — Import from GitHub

1. In the Node.js app settings, find **Git** or **Import Repository**
2. Connect your GitHub account
3. Select your `mailwarm` repository
4. Select branch: `main`
5. Click **Deploy**

Hostinger will:
- Pull your code
- Run `npm install` automatically
- Start your app with `node server.js`

---

### Step 4 — Visit your app

Open your domain in a browser — MailWarm should be live!

```
https://yourdomain.com        ← or whichever URL you set
```

---

## Redeploying after changes

Whenever you push new code to GitHub:
1. Go to hPanel → Node.js → your app
2. Click **Pull** (or **Redeploy**)

Or enable **Auto-deploy** in Hostinger to deploy automatically on every push.

---

## Environment variables (optional)

If you want to set a custom port or other config, go to:
**hPanel → Node.js → your app → Environment Variables**

Hostinger sets `PORT` automatically — you don't need to touch it.

---

## Troubleshooting

**App shows "Application Error"**
→ Check logs in hPanel → Node.js → Logs
→ Make sure `server.js` is set as the startup file

**npm install fails**
→ Check that `package.json` is in the root of the repo (same level as `server.js`)

**SMTP test fails**
→ See the in-app setup tips per provider. Gmail/Yahoo/Outlook need App Passwords.
