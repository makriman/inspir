import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import API_URL from '../utils/api';
import StudyStreaks from './StudyStreaks';

export default function Dashboard() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [shareLoading, setShareLoading] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const { user, session, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    fetchHistory();
  }, [user]);

  const fetchHistory = async () => {
    try {
      const response = await axios.get(`${API_URL}/quiz/history`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      setHistory(response.data);
      setLoading(false);
    } catch (err) {
      setError('Failed to load quiz history');
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const handleShare = async (quizId) => {
    console.log('=== DASHBOARD SHARE CLICKED ===');
    console.log('Quiz ID:', quizId);
    setShareLoading(quizId);
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        alert('Please log in again to share quizzes.');
        setShareLoading(null);
        return;
      }

      const url = `${API_URL}/quiz/${quizId}/share`;
      console.log('Share URL:', url);

      const response = await axios.post(
        url,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      console.log('Share response:', response.data);
      setShareUrl(response.data.shareUrl);
      setShowShareModal(true);
    } catch (error) {
      console.error('=== DASHBOARD SHARE ERROR ===');
      console.error('Error:', error);
      console.error('Error response:', error.response?.data);
      alert(error.response?.data?.error || 'Failed to share quiz. Please try again.');
    } finally {
      setShareLoading(null);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const shareViaWhatsApp = () => {
    const message = encodeURIComponent(`Check out this quiz! ${shareUrl}`);
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent('Try this quiz!');
    const body = encodeURIComponent(`I thought you might enjoy this quiz:\n\n${shareUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const sortedHistory = [...history].sort((a, b) => {
    switch (sortBy) {
      case 'date':
        return new Date(b.submitted_at) - new Date(a.submitted_at);
      case 'score':
        return b.percentage - a.percentage;
      case 'name':
        return (a.quizzes?.source_name || '').localeCompare(b.quizzes?.source_name || '');
      default:
        return 0;
    }
  });

  const averageScore = history.length > 0
    ? Math.round(history.reduce((sum, h) => sum + h.percentage, 0) / history.length)
    : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-purple-gradient flex items-center justify-center">
        <div className="text-white text-2xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-purple-gradient p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 sm:mb-8 gap-4">
          <div className="w-full sm:w-auto">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-2">
              Your Dashboard
            </h1>
            <p className="text-vibrant-yellow text-base sm:text-lg">
              Welcome back, {user?.username || 'User'}!
            </p>
          </div>
          <div className="flex gap-2 sm:gap-3 w-full sm:w-auto">
            <button
              onClick={() => navigate('/')}
              className="flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-3 bg-vibrant-yellow text-deep-blue rounded-lg font-semibold hover:bg-opacity-90 transition-all text-sm sm:text-base"
            >
              New Quiz
            </button>
            <button
              onClick={handleSignOut}
              className="flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-3 bg-white text-deep-blue rounded-lg font-semibold hover:bg-opacity-90 transition-all text-sm sm:text-base"
            >
              Sign Out
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-coral-red bg-opacity-10 border border-coral-red text-white px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <div className="bg-off-white rounded-xl shadow-lg p-4 sm:p-6">
            <p className="text-gray-600 text-xs sm:text-sm font-semibold mb-1 sm:mb-2">Total Quizzes</p>
            <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-deep-blue">{history.length}</p>
          </div>
          <div className="bg-off-white rounded-xl shadow-lg p-4 sm:p-6">
            <p className="text-gray-600 text-xs sm:text-sm font-semibold mb-1 sm:mb-2">Average Score</p>
            <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-deep-blue">{averageScore}%</p>
          </div>
          <div className="bg-off-white rounded-xl shadow-lg p-4 sm:p-6">
            <p className="text-gray-600 text-xs sm:text-sm font-semibold mb-1 sm:mb-2">Best Score</p>
            <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-deep-blue">
              {history.length > 0 ? Math.max(...history.map(h => h.percentage)) : 0}%
            </p>
          </div>
          {/* Study Streak Card */}
          <div>
            <StudyStreaks compact={true} />
          </div>
        </div>

        {/* Quiz History */}
        <div className="bg-off-white rounded-2xl shadow-2xl p-4 sm:p-6 md:p-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 gap-3">
            <h2 className="text-xl sm:text-2xl font-bold text-deep-blue">Quiz History</h2>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <label className="text-xs sm:text-sm font-medium text-gray-700">Sort by:</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="flex-1 sm:flex-none px-3 sm:px-4 py-1.5 sm:py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-deep-blue text-sm"
              >
                <option value="date">Date</option>
                <option value="score">Score</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>

          {sortedHistory.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">📝</div>
              <p className="text-gray-600 text-lg mb-4">No quizzes taken yet</p>
              <button
                onClick={() => navigate('/')}
                className="px-6 py-3 bg-coral-red text-white rounded-lg font-semibold hover:bg-opacity-90"
              >
                Take Your First Quiz
              </button>
            </div>
          ) : (
            <div className="space-y-3 sm:space-y-4">
              {sortedHistory.map((item) => (
                <div
                  key={item.id}
                  className="border-2 border-gray-200 rounded-lg p-4 sm:p-6 hover:border-deep-blue transition-all"
                >
                  <div className="flex flex-col sm:flex-row justify-between items-start mb-3 sm:mb-4 gap-3">
                    <div className="flex-1 w-full sm:w-auto">
                      <h3 className="text-base sm:text-lg font-bold text-deep-blue mb-1 sm:mb-2">
                        {item.quizzes?.source_name || 'Untitled Quiz'}
                      </h3>
                      <p className="text-xs sm:text-sm text-gray-600">
                        {new Date(item.submitted_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <div className={`text-2xl sm:text-3xl font-bold mb-1 ${
                        item.percentage >= 80 ? 'text-green-600' :
                        item.percentage >= 60 ? 'text-yellow-600' :
                        'text-coral-red'
                      }`}>
                        {item.percentage}%
                      </div>
                      <p className="text-xs sm:text-sm text-gray-600">
                        {item.score}/{item.total_questions} correct
                      </p>
                    </div>
                  </div>

                  {/* Performance bar */}
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-3 sm:mb-4">
                    <div
                      className={`h-2 rounded-full ${
                        item.percentage >= 80 ? 'bg-green-500' :
                        item.percentage >= 60 ? 'bg-yellow-500' :
                        'bg-coral-red'
                      }`}
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>

                  {/* Action Buttons */}
                  {item.quiz_id && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        onClick={() => navigate(`/quiz/${item.quiz_id}/review`)}
                        className="px-3 py-2 bg-deep-blue text-white rounded-lg font-semibold hover:bg-opacity-90 transition-all flex items-center justify-center gap-1 text-xs sm:text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        Review
                      </button>
                      <button
                        onClick={() => navigate(`/quiz/${item.quiz_id}/attempts`)}
                        className="px-3 py-2 bg-vibrant-yellow text-deep-blue rounded-lg font-bold hover:bg-opacity-90 transition-all flex items-center justify-center gap-1 text-xs sm:text-sm shadow-md"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        Attempts
                      </button>
                      <button
                        onClick={() => handleShare(item.quiz_id)}
                        disabled={shareLoading === item.quiz_id}
                        className="px-3 py-2 bg-coral-red text-white rounded-lg font-semibold hover:bg-opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-1 text-xs sm:text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                        {shareLoading === item.quiz_id ? '...' : 'Share'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Share Modal */}
        {showShareModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-purple-gradient rounded-2xl max-w-md w-full p-6 sm:p-8 relative max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowShareModal(false)}
                className="absolute top-3 right-3 sm:top-4 sm:right-4 text-white hover:text-gray-300 text-2xl"
              >
                ×
              </button>

              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4 text-center pr-8">
                Share This Quiz!
              </h2>

              <div className="bg-white rounded-lg p-3 sm:p-4 mb-4 sm:mb-6">
                <label className="text-xs sm:text-sm text-gray-600 block mb-2">Share Link:</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-gray-50"
                  />
                  <button
                    onClick={copyToClipboard}
                    className={`px-4 py-2 rounded-lg font-semibold transition-all text-sm ${
                      copied
                        ? 'bg-green-500 text-white'
                        : 'bg-coral-red text-white hover:bg-opacity-90'
                    }`}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-white text-center text-sm mb-4">
                  Anyone with this link can take your quiz!
                </p>

                <button
                  onClick={shareViaWhatsApp}
                  className="w-full px-6 py-3 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Share via WhatsApp
                </button>

                <button
                  onClick={shareViaEmail}
                  className="w-full px-6 py-3 bg-deep-blue text-white rounded-lg font-semibold hover:bg-opacity-90 transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Share via Email
                </button>

                <button
                  onClick={() => setShowShareModal(false)}
                  className="w-full px-6 py-3 bg-white text-deep-blue rounded-lg font-semibold hover:bg-gray-100 transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
