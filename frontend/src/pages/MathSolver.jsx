import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';

export default function MathSolver() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Input state
  const [inputMethod, setInputMethod] = useState('text'); // 'text' or 'image'
  const [problemText, setProblemText] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  // Solution state
  const [solution, setSolution] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // History state
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // Practice problems state
  const [practiceProblems, setPracticeProblems] = useState([]);
  const [loadingPractice, setLoadingPractice] = useState(false);

  // Load history on mount if user is logged in
  useEffect(() => {
    if (user) {
      loadHistory();
    }
  }, [user]);

  const loadHistory = async () => {
    try {
      const response = await axios.get('/api/math-solver/history');
      setHistory(response.data.solutions || []);
    } catch (err) {
      console.error('Error loading history:', err);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setError(null);

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSolve = async () => {
    setError(null);
    setSolution(null);
    setPracticeProblems([]);

    // Validation
    if (inputMethod === 'text' && !problemText.trim()) {
      setError('Please enter a math problem to solve');
      return;
    }

    if (inputMethod === 'image' && !imageFile) {
      setError('Please upload an image of your math problem');
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();

      if (inputMethod === 'image') {
        formData.append('image', imageFile);
      } else {
        formData.append('problem', problemText);
      }

      const response = await axios.post('/api/math-solver/solve', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setSolution(response.data.solution);

      // Reload history if user is logged in
      if (user) {
        loadHistory();
      }

    } catch (err) {
      console.error('Error solving problem:', err);
      setError(err.response?.data?.error || 'Failed to solve problem. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePractice = async () => {
    if (!solution) return;

    setLoadingPractice(true);
    try {
      const response = await axios.post(`/api/math-solver/solution/${solution.id}/practice`);
      setPracticeProblems(response.data.problems || []);
    } catch (err) {
      console.error('Error generating practice problems:', err);
      setError('Failed to generate practice problems');
    } finally {
      setLoadingPractice(false);
    }
  };

  const handleReset = () => {
    setSolution(null);
    setProblemText('');
    setImageFile(null);
    setImagePreview(null);
    setPracticeProblems([]);
    setError(null);
  };

  const loadFromHistory = (item) => {
    setSolution({
      id: item.id,
      problemText: item.problem_text,
      steps: item.solution_steps,
      finalAnswer: item.final_answer,
      problemType: item.problem_type,
      difficultyLevel: item.difficulty_level,
      verification: item.verification
    });
    setProblemText(item.problem_text);
    setInputMethod('text');
    setShowHistory(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderMath = (text) => {
    if (!text) return null;

    // Check if the text contains LaTeX math delimiters
    if (text.includes('\\(') || text.includes('\\[') || text.includes('$$') || text.includes('$')) {
      try {
        // Split text by math delimiters and render accordingly
        const parts = [];
        let currentText = text;
        let key = 0;

        // Handle display math ($$...$$)
        const displayMathRegex = /\$\$(.*?)\$\$/g;
        currentText = currentText.replace(displayMathRegex, (match, math) => {
          return `|||DISPLAY_MATH_${key++}|||${math}|||END|||`;
        });

        // Handle inline math ($...$)
        const inlineMathRegex = /\$(.*?)\$/g;
        currentText = currentText.replace(inlineMathRegex, (match, math) => {
          return `|||INLINE_MATH_${key++}|||${math}|||END|||`;
        });

        // Split and render
        const segments = currentText.split('|||');
        return segments.map((segment, idx) => {
          if (segment.startsWith('DISPLAY_MATH_')) {
            const mathContent = segments[idx + 1];
            return <BlockMath key={idx} math={mathContent} />;
          } else if (segment.startsWith('INLINE_MATH_')) {
            const mathContent = segments[idx + 1];
            return <InlineMath key={idx} math={mathContent} />;
          } else if (segment !== 'END' && !segment.match(/^(DISPLAY|INLINE)_MATH_\d+$/)) {
            return <span key={idx}>{segment}</span>;
          }
          return null;
        });
      } catch (err) {
        console.error('Error rendering math:', err);
        return <span>{text}</span>;
      }
    }

    return <span>{text}</span>;
  };

  const getDifficultyColor = (level) => {
    switch (level) {
      case 'easy': return 'text-green-600 bg-green-50';
      case 'medium': return 'text-yellow-600 bg-yellow-50';
      case 'hard': return 'text-red-600 bg-red-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getProblemTypeIcon = (type) => {
    const icons = {
      algebra: '🔢',
      calculus: '∫',
      geometry: '📐',
      trigonometry: '📊',
      statistics: '📈',
      linear_algebra: '⚡',
      differential_equations: '∂',
      default: '🧮'
    };
    return icons[type] || icons.default;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-cyan-50 to-white py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block bg-blue-100 rounded-full px-4 py-2 mb-4">
            <span className="text-blue-700 font-semibold text-sm">AI-Powered Step-by-Step</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Math Problem Solver
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Get instant step-by-step solutions to any math problem. From algebra to calculus and beyond.
          </p>
        </div>

        {/* Main Content */}
        {!solution ? (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
            {/* Input Method Selector */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Input Method
              </label>
              <div className="flex gap-4">
                <button
                  onClick={() => setInputMethod('text')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'text'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Type Problem
                </button>
                <button
                  onClick={() => setInputMethod('image')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'image'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Upload Image
                </button>
              </div>
            </div>

            {/* Text Input */}
            {inputMethod === 'text' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Math Problem
                </label>
                <textarea
                  value={problemText}
                  onChange={(e) => setProblemText(e.target.value)}
                  placeholder="Enter your math problem here... e.g., 'Solve for x: 2x + 5 = 15' or 'Find the derivative of x^2 + 3x + 2'"
                  className="w-full h-48 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none font-mono"
                />
                <div className="mt-2 text-sm text-gray-500">
                  Tip: You can use LaTeX notation (e.g., x^2, \frac{"{a}{b}"}, \sqrt{"{x}"})
                </div>
              </div>
            )}

            {/* Image Upload */}
            {inputMethod === 'image' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Upload Image of Problem
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
                  <input
                    type="file"
                    onChange={handleImageChange}
                    accept="image/*"
                    className="hidden"
                    id="image-upload"
                  />
                  <label htmlFor="image-upload" className="cursor-pointer">
                    {imagePreview ? (
                      <div>
                        <img
                          src={imagePreview}
                          alt="Problem preview"
                          className="max-h-64 mx-auto rounded-lg mb-3"
                        />
                        <p className="text-sm text-gray-500">Click to change image</p>
                      </div>
                    ) : (
                      <div>
                        <div className="text-5xl mb-3">📸</div>
                        <p className="text-gray-600 mb-2">Click to upload or drag and drop</p>
                        <p className="text-sm text-gray-400">Take a photo of handwritten work or printed problems</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}

            {/* Solve Button */}
            <button
              onClick={handleSolve}
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 text-white py-4 px-6 rounded-lg font-semibold text-lg hover:from-blue-700 hover:to-cyan-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Solving Problem...
                </span>
              ) : (
                'Solve Problem'
              )}
            </button>
          </div>
        ) : (
          /* Solution Display */
          <div className="space-y-6">
            {/* Problem Info */}
            <div className="bg-white rounded-2xl shadow-xl p-8">
              <div className="flex items-start justify-between mb-6">
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Problem</h2>
                  <div className="text-lg text-gray-700 bg-gray-50 p-4 rounded-lg font-mono">
                    {renderMath(solution.problemText)}
                  </div>
                </div>
                <div className="ml-4 flex gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getDifficultyColor(solution.difficultyLevel)}`}>
                    {solution.difficultyLevel}
                  </span>
                  <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-50 text-blue-700">
                    {getProblemTypeIcon(solution.problemType)} {solution.problemType}
                  </span>
                </div>
              </div>

              {/* Step-by-Step Solution */}
              <div className="mb-6">
                <h3 className="text-xl font-bold text-gray-900 mb-4">Step-by-Step Solution</h3>
                <div className="space-y-4">
                  {solution.steps.map((step, index) => (
                    <div key={index} className="border-l-4 border-blue-500 pl-6 py-3">
                      <div className="flex items-start">
                        <div className="flex-shrink-0 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-sm mr-4">
                          {step.stepNumber}
                        </div>
                        <div className="flex-1">
                          <p className="text-gray-900 mb-2 font-medium">{step.explanation}</p>
                          {step.equation && (
                            <div className="bg-blue-50 p-3 rounded-lg font-mono text-gray-800">
                              {renderMath(step.equation)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Final Answer */}
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl p-6">
                <h3 className="text-lg font-bold text-green-900 mb-3">Final Answer</h3>
                <div className="text-2xl font-bold text-green-900">
                  {renderMath(solution.finalAnswer)}
                </div>
              </div>

              {/* Verification */}
              {solution.verification && (
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Verification</h4>
                  <p className="text-gray-600 text-sm">{solution.verification}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-4 mt-8">
                <button
                  onClick={handleGeneratePractice}
                  disabled={loadingPractice}
                  className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-md disabled:opacity-50"
                >
                  {loadingPractice ? 'Generating...' : 'Generate Practice Problems'}
                </button>
                <button
                  onClick={handleReset}
                  className="flex-1 bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300 transition-all"
                >
                  Solve Another Problem
                </button>
              </div>
            </div>

            {/* Practice Problems */}
            {practiceProblems.length > 0 && (
              <div className="bg-white rounded-2xl shadow-xl p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-6">Practice Problems</h3>
                <div className="space-y-4">
                  {practiceProblems.map((problem, index) => (
                    <div key={index} className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <span className="text-sm font-medium text-blue-700 mr-3">Problem {index + 1}</span>
                          <span className="text-gray-900 font-mono">{renderMath(problem.problemText)}</span>
                        </div>
                        <button
                          onClick={() => {
                            setProblemText(problem.problemText);
                            setSolution(null);
                            setPracticeProblems([]);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="ml-4 text-blue-600 hover:text-blue-700 font-medium text-sm whitespace-nowrap"
                        >
                          Try this →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* History Section (for logged-in users) */}
        {user && history.length > 0 && !solution && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-gray-900">Your Solution History</h3>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                {showHistory ? 'Hide' : 'Show'} ({history.length})
              </button>
            </div>

            {showHistory && (
              <div className="space-y-4">
                {history.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => loadFromHistory(item)}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-400 cursor-pointer transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{getProblemTypeIcon(item.problem_type)}</span>
                        <div>
                          <h4 className="font-semibold text-gray-900 font-mono text-sm">
                            {item.problem_text.substring(0, 60)}...
                          </h4>
                          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                            <span className="capitalize">{item.problem_type}</span>
                            <span>•</span>
                            <span className="capitalize">{item.difficulty_level}</span>
                            <span>•</span>
                            <span>{new Date(item.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
