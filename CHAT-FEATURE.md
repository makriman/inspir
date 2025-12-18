# 🎓 Study Buddy AI - Student-Friendly Chat System

**Deployed at:** `https://quiz.inspir.uk/chat`

---

## ✨ Features Overview

### Core Functionality
- ✅ **Real-time Streaming Responses** - Instant, word-by-word AI responses
- ✅ **Chat History** - All conversations saved and organized
- ✅ **Full-Text Search** - Search through all your past conversations
- ✅ **Conversation Management** - Pin, rename, delete conversations
- ✅ **Folder Organization** - Organize chats by subject (coming soon)
- ✅ **Kid-Safe Content Moderation** - Built-in safety filters
- ✅ **Authentication** - Integrated with existing user system
- ✅ **Beautiful UI** - Student-friendly, colorful, modern design

### Safety Features 🛡️
- **Content Moderation**: Blocks inappropriate content (violence, explicit content, harmful language)
- **Jailbreak Protection**: Prevents attempts to bypass safety guidelines
- **Flagged Topics**: Monitors sensitive topics (depression, anxiety) and logs them
- **Educational Focus**: Discourages cheating, encourages learning
- **Student-Optimized Prompt**: AI tuned specifically for educational assistance

---

## 🗄️ Database Schema

### Tables Created

**1. `chat_conversations`**
- Stores user conversations
- Fields: id, user_id, title, folder, is_pinned, timestamps

**2. `chat_messages`**
- Stores individual messages
- Fields: id, conversation_id, role, content, tokens_used, was_flagged, moderation_reason
- Full-text search index on content

**3. `chat_folders`** (for future use)
- User-defined folders for organization
- Fields: id, user_id, name, color, icon

### Row-Level Security (RLS)
- ✅ Users can only access their own conversations
- ✅ Users can only see messages in their conversations
- ✅ Full CRUD protection with Supabase policies

---

## 🔧 Backend Implementation

### API Endpoints

**Conversations**
- `POST /api/chat/conversations` - Create new conversation
- `GET /api/chat/conversations` - Get all user's conversations
- `GET /api/chat/conversations/:id` - Get messages for a conversation
- `PATCH /api/chat/conversations/:id` - Update conversation (title, pin, folder)
- `DELETE /api/chat/conversations/:id` - Delete conversation

**Messages**
- `POST /api/chat/conversations/:id/messages` - Send message (SSE streaming response)

**Search**
- `GET /api/chat/search?query=...` - Full-text search across all messages

### Content Moderation System

**Location:** `/backend/utils/contentModeration.js`

**Blocked Content:**
- Violence & harm keywords
- Explicit content
- Drug-related content (non-educational)
- Personal information requests
- Bullying language
- Jailbreak attempts

**Flagged Topics** (logged but allowed):
- Mental health concerns (depression, anxiety)
- Academic integrity concerns (cheating)
- Excessive caps (aggression indicators)

**Safety Responses:**
When content is blocked, the system returns friendly, educational redirects:
- "I'm here to help you learn in a safe and positive way!"
- "Let's keep our conversation educational and fun!"

### Streaming Implementation

Uses **Server-Sent Events (SSE)** for real-time streaming:
```javascript
// Backend sends chunks
res.write(`data: ${JSON.stringify({ type: 'content', text })}\n\n`);

// Frontend receives and displays
const reader = response.body.getReader();
// ... processes chunks in real-time
```

**Benefits:**
- Instant feedback (feels faster)
- Lower perceived latency
- Better user experience

---

## 🎨 Frontend Implementation

### Tech Stack
- **React 19** - UI framework
- **React Markdown** - Renders AI responses with formatting
- **Framer Motion** - Smooth animations
- **Heroicons** - Beautiful icon set
- **Tailwind CSS** - Styling

### Key Components

**`/frontend/src/pages/Chat.jsx`** (Main chat interface)

**Features:**
- Collapsible sidebar with conversation list
- Real-time message streaming display
- Search functionality
- Pin/delete/rename conversations
- Auto-scroll to new messages
- Markdown rendering for AI responses
- Mobile responsive design

### UI Design Philosophy

