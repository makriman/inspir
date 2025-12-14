#!/bin/bash

# Deployment script for InspirQuiz

echo "🚀 Starting InspirQuiz deployment..."

# Navigate to frontend directory
cd /root/quiz-app/frontend || exit 1

# Build the frontend
echo "📦 Building frontend..."
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

# Check backend status
echo "🔍 Checking backend status..."
if command -v pm2 >/dev/null 2>&1; then
    timeout 5s pm2 list | grep quiz-backend || echo "⚠️  Unable to read pm2 status (pm2 not responding or process not found)."
else
    echo "⚠️  pm2 not found; skipping backend status check."
fi

# Restart backend if needed
read -p "Restart backend? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd /root/quiz-app/backend || exit 1
    pm2 restart quiz-backend
    pm2 save
fi

echo "✅ Deployment complete!"
echo "🌐 Live at: https://quiz.inspir.uk"
echo "📊 Grade Calculator at: https://quiz.inspir.uk/grade-calculator"
