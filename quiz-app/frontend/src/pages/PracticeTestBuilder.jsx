import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

export default function PracticeTestBuilder() {
  const navigate = useNavigate();
  const { testId } = useParams();
  const { user } = useAuth();

  // View state
  const [view, setView] = useState('home'); // 'home', 'generate', 'banks', 'tests', 'take-test', 'results'

  // Generation state
  const [inputMethod, setInputMethod] = useState('file');
  const [file, setFile] = useState(null);
  const [textContent, setTextContent] = useState('');
  const [testTitle, setTestTitle] = useState('');
  const [numQuestions, setNumQuestions] = useState(20);
  const [questionTypes, setQuestionTypes] = useState({
    mcq: true,
    short_answer: true,
    essay: false,
  });

  // Question banks state
  const [questionBanks, setQuestionBanks] = useState([]);

  // Tests state
  const [tests, setTests] = useState([]);
  const [currentTest, setCurrentTest] = useState(null);

  // Test taking state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [testStartTime, setTestStartTime] = useState(null);

  // Results state
  const [testResults, setTestResults] = useState(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load tests on mount if user is logged in
  useEffect(() => {
    if (user) {
      loadTests();
    }
  }, [user]);

  // Timer effect
  useEffect(() => {
    if (view === 'take-test' && currentTest?.timeLimit && timeRemaining > 0) {
      const timer = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            handleSubmitTest();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [view, currentTest, timeRemaining]);

  const loadTests = async () => {
    try {
      const response = await axios.get('/api/practice-tests/tests');
      setTests(response.data.tests || []);
    } catch (err) {
      console.error('Error loading tests:', err);
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleGenerate = async () => {
    setError(null);

    // Validation
    if (inputMethod === 'file' && !file) {
      setError('Please select a file to generate questions from');
      return;
    }

    if (inputMethod === 'text' && !textContent.trim()) {
      setError('Please enter some text to generate questions from');
      return;
    }

    if (!testTitle.trim()) {
      setError('Please provide a title for your practice test');
      return;
    }

    const hasAtLeastOneType = Object.values(questionTypes).some((v) => v);
    if (!hasAtLeastOneType) {
      setError('Please select at least one question type');
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();

      if (inputMethod === 'file') {
        formData.append('file', file);
      } else {
        formData.append('content', textContent);
      }

      formData.append('title', testTitle);
      formData.append('numQuestions', numQuestions);
      formData.append('questionTypes', JSON.stringify(questionTypes));

      const response = await axios.post('/api/practice-tests/generate', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Create test from generated questions
      const test = response.data.test;
      setCurrentTest(test);
      await loadTests();
      setView('tests');

    } catch (err) {
      console.error('Error generating test:', err);
      setError(err.response?.data?.error || 'Failed to generate practice test. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartTest = (test) => {
    setCurrentTest(test);
    setCurrentQuestionIndex(0);
    setAnswers({});
    setTestStartTime(Date.now());

    // Set timer if test has time limit
    if (test.timeLimit) {
      setTimeRemaining(test.timeLimit * 60); // Convert minutes to seconds
    } else {
      setTimeRemaining(null);
    }

    setView('take-test');
  };

  const handleAnswerChange = (questionId, answer) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: answer,
    }));
  };

  const handleSubmitTest = async () => {
    if (!currentTest || !user) {
      setError('You must be logged in to submit a test');
      return;
    }

    setLoading(true);

    try {
      const response = await axios.post(`/api/practice-tests/tests/${currentTest.id}/submit`, {
        answers,
        timeSpent: Math.floor((Date.now() - testStartTime) / 1000),
      });

      setTestResults(response.data.results);
      setView('results');
      await loadTests();

    } catch (err) {
      console.error('Error submitting test:', err);
      setError(err.response?.data?.error || 'Failed to submit test');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTest = async (id) => {
    if (!confirm('Are you sure you want to delete this test?')) return;

    try {
      await axios.delete(`/api/practice-tests/tests/${id}`);
      await loadTests();
      if (currentTest?.id === id) {
        setCurrentTest(null);
        setView('home');
      }
    } catch (err) {
      console.error('Error deleting test:', err);
      setError('Failed to delete test');
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentQuestion = currentTest?.questions?.[currentQuestionIndex];
  const progress = currentTest?.questions ? ((currentQuestionIndex + 1) / currentTest.questions.length) * 100 : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block bg-rose-100 rounded-full px-4 py-2 mb-4">
            <span className="text-rose-700 font-semibold text-sm">AI-Powered Assessment</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Practice Test Builder
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Create custom practice tests from any content. Get instant AI grading and detailed feedback.
          </p>
        </div>

        {/* Home View */}
        {view === 'home' && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <button
                onClick={() => setView('generate')}
                className="bg-white rounded-2xl shadow-xl p-8 text-left hover:shadow-2xl transition-all group"
              >
                <div className="text-4xl mb-4">📝</div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Generate New Test</h3>
                <p className="text-gray-600">
                  Upload study materials and let AI create a custom practice test for you
                </p>
              </button>

              {user && (
                <button
                  onClick={() => setView('tests')}
                  className="bg-white rounded-2xl shadow-xl p-8 text-left hover:shadow-2xl transition-all group"
                >
                  <div className="text-4xl mb-4">📚</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">My Tests ({tests.length})</h3>
                  <p className="text-gray-600">
                    View and take your saved practice tests, track your progress
                  </p>
                </button>
              )}
            </div>

            {!user && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
                <p className="text-blue-900 mb-3">Sign in to save your tests and track your progress</p>
                <button
                  onClick={() => navigate('/auth')}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-all"
                >
                  Sign In
                </button>
              </div>
            )}
          </div>
        )}

        {/* Generate View */}
        {view === 'generate' && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <button
              onClick={() => setView('home')}
              className="mb-6 text-gray-600 hover:text-gray-900 flex items-center gap-2"
            >
              ← Back
            </button>

            {/* Input Method Selector */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Input Method
              </label>
              <div className="flex gap-4">
                <button
                  onClick={() => setInputMethod('file')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'file'
                      ? 'bg-rose-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Upload File
                </button>
                <button
                  onClick={() => setInputMethod('text')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'text'
                      ? 'bg-rose-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Paste Text
                </button>
              </div>
            </div>

            {/* File Upload */}
            {inputMethod === 'file' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Upload Study Material
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-rose-400 transition-colors">
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept=".pdf,.docx,.txt"
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    {file ? (
                      <div className="text-rose-600">
                        <p className="font-medium text-lg">{file.name}</p>
                        <p className="text-sm text-gray-500 mt-1">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-gray-600 mb-2">Click to upload or drag and drop</p>
                        <p className="text-sm text-gray-400">PDF, DOCX, or TXT (max 10MB)</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>
            )}

            {/* Text Input */}
            {inputMethod === 'text' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Study Material
                </label>
                <textarea
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder="Paste your study notes, textbook content, or lecture materials..."
                  className="w-full h-64 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-rose-500 focus:outline-none resize-none"
                />
              </div>
            )}

            {/* Test Title */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Test Title *
              </label>
              <input
                type="text"
                value={testTitle}
                onChange={(e) => setTestTitle(e.target.value)}
                placeholder="e.g., Chapter 7 Practice Test"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-rose-500 focus:outline-none"
              />
            </div>

            {/* Number of Questions */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Number of Questions: {numQuestions}
              </label>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={numQuestions}
                onChange={(e) => setNumQuestions(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-sm text-gray-500 mt-1">
                <span>5 questions</span>
                <span>50 questions</span>
              </div>
            </div>

            {/* Question Types */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Question Types
              </label>
              <div className="space-y-3">
                <label className="flex items-center p-4 rounded-lg border-2 border-gray-200 cursor-pointer hover:border-rose-300">
                  <input
                    type="checkbox"
                    checked={questionTypes.mcq}
                    onChange={(e) => setQuestionTypes({ ...questionTypes, mcq: e.target.checked })}
                    className="w-5 h-5 text-rose-600 rounded"
                  />
                  <div className="ml-3">
                    <div className="font-medium text-gray-900">Multiple Choice</div>
                    <div className="text-sm text-gray-500">Quick assessment with 4 options</div>
                  </div>
                </label>
                <label className="flex items-center p-4 rounded-lg border-2 border-gray-200 cursor-pointer hover:border-rose-300">
                  <input
                    type="checkbox"
                    checked={questionTypes.short_answer}
                    onChange={(e) => setQuestionTypes({ ...questionTypes, short_answer: e.target.checked })}
                    className="w-5 h-5 text-rose-600 rounded"
                  />
                  <div className="ml-3">
                    <div className="font-medium text-gray-900">Short Answer</div>
                    <div className="text-sm text-gray-500">Brief written responses (1-3 sentences)</div>
                  </div>
                </label>
                <label className="flex items-center p-4 rounded-lg border-2 border-gray-200 cursor-pointer hover:border-rose-300">
                  <input
                    type="checkbox"
                    checked={questionTypes.essay}
                    onChange={(e) => setQuestionTypes({ ...questionTypes, essay: e.target.checked })}
                    className="w-5 h-5 text-rose-600 rounded"
                  />
                  <div className="ml-3">
                    <div className="font-medium text-gray-900">Essay</div>
                    <div className="text-sm text-gray-500">Extended responses with AI grading</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full bg-gradient-to-r from-rose-600 to-pink-600 text-white py-4 px-6 rounded-lg font-semibold text-lg hover:from-rose-700 hover:to-pink-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating Test...
                </span>
              ) : (
                'Generate Practice Test'
              )}
            </button>
          </div>
        )}

        {/* Tests Library View */}
        {view === 'tests' && user && (
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={() => setView('home')}
                className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
              >
                ← Back
              </button>
            </div>

            {tests.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
                <p className="text-gray-500 text-lg mb-4">No practice tests yet</p>
                <button
                  onClick={() => setView('generate')}
                  className="bg-rose-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-rose-700 transition-all"
                >
                  Create Your First Test
                </button>
              </div>
            ) : (
              tests.map((test) => (
                <div key={test.id} className="bg-white rounded-2xl shadow-xl p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-2xl font-bold text-gray-900 mb-2">{test.title}</h3>
                      <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                        <span>{test.question_count || test.questions?.length || 0} questions</span>
                        {test.timeLimit && (
                          <>
                            <span>•</span>
                            <span>{test.timeLimit} minutes</span>
                          </>
                        )}
                        <span>•</span>
                        <span>Created {new Date(test.created_at).toLocaleDateString()}</span>
                      </div>

                      {test.lastAttempt && (
                        <div className="p-3 bg-blue-50 rounded-lg mb-4">
                          <div className="text-sm text-blue-900">
                            Last Score: <span className="font-bold">{test.lastAttempt.score}%</span>
                            {' • '}
                            Attempted {new Date(test.lastAttempt.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-3">
                        <button
                          onClick={() => handleStartTest(test)}
                          className="px-6 py-2 bg-rose-600 text-white rounded-lg font-semibold hover:bg-rose-700 transition-all"
                        >
                          {test.lastAttempt ? 'Retake Test' : 'Start Test'}
                        </button>
                        <button
                          onClick={() => handleDeleteTest(test.id)}
                          className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-all"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Take Test View */}
        {view === 'take-test' && currentTest && currentQuestion && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            {/* Progress Header */}
            <div className="mb-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-900">{currentTest.title}</h2>
                {timeRemaining !== null && (
                  <div className={`text-2xl font-bold ${timeRemaining < 300 ? 'text-red-600' : 'text-gray-700'}`}>
                    ⏱ {formatTime(timeRemaining)}
                  </div>
                )}
              </div>

              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>Question {currentQuestionIndex + 1} of {currentTest.questions.length}</span>
                <span>{Math.round(progress)}% Complete</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-rose-600 to-pink-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Question Display */}
            <div className="mb-8">
              <div className="mb-2 flex items-center gap-3">
                <span className="px-3 py-1 bg-rose-100 text-rose-700 text-sm font-medium rounded-full">
                  {currentQuestion.type.replace('_', ' ').toUpperCase()}
                </span>
                <span className="text-sm text-gray-500">
                  {currentQuestion.points} point{currentQuestion.points > 1 ? 's' : ''}
                </span>
              </div>

              <div className="text-xl font-medium text-gray-900 mb-6">
                {currentQuestion.questionText}
              </div>

              {/* MCQ Options */}
              {currentQuestion.type === 'mcq' && (
                <div className="space-y-3">
                  {currentQuestion.options.map((option, index) => (
                    <label
                      key={index}
                      className={`flex items-center p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        answers[currentQuestion.id] === option
                          ? 'border-rose-500 bg-rose-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`question-${currentQuestion.id}`}
                        value={option}
                        checked={answers[currentQuestion.id] === option}
                        onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value)}
                        className="mr-3"
                      />
                      <span className="text-gray-900">{option}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* Short Answer / Essay */}
              {(currentQuestion.type === 'short_answer' || currentQuestion.type === 'essay') && (
                <textarea
                  value={answers[currentQuestion.id] || ''}
                  onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value)}
                  placeholder={
                    currentQuestion.type === 'essay'
                      ? 'Write your detailed response here...'
                      : 'Write your answer here (1-3 sentences)...'
                  }
                  className={`w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-rose-500 focus:outline-none resize-none ${
                    currentQuestion.type === 'essay' ? 'h-64' : 'h-32'
                  }`}
                />
              )}
            </div>

            {/* Navigation Buttons */}
            <div className="flex justify-between">
              <button
                onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
                disabled={currentQuestionIndex === 0}
                className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>

              {currentQuestionIndex < currentTest.questions.length - 1 ? (
                <button
                  onClick={() => setCurrentQuestionIndex(currentQuestionIndex + 1)}
                  className="px-6 py-3 bg-rose-600 text-white rounded-lg font-semibold hover:bg-rose-700 transition-all"
                >
                  Next →
                </button>
              ) : (
                <button
                  onClick={handleSubmitTest}
                  disabled={loading}
                  className="px-8 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-700 hover:to-emerald-700 transition-all shadow-lg disabled:opacity-50"
                >
                  {loading ? 'Submitting...' : 'Submit Test'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Results View */}
        {view === 'results' && testResults && (
          <div className="space-y-6">
            {/* Score Card */}
            <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-6">Test Complete!</h2>

              <div className="inline-block">
                <div className="relative">
                  <svg className="w-48 h-48 transform -rotate-90">
                    <circle
                      cx="96"
                      cy="96"
                      r="88"
                      stroke="#e5e7eb"
                      strokeWidth="12"
                      fill="none"
                    />
                    <circle
                      cx="96"
                      cy="96"
                      r="88"
                      stroke={testResults.percentage >= 70 ? '#10b981' : testResults.percentage >= 50 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="12"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 88}`}
                      strokeDashoffset={`${2 * Math.PI * 88 * (1 - testResults.percentage / 100)}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div>
                      <div className="text-5xl font-bold text-gray-900">{Math.round(testResults.percentage)}%</div>
                      <div className="text-gray-500">{testResults.score}/{testResults.totalPoints} points</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-3 gap-6 text-center">
                <div>
                  <div className="text-3xl font-bold text-green-600">{testResults.correctCount}</div>
                  <div className="text-sm text-gray-600">Correct</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-red-600">{testResults.incorrectCount}</div>
                  <div className="text-sm text-gray-600">Incorrect</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-gray-600">{testResults.timeSpent}s</div>
                  <div className="text-sm text-gray-600">Time Spent</div>
                </div>
              </div>

              <div className="mt-8 flex gap-4 justify-center">
                <button
                  onClick={() => handleStartTest(currentTest)}
                  className="px-6 py-3 bg-rose-600 text-white rounded-lg font-semibold hover:bg-rose-700 transition-all"
                >
                  Retake Test
                </button>
                <button
                  onClick={() => setView('tests')}
                  className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-all"
                >
                  Back to Tests
                </button>
              </div>
            </div>

            {/* Question-by-Question Breakdown */}
            {testResults.questionResults && (
              <div className="bg-white rounded-2xl shadow-xl p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-6">Detailed Results</h3>
                <div className="space-y-6">
                  {testResults.questionResults.map((result, index) => (
                    <div
                      key={index}
                      className={`p-4 rounded-lg border-2 ${
                        result.isCorrect
                          ? 'border-green-200 bg-green-50'
                          : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="font-semibold text-gray-900">
                          Question {index + 1}
                        </span>
                        <span className={`font-bold ${result.isCorrect ? 'text-green-600' : 'text-red-600'}`}>
                          {result.isCorrect ? '✓' : '✗'} {result.pointsEarned}/{result.pointsPossible} points
                        </span>
                      </div>
                      <p className="text-gray-700 mb-3">{result.questionText}</p>

                      {result.type === 'mcq' && (
                        <div className="space-y-2">
                          <div>
                            <span className="text-sm font-medium text-gray-600">Your answer: </span>
                            <span className={result.isCorrect ? 'text-green-700' : 'text-red-700'}>
                              {result.userAnswer}
                            </span>
                          </div>
                          {!result.isCorrect && (
                            <div>
                              <span className="text-sm font-medium text-gray-600">Correct answer: </span>
                              <span className="text-green-700">{result.correctAnswer}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {(result.type === 'short_answer' || result.type === 'essay') && (
                        <div className="space-y-3">
                          <div className="p-3 bg-white rounded">
                            <div className="text-sm font-medium text-gray-600 mb-1">Your Answer:</div>
                            <div className="text-gray-900">{result.userAnswer}</div>
                          </div>
                          {result.feedback && (
                            <div className="p-3 bg-blue-50 rounded">
                              <div className="text-sm font-medium text-blue-900 mb-1">AI Feedback:</div>
                              <div className="text-blue-800">{result.feedback}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
