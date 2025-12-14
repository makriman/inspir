import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user } = useAuth();
  const navLinks = [
    { to: '/chat', label: 'AI Chat' },
    { to: '/doubt', label: 'Doubt Solver' },
    { to: '/how-it-works', label: 'How It Works' },
    { to: '/use-cases', label: 'Use Cases' },
    { to: '/study-timer', label: 'Study Timer' },
    { to: '/grade-calculator', label: 'Grade Calculator' },
    { to: '/forum', label: 'Forum' },
    { to: '/blog', label: 'Blog' },
    { to: '/faq', label: 'FAQ' },
    { to: '/about', label: 'About' },
  ];

  return (
    <nav className="bg-white shadow-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="flex items-center">
              <span className="text-2xl font-bold bg-gradient-to-r from-purple-dark to-purple-darker bg-clip-text text-transparent">
                inspir
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            {navLinks.map((link) => (
              <Link key={link.to} to={link.to} className="text-deep-blue hover:text-purple-dark font-medium transition-colors">
                {link.label}
              </Link>
            ))}
            {user ? (
              <Link to="/dashboard" className="bg-coral-red text-white px-4 py-2 rounded-lg font-semibold hover:bg-opacity-90 transition-all">
                Dashboard
              </Link>
            ) : (
              <Link to="/auth" className="bg-coral-red text-white px-4 py-2 rounded-lg font-semibold hover:bg-opacity-90 transition-all">
                Sign In
              </Link>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-deep-blue hover:text-purple-dark"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white border-t">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="block px-3 py-2 text-deep-blue hover:bg-gray-100 rounded-md"
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            {user ? (
              <Link to="/dashboard" className="block px-3 py-2 bg-coral-red text-white rounded-md text-center font-semibold" onClick={() => setMobileMenuOpen(false)}>
                Dashboard
              </Link>
            ) : (
              <Link to="/auth" className="block px-3 py-2 bg-coral-red text-white rounded-md text-center font-semibold" onClick={() => setMobileMenuOpen(false)}>
                Sign In
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
