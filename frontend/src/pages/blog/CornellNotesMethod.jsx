import { Link } from 'react-router-dom';
import BlogLayout from '../../components/BlogLayout';

export default function CornellNotesMethod() {
  return (
    <BlogLayout
      title="The Cornell Notes Method (Made Practical): A Simple System for Better Recall"
      category="Study Tips"
      readTime="9 min read"
      updated="Updated Dec 2025"
    >
      <div className="prose prose-lg max-w-none">
        <p className="text-xl text-gray-700 mb-6">
          The Cornell Notes method is one of the most useful note-taking systems ever taught — but most students try it
          once, set up the page, and then never use it again. Not because it’s bad, but because the “right way” feels
          like extra work.
        </p>

        <p>
          This guide makes Cornell Notes practical. The goal is not prettier notes. The goal is better recall — so you can
          test yourself quickly, find gaps, and actually remember what you studied.
        </p>

        <h2>The Cornell Notes layout (the only part you need to remember)</h2>
        <ul>
          <li><strong>Notes (right side):</strong> What you write during class/reading.</li>
          <li><strong>Cues (left side):</strong> Questions and prompts that let you self-test later.</li>
          <li><strong>Summary (bottom):</strong> A 2–5 sentence “so what?” that captures the meaning.</li>
        </ul>

        <p>
          If you do nothing else, do this: turn your notes into questions. That’s what upgrades Cornell Notes from “a
          template” into active recall.
        </p>

        <h2>Why Cornell Notes works (when it works)</h2>
        <h3>It forces retrieval</h3>
        <p>
          When you cover the right-hand notes and answer the cues from memory, you’re practicing retrieval — the thing that
          actually strengthens memory. Re-reading is passive; retrieval is learning.
        </p>

        <h3>It turns review into a 5-minute routine</h3>
        <p>
          Most “review” becomes a 45-minute re-read because it has no structure. Cornell cues give you a checklist of
          questions to answer. You can do a quick pass daily and a deeper pass weekly.
        </p>

        <h2>How to do Cornell Notes without the perfectionism</h2>
        <ol>
          <li><strong>Write messy notes first.</strong> Capture ideas. Don’t format.</li>
          <li><strong>Immediately add 5–10 cues.</strong> One cue per key concept.</li>
          <li><strong>Add a short summary.</strong> Focus on meaning and connections.</li>
          <li><strong>Review with cover-and-recall.</strong> Answer cues without looking.</li>
        </ol>

        <p>
          You can do cues right after class or right after reading — even if it’s just 5 minutes. That timing matters:
          cues written the same day are higher quality, and the first review is easier.
        </p>

        <h2>What makes a good cue (examples)</h2>
        <p>A cue should be answerable from your notes, but not copy-paste obvious. Aim for prompts like:</p>
        <ul>
          <li><strong>Explain:</strong> “Explain X in one sentence.”</li>
          <li><strong>Compare:</strong> “How is X different from Y?”</li>
          <li><strong>Apply:</strong> “Where would you use X?”</li>
          <li><strong>Why:</strong> “Why does X happen?”</li>
          <li><strong>Steps:</strong> “List the steps of X.”</li>
        </ul>

        <h3>Example (Biology)</h3>
        <ul>
          <li>What is the role of ATP in cellular respiration?</li>
          <li>What’s the difference between glycolysis and the Krebs cycle?</li>
          <li>Why is oxygen needed at the end of the electron transport chain?</li>
        </ul>

        <h3>Example (History)</h3>
        <ul>
          <li>What were the 3 most important causes of X?</li>
          <li>How did policy Y change incentives for group Z?</li>
          <li>What was the second-order effect of event A?</li>
        </ul>

        <h2>The fastest way to review Cornell Notes</h2>
        <p>Try this routine:</p>
        <ul>
          <li><strong>Daily (5–10 minutes):</strong> Answer yesterday’s cues without looking.</li>
          <li><strong>Weekly (20 minutes):</strong> Answer cues for the whole week + rewrite summaries if needed.</li>
          <li><strong>Before exams:</strong> Convert your hardest cues into a quiz.</li>
        </ul>

        <p>
          If you want a shortcut for the exam phase, generate questions from your notes and use them as your cue column.
          That’s essentially Cornell Notes + quiz-first studying.
        </p>

        <div className="bg-purple-gradient text-white rounded-lg p-8 text-center mt-12">
          <h3 className="text-2xl font-bold mb-4">Turn Notes Into Cues Automatically</h3>
          <p className="mb-6">
            Use the Cornell Notes tool to generate cue-based notes, then quiz yourself to lock it in.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Link
              to="/cornell-notes"
              className="inline-block bg-coral-red text-white px-8 py-3 rounded-lg font-bold hover:bg-opacity-90 transition-all"
            >
              Open Cornell Notes
            </Link>
            <Link
              to="/quiz"
              className="inline-block bg-white text-deep-blue px-8 py-3 rounded-lg font-bold hover:bg-gray-100 transition-all"
            >
              Create a Quiz
            </Link>
          </div>
        </div>
      </div>
    </BlogLayout>
  );
}

