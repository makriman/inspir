# 🎓 Complete Chat Feature Migration Package

**Generated:** 2025-12-14
**Purpose:** Standalone chat application migration from inspir toolkit

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Complete File Listing](#complete-file-listing)
4. [Environment Variables](#environment-variables)
5. [Database Setup](#database-setup)
6. [Dependencies](#dependencies)
7. [Complete Source Code](#complete-source-code)
8. [Migration Steps](#migration-steps)
9. [Testing](#testing)

---

## Overview

This package contains **ALL files** needed to extract the chat feature into a standalone application. The chat feature is a fully functional AI-powered tutoring system with:

- ✅ Real-time streaming responses via Claude API
- ✅ Conversation management (create, read, update, delete)
- ✅ Content moderation and safety filtering
- ✅ Full-text search across messages
- ✅ Beautiful, kid-friendly UI with animations
- ✅ JWT authentication
- ✅ PostgreSQL database with row-level security

**Total Files:** 22 core files + configuration

---

## Technology Stack

### Frontend
- **React 19** - UI framework
- **Framer Motion** - Animations
- **React Markdown** - Markdown rendering
- **React Syntax Highlighter** - Code syntax highlighting
- **Lucide React** - Icons
- **Heroicons** - Additional icons
- **Tailwind CSS** - Styling
- **Axios** - HTTP client

### Backend
- **Node.js + Express** - Server framework
- **Anthropic SDK** - Claude AI integration
- **Supabase** - PostgreSQL database with RLS
- **JWT (jsonwebtoken)** - Authentication
- **dotenv** - Environment variables

### Database
- **PostgreSQL** (via Supabase)
- **Full-text search** indexes
- **Row-level security** policies

---

## Complete File Listing

### Frontend Files (10 files)

```
frontend/
├── src/
│   ├── pages/
│   │   └── Chat.jsx                          (467 lines) - Main chat interface
│   ├── components/chat/
│   │   ├── ChatHeader.jsx                    (146 lines) - Header with filters
│   │   ├── MessageBubble.jsx                 (212 lines) - Message display
│   │   ├── RightSidebar.jsx                  (378 lines) - Conversation sidebar
│   │   ├── ToolbarIcon.jsx                   (120 lines) - Bottom toolbar icons
│   │   └── ToolModal.jsx                     (1180 lines) - Tool modal dialogs
│   ├── contexts/
│   │   └── AuthContext.jsx                   (117 lines) - Authentication context
│   ├── utils/
│   │   └── api.js                            (7 lines) - API URL configuration
│   ├── config/
│   │   └── tools.js                          (excerpt) - Tool configuration
│   ├── seo/
│   │   └── routes.js                         (excerpt) - SEO metadata
│   └── App.jsx                               (excerpt) - Route configuration
```

### Backend Files (8 files)

```
backend/
├── routes/
│   └── chat.js                               (33 lines) - API routes
├── controllers/
│   └── chatController.js                     (458 lines) - Business logic
├── utils/
│   ├── contentModeration.js                  (210 lines) - Safety system
│   └── claudeClient.js                       (400 lines) - AI client wrapper
├── middleware/
│   ├── auth.js                               (89 lines) - JWT authentication
│   └── rateLimiter.js                        (referenced) - Rate limiting
├── database-chat-system.sql                  (132 lines) - Database schema
├── test-anthropic-chat.js                    (54 lines) - Integration test
└── server.js                                 (excerpts) - Server configuration
```

### Documentation (4 files)

```
docs/
├── CHAT-FEATURE.md                           (475 lines) - Complete documentation
├── DEPLOY-CHAT.md                            (deployment guide)
├── README.md                                 (project overview)
└── PROJECT_SUMMARY.md                        (project summary)
```

---

## Environment Variables

Create a `.env` file with these variables:

```env
# Anthropic API
ANTHROPIC_API_KEY=sk-ant-xxxxx
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_TIMEOUT_MS=90000
ANTHROPIC_MAX_RETRIES=3

# JWT Authentication
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Supabase Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Server
PORT=3000
NODE_ENV=production

# Frontend (Vite)
VITE_API_URL=http://localhost:3000/api
```

---

## Database Setup

### 1. Create Supabase Project

1. Go to https://supabase.com
2. Create a new project
3. Note your database credentials

### 2. Run Database Migration

Execute the following SQL in Supabase SQL Editor:

```sql
-- See complete schema in database-chat-system.sql below
-- Creates 3 tables:
--   - chat_conversations
--   - chat_messages
--   - chat_folders
-- Plus indexes, triggers, and RLS policies
```

---

## Dependencies

### Frontend package.json

```json
{
  "name": "chat-app-frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^6.20.0",
    "framer-motion": "^11.0.0",
    "react-markdown": "^9.0.0",
    "react-syntax-highlighter": "^15.5.0",
    "lucide-react": "^0.300.0",
    "@heroicons/react": "^2.1.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.0.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

### Backend package.json

```json
{
  "name": "chat-app-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "node test-anthropic-chat.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@supabase/supabase-js": "^2.39.0",
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.0",
    "jsonwebtoken": "^9.0.0",
    "express-rate-limit": "^7.1.0",
    "bcryptjs": "^2.4.3"
  },
  "devDependencies": {
    "nodemon": "^3.0.0"
  }
}
```

---

## Complete Source Code

### FRONTEND FILES

#### 1. `/frontend/src/pages/Chat.jsx` (467 lines)

```jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import API_URL from '../utils/api';

// Import tool components
import ToolbarIcon from '../components/chat/ToolbarIcon';
import RightSidebar from '../components/chat/RightSidebar';
import ChatHeader from '../components/chat/ChatHeader';
import MessageBubble from '../components/chat/MessageBubble';
import ToolModal from '../components/chat/ToolModal';

export default function Chat() {
  const { user, session, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Chat state
  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');

  // UI state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeToolId, setActiveToolId] = useState(null);

  // User preferences
  const [ageFilter, setAgeFilter] = useState('teen'); // 'under14', 'teen', 'adult'
  const [currentSubject, setCurrentSubject] = useState('General');
  const [studyStreak, setStudyStreak] = useState(5);
  const [todayStudyTime, setTodayStudyTime] = useState(135); // minutes

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  // Load conversations on mount
  useEffect(() => {
    if (user && session) {
      loadConversations();
    }
  }, [user, session]);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessage]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 120);
      textareaRef.current.style.height = newHeight + 'px';
    }
  }, [inputMessage]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadConversations = async () => {
    try {
      const response = await axios.get(`${API_URL}/chat/conversations`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      setConversations(response.data);
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const createNewConversation = async () => {
    try {
      const response = await axios.post(
        `${API_URL}/chat/conversations`,
        { title: 'New Chat' },
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const newConv = response.data;
      setConversations(prev => [newConv, ...prev]);
      setCurrentConversation(newConv);
      setMessages([]);
      return newConv;
    } catch (error) {
      console.error('Error creating conversation:', error);
      return null;
    }
  };

  const loadMessages = async (conversationId) => {
    try {
      const response = await axios.get(
        `${API_URL}/chat/conversations/${conversationId}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      setMessages(response.data);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const selectConversation = (conversation) => {
    setCurrentConversation(conversation);
    loadMessages(conversation.id);
    setStreamingMessage('');
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || isStreaming) return;
    let conversation = currentConversation;
    if (!conversation) {
      const newConv = await createNewConversation();
      if (!newConv) return;
      conversation = newConv;
    }

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setIsStreaming(true);
    setStreamingMessage('');

    const tempUserMsg = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const response = await fetch(
        `${API_URL}/chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ content: userMessage })
        }
      );

      if (!response.ok) throw new Error('Failed to send message');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'content') {
                fullText += data.text;
                setStreamingMessage(fullText);
              } else if (data.type === 'done') {
                const assistantMsg = {
                  id: data.messageId,
                  role: 'assistant',
                  content: fullText,
                  created_at: new Date().toISOString()
                };
                setMessages(prev => [...prev, assistantMsg]);
                setStreamingMessage('');
                loadConversations();
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please try again.');
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const deleteConversation = async (convId) => {
    if (!confirm('Delete this conversation?')) return;
    try {
      await axios.delete(`${API_URL}/chat/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (currentConversation?.id === convId) {
        setCurrentConversation(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
    }
  };

  // Define 15 revolutionary tools
  const tools = [
    { id: 'draw', icon: '🎨', label: 'Draw/Sketch', description: 'Visual learning canvas', color: 'from-blue-500 to-green-500' },
    { id: 'quiz', icon: '📝', label: 'Quiz Generator', description: 'Create instant quizzes', color: 'from-purple-500 to-pink-500' },
    { id: 'flashcards', icon: '🃏', label: 'Flashcards', description: 'Study with flashcards', color: 'from-yellow-500 to-orange-500' },
    { id: 'practice', icon: '📊', label: 'Practice Tests', description: 'Full practice tests', color: 'from-blue-500 to-indigo-500' },
    { id: 'timer', icon: '⏰', label: 'Study Timer', description: 'Pomodoro timer', color: 'from-red-500 to-pink-500' },
    { id: 'habits', icon: '✅', label: 'Habit Tracker', description: 'Track study habits', color: 'from-green-500 to-teal-500' },
    { id: 'explain', icon: '💡', label: 'Explain Concept', description: 'Deep explanations', color: 'from-yellow-400 to-yellow-600' },
    { id: 'music', icon: '🎵', label: 'Study Music', description: 'Focus music', color: 'from-purple-400 to-purple-600' },
    { id: 'image', icon: '📸', label: 'Image Analysis', description: 'Homework help', color: 'from-blue-400 to-cyan-500' },
    { id: 'math', icon: '🧮', label: 'Math Solver', description: 'Step-by-step math', color: 'from-indigo-500 to-blue-500' },
    { id: 'science', icon: '🔬', label: 'Science Lab', description: 'Experiments & simulations', color: 'from-green-400 to-emerald-500' },
    { id: 'visual', icon: '🌍', label: 'Visual Learning', description: 'Diagrams & maps', color: 'from-blue-500 to-green-400' },
    { id: 'notes', icon: '📓', label: 'Notes Sync', description: 'Cornell notes', color: 'from-amber-600 to-orange-600' },
    { id: 'planner', icon: '📅', label: 'AI Planner', description: 'Smart scheduling', color: 'from-violet-500 to-purple-500' },
    { id: 'goals', icon: '🎯', label: 'Goal Setter', description: 'Track progress', color: 'from-red-500 to-rose-500' }
  ];

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-gray-600 text-lg"
        >
          Loading...
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-white overflow-hidden relative">
      {/* MAIN CHAT AREA - LEFT SIDE (60-70%) */}
      <motion.div
        className="flex-1 flex flex-col relative bg-gradient-to-br from-white to-purple-50/30"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Chat Header */}
        <ChatHeader
          currentSubject={currentSubject}
          ageFilter={ageFilter}
          studyStreak={studyStreak}
          todayStudyTime={todayStudyTime}
          onSubjectChange={setCurrentSubject}
          onAgeFilterChange={setAgeFilter}
        />

        {currentConversation ? (
          <>
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-8 py-6" style={{ paddingBottom: '100px' }}>
              <div className="max-w-4xl mx-auto">
                {messages.length === 0 && !streamingMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center py-12"
                  >
                    <h2 className="text-4xl font-bold text-gray-800 mb-4">
                      How can I help you today?
                    </h2>
                    <p className="text-gray-600 text-lg">
                      Ask me anything - I'm here to help you learn!
                    </p>
                  </motion.div>
                )}

                {messages.map((msg, idx) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    user={user}
                    index={idx}
                  />
                ))}

                {/* Streaming message */}
                {streamingMessage && (
                  <MessageBubble
                    message={{
                      id: 'streaming',
                      role: 'assistant',
                      content: streamingMessage,
                      created_at: new Date().toISOString()
                    }}
                    user={user}
                    isStreaming={true}
                  />
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input Area - Fixed at bottom of chat */}
            <div className="absolute bottom-20 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent pt-6 pb-4 px-8">
              <div className="max-w-4xl mx-auto">
                <motion.div
                  className="relative flex items-end gap-3 bg-white border-2 border-gray-200 rounded-2xl p-3 shadow-lg focus-within:border-blue-400 focus-within:shadow-xl transition-all"
                  whileFocus={{ scale: 1.01 }}
                >
                  {/* Quick action buttons */}
                  <div className="flex gap-2 items-center pb-2">
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Attach file"
                    >
                      📎
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Take photo"
                    >
                      📷
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Voice input"
                    >
                      🎤
                    </motion.button>
                  </div>

                  <textarea
                    ref={textareaRef}
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask me anything... I'm here to help you learn!"
                    disabled={isStreaming}
                    rows={1}
                    className="flex-1 resize-none bg-transparent border-none focus:outline-none text-base text-gray-900 placeholder-gray-400 px-3 py-2 disabled:opacity-50"
                    style={{ maxHeight: '120px' }}
                  />

                  <motion.button
                    onClick={sendMessage}
                    disabled={isStreaming || !inputMessage.trim()}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg"
                  >
                    🚀
                  </motion.button>
                </motion.div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center px-4" style={{ paddingBottom: '100px' }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="text-center"
            >
              <motion.div
                className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center mx-auto mb-6 shadow-2xl"
                animate={{
                  boxShadow: [
                    '0 10px 30px rgba(124, 58, 237, 0.3)',
                    '0 10px 40px rgba(124, 58, 237, 0.5)',
                    '0 10px 30px rgba(124, 58, 237, 0.3)',
                  ]
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <span className="text-5xl">✨</span>
              </motion.div>
              <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-4">
                inspir AI
              </h1>
              <p className="text-gray-600 text-xl mb-8">
                Your revolutionary AI study companion
              </p>
              <motion.button
                onClick={createNewConversation}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-8 py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-2xl hover:from-purple-700 hover:to-blue-700 transition-all font-semibold text-lg shadow-xl"
              >
                Start Learning Now
              </motion.button>
            </motion.div>
          </div>
        )}
      </motion.div>

      {/* RIGHT SIDEBAR - Navigation & Organization (320px) */}
      <RightSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        user={user}
        conversations={conversations}
        currentConversation={currentConversation}
        onSelectConversation={selectConversation}
        onDeleteConversation={deleteConversation}
        onNewConversation={createNewConversation}
        studyStreak={studyStreak}
        todayStudyTime={todayStudyTime}
      />

      {/* BOTTOM TOOLBAR - Revolutionary Animated Tools */}
      <motion.div
        className="fixed bottom-0 left-0 right-0 h-20 bg-white/80 backdrop-blur-xl border-t border-gray-200 shadow-2xl z-50"
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div className="h-full flex items-center justify-center gap-4 px-4 overflow-x-auto">
          {tools.map((tool, index) => (
            <ToolbarIcon
              key={tool.id}
              tool={tool}
              index={index}
              isActive={activeToolId === tool.id}
              onClick={() => setActiveToolId(tool.id)}
            />
          ))}
        </div>
      </motion.div>

      {/* Tool Modal */}
      <AnimatePresence>
        {activeToolId && (
          <ToolModal
            tool={tools.find(t => t.id === activeToolId)}
            onClose={() => setActiveToolId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
```

*(Continue with remaining files in next section...)*

