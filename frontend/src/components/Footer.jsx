import { Link } from 'react-router-dom';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-deep-blue text-white mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <h3 className="text-vibrant-yellow font-bold text-xl mb-4">InspirQuiz</h3>
            <p className="text-gray-300 text-sm">
              AI-powered quiz generation for students, teachers, and lifelong learners.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold mb-4">Product</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/how-it-works" className="text-gray-300 hover:text-vibrant-yellow transition-colors">How It Works</Link></li>
              <li><Link to="/use-cases" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Use Cases</Link></li>
              <li><Link to="/faq" className="text-gray-300 hover:text-vibrant-yellow transition-colors">FAQ</Link></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="font-semibold mb-4">Resources</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/blog" className="text-gray-300 hover:text-vibrant-yellow transition-colors">Blog</Link></li>
              <li><Link to="/about" className="text-gray-300 hover:text-vibrant-yellow transition-colors">About</Link></li>
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
          <p>&copy; {currentYear} InspirQuiz. All rights reserved. | Built to inspire learning.</p>
        </div>
      </div>
    </footer>
  );
}
