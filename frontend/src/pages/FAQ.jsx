import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import { Link } from 'react-router-dom';

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
                Got questions about inspir? Here are clear, honest answers about how it works, what it costs, and how to
                study effectively with AI.
              </p>

              <div className="space-y-10">
                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">Getting Started</h2>
                  <div className="space-y-4">
                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">What is inspir?</h3>
                      <p className="text-gray-700">
                        inspir is an AI study tool that turns a topic or your notes into a quiz. It’s built around
                        <strong> active recall</strong> (testing yourself) so you learn faster and remember longer.
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">Is inspir free?</h3>
                      <p className="text-gray-700">
                        inspir is currently free to use. You can generate quizzes as a guest, and you can create an account to save
                        quizzes and track your history.
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">Do I need an account?</h3>
                      <p className="text-gray-700">
                        No. Use guest mode for quick quizzes. Create an account for saved quizzes, quiz history, and account-based tools.
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">Quizzes</h2>
                  <div className="space-y-4">
                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">What can I generate a quiz from?</h3>
                      <p className="text-gray-700">
                        Type a topic, paste text, or upload notes (supported formats include TXT and DOCX). Uploading notes usually gives more targeted questions.
                      </p>
                      <p className="text-gray-700 mt-3">
                        Quick start: <Link to="/quiz" className="text-purple-dark font-semibold hover:underline">Create a quiz</Link>.
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">How many questions are in a quiz?</h3>
                      <p className="text-gray-700">
                        A standard quiz includes 10 questions (a mix of multiple choice and open-ended questions designed to test understanding).
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">How long does quiz generation take?</h3>
                      <p className="text-gray-700">
                        Usually seconds. Longer notes take longer to read, and timing can vary based on traffic.
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">Can I edit questions or change quiz length?</h3>
                      <p className="text-gray-700">
                        Not yet. If you want a different angle, regenerate with the same input and you’ll get different questions.
                        Editing and custom quiz length are common requests and may be added later.
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">How accurate is it?</h3>
                      <p className="text-gray-700">
                        AI can make mistakes. Use inspir as a study accelerator, not as a single source of truth—especially for technical, medical,
                        or legal topics. If something looks wrong, regenerate, verify with your materials, and treat it as a learning checkpoint.
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">Sharing &amp; Accounts</h2>
                  <div className="space-y-4">
                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">Can I share a quiz?</h3>
                      <p className="text-gray-700">
                        Yes. After you create a quiz, use “Share This Quiz” to generate a link. Anyone with the link can take it.
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">Do people need an account to take a shared quiz?</h3>
                      <p className="text-gray-700">
                        No. They can take it as a guest by entering a name, or sign in if they have an account.
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">What if I forget my password?</h3>
                      <p className="text-gray-700">
                        Account recovery is limited because we don’t require email. Use a password manager if you create an account,
                        or keep using guest mode.
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">Privacy</h2>
                  <div className="space-y-4">
                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">Do you store the notes I upload?</h3>
                      <p className="text-gray-700">
                        Your notes are processed to generate questions. Saved quizzes store generated questions and answers; they don’t need to permanently
                        store your raw notes to be useful.
                      </p>
                      <p className="text-gray-700 mt-3">
                        Details: <Link to="/privacy" className="text-purple-dark font-semibold hover:underline">Privacy Policy</Link>.
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">Do you collect email addresses?</h3>
                      <p className="text-gray-700">
                        No—signup uses a username and password. We keep signup lightweight and avoid building a marketing list.
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">Teachers &amp; Study Workflows</h2>
                  <div className="space-y-4">
                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">Can teachers use inspir for classes?</h3>
                      <p className="text-gray-700">
                        Yes. Turn lesson plans and readings into quick checks for understanding, then share the quiz link with students.
                        It’s a fast way to spot misconceptions before exams.
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-sm">
                      <h3 className="text-xl font-bold text-deep-blue mb-2">What’s the best way to use inspir to learn?</h3>
                      <p className="text-gray-700">
                        Use it for active recall: generate a quiz, answer without looking, then review what you missed. Repeat the next day.
                        Pair it with a focus session using the <Link to="/study-timer" className="text-purple-dark font-semibold hover:underline">Study Timer</Link>.
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">Other Tools</h2>
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <p className="text-gray-700 mb-3">
                      inspir includes focused study tools designed to support better workflows:
                    </p>
                    <ul className="list-disc pl-6 text-gray-700 space-y-1">
                      <li><Link to="/study-timer" className="text-purple-dark font-semibold hover:underline">Study Timer</Link> for Pomodoro-style focus sessions</li>
                      <li><Link to="/cornell-notes" className="text-purple-dark font-semibold hover:underline">Cornell Notes</Link> to turn content into cue-based notes</li>
                      <li><Link to="/citations" className="text-purple-dark font-semibold hover:underline">Citation Generator</Link> to keep sources organized</li>
                      <li><Link to="/streaks" className="text-purple-dark font-semibold hover:underline">Study Streaks</Link> to build consistent habits</li>
                      <li><Link to="/doubt" className="text-purple-dark font-semibold hover:underline">Doubt Solver</Link> for step-by-step explanations</li>
                      <li><Link to="/forum" className="text-purple-dark font-semibold hover:underline">Student Forum</Link> for Q&amp;A and study discussions</li>
                    </ul>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-deep-blue mb-4">Support</h2>
                  <div className="bg-white p-6 rounded-lg shadow-sm">
                    <h3 className="text-xl font-bold text-deep-blue mb-2">I found a bug or have a feature request — how do I report it?</h3>
                    <p className="text-gray-700">
                      Post in the <Link to="/forum" className="text-purple-dark font-semibold hover:underline">Student Forum</Link> with what you expected to happen,
                      what happened instead, and steps to reproduce (screenshots help).
                    </p>
                  </div>
                </section>
              </div>

              <div className="bg-purple-gradient text-white rounded-lg p-8 text-center mt-12">
                <h2 className="text-2xl font-bold mb-4">Still Have Questions?</h2>
                <p className="mb-6">The best way to understand inspir is to try it. Create a quiz and see how fast active recall feels.</p>
                <Link to="/" className="inline-block bg-coral-red text-white px-8 py-3 rounded-lg font-bold hover:bg-opacity-90 transition-all">
                  Try inspir Now
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
