import { useLocation } from 'react-router-dom';
import Footer from './Footer';

export default function ConditionalFooter() {
  const location = useLocation();

  // Hide the footer inside "app" experiences (tools + authenticated areas).
  // Keep it for marketing/content pages like Home, Blog, About, FAQ, etc.
  const hidePrefixes = [
    '/accountability',
    '/auth',
    '/badges',
    '/citations',
    '/coming-soon',
    '/concept-map',
    '/cornell-notes',
    '/course-manager',
    '/dashboard',
    '/daily-goals',
    '/assignment-tracker',
    '/challenges',
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
    '/gpa-tracker',
    '/habit-tracker',
    '/history',
    '/leaderboards',
    '/math-solver',
    '/milestones',
    '/mind-map',
    '/note-organizer',
    '/practice-test-builder',
    '/progress-viz',
    '/progress-dashboard',
    '/quiz',
    '/resource-sharing',
    '/results',
    '/shared',
    '/schedule-builder',
    '/streaks',
    '/study-groups',
    '/study-guide-gen',
    '/study-planner',
    '/study-timer',
    '/text-summarizer',
    '/weekly-reports',
    '/xp-leveling',
  ];

  const shouldHideFooter = hidePrefixes.some((prefix) => location.pathname.startsWith(prefix));

  // Don't render Footer if we're on a hide route
  if (shouldHideFooter) {
    return null;
  }

  return <Footer />;
}
