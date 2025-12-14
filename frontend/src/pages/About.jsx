import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import { Link } from 'react-router-dom';

export default function About() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <article>
            <h1 className="text-4xl md:text-5xl font-bold text-deep-blue mb-6">About inspir</h1>

            <div className="prose prose-lg max-w-none">
              <p className="text-xl text-gray-700 mb-8">
                inspir began as a simple idea: studying shouldn’t be passive, and creating good practice questions shouldn’t take hours.
                We started with quizzes. We’ve evolved into a complete AI study toolkit.
              </p>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">What inspir Is Now</h2>
                <p className="text-gray-700 mb-4">
                  The best learning loop is simple: focus, learn, test yourself, fix gaps, repeat. inspir is built to support that loop end-to-end.
                </p>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-xl font-semibold text-deep-blue mb-3">Active Learning</h3>
                    <p className="text-gray-700">
                      Use the <Link to="/quiz" className="text-purple-dark font-semibold hover:underline">Quiz Generator</Link> to turn topics or notes into practice,
                      and make retrieval practice a habit—not a last-minute panic.
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-xl font-semibold text-deep-blue mb-3">Step-by-Step Help</h3>
                    <p className="text-gray-700">
                      Use the <Link to="/doubt" className="text-purple-dark font-semibold hover:underline">Doubt Solver</Link> when you’re stuck, then go back to practice
                      so the concept actually sticks.
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-xl font-semibold text-deep-blue mb-3">Structure &amp; Organization</h3>
                    <p className="text-gray-700">
                      Create cue-based revision using <Link to="/cornell-notes" className="text-purple-dark font-semibold hover:underline">Cornell Notes</Link>, and keep
                      your writing workflow clean with the <Link to="/citations" className="text-purple-dark font-semibold hover:underline">Citation Generator</Link>.
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-xl font-semibold text-deep-blue mb-3">Focus &amp; Consistency</h3>
                    <p className="text-gray-700">
                      Stay on track with the <Link to="/study-timer" className="text-purple-dark font-semibold hover:underline">Study Timer</Link> and build momentum with{' '}
                      <Link to="/streaks" className="text-purple-dark font-semibold hover:underline">Study Streaks</Link>. Learn with others in the{' '}
                      <Link to="/forum" className="text-purple-dark font-semibold hover:underline">Student Forum</Link>.
                    </p>
                  </div>
                </div>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">What We Believe About Learning</h2>
                <p className="text-gray-700 mb-4">
                  Most people “study” by re-reading, highlighting, or passively watching videos. It feels productive—but it doesn’t reliably build memory.
                </p>
                <p className="text-gray-700">
                  inspir is designed around active learning: retrieval practice (testing yourself), spaced review, and focused sessions. The goal isn’t more time studying.
                  It’s more learning per minute.
                </p>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Privacy, By Design</h2>
                <p className="text-gray-700 mb-4">
                  We keep signup minimal (no email required). You can try inspir without an account, and create one if you want saved history or personalization.
                </p>
                <p className="text-gray-700">
                  For details on data handling, see our{' '}
                  <Link to="/privacy" className="text-purple-dark font-semibold hover:underline">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </section>

              <div className="bg-purple-gradient text-white rounded-lg p-8 text-center">
                <h2 className="text-2xl font-bold mb-4">Build Your Study System</h2>
                <p className="mb-6">Start with one tool today, then connect them into a workflow that fits you.</p>
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
      <Footer />
    </>
  );
}
