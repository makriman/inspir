import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

export default function TextSummarizer() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Input state
  const [inputMethod, setInputMethod] = useState('text'); // 'text' or 'file'
  const [textContent, setTextContent] = useState('');
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');

  // Options state
  const [summaryLength, setSummaryLength] = useState('medium');
  const [outputFormat, setOutputFormat] = useState('bullets');
  const [includeKeyConcepts, setIncludeKeyConcepts] = useState(true);

  // Results state
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // History state
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load history on mount if user is logged in
  useEffect(() => {
    if (user) {
      loadHistory();
    }
  }, [user]);

  const loadHistory = async () => {
    try {
      const response = await axios.get('/api/summarizer/history');
      setHistory(response.data.summaries || []);
    } catch (err) {
      console.error('Error loading history:', err);
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
    setSummary(null);

    // Validation
    if (inputMethod === 'text' && !textContent.trim()) {
      setError('Please enter some text to summarize');
      return;
    }

    if (inputMethod === 'file' && !file) {
      setError('Please select a file to summarize');
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

      formData.append('length', summaryLength);
      formData.append('format', outputFormat);
      formData.append('includeKeyConcepts', includeKeyConcepts);
      if (title) {
        formData.append('title', title);
      }

      const response = await axios.post('/api/summarizer/generate', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setSummary(response.data);

      // Reload history if user is logged in
      if (user) {
        loadHistory();
      }

    } catch (err) {
      console.error('Error generating summary:', err);
      setError(err.response?.data?.error || 'Failed to generate summary. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopySummary = () => {
    const summaryText = outputFormat === 'bullets'
      ? summary.summary.map(bullet => `• ${bullet}`).join('\n')
      : summary.summary;

    const fullText = `${summary.title}\n\n${summaryText}${
      summary.keyConcepts && summary.keyConcepts.length > 0
        ? `\n\nKey Concepts:\n${summary.keyConcepts.map(c => `• ${c}`).join('\n')}`
        : ''
    }`;

    navigator.clipboard.writeText(fullText);
    alert('Summary copied to clipboard!');
  };

  const handleDownload = () => {
    const summaryText = outputFormat === 'bullets'
      ? summary.summary.map(bullet => `• ${bullet}`).join('\n')
      : summary.summary;

    const fullText = `${summary.title}\n\n${summaryText}${
      summary.keyConcepts && summary.keyConcepts.length > 0
        ? `\n\nKey Concepts:\n${summary.keyConcepts.map(c => `• ${c}`).join('\n')}`
        : ''
    }\n\nGenerated with inspir Text Summarizer\nhttps://quiz.inspir.uk/text-summarizer`;

    const blob = new Blob([fullText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${summary.title.replace(/[^a-z0-9]/gi, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setSummary(null);
    setTextContent('');
    setFile(null);
    setTitle('');
    setError(null);
  };

  const loadFromHistory = (item) => {
    setSummary({
      summary: item.summary_text,
      keyConcepts: item.key_concepts,
      title: item.title,
      wordCount: item.word_count,
      format: item.output_format,
      length: item.summary_length
    });
    setOutputFormat(item.output_format);
    setSummaryLength(item.summary_length);
    setShowHistory(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">AI-Powered</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Text Summarizer
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Condense any content into clear, actionable summaries. Save hours of reading time.
          </p>
        </div>

        {/* Main Content */}
        {!summary ? (
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
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Paste Text
                </button>
                <button
                  onClick={() => setInputMethod('file')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'file'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Upload File
                </button>
              </div>
            </div>

            {/* Text Input */}
            {inputMethod === 'text' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Content to Summarize
                </label>
                <textarea
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder="Paste your article, notes, or any text you want to summarize..."
                  className="w-full h-64 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none resize-none"
                />
              </div>
            )}

            {/* File Upload */}
            {inputMethod === 'file' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Upload Document
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-purple-400 transition-colors">
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept=".pdf,.docx,.txt"
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className="cursor-pointer"
                  >
                    {file ? (
                      <div className="text-purple-600">
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

            {/* Optional Title */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Title (Optional)
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give your summary a title..."
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
              />
            </div>

            {/* Options */}
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              {/* Summary Length */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Summary Length
                </label>
                <div className="space-y-2">
                  {[
                    { value: 'short', label: 'Short', desc: '2-3 sentences' },
                    { value: 'medium', label: 'Medium', desc: '1 paragraph' },
                    { value: 'long', label: 'Long', desc: '2-3 paragraphs' }
                  ].map(option => (
                    <label
                      key={option.value}
                      className={`flex items-center p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        summaryLength === option.value
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="length"
                        value={option.value}
                        checked={summaryLength === option.value}
                        onChange={(e) => setSummaryLength(e.target.value)}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium text-gray-900">{option.label}</div>
                        <div className="text-sm text-gray-500">{option.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Output Format */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Output Format
                </label>
                <div className="space-y-2">
                  {[
                    { value: 'bullets', label: 'Bullet Points', desc: '3-7 key points' },
                    { value: 'paragraph', label: 'Paragraph', desc: 'Flowing prose' }
                  ].map(option => (
                    <label
                      key={option.value}
                      className={`flex items-center p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        outputFormat === option.value
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="format"
                        value={option.value}
                        checked={outputFormat === option.value}
                        onChange={(e) => setOutputFormat(e.target.value)}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium text-gray-900">{option.label}</div>
                        <div className="text-sm text-gray-500">{option.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Key Concepts Toggle */}
            <div className="mb-8">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeKeyConcepts}
                  onChange={(e) => setIncludeKeyConcepts(e.target.checked)}
                  className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
                />
                <span className="ml-3 text-gray-700 font-medium">
                  Extract key concepts and terms
                </span>
              </label>
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
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-4 px-6 rounded-lg font-semibold text-lg hover:from-purple-700 hover:to-blue-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating Summary...
                </span>
              ) : (
                'Generate Summary'
              )}
            </button>
          </div>
        ) : (
          /* Summary Results */
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
            {/* Title */}
            <div className="mb-6">
              <h2 className="text-3xl font-bold text-gray-900">{summary.title}</h2>
              {summary.wordCount && (
                <p className="text-sm text-gray-500 mt-2">
                  Reduced from {summary.wordCount.original} to {summary.wordCount.summary} words
                  ({summary.wordCount.reduction}% shorter)
                </p>
              )}
            </div>

            {/* Summary Content */}
            <div className="mb-6 p-6 bg-purple-50 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Summary</h3>
              {outputFormat === 'bullets' ? (
                <ul className="space-y-3">
                  {summary.summary.map((bullet, index) => (
                    <li key={index} className="flex">
                      <span className="text-purple-600 mr-3">•</span>
                      <span className="text-gray-700 leading-relaxed">{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {summary.summary}
                </p>
              )}
            </div>

            {/* Key Concepts */}
            {summary.keyConcepts && summary.keyConcepts.length > 0 && (
              <div className="mb-8 p-6 bg-blue-50 rounded-lg">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Concepts</h3>
                <div className="flex flex-wrap gap-2">
                  {summary.keyConcepts.map((concept, index) => (
                    <span
                      key={index}
                      className="bg-white px-4 py-2 rounded-full text-gray-700 text-sm font-medium shadow-sm"
                    >
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-4">
              <button
                onClick={handleCopySummary}
                className="flex-1 bg-purple-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-purple-700 transition-all shadow-md"
              >
                Copy Summary
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-md"
              >
                Download
              </button>
              <button
                onClick={handleReset}
                className="flex-1 bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300 transition-all"
              >
                New Summary
              </button>
            </div>
          </div>
        )}

        {/* History Section (for logged-in users) */}
        {user && history.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-gray-900">Your Summary History</h3>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="text-purple-600 hover:text-purple-700 font-medium"
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
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-purple-400 cursor-pointer transition-all"
                  >
                    <h4 className="font-semibold text-gray-900 mb-1">{item.title}</h4>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span className="capitalize">{item.summary_length}</span>
                      <span>•</span>
                      <span className="capitalize">{item.output_format}</span>
                      <span>•</span>
                      <span>{new Date(item.created_at).toLocaleDateString()}</span>
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
