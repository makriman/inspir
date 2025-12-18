import { Link } from 'react-router-dom';
import BlogLayout from '../../components/BlogLayout';

export default function StudyStreaksHabits() {
  return (
    <BlogLayout
      title="Study Streaks That Work: How to Build Consistency Without Burnout"
      category="Study Habits"
      readTime="9 min read"
      updated="Updated Dec 2025"
    >
      <div className="prose prose-lg max-w-none">
        <p className="text-xl text-gray-700 mb-6">
          The students who improve fastest usually aren’t “more motivated”. They’re more consistent. A streak is useful when it supports a system — and harmful when it
          becomes pressure.
        </p>

        <p>
          This guide shows how to use streaks in a healthy way: small daily minimums, short focus sessions, and active learning that builds real memory.
        </p>

        <h2>What a streak should do (and what it shouldn’t)</h2>
        <ul>
          <li><strong>Do:</strong> lower friction and make the next session easier to start.</li>
          <li><strong>Do:</strong> keep you honest about consistency.</li>
          <li><strong>Don’t:</strong> force marathon sessions when you’re exhausted.</li>
          <li><strong>Don’t:</strong> turn studying into anxiety about a number.</li>
        </ul>

        <h2>Set a “daily minimum” you can do on bad days</h2>
        <p>
          Your streak should be protected by a minimum that’s almost impossible to fail. Examples: 10 minutes of focused study, or one short quiz.
          The minimum is not your goal. It’s your <strong>floor</strong>.
        </p>

        <h2>Use a timer to make consistency automatic</h2>
        <p>
          Open the{' '}
          <Link to="/study-timer" className="text-purple-dark font-semibold hover:underline">
            Study Timer
          </Link>
          , set 20–25 minutes, and commit to finishing the session. Consistency comes from finishing sessions, not planning them.
        </p>

        <h2>Make sessions “active” so you improve faster</h2>
        <p>
          If your streak is built on passive review, you’ll feel busy and improve slowly. Add one active step to every session:
        </p>
        <ul>
          <li>
            End with the <Link to="/quiz" className="text-purple-dark font-semibold hover:underline">Quiz Generator</Link> (retrieval practice)
          </li>
          <li>
            Fix one gap with the <Link to="/doubt" className="text-purple-dark font-semibold hover:underline">Doubt Solver</Link> (clarity)
          </li>
        </ul>

        <h2>Track the streak, but track progress too</h2>
        <p>
          Streaks keep you showing up. But improvement comes from targeting weak areas. Use{' '}
          <Link to="/streaks" className="text-purple-dark font-semibold hover:underline">
            Study Streaks
          </Link>
          {' '}to stay consistent, and keep an “error list” of concepts you miss so each session has direction.
        </p>

        <h2>How to recover when you break the streak</h2>
        <p>
          Everyone breaks streaks. The goal is to return fast. A simple rule: <strong>never miss twice</strong>. Do a 10-minute minimum session today, then return to your
          normal routine tomorrow.
        </p>

        <div className="bg-purple-gradient text-white rounded-lg p-8 text-center mt-12">
          <h3 className="text-2xl font-bold mb-4">Start a streak that helps you learn</h3>
          <p className="mb-6">Set a daily minimum and make each session active.</p>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Link
              to="/streaks"
              className="inline-block bg-coral-red text-white px-8 py-3 rounded-lg font-bold hover:bg-opacity-90 transition-all"
            >
              Open Study Streaks
            </Link>
            <Link
              to="/study-timer"
              className="inline-block bg-white text-deep-blue px-8 py-3 rounded-lg font-bold hover:bg-gray-100 transition-all"
            >
              Open Study Timer
            </Link>
          </div>
        </div>
      </div>
    </BlogLayout>
  );
}

