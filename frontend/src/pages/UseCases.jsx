import Navigation from '../components/Navigation';
import { Link } from 'react-router-dom';

function UseCaseCard({ title, children }) {
  return (
    <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
      <h3 className="text-2xl font-semibold text-deep-blue mb-3">{title}</h3>
      <div className="text-gray-700 space-y-3">{children}</div>
    </div>
  );
}

export default function UseCases() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <article>
            <h1 className="text-4xl md:text-5xl font-bold text-deep-blue mb-6">How People Use inspir</h1>

            <div className="prose prose-lg max-w-none">
              <p className="text-xl text-gray-700 mb-8">
                inspir isn’t just a quiz generator anymore. It’s a toolkit you can combine into a study system: focus → learn → test → fix gaps → repeat.
                Here are real workflows that fit different goals.
              </p>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-6">For Students</h2>

                <UseCaseCard title="Exam Prep That Actually Works">
                  <p>
                    Start with a focused session using the <Link to="/study-timer" className="text-purple-dark font-semibold hover:underline">Study Timer</Link>.
                    Then use the <Link to="/quiz" className="text-purple-dark font-semibold hover:underline">Quiz Generator</Link> to test yourself from your notes.
                  </p>
                  <p>
                    Review what you missed, use the <Link to="/doubt" className="text-purple-dark font-semibold hover:underline">Doubt Solver</Link> to clarify weak spots,
                    and repeat tomorrow. Track consistency with <Link to="/streaks" className="text-purple-dark font-semibold hover:underline">Study Streaks</Link>.
                  </p>
                </UseCaseCard>

                <UseCaseCard title="Understanding Hard Concepts (Not Just Memorizing)">
                  <p>
                    When a topic feels confusing, start with the <Link to="/doubt" className="text-purple-dark font-semibold hover:underline">Doubt Solver</Link> to get a
                    step-by-step explanation in your own words.
                  </p>
                  <p>
                    Then generate a short quiz on the same section to prove you understand it. The quiz is your feedback loop.
                  </p>
                </UseCaseCard>

                <UseCaseCard title="Assignments & Writing: Stay Organized and Cite Correctly">
                  <p>
                    Use <Link to="/cornell-notes" className="text-purple-dark font-semibold hover:underline">Cornell Notes</Link> to structure readings into cues and summaries,
                    then keep sources clean with the <Link to="/citations" className="text-purple-dark font-semibold hover:underline">Citation Generator</Link>.
                  </p>
                </UseCaseCard>

                <UseCaseCard title="Study Groups That Don’t Waste Time">
                  <p>
                    One person creates a quiz from shared notes, then shares it. Compare answers, discuss gaps, and post tricky questions in the{' '}
                    <Link to="/forum" className="text-purple-dark font-semibold hover:underline">Student Forum</Link>.
                  </p>
                </UseCaseCard>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-6">For Teachers &amp; Educators</h2>

                <UseCaseCard title="Quick Checks for Understanding (Exit Tickets)">
                  <p>
                    Turn lesson plans or readings into a fast formative quiz and share the link with students. It’s a simple way to spot misconceptions early,
                    before they become exam-day surprises.
                  </p>
                  <p>
                    Tool: <Link to="/quiz" className="text-purple-dark font-semibold hover:underline">Quiz Generator</Link>.
                  </p>
                </UseCaseCard>

                <UseCaseCard title="Revision Packs Students Will Actually Use">
                  <p>
                    Create a structured summary with <Link to="/cornell-notes" className="text-purple-dark font-semibold hover:underline">Cornell Notes</Link>,
                    then pair it with a quiz for retrieval practice. Students get a clear “what to know” and a way to test it.
                  </p>
                </UseCaseCard>

                <UseCaseCard title="A Supportive Learning Community">
                  <p>
                    Encourage students to ask and answer each other’s questions in the <Link to="/forum" className="text-purple-dark font-semibold hover:underline">Student Forum</Link>.
                    The best revision often happens when students explain concepts to each other.
                  </p>
                </UseCaseCard>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-6">For Self-Learners &amp; Professionals</h2>

                <UseCaseCard title="Online Courses: Turn Videos into Real Knowledge">
                  <p>
                    Convert course notes into a quiz, then review weak areas with explanations. Add focused sessions with the{' '}
                    <Link to="/study-timer" className="text-purple-dark font-semibold hover:underline">Study Timer</Link> so your learning is consistent, not random.
                  </p>
                </UseCaseCard>

                <UseCaseCard title="Certification Prep When Time Is Limited">
                  <p>
                    Use short daily sessions, track consistency with <Link to="/streaks" className="text-purple-dark font-semibold hover:underline">Study Streaks</Link>, and
                    keep your practice measurable with quizzes. The aim is steady progress, not marathon cramming.
                  </p>
                </UseCaseCard>

                <UseCaseCard title="Reading Papers and Reports Without Re-Reading Forever">
                  <p>
                    Structure key points with <Link to="/cornell-notes" className="text-purple-dark font-semibold hover:underline">Cornell Notes</Link>, keep sources tidy with{' '}
                    <Link to="/citations" className="text-purple-dark font-semibold hover:underline">Citations</Link>, then quiz yourself on methods, results, and implications.
                  </p>
                </UseCaseCard>
              </section>

              <div className="bg-purple-gradient text-white rounded-lg p-8 text-center">
                <h2 className="text-2xl font-bold mb-4">Pick One Workflow and Start</h2>
                <p className="mb-6">
                  Don’t try to do everything at once. Start with one tool, then connect them into a system.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <Link
                    to="/how-it-works"
                    className="inline-block bg-white text-deep-blue px-8 py-3 rounded-lg font-bold hover:bg-opacity-90 transition-all"
                  >
                    How It Works
                  </Link>
                  <Link
                    to="/quiz"
                    className="inline-block bg-coral-red text-white px-8 py-3 rounded-lg font-bold hover:bg-opacity-90 transition-all"
                  >
                    Try Quiz Generator
                  </Link>
                </div>
              </div>
            </div>
          </article>
        </div>
      </main>
    </>
  );
}
