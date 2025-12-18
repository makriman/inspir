import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { Search, Plus, Trash2, Calendar, BookOpen, Star, Target } from 'lucide-react';

export default function RightSidebar({
  collapsed,
  onToggle,
  user,
  conversations,
  currentConversation,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
  studyStreak,
  todayStudyTime
}) {
  const [expandedSection, setExpandedSection] = useState('history');
  const [searchQuery, setSearchQuery] = useState('');

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const formatTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  // Mock data for demonstration
  const notes = [
    { id: 1, title: 'Quadratic Formula', icon: '📝', date: '2 days ago' },
    { id: 2, title: "Newton's 3 Laws", icon: '📝', date: '1 week ago' },
    { id: 3, title: 'Periodic Table Tips', icon: '📝', date: '2 weeks ago' }
  ];

  const upcomingEvents = [
    { id: 1, title: 'Math Exam', date: 'Dec 15', color: 'text-red-600' },
    { id: 2, title: 'Physics Test', date: 'Dec 18', color: 'text-blue-600' }
  ];

  const todayPlan = [
    { id: 1, subject: 'Math', duration: 30, completed: true },
    { id: 2, subject: 'Physics', duration: 45, completed: false },
    { id: 3, subject: 'Chemistry', duration: 30, completed: false }
  ];

  const subjects = [
    { id: 1, name: 'Mathematics', icon: '🔢', count: 12, color: 'bg-blue-100 text-blue-700' },
    { id: 2, name: 'Physics', icon: '⚛️', count: 8, color: 'bg-purple-100 text-purple-700' },
    { id: 3, name: 'Chemistry', icon: '🧪', count: 6, color: 'bg-green-100 text-green-700' },
    { id: 4, name: 'Geography', icon: '🌍', count: 3, color: 'bg-yellow-100 text-yellow-700' }
  ];

  if (collapsed) {
    return (
      <motion.div
        className="w-16 bg-gradient-to-b from-purple-50 to-blue-50 border-l border-gray-200 flex flex-col items-center py-4 gap-4"
        initial={{ width: 320, opacity: 1 }}
        animate={{ width: 64, opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <motion.button
          onClick={onToggle}
          className="p-3 hover:bg-white/60 rounded-lg transition-colors"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <span className="text-2xl">☰</span>
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="w-80 bg-gradient-to-b from-purple-50 to-blue-50 border-l border-gray-200 flex flex-col overflow-hidden"
      initial={{ width: 64, opacity: 0 }}
      animate={{ width: 320, opacity: 1 }}
      exit={{ width: 64, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white/50 backdrop-blur">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Navigation</h2>
          <motion.button
            onClick={onToggle}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
          >
            ✕
          </motion.button>
        </div>

        {/* User Profile */}
        <motion.div
          className="bg-white rounded-xl p-4 shadow-sm"
          whileHover={{ boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-lg font-bold shadow-lg">
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div>
              <div className="font-semibold text-gray-800">{user?.username || 'Student'}</div>
              <div className="text-xs text-gray-500">Level 5 Scholar</div>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1">
              <span>🔥</span>
              <span className="font-semibold">{studyStreak} day streak</span>
            </div>
            <div className="flex items-center gap-1">
              <span>⏱️</span>
              <span className="font-semibold">{formatTime(todayStudyTime)} today</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Chat History Section */}
        <SidebarSection
          title="📝 Chat History"
          icon="history"
          isExpanded={expandedSection === 'history'}
          onToggle={() => toggleSection('history')}
        >
          <div className="mb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>

          <div className="space-y-1 max-h-64 overflow-y-auto">
            {conversations.map((conv) => (
              <motion.div
                key={conv.id}
                onClick={() => onSelectConversation(conv)}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  currentConversation?.id === conv.id
                    ? 'bg-blue-500 text-white'
                    : 'hover:bg-white'
                }`}
                whileHover={{ x: 2 }}
              >
                <div className="flex-1 text-sm truncate">{conv.title}</div>
                <motion.button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(conv.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-opacity"
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: 0.8 }}
                >
                  <Trash2 className="w-3 h-3 text-red-600" />
                </motion.button>
              </motion.div>
            ))}
          </div>
        </SidebarSection>

        {/* My Notes Section */}
        <SidebarSection
          title="📓 My Notes"
          icon="notes"
          isExpanded={expandedSection === 'notes'}
          onToggle={() => toggleSection('notes')}
        >
          <div className="space-y-2">
            {notes.map((note) => (
              <motion.div
                key={note.id}
                className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg hover:shadow-md cursor-pointer transition-shadow"
                whileHover={{ x: 2 }}
              >
                <span className="text-xl">{note.icon}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">{note.title}</div>
                  <div className="text-xs text-gray-500">{note.date}</div>
                </div>
              </motion.div>
            ))}
            <motion.button
              className="w-full px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Plus className="w-4 h-4" />
              New Note
            </motion.button>
          </div>
        </SidebarSection>

        {/* Study Calendar Section */}
        <SidebarSection
          title="📅 Study Calendar"
          icon="calendar"
          isExpanded={expandedSection === 'calendar'}
          onToggle={() => toggleSection('calendar')}
        >
          <div className="space-y-3">
            <div className="text-center mb-2">
              <div className="text-sm font-bold text-gray-800">December 2024</div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-600 mb-2">📍 Upcoming:</div>
              {upcomingEvents.map((event) => (
                <motion.div
                  key={event.id}
                  className="flex items-center justify-between px-3 py-2 bg-white rounded-lg hover:shadow-md transition-shadow"
                  whileHover={{ x: 2 }}
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium">{event.title}</span>
                  </div>
                  <span className={`text-xs font-semibold ${event.color}`}>{event.date}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </SidebarSection>

        {/* Study Planner Section */}
        <SidebarSection
          title="📊 Study Planner"
          icon="planner"
          isExpanded={expandedSection === 'planner'}
          onToggle={() => toggleSection('planner')}
        >
          <div className="space-y-3">
            <div className="text-xs font-semibold text-gray-600 mb-2">Today's Plan:</div>
            {todayPlan.map((task) => (
              <motion.div
                key={task.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                  task.completed ? 'bg-green-50' : 'bg-white'
                }`}
                whileHover={{ x: 2 }}
              >
                <div className={`w-5 h-5 rounded flex items-center justify-center ${
                  task.completed ? 'bg-green-500' : 'bg-gray-200'
                }`}>
                  {task.completed && <span className="text-white text-xs">✓</span>}
                </div>
                <div className="flex-1">
                  <span className={`text-sm ${task.completed ? 'line-through text-gray-500' : 'text-gray-800 font-medium'}`}>
                    {task.subject}: {task.duration} min
                  </span>
                </div>
              </motion.div>
            ))}
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="text-xs font-semibold text-gray-600 mb-2">Weekly Progress:</div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <motion.div
                  className="bg-gradient-to-r from-green-400 to-green-600 h-2 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: '80%' }}
                  transition={{ duration: 1, delay: 0.2 }}
                />
              </div>
              <div className="text-right text-xs text-gray-600 mt-1">80%</div>
            </div>
          </div>
        </SidebarSection>

        {/* Saved & Favorites Section */}
        <SidebarSection
          title="⭐ Saved Items"
          icon="saved"
          isExpanded={expandedSection === 'saved'}
          onToggle={() => toggleSection('saved')}
        >
          <div className="space-y-2 text-center text-sm text-gray-500">
            <Star className="w-8 h-8 mx-auto text-gray-300" />
            <p>No saved items yet</p>
            <p className="text-xs">Star messages to save them here</p>
          </div>
        </SidebarSection>

        {/* My Subjects Section */}
        <SidebarSection
          title="📚 My Subjects"
          icon="subjects"
          isExpanded={expandedSection === 'subjects'}
          onToggle={() => toggleSection('subjects')}
        >
          <div className="space-y-2">
            {subjects.map((subject) => (
              <motion.div
                key={subject.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer ${subject.color} hover:shadow-md transition-shadow`}
                whileHover={{ x: 2 }}
              >
                <span className="text-2xl">{subject.icon}</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold">{subject.name}</div>
                  <div className="text-xs opacity-70">{subject.count} chats</div>
                </div>
              </motion.div>
            ))}
            <motion.button
              className="w-full px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Plus className="w-4 h-4" />
              Add Subject
            </motion.button>
          </div>
        </SidebarSection>
      </div>

      {/* Quick Actions Footer */}
      <div className="p-4 border-t border-gray-200 bg-white/50 backdrop-blur space-y-2">
        <motion.button
          onClick={onNewConversation}
          className="w-full px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl hover:from-purple-700 hover:to-blue-700 transition-all font-semibold text-sm shadow-lg flex items-center justify-center gap-2"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Plus className="w-4 h-4" />
          New Chat
        </motion.button>
      </div>
    </motion.div>
  );
}

// Sidebar Section Component
function SidebarSection({ title, isExpanded, onToggle, children }) {
  return (
    <motion.div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <motion.button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
        whileHover={{ backgroundColor: 'rgba(0,0,0,0.02)' }}
      >
        <span className="font-semibold text-sm text-gray-800">{title}</span>
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          ▼
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
