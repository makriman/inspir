import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import API_URL from '../utils/api';
import StudyStreaks from './StudyStreaks';

export default function Dashboard() {
  const [quizHistory, setQuizHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user, session, signOut } = useAuth();
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    if (!session) return;
    try {
      const response = await axios.get(`${API_URL}/quiz/history`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      setQuizHistory(response.data);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load data:', err);
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    fetchData();
  }, [user, navigate, fetchData]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  // Tool cards configuration
  const tools = [
    {
      name: 'Quiz Generator',
      icon: '📝',
      description: 'Create AI-powered quizzes from any text',
      path: '/',
      color: 'from-purple-500 to-indigo-600',
      stats: `${quizHistory.length} quizzes taken`
    },
    {
      name: 'Doubt Solver',
      icon: '🤔',
      description: 'Get homework help with AI',
      path: '/doubt',
      color: 'from-orange-500 to-red-600',
      stats: 'Upload or type questions'
    },
    {
      name: 'Cornell Notes',
      icon: '📚',
      description: 'Convert text to Cornell format',
      path: '/cornell-notes',
      color: 'from-green-500 to-emerald-600',
      stats: 'AI-powered notes'
    },
    {
      name: 'Citation Generator',
      icon: '📖',
      description: 'Generate citations in all formats',
      path: '/citations',
      color: 'from-yellow-500 to-orange-600',
      stats: 'MLA, APA, Chicago, Harvard'
    },
    {
      name: 'Study Timer',
      icon: '⏱️',
      description: 'Pomodoro-style focus timer',
      path: '/study-timer',
      color: 'from-pink-500 to-rose-600',
      stats: 'Stay focused & productive'
    },
    {
      name: 'Grade Calculator',
      icon: '📊',
      description: 'Plan your semester grades',
      path: '/grade-calculator',
      color: 'from-teal-500 to-green-600',
      stats: 'Track your progress'
    },
    {
      name: 'Student Forum',
      icon: '👥',
      description: 'Connect with other students',
      path: '/forum',
      color: 'from-indigo-500 to-purple-600',
      stats: 'Join the community'
    },
    {
      name: 'Study Streaks',
      icon: '🔥',
      description: 'Track your daily progress',
      path: '/streaks',
      color: 'from-red-500 to-orange-600',
      stats: 'Build your habit'
    }
  ];

  const averageScore = quizHistory.length > 0
    ? Math.round(quizHistory.reduce((sum, h) => sum + h.percentage, 0) / quizHistory.length)
    : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-purple-gradient flex items-center justify-center">
        <div className="text-white text-2xl">Loading your dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-purple-gradient p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">
              Welcome back, {user?.username || 'Student'}! 👋
            </h1>
            <p className="text-vibrant-yellow text-lg">
              The Only Study Toolkit You Need
            </p>
          </div>
          <button
            onClick={handleSignOut}
            className="px-6 py-3 bg-white text-deep-blue rounded-lg font-semibold hover:bg-opacity-90 transition-all shadow-lg"
          >
            Sign Out
          </button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-xl p-6 transform hover:scale-105 transition-all">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-600 text-sm font-semibold">Total Quizzes</p>
              <span className="text-2xl">📝</span>
            </div>
            <p className="text-4xl font-bold text-deep-blue">{quizHistory.length}</p>
            <p className="text-xs text-gray-500 mt-1">Keep learning!</p>
          </div>

          <div className="bg-white rounded-xl shadow-xl p-6 transform hover:scale-105 transition-all">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-600 text-sm font-semibold">Average Score</p>
              <span className="text-2xl">🎯</span>
            </div>
            <p className="text-4xl font-bold text-deep-blue">{averageScore}%</p>
            <p className="text-xs text-gray-500 mt-1">Great progress!</p>
          </div>

          <div className="bg-white rounded-xl shadow-xl p-6 transform hover:scale-105 transition-all">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-600 text-sm font-semibold">Best Score</p>
              <span className="text-2xl">⭐</span>
            </div>
            <p className="text-4xl font-bold text-deep-blue">
              {quizHistory.length > 0 ? Math.max(...quizHistory.map(h => h.percentage)) : 0}%
            </p>
            <p className="text-xs text-gray-500 mt-1">Outstanding!</p>
          </div>

          {/* Study Streak Card */}
          <div className="transform hover:scale-105 transition-all">
            <StudyStreaks compact={true} />
          </div>
        </div>

        {/* All Tools Section */}
        <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-3xl font-bold text-deep-blue">All Study Tools</h2>
            <span className="text-4xl">🚀</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {tools.map((tool, index) => (
              <div
                key={index}
                onClick={() => navigate(tool.path)}
                className={`group relative bg-gradient-to-br ${tool.color} rounded-xl p-6 cursor-pointer transform hover:scale-105 transition-all shadow-lg hover:shadow-2xl overflow-hidden`}
              >
                {/* Background decoration */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>

                <div className="relative z-10">
                  <div className="text-5xl mb-3">{tool.icon}</div>
                  <h3 className="text-xl font-bold text-white mb-2">{tool.name}</h3>
                  <p className="text-white text-sm opacity-90 mb-3">{tool.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white opacity-75">{tool.stats}</span>
                    <svg className="w-5 h-5 text-white group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Quiz Activity */}
        {quizHistory.length > 0 && (
          <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-deep-blue">Recent Quiz Activity</h2>
              <button
                onClick={() => navigate('/history')}
                className="text-coral-red hover:text-coral-red/80 font-semibold text-sm flex items-center gap-1"
              >
                View All
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {quizHistory.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  className="border-2 border-gray-200 rounded-xl p-4 hover:border-deep-blue transition-all cursor-pointer"
                  onClick={() => navigate(`/quiz/${item.quiz_id}/review`)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-deep-blue mb-1">
                        {item.quizzes?.source_name || 'Untitled Quiz'}
                      </h3>
                      <p className="text-sm text-gray-600">
                        {new Date(item.submitted_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className={`text-3xl font-bold ${
                        item.percentage >= 80 ? 'text-green-600' :
                        item.percentage >= 60 ? 'text-yellow-600' :
                        'text-coral-red'
                      }`}>
                        {item.percentage}%
                      </div>
                      <p className="text-sm text-gray-600">
                        {item.score}/{item.total_questions} correct
                      </p>
                    </div>
                  </div>

                  {/* Performance bar */}
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        item.percentage >= 80 ? 'bg-green-500' :
                        item.percentage >= 60 ? 'bg-yellow-500' :
                        'bg-coral-red'
                      }`}
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {quizHistory.length === 0 && (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📚</div>
                <p className="text-gray-600 text-lg mb-4">No quiz activity yet</p>
                <button
                  onClick={() => navigate('/quiz')}
                  className="px-6 py-3 bg-coral-red text-white rounded-lg font-semibold hover:bg-opacity-90 shadow-lg"
                >
                  Take Your First Quiz
                </button>
              </div>
            )}
          </div>
        )}

        {/* Quick Actions */}
        <div className="mt-8 bg-gradient-to-r from-vibrant-yellow to-orange-500 rounded-2xl shadow-2xl p-8 text-center">
          <h2 className="text-3xl font-bold text-deep-blue mb-4">
            Ready to study? 🎓
          </h2>
          <p className="text-deep-blue mb-6 text-lg">
            Choose a tool and start learning smarter, not harder!
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="px-8 py-4 bg-deep-blue text-white rounded-lg font-bold hover:bg-opacity-90 transition-all shadow-lg transform hover:scale-105"
            >
              Create Quiz
            </button>
            <button
              onClick={() => navigate('/study-timer')}
              className="px-8 py-4 bg-white text-deep-blue rounded-lg font-bold hover:bg-opacity-90 transition-all shadow-lg transform hover:scale-105"
            >
              Start Timer
            </button>
            <button
              onClick={() => navigate('/doubt')}
              className="px-8 py-4 bg-coral-red text-white rounded-lg font-bold hover:bg-opacity-90 transition-all shadow-lg transform hover:scale-105"
            >
              Get Help
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
