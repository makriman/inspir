import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import { Link } from 'react-router-dom';

export default function HowItWorks() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
        {/* Hero Section */}
        <div className="bg-gradient-to-r from-purple-dark to-purple-darker text-white py-16">
          <div className="max-w-4xl mx-auto px-4 text-center">
            <h1 className="text-4xl md:text-6xl font-bold mb-4">
              How InspirQuiz Works
            </h1>
            <p className="text-xl md:text-2xl text-purple-100">
              From topic to quiz in under 30 seconds
            </p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="bg-white rounded-2xl shadow-lg p-8 md:p-12 mb-8">
            <p className="text-xl text-gray-700 mb-8 text-center">
              Creating a quiz with InspirQuiz is ridiculously simple. Here's exactly how it works.
            </p>

            {/* Step 1 */}
            <section className="mb-16">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-r from-purple-dark to-coral-red rounded-full flex items-center justify-center text-white font-bold text-xl">
                  1
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-deep-blue mb-3">Tell Us What to Quiz You On</h2>
                  <p className="text-lg text-gray-700 mb-4">
                    This is the ONLY required step. Just type what you want to be quizzed on:
                  </p>
                </div>
              </div>

              <div className="bg-gradient-to-br from-purple-50 to-blue-50 p-6 rounded-xl border-l-4 border-purple-dark mb-6">
                <h3 className="font-semibold text-deep-blue mb-3 text-lg">Example topics:</h3>
                <ul className="space-y-2 text-gray-700">
                  <li className="flex items-start">
                    <span className="mr-2">📚</span>
                    <span>"World War 2" - Get questions about causes, battles, consequences</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">🧬</span>
                    <span>"Photosynthesis" - Understand how plants convert light to energy</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">💻</span>
                    <span>"Python Programming" - Test your coding knowledge</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">🌍</span>
                    <span>"Climate Change" - Quiz yourself on environmental science</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">🎨</span>
                    <span>"Renaissance Art" - Learn about art history</span>
                  </li>
                </ul>
              </div>

              <div className="bg-vibrant-yellow bg-opacity-10 border border-vibrant-yellow p-5 rounded-lg">
                <p className="text-gray-800 font-medium">
                  ⚡ <strong>That's it!</strong> You can generate a quiz with just a topic. The AI will create thought-provoking questions based on its general knowledge. Click "Generate Quiz" and you're done!
                </p>
              </div>
            </section>

            {/* Step 2 - Optional */}
            <section className="mb-16">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-12 h-12 bg-gray-300 rounded-full flex items-center justify-center text-white font-bold text-xl">
                  2
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-deep-blue mb-2">
                    Add Your Notes <span className="text-gray-500 text-2xl font-normal">(Optional)</span>
                  </h2>
                  <p className="text-lg text-gray-700 mb-4">
                    Want questions specific to YOUR study material? Upload your notes or paste your content.
                  </p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-white border-2 border-purple-300 p-6 rounded-xl hover:shadow-md transition-shadow">
                  <div className="text-4xl mb-3">📝</div>
                  <h3 className="text-xl font-bold text-deep-blue mb-3">Paste Your Text</h3>
                  <p className="text-gray-700 mb-3">
                    Copy lecture notes, textbook chapters, study guides, or any educational content and paste it in.
                  </p>
                  <p className="text-sm text-gray-600">
                    Perfect for: Digital notes, online articles, copy-pasted sections from PDFs
                  </p>
                </div>

                <div className="bg-white border-2 border-purple-300 p-6 rounded-xl hover:shadow-md transition-shadow">
                  <div className="text-4xl mb-3">📁</div>
                  <h3 className="text-xl font-bold text-deep-blue mb-3">Upload Documents</h3>
                  <p className="text-gray-700 mb-3">
                    Drag and drop your study files. We support TXT and DOCX files up to 10MB.
                  </p>
                  <p className="text-sm text-gray-600">
                    Perfect for: Organized study materials, class handouts, lecture notes saved as files
                  </p>
                </div>
              </div>

              <div className="mt-6 bg-blue-50 border border-blue-200 p-5 rounded-lg">
                <p className="text-gray-800">
                  💡 <strong>Pro tip for students:</strong> Upload your class notes or paste textbook sections to get quiz questions tailored specifically to your course material. It's like having a personal tutor who knows exactly what you're studying!
                </p>
              </div>
            </section>

            {/* Step 3 */}
            <section className="mb-16">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-r from-purple-dark to-coral-red rounded-full flex items-center justify-center text-white font-bold text-xl">
                  3
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-deep-blue mb-3">We Generate Your Quiz</h2>
                  <p className="text-lg text-gray-700">
                    Click "Generate Quiz" and watch the magic happen. In 10-20 seconds, you'll have a complete quiz ready.
                  </p>
                </div>
              </div>

              <div className="bg-gradient-to-br from-purple-dark to-purple-darker text-white p-8 rounded-xl mb-6">
                <h3 className="text-2xl font-bold mb-4">What Makes Our Quizzes Different?</h3>
                <p className="mb-4 text-purple-100">
                  We don't just create boring, factual recall questions. Our AI generates thought-provoking questions that test <strong>deep understanding</strong>.
                </p>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-white bg-opacity-10 p-4 rounded-lg">
                    <div className="text-red-300 font-bold mb-2">❌ Simple Recall (Boring)</div>
                    <p className="text-sm text-purple-100">"Who is the Prime Minister of India?"</p>
                  </div>
                  <div className="bg-vibrant-yellow bg-opacity-20 p-4 rounded-lg border border-vibrant-yellow">
                    <div className="text-vibrant-yellow font-bold mb-2">✅ Thought-Provoking (Interesting)</div>
                    <p className="text-sm text-white">"Who is the person with a history as a chai seller who rose to the highest political position in India?"</p>
                  </div>

                  <div className="bg-white bg-opacity-10 p-4 rounded-lg">
                    <div className="text-red-300 font-bold mb-2">❌ Simple Fact</div>
                    <p className="text-sm text-purple-100">"When did World War 2 end?"</p>
                  </div>
                  <div className="bg-vibrant-yellow bg-opacity-20 p-4 rounded-lg border border-vibrant-yellow">
                    <div className="text-vibrant-yellow font-bold mb-2">✅ Deep Understanding</div>
                    <p className="text-sm text-white">"What strategic decision made in 1945 fundamentally changed warfare and international relations?"</p>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-purple-50 p-6 rounded-xl border-l-4 border-purple-dark">
                  <h4 className="font-bold text-deep-blue mb-3 text-lg">5 Multiple Choice Questions</h4>
                  <p className="text-gray-700 text-sm mb-3">
                    All four answer options are carefully crafted to be plausible. No obviously wrong answers that waste your time.
                  </p>
                  <p className="text-gray-700 text-sm">
                    These test your understanding of concepts, not just your ability to recognize keywords.
                  </p>
                </div>

                <div className="bg-purple-50 p-6 rounded-xl border-l-4 border-purple-dark">
                  <h4 className="font-bold text-deep-blue mb-3 text-lg">5 Open-Ended Questions</h4>
                  <p className="text-gray-700 text-sm mb-3">
                    "Why", "How", "Explain", and "Analyze" questions that require you to think deeply and articulate your understanding.
                  </p>
                  <p className="text-gray-700 text-sm">
                    These are the questions that actually help you learn and retain information.
                  </p>
                </div>
              </div>
            </section>

            {/* Step 4 */}
            <section className="mb-16">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-r from-purple-dark to-coral-red rounded-full flex items-center justify-center text-white font-bold text-xl">
                  4
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-deep-blue mb-3">Take Your Quiz</h2>
                  <p className="text-lg text-gray-700">
                    Work through the questions at your own pace. No timers, no pressure.
                  </p>
                </div>
              </div>

              <div className="bg-gray-50 p-6 rounded-xl">
                <ul className="space-y-3 text-gray-700">
                  <li className="flex items-start">
                    <span className="mr-3 text-purple-dark">✓</span>
                    <span>For multiple choice: Select the best answer</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-3 text-purple-dark">✓</span>
                    <span>For open-ended: Type your response in the text area</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-3 text-purple-dark">✓</span>
                    <span>Navigate between questions using Previous/Next buttons</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-3 text-purple-dark">✓</span>
                    <span>See your progress with the visual indicator at the top</span>
                  </li>
                </ul>
              </div>
            </section>

            {/* Step 5 */}
            <section className="mb-12">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-r from-purple-dark to-coral-red rounded-full flex items-center justify-center text-white font-bold text-xl">
                  5
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-deep-blue mb-3">Get Your Results & Learn</h2>
                  <p className="text-lg text-gray-700">
                    Submit your quiz and see how you did. More importantly, understand what you got wrong.
                  </p>
                </div>
              </div>

              <div className="bg-gradient-to-br from-blue-50 to-purple-50 p-6 rounded-xl border border-purple-200">
                <p className="text-gray-700 mb-4">
                  The AI will evaluate your answers - even the open-ended ones! You'll see:
                </p>
                <ul className="space-y-2 text-gray-700">
                  <li className="flex items-start">
                    <span className="mr-2">📊</span>
                    <span>Your overall score and percentage</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">✅</span>
                    <span>Which questions you got right</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">📝</span>
                    <span>The correct answers with explanations</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">🎯</span>
                    <span>Where you need to review and study more</span>
                  </li>
                </ul>
              </div>
            </section>

            {/* CTA */}
            <div className="bg-gradient-to-r from-purple-dark via-purple-darker to-deep-blue text-white rounded-2xl p-8 md:p-12 text-center">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Try It?</h2>
              <p className="text-xl text-purple-100 mb-6 max-w-2xl mx-auto">
                No signup required. No credit card. Just type a topic and see how it works.
              </p>
              <Link
                to="/"
                className="inline-block bg-gradient-to-r from-coral-red to-red-600 text-white px-10 py-4 rounded-xl font-bold text-lg hover:shadow-lg hover:scale-105 transition-all"
              >
                Create Your First Quiz →
              </Link>
              <p className="mt-4 text-sm text-purple-200">
                Takes less than 30 seconds. Seriously.
              </p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
