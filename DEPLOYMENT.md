# WiseCall Website - Vercel Deployment Guide

## Prerequisites
- Vercel account (free)
- Git repository (GitHub, GitLab, or Bitbucket)
- Node.js installed locally

## Quick Deploy (Recommended)

### Method 1: Deploy via Vercel Dashboard

1. **Push to GitHub**
   ```bash
   cd /Users/luketurner/Desktop/Screenshots/wisecall-website
   git init
   git add .
   git commit -m "Initial WiseCall website"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Connect to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import your GitHub repository
   - Vercel will auto-detect it's a Vite project
   - Click "Deploy"
   
   That's it! Vercel will:
   - Run `npm install`
   - Run `npm run build`
   - Deploy from the `dist` folder
   - Give you a URL like `wisecall-website.vercel.app`

### Method 2: Deploy via Vercel CLI

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   cd /Users/luketurner/Desktop/Screenshots/wisecall-website
   vercel
   ```
   
   Follow the prompts:
   - Set up and deploy? **Y**
   - Which scope? Select your account
   - Link to existing project? **N**
   - Project name? **wisecall-website**
   - Directory? **./  (press Enter)**
   - Override settings? **N**

4. **Production Deploy**
   ```bash
   vercel --prod
   ```

## Custom Domain Setup

Once deployed:

1. Go to your Vercel project dashboard
2. Click "Settings" → "Domains"
3. Add your domain (e.g., `wisecall.io` or `wisecall.owlnet.io`)
4. Follow DNS instructions:
   - **If using subdomain:** Add CNAME record pointing to `cname.vercel-dns.com`
   - **If using root domain:** Add A record to Vercel's IP + CNAME for www

## Automatic Deployments

Once connected to GitHub:
- **Every push to `main`** = Automatic production deployment
- **Every push to other branches** = Preview deployment
- No manual steps needed!

## Environment Variables

If you need environment variables later:
1. Go to Project Settings → Environment Variables
2. Add variables (e.g., API keys)
3. Redeploy for changes to take effect

## Local Development

```bash
# Install dependencies
npm install

# Run dev server (http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

## Useful Commands

```bash
# Check deployment status
vercel ls

# View logs
vercel logs YOUR_DEPLOYMENT_URL

# Remove project
vercel remove wisecall-website
```

## Cost
- **Free Hobby Tier** includes:
  - Unlimited deployments
  - Automatic HTTPS
  - Global CDN
  - 100GB bandwidth/month
  - Perfect for this microsite!

## Support
- [Vercel Documentation](https://vercel.com/docs)
- [Vite Documentation](https://vitejs.dev/)
