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
                We built inspir because studying shouldn’t be passive — and creating good practice questions shouldn’t take hours.
              </p>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">The Problem We're Solving</h2>
                <p className="text-gray-700 mb-4">
                  If you've ever tried to study for an exam, you know the struggle. You've got pages and pages of notes,
                  textbook chapters you're supposed to "review," and somehow you're expected to remember all of it.
                  Flashcards help, but making them takes forever. Practice tests would be great, but where do you even start?
                </p>
                <p className="text-gray-700 mb-4">
                  Teachers face the same issue from the other side. Creating good quiz questions that actually test understanding
                  (not just memorization) is genuinely hard work. It can take hours to write a quality 10-question quiz that
                  covers the material properly.
                </p>
                <p className="text-gray-700">
                  We thought: what if you could just paste your notes or upload your study materials and get a thoughtful,
                  well-designed quiz in seconds? That’s inspir.
                </p>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">How It Actually Works</h2>
                <p className="text-gray-700 mb-4">
                  inspir uses AI (Claude) to read your content and generate quiz questions that test real understanding.
                  Not just "what year did X happen" questions, but questions that make you think about why things matter and how concepts connect.
                </p>
                <p className="text-gray-700 mb-4">
                  The AI creates a mix of multiple choice questions (to test specific knowledge) and open-ended questions
                  (to test deeper understanding). It's designed to generate the kind of questions that actually help you learn,
                  not just regurgitate facts.
                </p>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Who This Is For</h2>
                <div className="grid md:grid-cols-2 gap-6 mb-6">
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-xl font-semibold text-deep-blue mb-3">Students</h3>
                    <p className="text-gray-700">
                      Turn your lecture notes, textbook chapters, or study guides into practice quizzes.
                      Perfect for exam prep, homework review, or just making sure you actually understand the material.
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-xl font-semibold text-deep-blue mb-3">Teachers</h3>
                    <p className="text-gray-700">
                      Create assessments from your lesson plans, reading materials, or curriculum documents in minutes instead of hours.
                      Spend less time writing quizzes, more time teaching.
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-xl font-semibold text-deep-blue mb-3">Self-Learners</h3>
                    <p className="text-gray-700">
                      Learning something new on your own? Create quizzes from articles, tutorials, or documentation
                      to actually test whether you're getting it. Active recall beats passive reading every time.
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-xl font-semibold text-deep-blue mb-3">Professionals</h3>
                    <p className="text-gray-700">
                      Preparing for certifications, training new team members, or brushing up on industry knowledge?
                      Turn your training materials into effective quizzes that ensure the information sticks.
                    </p>
                  </div>
                </div>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Why We Keep Signup Minimal</h2>
                <p className="text-gray-700 mb-4">
                  You might notice we don't ask for your email during signup. That's intentional. We only store your username
                  and password so you can save your quizzes and use account features.
                </p>
                <p className="text-gray-700 mb-4">
                  We’re focused on learning outcomes, not building a marketing database. If you forget your password, recovery
                  options are limited—use a password manager if you create an account.
                  For details on data handling, see our <Link to="/privacy" className="text-purple-dark font-semibold hover:underline">Privacy Policy</Link>.
                </p>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">The Mission</h2>
                <p className="text-gray-700 mb-4">
                  Learning should be active, not passive. Reading something once doesn't mean you've learned it.
                  Testing yourself, struggling with questions, and engaging with the material—that's how actual learning happens.
                </p>
                <p className="text-gray-700">
                  inspir exists to make that kind of active learning easy. We want to lower the barrier between
                  "I should study this" and actually testing your understanding. If we can make studying less painful
                  and more effective, we've done our job.
                </p>
              </section>

              <div className="bg-purple-gradient text-white rounded-lg p-8 text-center">
                <h2 className="text-2xl font-bold mb-4">Ready to Try It?</h2>
                <p className="mb-6">Create your first quiz in under a minute. No credit card, no lengthy signup.</p>
                <Link to="/" className="inline-block bg-coral-red text-white px-8 py-3 rounded-lg font-bold hover:bg-opacity-90 transition-all">
                  Create a Quiz
                </Link>
              </div>
            </div>
          </article>
        </div>
      </main>
      <Footer />
    </>
  );
}
