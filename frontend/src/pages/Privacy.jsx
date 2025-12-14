import Navigation from '../components/Navigation';
import Footer from '../components/Footer';

export default function Privacy() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <article>
            <h1 className="text-4xl md:text-5xl font-bold text-deep-blue mb-6">Privacy Policy</h1>

            <div className="prose prose-lg max-w-none">
              <p className="text-sm text-gray-600 mb-8">Last updated: December 14, 2025</p>

              <p className="text-xl text-gray-700 mb-8">
                We built inspir with privacy as a core principle. This policy explains what data we collect, how we use it,
                and which third-party services are involved in running the app.
              </p>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">What We Collect</h2>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-xl font-semibold text-deep-blue mb-3">If You Create an Account</h3>
                  <p className="text-gray-700 mb-3">
                    We collect and store:
                  </p>
                  <ul className="list-disc pl-6 text-gray-700 space-y-2">
                    <li><strong>Username:</strong> The username you choose when signing up</li>
                    <li><strong>Password:</strong> Your password, stored as a cryptographic hash (bcrypt). We can't see your actual password.</li>
                    <li><strong>Quiz data:</strong> The quizzes you generate and save (questions and answers only, not your source material)</li>
                    <li><strong>Account creation date:</strong> When you created your account</li>
                  </ul>
                  <p className="text-gray-700 mt-3">
                    That's it. We don't ask for your email, real name, phone number, or any other personal information.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-xl font-semibold text-deep-blue mb-3">If You Use inspir as a Guest</h3>
                  <p className="text-gray-700">
                    We collect nothing. Your quizzes are generated and displayed, but not saved to our servers.
                    When you close the browser, everything is gone.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-xl font-semibold text-deep-blue mb-3">Content You Upload or Paste</h3>
                  <p className="text-gray-700 mb-3">
                    When you upload a document or paste text to create a quiz:
                  </p>
                  <ul className="list-disc pl-6 text-gray-700 space-y-2">
                    <li>We process it to generate quiz questions</li>
                    <li>The content is temporarily held in memory during processing</li>
                    <li>Once the quiz is generated, your original content is discarded</li>
                    <li>We do NOT store your uploaded documents or pasted text</li>
                    <li>We do NOT use your content to train AI models</li>
                  </ul>
                </div>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">What We Don't Collect</h2>
                <div className="bg-purple-50 p-6 rounded-lg border-l-4 border-purple-dark">
                  <ul className="list-disc pl-6 text-gray-700 space-y-2">
                    <li>No email addresses</li>
                    <li>No phone numbers</li>
                    <li>No real names or personal identifiers</li>
                    <li>No advertising trackers or third-party ad pixels</li>
                    <li>No IP address logging beyond standard server logs (see below)</li>
                    <li>No social media tracking pixels</li>
                    <li>No behavioral profiling for ads</li>
                    <li>No behavioral profiling</li>
                  </ul>
                </div>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">How We Use Your Data</h2>
                <p className="text-gray-700 mb-4">
                  The data we collect (username, password hash, saved quizzes) is used for exactly one purpose:
                  allowing you to log in and access your saved quizzes.
                </p>
                <p className="text-gray-700 mb-4">
                  We don't:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                  <li>Sell your data to anyone</li>
                  <li>Share your data with third parties (except as required by law, see below)</li>
                  <li>Use your data for marketing or advertising</li>
                  <li>Analyze your behavior or build profiles</li>
                  <li>Send you emails (because we don't have your email)</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Third-Party Services</h2>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-xl font-semibold text-deep-blue mb-3">Claude AI (Anthropic)</h3>
                  <p className="text-gray-700 mb-3">
                    We use Anthropic's Claude AI to generate quiz questions. When you create a quiz, your content
                    is sent to Anthropic's API for processing.
                  </p>
                  <p className="text-gray-700">
                    According to Anthropic's policy, content sent via their API is not used to train their models.
                    See <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer" className="text-purple-dark hover:underline">Anthropic's Privacy Policy</a> for details.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
                  <h3 className="text-xl font-semibold text-deep-blue mb-3">Database Hosting (Supabase)</h3>
                  <p className="text-gray-700">
                    User accounts and saved quizzes are stored in a PostgreSQL database hosted by Supabase.
                    The database is secured with encryption at rest and in transit.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-xl font-semibold text-deep-blue mb-3">Product Analytics (Microsoft Clarity)</h3>
                  <p className="text-gray-700 mb-3">
                    We use Microsoft Clarity to understand usability (for example: which pages are used, where users get stuck, and how we can
                    improve the experience). This is used for product improvement, not advertising.
                  </p>
                  <p className="text-gray-700">
                    Learn more in <a href="https://privacy.microsoft.com/en-us/privacystatement" target="_blank" rel="noopener noreferrer" className="text-purple-dark hover:underline">Microsoft's Privacy Statement</a>.
                  </p>
                </div>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Server Logs</h2>
                <p className="text-gray-700 mb-4">
                  Like any web service, our servers automatically log basic technical information:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                  <li>IP addresses</li>
                  <li>Browser type and version</li>
                  <li>Pages visited</li>
                  <li>Time and date of requests</li>
                </ul>
                <p className="text-gray-700">
                  These logs are used only for technical maintenance, debugging, and security purposes.
                  They're retained for a limited time and are not analyzed for marketing or behavioral tracking.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Cookies and Local Storage</h2>
                <p className="text-gray-700 mb-4">
                  We use minimal browser storage:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li><strong>Authentication token:</strong> If you're logged in, we store a JWT token in your browser's localStorage to keep you logged in. This is a technical necessity, not tracking.</li>
                  <li><strong>No advertising cookies:</strong> We don’t use cookies to serve ads or build advertising profiles.</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Data Security</h2>
                <p className="text-gray-700 mb-4">
                  We take reasonable measures to protect your data:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                  <li>Passwords are hashed using bcrypt before storage</li>
                  <li>All connections use HTTPS/SSL encryption</li>
                  <li>Database is configured with security best practices</li>
                  <li>Access to the database is restricted and logged</li>
                </ul>
                <p className="text-gray-700">
                  That said, no system is 100% secure. We do our best, but we can't guarantee absolute security.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Data Retention and Deletion</h2>
                <p className="text-gray-700 mb-4">
                  <strong>Saved quizzes:</strong> Kept until you delete them or delete your account.
                </p>
                <p className="text-gray-700 mb-4">
                  <strong>Account data:</strong> Kept until you request deletion. We don't have an automated account
                  deletion feature yet, but if you want your account and data deleted, contact us and we'll do it manually.
                </p>
                <p className="text-gray-700">
                  <strong>Uploaded content:</strong> Deleted immediately after quiz generation. Not retained.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Your Rights</h2>
                <p className="text-gray-700 mb-4">
                  You have the right to:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li>Access your data (just log in—it's all there)</li>
                  <li>Delete your quizzes (delete them individually through the app)</li>
                  <li>Delete your account and all associated data (contact us)</li>
                  <li>Use the service without creating an account (continue as guest)</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Legal Disclosures</h2>
                <p className="text-gray-700">
                  We may disclose user data if required by law, such as in response to a valid subpoena, court order,
                  or other legal process. We'll resist overly broad requests and notify users when legally permitted.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Children's Privacy</h2>
                <p className="text-gray-700">
                  inspir is designed to be safe for students of all ages, including children under 13. We don't
                  knowingly collect personal information from anyone—child or adult—beyond the minimal username and
                  password required for accounts.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Changes to This Policy</h2>
                <p className="text-gray-700 mb-4">
                  If we make significant changes to this privacy policy, we'll update the "Last updated" date at
                  the top and post the new policy here.
                </p>
                <p className="text-gray-700">
                  We won't email you about changes (because we don't have your email), so check back occasionally
                  if you're concerned about privacy updates.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-3xl font-bold text-deep-blue mb-4">Contact</h2>
                <p className="text-gray-700">
                  If you have questions about this privacy policy or want to request data deletion, you can reach
                  out through our website or check for updated contact information here.
                </p>
              </section>

              <div className="bg-gray-100 p-6 rounded-lg mt-8">
                <h3 className="text-xl font-semibold text-deep-blue mb-3">The Bottom Line</h3>
                <p className="text-gray-700">
                  We collect as little data as possible, use it only for running the service, don't sell or share it,
                  and delete it when you ask. We think that's how the internet should work.
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
