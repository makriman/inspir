import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import { useAuth } from '../contexts/AuthContext';
import API_URL from '../utils/api';

const SUBJECT_TAGS = [
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'Computer Science',
  'History',
  'Literature',
  'Economics',
  'Languages',
];

export default function StudentForum() {
  const { user, session } = useAuth();
  const navigate = useNavigate();

  const [questions, setQuestions] = useState([]);
  const [stats, setStats] = useState({ total_questions: 0, total_answers: 0, total_upvotes: 0 });
  const [leaderboard, setLeaderboard] = useState([]);
  const [userReputation, setUserReputation] = useState(0);
  const [activeTag, setActiveTag] = useState('All');
  const [loading, setLoading] = useState(true);
  const [askForm, setAskForm] = useState({
    title: '',
    details: '',
    tags: [],
  });
  const [formError, setFormError] = useState('');
  const [answerDrafts, setAnswerDrafts] = useState({});
  const [userVotes, setUserVotes] = useState(new Set());

  useEffect(() => {
    fetchQuestions();
    fetchStats();
    fetchLeaderboard();
    if (user) {
      fetchUserReputation();
    }
  }, [activeTag, user]);

  const fetchQuestions = async () => {
    try {
      const response = await axios.get(`${API_URL}/forum/questions`, {
        params: { tag: activeTag }
      });
      setQuestions(response.data.questions);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching questions:', error);
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API_URL}/forum/stats`);
      setStats(response.data.stats);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const response = await axios.get(`${API_URL}/forum/leaderboard`);
      setLeaderboard(response.data.leaderboard);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    }
  };

  const fetchUserReputation = async () => {
    try {
      const response = await axios.get(`${API_URL}/forum/reputation`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      setUserReputation(response.data.reputation);
    } catch (error) {
      console.error('Error fetching reputation:', error);
    }
  };

  const toggleAskTag = (tag) => {
    setAskForm((prev) => {
      const hasTag = prev.tags.includes(tag);
      return {
        ...prev,
        tags: hasTag ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag],
      };
    });
  };

  const handleAskSubmit = async (e) => {
    e.preventDefault();

    if (!user) {
      navigate('/auth');
      return;
    }

    const title = askForm.title.trim();
    const details = askForm.details.trim();

    if (!title || !details) {
      setFormError('Add a clear title and enough detail so others can help.');
      return;
    }

    if (askForm.tags.length === 0) {
      setFormError('Select at least one subject tag.');
      return;
    }

    try {
      const response = await axios.post(
        `${API_URL}/forum/questions`,
        {
          title,
          details,
          tags: askForm.tags
        },
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      setQuestions((prev) => [response.data.question, ...prev]);
      setFormError('');
      setAskForm({ title: '', details: '', tags: [] });
      fetchStats();
    } catch (error) {
      setFormError(error.response?.data?.error || 'Failed to post question');
    }
  };

  const handleAddAnswer = async (questionId) => {
    if (!user) {
      navigate('/auth');
      return;
    }

    const draft = (answerDrafts[questionId] || '').trim();
    if (!draft) return;

    try {
      const response = await axios.post(
        `${API_URL}/forum/questions/${questionId}/answers`,
        { text: draft },
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId
            ? { ...q, answers: [response.data.answer, ...q.answers] }
            : q
        )
      );

      setAnswerDrafts((prev) => ({ ...prev, [questionId]: '' }));
      fetchStats();
      fetchUserReputation();
    } catch (error) {
      console.error('Error adding answer:', error);
    }
  };

  const handleUpvote = async (questionId, answerId) => {
    if (!user) {
      navigate('/auth');
      return;
    }

    try {
      await axios.post(
        `${API_URL}/forum/answers/${answerId}/upvote`,
        {},
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId
            ? {
                ...q,
                answers: q.answers.map((a) =>
                  a.id === answerId ? { ...a, vote_count: a.vote_count + 1 } : a
                ),
              }
            : q
        )
      );

      setUserVotes((prev) => new Set([...prev, answerId]));
      fetchStats();
      fetchLeaderboard();
    } catch (error) {
      console.error('Error upvoting answer:', error);
      alert(error.response?.data?.error || 'Failed to upvote');
    }
  };

  const setDraft = (questionId, value) => {
    setAnswerDrafts((prev) => ({ ...prev, [questionId]: value }));
  };

  const subjectFilterTags = ['All', ...SUBJECT_TAGS];

  const filteredQuestions = useMemo(() => {
    if (activeTag === 'All') return questions;
    return questions.filter((q) => q.tags.includes(activeTag));
  }, [activeTag, questions]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-b from-purple-50 via-white to-purple-50">
        <Navigation />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-xl text-gray-600">Loading forum...</div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <>
      <Navigation />

      <main className="min-h-screen bg-gradient-to-b from-purple-50 to-blue-50">
        <div className="max-w-6xl mx-auto px-4 py-10 md:py-14">
          <div className="bg-white/90 backdrop-blur-lg rounded-3xl shadow-xl border border-purple-100 p-6 md:p-10">
            <p className="text-sm uppercase tracking-widest font-semibold text-purple-dark mb-2">Student Q&A Forum</p>
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h1 className="text-4xl md:text-5xl font-bold text-deep-blue mb-3">
                  Ask homework questions. Upvote the best answers.
                </h1>
                <p className="text-gray-600 text-lg max-w-2xl">
                  A focused space for students to get unstuck fast, surface the strongest explanations, and
                  reward peers with reputation points when their answers help.
                </p>
              </div>
              {user && (
                <div className="bg-gradient-to-r from-purple-dark to-purple-darker text-white rounded-2xl p-5 w-full lg:w-72 shadow-lg">
                  <p className="text-sm opacity-80 mb-2">Your Reputation</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold">{userReputation}</span>
                    <span className="text-sm uppercase tracking-wide opacity-75">pts</span>
                  </div>
                  <p className="text-sm mt-2 opacity-80">Earn +10 when your answers get upvoted.</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mt-8">
              <StatCard label="Open questions" value={stats.total_questions} accent="from-purple-dark to-purple-darker" />
              <StatCard label="Answers shared" value={stats.total_answers} accent="from-blue-500 to-purple-dark" />
              <StatCard label="Upvotes given" value={stats.total_upvotes} accent="from-coral-red to-amber-500" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
              <div className="lg:col-span-2 space-y-6">
                <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-deep-blue">Latest homework questions</h2>
                      <p className="text-gray-500">Filter by subject tags and upvote the clearest answers.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {subjectFilterTags.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setActiveTag(tag)}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition ${
                            activeTag === tag
                              ? 'bg-purple-dark text-white shadow-md'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 space-y-5">
                    {filteredQuestions.map((question) => (
                      <article key={question.id} className="border border-gray-100 rounded-2xl p-5 bg-white shadow-xs">
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          {question.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-darker border border-purple-100"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        <h3 className="text-xl font-semibold text-deep-blue">{question.title}</h3>
                        <p className="text-gray-600 mt-2">{question.details}</p>

                        <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
                          <span className="font-semibold text-purple-darker">
                            {question.answers?.length || 0} answers
                          </span>
                          <span>
                            Asked by <strong className="text-deep-blue">{question.user?.username || 'Unknown'}</strong>
                          </span>
                        </div>

                        <div className="mt-5 border-t border-gray-100 pt-4 space-y-3">
                          {question.answers?.map((answer) => (
                            <div key={answer.id} className="flex gap-3 items-start rounded-xl border border-gray-100 p-4 bg-gray-50">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                                  <span className="font-semibold text-deep-blue">
                                    {answer.user?.username || 'Unknown'}
                                  </span>
                                </div>
                                <p className="text-gray-700">{answer.text}</p>
                              </div>
                              <div className="flex flex-col items-center">
                                <button
                                  onClick={() => handleUpvote(question.id, answer.id)}
                                  className="bg-white border border-purple-100 text-purple-darker px-3 py-1 rounded-lg font-semibold hover:bg-purple-50 transition disabled:opacity-50"
                                  disabled={!user}
                                >
                                  ▲ Upvote
                                </button>
                                <span className="text-sm text-gray-600 mt-2">{answer.vote_count || 0} votes</span>
                              </div>
                            </div>
                          ))}

                          <div className="mt-3">
                            <label className="block text-sm font-semibold text-deep-blue mb-2">
                              Add your answer
                            </label>
                            <div className="flex flex-col md:flex-row gap-3">
                              <input
                                type="text"
                                value={answerDrafts[question.id] || ''}
                                onChange={(e) => setDraft(question.id, e.target.value)}
                                placeholder={user ? "Share a concise explanation..." : "Sign in to answer"}
                                disabled={!user}
                                className="flex-1 px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-dark disabled:bg-gray-100"
                              />
                              <button
                                onClick={() => handleAddAnswer(question.id)}
                                disabled={!user}
                                className="px-4 py-3 bg-purple-dark text-white rounded-lg font-semibold hover:bg-purple-darker transition disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Post answer
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                    {filteredQuestions.length === 0 && (
                      <div className="text-center text-gray-600 border border-dashed border-purple-200 rounded-2xl py-10">
                        No questions for this tag yet. Be the first to ask!
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <aside className="space-y-6">
                <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
                  <h3 className="text-xl font-bold text-deep-blue mb-2">Ask a homework question</h3>
                  <p className="text-gray-500 text-sm mb-4">Be specific so peers can jump in fast.</p>
                  {!user && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                      Please <button onClick={() => navigate('/auth')} className="underline font-semibold">sign in</button> to ask questions
                    </div>
                  )}
                  <form className="space-y-4" onSubmit={handleAskSubmit}>
                    <div>
                      <label className="block text-sm font-semibold text-deep-blue mb-1">Title</label>
                      <input
                        type="text"
                        value={askForm.title}
                        onChange={(e) => setAskForm((prev) => ({ ...prev, title: e.target.value }))}
                        placeholder="e.g., How do I graph inverse trig functions quickly?"
                        disabled={!user}
                        className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-dark disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-deep-blue mb-1">Details</label>
                      <textarea
                        value={askForm.details}
                        onChange={(e) => setAskForm((prev) => ({ ...prev, details: e.target.value }))}
                        rows="4"
                        placeholder="What have you tried? What exactly is confusing? Share context like textbook pages or assignment parts."
                        disabled={!user}
                        className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-dark disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-deep-blue mb-2">Tag by subject</p>
                      <div className="flex flex-wrap gap-2">
                        {SUBJECT_TAGS.map((tag) => {
                          const selected = askForm.tags.includes(tag);
                          return (
                            <button
                              type="button"
                              key={tag}
                              onClick={() => toggleAskTag(tag)}
                              disabled={!user}
                              className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition ${
                                selected
                                  ? 'bg-purple-dark text-white border-purple-darker'
                                  : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                              } disabled:opacity-50`}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {formError && <p className="text-red-600 text-sm">{formError}</p>}
                    <button
                      type="submit"
                      disabled={!user}
                      className="w-full bg-coral-red text-white py-3 rounded-lg font-semibold hover:bg-opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Post question
                    </button>
                  </form>
                </section>

                <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
                  <h3 className="text-xl font-bold text-deep-blue mb-2">Top contributors</h3>
                  <ul className="space-y-3">
                    {leaderboard.slice(0, 5).map((entry) => (
                      <li key={entry.user_id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                        <div>
                          <p className="font-semibold text-deep-blue">{entry.user?.username || 'Unknown'}</p>
                        </div>
                        <span className="px-3 py-1 rounded-full bg-white border border-purple-100 text-purple-darker font-semibold text-sm">
                          {entry.reputation} rep
                        </span>
                      </li>
                    ))}
                    {leaderboard.length === 0 && (
                      <li className="text-center text-gray-500 py-3">No contributors yet</li>
                    )}
                  </ul>
                </section>

                <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
                  <h3 className="text-xl font-bold text-deep-blue mb-3">How reputation works</h3>
                  <ul className="space-y-2 text-gray-600 text-sm">
                    <li>▲ Upvote a helpful answer: author gains +10 rep.</li>
                    <li>Post your own answers: earn +2 starter rep per answer added.</li>
                    <li>Tag questions well so the right subject experts see them.</li>
                    <li>Clear, concise explanations get upvoted fastest.</li>
                  </ul>
                </section>
              </aside>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className={`rounded-2xl p-5 text-white bg-gradient-to-r ${accent} shadow-lg`}>
      <p className="text-sm uppercase tracking-wide opacity-80">{label}</p>
      <div className="text-3xl font-bold mt-2">{value}</div>
    </div>
  );
}
