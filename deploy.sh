#!/bin/bash

# Deployment script for inspir

echo "🚀 Starting inspir deployment..."

# Navigate to project directory
cd /root/inspir || exit 1

# Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd /root/inspir/backend
npm install --production

# Build the frontend
echo "📦 Building frontend..."
cd /root/inspir/frontend
npm install
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed!"
    exit 1
fi

# Copy build to web directory
echo "📂 Copying build to web directory..."
rm -rf /var/www/quiz.inspir.uk/*
cp -r dist/* /var/www/quiz.inspir.uk/
chmod -R a+rX /var/www/quiz.inspir.uk/

# Reload nginx
echo "🔄 Reloading nginx..."
systemctl reload nginx

# Restart backend with PM2
echo "🔄 Restarting backend..."
cd /root/inspir/backend
pm2 restart quiz-backend || pm2 start server.js --name quiz-backend
pm2 save

echo "✅ Deployment complete!"
echo "🌐 Live at: https://quiz.inspir.uk"
