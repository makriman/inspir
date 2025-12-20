import { Link } from 'react-router-dom';
import Navigation from '../components/Navigation';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-purple-dark to-purple-darker text-white">
      <Navigation />
      <main className="flex-grow flex items-center justify-center px-4 py-12">
        <div className="max-w-3xl w-full bg-white/10 backdrop-blur-lg border border-white/10 rounded-3xl p-10 shadow-2xl text-center relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-16 -left-16 w-48 h-48 bg-vibrant-yellow/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-10 -right-10 w-64 h-64 bg-coral-red/20 rounded-full blur-3xl" />
          </div>

          <div className="relative z-10 space-y-4">
            <p className="text-sm uppercase tracking-[0.3em] text-vibrant-yellow">Lost in the quiziverse</p>
            <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight">404</h1>
            <p className="text-xl text-purple-100">
              This page took a break, but the new tools are wide awake—jump into the student forum, a study timer, or
              spin up a fresh quiz.
            </p>
            <div className="flex flex-wrap gap-3 justify-center mt-4">
              <Link
                to="/"
                className="bg-coral-red text-white px-5 py-3 rounded-xl font-semibold hover:scale-[1.02] transition-transform shadow-lg"
              >
                Generate a Quiz
              </Link>
              <Link
                to="/forum"
                className="bg-white/15 border border-white/10 text-white px-5 py-3 rounded-xl font-semibold hover:bg-white/20 transition"
              >
                Visit Student Forum
              </Link>
              <Link
                to="/study-timer"
                className="bg-white/15 border border-white/10 text-white px-5 py-3 rounded-xl font-semibold hover:bg-white/20 transition"
              >
                Open Study Timer
              </Link>
              <Link
                to="/dashboard"
                className="bg-white/15 border border-white/10 text-white px-5 py-3 rounded-xl font-semibold hover:bg-white/20 transition"
              >
                Go to Dashboard
              </Link>
            </div>
            <p className="text-sm text-purple-200">
              Need a different page? Try How It Works, Blog, or FAQ from the nav.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
