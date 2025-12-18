# 🚀 Chat Feature Deployment Guide

## Quick Deploy Checklist

### ✅ Pre-Deployment (CRITICAL)

**1. Run Database Migration**
```bash
# In Supabase SQL Editor, execute:
# File: /root/quiz-app/backend/database-chat-system.sql

# This creates:
# - chat_conversations table
# - chat_messages table
# - chat_folders table
# - Search indexes
# - RLS policies
```

**2. Install Frontend Dependencies**
```bash
cd /root/quiz-app/frontend
npm install
# Installs: react-markdown, framer-motion, @heroicons/react
```

**3. Backend is Ready**
```bash
# Chat routes already added to server.js
# No new backend dependencies needed
```

---

## 🔧 Deployment Steps

### 1. Database Setup

**Option A: Supabase Dashboard**
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click "SQL Editor"
4. Copy contents of `/root/quiz-app/backend/database-chat-system.sql`
5. Click "Run"
6. Verify tables created: chat_conversations, chat_messages, chat_folders

**Option B: CLI**
```bash
# If you have psql installed
psql $SUPABASE_DATABASE_URL -f /root/quiz-app/backend/database-chat-system.sql
```

### 2. Restart Backend

```bash
cd /root/quiz-app/backend
systemctl restart inspirquiz

# Verify it's running
systemctl status inspirquiz

# Check logs
journalctl -u inspirquiz -n 50
```

### 3. Build & Deploy Frontend

```bash
cd /root/quiz-app/frontend
npm run build

# Copy to nginx directory
sudo cp -r dist/* /var/www/quiz.inspir.uk/

# Restart nginx
sudo systemctl restart nginx
```

### 4. Verify Deployment

**Test Backend:**
```bash
# Health check
curl https://quiz.inspir.uk/api/health

# Should return: {"status":"ok","message":"Quiz app backend is running"}
```

**Test Chat (requires auth):**
```bash
# Login first to get token
TOKEN="your-jwt-token"

# Create conversation
curl -X POST https://quiz.inspir.uk/api/chat/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Chat"}'

# Should return conversation object
```

**Test Frontend:**
1. Go to https://quiz.inspir.uk
2. Sign in
3. Click "✨ AI Chat" in navigation
4. Should see chat interface

---

## 🎯 Post-Deployment Checks

### Functionality Tests

**1. Authentication**
- [ ] Can access /chat page only when logged in
- [ ] Redirects to /auth if not authenticated
- [ ] Token validation works

**2. Conversation Management**
- [ ] Can create new conversation
- [ ] Conversations load in sidebar
- [ ] Can select and view conversation
- [ ] Can delete conversation
- [ ] Can pin/unpin conversation

**3. Messaging**
- [ ] Can send message
- [ ] Streaming works (text appears word-by-word)
- [ ] Messages save to database
- [ ] Auto-scroll works
- [ ] Markdown renders correctly

**4. Content Safety**
- [ ] Blocked content is rejected
- [ ] Friendly error message shown
- [ ] Jailbreak attempts blocked
- [ ] Educational focus maintained

**5. Search**
- [ ] Can search through conversations
- [ ] Results are relevant
- [ ] Search across all user's messages

**6. UI/UX**
- [ ] Beautiful gradient colors display
- [ ] Animations smooth
- [ ] Mobile responsive
- [ ] No console errors

---

## 🐛 Common Issues & Fixes

### Issue: Database migration fails

**Error:** "relation already exists"
```sql
-- Drop existing tables first
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_conversations CASCADE;
DROP TABLE IF EXISTS chat_folders CASCADE;

-- Then re-run migration
```

### Issue: 404 on /api/chat endpoints

**Fix:** Check server.js has chat routes
```javascript
import chatRoutes from './routes/chat.js';
app.use('/api/chat', chatRoutes);
```

Restart server:
```bash
systemctl restart inspirquiz
```

### Issue: CORS error in browser

**Fix:** Add to CORS allowed origins in server.js
```javascript
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean);
```

### Issue: Streaming doesn't work

**Check:**
1. Browser supports Server-Sent Events (SSE)
2. No proxy blocking event-stream
3. CORS allows streaming

**Test:**
```bash
curl -N https://quiz.inspir.uk/api/chat/conversations/ID/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello"}'
```

Should see: `data: {"type":"content","text":"..."}`

### Issue: Rate limiting too restrictive

**Adjust in:** `/backend/middleware/rateLimiter.js`
```javascript
export const quizGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50, // Increase from 20 to 50
  // ...
});
```

### Issue: Content moderation too strict

**Adjust in:** `/backend/utils/contentModeration.js`

Comment out patterns that are too aggressive:
```javascript
const BLOCKED_PATTERNS = [
  // /\b(kill|murder)\b/gi, // Comment this out if blocking legitimate questions
  // ...
];
```

---

## 📊 Monitoring

### Health Checks

**Backend:**
```bash
# Check process
systemctl status inspirquiz

# View logs
journalctl -u inspirquiz -f

# Check errors
journalctl -u inspirquiz -p err -n 100
```

