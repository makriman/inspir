import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import NotFound from './NotFound';

const SUPPORTED_TYPES = new Set([
  'fill-blank-generator',
  'mcq-bank',
  'essay-question-generator',
  'vocabulary-builder',
  'true-false-quiz',
  'matching-game',
  'diagram-labeling',
]);

const TYPE_META = {
  'fill-blank-generator': {
    title: 'Fill-in-the-Blank Generator',
    subtitle: 'Turn any topic or notes into fast, active-recall practice.',
    countLabel: 'Prompts',
  },
  'mcq-bank': {
    title: 'MCQ Bank',
    subtitle: 'Generate a bank of multiple-choice questions with explanations.',
    countLabel: 'Questions',
  },
  'essay-question-generator': {
    title: 'Essay Question Generator',
    subtitle: 'Practice deeper thinking with structured prompts and outlines.',
    countLabel: 'Prompts',
  },
  'vocabulary-builder': {
    title: 'Vocabulary Builder',
    subtitle: 'Build a strong vocab list with definitions and examples.',
    countLabel: 'Terms',
  },
  'true-false-quiz': {
    title: 'True/False Quiz Maker',
    subtitle: 'Quick comprehension checks: statements, answers, explanations.',
    countLabel: 'Statements',
  },
  'matching-game': {
    title: 'Matching Game Generator',
    subtitle: 'Match key terms to definitions for speedy retrieval practice.',
    countLabel: 'Pairs',
  },
  'diagram-labeling': {
    title: 'Diagram Labeling Practice',
    subtitle: 'Generate a list of diagram parts + labels to self-test.',
    countLabel: 'Parts',
  },
};

function storageKey(type) {
  return `inspirquiz_worksheets_v1:${type}`;
}

