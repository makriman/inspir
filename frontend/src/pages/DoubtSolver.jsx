import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';

const API_URL = import.meta.env.VITE_API_URL;

export default function DoubtSolver() {
  const { user } = useAuth();
  const { shareToken } = useParams();
  const navigate = useNavigate();

  // Tab state
  const [activeTab, setActiveTab] = useState('type'); // 'type' or 'upload'

  // Form state
  const [questionText, setQuestionText] = useState('');
  const [subject, setSubject] = useState('Auto-detect');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  // OCR state
  const [extractedText, setExtractedText] = useState('');
  const [showExtracted, setShowExtracted] = useState(false);

  // Solution state
  const [solution, setSolution] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // History state
  const [doubtHistory, setDoubtHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [recentSolutions, setRecentSolutions] = useState([]);

  // Subject options
  const subjects = [
    'Auto-detect',
    'Mathematics',
    'Physics',
    'Chemistry',
    'Biology',
    'English',
    'History',
    'Geography',
    'Computer Science',
    'Other'
  ];

  // Load recent solutions on mount
  useEffect(() => {
    loadRecentSolutions();
  }, []);

  // Load doubt history if user is authenticated
  useEffect(() => {
    if (user && showHistory) {
      loadHistory();
    }
  }, [user, showHistory]);

  // Load shared doubt if shareToken is present
  useEffect(() => {
    if (shareToken) {
      loadSharedDoubt();
    }
  }, [shareToken]);

  const loadRecentSolutions = async () => {
    try {
      const response = await axios.get(`${API_URL}/doubt/recent?limit=3`);
      setRecentSolutions(response.data.solutions || []);
    } catch (err) {
      console.error('Error loading recent solutions:', err);
    }
  };

  const loadHistory = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/doubt/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDoubtHistory(response.data.doubts || []);
    } catch (err) {
      console.error('Error loading history:', err);
    }
  };

  const loadSharedDoubt = async () => {
    try {
      const response = await axios.get(`${API_URL}/doubt/shared/${shareToken}`);
      setSolution(response.data);
    } catch (err) {
      setError('Failed to load shared doubt');
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('Image size must be less than 10MB');
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file');
      return;
    }

    setImageFile(file);
    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const analyzeImage = async () => {
    if (!imageFile) {
      setError('Please upload an image first');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Image = reader.result;

        const response = await axios.post(`${API_URL}/doubt/upload-image`, {
          imageBase64: base64Image
        });

        setExtractedText(response.data.extracted_text);
        setSubject(response.data.detected_subject || 'Auto-detect');
        setShowExtracted(true);
      };
      reader.readAsDataURL(imageFile);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to analyze image');
    } finally {
      setLoading(false);
    }
  };

  const getSolution = async (isFromExtracted = false) => {
    const finalQuestionText = isFromExtracted ? extractedText : questionText;

    if (!finalQuestionText || finalQuestionText.trim().length < 5) {
      setError('Please provide a question with at least 5 characters');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await axios.post(
        `${API_URL}/doubt/solve`,
        {
          question_text: finalQuestionText,
          subject: subject === 'Auto-detect' ? null : subject,
          source_type: isFromExtracted ? 'image' : 'text',
          extracted_text: isFromExtracted ? extractedText : null
        },
        { headers }
      );

      setSolution(response.data);
      setShowExtracted(false);

      if (user && showHistory) {
        loadHistory();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate solution');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!solution) return;

    const text = `Question: ${solution.question_text || questionText}\n\nSolution:\n${solution.solution}\n\nKey Concepts:\n${solution.key_concepts?.join(', ') || 'N/A'}`;

    navigator.clipboard.writeText(text);
    alert('Solution copied to clipboard!');
  };

  const shareDoubt = async () => {
    if (!solution || !solution.doubtId) {
      setError('Cannot share unsaved doubt. Please login to save and share.');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_URL}/doubt/${solution.doubtId}/share`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const shareUrl = response.data.share_url;
      navigator.clipboard.writeText(shareUrl);
      alert('Share link copied to clipboard!');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create share link');
    }
  };

  const resetForm = () => {
    setQuestionText('');
    setSubject('Auto-detect');
    setImageFile(null);
    setImagePreview(null);
    setExtractedText('');
    setShowExtracted(false);
    setSolution(null);
    setError(null);
  };

  const deleteDoubt = async (id) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/doubt/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadHistory();
    } catch (err) {
      console.error('Error deleting doubt:', err);
    }
  };

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-purple-gradient py-12 px-4">
        <div className="max-w-6xl mx-auto">
          {/* Hero Section */}
          {!solution && !showExtracted && (
            <>
              <div className="text-center mb-12">
                <div className="text-6xl mb-4">🤔</div>
                <h1 className="text-5xl font-bold text-white mb-4">Doubt Solver</h1>
                <p className="text-xl text-white/90">
                  Get step-by-step solutions to any homework question
                </p>
              </div>

              {/* Tab Interface */}
              <div className="bg-white rounded-2xl shadow-2xl p-8 mb-8">
                <div className="flex gap-4 mb-6 border-b border-gray-200">
                  <button
                    onClick={() => setActiveTab('type')}
                    className={`px-6 py-3 font-semibold transition-colors ${
                      activeTab === 'type'
                        ? 'text-purple-600 border-b-2 border-purple-600'
                        : 'text-gray-500 hover:text-purple-600'
                    }`}
                  >
                    Type Question
                  </button>
                  <button
                    onClick={() => setActiveTab('upload')}
                    className={`px-6 py-3 font-semibold transition-colors ${
                      activeTab === 'upload'
                        ? 'text-purple-600 border-b-2 border-purple-600'
                        : 'text-gray-500 hover:text-purple-600'
                    }`}
                  >
                    Upload Image
                  </button>
                </div>

                {error && (
                  <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
                    {error}
                  </div>
                )}

                {/* Type Question Tab */}
                {activeTab === 'type' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-gray-700 font-semibold mb-2">
                        Subject
                      </label>
                      <select
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      >
                        {subjects.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-2">
                        Your Question
                      </label>
                      <textarea
                        value={questionText}
                        onChange={(e) => setQuestionText(e.target.value)}
                        placeholder="Type your question here... e.g., 'Solve x² + 5x + 6 = 0'"
                        className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                        rows={8}
                      />
                    </div>

                    <button
                      onClick={() => getSolution(false)}
                      disabled={loading || !questionText.trim()}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-8 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Getting Solution...' : 'Get Solution'}
                    </button>
                  </div>
                )}

                {/* Upload Image Tab */}
                {activeTab === 'upload' && (
                  <div className="space-y-4">
                    <div
                      className="border-4 border-dashed border-purple-300 rounded-lg p-12 text-center hover:border-purple-500 transition-colors cursor-pointer"
                      onClick={() => document.getElementById('imageUpload').click()}
                    >
                      <input
                        id="imageUpload"
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      {imagePreview ? (
                        <div>
                          <img
                            src={imagePreview}
                            alt="Preview"
                            className="max-h-64 mx-auto rounded-lg shadow-lg mb-4"
                          />
                          <p className="text-green-600 font-semibold">
                            Image uploaded! Click to change
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="text-6xl mb-4">📷</div>
                          <p className="text-xl font-semibold text-gray-700 mb-2">
                            Upload a photo of your question
                          </p>
                          <p className="text-gray-500">
                            Supports handwritten, printed, and textbook questions
                          </p>
                          <p className="text-sm text-gray-400 mt-2">
                            JPG, PNG, HEIC (max 10MB)
                          </p>
                        </>
                      )}
                    </div>

                    <button
                      onClick={analyzeImage}
                      disabled={loading || !imageFile}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-8 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Analyzing...' : 'Analyze Question'}
                    </button>
                  </div>
                )}
              </div>

              {/* Popular Subjects */}
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8">
                <h3 className="text-white font-semibold mb-3">Popular subjects:</h3>
                <div className="flex flex-wrap gap-2">
                  {['Math', 'Physics', 'Chemistry', 'Biology'].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setSubject(s === 'Math' ? 'Mathematics' : s);
                        setActiveTab('type');
                      }}
                      className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recently Solved */}
              {recentSolutions.length > 0 && (
                <div className="bg-white rounded-xl p-6 shadow-lg">
                  <h3 className="text-xl font-bold text-gray-800 mb-4">Recently solved</h3>
                  <div className="space-y-3">
                    {recentSolutions.map((sol) => (
                      <div
                        key={sol.id}
                        className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                        onClick={() => navigate(`/doubt/shared/${sol.id}`)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-gray-800 font-medium line-clamp-2">
                              {sol.question_text}
                            </p>
                            <div className="flex items-center gap-3 mt-2">
                              {sol.subject && (
                                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                                  {sol.subject}
                                </span>
                              )}
                              {sol.estimated_difficulty && (
                                <span className="text-xs text-gray-500">
                                  {sol.estimated_difficulty}
                                </span>
                              )}
                            </div>
                          </div>
                          <button className="text-purple-600 hover:text-purple-700 font-semibold text-sm">
                            View →
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* User History Button */}
              {user && (
                <div className="mt-6 text-center">
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="bg-white/20 hover:bg-white/30 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
                  >
                    {showHistory ? 'Hide My Doubts' : 'Show My Doubts'}
                  </button>
                </div>
              )}

              {/* User History */}
              {user && showHistory && (
                <div className="mt-6 bg-white rounded-xl p-6 shadow-lg">
                  <h3 className="text-xl font-bold text-gray-800 mb-4">My Solved Doubts</h3>
                  {doubtHistory.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">
                      No doubts solved yet. Start solving above!
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {doubtHistory.map((doubt) => (
                        <div
                          key={doubt.id}
                          className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-gray-800 font-medium">
                                {doubt.question_text.substring(0, 100)}
                                {doubt.question_text.length > 100 ? '...' : ''}
                              </p>
                              <div className="flex items-center gap-3 mt-2">
                                {doubt.subject && (
                                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                                    {doubt.subject}
                                  </span>
                                )}
                                <span className="text-xs text-gray-500">
                                  {new Date(doubt.created_at).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setSolution(doubt);
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="text-purple-600 hover:text-purple-700 font-semibold text-sm"
                              >
                                View
                              </button>
                              <button
                                onClick={() => deleteDoubt(doubt.id)}
                                className="text-red-600 hover:text-red-700 font-semibold text-sm"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Extracted Text View */}
          {showExtracted && !solution && (
            <div className="bg-white rounded-2xl shadow-2xl p-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">Extracted Question</h2>

              <div className="mb-6">
                <label className="block text-gray-700 font-semibold mb-2">
                  Extracted Text (edit if needed)
                </label>
                <textarea
                  value={extractedText}
                  onChange={(e) => setExtractedText(e.target.value)}
                  className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  rows={6}
                />
              </div>

              <div className="mb-6">
                <label className="block text-gray-700 font-semibold mb-2">Subject</label>
                <select
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  {subjects.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => getSolution(true)}
                  disabled={loading}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-8 rounded-lg transition-colors disabled:bg-gray-400"
                >
                  {loading ? 'Getting Solution...' : 'Confirm & Get Solution'}
                </button>
                <button
                  onClick={resetForm}
                  className="px-6 py-4 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Solution Display */}
          {solution && (
            <div className="space-y-6">
              {/* Question Card */}
              <div className="bg-white rounded-2xl shadow-xl p-8">
                <div className="flex items-start gap-4">
                  <div className="text-4xl">📝</div>
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Question</h2>
                    <p className="text-gray-700 text-lg leading-relaxed whitespace-pre-wrap">
                      {solution.question_text || questionText}
                    </p>
                    {(solution.subject || subject !== 'Auto-detect') && (
                      <div className="mt-4">
                        <span className="bg-purple-100 text-purple-700 px-4 py-2 rounded-lg font-semibold">
                          {solution.subject || subject}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Solution Card */}
              <div className="bg-white rounded-2xl shadow-xl p-8">
                <div className="flex items-start gap-4 mb-6">
                  <div className="text-4xl">💡</div>
                  <h2 className="text-2xl font-bold text-gray-800">Step-by-Step Solution</h2>
                </div>

                {/* Steps */}
                {solution.solution_steps && solution.solution_steps.length > 0 ? (
                  <div className="space-y-4 mb-6">
                    {solution.solution_steps.map((step, index) => (
                      <div key={index} className="pl-4 border-l-4 border-purple-400">
                        <p className="text-gray-700 leading-relaxed">{step}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mb-6">
                    <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                      {solution.solution}
                    </p>
                  </div>
                )}

                {/* Key Concepts */}
                {solution.key_concepts && solution.key_concepts.length > 0 && (
                  <div className="mt-8 p-6 bg-purple-50 rounded-lg">
                    <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                      <span>📚</span> Key Concepts:
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {solution.key_concepts.map((concept, index) => (
                        <span
                          key={index}
                          className="bg-white px-4 py-2 rounded-lg text-gray-700 font-medium shadow-sm"
                        >
                          {concept}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Difficulty Badge */}
                {solution.estimated_difficulty && (
                  <div className="mt-4">
                    <span
                      className={`px-4 py-2 rounded-lg font-semibold ${
                        solution.estimated_difficulty === 'Easy'
                          ? 'bg-green-100 text-green-700'
                          : solution.estimated_difficulty === 'Medium'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      Difficulty: {solution.estimated_difficulty}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="bg-white rounded-2xl shadow-xl p-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-lg transition-colors"
                  >
                    <span>📋</span> Copy
                  </button>
                  {user && solution.doubtId && (
                    <button
                      onClick={shareDoubt}
                      className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-lg transition-colors"
                    >
                      <span>🔗</span> Share
                    </button>
                  )}
                  <button
                    onClick={resetForm}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors col-span-2"
                  >
                    <span>🔄</span> Ask Another
                  </button>
                </div>
                {!user && (
                  <p className="mt-4 text-sm text-gray-500 text-center">
                    Sign in to save your doubts and share solutions
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
              <div className="animate-spin text-6xl mb-4">⏳</div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">
                {activeTab === 'upload' && !showExtracted
                  ? 'Analyzing your question...'
                  : 'Generating solution...'}
              </h3>
              <p className="text-gray-600">This usually takes 10-20 seconds</p>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
}
