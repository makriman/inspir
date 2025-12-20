import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import API_URL from '../utils/api';
import ToolCard from '../components/ToolCard';
import { getToolById, getToolsByCategory, getLiveTools } from '../config/tools';

const CATEGORY_THEMES = {
  'Focus & Productivity': {
    gradient: 'from-indigo-600 via-purple-700 to-purple-900',
    accent: 'text-vibrant-yellow',
    bullets: [
      'Customizable sessions and smart reminders',
      'Distraction-reducing defaults with flexible controls',
      'Lightweight tracking to help you stay consistent',
    ],
  },
  Gamification: {
    gradient: 'from-orange-500 via-coral-red to-purple-800',
    accent: 'text-white',
    bullets: [
      'Goals, streak-friendly nudges, and satisfying progress feedback',
      'Meaningful milestones that reward consistency over cramming',
      'Optional competition and accountability (when you want it)',
    ],
  },
  'AI Help': {
    gradient: 'from-blue-700 via-indigo-700 to-purple-900',
    accent: 'text-vibrant-yellow',
    bullets: [
      'Clear, structured outputs designed for studying (not fluff)',
      'Fast iterations: refine, re-run, and improve with guardrails',
      'Privacy-aware: save only when you choose (backend later)',
    ],
  },
  Organization: {
    gradient: 'from-emerald-600 via-teal-700 to-indigo-900',
    accent: 'text-white',
    bullets: [
      'Simple workflows: plan → do → review',
      'Calendars and trackers built around real student schedules',
      'Clean overviews that reduce overwhelm',
    ],
  },
  'Visual Learning': {
    gradient: 'from-fuchsia-700 via-purple-700 to-indigo-900',
    accent: 'text-vibrant-yellow',
    bullets: [
      'Beautiful visuals with export/share in mind (backend later)',
      'Templates that keep diagrams readable and consistent',
      'Quick creation for revision and recall',
    ],
  },
  Social: {
    gradient: 'from-sky-700 via-indigo-700 to-purple-900',
    accent: 'text-white',
    bullets: [
      'Study with others without losing focus',
      'Lightweight collaboration tools designed for learning',
      'Community features that are safe and structured (backend later)',
    ],
  },
  Analytics: {
    gradient: 'from-slate-800 via-indigo-900 to-purple-900',
    accent: 'text-vibrant-yellow',
    bullets: [
      'Insights that actually change your study behavior',
      'Time + performance breakdowns across tools',
      'Weekly summaries that help you course-correct',
    ],
  },
};

function plannedBulletsForTool(tool) {
  const theme = CATEGORY_THEMES[tool.category];
  const base = theme?.bullets || [
    'A focused workflow designed for students',
    'Fast and clean UI with sensible defaults',
    'Optional saving/history (backend later)',
  ];

  const keywordBullets = (tool.keywords || [])
    .slice(0, 5)
    .map((k) => `Built around: ${k}`);

  return [...base, ...keywordBullets].slice(0, 6);
}

export default function ComingSoonTool() {
  const { toolId } = useParams();
  const tool = useMemo(() => getToolById(toolId), [toolId]);

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const theme = tool ? CATEGORY_THEMES[tool.category] : null;
  const planned = tool ? plannedBulletsForTool(tool) : [];

  const related = useMemo(() => {
    if (!tool) return [];
    const sameCategory = getToolsByCategory(tool.category).filter((t) => t.id !== tool.id);
    const live = new Set(getLiveTools().map((t) => t.id));
    return sameCategory
      .sort((a, b) => {
        const aLive = live.has(a.id) ? 0 : 1;
        const bLive = live.has(b.id) ? 0 : 1;
        if (aLive !== bLive) return aLive - bLive;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }, [tool]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!tool) return;

    setLoading(true);
    setError('');

    try {
      await axios.post(`${API_URL}/waitlist`, {
        email: email.trim(),
        tool_name: tool.name,
        tool_id: tool.id,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join waitlist. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!tool) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-dark to-purple-darker text-white flex items-center justify-center px-4">
        <div className="max-w-xl w-full bg-white/10 backdrop-blur-lg border border-white/10 rounded-3xl p-10 shadow-2xl text-center">
          <div className="text-5xl mb-4">🧭</div>
          <h1 className="text-3xl font-extrabold mb-3">Tool Not Found</h1>
          <p className="text-purple-100 mb-6">
            This tool page doesn’t exist (yet). Pick another tool from the toolkit.
          </p>
          <Link
            to="/"
            className="inline-flex items-center justify-center bg-white/15 border border-white/10 text-white px-5 py-3 rounded-xl font-semibold hover:bg-white/20 transition"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gradient-to-br ${theme?.gradient || 'from-purple-dark to-purple-darker'} text-white`}>
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Link
            to="/"
            className="inline-flex items-center gap-2 bg-white/10 border border-white/10 px-4 py-2 rounded-xl hover:bg-white/15 transition"
          >
            <span className="text-lg">←</span>
            <span className="font-semibold">Back</span>
          </Link>
          <span className="px-3 py-1 rounded-full bg-white/15 border border-white/10 text-sm font-bold tracking-wide">
            Coming Soon
          </span>
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <div className="bg-white/10 backdrop-blur-lg border border-white/10 rounded-3xl p-8 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="text-6xl leading-none">{tool.icon}</div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm uppercase tracking-[0.25em] ${theme?.accent || 'text-vibrant-yellow'}`}>
                  {tool.category}
                </p>
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mt-2">
                  {tool.name}
                </h1>
                <p className="text-purple-100 mt-3 text-lg">
                  {tool.description}
                </p>
              </div>
            </div>

            <div className="mt-8">
              <h2 className="text-xl font-bold mb-3">Planned Highlights</h2>
              <ul className="space-y-2 text-purple-50">
                {planned.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-1">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-8 shadow-2xl text-gray-900 border-2 border-white/20">
            {!submitted ? (
              <>
                <h2 className="text-2xl font-extrabold mb-2">Get Early Access</h2>
                <p className="text-gray-600 mb-6">
                  Join the waitlist and we’ll email you when <span className="font-semibold">{tool.name}</span> launches.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-primary-blue focus:outline-none transition-colors"
                  />

                  {error && (
                    <p className="text-red-600 text-sm">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-coral-red text-white font-bold py-3 rounded-xl hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Joining…' : 'Notify Me'}
                  </button>
                </form>

                <p className="text-xs text-gray-500 mt-4">
                  No spam. Unsubscribe anytime.
                </p>
              </>
            ) : (
              <div className="text-center py-10">
                <div className="text-5xl mb-3">✅</div>
                <h3 className="text-2xl font-extrabold text-green-700 mb-2">You’re on the list!</h3>
                <p className="text-gray-600">
                  We’ll email you when <span className="font-semibold">{tool.name}</span> is ready.
                </p>
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <div className="mt-12">
            <h2 className="text-2xl font-extrabold mb-4">More in {tool.category}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {related.map((t) => (
                <ToolCard key={t.id} tool={t} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

