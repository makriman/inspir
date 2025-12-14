import { Link } from 'react-router-dom';
import Navigation from './Navigation';
import Footer from './Footer';

export default function BlogLayout({
  title,
  category = 'Learning',
  readTime = '7 min read',
  updated = 'Updated recently',
  heroImage = '/blog-hero.svg',
  children
}) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-purple-50 via-white to-purple-50">
      <Navigation />
      <main className="flex-grow">
        <section className="max-w-5xl mx-auto px-4 py-10">
          <Link to="/blog" className="text-purple-dark hover:underline mb-4 inline-block">← Back to Blog</Link>

          <div className="bg-white shadow-xl rounded-3xl overflow-hidden border border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-0">
              <div className="p-8 md:p-10 flex flex-col justify-center space-y-4">
                <div className="flex items-center space-x-3 text-sm text-purple-700 font-semibold">
                  <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-800">{category}</span>
                  <span>•</span>
                  <span>{readTime}</span>
                </div>
                <h1 className="text-3xl md:text-4xl font-extrabold text-deep-blue leading-tight">
                  {title}
                </h1>
                <p className="text-sm text-gray-500">{updated}</p>
                <div className="flex flex-wrap gap-3">
                  <Link
                    to="/"
                    className="bg-coral-red text-white px-4 py-2 rounded-xl font-semibold shadow-md hover:scale-[1.01] transition-transform"
                  >
                    Generate a Quiz
                  </Link>
                  <Link
                    to="/study-timer"
                    className="bg-white text-deep-blue border border-gray-200 px-4 py-2 rounded-xl font-semibold shadow-sm hover:bg-gray-50 transition"
                  >
                    Open Study Timer
                  </Link>
                </div>
              </div>
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-200 via-purple-100 to-vibrant-yellow/40" />
                <div className="relative h-full flex items-center justify-center p-6">
                  <img
                    src={heroImage}
                    alt={`${title} illustration`}
                    className="max-h-64 object-contain drop-shadow-xl"
                    loading="lazy"
                  />
                </div>
              </div>
            </div>
          </div>

          <article className="bg-white shadow-lg border border-gray-100 rounded-3xl p-6 md:p-10 mt-8 prose prose-lg max-w-none">
            {children}
            <div className="mt-10 p-6 rounded-2xl bg-gradient-to-r from-purple-100 to-blue-100 border border-purple-200">
              <h3 className="text-xl font-bold text-deep-blue mb-2">Try inspir for your next study session</h3>
              <p className="text-gray-700 mb-4">
                Turn any set of notes into a 10-question quiz in seconds, then stay on track with the Pomodoro Study Timer.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link to="/" className="bg-coral-red text-white px-5 py-3 rounded-xl font-semibold shadow hover:scale-[1.01] transition-transform">
                  Generate a Quiz
                </Link>
                <Link to="/study-timer" className="bg-white border border-purple-200 text-deep-blue px-5 py-3 rounded-xl font-semibold hover:bg-purple-50 transition">
                  Open Study Timer
                </Link>
              </div>
            </div>
          </article>
        </section>
      </main>
      <Footer />
    </div>
  );
}
