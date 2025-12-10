import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Navigation from './Navigation';
import Footer from './Footer';
import API_URL from '../utils/api';

export default function QuizReview() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    const fetchQuiz = async () => {
      try {
        console.log('=== FETCHING QUIZ FOR REVIEW ===');
        console.log('Quiz ID:', quizId);

        const token = localStorage.getItem('auth_token');
        const url = `${API_URL}/quiz/${quizId}`;
        console.log('Fetching URL:', url);

        const response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        console.log('Quiz response:', response.data);
        setQuiz(response.data);
        setLoading(false);
      } catch (error) {
        console.error('=== QUIZ REVIEW ERROR ===');
        console.error('Error:', error);
        console.error('Error response:', error.response?.data);

        if (error.response?.status === 403) {
          setError('You do not have permission to view this quiz.');
        } else if (error.response?.status === 404) {
          setError('Quiz not found.');
        } else {
          setError('Failed to load quiz. Please try again.');
        }
        setLoading(false);
      }
    };

    fetchQuiz();
  }, [quizId, user, navigate]);

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
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-grow bg-purple-gradient flex items-center justify-center p-4">
          <div className="bg-off-white p-8 rounded-2xl shadow-2xl text-center max-w-md">
            <h2 className="text-2xl font-bold text-coral-red mb-4">Error</h2>
            <p className="text-gray-700 mb-6">{error}</p>
            <button
              onClick={() => navigate('/dashboard')}
              className="bg-coral-red text-white px-6 py-3 rounded-lg font-semibold hover:bg-opacity-90"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  if (!quiz || !quiz.questions) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-grow bg-purple-gradient flex items-center justify-center">
          <div className="bg-off-white p-8 rounded-2xl shadow-2xl text-center">
            <h2 className="text-2xl font-bold text-deep-blue mb-4">No quiz data found</h2>
            <button
              onClick={() => navigate('/dashboard')}
              className="bg-coral-red text-white px-6 py-3 rounded-lg font-semibold hover:bg-opacity-90"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const questions = quiz.questions;
  const question = questions[currentQuestion];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navigation />

      <main className="flex-grow p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-vibrant-purple hover:underline mb-4 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Dashboard
            </button>
            <h1 className="text-4xl font-bold text-deep-blue mb-2">{quiz.source_name}</h1>
            <p className="text-gray-600">Review all questions and their correct answers</p>
          </div>

          {/* Progress */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-deep-blue font-semibold">
                Question {currentQuestion + 1} of {questions.length}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-vibrant-purple h-2 rounded-full transition-all duration-300"
                style={{ width: `${((currentQuestion + 1) / questions.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Question Card */}
          <div className="bg-white rounded-2xl shadow-lg p-8 mb-6">
            <div className="mb-6">
              <span className="inline-block bg-deep-blue text-white px-4 py-2 rounded-full text-sm font-semibold mb-4">
                {question.type === 'multiple_choice' ? 'Multiple Choice' : 'Short Answer'}
              </span>
              <h2 className="text-2xl font-bold text-deep-blue mb-6">
                {question.question}
              </h2>
            </div>

            {question.type === 'multiple_choice' ? (
              <div className="space-y-3 mb-6">
                {question.options.map((option, index) => {
                  const letter = String.fromCharCode(65 + index);
                  const isCorrect = letter === question.correct_answer;
                  return (
                    <div
                      key={index}
                      className={`block p-4 border-2 rounded-lg ${
                        isCorrect
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-300 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-deep-blue">{letter}.</span>
                        <span className={isCorrect ? 'font-semibold text-green-700' : 'text-gray-700'}>
                          {option}
                        </span>
                        {isCorrect && (
                          <span className="ml-auto px-3 py-1 bg-green-500 text-white rounded-full text-xs font-bold">
                            ✓ Correct Answer
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mb-6">
                <div className="bg-green-50 border-2 border-green-500 rounded-lg p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-2">Correct Answer:</p>
                  <p className="text-lg text-green-700 font-medium">{question.correct_answer}</p>
                </div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex justify-between items-center gap-4 mb-6">
            <button
              onClick={() => setCurrentQuestion(Math.max(0, currentQuestion - 1))}
              disabled={currentQuestion === 0}
              className="px-6 py-3 bg-white text-deep-blue border-2 border-deep-blue rounded-lg font-semibold hover:bg-deep-blue hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-deep-blue"
            >
              Previous
            </button>

            <button
              onClick={() => setCurrentQuestion(Math.min(questions.length - 1, currentQuestion + 1))}
              disabled={currentQuestion === questions.length - 1}
              className="px-6 py-3 bg-vibrant-purple text-white rounded-lg font-semibold hover:bg-opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>

          {/* Question Dots */}
          <div className="flex flex-wrap justify-center gap-2">
            {questions.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentQuestion(index)}
                className={`w-10 h-10 rounded-full font-semibold transition-all ${
                  index === currentQuestion
                    ? 'bg-vibrant-purple text-white scale-110'
                    : 'bg-white text-deep-blue border-2 border-gray-300 hover:border-vibrant-purple'
                }`}
              >
                {index + 1}
              </button>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
