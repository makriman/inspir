import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

export default function StudyStreaks({ compact = false }) {
  const [streakData, setStreakData] = useState(null);
  const [activityHistory, setActivityHistory] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStreakData();
    if (!compact) {
      loadActivityHistory();
      loadStats();
    }
  }, [compact]);

  const loadStreakData = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;

      const response = await axios.get(`${API_URL}/streaks/current`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStreakData(response.data);
    } catch (error) {
      console.error('Error loading streak data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadActivityHistory = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;

      const response = await axios.get(`${API_URL}/streaks/history?days=30`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setActivityHistory(response.data);
    } catch (error) {
      console.error('Error loading activity history:', error);
    }
  };

  const loadStats = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;

      const response = await axios.get(`${API_URL}/streaks/stats?days=30`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  // Helper function to get color based on streak
  const getStreakColor = (streak) => {
    if (streak === 0) return 'text-gray-400';
    if (streak < 3) return 'text-orange-500';
    if (streak < 7) return 'text-yellow-500';
    if (streak < 14) return 'text-green-500';
    return 'text-purple-600';
  };

  const getStreakMessage = (streak) => {
    if (streak === 0) return 'Start your streak today!';
    if (streak === 1) return 'Great start!';
    if (streak < 3) return 'Keep it up!';
    if (streak < 7) return 'You\'re on fire! 🔥';
    if (streak < 14) return 'Amazing streak! 🌟';
    if (streak < 30) return 'Incredible dedication! 🚀';
    return 'Legendary streak! 👑';
  };

  // Compact view for dashboard
  if (compact) {
    if (loading || !streakData) {
      return (
        <div className="bg-gradient-to-br from-orange-400 to-red-500 rounded-xl p-6 text-white">
          <div className="text-center">
            <div className="text-4xl mb-2">🔥</div>
            <div className="text-sm opacity-90">Loading streak...</div>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-gradient-to-br from-orange-400 to-red-500 rounded-xl p-6 text-white shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Study Streak</h3>
          <div className="text-3xl">🔥</div>
        </div>

        <div className="text-center">
          <div className="text-5xl font-bold mb-2">
            {streakData.current_streak}
          </div>
          <div className="text-sm opacity-90 mb-4">
            {streakData.current_streak === 1 ? 'day' : 'days'} in a row
          </div>
          <div className="text-xs opacity-75">
            Longest: {streakData.longest_streak} days
          </div>
        </div>
      </div>
    );
  }

  // Full view for dedicated page
  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">🔥</div>
        <div className="text-gray-600">Loading your study streak...</div>
      </div>
    );
  }

  if (!streakData) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">📚</div>
        <div className="text-gray-600">Start studying to begin your streak!</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Streak Display */}
      <div className="bg-gradient-to-br from-orange-400 to-red-500 rounded-xl p-8 text-white shadow-xl">
        <div className="text-center">
          <div className="text-6xl mb-4">🔥</div>
          <div className={`text-7xl font-bold mb-2 ${getStreakColor(streakData.current_streak)}`}>
            {streakData.current_streak}
          </div>
          <div className="text-2xl mb-4">
            {streakData.current_streak === 1 ? 'Day Streak' : 'Days Streak'}
          </div>
          <div className="text-lg opacity-90">
            {getStreakMessage(streakData.current_streak)}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-4 mt-8 pt-6 border-t border-white/20">
          <div className="text-center">
            <div className="text-3xl font-bold">{streakData.longest_streak}</div>
            <div className="text-sm opacity-75">Longest Streak</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold">{streakData.total_study_days}</div>
            <div className="text-sm opacity-75">Total Days</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold">{streakData.streak_freeze_count || 0}</div>
            <div className="text-sm opacity-75">Freezes Left</div>
          </div>
        </div>
      </div>

      {/* Activity Calendar Heatmap */}
      {activityHistory && activityHistory.groupedByDate && (
        <div className="bg-white rounded-xl p-6 shadow-lg">
          <h3 className="text-xl font-bold text-gray-800 mb-4">📅 30-Day Activity</h3>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 30 }, (_, i) => {
              const date = new Date();
              date.setDate(date.getDate() - (29 - i));
              const dateStr = date.toISOString().split('T')[0];
              const hasActivity = activityHistory.groupedByDate[dateStr];

              return (
                <div
                  key={i}
                  className={`aspect-square rounded ${
                    hasActivity
                      ? 'bg-gradient-to-br from-green-400 to-green-600'
                      : 'bg-gray-200'
                  } flex items-center justify-center text-xs text-white font-semibold`}
                  title={dateStr}
                >
                  {date.getDate()}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between items-center mt-4 text-xs text-gray-500">
            <span>30 days ago</span>
            <span>Today</span>
          </div>
        </div>
      )}

      {/* Activity Stats by Type */}
      {stats && Object.keys(stats).length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow-lg">
          <h3 className="text-xl font-bold text-gray-800 mb-4">📊 Activity Breakdown</h3>
          <div className="space-y-4">
            {Object.entries(stats).map(([type, data]) => {
              const total = Object.values(stats).reduce((sum, s) => sum + s.count, 0);
              const percentage = ((data.count / total) * 100).toFixed(1);

              return (
                <div key={type}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold capitalize text-gray-700">
                      {type === 'quiz' && '📝 Quizzes'}
                      {type === 'chat' && '💬 AI Chat'}
                      {type === 'timer' && '⏱️ Timer'}
                      {type === 'notes' && '📝 Notes'}
                      {type === 'citation' && '📚 Citations'}
                      {!['quiz', 'chat', 'timer', 'notes', 'citation'].includes(type) && `📌 ${type}`}
                    </span>
                    <span className="text-sm text-gray-600">
                      {data.count} times • {Math.round(data.totalTimeMinutes)} min
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-indigo-600 h-3 rounded-full transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Motivational Tips */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl p-6 text-white">
        <h3 className="text-lg font-bold mb-3">💡 Streak Tips</h3>
        <ul className="space-y-2 text-sm opacity-90">
          <li>✓ Study a little every day to maintain your streak</li>
          <li>✓ Try different tools: quizzes, chat, notes, citations</li>
          <li>✓ Even 5 minutes counts toward your streak!</li>
          <li>✓ Your longest streak: {streakData.longest_streak} days - can you beat it?</li>
        </ul>
      </div>
    </div>
  );
}
