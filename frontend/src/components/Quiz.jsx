import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Navigation from './Navigation';
import CorrectionLoading from './CorrectionLoading';
import API_URL from '../utils/api';

export default function Quiz() {
  const location = useLocation();
  const navigate = useNavigate();
  const { shareToken } = useParams();
  const { user, session } = useAuth();
  const passedQuizData = location.state?.quizData;

  const [quizData, setQuizData] = useState(passedQuizData || null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(!passedQuizData);
  const [submitting, setSubmitting] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameError, setNameError] = useState('');
  const [quizStarted, setQuizStarted] = useState(!!passedQuizData);

  const isSharedQuiz = !!shareToken;

  // Fetch shared quiz data if coming from shared link
  useEffect(() => {
    if (isSharedQuiz && !quizData) {
      const fetchSharedQuiz = async () => {
        try {
          console.log('=== FETCHING SHARED QUIZ ===');
          console.log('Share token:', shareToken);
          const url = `${API_URL}/quiz/shared/${shareToken}`;
          console.log('Fetching URL:', url);

          const response = await axios.get(url);
          console.log('Shared quiz response:', response.data);

          setQuizData(response.data);
          setAnswers(Array(response.data.questions.length).fill(''));
          setLoading(false);

          // Show name modal for guests
          if (!user) {
            setShowNameModal(true);
          } else {
            setQuizStarted(true);
          }
        } catch (error) {
          console.error('=== SHARED QUIZ ERROR ===');
          console.error('Error:', error);
          navigate('/');
        }
      };

      fetchSharedQuiz();
    } else if (passedQuizData) {
      setAnswers(Array(passedQuizData.questions.length).fill(''));
    }
  }, [shareToken, isSharedQuiz, quizData, passedQuizData, user, navigate, API_URL]);

  const handleStartQuiz = () => {
    if (!user && (!guestName || guestName.trim().length === 0)) {
      setNameError('Please enter your name to continue');
      return;
    }

    if (guestName.length > 50) {
      setNameError('Name must be 50 characters or less');
      return;
    }

    setShowNameModal(false);
    setQuizStarted(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-grow bg-purple-gradient flex items-center justify-center">
          <div className="bg-off-white p-8 rounded-2xl shadow-2xl text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-coral-red mx-auto mb-4"></div>
            <p className="text-deep-blue text-lg font-semibold">Loading quiz...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!quizData || !quizData.questions) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-grow bg-purple-gradient flex items-center justify-center">
          <div className="bg-off-white p-8 rounded-2xl shadow-2xl text-center">
            <h2 className="text-2xl font-bold text-deep-blue mb-4">No quiz data found</h2>
            <button
              onClick={() => navigate('/')}
              className="bg-coral-red text-white px-6 py-3 rounded-lg font-semibold hover:bg-opacity-90"
            >
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const questions = quizData.questions;
  const question = questions[currentQuestion];

  const handleAnswerChange = (value) => {
    const newAnswers = [...answers];
    newAnswers[currentQuestion] = value;
    setAnswers(newAnswers);
  };

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    }
  };

  const handlePrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const handleSubmit = async () => {
    // Check if all questions are answered
    const unanswered = answers.some((answer) => !answer || answer.trim() === '');
    if (unanswered) {
      const confirmed = window.confirm('Some questions are unanswered. Do you want to submit anyway?');
      if (!confirmed) return;
    }

    setSubmitting(true);

    try {
      let response;

      if (isSharedQuiz) {
        // Submit shared quiz
        const attemptName = user ? user.username : guestName.trim();
        const isGuest = !user;

        response = await axios.post(
          `${API_URL}/quiz/shared/${shareToken}/submit`,
          {
            questions: quizData.questions,
            answers: answers,
            attemptName: attemptName,
            isGuest: isGuest
          }
        );
      } else {
        // Submit regular quiz
        const headers = {};
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        response = await axios.post(
          `${API_URL}/quiz/submit`,
          {
            quizId: quizData.quizId,
            questions: questions,
            answers: answers,
          },
          { headers }
        );
      }

      // Add small delay to show the loading animation
      await new Promise(resolve => setTimeout(resolve, 1000));

      navigate('/results', {
        state: {
          results: response.data,
          quizId: isSharedQuiz ? quizData.quizId : quizData.quizId,
          isSharedQuiz: isSharedQuiz,
          quizCreator: quizData.createdBy,
          shareToken: shareToken // Pass share token for guest sharing
        }
      });
    } catch (error) {
      console.error('Submit error:', error);
      alert('Failed to submit quiz. Please try again.');
      setSubmitting(false);
    }
  };

  const progress = ((currentQuestion + 1) / questions.length) * 100;

  // Show correction loading screen during submission
  if (submitting) {
    return <CorrectionLoading />;
  }

  // Name Modal for Guests
  if (showNameModal) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-grow bg-purple-gradient flex items-center justify-center p-4">
          <div className="bg-off-white p-8 rounded-2xl shadow-2xl max-w-md w-full">
            <h2 className="text-3xl font-bold text-deep-blue mb-4 text-center">
              Welcome to the Quiz!
            </h2>
            <p className="text-gray-700 mb-4 text-center">
              Quiz by <span className="font-semibold text-vibrant-purple">{quizData.createdBy || 'Anonymous'}</span>
            </p>
            <p className="text-gray-600 mb-6 text-center">
              Please enter your name to continue
            </p>
            <input
              type="text"
              value={guestName}
              onChange={(e) => {
                setGuestName(e.target.value);
                setNameError('');
              }}
              placeholder="Your name"
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-vibrant-purple mb-2"
              maxLength={50}
              autoFocus
            />
            {nameError && (
              <p className="text-coral-red text-sm mb-4">{nameError}</p>
            )}
            <button
              onClick={handleStartQuiz}
              className="w-full px-6 py-3 bg-coral-red text-white rounded-lg font-bold hover:bg-opacity-90 transition-all transform hover:scale-105 shadow-lg"
            >
              Start Quiz
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Quiz hasn't started yet (for shared quizzes with logged-in users)
  if (isSharedQuiz && !quizStarted) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-grow bg-purple-gradient flex items-center justify-center p-4">
          <div className="bg-off-white p-8 rounded-2xl shadow-2xl max-w-md w-full text-center">
            <h2 className="text-3xl font-bold text-deep-blue mb-4">
              {quizData.sourceName || 'Quiz'}
            </h2>
            <p className="text-gray-700 mb-6">
              Quiz by <span className="font-semibold text-vibrant-purple">{quizData.createdBy || 'Anonymous'}</span>
            </p>
            <p className="text-gray-600 mb-8">
              Ready to test your knowledge? This quiz has {questions.length} questions.
            </p>
            <button
              onClick={() => setQuizStarted(true)}
              className="w-full px-8 py-4 bg-coral-red text-white rounded-lg font-bold hover:bg-opacity-90 transition-all transform hover:scale-105 shadow-lg text-lg"
            >
              Start Quiz
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />
      <main className="flex-grow bg-purple-gradient p-4 md:p-8">
        <div className="max-w-3xl mx-auto">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-white font-semibold">
              Question {currentQuestion + 1} of {questions.length}
            </span>
            <span className="text-vibrant-yellow font-semibold">
              {Math.round(progress)}% Complete
            </span>
          </div>
          <div className="w-full bg-white bg-opacity-30 rounded-full h-3">
            <div
              className="bg-vibrant-yellow h-3 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Question Card */}
        <div className="bg-off-white rounded-2xl shadow-2xl p-8 mb-6">
          <div className="mb-6">
            <span className="inline-block bg-deep-blue text-white px-4 py-2 rounded-full text-sm font-semibold mb-4">
              {question.type === 'multiple_choice' ? 'Multiple Choice' : 'Short Answer'}
            </span>
            <h2 className="text-2xl font-bold text-deep-blue mb-6">
              {question.question}
            </h2>
          </div>

          {question.type === 'multiple_choice' ? (
            <div className="space-y-3">
              {question.options.map((option, index) => {
                const letter = String.fromCharCode(65 + index);
                const isSelected = answers[currentQuestion] === letter;
                return (
                  <label
                    key={index}
                    className={`block p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      isSelected
                        ? 'border-deep-blue bg-deep-blue bg-opacity-10'
                        : 'border-gray-300 hover:border-deep-blue'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`question-${currentQuestion}`}
                      value={letter}
                      checked={isSelected}
                      onChange={(e) => handleAnswerChange(e.target.value)}
                      className="mr-3"
                    />
                    <span className="font-semibold text-deep-blue mr-2">{letter}.</span>
                    {option}
                  </label>
                );
              })}
            </div>
          ) : (
            <div>
              <textarea
                value={answers[currentQuestion]}
                onChange={(e) => handleAnswerChange(e.target.value)}
                placeholder="Type your answer here..."
                rows={6}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-deep-blue transition-colors resize-none"
              />
            </div>
          )}
        </div>

        {/* Navigation Buttons */}
        <div className="flex justify-between items-center gap-4">
          <button
            onClick={handlePrevious}
            disabled={currentQuestion === 0}
            className="px-6 py-3 bg-white text-deep-blue rounded-lg font-semibold hover:bg-opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>

          {currentQuestion === questions.length - 1 ? (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-8 py-3 bg-coral-red text-white rounded-lg font-bold hover:bg-opacity-90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              {loading ? 'Submitting...' : 'Submit Quiz'}
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="px-6 py-3 bg-vibrant-yellow text-deep-blue rounded-lg font-bold hover:bg-opacity-90 transition-all transform hover:scale-105 shadow-lg"
            >
              Next
            </button>
          )}
        </div>

        {/* Question Dots */}
        <div className="flex flex-wrap justify-center gap-2 mt-8">
          {questions.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentQuestion(index)}
              className={`w-8 h-8 rounded-full font-semibold transition-all ${
                index === currentQuestion
                  ? 'bg-vibrant-yellow text-deep-blue scale-110'
                  : answers[index]
                  ? 'bg-white text-deep-blue'
                  : 'bg-white bg-opacity-50 text-white'
              }`}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>
      </main>
    </div>
  );
}
