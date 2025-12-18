import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

export default function StudyGuideGenerator() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Input state
  const [inputMethod, setInputMethod] = useState('text'); // 'text' or 'files'
  const [textContent, setTextContent] = useState('');
  const [files, setFiles] = useState([]);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');

  // Results state
  const [guide, setGuide] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editedGuide, setEditedGuide] = useState(null);

  // History state
  const [guides, setGuides] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load history on mount if user is logged in
  useEffect(() => {
    if (user) {
      loadGuides();
    }
  }, [user]);

  const loadGuides = async () => {
    try {
      const response = await axios.get('/api/study-guides');
      setGuides(response.data.guides || []);
    } catch (err) {
      console.error('Error loading guides:', err);
    }
  };

  const handleFilesChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 5) {
      setError('Maximum 5 files allowed');
      return;
    }
    setFiles(selectedFiles);
    setError(null);
  };

  const removeFile = (index) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    setError(null);
    setGuide(null);

    // Validation
    if (inputMethod === 'text' && !textContent.trim()) {
      setError('Please enter some text to generate a study guide');
      return;
    }

    if (inputMethod === 'files' && files.length === 0) {
      setError('Please select at least one file');
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();

      if (inputMethod === 'files') {
        files.forEach(file => {
          formData.append('files', file);
        });
      } else {
        formData.append('content', textContent);
      }

      if (title) formData.append('title', title);
      if (subject) formData.append('subject', subject);

      const response = await axios.post('/api/study-guides/generate', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setGuide(response.data.guide);
      setEditedGuide(JSON.parse(JSON.stringify(response.data.guide))); // Deep copy

      // Reload guides if user is logged in
      if (user) {
        loadGuides();
      }

    } catch (err) {
      console.error('Error generating study guide:', err);
      setError(err.response?.data?.error || 'Failed to generate study guide. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdits = async () => {
    if (!guide.id) {
      alert('Cannot save edits for unsaved study guide');
      return;
    }

    try {
      await axios.put(`/api/study-guides/${guide.id}`, {
        title: editedGuide.title,
        subject: editedGuide.subject,
        structure: {
          overview: editedGuide.overview,
          keyConcepts: editedGuide.keyConcepts,
          definitions: editedGuide.definitions,
          examples: editedGuide.examples,
          questions: editedGuide.questions,
          summary: editedGuide.summary
        }
      });

      setGuide(editedGuide);
      setIsEditing(false);
      alert('Study guide updated successfully!');
      loadGuides();

    } catch (err) {
      console.error('Error saving edits:', err);
      alert('Failed to save edits. Please try again.');
    }
  };

  const handleCancelEdit = () => {
    setEditedGuide(JSON.parse(JSON.stringify(guide))); // Reset to original
    setIsEditing(false);
  };

  const handleDownload = () => {
    const displayGuide = isEditing ? editedGuide : guide;

    let textContent = `${displayGuide.title}\n`;
    textContent += `Subject: ${displayGuide.subject}\n`;
    textContent += `Generated with inspir Study Guide Generator\n`;
    textContent += `${'='.repeat(50)}\n\n`;

    textContent += `OVERVIEW\n${'-'.repeat(50)}\n${displayGuide.overview}\n\n`;

    textContent += `KEY CONCEPTS\n${'-'.repeat(50)}\n`;
    displayGuide.keyConcepts?.forEach((kc, i) => {
      textContent += `${i + 1}. ${kc.concept}\n   ${kc.description}\n\n`;
    });

    textContent += `DETAILED DEFINITIONS\n${'-'.repeat(50)}\n`;
    displayGuide.definitions?.forEach((def, i) => {
      textContent += `${i + 1}. ${def.term}\n   ${def.definition}\n\n`;
    });

    textContent += `EXAMPLES & APPLICATIONS\n${'-'.repeat(50)}\n`;
    displayGuide.examples?.forEach((ex, i) => {
      textContent += `${i + 1}. ${ex.title}\n   ${ex.description}\n\n`;
    });

    textContent += `PRACTICE QUESTIONS\n${'-'.repeat(50)}\n`;
    displayGuide.questions?.forEach((q, i) => {
      textContent += `${i + 1}. [${q.type}] ${q.question}\n`;
      if (q.options) {
        q.options.forEach((opt, j) => {
          textContent += `   ${String.fromCharCode(65 + j)}. ${opt}\n`;
        });
      }
      textContent += `   Answer: ${q.answer}\n\n`;
    });

    textContent += `SUMMARY\n${'-'.repeat(50)}\n${displayGuide.summary}\n`;

    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${displayGuide.title.replace(/[^a-z0-9]/gi, '_')}_Study_Guide.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setGuide(null);
    setEditedGuide(null);
    setTextContent('');
    setFiles([]);
    setTitle('');
    setSubject('');
    setError(null);
    setIsEditing(false);
  };

  const loadFromHistory = async (guideId) => {
    try {
      const response = await axios.get(`/api/study-guides/${guideId}`);
      const loadedGuide = response.data.guide;

      setGuide({
        id: loadedGuide.id,
        title: loadedGuide.title,
        subject: loadedGuide.subject,
        ...loadedGuide.structure
      });
      setEditedGuide({
        id: loadedGuide.id,
        title: loadedGuide.title,
        subject: loadedGuide.subject,
        ...loadedGuide.structure
      });
      setShowHistory(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('Error loading guide:', err);
      alert('Failed to load study guide');
    }
  };

  const displayGuide = isEditing ? editedGuide : guide;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-white py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block bg-blue-100 rounded-full px-4 py-2 mb-4">
            <span className="text-blue-700 font-semibold text-sm">AI-Powered</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Study Guide Generator
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Generate comprehensive study guides from your materials. Complete with definitions, examples, and practice questions.
          </p>
        </div>

        {/* Main Content */}
        {!guide ? (
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
                  Paste Text
                </button>
                <button
                  onClick={() => setInputMethod('files')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'files'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Upload Files
                </button>
              </div>
            </div>

            {/* Text Input */}
            {inputMethod === 'text' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Study Material
                </label>
                <textarea
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder="Paste your notes, textbook chapters, lecture transcripts, or any study material..."
                  className="w-full h-80 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>
            )}

            {/* File Upload */}
            {inputMethod === 'files' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Upload Study Materials (up to 5 files)
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
                  <input
                    type="file"
                    onChange={handleFilesChange}
                    accept=".pdf,.docx,.txt"
                    multiple
                    className="hidden"
                    id="files-upload"
                  />
                  <label htmlFor="files-upload" className="cursor-pointer">
                    {files.length > 0 ? (
                      <div className="text-blue-600">
                        <p className="font-medium text-lg">{files.length} file(s) selected</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-gray-600 mb-2">Click to upload or drag and drop</p>
                        <p className="text-sm text-gray-400">PDF, DOCX, or TXT (max 10MB each)</p>
                      </div>
                    )}
                  </label>
                </div>
                {files.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                        <span className="text-sm text-gray-700">{file.name}</span>
                        <button
                          onClick={() => removeFile(index)}
                          className="text-red-600 hover:text-red-700 text-sm font-medium"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Optional Metadata */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Title (Optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Chapter 5: Photosynthesis"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Subject (Optional)
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g., Biology, History, etc."
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                />
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
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 px-6 rounded-lg font-semibold text-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating Study Guide...
                </span>
              ) : (
                'Generate Study Guide'
              )}
            </button>
          </div>
        ) : (
          /* Study Guide Display */
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
            {/* Header with Actions */}
            <div className="flex items-center justify-between mb-6 pb-6 border-b border-gray-200">
              <div>
                {isEditing ? (
                  <input
                    type="text"
                    value={editedGuide.title}
                    onChange={(e) => setEditedGuide({...editedGuide, title: e.target.value})}
                    className="text-3xl font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none"
                  />
                ) : (
                  <h2 className="text-3xl font-bold text-gray-900">{displayGuide.title}</h2>
                )}
                <p className="text-gray-600 mt-1">Subject: {displayGuide.subject}</p>
              </div>
              <div className="flex gap-2">
                {user && guide.id && (
                  isEditing ? (
                    <>
                      <button
                        onClick={handleSaveEdits}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                    >
                      Edit
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Overview */}
            <section className="mb-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                <span className="bg-blue-100 text-blue-700 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm font-bold">1</span>
                Overview
              </h3>
              {isEditing ? (
                <textarea
                  value={editedGuide.overview}
                  onChange={(e) => setEditedGuide({...editedGuide, overview: e.target.value})}
                  className="w-full p-4 border-2 border-blue-300 rounded-lg focus:border-blue-500 focus:outline-none"
                  rows="3"
                />
              ) : (
                <p className="text-gray-700 leading-relaxed bg-blue-50 p-6 rounded-lg">
                  {displayGuide.overview}
                </p>
              )}
            </section>

            {/* Key Concepts */}
            <section className="mb-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                <span className="bg-purple-100 text-purple-700 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm font-bold">2</span>
                Key Concepts
              </h3>
              <div className="grid md:grid-cols-2 gap-4">
                {displayGuide.keyConcepts?.map((concept, index) => (
                  <div key={index} className="bg-purple-50 p-4 rounded-lg">
                    {isEditing ? (
                      <>
                        <input
                          type="text"
                          value={concept.concept}
                          onChange={(e) => {
                            const newConcepts = [...editedGuide.keyConcepts];
                            newConcepts[index].concept = e.target.value;
                            setEditedGuide({...editedGuide, keyConcepts: newConcepts});
                          }}
                          className="w-full font-semibold text-gray-900 mb-2 p-2 border border-purple-300 rounded"
                        />
                        <textarea
                          value={concept.description}
                          onChange={(e) => {
                            const newConcepts = [...editedGuide.keyConcepts];
                            newConcepts[index].description = e.target.value;
                            setEditedGuide({...editedGuide, keyConcepts: newConcepts});
                          }}
                          className="w-full text-gray-600 p-2 border border-purple-300 rounded"
                          rows="2"
                        />
                      </>
                    ) : (
                      <>
                        <h4 className="font-semibold text-gray-900 mb-2">{concept.concept}</h4>
                        <p className="text-gray-600 text-sm">{concept.description}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Detailed Definitions */}
            <section className="mb-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                <span className="bg-green-100 text-green-700 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm font-bold">3</span>
                Detailed Definitions
              </h3>
              <div className="space-y-4">
                {displayGuide.definitions?.map((def, index) => (
                  <div key={index} className="bg-green-50 p-5 rounded-lg">
                    {isEditing ? (
                      <>
                        <input
                          type="text"
                          value={def.term}
                          onChange={(e) => {
                            const newDefs = [...editedGuide.definitions];
                            newDefs[index].term = e.target.value;
                            setEditedGuide({...editedGuide, definitions: newDefs});
                          }}
                          className="w-full font-bold text-lg text-gray-900 mb-2 p-2 border border-green-300 rounded"
                        />
                        <textarea
                          value={def.definition}
                          onChange={(e) => {
                            const newDefs = [...editedGuide.definitions];
                            newDefs[index].definition = e.target.value;
                            setEditedGuide({...editedGuide, definitions: newDefs});
                          }}
                          className="w-full text-gray-700 p-2 border border-green-300 rounded"
                          rows="3"
                        />
                      </>
                    ) : (
                      <>
                        <h4 className="font-bold text-lg text-gray-900 mb-2">{def.term}</h4>
                        <p className="text-gray-700 leading-relaxed">{def.definition}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Examples & Applications */}
            <section className="mb-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                <span className="bg-yellow-100 text-yellow-700 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm font-bold">4</span>
                Examples & Applications
              </h3>
              <div className="space-y-4">
                {displayGuide.examples?.map((example, index) => (
                  <div key={index} className="bg-yellow-50 p-5 rounded-lg">
                    {isEditing ? (
                      <>
                        <input
                          type="text"
                          value={example.title}
                          onChange={(e) => {
                            const newExamples = [...editedGuide.examples];
                            newExamples[index].title = e.target.value;
                            setEditedGuide({...editedGuide, examples: newExamples});
                          }}
                          className="w-full font-semibold text-gray-900 mb-2 p-2 border border-yellow-300 rounded"
                        />
                        <textarea
                          value={example.description}
                          onChange={(e) => {
                            const newExamples = [...editedGuide.examples];
                            newExamples[index].description = e.target.value;
                            setEditedGuide({...editedGuide, examples: newExamples});
                          }}
                          className="w-full text-gray-700 p-2 border border-yellow-300 rounded"
                          rows="3"
                        />
                      </>
                    ) : (
                      <>
                        <h4 className="font-semibold text-gray-900 mb-2">{example.title}</h4>
                        <p className="text-gray-700">{example.description}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Practice Questions */}
            <section className="mb-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                <span className="bg-red-100 text-red-700 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm font-bold">5</span>
                Practice Questions
              </h3>
              <div className="space-y-4">
                {displayGuide.questions?.map((question, index) => (
                  <div key={index} className="bg-red-50 p-5 rounded-lg">
                    <div className="flex items-start gap-3">
                      <span className="font-bold text-gray-900">{index + 1}.</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs bg-red-200 text-red-800 px-2 py-1 rounded-full font-medium">
                            {question.type.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                        <p className="text-gray-900 font-medium mb-3">{question.question}</p>
                        {question.options && (
                          <div className="ml-4 mb-3 space-y-1">
                            {question.options.map((option, optIndex) => (
                              <div key={optIndex} className="text-gray-700">
                                {String.fromCharCode(65 + optIndex)}. {option}
                              </div>
                            ))}
                          </div>
                        )}
                        <details className="mt-2">
                          <summary className="cursor-pointer text-red-700 font-medium hover:text-red-800">
                            Show Answer
                          </summary>
                          <p className="mt-2 p-3 bg-white rounded text-gray-700">{question.answer}</p>
                        </details>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Summary */}
            <section className="mb-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                <span className="bg-indigo-100 text-indigo-700 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm font-bold">6</span>
                Summary
              </h3>
              {isEditing ? (
                <textarea
                  value={editedGuide.summary}
                  onChange={(e) => setEditedGuide({...editedGuide, summary: e.target.value})}
                  className="w-full p-4 border-2 border-indigo-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  rows="5"
                />
              ) : (
                <p className="text-gray-700 leading-relaxed bg-indigo-50 p-6 rounded-lg whitespace-pre-wrap">
                  {displayGuide.summary}
                </p>
              )}
            </section>

            {/* Action Buttons */}
            {!isEditing && (
              <div className="flex flex-wrap gap-4 pt-6 border-t border-gray-200">
                <button
                  onClick={handleDownload}
                  className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-md"
                >
                  Download Guide
                </button>
                <button
                  onClick={handleReset}
                  className="flex-1 bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300 transition-all"
                >
                  New Guide
                </button>
              </div>
            )}
          </div>
        )}

        {/* History Section (for logged-in users) */}
        {user && guides.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-gray-900">Your Study Guides</h3>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                {showHistory ? 'Hide' : 'Show'} ({guides.length})
              </button>
            </div>

            {showHistory && (
              <div className="grid md:grid-cols-2 gap-4">
                {guides.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => loadFromHistory(item.id)}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-400 cursor-pointer transition-all"
                  >
                    <h4 className="font-semibold text-gray-900 mb-1">{item.title}</h4>
                    <p className="text-sm text-gray-600 mb-2">{item.subject}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{new Date(item.created_at).toLocaleDateString()}</span>
                      {item.word_count && (
                        <>
                          <span>•</span>
                          <span>{item.word_count} words</span>
                        </>
                      )}
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
