import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

export default function FlashcardCreator() {
  const navigate = useNavigate();
  const { shareToken } = useParams();
  const { user } = useAuth();

  // View state
  const [view, setView] = useState('generate'); // 'generate', 'decks', 'study'

  // Generation state
  const [inputMethod, setInputMethod] = useState('text');
  const [textContent, setTextContent] = useState('');
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [numCards, setNumCards] = useState(10);

  // Decks state
  const [decks, setDecks] = useState([]);
  const [currentDeck, setCurrentDeck] = useState(null);

  // Study state
  const [studyMode, setStudyMode] = useState('flip'); // 'flip', 'mcq', 'type'
  const [studySession, setStudySession] = useState(null);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');
  const [sessionResults, setSessionResults] = useState([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load decks on mount if user is logged in
  useEffect(() => {
    if (user) {
      loadDecks();
    }
  }, [user]);

  const loadDecks = async () => {
    try {
      const response = await axios.get('/api/flashcards/decks');
      setDecks(response.data.decks || []);
    } catch (err) {
      console.error('Error loading decks:', err);
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
    if (inputMethod === 'text' && !textContent.trim()) {
      setError('Please enter some text to generate flashcards from');
      return;
    }

    if (inputMethod === 'file' && !file) {
      setError('Please select a file to generate flashcards from');
      return;
    }

    if (!title.trim()) {
      setError('Please provide a title for your flashcard deck');
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

      formData.append('title', title);
      formData.append('numCards', numCards);

      const response = await axios.post('/api/flashcards/generate', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Reload decks and show the new deck
      if (user) {
        await loadDecks();
      }

      setCurrentDeck(response.data.deck);
      setView('decks');
      setTextContent('');
      setFile(null);
      setTitle('');

    } catch (err) {
      console.error('Error generating flashcards:', err);
      setError(err.response?.data?.error || 'Failed to generate flashcards. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartStudy = async (deck, mode) => {
    setLoading(true);
    try {
      const response = await axios.get(`/api/flashcards/deck/${deck.id}/study`);
      setStudySession(response.data);
      setCurrentDeck(deck);
      setStudyMode(mode);
      setCurrentCardIndex(0);
      setShowAnswer(false);
      setUserAnswer('');
      setSessionResults([]);
      setView('study');
    } catch (err) {
      console.error('Error starting study session:', err);
      setError(err.response?.data?.error || 'Failed to start study session');
    } finally {
      setLoading(false);
    }
  };

  const handleCardRating = async (quality) => {
    if (!studySession || !user) return;

    const currentCard = studySession.cards[currentCardIndex];

    try {
      await axios.post(`/api/flashcards/deck/${currentDeck.id}/progress`, {
        cardId: currentCard.id,
        quality: quality,
      });

      // Track result
      setSessionResults([...sessionResults, { cardId: currentCard.id, quality }]);

      // Move to next card or finish
      if (currentCardIndex < studySession.cards.length - 1) {
        setCurrentCardIndex(currentCardIndex + 1);
        setShowAnswer(false);
        setUserAnswer('');
      } else {
        // Session complete
        setView('decks');
        loadDecks(); // Reload to get updated progress
      }
    } catch (err) {
      console.error('Error recording progress:', err);
    }
  };

  const handleDeleteDeck = async (deckId) => {
    if (!confirm('Are you sure you want to delete this deck?')) return;

    try {
      await axios.delete(`/api/flashcards/deck/${deckId}`);
      loadDecks();
      if (currentDeck?.id === deckId) {
        setCurrentDeck(null);
        setView('generate');
      }
    } catch (err) {
      console.error('Error deleting deck:', err);
      setError('Failed to delete deck');
    }
  };

  const handleShareDeck = async (deckId) => {
    try {
      const response = await axios.post(`/api/flashcards/deck/${deckId}/share`);
      const shareUrl = `${window.location.origin}/flashcards/shared/${response.data.shareToken}`;

      navigator.clipboard.writeText(shareUrl);
      alert('Share link copied to clipboard!');
    } catch (err) {
      console.error('Error sharing deck:', err);
      setError('Failed to create share link');
    }
  };

  const currentStudyCard = studySession?.cards?.[currentCardIndex];

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block bg-indigo-100 rounded-full px-4 py-2 mb-4">
            <span className="text-indigo-700 font-semibold text-sm">AI-Powered + Spaced Repetition</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Flashcard Creator
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Generate smart flashcards from any content. Study with proven spaced repetition for maximum retention.
          </p>
        </div>

        {/* View Tabs */}
        <div className="flex justify-center gap-4 mb-8">
          <button
            onClick={() => setView('generate')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              view === 'generate'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50 shadow'
            }`}
          >
            Create New Deck
          </button>
          {user && (
            <button
              onClick={() => setView('decks')}
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                view === 'decks'
                  ? 'bg-indigo-600 text-white shadow-lg'
                  : 'bg-white text-gray-700 hover:bg-gray-50 shadow'
              }`}
            >
              My Decks ({decks.length})
            </button>
          )}
        </div>

        {/* Generate View */}
        {view === 'generate' && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
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
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Paste Text
                </button>
                <button
                  onClick={() => setInputMethod('file')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'file'
                      ? 'bg-indigo-600 text-white shadow-md'
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
                  Content to Convert into Flashcards
                </label>
                <textarea
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder="Paste your study notes, textbook excerpts, or any educational content..."
                  className="w-full h-64 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none resize-none"
                />
              </div>
            )}

            {/* File Upload */}
            {inputMethod === 'file' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Upload Document
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-indigo-400 transition-colors">
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept=".pdf,.docx,.txt"
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    {file ? (
                      <div className="text-indigo-600">
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

            {/* Deck Title */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Deck Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Biology Chapter 5: Cell Structure"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Number of Cards */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Number of Cards: {numCards}
              </label>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={numCards}
                onChange={(e) => setNumCards(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-sm text-gray-500 mt-1">
                <span>5 cards</span>
                <span>50 cards</span>
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
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 px-6 rounded-lg font-semibold text-lg hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating Flashcards...
                </span>
              ) : (
                'Generate Flashcards'
              )}
            </button>
          </div>
        )}

        {/* Decks View */}
        {view === 'decks' && user && (
          <div className="space-y-6">
            {decks.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
                <p className="text-gray-500 text-lg mb-4">No flashcard decks yet</p>
                <button
                  onClick={() => setView('generate')}
                  className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-all"
                >
                  Create Your First Deck
                </button>
              </div>
            ) : (
              decks.map((deck) => (
                <div key={deck.id} className="bg-white rounded-2xl shadow-xl p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-2xl font-bold text-gray-900 mb-2">{deck.title}</h3>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span>{deck.card_count} cards</span>
                        <span>•</span>
                        <span>Created {new Date(deck.created_at).toLocaleDateString()}</span>
                      </div>
                      {deck.mastery_stats && (
                        <div className="mt-3 flex gap-6">
                          <div className="text-sm">
                            <span className="text-gray-600">Mastered:</span>
                            <span className="ml-2 font-semibold text-green-600">
                              {deck.mastery_stats.mastered || 0}
                            </span>
                          </div>
                          <div className="text-sm">
                            <span className="text-gray-600">Learning:</span>
                            <span className="ml-2 font-semibold text-yellow-600">
                              {deck.mastery_stats.learning || 0}
                            </span>
                          </div>
                          <div className="text-sm">
                            <span className="text-gray-600">New:</span>
                            <span className="ml-2 font-semibold text-blue-600">
                              {deck.mastery_stats.new || 0}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleShareDeck(deck.id)}
                        className="p-2 text-gray-400 hover:text-indigo-600 transition-colors"
                        title="Share deck"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteDeck(deck.id)}
                        className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                        title="Delete deck"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Study Mode Buttons */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                    <button
                      onClick={() => handleStartStudy(deck, 'flip')}
                      className="p-4 bg-indigo-50 border-2 border-indigo-200 rounded-lg hover:bg-indigo-100 transition-all group"
                    >
                      <div className="text-3xl mb-2">🔄</div>
                      <div className="font-semibold text-gray-900 mb-1">Flip Cards</div>
                      <div className="text-sm text-gray-600">Classic flashcard study</div>
                    </button>
                    <button
                      onClick={() => handleStartStudy(deck, 'mcq')}
                      className="p-4 bg-purple-50 border-2 border-purple-200 rounded-lg hover:bg-purple-100 transition-all group"
                    >
                      <div className="text-3xl mb-2">📝</div>
                      <div className="font-semibold text-gray-900 mb-1">Multiple Choice</div>
                      <div className="text-sm text-gray-600">Test with generated options</div>
                    </button>
                    <button
                      onClick={() => handleStartStudy(deck, 'type')}
                      className="p-4 bg-pink-50 border-2 border-pink-200 rounded-lg hover:bg-pink-100 transition-all group"
                    >
                      <div className="text-3xl mb-2">⌨️</div>
                      <div className="font-semibold text-gray-900 mb-1">Type Answer</div>
                      <div className="text-sm text-gray-600">Active recall practice</div>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Study View */}
        {view === 'study' && studySession && currentStudyCard && (
          <div className="bg-white rounded-2xl shadow-xl p-8 max-w-3xl mx-auto">
            {/* Progress Bar */}
            <div className="mb-8">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>Progress</span>
                <span>{currentCardIndex + 1} / {studySession.cards.length}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-indigo-600 to-purple-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${((currentCardIndex + 1) / studySession.cards.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Card Display - Flip Mode */}
            {studyMode === 'flip' && (
              <div className="mb-8">
                <div
                  onClick={() => setShowAnswer(!showAnswer)}
                  className="min-h-[300px] bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-8 flex items-center justify-center cursor-pointer transform transition-transform hover:scale-105 shadow-2xl"
                >
                  <div className="text-center text-white">
                    <div className="text-sm font-medium mb-4 opacity-80">
                      {showAnswer ? 'ANSWER' : 'QUESTION'}
                    </div>
                    <div className="text-2xl md:text-3xl font-bold leading-relaxed">
                      {showAnswer ? currentStudyCard.back : currentStudyCard.front}
                    </div>
                    <div className="text-sm mt-6 opacity-70">
                      Click to flip
                    </div>
                  </div>
                </div>

                {/* Rating Buttons */}
                {showAnswer && (
                  <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <button
                      onClick={() => handleCardRating(1)}
                      className="p-4 bg-red-100 text-red-700 rounded-lg font-semibold hover:bg-red-200 transition-all"
                    >
                      Again
                      <div className="text-xs opacity-70 mt-1">Hard to recall</div>
                    </button>
                    <button
                      onClick={() => handleCardRating(3)}
                      className="p-4 bg-yellow-100 text-yellow-700 rounded-lg font-semibold hover:bg-yellow-200 transition-all"
                    >
                      Hard
                      <div className="text-xs opacity-70 mt-1">Took time</div>
                    </button>
                    <button
                      onClick={() => handleCardRating(4)}
                      className="p-4 bg-blue-100 text-blue-700 rounded-lg font-semibold hover:bg-blue-200 transition-all"
                    >
                      Good
                      <div className="text-xs opacity-70 mt-1">Recalled well</div>
                    </button>
                    <button
                      onClick={() => handleCardRating(5)}
                      className="p-4 bg-green-100 text-green-700 rounded-lg font-semibold hover:bg-green-200 transition-all"
                    >
                      Easy
                      <div className="text-xs opacity-70 mt-1">Instant recall</div>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Card Display - MCQ Mode */}
            {studyMode === 'mcq' && currentStudyCard.mcq_options && (
              <div className="mb-8">
                <div className="mb-6 p-6 bg-indigo-50 rounded-xl">
                  <div className="text-sm font-medium text-indigo-700 mb-3">QUESTION</div>
                  <div className="text-xl font-bold text-gray-900">
                    {currentStudyCard.front}
                  </div>
                </div>

                <div className="space-y-3">
                  {currentStudyCard.mcq_options.map((option, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        setUserAnswer(option);
                        setShowAnswer(true);
                      }}
                      disabled={showAnswer}
                      className={`w-full p-4 text-left rounded-lg border-2 font-medium transition-all ${
                        showAnswer
                          ? option === currentStudyCard.back
                            ? 'bg-green-100 border-green-500 text-green-900'
                            : option === userAnswer
                            ? 'bg-red-100 border-red-500 text-red-900'
                            : 'bg-gray-50 border-gray-200 text-gray-400'
                          : 'bg-white border-gray-300 hover:border-indigo-500 hover:bg-indigo-50 text-gray-900'
                      }`}
                    >
                      <span className="mr-3 text-sm opacity-60">{String.fromCharCode(65 + index)}.</span>
                      {option}
                    </button>
                  ))}
                </div>

                {showAnswer && (
                  <div className="mt-8 grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleCardRating(userAnswer === currentStudyCard.back ? 5 : 1)}
                      className="p-4 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-all"
                    >
                      Next Card
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Card Display - Type Mode */}
            {studyMode === 'type' && (
              <div className="mb-8">
                <div className="mb-6 p-6 bg-purple-50 rounded-xl">
                  <div className="text-sm font-medium text-purple-700 mb-3">QUESTION</div>
                  <div className="text-xl font-bold text-gray-900">
                    {currentStudyCard.front}
                  </div>
                </div>

                {!showAnswer ? (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      Type your answer:
                    </label>
                    <textarea
                      value={userAnswer}
                      onChange={(e) => setUserAnswer(e.target.value)}
                      placeholder="Type your answer here..."
                      className="w-full h-32 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none resize-none mb-4"
                    />
                    <button
                      onClick={() => setShowAnswer(true)}
                      className="w-full bg-purple-600 text-white py-3 rounded-lg font-semibold hover:bg-purple-700 transition-all"
                    >
                      Check Answer
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="p-4 bg-blue-50 rounded-lg mb-4">
                      <div className="text-sm font-medium text-blue-700 mb-2">CORRECT ANSWER</div>
                      <div className="text-lg text-gray-900">{currentStudyCard.back}</div>
                    </div>
                    {userAnswer && (
                      <div className="p-4 bg-gray-50 rounded-lg mb-6">
                        <div className="text-sm font-medium text-gray-700 mb-2">YOUR ANSWER</div>
                        <div className="text-lg text-gray-700">{userAnswer}</div>
                      </div>
                    )}

                    <div className="text-center mb-4 text-gray-700 font-medium">
                      How did you do?
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <button
                        onClick={() => handleCardRating(1)}
                        className="p-4 bg-red-100 text-red-700 rounded-lg font-semibold hover:bg-red-200 transition-all"
                      >
                        Wrong
                      </button>
                      <button
                        onClick={() => handleCardRating(3)}
                        className="p-4 bg-yellow-100 text-yellow-700 rounded-lg font-semibold hover:bg-yellow-200 transition-all"
                      >
                        Partial
                      </button>
                      <button
                        onClick={() => handleCardRating(4)}
                        className="p-4 bg-blue-100 text-blue-700 rounded-lg font-semibold hover:bg-blue-200 transition-all"
                      >
                        Close
                      </button>
                      <button
                        onClick={() => handleCardRating(5)}
                        className="p-4 bg-green-100 text-green-700 rounded-lg font-semibold hover:bg-green-200 transition-all"
                      >
                        Perfect
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Exit Study Button */}
            <button
              onClick={() => {
                setView('decks');
                loadDecks();
              }}
              className="w-full mt-4 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-all"
            >
              Exit Study Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
