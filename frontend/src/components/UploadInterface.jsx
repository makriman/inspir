import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import LoadingScreen from './LoadingScreen';
import Navigation from './Navigation';
import Footer from './Footer';
import API_URL from '../utils/api';

// Cycling placeholder examples
const PLACEHOLDER_EXAMPLES = [
  "A quiz on History for an 8th Grade Student in Germany",
  "Quiz me on Taylor Swift and the history of pop music",
  "Prepare a quiz with my class notes",
  "Test me on Photosynthesis for my Biology exam",
  "Spanish verb conjugations for beginners",
  "World War 2 causes and effects",
  "Python programming basics",
  "Shakespeare's Macbeth themes and characters",
  "Marketing fundamentals for business students",
  "Human anatomy and physiology",
  "Climate change and environmental science",
  "Financial literacy and personal finance",
  "Ancient Roman civilization",
  "Quantum physics concepts",
  "French Revolution key events",
  "Machine learning algorithms",
  "Greek mythology gods and stories",
  "Prepare me for my Chemistry final exam",
  "The Solar System and space exploration",
  "Renaissance art and artists"
];

export default function UploadInterface() {
  const [quizTopic, setQuizTopic] = useState('');
  const [file, setFile] = useState(null);
  const [textContent, setTextContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [showOptionalContext, setShowOptionalContext] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const navigate = useNavigate();
  const { session } = useAuth();

  // Cycle through placeholder examples
  useEffect(() => {
    if (quizTopic.length > 0) return; // Don't cycle if user is typing

    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDER_EXAMPLES.length);
    }, 3500); // Change every 3.5 seconds

    return () => clearInterval(interval);
  }, [quizTopic]);

  if (loading) {
    return <LoadingScreen />;
  }

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange({ target: { files: e.dataTransfer.files } });
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      const validTypes = ['text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      const validExtensions = /\.(txt|docx?)$/i;

      if (!validTypes.includes(selectedFile.type) && !selectedFile.name.match(validExtensions)) {
        setError('Please upload a TXT or DOCX file');
        return;
      }
      if (selectedFile.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB');
        return;
      }
      setFile(selectedFile);
      setError('');

      // Auto-fill topic if empty
      if (!quizTopic) {
        setQuizTopic(selectedFile.name.replace(/\.[^/.]+$/, ''));
      }

      // Auto-expand optional context when file is uploaded
      setShowOptionalContext(true);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate that the main topic is provided
      if (!quizTopic || quizTopic.trim().length === 0) {
        setError('Please tell us what to quiz you on');
        setLoading(false);
        return;
      }

      const formData = new FormData();

      // Add file if provided
      if (file) {
        formData.append('file', file);
      }

      // Add text content if provided
      if (textContent && textContent.trim().length > 0) {
        formData.append('content', textContent);
      }

      formData.append('sourceName', quizTopic);

      const headers = {
        'Content-Type': 'multipart/form-data',
      };

      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await axios.post(`${API_URL}/quiz/generate`, formData, {
        headers,
        timeout: 120000,
      });

      // Navigate to quiz page with generated quiz data
      navigate('/quiz/play', { state: { quizData: response.data } });
    } catch (err) {
      const isTimeout = err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '');
      setError(
        isTimeout
          ? 'Quiz generation is taking longer than expected. Please try again.'
          : (err.response?.data?.error || 'Failed to generate quiz. Please try again.')
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-purple-50 to-blue-50">
      <Navigation />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
          {/* Hero Section */}
          <div className="text-center mb-8 md:mb-12">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-deep-blue mb-4">
              Quiz Me On <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-dark to-coral-red">Anything</span>
            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto">
              Just tell us what to quiz you on – we'll generate great questions instantly
            </p>
            <p className="text-sm md:text-base text-gray-500 mt-2">
              Want better questions? Add your notes or upload documents for context
            </p>
          </div>

          {/* Main Form Card */}
          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-10 border border-gray-100">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-start">
                <svg className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* PRIMARY INPUT - Large Textarea */}
              <div>
                <textarea
                  value={quizTopic}
                  onChange={(e) => setQuizTopic(e.target.value)}
                  placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
                  rows="8"
                  className="w-full px-5 py-4 text-base md:text-lg border-2 border-gray-300 rounded-xl focus:outline-none focus:border-vibrant-purple focus:ring-2 focus:ring-purple-100 transition-all placeholder-gray-400 resize-none"
                  style={{ minHeight: '200px' }}
                  autoFocus
                />
              </div>

              {/* PRIMARY GENERATE BUTTON */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-coral-red to-red-600 text-white py-4 md:py-5 px-8 rounded-xl font-bold text-lg md:text-xl hover:shadow-lg hover:scale-[1.02] transition-all transform disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-md"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin h-6 w-6 mr-3" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Generating Your Quiz...
                  </span>
                ) : (
                  <span className="flex items-center justify-center">
                    <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate Quiz
                  </span>
                )}
              </button>

              {/* OPTIONAL CONTEXT SECTION */}
              <div className="border-t-2 border-gray-200 pt-6">
                <button
                  type="button"
                  onClick={() => setShowOptionalContext(!showOptionalContext)}
                  className="flex items-center justify-between w-full text-left group"
                >
                  <div>
                    <h3 className="text-lg font-semibold text-gray-700 group-hover:text-deep-blue transition-colors">
                      Want better questions? Add your notes or upload documents for context <span className="text-sm font-normal text-gray-500">(Optional)</span>
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Add your notes or upload documents for more targeted questions
                    </p>
                  </div>
                  <svg
                    className={`w-6 h-6 text-gray-400 transition-transform ${showOptionalContext ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showOptionalContext && (
                  <div className="mt-6 space-y-6 animate-fadeIn">
                    {/* Text Area for Notes */}
                    <div>
                      <label className="block text-base font-semibold text-gray-700 mb-2">
                        Paste your notes, readings, or specific content here...
                      </label>
                      <textarea
                        value={textContent}
                        onChange={(e) => setTextContent(e.target.value)}
                        placeholder="Copy and paste any text content here – study notes, textbook chapters, articles, research papers, or any material you want to be quizzed on...

The more context you provide, the more tailored and relevant the questions will be!"
                        className="w-full h-64 px-4 py-3 text-base border-2 border-gray-300 rounded-lg focus:outline-none focus:border-purple-dark focus:ring-2 focus:ring-purple-100 transition-all resize-none placeholder-gray-400"
                      />
                      {textContent && (
                        <p className="text-xs text-gray-500 mt-2">
                          {textContent.length} characters
                        </p>
                      )}
                    </div>

                    {/* File Upload */}
                    <div>
                      <label className="block text-base font-semibold text-gray-700 mb-2">
                        Or upload documents
                      </label>
                      <p className="text-sm text-gray-500 mb-3">
                        Upload your notes, syllabus, or study materials (TXT, DOCX – max 10MB)
                      </p>

                      {file ? (
                        <div className="flex items-center gap-3 bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-300 rounded-lg px-4 py-4">
                          <div className="text-3xl">📄</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-semibold text-deep-blue truncate">
                              {file.name}
                            </p>
                            <p className="text-sm text-gray-600">
                              {(file.size / 1024).toFixed(2)} KB
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setFile(null)}
                            className="text-coral-red hover:text-red-700 font-semibold text-sm transition-colors flex-shrink-0 px-3 py-1 rounded-lg hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div
                          className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
                            dragActive
                              ? 'border-vibrant-yellow bg-yellow-50 scale-[1.02]'
                              : 'border-gray-300 hover:border-purple-dark hover:bg-purple-50'
                          }`}
                          onDragEnter={handleDrag}
                          onDragLeave={handleDrag}
                          onDragOver={handleDrag}
                          onDrop={handleDrop}
                          onClick={() => document.getElementById('file-upload').click()}
                        >
                          <input
                            type="file"
                            id="file-upload"
                            accept=".txt,.docx,.doc"
                            onChange={handleFileChange}
                            className="hidden"
                          />
                          <div className="text-5xl mb-3">📁</div>
                          <p className="text-base text-gray-700 font-semibold mb-1">
                            Click to browse or drag and drop
                          </p>
                          <p className="text-sm text-gray-500">
                            TXT or DOCX files up to 10MB
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Secondary Generate Button (in optional section) */}
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-gradient-to-r from-coral-red to-red-600 text-white py-4 px-8 rounded-xl font-bold text-lg hover:shadow-lg hover:scale-[1.02] transition-all transform disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-md"
                    >
                      {loading ? 'Generating Your Quiz...' : 'Generate Quiz'}
                    </button>
                  </div>
                )}
              </div>

              {/* Helper Text */}
              <div className="text-center pt-4 border-t border-gray-100">
                <p className="text-sm text-gray-600">
                  🎯 We'll create 10 engaging questions to test your understanding
                </p>
              </div>
            </form>
          </div>

          {/* Trust Indicators */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <div className="text-2xl mb-2">⚡</div>
              <h3 className="font-semibold text-deep-blue">Instant Generation</h3>
              <p className="text-sm text-gray-600">Quiz ready in seconds</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <div className="text-2xl mb-2">🤖</div>
              <h3 className="font-semibold text-deep-blue">AI-Powered</h3>
              <p className="text-sm text-gray-600">Smart, contextual questions</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <div className="text-2xl mb-2">📚</div>
              <h3 className="font-semibold text-deep-blue">Any Topic</h3>
              <p className="text-sm text-gray-600">From study notes to fun facts</p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