**Kid-Friendly Elements:**
- 🌈 Colorful gradients (purple, pink, blue)
- ✨ Friendly icons and emojis
- 💬 Large, readable fonts
- 🎨 Smooth animations
- 📚 Educational messaging
- 🌟 Encouraging copy ("You're here to learn and grow!")

**Design Colors:**
- Primary: Purple gradient (from-purple-500 to-pink-500)
- Secondary: Blue accents
- Background: Soft pastels (purple-50, blue-50, pink-50)
- Text: Dark gray for readability

---

## 🔒 Security Features

### Authentication
- All endpoints require authentication (`authenticateUser` middleware)
- Uses existing JWT token system
- Row-level security in database

### Rate Limiting
- Reuses `quizGenerationLimiter`: 20 messages per hour
- Prevents API abuse
- Protects against spam

### Content Safety
- Input sanitization on all messages
- Content moderation before sending to AI
- Blocked content never reaches Claude API
- Audit logging for flagged content

---

## 📦 Installation & Setup

### 1. Install Dependencies

**Backend:**
```bash
cd /root/quiz-app/backend
# No new dependencies needed (uses existing Anthropic SDK)
```

**Frontend:**
```bash
cd /root/quiz-app/frontend
npm install react-markdown framer-motion lucide-react @heroicons/react
```

### 2. Run Database Migration

In Supabase SQL Editor, execute:
```sql
-- Run the contents of:
/root/quiz-app/backend/database-chat-system.sql
```

This creates:
- `chat_conversations` table
- `chat_messages` table
- `chat_folders` table
- Full-text search indexes
- Row-level security policies

### 3. Update Backend

Routes are already added to `server.js`:
```javascript
import chatRoutes from './routes/chat.js';
app.use('/api/chat', chatRoutes);
```

### 4. Build & Deploy

**Backend:**
```bash
cd /root/quiz-app/backend
# Already running with systemd
systemctl restart inspirquiz
```

**Frontend:**
```bash
cd /root/quiz-app/frontend
npm run build
# Deploy to nginx /var/www/quiz.inspir.uk
```

---

## 🚀 Usage Guide

### For Students:

1. **Sign In** - Must be logged in to use chat
2. **Start New Chat** - Click "New Chat" button
3. **Ask Questions** - Type in the input box and press Enter
4. **View Responses** - AI streams responses word-by-word
5. **Organize Chats** - Pin important conversations
6. **Search History** - Use search bar to find old conversations

### Example Prompts:

**Good (Educational):**
- "Explain photosynthesis in simple terms"
- "Help me understand quadratic equations"
- "What caused World War 2?"
- "How do I write a thesis statement?"

**Blocked (Safety):**
- Requests for homework answers
- Inappropriate content
- Personal information requests
- Attempts to bypass safety

---

## 🎯 Educational AI Prompt

The AI uses a **student-optimized system prompt**:

```
You are a friendly, helpful AI tutor designed for students aged 8-18.

Your role is to:
1. Help students learn and understand concepts, not just give answers
2. Encourage critical thinking by asking guiding questions
3. Be patient, kind, and encouraging
4. Use age-appropriate language and examples
5. Never provide harmful, inappropriate, or explicit content
6. Refuse to help with cheating
7. If a student seems distressed, encourage them to talk to a trusted adult
```

This ensures:
- **No homework answers** - Helps understand, doesn't do the work
- **Age-appropriate** - Language suitable for 8-18 year olds
- **Safety-first** - Redirects concerning conversations
- **Educational focus** - Encourages learning, not shortcuts

---

## 📊 Analytics & Monitoring

### Tracked Metrics
- `tokens_used` - For usage monitoring
- `was_flagged` - Flagged content count
- `moderation_reason` - Why content was flagged
- Conversation counts per user
- Search query patterns

### Audit Logging
Content moderation events can be logged to `audit_logs` table for:
- Compliance
- Safety monitoring
- Pattern detection

---

## 🔮 Future Enhancements

