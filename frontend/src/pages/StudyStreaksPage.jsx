import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import StudyStreaks from '../components/StudyStreaks';

export default function StudyStreaksPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900">
      <Navigation />

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-4">
              🔥 Study Streaks
            </h1>
            <p className="text-xl text-gray-300">
              Track your daily study habits and build consistent learning streaks
            </p>
          </div>

          {/* Study Streaks Component */}
          <StudyStreaks compact={false} />
        </div>
      </div>

      <Footer />
    </div>
  );
}
