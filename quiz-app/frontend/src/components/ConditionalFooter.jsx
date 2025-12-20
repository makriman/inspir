import { useLocation } from 'react-router-dom';
import Footer from './Footer';

export default function ConditionalFooter() {
  const location = useLocation();

  // Hide the footer inside "app" experiences (tools + authenticated areas).
  // Keep it for marketing/content pages like Home, Blog, About, FAQ, etc.
  const hidePrefixes = [
    '/auth',
    '/citations',
    '/coming-soon',
    '/concept-map',
    '/cornell-notes',
    '/dashboard',
    '/daily-goals',
    '/task-timer',
    '/break-reminder',
    '/deep-work',
    '/group-timer',
    '/focus-music',
    '/ambient-sounds',
    '/doubt',
    '/flashcards',
    '/forum',
    '/grade-calculator',
    '/habit-tracker',
    '/history',
    '/math-solver',
    '/mind-map',
    '/practice-test-builder',
    '/progress-dashboard',
    '/quiz',
    '/results',
    '/shared',
    '/streaks',
    '/study-guide-gen',
    '/study-timer',
    '/text-summarizer',
    '/weekly-reports',
  ];

  const shouldHideFooter = hidePrefixes.some((prefix) => location.pathname.startsWith(prefix));

  // Don't render Footer if we're on a hide route
  if (shouldHideFooter) {
    return null;
  }

  return <Footer />;
}
