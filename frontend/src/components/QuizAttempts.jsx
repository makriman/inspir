import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Navigation from './Navigation';
import API_URL from '../utils/api';

const FRONTEND_URL = 'https://quiz.inspir.uk';

export default function QuizAttempts() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [sortBy, setSortBy] = useState('date-desc'); // date-desc, date-asc, score-high, score-low, name-az
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [shareUrl, setShareUrl] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    const fetchAttempts = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const response = await axios.get(`${API_URL}/quiz/${quizId}/attempts`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        setData(response.data);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching quiz attempts:', error);
        if (error.response?.status === 403) {
          setError('You do not have permission to view these attempts.');
        } else if (error.response?.status === 404) {
          setError('Quiz not found.');
        } else {
          setError('Failed to load quiz attempts. Please try again.');
        }
        setLoading(false);
      }
    };

    fetchAttempts();
  }, [quizId, user, navigate]);

  // Sort attempts
  const getSortedAttempts = () => {
    if (!data?.attempts) return [];

    let sorted = [...data.attempts];

    // Filter by search query
    if (searchQuery.trim()) {
      sorted = sorted.filter(attempt =>
        attempt.attemptName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Sort
    switch (sortBy) {
      case 'date-asc':
        sorted.sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
        break;
      case 'date-desc':
        sorted.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
        break;
      case 'score-high':
        sorted.sort((a, b) => b.percentage - a.percentage);
        break;
      case 'score-low':
        sorted.sort((a, b) => a.percentage - b.percentage);
        break;
      case 'name-az':
        sorted.sort((a, b) => a.attemptName.localeCompare(b.attemptName));
        break;
      default:
        break;
    }

    return sorted;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getScoreColor = (percentage) => {
    if (percentage >= 80) return 'text-green-600 bg-green-100';
    if (percentage >= 60) return 'text-yellow-600 bg-yellow-100';
    return 'text-coral-red bg-red-100';
  };

  const handleShare = async () => {
    setShareLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const response = await axios.post(
        `${API_URL}/quiz/${quizId}/share`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      setShareUrl(response.data.shareUrl);
      setShowShareModal(true);
    } catch (error) {
      console.error('Error sharing quiz:', error);
      alert(error.response?.data?.error || 'Failed to share quiz. Please try again.');
    } finally {
      setShareLoading(false);
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

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-grow bg-purple-gradient flex items-center justify-center">
          <div className="bg-off-white p-8 rounded-2xl shadow-2xl text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-coral-red mx-auto mb-4"></div>
            <p className="text-deep-blue text-lg font-semibold">Loading attempts...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-grow bg-purple-gradient flex items-center justify-center p-4">
          <div className="bg-off-white p-8 rounded-2xl shadow-2xl text-center max-w-md">
            <h2 className="text-2xl font-bold text-coral-red mb-4">Error</h2>
            <p className="text-gray-700 mb-6">{error}</p>
            <button
              onClick={() => navigate('/dashboard')}
              className="bg-coral-red text-white px-6 py-3 rounded-lg font-semibold hover:bg-opacity-90"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sortedAttempts = getSortedAttempts();

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navigation />

      <main className="flex-grow p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-vibrant-purple hover:underline mb-4 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Dashboard
            </button>
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-4xl font-bold text-deep-blue mb-2">{data.quizInfo.sourceName}</h1>
                <p className="text-gray-600">View all attempts and performance statistics</p>
              </div>
              <button
                onClick={handleShare}
                disabled={shareLoading}
                className="px-6 py-3 bg-coral-red text-white rounded-lg font-semibold hover:bg-opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                {shareLoading ? 'Sharing...' : 'Share Quiz'}
              </button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow-md p-6 text-center">
              <p className="text-gray-600 text-sm mb-1">Total Attempts</p>
              <p className="text-3xl font-bold text-deep-blue">{data.stats.totalAttempts}</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-6 text-center">
              <p className="text-gray-600 text-sm mb-1">Average Score</p>
              <p className="text-3xl font-bold text-vibrant-purple">{data.stats.averagePercentage}%</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-6 text-center">
              <p className="text-gray-600 text-sm mb-1">Highest Score</p>
              <p className="text-3xl font-bold text-green-600">{data.stats.highestPercentage}%</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-6 text-center">
              <p className="text-gray-600 text-sm mb-1">Lowest Score</p>
              <p className="text-3xl font-bold text-coral-red">{data.stats.lowestPercentage}%</p>
            </div>
          </div>

          {/* Filters and Search */}
          <div className="bg-white rounded-lg shadow-md p-4 mb-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-vibrant-purple"
                />
              </div>
              <div>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full md:w-auto px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-vibrant-purple"
                >
                  <option value="date-desc">Newest First</option>
                  <option value="date-asc">Oldest First</option>
                  <option value="score-high">Highest Score</option>
                  <option value="score-low">Lowest Score</option>
                  <option value="name-az">Name (A-Z)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Attempts List */}
          {sortedAttempts.length === 0 ? (
            <div className="bg-white rounded-lg shadow-md p-12 text-center">
              <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-xl font-bold text-gray-700 mb-2">
                {searchQuery ? 'No matching attempts found' : 'No attempts yet'}
              </h3>
              <p className="text-gray-600 mb-4">
                {searchQuery ? 'Try a different search term' : 'Share this quiz to get started!'}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block bg-white rounded-lg shadow-md overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Score
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Percentage
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Date & Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sortedAttempts.map((attempt) => (
                      <tr key={attempt.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{attempt.attemptName}</span>
                            {attempt.isGuest && (
                              <span className="px-2 py-1 text-xs font-semibold bg-gray-200 text-gray-700 rounded">
                                Guest
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-semibold text-gray-900">
                            {attempt.score}/{attempt.totalQuestions}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 rounded-full text-sm font-bold ${getScoreColor(attempt.percentage)}`}>
                            {attempt.percentage}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {formatDate(attempt.completedAt)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => setSelectedAttempt(attempt)}
                            className="text-vibrant-purple hover:underline font-semibold text-sm"
                          >
                            View Answers
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-4">
                {sortedAttempts.map((attempt) => (
                  <div key={attempt.id} className="bg-white rounded-lg shadow-md p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-bold text-lg text-deep-blue">{attempt.attemptName}</p>
                        {attempt.isGuest && (
                          <span className="inline-block px-2 py-1 text-xs font-semibold bg-gray-200 text-gray-700 rounded mt-1">
                            Guest
                          </span>
                        )}
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm font-bold ${getScoreColor(attempt.percentage)}`}>
                        {attempt.percentage}%
                      </span>
                    </div>

                    <div className="space-y-2 text-sm text-gray-600 mb-3">
                      <p>
                        <span className="font-semibold">Score:</span> {attempt.score}/{attempt.totalQuestions}
                      </p>
                      <p>
                        <span className="font-semibold">Date:</span> {formatDate(attempt.completedAt)}
                      </p>
                    </div>

                    <button
                      onClick={() => setSelectedAttempt(attempt)}
                      className="w-full px-4 py-2 bg-vibrant-purple text-white rounded-lg font-semibold hover:bg-opacity-90 transition-all"
                    >
                      View Answers
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Answer Details Modal */}
      {selectedAttempt && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 my-8">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-deep-blue mb-1">
                  {selectedAttempt.attemptName}'s Answers
                </h2>
                <p className="text-gray-600">
                  Score: {selectedAttempt.score}/{selectedAttempt.totalQuestions} ({selectedAttempt.percentage}%)
                </p>
              </div>
              <button
                onClick={() => setSelectedAttempt(null)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 max-h-96 overflow-y-auto">
              {selectedAttempt.answers.map((answer, index) => (
                <div
                  key={index}
                  className={`border-l-4 p-4 rounded-r-lg ${
                    answer.isCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-semibold text-gray-900 flex-1">
                      Q{index + 1}: {answer.question}
                    </p>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ml-2 ${
                        answer.isCorrect ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'
                      }`}
                    >
                      {answer.isCorrect ? '✓' : '✗'}
                    </span>
                  </div>

                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="font-semibold text-gray-700">Their Answer: </span>
                      <span className={answer.isCorrect ? 'text-green-700' : 'text-red-700'}>
                        {answer.userAnswer || '(No answer)'}
                      </span>
                    </p>
                    {!answer.isCorrect && (
                      <p>
                        <span className="font-semibold text-gray-700">Correct Answer: </span>
                        <span className="text-green-700">{answer.correctAnswer}</span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <button
                onClick={() => setSelectedAttempt(null)}
                className="w-full px-6 py-3 bg-deep-blue text-white rounded-lg font-semibold hover:bg-opacity-90 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-purple-gradient rounded-2xl max-w-md w-full p-8 relative">
            <button
              onClick={() => setShowShareModal(false)}
              className="absolute top-4 right-4 text-white hover:text-gray-300 text-2xl"
            >
              ×
            </button>

            <h2 className="text-3xl font-bold text-white mb-4 text-center">
              Share This Quiz!
            </h2>

            <div className="bg-white rounded-lg p-4 mb-6">
              <label className="text-sm text-gray-600 block mb-2">Share Link:</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={shareUrl}
                  readOnly
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50"
                />
                <button
                  onClick={copyToClipboard}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                    copied
                      ? 'bg-green-500 text-white'
                      : 'bg-coral-red text-white hover:bg-opacity-90'
                  }`}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <p className="text-white text-center text-sm mb-4">
              Anyone with this link can take your quiz!
            </p>

            <button
              onClick={() => setShowShareModal(false)}
              className="w-full px-6 py-3 bg-white text-deep-blue rounded-lg font-semibold hover:bg-gray-100 transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
