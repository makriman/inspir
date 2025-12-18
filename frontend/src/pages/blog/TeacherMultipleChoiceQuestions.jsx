import { Link } from 'react-router-dom';
import BlogLayout from '../../components/BlogLayout';

export default function TeacherMultipleChoiceQuestions() {
  return (
    <BlogLayout
      title="How to Write Better Multiple Choice Questions (Teacher Guide)"
      category="For Teachers"
      readTime="10 min read"
      updated="Updated Dec 2025"
    >
      <div className="prose prose-lg max-w-none">
        <p className="text-xl text-gray-700 mb-6">
          Multiple choice questions (MCQs) can be excellent — or they can be a recognition game that doesn’t measure understanding.
          The difference is how you write them.
        </p>

        <p>
          This guide gives you a simple framework for writing MCQs that test concepts, reveal misconceptions, and are faster to create and review.
        </p>

        <h2>What a good MCQ actually tests</h2>
        <ul>
          <li><strong>Concepts:</strong> not isolated facts</li>
          <li><strong>Distinctions:</strong> common confusions between similar ideas</li>
          <li><strong>Application:</strong> using the concept in a new situation</li>
        </ul>

        <h2>The stem: write it like a real question</h2>
        <p>
          The stem is the prompt. Good stems are specific and unambiguous. If students can’t restate what you’re asking, the stem is the problem.
        </p>
        <ul>
          <li>Prefer <strong>“Which explanation best describes…”</strong> over <strong>“What is…”</strong></li>
          <li>Include context (short scenario) when testing application</li>
          <li>Avoid trick wording and double negatives</li>
        </ul>

        <h2>Distractors: make wrong answers informative</h2>
        <p>
          The best distractors map to real misconceptions. If an option is obviously wrong, it teaches nothing.
        </p>
        <ul>
          <li>Use the 2–3 most common student errors as distractors</li>
          <li>Keep option lengths similar (no “giveaway” long answer)</li>
          <li>Avoid “all of the above” unless you have a strong reason</li>
        </ul>

        <h2>Fast workflow for teachers</h2>
        <ol>
          <li>Paste your lesson plan or reading excerpt.</li>
          <li>Generate a first draft of questions.</li>
          <li>Replace weak distractors with your students’ real misconceptions.</li>
          <li>Use the quiz as a quick formative check.</li>
        </ol>

        <p>
          If you want a bigger classroom workflow, see{' '}
          <Link to="/blog/teachers-lesson-plans" className="text-purple-dark font-semibold hover:underline">
            Creating Assessments From Lesson Plans
          </Link>
          .
        </p>

        <h2>A quality checklist (30 seconds per question)</h2>
        <ul>
          <li>Does the stem test an outcome (not trivia)?</li>
          <li>Is there exactly one best answer?</li>
          <li>Are distractors plausible and instructive?</li>
          <li>Would a student’s wrong choice reveal a specific misconception?</li>
        </ul>

        <div className="bg-purple-gradient text-white rounded-lg p-8 text-center mt-12">
          <h3 className="text-2xl font-bold mb-4">Generate a Teacher-Friendly Quiz Draft</h3>
          <p className="mb-6">Create a first draft fast, then refine it with your classroom misconceptions.</p>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Link
              to="/quiz"
              className="inline-block bg-coral-red text-white px-8 py-3 rounded-lg font-bold hover:bg-opacity-90 transition-all"
            >
              Create a Quiz
            </Link>
            <Link
              to="/use-cases"
              className="inline-block bg-white text-deep-blue px-8 py-3 rounded-lg font-bold hover:bg-gray-100 transition-all"
            >
              See teacher use cases
            </Link>
          </div>
        </div>
      </div>
    </BlogLayout>
  );
}

