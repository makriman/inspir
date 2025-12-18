import { motion } from 'framer-motion';
import { Shield, BookOpen, Flame, Clock } from 'lucide-react';

export default function ChatHeader({
  currentSubject,
  ageFilter,
  studyStreak,
  todayStudyTime,
  onSubjectChange,
  onAgeFilterChange
}) {
  const formatTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const ageFilterConfig = {
    under14: { label: 'Under 14 🛡️', color: 'bg-green-500', description: 'Strict filtering' },
    teen: { label: 'Teen Mode', color: 'bg-yellow-500', description: 'Moderate filtering' },
    adult: { label: 'Adult', color: 'bg-blue-500', description: 'Minimal filtering' }
  };

  const subjects = [
    'General', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
    'English', 'History', 'Geography', 'Computer Science'
  ];

  return (
    <motion.div
      className="bg-white/80 backdrop-blur-xl border-b border-gray-200 px-8 py-4 shadow-sm"
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Left: Subject & Age Filter */}
        <div className="flex items-center gap-4">
          {/* Subject Selector */}
          <motion.div
            className="flex items-center gap-2 bg-gradient-to-r from-purple-50 to-blue-50 px-4 py-2 rounded-xl"
            whileHover={{ scale: 1.02 }}
          >
            <BookOpen className="w-4 h-4 text-purple-600" />
            <select
              value={currentSubject}
              onChange={(e) => onSubjectChange(e.target.value)}
              className="bg-transparent border-none focus:outline-none font-semibold text-gray-800 cursor-pointer"
            >
              {subjects.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </select>
          </motion.div>

          {/* Age Filter Badge */}
          <motion.div
            className="relative group"
            whileHover={{ scale: 1.05 }}
          >
            <motion.button
              className={`flex items-center gap-2 ${ageFilterConfig[ageFilter].color} text-white px-4 py-2 rounded-xl font-semibold text-sm shadow-md`}
              whileHover={{ boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
            >
              <Shield className="w-4 h-4" />
              {ageFilterConfig[ageFilter].label}
            </motion.button>

            {/* Dropdown on hover */}
            <motion.div
              className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-xl p-2 z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all"
              initial={{ y: -10 }}
              whileHover={{ y: 0 }}
            >
              {Object.entries(ageFilterConfig).map(([key, config]) => (
                <motion.button
                  key={key}
                  onClick={() => onAgeFilterChange(key)}
                  className={`w-full text-left px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-2 whitespace-nowrap ${
                    ageFilter === key ? 'bg-blue-50 text-blue-600' : 'text-gray-700'
                  }`}
                  whileHover={{ x: 2 }}
                >
                  <div className={`w-3 h-3 rounded-full ${config.color}`} />
                  <div>
                    <div className="font-semibold text-sm">{config.label}</div>
                    <div className="text-xs text-gray-500">{config.description}</div>
                  </div>
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        </div>

        {/* Right: Stats */}
        <div className="flex items-center gap-4">
          {/* Study Streak */}
          <motion.div
            className="flex items-center gap-2 bg-gradient-to-r from-orange-50 to-red-50 px-4 py-2 rounded-xl"
            whileHover={{ scale: 1.05 }}
            animate={{
              boxShadow: [
                '0 0 0 0 rgba(251, 146, 60, 0)',
                '0 0 0 8px rgba(251, 146, 60, 0.1)',
                '0 0 0 0 rgba(251, 146, 60, 0)'
              ]
            }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Flame className="w-5 h-5 text-orange-600" />
            <div>
              <div className="text-xs text-gray-600">Streak</div>
              <div className="font-bold text-orange-600">{studyStreak} days</div>
            </div>
          </motion.div>

          {/* Today's Time */}
          <motion.div
            className="flex items-center gap-2 bg-gradient-to-r from-blue-50 to-purple-50 px-4 py-2 rounded-xl"
            whileHover={{ scale: 1.05 }}
          >
            <Clock className="w-5 h-5 text-blue-600" />
            <div>
              <div className="text-xs text-gray-600">Today</div>
              <div className="font-bold text-blue-600">{formatTime(todayStudyTime)}</div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Context Line (if needed) */}
      <motion.div
        className="mt-3 text-sm text-gray-600 flex items-center gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span>AI ready to help with {currentSubject.toLowerCase()}</span>
      </motion.div>
    </motion.div>
  );
}
