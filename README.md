# 🦉 WiseCall Website

AI-powered answering service for UK businesses. Professional, intelligent, and available 24/7.

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev
# Open http://localhost:5173
```

### Deploy to Vercel (Easiest Method)

**Option 1: One-Click Script**
```bash
./deploy.sh
```

**Option 2: Manual Vercel CLI**
```bash
# Install Vercel CLI (if not installed)
npm install -g vercel

# Login
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

**Option 3: Connect GitHub to Vercel**
1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your repository
4. Vercel auto-detects settings and deploys
5. Every push to `main` = automatic deployment!

## 📁 Project Structure

```
wisecall-website/
├── index.html          # Main HTML (entry point)
├── src/                # React source files
├── public/             # Static assets
├── vercel.json         # Vercel configuration
├── deploy.sh           # Deployment script
└── DEPLOYMENT.md       # Detailed deployment guide
```

## 🎨 Features

- Responsive design
- Interactive voice agent demo
- Smooth animations
- Dark theme
- Mobile-optimized
- SEO-ready

## 🛠️ Tech Stack

- **Framework:** Vite + React 19
- **Styling:** Pure CSS
- **Fonts:** Google Fonts (Syne, DM Sans)
- **Hosting:** Vercel (free tier)
- **Voice Demo:** Embedded iframe

## 📝 Customization

### Update Content
Edit `index.html` for:
- Hero text
- Features
- Pricing plans
- Contact info

### Update Styles
Modify CSS variables in `<style>` section:
```css
:root {
    --primary: #7DE8EB;
    --dark-bg: #172929;
    /* ... more variables */
}
```

## 🌐 Custom Domain

After deploying to Vercel:
1. Go to Project Settings → Domains
2. Add your domain (e.g., `wisecall.io`)
3. Update DNS records as instructed
4. SSL certificate is automatic!

## 💰 Cost

**$0/month** on Vercel's free Hobby tier:
- Unlimited deployments
- 100GB bandwidth
- Global CDN
- Automatic HTTPS
- Custom domain support

Perfect for this microsite!

## 📚 Documentation

- [Detailed Deployment Guide](./DEPLOYMENT.md)
- [Vercel Documentation](https://vercel.com/docs)
- [Vite Documentation](https://vitejs.dev/)

## 🤝 Support

For questions or issues, contact: hello@wisecall.io

---

Built with ❤️ for UK businesses
