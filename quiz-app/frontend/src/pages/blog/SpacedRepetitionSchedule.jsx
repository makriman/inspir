import { Link } from 'react-router-dom';
import BlogLayout from '../../components/BlogLayout';

export default function SpacedRepetitionSchedule() {
  return (
    <BlogLayout
      title="Spaced Repetition Schedule: A Simple Plan That Actually Works"
      category="Learning Science"
      readTime="9 min read"
      updated="Updated Dec 2025"
    >
      <div className="prose prose-lg max-w-none">
        <p className="text-xl text-gray-700 mb-6">
          Spaced repetition sounds complicated until you realize it’s just one idea: review right before you forget.
          The spacing is what turns short-term memory into long-term memory.
        </p>

        <p>
          This article gives you a simple schedule you can use for any subject — and a practical way to apply it using short quizzes.
        </p>

        <h2>Why spacing beats cramming</h2>
        <p>
          Cramming creates a temporary boost. Spacing builds durable recall. Each spaced review forces retrieval again, which strengthens the
          memory trace and makes the next recall easier.
        </p>

        <h2>The “1–3–7–14” schedule</h2>
        <p>For a new topic you learned today:</p>
        <ul>
          <li><strong>Day 1:</strong> learn + first quiz</li>
          <li><strong>Day 3:</strong> re-quiz and fix mistakes</li>
          <li><strong>Day 7:</strong> re-quiz (short)</li>
          <li><strong>Day 14:</strong> final review pass</li>
        </ul>

        <p>
          If an exam is soon, compress the spacing (1–2–4–7). If an exam is far, expand it (1–3–7–14–30).
        </p>

        <h2>What to do on each review day</h2>
        <h3>Do: answer questions, not reread</h3>
        <p>
          Use a quiz to drive review. The moment you struggle is the moment your brain learns what to keep.
        </p>

        <h3>Do: keep an “error list”</h3>
        <p>
          Your fastest progress comes from what you get wrong. Keep a short list of “missed concepts” and target them first on review days.
        </p>

        <h2>How to run it with a timer (no willpower required)</h2>
        <p>
          Consistency matters more than intensity. A reliable pattern is: open a timer → do a focused session → end with a quiz.
        </p>
        <p>
          If you want a ready-made routine, use the{' '}
          <Link to="/study-timer" className="text-purple-dark font-semibold hover:underline">
            Study Timer
          </Link>
          {' '}and finish your session with a short quiz.
        </p>

        <h2>Common mistakes</h2>
        <ul>
          <li><strong>Reviewing too late:</strong> if you wait until you’ve fully forgotten, relearning is slow.</li>
          <li><strong>Reviewing too early:</strong> if it’s still easy, you’re mostly wasting time.</li>
          <li><strong>No variation:</strong> add application questions so you can use the concept, not just recite it.</li>
        </ul>

        <div className="bg-purple-gradient text-white rounded-lg p-8 text-center mt-12">
          <h3 className="text-2xl font-bold mb-4">Build a Spaced Quiz Routine</h3>
          <p className="mb-6">Generate a quiz once, then re-run it on a schedule.</p>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Link
              to="/quiz"
              className="inline-block bg-coral-red text-white px-8 py-3 rounded-lg font-bold hover:bg-opacity-90 transition-all"
            >
              Create a Quiz
            </Link>
            <Link
              to="/blog/science-active-recall"
              className="inline-block bg-white text-deep-blue px-8 py-3 rounded-lg font-bold hover:bg-gray-100 transition-all"
            >
              Read the science
            </Link>
          </div>
        </div>
      </div>
    </BlogLayout>
  );
}

