# inspir Deployment Guide

This guide covers deploying the inspir platform to a production Ubuntu server with nginx, SSL, and PM2 process management.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Server Setup](#server-setup)
3. [Backend Deployment](#backend-deployment)
4. [Frontend Deployment](#frontend-deployment)
5. [nginx Configuration](#nginx-configuration)
6. [SSL/TLS with Certbot](#ssltls-with-certbot)
7. [Process Management with PM2](#process-management-with-pm2)
8. [Deployment Script](#deployment-script)
9. [Post-Deployment](#post-deployment)
10. [Troubleshooting](#troubleshooting)
11. [Updating the Application](#updating-the-application)

---

## Prerequisites

### Server Requirements

- Ubuntu 20.04 LTS or newer
- Minimum 1GB RAM (2GB recommended)
- 20GB disk space
- Root or sudo access
- Domain name pointing to your server (e.g., quiz.inspir.uk)

### Required Software

- Node.js 18+ and npm
- nginx
- PM2 (for process management) or systemd
- Certbot (for SSL certificates)
- Git

---

## Server Setup

### 1. Update System Packages

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Node.js

```bash
# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

### 3. Install nginx

```bash
sudo apt install -y nginx

# Start and enable nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Verify nginx is running
sudo systemctl status nginx
```

### 4. Install PM2 (Process Manager)

```bash
sudo npm install -g pm2

# Verify installation
pm2 --version
```

### 5. Install Certbot (for SSL)

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 6. Install Git

```bash
sudo apt install -y git
```

---

## Backend Deployment

### 1. Clone the Repository

```bash
cd /root
git clone https://github.com/makriman/inspir.git
cd inspir
```

### 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install --production

# Create production environment file
cp .env.example .env
nano .env
```

Edit the `.env` file with your production credentials:

```env
PORT=3000
HOST=0.0.0.0
FRONTEND_URL=https://quiz.inspir.uk
ANTHROPIC_API_KEY=your_actual_anthropic_key
SUPABASE_URL=your_actual_supabase_url
SUPABASE_ANON_KEY=your_actual_supabase_key
JWT_SECRET=your_strong_production_jwt_secret
```

**Important Security Notes:**
- Never commit the production `.env` file to Git
- Use a strong, randomly generated JWT_SECRET
- Keep API keys secure and rotate them periodically

### 3. Test the Backend

```bash
# Test that the backend starts without errors
node server.js

# You should see: "Server running on port 3000"
# Press Ctrl+C to stop
```

---

## Frontend Deployment

### 1. Frontend Setup

```bash
cd /root/inspir/frontend

# Install dependencies
npm install

# Create production environment file
cp .env.example .env
nano .env
```

Edit the frontend `.env` file:

```env
VITE_SUPABASE_URL=your_actual_supabase_url
VITE_SUPABASE_ANON_KEY=your_actual_supabase_key
VITE_API_URL=https://quiz.inspir.uk/api
```

### 2. Build the Frontend

```bash
npm run build
```

This creates an optimized production build in the `dist/` directory.

### 3. Deploy to Web Directory

```bash
# Create web directory
sudo mkdir -p /var/www/quiz.inspir.uk

# Copy build files
sudo cp -r dist/* /var/www/quiz.inspir.uk/

# Set proper permissions
sudo chown -R www-data:www-data /var/www/quiz.inspir.uk
sudo chmod -R 755 /var/www/quiz.inspir.uk
```

---

## nginx Configuration

### 1. Copy nginx Configuration

```bash
sudo cp /root/inspir/deploy/nginx/quiz.inspir.uk.conf /etc/nginx/sites-available/
```

### 2. Review Configuration

The configuration file (`deploy/nginx/quiz.inspir.uk.conf`) includes:

- Static file serving for the React frontend
- Reverse proxy for API requests to `http://127.0.0.1:3000`
- SPA routing (all routes serve index.html)
- Gzip compression
- Proper headers for proxying

### 3. Enable the Site

```bash
# Create symbolic link to enable the site
sudo ln -s /etc/nginx/sites-available/quiz.inspir.uk.conf /etc/nginx/sites-enabled/

# Remove default site if it exists
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

---

## SSL/TLS with Certbot

### 1. Ensure DNS is Configured

Make sure your domain (quiz.inspir.uk) points to your server's IP address.

```bash
# Verify DNS resolution
nslookup quiz.inspir.uk
```

### 2. Obtain SSL Certificate

```bash
sudo certbot --nginx -d quiz.inspir.uk

# Follow the prompts:
# - Enter email address
# - Agree to terms of service
# - Choose whether to redirect HTTP to HTTPS (recommended: yes)
```

Certbot will:
- Obtain a certificate from Let's Encrypt
- Automatically modify your nginx configuration
- Set up automatic renewal

### 3. Verify SSL Certificate

```bash
# Check certificate status
sudo certbot certificates

# Test renewal process
sudo certbot renew --dry-run
```

Certificates auto-renew via systemd timer. Check renewal timer:

```bash
sudo systemctl list-timers | grep certbot
```

---

## Process Management with PM2

### Option 1: Using PM2 (Recommended)

#### 1. Start the Backend with PM2

```bash
cd /root/inspir/backend

pm2 start server.js --name quiz-backend
```

#### 2. Configure PM2 Startup

```bash
# Generate startup script
pm2 startup systemd

# This will output a command like:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root
# Run the command it provides

# Save the PM2 process list
pm2 save
```

#### 3. Useful PM2 Commands

```bash
# View all processes
pm2 list

# View logs
pm2 logs quiz-backend

# Restart backend
pm2 restart quiz-backend

# Stop backend
pm2 stop quiz-backend

# Monitor processes
pm2 monit

# View detailed info
pm2 show quiz-backend
```

### Option 2: Using systemd

#### 1. Copy systemd Service File

```bash
sudo cp /root/inspir/deploy/systemd/inspirquiz.service /etc/systemd/system/
```

#### 2. Edit Service File if Needed

```bash
sudo nano /etc/systemd/system/inspirquiz.service

# Update paths if your installation directory differs
# Default is: /root/inspir/backend
```

#### 3. Enable and Start Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable inspirquiz

# Start the service
sudo systemctl start inspirquiz

# Check status
sudo systemctl status inspirquiz
```

#### 4. Useful systemd Commands

```bash
# View logs
sudo journalctl -u inspirquiz -f

# Restart service
sudo systemctl restart inspirquiz

# Stop service
sudo systemctl stop inspirquiz

# Disable service
sudo systemctl disable inspirquiz
```

---

## Deployment Script

A deployment script is provided at `/root/inspir/deploy.sh` for easy updates.

### 1. Make Script Executable

```bash
chmod +x /root/inspir/deploy.sh
```

### 2. Run Deployment Script

```bash
cd /root/inspir
./deploy.sh
```

The script will:
1. Build the frontend
2. Copy files to `/var/www/quiz.inspir.uk/`
3. Reload nginx
4. Optionally restart the backend with PM2

### 3. Customize Deployment Script

Edit `deploy.sh` to match your setup (e.g., if using systemd instead of PM2):

```bash
nano /root/inspir/deploy.sh
```

---

## Post-Deployment

### 1. Verify Everything is Running

```bash
# Check nginx status
sudo systemctl status nginx

# Check backend (PM2)
pm2 status

# Or check backend (systemd)
sudo systemctl status inspirquiz

# Check SSL certificate
curl -I https://quiz.inspir.uk
```

### 2. Test All Features

Visit your site and test:
- [ ] Homepage loads
- [ ] User registration and login
- [ ] Quiz generation
- [ ] AI Chat
- [ ] Study Timer
- [ ] Grade Calculator
- [ ] Student Forum
- [ ] API endpoints responding correctly

### 3. Set Up Monitoring

```bash
# View PM2 monitoring dashboard
pm2 monit

# Or use systemd for logs
sudo journalctl -u inspirquiz -f
```

### 4. Configure Firewall (Optional but Recommended)

```bash
# Allow SSH, HTTP, and HTTPS
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable

# Check status
sudo ufw status
```

---

## Troubleshooting

### Backend Won't Start

**Check logs:**
```bash
# PM2
pm2 logs quiz-backend

# systemd
sudo journalctl -u inspirquiz -e
```

**Common issues:**
- Missing environment variables in `.env`
- Port 3000 already in use: `sudo lsof -i :3000`
- Missing dependencies: `npm install`
- Database connection issues: verify Supabase credentials

### Frontend Shows Blank Page

**Check:**
- nginx is serving files: `ls -la /var/www/quiz.inspir.uk/`
- nginx configuration: `sudo nginx -t`
- Browser console for errors (F12)
- Build completed successfully: check `frontend/dist/` directory

### API Requests Failing

**Check:**
- Backend is running: `pm2 status` or `systemctl status inspirquiz`
- nginx proxy configuration in `/etc/nginx/sites-available/quiz.inspir.uk.conf`
- CORS settings: verify `FRONTEND_URL` in backend `.env`
- Network requests in browser dev tools (F12 > Network tab)

### SSL Certificate Issues

**Check:**
- DNS is pointing to correct IP: `nslookup quiz.inspir.uk`
- Certbot logs: `sudo certbot certificates`
- nginx SSL configuration: `sudo nginx -t`
- Firewall allows port 443: `sudo ufw status`

### High CPU/Memory Usage

**Check:**
- PM2 monitoring: `pm2 monit`
- System resources: `htop` or `top`
- Backend logs for errors: `pm2 logs quiz-backend`
- Consider upgrading server resources

---

## Updating the Application

### 1. Pull Latest Changes

```bash
cd /root/inspir
git pull origin main
```

### 2. Update Backend

```bash
cd backend

# Install any new dependencies
npm install

# Restart backend
pm2 restart quiz-backend

# Or with systemd
sudo systemctl restart inspirquiz
```

### 3. Update Frontend

```bash
cd frontend

# Install any new dependencies
npm install

# Rebuild
npm run build

# Deploy
sudo rm -rf /var/www/quiz.inspir.uk/*
sudo cp -r dist/* /var/www/quiz.inspir.uk/

# Reload nginx
sudo systemctl reload nginx
```

### 4. Quick Update Using Deployment Script

```bash
cd /root/inspir
git pull origin main
./deploy.sh
```

---

## Environment Variables Reference

### Backend (.env)

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Backend server port | `3000` |
| `HOST` | Backend host address | `0.0.0.0` |
| `FRONTEND_URL` | Frontend URL for CORS | `https://quiz.inspir.uk` |
| `ANTHROPIC_API_KEY` | Claude API key | `sk-ant-api03-...` |
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anon key | `eyJhbGc...` |
| `JWT_SECRET` | JWT signing secret | `random-secure-string` |

### Frontend (.env)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | `eyJhbGc...` |
| `VITE_API_URL` | Backend API URL | `https://quiz.inspir.uk/api` |

---

## Performance Optimization

### 1. Enable Gzip Compression

Already configured in nginx config. Verify:

```bash
curl -H "Accept-Encoding: gzip" -I https://quiz.inspir.uk
```

### 2. Set Up Caching Headers

Add to nginx config:

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 3. Enable HTTP/2

Certbot automatically enables HTTP/2 when setting up SSL.

### 4. Optimize PM2

```bash
# Use cluster mode for better performance
pm2 start server.js --name quiz-backend -i max
```

---

## Security Best Practices

1. **Keep secrets secure:**
   - Never commit `.env` files
   - Use strong passwords and secrets
   - Rotate API keys periodically

2. **Regular updates:**
   - Keep system packages updated: `sudo apt update && sudo apt upgrade`
   - Update Node.js dependencies: `npm audit fix`

3. **Firewall:**
   - Only allow necessary ports (22, 80, 443)
   - Consider using fail2ban for SSH protection

4. **Backups:**
   - Regularly backup your database (Supabase handles this)
   - Backup environment files (store securely offline)
   - Version control with Git

5. **Monitoring:**
   - Set up uptime monitoring (UptimeRobot, Pingdom, etc.)
   - Monitor error logs regularly
   - Set up alerts for critical issues

---

## Support

For deployment issues:
1. Check logs first (PM2 or systemd)
2. Review this guide
3. Create an issue on GitHub
4. Contact the development team

---

**inspir Deployment Guide** - Last Updated: December 2024