**Database:**
```sql
-- Count conversations
SELECT COUNT(*) FROM chat_conversations;

-- Count messages today
SELECT COUNT(*) FROM chat_messages
WHERE created_at >= CURRENT_DATE;

-- Check for errors
SELECT * FROM chat_messages
WHERE was_flagged = true
ORDER BY created_at DESC
LIMIT 20;
```

**API Usage:**
Check Anthropic dashboard:
- https://console.anthropic.com/usage

Monitor:
- Tokens used per day
- API errors
- Rate limits

### Key Metrics

**Track:**
- Conversations created per day
- Messages sent per day
- Average messages per conversation
- Flagged content percentage
- Search usage
- Error rate

**SQL Queries:**
```sql
-- Daily activity
SELECT
  DATE(created_at) as date,
  COUNT(*) as conversations
FROM chat_conversations
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- User engagement
SELECT
  user_id,
  COUNT(DISTINCT conversation_id) as conversations,
  COUNT(*) as total_messages
FROM chat_messages cm
JOIN chat_conversations cc ON cm.conversation_id = cc.id
GROUP BY user_id
ORDER BY total_messages DESC
LIMIT 10;
```

---

## 🔐 Security Checklist

Before going live:

- [ ] Database RLS policies active
- [ ] Rate limiting configured
- [ ] Content moderation tested
- [ ] JWT authentication working
- [ ] CORS properly configured
- [ ] HTTPS enabled
- [ ] Error messages don't leak sensitive info
- [ ] Audit logging working
- [ ] API keys not exposed in frontend

---

## 📱 Mobile Testing

Test on:
- [ ] iPhone Safari
- [ ] Android Chrome
- [ ] iPad
- [ ] Various screen sizes (320px - 1920px)

Check:
- [ ] Sidebar collapsible on mobile
- [ ] Input doesn't get covered by keyboard
- [ ] Messages readable on small screens
- [ ] Touch targets large enough (44px minimum)
- [ ] Scrolling smooth

---

## 🎓 User Training

Share with students:
1. **Getting Started Guide** - How to use chat
2. **Safety Guidelines** - What's allowed/blocked
3. **Tips & Tricks** - How to ask good questions
4. **Example Prompts** - Educational examples

Create help page:
```markdown
# How to Use Study Buddy AI

## Asking Good Questions
- Be specific: "Explain photosynthesis" vs "Biology help"
- Break complex topics into smaller questions
- Ask for examples to understand better

## What AI Can Help With
✅ Explaining concepts
✅ Breaking down problems
✅ Providing examples
✅ Study strategies

## What AI Won't Do
❌ Do your homework for you
❌ Provide answers without explanations
❌ Discuss inappropriate topics
❌ Share personal information
```

---

## 💰 Cost Estimation

**Anthropic API Costs:**
- Model: Claude Sonnet 4.5
- Input: $3 per million tokens
- Output: $15 per million tokens

**Estimates (per user/month):**
- Light usage (50 messages): ~$0.50
- Medium usage (200 messages): ~$2.00
- Heavy usage (500 messages): ~$5.00

**100 users × $2 avg = $200/month API costs**

**Optimizations:**
- Use Claude Haiku for simple questions ($0.25/$1.25 per million)
- Implement caching for common questions
- Set daily usage limits per user

---

## 🔄 Rollback Plan

If issues occur:

**1. Quick Disable (Frontend)**
```javascript
// In Navigation.jsx, comment out:
{user && (
  <Link to="/chat" ...>AI Chat</Link>
)}
```

**2. Disable Routes (Backend)**
```javascript
// In server.js, comment out:
// app.use('/api/chat', chatRoutes);
```

**3. Full Rollback**
```bash
# Restore previous frontend build
cd /var/www/quiz.inspir.uk
sudo cp -r backup/* .

# Restart backend to previous version
cd /root/quiz-app/backend
git checkout previous-commit
systemctl restart inspirquiz
```

---

## ✅ Launch Checklist

**Pre-Launch:**
- [ ] All tests passing
- [ ] Database migration complete
- [ ] Rate limiting configured
- [ ] Content moderation tested
- [ ] Error handling verified
- [ ] Mobile responsive
- [ ] Documentation complete

**Launch Day:**
- [ ] Deploy to production
- [ ] Smoke test all features
- [ ] Monitor error logs
- [ ] Watch API usage
- [ ] User feedback ready

**Post-Launch (Week 1):**
- [ ] Daily log monitoring
- [ ] User feedback collected
- [ ] Bug fixes prioritized
- [ ] Performance optimization
- [ ] Cost analysis

---

## 📞 Support Contacts

**Technical Issues:**
- Check logs: `journalctl -u inspirquiz`
- Database: Supabase dashboard
- API: Anthropic console

**Documentation:**
- Feature guide: `/root/quiz-app/CHAT-FEATURE.md`
- Deployment: `/root/quiz-app/DEPLOY-CHAT.md`
- Security: `/root/quiz-app/SECURITY-FIXES.md`

---

**Ready to deploy! 🚀**

*Last Updated: 2025-12-08*
