import { Link } from 'react-router-dom';

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const shareUrl = encodeURIComponent('https://quiz.inspir.uk/');
  const shareText = encodeURIComponent('inspir — an AI study toolkit: quizzes, step-by-step help, notes, citations, focus, and progress.');

  return (
    <footer className="bg-deep-blue text-white mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div>
            <h3 className="text-vibrant-yellow font-bold text-xl mb-4">inspir</h3>
            <p className="text-gray-300 text-sm">
              An AI study toolkit for active learning: quizzes, explanations, notes, citations, focus tools, and progress tracking.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 rounded-full bg-white/10 text-gray-200">Quizzes</span>
              <span className="px-2 py-1 rounded-full bg-white/10 text-gray-200">Doubt Solver</span>
              <span className="px-2 py-1 rounded-full bg-white/10 text-gray-200">Study Timer</span>
              <span className="px-2 py-1 rounded-full bg-white/10 text-gray-200">Notes</span>
            </div>
          </div>

          {/* Tools */}
          <div>
            <h4 className="font-semibold mb-4">Tools</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/quiz" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Create a Quiz</Link></li>
              <li><Link to="/study-timer" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Study Timer</Link></li>
              <li><Link to="/grade-calculator" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Grade Calculator</Link></li>
              <li><Link to="/cornell-notes" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Cornell Notes</Link></li>
              <li><Link to="/citations" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Citation Generator</Link></li>
              <li><Link to="/streaks" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Study Streaks</Link></li>
              <li><Link to="/doubt" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Doubt Solver</Link></li>
            </ul>
          </div>

          {/* Learn */}
          <div>
            <h4 className="font-semibold mb-4">Learn</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/how-it-works" className="text-gray-300 hover:text-vibrant-yellow transition-colors">How It Works</Link></li>
              <li><Link to="/use-cases" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Use Cases</Link></li>
              <li><Link to="/blog" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Blog</Link></li>
              <li><a href="/rss.xml" className="text-gray-300 hover:text-vibrant-yellow transition-colors">RSS</a></li>
              <li><a href="/sitemap.xml" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Sitemap</a></li>
              <li><Link to="/about" className="text-gray-300 hover:text-vibrant-yellow transition-colors">About</Link></li>
              <li><Link to="/faq" className="text-gray-300 hover:text-vibrant-yellow transition-colors">FAQ</Link></li>
            </ul>
          </div>

          {/* Community */}
          <div>
            <h4 className="font-semibold mb-4">Community</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/forum" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Student Forum</Link></li>
              <li>
                <a
                  href={`https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareText}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-300 hover:text-vibrant-yellow transition-colors"
                >
                  Share on X
                </a>
              </li>
              <li>
                <a
                  href={`https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-300 hover:text-vibrant-yellow transition-colors"
                >
                  Share on LinkedIn
                </a>
              </li>
              <li>
                <a
                  href={`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-300 hover:text-vibrant-yellow transition-colors"
                >
                  Share on Facebook
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/privacy" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Terms of Service</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-700 mt-8 pt-8 text-center text-sm text-gray-400">
          <p>&copy; {currentYear} inspir. All rights reserved. | Study smarter with active learning.</p>
        </div>
      </div>
    </footer>
  );
}
