import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import { Link } from 'react-router-dom';

export default function HowItWorks() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
        {/* Hero */}
        <div className="bg-gradient-to-r from-purple-dark to-purple-darker text-white py-16">
          <div className="max-w-4xl mx-auto px-4 text-center">
            <h1 className="text-4xl md:text-6xl font-bold mb-4">How inspir Works</h1>
            <p className="text-xl md:text-2xl text-purple-100">
              Pick a tool → paste notes or ask a question → learn with active recall
            </p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="bg-white rounded-2xl shadow-lg p-8 md:p-12 mb-8">
            <p className="text-xl text-gray-700 mb-10 text-center">
              inspir is an AI study toolkit. Quizzes are one part of it — you can also get step-by-step explanations, generate
              Cornell notes, create citations, run focused timer sessions, and build consistency.
            </p>

            <section className="mb-12">
              <h2 className="text-3xl font-bold text-deep-blue mb-4">1) Pick a workflow</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-purple-50 p-6 rounded-xl border border-purple-100">
                  <h3 className="text-xl font-bold text-deep-blue mb-2">🧠 Active recall (quiz-first)</h3>
                  <p className="text-gray-700 mb-3">
                    Generate questions from a topic or your notes. Answer without looking. Review mistakes. Repeat tomorrow.
                  </p>
                  <Link to="/quiz" className="text-purple-dark font-semibold hover:underline">Open Quiz Generator →</Link>
                </div>
                <div className="bg-purple-50 p-6 rounded-xl border border-purple-100">
                  <h3 className="text-xl font-bold text-deep-blue mb-2">🧩 Unblock a problem (doubt solving)</h3>
                  <p className="text-gray-700 mb-3">
                    Ask a question or upload a problem image and get a step-by-step explanation you can learn from.
                  </p>
                  <Link to="/doubt" className="text-purple-dark font-semibold hover:underline">Open Doubt Solver →</Link>
                </div>
                <div className="bg-purple-50 p-6 rounded-xl border border-purple-100">
                  <h3 className="text-xl font-bold text-deep-blue mb-2">🗒️ Notes that convert to memory</h3>
                  <p className="text-gray-700 mb-3">
                    Turn content into Cornell-style notes with cues and summaries so review becomes self-testing.
                  </p>
                  <Link to="/cornell-notes" className="text-purple-dark font-semibold hover:underline">Open Cornell Notes →</Link>
                </div>
                <div className="bg-purple-50 p-6 rounded-xl border border-purple-100">
                  <h3 className="text-xl font-bold text-deep-blue mb-2">⏱️ Focus sessions</h3>
                  <p className="text-gray-700 mb-3">
                    Run a Pomodoro timer, then end the session with a quiz or quick recall check to lock in learning.
                  </p>
                  <Link to="/study-timer" className="text-purple-dark font-semibold hover:underline">Open Study Timer →</Link>
                </div>
              </div>
            </section>

            <section className="mb-12">
              <h2 className="text-3xl font-bold text-deep-blue mb-4">2) Use the right input</h2>
              <div className="bg-white border border-gray-200 p-6 rounded-xl">
                <ul className="space-y-3 text-gray-700">
                  <li><strong>Topic:</strong> fastest way to start when you’re learning something broad.</li>
                  <li><strong>Paste text:</strong> best for targeted quizzes and note generation from a specific section.</li>
                  <li><strong>Upload notes:</strong> useful for longer materials (TXT/DOCX supported).</li>
                  <li><strong>Image upload:</strong> perfect for homework problems in the Doubt Solver.</li>
                </ul>
              </div>
            </section>

            <section className="mb-12">
              <h2 className="text-3xl font-bold text-deep-blue mb-4">3) Learn in a loop (this is the secret)</h2>
              <div className="bg-gradient-to-r from-purple-dark to-purple-darker text-white p-8 rounded-xl">
                <p className="text-purple-100 mb-4">
                  Tools don’t create learning — habits do. Use inspir to run a loop that builds memory:
                </p>
                <ol className="list-decimal pl-6 space-y-2">
                  <li>Generate output (quiz / explanation / notes)</li>
                  <li>Attempt from memory (don’t peek)</li>
                  <li>Review mistakes and rewrite the “why”</li>
                  <li>Repeat on a schedule (spaced repetition)</li>
                </ol>
              </div>
            </section>

            <section>
              <h2 className="text-3xl font-bold text-deep-blue mb-4">Quick links</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <Link to="/citations" className="bg-white border border-gray-200 p-5 rounded-xl hover:shadow-md transition">
                  <div className="font-bold text-deep-blue">Citation Generator</div>
                  <div className="text-gray-700 text-sm">Generate citations and keep sources organized</div>
                </Link>
                <Link to="/forum" className="bg-white border border-gray-200 p-5 rounded-xl hover:shadow-md transition">
                  <div className="font-bold text-deep-blue">Student Forum</div>
                  <div className="text-gray-700 text-sm">Ask questions and learn with others</div>
                </Link>
              </div>
            </section>
          </div>

          {/* CTA */}
          <div className="bg-purple-gradient text-white rounded-2xl p-8 md:p-12 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Start with one tool</h2>
            <p className="text-xl text-purple-100 mb-8">
              Pick a workflow and do one focused session. That’s how the habit starts.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/quiz"
                className="inline-block bg-coral-red text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-opacity-90 transition-all transform hover:scale-105 shadow-lg"
              >
                Try Quiz Generator →
              </Link>
              <Link
                to="/doubt"
                className="inline-block bg-white text-deep-blue px-8 py-4 rounded-xl font-bold hover:bg-gray-100 transition-all"
              >
                Use Doubt Solver →
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

