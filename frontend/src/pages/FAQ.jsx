import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import { Link } from 'react-router-dom';

function FaqCard({ question, children }) {
  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <h3 className="text-xl font-bold text-deep-blue mb-2">{question}</h3>
      <div className="text-gray-700">{children}</div>
    </div>
  );
}

export default function FAQ() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <article>
            <h1 className="text-4xl md:text-5xl font-bold text-deep-blue mb-6">Frequently Asked Questions</h1>

            <div className="prose prose-lg max-w-none">
              <p className="text-xl text-gray-700 mb-8">
                inspir started as a quiz generator. It’s now a full AI study toolkit—built to help you learn actively, stay focused, and
                close gaps faster.
              </p>

              <div className="space-y-10">
                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">Basics</h2>
                  <div className="space-y-4">
                    <FaqCard question="What is inspir?">
                      <p>
                        inspir is an AI-powered study toolkit. Use it to test yourself with the{' '}
                        <Link to="/quiz" className="text-purple-dark font-semibold hover:underline">
                          Quiz Generator
                        </Link>
                        , get step-by-step help with the{' '}
                        <Link to="/doubt" className="text-purple-dark font-semibold hover:underline">
                          Doubt Solver
                        </Link>
                        , structure your revision with{' '}
                        <Link to="/cornell-notes" className="text-purple-dark font-semibold hover:underline">
                          Cornell Notes
                        </Link>
                        , keep sources organized with the{' '}
                        <Link to="/citations" className="text-purple-dark font-semibold hover:underline">
                          Citation Generator
                        </Link>
                        , and stay consistent with the{' '}
                        <Link to="/study-timer" className="text-purple-dark font-semibold hover:underline">
                          Study Timer
                        </Link>{' '}
                        and{' '}
                        <Link to="/streaks" className="text-purple-dark font-semibold hover:underline">
                          Study Streaks
                        </Link>
                        .
                      </p>
                    </FaqCard>

                    <FaqCard question="Is inspir free?">
                      <p>
                        inspir is currently free to use. You can try tools as a guest, and create an account to save work and access
                        account-based features.
                      </p>
                    </FaqCard>

                    <FaqCard question="Do I need an account?">
                      <p>
                        No. Guest mode is great for a quick session. Create an account if you want saved items, history, or tools that
                        require a signed-in session.
                      </p>
                    </FaqCard>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">Using The Toolkit</h2>
                  <div className="space-y-4">
                    <FaqCard question="What should I start with?">
                      <p className="mb-3">Pick the tool that matches your goal:</p>
                      <ul className="list-disc pl-6 space-y-1">
                        <li>
                          Remember more: <Link to="/quiz" className="text-purple-dark font-semibold hover:underline">Quiz Generator</Link>
                        </li>
                        <li>
                          Unblock confusion: <Link to="/doubt" className="text-purple-dark font-semibold hover:underline">Doubt Solver</Link>
                        </li>
                        <li>
                          Build a revision system: <Link to="/cornell-notes" className="text-purple-dark font-semibold hover:underline">Cornell Notes</Link>
                        </li>
                        <li>
                          Stay focused: <Link to="/study-timer" className="text-purple-dark font-semibold hover:underline">Study Timer</Link>
                        </li>
                        <li>
                          Keep momentum: <Link to="/streaks" className="text-purple-dark font-semibold hover:underline">Study Streaks</Link>
                        </li>
                      </ul>
                    </FaqCard>

                    <FaqCard question="What can I generate a quiz from?">
                      <p>
                        Type a topic, paste text, or upload notes (supported formats include TXT and DOCX). Uploading notes usually gives
                        more targeted questions.
                      </p>
                      <p className="mt-3">
                        Quick start: <Link to="/quiz" className="text-purple-dark font-semibold hover:underline">Create a quiz</Link>.
                      </p>
                    </FaqCard>

                    <FaqCard question="Can I share quizzes or explanations?">
                      <p>
                        Yes. inspir supports shareable links so you can send a quiz (or a shared doubt/explanation) to classmates or friends.
                      </p>
                    </FaqCard>

                    <FaqCard question="What is the Student Forum for?">
                      <p>
                        The <Link to="/forum" className="text-purple-dark font-semibold hover:underline">Student Forum</Link> is a place to ask questions, share
                        study strategies, and learn with others.
                      </p>
                    </FaqCard>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">AI Safety &amp; Accuracy</h2>
                  <div className="space-y-4">
                    <FaqCard question="How accurate is the AI?">
                      <p>
                        AI can make mistakes. Use inspir as a study accelerator, not a single source of truth—especially for technical,
                        medical, or legal topics. When it matters, verify against your course materials or reputable sources.
                      </p>
                    </FaqCard>

                    <FaqCard question="Is this okay for school rules and academic integrity?">
                      <p>
                        Use inspir to learn and practice—not to submit AI-written work as your own. Good workflows are: explain a concept,
                        generate practice questions, and check understanding. Always follow your institution’s policies.
                      </p>
                    </FaqCard>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">Privacy</h2>
                  <div className="space-y-4">
                    <FaqCard question="Why don’t you ask for my email?">
                      <p>
                        We keep signup lightweight. inspir uses a username + password so you can save your work without building a marketing list.
                        If you forget your password, recovery options are limited—use a password manager.
                      </p>
                    </FaqCard>

                    <FaqCard question="Do you store the notes I upload?">
                      <p>
                        Your notes are processed to generate outputs. Saved quizzes store generated questions and answers; they don’t need to permanently
                        store your raw notes to be useful.
                      </p>
                      <p className="mt-3">
                        Details: <Link to="/privacy" className="text-purple-dark font-semibold hover:underline">Privacy Policy</Link>.
                      </p>
                    </FaqCard>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">Support</h2>
                  <div className="space-y-4">
                    <FaqCard question="I found a bug or have a feature request — how do I report it?">
                      <p>
                        Post in the <Link to="/forum" className="text-purple-dark font-semibold hover:underline">Student Forum</Link> with what you expected to happen,
                        what happened instead, and steps to reproduce (screenshots help).
                      </p>
                    </FaqCard>
                  </div>
                </section>
              </div>

              <div className="bg-purple-gradient text-white rounded-lg p-8 text-center mt-12">
                <h2 className="text-2xl font-bold mb-4">Want The Best Results?</h2>
                <p className="mb-6">
                  Use the loop: focus → learn → test → fix gaps. inspir is built to make that loop easy.
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
      <Footer />
    </>
  );
}