function loadHistory(type) {
  try {
    const raw = localStorage.getItem(storageKey(type));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistHistory(type, items) {
  try {
    localStorage.setItem(storageKey(type), JSON.stringify(items));
  } catch {
    // ignore
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJson(filename, json) {
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatForCopy(type, data, showAnswers) {
  const title = data?.title ? `${data.title}\n\n` : '';

  if (type === 'matching-game') {
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    return `${title}${pairs
      .map((pair, idx) => `${idx + 1}. ${pair.left} — ${showAnswers ? pair.right : '________'}`)
      .join('\n')}`;
  }

  const items = Array.isArray(data?.items) ? data.items : [];

  if (type === 'mcq-bank') {
    return (
      title +
      items
        .map((item, idx) => {
          const options = Array.isArray(item.options) ? item.options : [];
          const letters = ['A', 'B', 'C', 'D'];
          const optionsText = options.map((opt, i) => `   ${letters[i]}. ${opt}`).join('\n');
          const answerLine =
            showAnswers && Number.isInteger(item.answerIndex)
              ? `\n   Answer: ${letters[item.answerIndex]}\n   Explanation: ${item.explanation || ''}`
              : '';
          return `${idx + 1}. ${item.question}\n${optionsText}${answerLine}`;
        })
        .join('\n\n')
    );
  }

  if (type === 'true-false-quiz') {
    return (
      title +
      items
        .map((item, idx) => {
          const answerLine = showAnswers ? ` — ${item.answer ? 'True' : 'False'} (${item.explanation || ''})` : '';
          return `${idx + 1}. ${item.statement}${answerLine}`;
        })
        .join('\n')
    );
  }

  if (type === 'fill-blank-generator') {
    return (
      title +
      items
        .map((item, idx) => {
          const answerLine = showAnswers ? ` [${item.answer}]` : '';
          const hint = item.hint ? ` (Hint: ${item.hint})` : '';
          return `${idx + 1}. ${item.prompt}${hint}${answerLine}`;
        })
        .join('\n')
    );
  }

  if (type === 'essay-question-generator') {
    return (
      title +
      items
        .map((item, idx) => {
          const points = Array.isArray(item.keyPoints) ? item.keyPoints : [];
          const outline = Array.isArray(item.outline) ? item.outline : [];
          const extra = showAnswers
            ? `\n   Key points:\n${points.map((p) => `   - ${p}`).join('\n')}\n   Outline:\n${outline
                .map((o) => `   - ${o}`)
                .join('\n')}`
            : '';
          return `${idx + 1}. ${item.prompt}${extra}`;
        })
        .join('\n\n')
    );
  }

  if (type === 'vocabulary-builder') {
    return (
      title +
      items
        .map((item, idx) => {
          const pos = item.partOfSpeech ? ` (${item.partOfSpeech})` : '';
          const mnemonic = showAnswers && item.mnemonic ? `\n   Mnemonic: ${item.mnemonic}` : '';
          const details = showAnswers
            ? `\n   Definition: ${item.definition}\n   Example: ${item.example}${mnemonic}`
            : '';
          return `${idx + 1}. ${item.term}${pos}${details}`;
        })
        .join('\n\n')
    );
  }

  if (type === 'diagram-labeling') {
    return (
      title +
      items
        .map((item) => {
          const num = Number.isInteger(item.partNumber) ? item.partNumber : '?';
          const label = showAnswers ? item.label : '________';
          return `${num}. ${label} — ${item.description || ''}`;
        })
        .join('\n')
    );
  }

  return `${title}${JSON.stringify(data, null, 2)}`;
}

export default function WorksheetTool() {
  const { type } = useParams();

  const meta = useMemo(() => TYPE_META[type], [type]);
  const supported = type && SUPPORTED_TYPES.has(type);

  const [inputMethod, setInputMethod] = useState('text');
  const [topic, setTopic] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState(null);

  const [difficulty, setDifficulty] = useState('medium');
  const [count, setCount] = useState(10);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const [showAnswers, setShowAnswers] = useState(true);
  const [history, setHistory] = useState(() => (supported ? loadHistory(type) : []));
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!supported) return;
    const items = loadHistory(type);
    setHistory(items);
    setShowHistory(false);
    setResult(null);
    setError(null);
  }, [supported, type]);

  if (!supported) return <NotFound />;

  const handleGenerate = async () => {
    setError(null);
    setResult(null);

    if (!topic.trim() && inputMethod === 'text' && !content.trim()) {
      setError('Add a topic or paste some content to generate practice.');
      return;
    }

    if (inputMethod === 'file' && !file) {
      setError('Choose a file first (PDF, DOCX, or TXT).');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('type', type);
      formData.append('topic', topic.trim());
      formData.append('difficulty', difficulty);
      formData.append('count', String(count));

      if (inputMethod === 'file') {
        formData.append('file', file);
      } else {
        formData.append('content', content);
      }

      const response = await axios.post('/api/worksheets/generate', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const payload = response.data;
      setResult(payload);

      const entry = {
        id: payload?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        createdAt: new Date().toISOString(),
        title: payload?.title || meta.title,
        data: payload,
      };

      const nextHistory = [entry, ...history].slice(0, 20);
      setHistory(nextHistory);
      persistHistory(type, nextHistory);
    } catch (err) {
      console.error('Worksheet generation failed:', err);
      setError(err.response?.data?.error || 'Failed to generate. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    const text = formatForCopy(type, result, showAnswers);
    await navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  const handleDownload = () => {
    if (!result) return;
    const filename = `${(result.title || meta.title).replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.txt`;
    downloadText(filename, formatForCopy(type, result, true));
  };

  const handleDownloadJson = () => {
    if (!result) return;
    const filename = `${(result.title || meta.title).replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.json`;
    downloadJson(filename, result);
  };

  const loadFromHistory = (entry) => {
    setResult(entry.data);
    setShowHistory(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearHistory = () => {
    setHistory([]);
    persistHistory(type, []);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Active Learning</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">{meta.title}</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">{meta.subtitle}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setInputMethod('text')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  inputMethod === 'text'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Paste Text
              </button>
              <button
                onClick={() => setInputMethod('file')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  inputMethod === 'file'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Upload File
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHistory((prev) => !prev)}
                className="px-4 py-2 rounded-lg font-medium bg-white border border-gray-200 hover:border-purple-300 text-gray-700 transition-all"
              >
                History ({history.length})
              </button>
              {history.length > 0 && showHistory && (
                <button
                  onClick={clearHistory}
                  className="px-4 py-2 rounded-lg font-medium bg-white border border-gray-200 hover:border-red-300 text-red-600 transition-all"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {showHistory && history.length > 0 && (
            <div className="mb-6 border border-gray-200 rounded-xl p-4 bg-gray-50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {history.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => loadFromHistory(entry)}
                    className="text-left bg-white border border-gray-200 hover:border-purple-300 rounded-lg p-3 transition-all"
                  >
                    <div className="font-semibold text-gray-900">{entry.title}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(entry.createdAt).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Topic (optional)</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., Photosynthesis, French Revolution, Newton’s Laws"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">{meta.countLabel}</label>
              <input
                type="number"
                min={5}
                max={30}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none bg-white"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>

            <div className="md:col-span-2 flex items-end">
              <label className="flex items-center gap-2 select-none text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={showAnswers}
                  onChange={(e) => setShowAnswers(e.target.checked)}
                  className="w-4 h-4"
                />
                Show answers/explanations in preview
              </label>
            </div>
          </div>

          {inputMethod === 'text' ? (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Content (optional)</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste notes or textbook excerpts here (optional if topic is set)..."
                className="w-full h-56 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none resize-none"
              />
            </div>
          ) : (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Upload Document</label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-purple-400 transition-colors">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-600"
                />
                {file && <p className="text-sm text-gray-600 mt-2">Selected: {file.name}</p>}
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 bg-red-50 border-2 border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading}
            className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
              loading
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700 shadow-lg hover:shadow-xl'
            }`}
          >
            {loading ? 'Generating…' : 'Generate'}
          </button>
        </div>

        {result && (
          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{result.title || meta.title}</h2>
                <p className="text-sm text-gray-500">Generated practice set</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 rounded-lg font-medium bg-purple-600 text-white hover:bg-purple-700 transition-all"
                >
                  Copy
                </button>
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 rounded-lg font-medium bg-white border border-gray-200 hover:border-purple-300 text-gray-700 transition-all"
                >
                  Download TXT
                </button>
                <button
                  onClick={handleDownloadJson}
                  className="px-4 py-2 rounded-lg font-medium bg-white border border-gray-200 hover:border-purple-300 text-gray-700 transition-all"
                >
                  Download JSON
                </button>
              </div>
            </div>

            {type === 'matching-game' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(result.pairs || []).map((pair, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-xl p-4">
                    <div className="font-semibold text-gray-900">{idx + 1}. {pair.left}</div>
                    {showAnswers ? (
                      <div className="text-gray-700 mt-2">{pair.right}</div>
                    ) : (
                      <div className="text-gray-400 mt-2">________</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {(result.items || []).map((item, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-xl p-4">
                    {type === 'mcq-bank' && (
                      <>
                        <div className="font-semibold text-gray-900 mb-3">{idx + 1}. {item.question}</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {(item.options || []).map((opt, i) => (
                            <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-800">
                              <span className="font-semibold mr-2">{['A', 'B', 'C', 'D'][i]}.</span>
                              {opt}
                            </div>
                          ))}
                        </div>
                        {showAnswers && (
                          <div className="mt-3 text-sm text-gray-700">
                            <span className="font-semibold">Answer:</span>{' '}
                            {Number.isInteger(item.answerIndex) ? ['A', 'B', 'C', 'D'][item.answerIndex] : '—'}
                            {item.explanation ? (
                              <>
                                <span className="font-semibold ml-3">Explanation:</span> {item.explanation}
                              </>
                            ) : null}
                          </div>
                        )}
                      </>
                    )}

                    {type === 'true-false-quiz' && (
                      <>
                        <div className="font-semibold text-gray-900">{idx + 1}. {item.statement}</div>
                        {showAnswers && (
                          <div className="mt-2 text-sm text-gray-700">
                            <span className="font-semibold">Answer:</span> {item.answer ? 'True' : 'False'}
                            {item.explanation ? (
                              <>
                                <span className="font-semibold ml-3">Why:</span> {item.explanation}
                              </>
                            ) : null}
                          </div>
                        )}
                      </>
                    )}

                    {type === 'fill-blank-generator' && (
                      <>
                        <div className="font-semibold text-gray-900">{idx + 1}. {item.prompt}</div>
                        {item.hint && <div className="mt-2 text-sm text-gray-600">Hint: {item.hint}</div>}
                        {showAnswers && item.answer && (
                          <div className="mt-2 text-sm text-gray-700">
                            <span className="font-semibold">Answer:</span> {item.answer}
                          </div>
                        )}
                      </>
                    )}

                    {type === 'essay-question-generator' && (
                      <>
                        <div className="font-semibold text-gray-900 mb-2">{idx + 1}. {item.prompt}</div>
                        {showAnswers && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <div className="text-sm font-semibold text-gray-700 mb-1">Key points</div>
                              <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                                {(item.keyPoints || []).map((p, i) => (
                                  <li key={i}>{p}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-gray-700 mb-1">Outline</div>
                              <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                                {(item.outline || []).map((o, i) => (
                                  <li key={i}>{o}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {type === 'vocabulary-builder' && (
                      <>
                        <div className="font-semibold text-gray-900">
                          {idx + 1}. {item.term}{item.partOfSpeech ? <span className="text-gray-500"> ({item.partOfSpeech})</span> : null}
                        </div>
                        {showAnswers && (
                          <div className="mt-2 text-sm text-gray-700 space-y-1">
                            {item.definition && (
                              <div>
                                <span className="font-semibold">Definition:</span> {item.definition}
                              </div>
                            )}
                            {item.example && (
                              <div>
                                <span className="font-semibold">Example:</span> {item.example}
                              </div>
                            )}
                            {item.mnemonic && (
                              <div>
                                <span className="font-semibold">Mnemonic:</span> {item.mnemonic}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {type === 'diagram-labeling' && (
                      <>
                        <div className="font-semibold text-gray-900">
                          {Number.isInteger(item.partNumber) ? item.partNumber : idx + 1}.{' '}
                          {showAnswers ? item.label : '________'}
                        </div>
                        {item.description && <div className="mt-2 text-sm text-gray-700">{item.description}</div>}
                      </>
                    )}
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

