import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import { Link } from 'react-router-dom';

export default function UseCases() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <article>
            <h1 className="text-4xl md:text-5xl font-bold text-deep-blue mb-6">How People Use InspirQuiz</h1>

            <div className="prose prose-lg max-w-none">
              <p className="text-xl text-gray-700 mb-8">
                InspirQuiz works for anyone who needs to learn something or help others learn.
                Here are the most common ways people actually use it.
              </p>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-6">For Students</h2>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Exam Preparation</h3>
                  <p className="text-gray-700 mb-3">
                    You've got three chapters to study for Friday's exam. Copy your lecture notes or textbook summaries
                    into InspirQuiz and generate practice questions. Work through them, check your answers, identify
                    what you don't understand yet, and review those sections.
                  </p>
                  <p className="text-gray-700">
                    Repeat until you can answer everything confidently. Active recall like this beats reading your
                    notes for the fifth time.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Understanding Complex Concepts</h3>
                  <p className="text-gray-700 mb-3">
                    Sometimes you read something in a textbook and think you get it, but you're not sure.
                    Paste that section into InspirQuiz and take a quiz on it.
                  </p>
                  <p className="text-gray-700">
                    If you struggle with the questions, you didn't actually understand it yet. Go back, re-read,
                    and try again. The questions will show you exactly what you're missing.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Homework and Assignment Review</h3>
                  <p className="text-gray-700 mb-3">
                    Finished reading an assignment for class? Before moving on, turn it into a quiz to make sure
                    you actually absorbed the information.
                  </p>
                  <p className="text-gray-700">
                    This is especially useful for subjects where you need to retain information long-term,
                    not just for the next test. Medical students, law students, and anyone in technical fields
                    find this incredibly helpful.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Study Groups</h3>
                  <p className="text-gray-700 mb-3">
                    One person in your study group can create quizzes from your shared notes, then everyone
                    takes the same quiz. Compare answers, discuss where you disagreed, and learn from each other.
                  </p>
                  <p className="text-gray-700">
                    Makes study sessions way more productive than just sitting around asking "Did you get this part?"
                  </p>
                </div>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-6">For Teachers and Educators</h2>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Quick Formative Assessments</h3>
                  <p className="text-gray-700 mb-3">
                    You just taught a new concept. Upload your lesson plan or lecture notes to InspirQuiz,
                    generate a quick 10-question assessment, and give it to your students at the end of class.
                  </p>
                  <p className="text-gray-700">
                    It takes 30 seconds to create and gives you immediate feedback on whether students actually
                    understood what you just taught.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Homework and Practice Problems</h3>
                  <p className="text-gray-700 mb-3">
                    Need to create homework assignments or practice problems? Generate questions from your
                    curriculum materials, review them, tweak if needed, and assign them to your class.
                  </p>
                  <p className="text-gray-700">
                    You can even create multiple versions from the same content by regenerating quizzes,
                    so students can't just copy each other's answers.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Differentiated Learning</h3>
                  <p className="text-gray-700 mb-3">
                    Create quizzes from different sections of your material for students at different levels.
                    Advanced students get questions from more complex content, students who need extra help
                    get quizzes from foundational material.
                  </p>
                  <p className="text-gray-700">
                    Everyone gets appropriately challenging practice without you spending hours writing
                    multiple versions of everything.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Flipped Classroom Prep</h3>
                  <p className="text-gray-700 mb-3">
                    If you're doing flipped classroom teaching, create quizzes from the reading materials
                    students are supposed to review before class.
                  </p>
                  <p className="text-gray-700">
                    They can self-test to make sure they're ready, and you can use the same quiz as a
                    quick check at the start of class.
                  </p>
                </div>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-6">For Self-Directed Learners</h2>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Learning New Skills</h3>
                  <p className="text-gray-700 mb-3">
                    Teaching yourself to code? Learning a new language? Studying history for fun?
                    As you work through tutorials, articles, or documentation, turn each section into a quiz.
                  </p>
                  <p className="text-gray-700">
                    This forces you to actually process what you're reading instead of just passively consuming
                    content. You'll learn faster and remember more.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Book Reading and Retention</h3>
                  <p className="text-gray-700 mb-3">
                    Reading non-fiction books but finding you forget everything a week later? After each chapter,
                    summarize the key points in a few paragraphs and turn it into a quiz.
                  </p>
                  <p className="text-gray-700">
                    The act of creating that summary plus taking the quiz massively improves retention.
                    Come back and retake the quiz a month later for spaced repetition.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Online Course Supplements</h3>
                  <p className="text-gray-700 mb-3">
                    Taking an online course? Most platforms have quizzes, but they're often pretty basic.
                    Copy the course transcript or your notes and create your own quizzes with more thought-provoking questions.
                  </p>
                  <p className="text-gray-700">
                    This is particularly useful for courses that are heavy on video content but light on practice problems.
                  </p>
                </div>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-6">For Professionals and Workplace Learning</h2>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Certification Exam Prep</h3>
                  <p className="text-gray-700 mb-3">
                    Studying for a professional certification? Upload study guides, create quizzes from each section,
                    and work through them systematically.
                  </p>
                  <p className="text-gray-700">
                    Track which areas you're strong in and which need more work. Focus your study time where it matters most.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Training New Employees</h3>
                  <p className="text-gray-700 mb-3">
                    Creating training materials for new hires? Turn your documentation, process guides, or training
                    manuals into quizzes. New employees can self-test to ensure they've understood everything.
                  </p>
                  <p className="text-gray-700">
                    This is way more effective than just having them read documents and hoping they absorbed it all.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Knowledge Retention</h3>
                  <p className="text-gray-700 mb-3">
                    Need to stay current in your field but find you forget things quickly? After reading industry
                    articles, whitepapers, or reports, turn key sections into quizzes.
                  </p>
                  <p className="text-gray-700">
                    Review them periodically to keep that knowledge fresh. This is especially useful in fast-moving
                    fields like technology or finance.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Compliance Training</h3>
                  <p className="text-gray-700 mb-3">
                    If your organization has compliance requirements, create quizzes from your compliance documentation.
                    Employees can use them to verify they understand the policies.
                  </p>
                  <p className="text-gray-700">
                    Much more engaging than just reading policy documents, and you get built-in verification
                    that people actually get it.
                  </p>
                </div>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-6">For Parents and Homeschoolers</h2>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Homeschool Assessments</h3>
                  <p className="text-gray-700 mb-3">
                    Homeschooling your kids? Create quizzes from their textbooks or curriculum materials to assess
                    what they've learned. It's like having instant formative assessments without spending hours
                    creating test questions.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-2xl font-semibold text-deep-blue mb-3">Helping with Homework</h3>
                  <p className="text-gray-700 mb-3">
                    When your kid is studying for a test, help them by creating practice quizzes from their study materials.
                    They can take the quiz, and you can review the answers together to see what they need to work on.
                  </p>
                  <p className="text-gray-700">
                    Way more productive than the classic "Do you want me to quiz you?" approach where you're just reading
                    questions verbatim from their notes.
                  </p>
                </div>
              </section>

              <section className="mb-12">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">The Common Thread</h2>
                <p className="text-gray-700 mb-4">
                  All these use cases share the same principle: testing yourself is one of the most effective ways to learn.
                  Reading something once doesn't mean you've learned it. Being able to answer questions about it—especially
                  questions that require you to think and apply what you've read—that's when learning actually happens.
                </p>
                <p className="text-gray-700">
                  InspirQuiz just makes it ridiculously easy to create those tests so you can focus on the actual learning part.
                </p>
              </section>

              <div className="bg-purple-gradient text-white rounded-lg p-8 text-center">
                <h2 className="text-2xl font-bold mb-4">What Will You Use It For?</h2>
                <p className="mb-6">Whether you're cramming for finals or mastering a new skill, InspirQuiz is ready to help.</p>
                <Link to="/" className="inline-block bg-coral-red text-white px-8 py-3 rounded-lg font-bold hover:bg-opacity-90 transition-all">
                  Start Creating Quizzes
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
