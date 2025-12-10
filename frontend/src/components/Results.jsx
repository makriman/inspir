import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';

export default function Results() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const results = location.state?.results;
  const quizId = location.state?.quizId;
  const isSharedQuiz = location.state?.isSharedQuiz;
  const quizCreator = location.state?.quizCreator;
  const shareToken = location.state?.shareToken;

  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const FRONTEND_URL = 'https://quiz.inspir.uk';

  if (!results) {
    return (
      <div className="min-h-screen bg-purple-gradient flex items-center justify-center">
        <div className="bg-off-white p-8 rounded-2xl shadow-2xl text-center">
          <h2 className="text-2xl font-bold text-deep-blue mb-4">No results found</h2>
          <button
            onClick={() => navigate('/')}
            className="bg-coral-red text-white px-6 py-3 rounded-lg font-semibold hover:bg-opacity-90"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const { score, totalQuestions, percentage, results: questionResults } = results;

  const getScoreColor = () => {
    if (percentage >= 80) return 'text-green-600';
    if (percentage >= 60) return 'text-yellow-600';
    return 'text-coral-red';
  };

  const getScoreMessage = () => {
    if (percentage >= 90) return 'Outstanding! 🎉';
    if (percentage >= 80) return 'Great job! 🌟';
    if (percentage >= 70) return 'Good work! 👍';
    if (percentage >= 60) return 'Not bad! 📚';
    return 'Keep studying! 💪';
  };

  const handleShare = async () => {
    console.log('=== SHARE BUTTON CLICKED ===');
    console.log('User:', user);
    console.log('Quiz ID:', quizId);
    console.log('Is Shared Quiz:', isSharedQuiz);
    console.log('Share Token:', shareToken);

    // If it's a shared quiz (guest or logged-in user taking shared quiz), use the existing share link
    if (isSharedQuiz && shareToken) {
      const url = `${FRONTEND_URL}/shared/${shareToken}`;
      console.log('Using existing share URL:', url);
      setShareUrl(url);
      setShowShareModal(true);
      return;
    }

    // Original quiz owner sharing
    if (!user || !quizId) {
      console.log('ERROR: Missing user or quizId');
      alert('You must be logged in and have completed a saved quiz to share it.');
      return;
    }

    setShareLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      console.log('Token exists:', !!token);

      if (!token) {
        alert('Please log in again to share quizzes.');
        setShareLoading(false);
        return;
      }

      const url = `${API_URL}/quiz/${quizId}/share`;
      console.log('Calling URL:', url);

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
      console.error('=== SHARE ERROR ===');
      console.error('Full error:', error);
      console.error('Error response:', error.response);
      console.error('Error data:', error.response?.data);
      alert(error.response?.data?.error || error.response?.data?.details || 'Failed to share quiz. Please try again.');
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

  const shareViaWhatsApp = () => {
    const message = encodeURIComponent(`Check out this quiz! ${shareUrl}`);
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent('Try this quiz!');
    const body = encodeURIComponent(`I thought you might enjoy this quiz:\n\n${shareUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  return (
    <div className="min-h-screen bg-purple-gradient p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Score Summary */}
        <div className="bg-off-white rounded-2xl shadow-2xl p-8 mb-8 text-center">
          <h1 className="text-4xl font-bold text-deep-blue mb-4">
            Quiz Complete!
          </h1>
          <div className={`text-7xl font-bold mb-4 ${getScoreColor()}`}>
            {percentage}%
          </div>
          <p className="text-2xl text-gray-700 mb-2">
            {score} out of {totalQuestions} correct
          </p>
          <p className="text-xl text-deep-blue font-semibold">
            {getScoreMessage()}
          </p>

          {/* Shared Quiz Message */}
          {isSharedQuiz && !user && (
            <div className="mt-6 bg-white border-2 border-vibrant-purple rounded-lg p-4 shadow-md">
              <p className="text-deep-blue text-center font-bold mb-3 text-lg">
                Want to create your own quizzes?
              </p>
              <button
                onClick={() => navigate('/auth')}
                className="w-full px-6 py-3 bg-coral-red text-white rounded-lg font-bold hover:bg-opacity-90 transition-all transform hover:scale-105 shadow-lg"
              >
                Sign up for free!
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-4 justify-center mt-8">
            <button
              onClick={() => navigate('/')}
              className="px-6 py-3 bg-deep-blue text-white rounded-lg font-semibold hover:bg-opacity-90 transition-all"
            >
              New Quiz
            </button>
            {user && (
              <button
                onClick={() => navigate('/dashboard')}
                className="px-6 py-3 bg-vibrant-yellow text-deep-blue rounded-lg font-semibold hover:bg-opacity-90 transition-all"
              >
                View History
              </button>
            )}
            {(quizId || (isSharedQuiz && shareToken)) && (
              <button
                onClick={handleShare}
                disabled={shareLoading}
                className="px-6 py-3 bg-coral-red text-white rounded-lg font-semibold hover:bg-opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    {shareLoading ? 'Sharing...' : 'Share This Quiz'}
                  </button>
            )}
          </div>
        </div>

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
                Let others test their knowledge!
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

        {/* Detailed Results */}
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-white mb-4">
            Review Your Answers
          </h2>

          {questionResults.map((result, index) => (
            <div
              key={index}
              className={`bg-off-white rounded-xl shadow-lg p-6 border-l-8 ${
                result.isCorrect ? 'border-green-500' : 'border-coral-red'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-deep-blue flex-1">
                  Question {index + 1}: {result.question}
                </h3>
                <span
                  className={`px-4 py-1 rounded-full text-sm font-bold ${
                    result.isCorrect
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-coral-red'
                  }`}
                >
                  {result.isCorrect ? '✓ Correct' : '✗ Incorrect'}
                </span>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="font-semibold text-gray-700">Your Answer: </span>
                  <span className={result.isCorrect ? 'text-green-600' : 'text-coral-red'}>
                    {result.userAnswer || '(No answer provided)'}
                  </span>
                </div>

                {!result.isCorrect && (
                  <div>
                    <span className="font-semibold text-gray-700">Correct Answer: </span>
                    <span className="text-green-600">{result.correctAnswer}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Actions */}
        <div className="mt-8 text-center">
          <button
            onClick={() => navigate('/')}
            className="px-8 py-4 bg-coral-red text-white rounded-lg font-bold text-lg hover:bg-opacity-90 transition-all transform hover:scale-105 shadow-lg"
          >
            Take Another Quiz
          </button>
        </div>
      </div>
    </div>
  );
}
