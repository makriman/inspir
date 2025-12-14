import Navigation from '../components/Navigation';
import Footer from '../components/Footer';

export default function Terms() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <article>
            <h1 className="text-4xl md:text-5xl font-bold text-deep-blue mb-6">Terms of Service</h1>

            <div className="prose prose-lg max-w-none">
              <p className="text-sm text-gray-600 mb-8">Last updated: December 14, 2025</p>

              <p className="text-xl text-gray-700 mb-8">
                These terms are written in plain English because legal jargon doesn't make things clearer.
                By using inspir, you're agreeing to these terms.
              </p>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">What inspir Is</h2>
                <p className="text-gray-700 mb-4">
                  inspir is a tool that uses AI to generate quiz questions from content you provide. You paste
                  text or upload a document, we generate questions, and you use those questions to test your knowledge.
                </p>
                <p className="text-gray-700">
                  It's an educational tool, not a replacement for critical thinking. The quizzes are meant to help you learn,
                  not to be blindly trusted as 100% accurate in all cases.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Using the Service</h2>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-xl font-semibold text-deep-blue mb-3">What You Can Do</h3>
                  <ul className="list-disc pl-6 text-gray-700 space-y-2">
                    <li>Create quizzes for personal study, teaching, training, or any educational purpose</li>
                    <li>Use quizzes with your students or trainees</li>
                    <li>Share quizzes via links and use them with friends, classmates, or students</li>
                    <li>Use inspir for commercial purposes like corporate training or professional development</li>
                  </ul>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-xl font-semibold text-deep-blue mb-3">What You Can't Do</h3>
                  <ul className="list-disc pl-6 text-gray-700 space-y-2">
                    <li>Upload content you don't have the right to use (no copyrighted textbooks unless you own them or have permission)</li>
                    <li>Use inspir to generate spam, malicious content, or harmful material</li>
                    <li>Attempt to hack, reverse engineer, or otherwise compromise the service</li>
                    <li>Create automated bots or scripts to abuse the service or generate excessive API calls</li>
                    <li>Impersonate others or create fake accounts</li>
                    <li>Use the service for any illegal purpose</li>
                  </ul>
                </div>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Your Content and Data</h2>
                <p className="text-gray-700 mb-4">
                  When you upload or paste content into inspir:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                  <li>You retain all ownership of your content</li>
                  <li>You grant us permission to process it for the sole purpose of generating your quiz</li>
                  <li>We don't claim any rights to your content</li>
                  <li>We don't store your uploaded content (we delete it after quiz generation)</li>
                  <li>You're responsible for ensuring you have the right to use any content you upload</li>
                </ul>
                <p className="text-gray-700">
                  The generated quiz questions are yours to use however you want. We don't claim ownership of them.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Accounts and Security</h2>
                <p className="text-gray-700 mb-4">
                  If you create an account:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                  <li>You're responsible for keeping your password secure</li>
                  <li>You're responsible for any activity that happens under your account</li>
                  <li>Don't share your account with others</li>
                  <li>If you think your account has been compromised, create a new one (we can't recover accounts without email)</li>
                </ul>
                <p className="text-gray-700">
                  We don't collect email addresses, which means we can't help you recover a lost password. Choose a
                  password you'll remember or use a password manager.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Accuracy and Reliability</h2>
                <div className="bg-yellow-50 p-6 rounded-lg border-l-4 border-yellow-500 mb-4">
                  <p className="text-gray-700 mb-3">
                    <strong>Important:</strong> inspir uses AI to generate questions, and AI can make mistakes.
                  </p>
                  <p className="text-gray-700">
                    While we've designed the system to create accurate, thoughtful questions, you should always review
                    the quizzes—especially for technical, medical, legal, or other critical subject matter.
                  </p>
                </div>
                <p className="text-gray-700 mb-4">
                  We don't guarantee that:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li>Generated questions will be 100% factually accurate</li>
                  <li>The quizzes will cover all important concepts from your content</li>
                  <li>Answer explanations will always be complete or correct</li>
                  <li>The service will be available 24/7 without interruption</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Service Availability</h2>
                <p className="text-gray-700 mb-4">
                  We try to keep inspir running smoothly, but we can't guarantee 100% uptime. The service may be
                  temporarily unavailable due to:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                  <li>Maintenance and updates</li>
                  <li>Technical issues or server problems</li>
                  <li>Third-party service outages (like our AI provider or hosting)</li>
                  <li>Security incidents</li>
                </ul>
                <p className="text-gray-700">
                  We'll do our best to minimize downtime, but we're not liable for any losses resulting from service interruptions.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Pricing and Changes</h2>
                <p className="text-gray-700 mb-4">
                  inspir is currently free to use. If we ever introduce paid features or subscriptions, we'll:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li>Clearly communicate the pricing</li>
                  <li>Give existing users advance notice</li>
                  <li>Continue to offer a free tier for basic use</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Intellectual Property</h2>
                <p className="text-gray-700 mb-4">
                  The inspir website, software, design, and branding are owned by us and protected by copyright
                  and other intellectual property laws.
                </p>
                <p className="text-gray-700">
                  You can't copy, modify, or redistribute our code or design without permission. But you can use the
                  service and the quizzes it generates for your own purposes.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Limitation of Liability</h2>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <p className="text-gray-700 mb-3">
                    inspir is provided "as is" without warranties of any kind. We're not liable for:
                  </p>
                  <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-3">
                    <li>Any damages resulting from your use (or inability to use) the service</li>
                    <li>Inaccurate quiz questions or answers</li>
                    <li>Lost data or content</li>
                    <li>Security breaches or data leaks (though we take security seriously)</li>
                    <li>Any decisions you make based on quiz content</li>
                  </ul>
                  <p className="text-gray-700">
                    If you're using inspir for something important (like studying for a major exam), always verify
                    the information independently. Don't rely solely on AI-generated quizzes.
                  </p>
                </div>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Termination</h2>
                <p className="text-gray-700 mb-4">
                  We reserve the right to suspend or terminate accounts that:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                  <li>Violate these terms</li>
                  <li>Abuse the service (like generating thousands of quizzes per day)</li>
                  <li>Attempt to hack or compromise the system</li>
                  <li>Use the service for illegal or harmful purposes</li>
                </ul>
                <p className="text-gray-700">
                  You can stop using inspir at any time. If you want your account and data deleted, let us know.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Third-Party Services</h2>
                <p className="text-gray-700 mb-4">
                  inspir uses third-party services, including:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                  <li><strong>Anthropic (Claude AI):</strong> For quiz generation</li>
                  <li><strong>Supabase:</strong> For database hosting</li>
                  <li><strong>Microsoft Clarity:</strong> For product analytics to improve usability</li>
                  <li><strong>Various hosting and infrastructure providers</strong></li>
                </ul>
                <p className="text-gray-700">
                  These services have their own terms and policies. By using inspir, you agree to comply with
                  those terms as they relate to your use of our service.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Changes to These Terms</h2>
                <p className="text-gray-700 mb-4">
                  We may update these terms from time to time. If we make significant changes, we'll update the
                  "Last updated" date at the top.
                </p>
                <p className="text-gray-700">
                  Continued use of inspir after changes means you accept the new terms. If you don't agree with
                  the changes, stop using the service.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Governing Law</h2>
                <p className="text-gray-700">
                  These terms are governed by the laws of the United Kingdom. Any disputes will be resolved in
                  UK courts.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Contact</h2>
                <p className="text-gray-700">
                  If you have questions about these terms, check our website for current contact information.
                </p>
              </section>

              <div className="bg-gray-100 p-6 rounded-lg mt-8">
                <h3 className="text-xl font-semibold text-deep-blue mb-3">The Simple Version</h3>
                <p className="text-gray-700">
                  Use inspir for learning and teaching. Don't abuse it or do anything illegal. We'll do our
                  best to provide a good service, but we can't guarantee perfection. Always verify important information.
                  Be a decent human being, and we'll all get along fine.
                </p>
              </div>
            </div>
          </article>
        </div>
      </main>
      <Footer />
    </>
  );
}
