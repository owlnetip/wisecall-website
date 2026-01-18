#!/bin/bash

echo "🦉 WiseCall Website - Vercel Deployment Script"
echo "=============================================="
echo ""

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null
then
    echo "⚠️  Vercel CLI not found. Installing..."
    npm install -g vercel
    echo "✅ Vercel CLI installed!"
    echo ""
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed!"
    echo ""
fi

# Build the project
echo "🔨 Building project..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo ""
else
    echo "❌ Build failed. Please fix errors and try again."
    exit 1
fi

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
echo ""
echo "Options:"
echo "1. Deploy to preview (for testing)"
echo "2. Deploy to production"
echo ""
read -p "Choose option (1 or 2): " option

case $option in
    1)
        echo "Deploying to preview..."
        vercel
        ;;
    2)
        echo "Deploying to production..."
        vercel --prod
        ;;
    *)
        echo "Invalid option. Deploying to preview by default..."
        vercel
        ;;
esac

echo ""
echo "✅ Deployment complete!"
echo "🌐 Check your Vercel dashboard for the live URL"
