import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import API_URL from '../utils/api';
import ToolCard from '../components/ToolCard';
import ToolSearch from '../components/ToolSearch';
import ComingSoonModal from '../components/ComingSoonModal';
import { tools, categories, getLiveTools, getToolsByCategory } from '../config/tools';

export default function HomePageUser() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showAllTools, setShowAllTools] = useState(false);
  const [selectedTool, setSelectedTool] = useState(null);

  const liveTools = getLiveTools();
  const filteredTools = getToolsByCategory(selectedCategory);
  const displayedTools = showAllTools ? filteredTools : filteredTools.slice(0, 12);

  // Fetch homepage stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await axios.get(`${API_URL}/user/homepage-stats`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        setStats(response.data);
      } catch (error) {
        console.error('Failed to load homepage stats:', error);
        // Set default stats if API fails
        setStats({
          study_time_today: 0,
          quizzes_this_week: 0,
          notes_created: 0,
          current_streak: 0,
          recent_activities: []
        });
      } finally {
        setLoading(false);
      }
    };

    if (session) {
      fetchStats();
    }
  }, [session]);

  const handleToolClick = (tool) => {
    if (tool.status === 'coming-soon') {
      setSelectedTool(tool);
    }
  };

  const formatTime = (minutes) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-off-white pb-16">
      {/* Welcome Banner */}
      <section className="sticky top-0 z-30 bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
            {/* Welcome Message */}
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                👋 Welcome back, {user?.username || 'Student'}!
              </h1>
            </div>

            {/* Stats Cards */}
            {!loading && stats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 w-full lg:w-auto">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-primary-blue">
                    {formatTime(stats.study_time_today)}
                  </div>
                  <div className="text-xs text-gray-600">Today</div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {stats.quizzes_this_week}
                  </div>
                  <div className="text-xs text-gray-600">Quizzes</div>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {stats.notes_created}
                  </div>
                  <div className="text-xs text-gray-600">Notes</div>
                </div>

                <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    🔥 {stats.current_streak}
                  </div>
                  <div className="text-xs text-gray-600">Streak</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Quick Actions */}
      <section className="max-w-7xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Quick Start</h2>

        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {liveTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => navigate(tool.route)}
              className="flex-shrink-0 flex items-center space-x-3 px-6 py-3 bg-white rounded-xl border-2 border-gray-200 hover:border-primary-blue hover:shadow-md transition-all duration-200 min-w-[200px]"
            >
              <span className="text-3xl">{tool.icon}</span>
              <span className="font-semibold text-gray-900">{tool.name}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Recent Activity */}
      {!loading && stats && stats.recent_activities && stats.recent_activities.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-900">
              Continue Where You Left Off
            </h2>
            <button
              onClick={() => navigate('/quiz/history')}
              className="text-primary-blue hover:text-purple-dark font-semibold text-sm"
            >
              View All Activity →
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stats.recent_activities.slice(0, 6).map((activity, index) => (
              <div
                key={index}
                onClick={() => activity.route && navigate(activity.route)}
                className="bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer border-2 border-transparent hover:border-primary-blue"
              >
                <div className="flex items-start space-x-3">
                  <div className="text-3xl">{activity.icon || '📄'}</div>
                  <div className="flex-grow">
                    <h3 className="font-semibold text-gray-900 mb-1">
                      {activity.title}
                    </h3>
                    {activity.stat && (
                      <p className="text-sm text-primary-blue font-semibold mb-1">
                        {activity.stat}
                      </p>
                    )}
                    <p className="text-xs text-gray-500">{activity.timestamp}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* This Week's Highlights */}
      {!loading && stats && (
        <section className="max-w-7xl mx-auto px-4 py-8">
          <details className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-2xl p-6 shadow-sm">
            <summary className="cursor-pointer text-xl font-bold text-gray-900 mb-2">
              📈 This Week's Highlights
            </summary>
            <div className="mt-4 space-y-2 text-gray-700">
              <p>📚 35% more study time than last week</p>
              <p>🎯 Quiz scores improving (+12%)</p>
              <p>🔥 Longest focus session: 45 minutes</p>
              <p>⭐ 3 new achievements unlocked</p>
            </div>
          </details>
        </section>
      )}

      {/* All Tools Section */}
      <section className="max-w-7xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          All Your Study Tools
        </h2>

        {/* Search Bar */}
        <div className="mb-6">
          <ToolSearch
            placeholder="Search all 67 tools..."
            onToolClick={handleToolClick}
          />
        </div>

        {/* Category Filter Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {categories.map((category) => {
            const count = category === 'All' ? tools.length : getToolsByCategory(category).length;
            return (
              <button
                key={category}
                onClick={() => {
                  setSelectedCategory(category);
                  setShowAllTools(false);
                }}
                className={`
                  px-4 py-2 rounded-full font-semibold transition-all duration-200 text-sm
                  ${selectedCategory === category
                    ? 'bg-primary-blue text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                {category} ({count})
              </button>
            );
          })}
        </div>

        {/* Tools Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {displayedTools.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              onClick={handleToolClick}
              showStats={tool.status === 'live'}
              stats={{
                usageCount: Math.floor(Math.random() * 20),
                lastUsed: '2 days ago'
              }}
            />
          ))}
        </div>

        {/* Show More Button */}
        {!showAllTools && filteredTools.length > 12 && (
          <div className="text-center mt-6">
            <button
              onClick={() => setShowAllTools(true)}
              className="px-8 py-3 bg-primary-blue text-white font-bold rounded-xl hover:bg-opacity-90 transition-all duration-200"
            >
              Show More ({filteredTools.length - 12} more tools)
            </button>
          </div>
        )}
      </section>

      {/* Coming Soon Modal */}
      {selectedTool && (
        <ComingSoonModal
          tool={selectedTool}
          onClose={() => setSelectedTool(null)}
        />
      )}
    </div>
  );
}
