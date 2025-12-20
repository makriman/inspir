import { useLocation } from 'react-router-dom';
import Footer from './Footer';

export default function ConditionalFooter() {
  const location = useLocation();

  // Hide the footer inside "app" experiences (tools + authenticated areas).
  // Keep it for marketing/content pages like Home, Blog, About, FAQ, etc.
  const hidePrefixes = [
    '/auth',
    '/citations',
    '/cornell-notes',
    '/dashboard',
    '/doubt',
    '/forum',
    '/grade-calculator',
    '/history',
    '/quiz',
    '/results',
    '/shared',
    '/streaks',
    '/study-timer',
  ];

  const shouldHideFooter = hidePrefixes.some((prefix) => location.pathname.startsWith(prefix));

  // Don't render Footer if we're on a hide route
  if (shouldHideFooter) {
    return null;
  }

  return <Footer />;
}