### Planned Features
1. **Folder System** - Organize by subject (Math, Science, History)
2. **Export Conversations** - Save as PDF/Markdown
3. **Share Conversations** - Share with teachers/parents
4. **Voice Input** - Speak questions instead of typing
5. **Image Upload** - Ask questions about diagrams/homework
6. **Study Mode** - Quiz generation from chat history
7. **Parent Dashboard** - Overview of child's learning topics
8. **Teacher Integration** - Class-wide chat monitoring
9. **Multilingual Support** - Chat in any language
10. **Homework Helper Mode** - Structured problem-solving

### Technical Improvements
- **Redis caching** - Faster conversation loading
- **WebSocket** - Replace SSE for better performance
- **Message reactions** - Thumbs up/down for feedback
- **Conversation templates** - Pre-made study guides
- **AI model selection** - Choose between models (Haiku for speed, Opus for complex)

---

## 🐛 Known Issues & Limitations

### Current Limitations
1. **No Image Support** - Text-only for now
2. **No File Uploads** - Can't upload homework documents yet
3. **20 msg/hour limit** - Rate limiting may be restrictive
4. **No offline mode** - Requires internet connection
5. **Browser compatibility** - SSE may not work on older browsers

### Workarounds
- For complex problems, break into smaller questions
- Save important conversations by pinning them
- Use quiz generation feature for study materials

---

## 💾 Database Queries

### Common Admin Queries

**Count total conversations:**
```sql
SELECT COUNT(*) FROM chat_conversations;
```

**Count total messages:**
```sql
SELECT COUNT(*) FROM chat_messages;
```

**Find most active users:**
```sql
SELECT user_id, COUNT(*) as message_count
FROM chat_messages
GROUP BY user_id
ORDER BY message_count DESC
LIMIT 10;
```

**Find flagged content:**
```sql
SELECT * FROM chat_messages
WHERE was_flagged = true
ORDER BY created_at DESC;
```

**Search all conversations:**
```sql
SELECT * FROM chat_messages
WHERE to_tsvector('english', content) @@ to_tsquery('english', 'math & homework');
```

---

## 🆘 Troubleshooting

### Common Issues

**1. "Conversation not found"**
- Check user is logged in
- Verify conversation belongs to user
- Check database RLS policies

**2. Streaming not working**
- Ensure CORS allows SSE
- Check browser supports EventSource
- Verify rate limiting not triggered

**3. Content blocked error**
- Review content moderation rules
- Check if jailbreak detected
- Verify message isn't spam

**4. Search not returning results**
- Rebuild search index
- Check query syntax
- Verify user has conversations

### Debug Mode

Enable detailed logging:
```javascript
// In chatController.js
console.log('Streaming chunk:', data);
console.log('Moderation result:', moderation);
```

---

## 📝 Testing Checklist

Before deploying to production:

- [ ] Database migration ran successfully
- [ ] All API endpoints respond correctly
- [ ] Authentication works (requires login)
- [ ] Streaming displays in real-time
- [ ] Content moderation blocks inappropriate content
- [ ] Search returns relevant results
- [ ] Pin/delete/rename works
- [ ] Mobile responsive layout
- [ ] Rate limiting triggers correctly
- [ ] Error handling graceful
- [ ] Audit logs created for flagged content

### Test Scenarios

**Happy Path:**
1. Create new conversation
2. Send educational question
3. Receive streaming response
4. Pin conversation
5. Search for keyword
6. Delete conversation

**Safety Tests:**
1. Try blocked keyword → Should reject
2. Try jailbreak prompt → Should reject
3. Try excessive caps → Should flag
4. Ask about depression → Should flag but allow

---

## 📞 Support

For issues or questions:
1. Check this documentation first
2. Review error logs: `journalctl -u inspirquiz -n 100`
3. Check database for flagged content
4. Review Anthropic API usage dashboard

---

## 🎉 Success Metrics

**User Engagement:**
- Average conversations per user
- Messages per conversation
- Search usage rate
- Pinned conversation ratio

**Safety:**
- Blocked content rate < 1%
- Flagged content reviewed within 24h
- Zero safety incidents

**Performance:**
- Streaming latency < 500ms
- Search results < 1s
- 99.9% uptime

---

**Built with ❤️ for students everywhere!**

*Last Updated: 2025-12-08*
