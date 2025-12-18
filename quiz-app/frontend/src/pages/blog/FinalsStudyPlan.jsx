import { Link } from 'react-router-dom';
import BlogLayout from '../../components/BlogLayout';

export default function FinalsStudyPlan() {
  return (
    <BlogLayout
      title="How to Study for Finals: A 7‑Day Plan Built on Active Recall"
      category="Study Tips"
      readTime="11 min read"
      updated="Updated Dec 2025"
    >
      <div className="prose prose-lg max-w-none">
        <p className="text-xl text-gray-700 mb-6">
          Most “finals prep” fails for one reason: it’s too vague. “Review everything” becomes re-reading, which becomes panic, which becomes
          cramming. The fix is a plan built on active recall.
        </p>

        <p>
          This 7-day plan is simple: break content into chunks, quiz yourself daily, and use mistakes to guide what you study next.
        </p>

        <h2>Before you start: set up your material</h2>
        <ul>
          <li>Collect notes, slides, and practice problems.</li>
          <li>List the exam topics (even rough is fine).</li>
          <li>Divide into 6–10 chunks you can finish in ~45 minutes each.</li>
        </ul>

        <h2>The 7-day plan</h2>
        <h3>Day 1–3: build the question bank</h3>
        <p>
          Each day, cover 2–3 chunks. For each chunk: generate a quiz, answer it, then write corrections. Your goal is to create a repeatable set
          of questions for every topic.
        </p>

        <h3>Day 4–5: targeted review (mistakes only)</h3>
        <p>
          Stop “reviewing everything.” Review only what you miss. Re-run quizzes, then spend extra time on the concepts that keep showing up on your
          error list.
        </p>

        <h3>Day 6: mixed practice</h3>
        <p>
          Mix topics like the exam will. Do shorter quizzes across multiple chapters. This builds flexible recall and reduces “chapter-based memory.”
        </p>

        <h3>Day 7: light recall + sleep</h3>
        <p>
          Do a short recall pass in the morning, then stop. Your brain consolidates memory during sleep — don’t sabotage it with last-minute
          all-nighters.
        </p>

        <h2>Daily template (works even if you’re busy)</h2>
        <ul>
          <li><strong>25–40 min:</strong> learn (one chunk)</li>
          <li><strong>10–15 min:</strong> quiz + corrections</li>
          <li><strong>2 min:</strong> write tomorrow’s “error targets”</li>
        </ul>

        <p>
          Use a timer to keep it frictionless. The{' '}
          <Link to="/study-timer" className="text-purple-dark font-semibold hover:underline">
            Study Timer
          </Link>{' '}
          makes this routine automatic.
        </p>

        <h2>The rule that changes everything</h2>
        <p>
          If you don’t test yourself, you didn’t study. Make questions the center of your plan.
        </p>

        <div className="bg-purple-gradient text-white rounded-lg p-8 text-center mt-12">
          <h3 className="text-2xl font-bold mb-4">Start Your Finals Plan</h3>
          <p className="mb-6">Turn one chunk of notes into a quiz and begin Day 1.</p>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Link
              to="/quiz"
              className="inline-block bg-coral-red text-white px-8 py-3 rounded-lg font-bold hover:bg-opacity-90 transition-all"
            >
              Create a Quiz
            </Link>
            <Link
              to="/blog/study-smarter-notes"
              className="inline-block bg-white text-deep-blue px-8 py-3 rounded-lg font-bold hover:bg-gray-100 transition-all"
            >
              Study smarter from notes
            </Link>
          </div>
        </div>
      </div>
    </BlogLayout>
  );
}

