import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ToolCard from '../components/ToolCard';
import ToolSearch from '../components/ToolSearch';
import ComingSoonModal from '../components/ComingSoonModal';
import { tools, categories, getLiveTools, getComingSoonTools, getToolsByCategory } from '../config/tools';

export default function HomePageGuest() {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showAllTools, setShowAllTools] = useState(false);
  const [selectedTool, setSelectedTool] = useState(null);

  const liveTools = getLiveTools();
  const comingSoonTools = getComingSoonTools();
  const filteredTools = getToolsByCategory(selectedCategory);
  const displayedTools = showAllTools ? filteredTools : filteredTools.slice(0, 18);

  const handleToolClick = (tool) => {
    if (tool.route) {
      navigate(tool.route);
      return;
    }
    if (tool.status === 'coming-soon') {
      setSelectedTool(tool);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-off-white">
      {/* Hero Section */}
      <section className="max-w-5xl mx-auto px-4 py-16 md:py-24">
        {/* Logo & Headline */}
        <div className="text-center mb-8 animate-fadeIn">
          <h1 className="text-5xl md:text-6xl font-bold text-primary-blue mb-4">
            inspir
          </h1>
          <h2 className="text-4xl md:text-5xl font-bold text-black mb-6">
            The Modern AI Study Toolkit
          </h2>
          <p className="text-lg md:text-xl text-gray-600 max-w-3xl mx-auto">
            The modern study toolkit powered by advanced AI. Create quizzes from any content, solve doubts instantly, stay focused with timers, and track progress with goals and streaks.
          </p>
        </div>

        {/* Search Bar */}
        <div className="max-w-3xl mx-auto mb-8">
          <ToolSearch
            placeholder="What do you want to do today? Try 'Quiz', 'Doubt solver', 'Study timer', 'XP', 'Planner'..."
            large={true}
            onToolClick={handleToolClick}
          />
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-6">
          <button
            onClick={() => {
              document.getElementById('live-tools')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="w-full sm:w-auto px-8 py-4 bg-accent-red text-white font-bold text-lg rounded-xl hover:bg-red-600 transform hover:scale-105 transition-all duration-200 shadow-lg"
          >
            Explore Tools
          </button>
          <button
            onClick={() => navigate('/auth')}
            className="w-full sm:w-auto px-8 py-4 bg-white text-primary-blue font-bold text-lg rounded-xl border-2 border-primary-blue hover:bg-primary-blue hover:text-white transition-all duration-200"
          >
            Create Account
          </button>
        </div>

        {/* Social Proof */}
        <p className="text-center text-sm text-gray-500">
          Join 10,000+ students, teachers, and professionals — powered by advanced AI
        </p>
      </section>

      {/* Live Tools Showcase */}
      <section id="live-tools" className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-black mb-3">
            Start Learning Today
          </h2>
          <p className="text-lg text-gray-600">
            {liveTools.length} powerful tools, ready to use
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {liveTools.map((tool, index) => (
            <div
              key={tool.id}
              className="animate-fadeIn"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <ToolCard tool={tool} onClick={handleToolClick} />
            </div>
          ))}
        </div>
      </section>

      {/* All Tools Gallery */}
      <section id="all-tools" className="bg-white py-16">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-3">
              The Complete Study Toolkit
            </h2>
            <p className="text-lg text-gray-600">
              A growing toolkit to support your workflow
            </p>
          </div>

          {/* Category Filter Tabs */}
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {categories.map((category) => {
              const count = category === 'All' ? tools.length : getToolsByCategory(category).length;
              return (
                <button
                  key={category}
                  onClick={() => {
                    setSelectedCategory(category);
                    setShowAllTools(false);
                  }}
                  className={`
                    px-4 py-2 rounded-full font-semibold transition-all duration-200
                    ${selectedCategory === category
                      ? 'bg-primary-blue text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }
                  `}
                >
                  {category} ({count})
                </button>
              );
            })}
          </div>

          {/* Tools Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {displayedTools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} onClick={handleToolClick} />
            ))}
          </div>

          {/* Load More Button */}
          {!showAllTools && filteredTools.length > 18 && (
            <div className="text-center mt-8">
              <button
                onClick={() => setShowAllTools(true)}
                className="px-8 py-3 bg-primary-blue text-white font-bold rounded-xl hover:bg-opacity-90 transition-all duration-200"
              >
                Load More ({filteredTools.length - 18} more tools)
              </button>
            </div>
          )}
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-black mb-3">
            How It Works
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center p-6">
            <div className="text-6xl mb-4">🎯</div>
            <h3 className="text-xl font-bold mb-2">Choose Your Tool</h3>
            <p className="text-gray-600">
              Pick a tool and start in seconds
            </p>
          </div>

          <div className="text-center p-6">
            <div className="text-6xl mb-4">✨</div>
            <h3 className="text-xl font-bold mb-2">Use AI Features</h3>
            <p className="text-gray-600">
              Leverage cutting-edge AI to study smarter and faster
            </p>
          </div>

          <div className="text-center p-6">
            <div className="text-6xl mb-4">📈</div>
            <h3 className="text-xl font-bold mb-2">Track Progress</h3>
            <p className="text-gray-600">
              Save quizzes, review attempts, and build better study habits
            </p>
          </div>
        </div>
      </section>

      {/* Persona Navigation Pills */}
      <section className="bg-white py-6 sticky top-0 z-20 border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex justify-center gap-4 flex-wrap">
            <a href="#for-students" className="px-6 py-2 rounded-full bg-blue-100 text-blue-700 font-semibold hover:bg-blue-200 transition-all">
              For Students
            </a>
            <a href="#for-teachers" className="px-6 py-2 rounded-full bg-purple-100 text-purple-700 font-semibold hover:bg-purple-200 transition-all">
              For Teachers
            </a>
            <a href="#for-professionals" className="px-6 py-2 rounded-full bg-green-100 text-green-700 font-semibold hover:bg-green-200 transition-all">
              For Professionals
            </a>
          </div>
        </div>
      </section>

      {/* Students Section */}
      <section id="for-students" className="py-16 bg-gradient-to-br from-blue-50 to-white">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="text-6xl mb-4">🎓</div>
              <h2 className="text-4xl font-bold text-deep-blue mb-4">
                For Students: Study Smarter, Not Harder
              </h2>
              <p className="text-xl text-gray-700 mb-6">
                Turn passive reading into active recall. Generate practice quizzes from your notes, get instant doubt solving, and build study streaks that actually stick.
              </p>
              <div className="space-y-4 mb-6">
                <div className="flex items-start">
                  <span className="text-2xl mr-3">✓</span>
                  <div>
                    <h3 className="font-bold text-lg">Quiz from Lecture Notes</h3>
                    <p className="text-gray-600">Upload notes, get targeted questions in seconds</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <span className="text-2xl mr-3">✓</span>
                  <div>
                    <h3 className="font-bold text-lg">Instant Doubt Solving</h3>
                    <p className="text-gray-600">Stuck? Get step-by-step explanations 24/7</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <span className="text-2xl mr-3">✓</span>
                  <div>
                    <h3 className="font-bold text-lg">Track Your Progress</h3>
                    <p className="text-gray-600">Build study streaks and see your improvement</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 flex-wrap">
                <button onClick={() => navigate('/quiz')} className="px-6 py-3 bg-primary-blue text-white font-bold rounded-xl hover:bg-opacity-90 transition-all">
                  Try Quiz Generator
                </button>
                <button onClick={() => navigate('/blog/students-exam-prep')} className="px-6 py-3 bg-white text-primary-blue font-bold rounded-xl border-2 border-primary-blue hover:bg-primary-blue hover:text-white transition-all">
                  Read Study Guide →
                </button>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-xl p-8">
              <h3 className="text-xl font-bold mb-4">Popular Student Workflows:</h3>
              <ul className="space-y-3 text-gray-700">
                <li>📝 Upload notes → 🧠 Quiz yourself → 📊 Review mistakes</li>
                <li>🤔 Hit a wall → 🔍 Doubt Solver → ✅ Understand & retest</li>
                <li>⏱️ Pomodoro timer → 📚 Study session → 🔥 Track streak</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Teachers Section */}
      <section id="for-teachers" className="py-16 bg-gradient-to-br from-purple-50 to-white">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="order-2 md:order-1">
              <div className="bg-white rounded-2xl shadow-xl p-8">
                <h3 className="text-xl font-bold mb-4">Save 5 Hours/Week:</h3>
                <ul className="space-y-3 text-gray-700">
                  <li>✓ Generate quizzes from lesson plans in 30 seconds</li>
                  <li>✓ Create formative assessments without the busywork</li>
                  <li>✓ Share quizzes with students via simple links</li>
                  <li>✓ Focus on teaching, not admin work</li>
                </ul>
              </div>
            </div>
            <div className="order-1 md:order-2">
              <div className="text-6xl mb-4">👩‍🏫</div>
              <h2 className="text-4xl font-bold text-deep-blue mb-4">
                For Teachers: Create Assessments in Minutes
              </h2>
              <p className="text-xl text-gray-700 mb-6">
                Turn lesson plans into quick checks for understanding. Generate formative assessments, share with students, and focus on teaching instead of test creation.
              </p>
              <div className="space-y-4 mb-6">
                <div className="flex items-start">
                  <span className="text-2xl mr-3">✓</span>
                  <div>
                    <h3 className="font-bold text-lg">Quick Formative Assessments</h3>
                    <p className="text-gray-600">From lesson plan to quiz in under a minute</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <span className="text-2xl mr-3">✓</span>
                  <div>
                    <h3 className="font-bold text-lg">Better MCQ Questions</h3>
                    <p className="text-gray-600">AI creates questions that test understanding</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <span className="text-2xl mr-3">✓</span>
                  <div>
                    <h3 className="font-bold text-lg">Easy Sharing</h3>
                    <p className="text-gray-600">Send quiz links to students, no accounts needed</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 flex-wrap">
                <button onClick={() => navigate('/quiz')} className="px-6 py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-opacity-90 transition-all">
                  Create Assessment
                </button>
                <button onClick={() => navigate('/blog/teachers-lesson-plans')} className="px-6 py-3 bg-white text-purple-600 font-bold rounded-xl border-2 border-purple-600 hover:bg-purple-600 hover:text-white transition-all">
                  Teacher Guide →
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Professionals Section */}
      <section id="for-professionals" className="py-16 bg-gradient-to-br from-green-50 to-white">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="text-6xl mb-4">💼</div>
              <h2 className="text-4xl font-bold text-deep-blue mb-4">
                For Professionals: Learn While You Work
              </h2>
              <p className="text-xl text-gray-700 mb-6">
                Preparing for certifications? Upskilling? Use bite-sized AI-powered quizzes and spaced repetition to learn during coffee breaks and commutes.
              </p>
              <div className="space-y-4 mb-6">
                <div className="flex items-start">
                  <span className="text-2xl mr-3">✓</span>
                  <div>
                    <h3 className="font-bold text-lg">Certification Exam Prep</h3>
                    <p className="text-gray-600">Study for AWS, PMP, CFA while working full-time</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <span className="text-2xl mr-3">✓</span>
                  <div>
                    <h3 className="font-bold text-lg">Corporate Training That Sticks</h3>
                    <p className="text-gray-600">Spaced practice for policies and procedures</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <span className="text-2xl mr-3">✓</span>
                  <div>
                    <h3 className="font-bold text-lg">Flexible Learning</h3>
                    <p className="text-gray-600">10-minute sessions that fit your schedule</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 flex-wrap">
                <button onClick={() => navigate('/quiz')} className="px-6 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-opacity-90 transition-all">
                  Start Learning
                </button>
                <button onClick={() => navigate('/blog/certification-exam-prep')} className="px-6 py-3 bg-white text-green-600 font-bold rounded-xl border-2 border-green-600 hover:bg-green-600 hover:text-white transition-all">
                  Professional Guide →
                </button>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-xl p-8">
              <h3 className="text-xl font-bold mb-4">Popular Professional Uses:</h3>
              <ul className="space-y-3 text-gray-700">
                <li>📜 Certification study (AWS, PMP, CFA, etc.)</li>
                <li>🏢 Corporate training reinforcement</li>
                <li>📈 Skill development (coding, finance, etc.)</li>
                <li>📚 Self-directed career upskilling</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-black mb-3">
            Popular Study Workflows
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white rounded-2xl p-6 shadow-md">
            <div className="text-4xl mb-3">🧠</div>
            <h3 className="text-lg font-bold mb-2 text-black">Quiz‑First Exam Prep</h3>
            <p className="text-gray-700 mb-4">
              Upload notes or type a topic → generate a quiz → review what you missed → repeat. It’s active recall in a simple loop.
            </p>
            <button
              onClick={() => navigate('/quiz')}
              className="text-primary-blue font-semibold hover:underline"
            >
              Create a quiz →
            </button>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-md">
            <div className="text-4xl mb-3">⏱️</div>
            <h3 className="text-lg font-bold mb-2 text-black">Pomodoro + Review</h3>
            <p className="text-gray-700 mb-4">
              Use a focused timer session, then finish with a short quiz to lock in what you just studied.
            </p>
            <button
              onClick={() => navigate('/study-timer')}
              className="text-primary-blue font-semibold hover:underline"
            >
              Open study timer →
            </button>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-md">
            <div className="text-4xl mb-3">🧩</div>
            <h3 className="text-lg font-bold mb-2 text-black">Unblock a Stuck Problem</h3>
            <p className="text-gray-700 mb-4">
              Ask a question or upload a problem and get step‑by‑step help. Then generate a quiz to make sure you really understood.
            </p>
            <button
              onClick={() => navigate('/doubt')}
              className="text-primary-blue font-semibold hover:underline"
            >
              Use doubt solver →
            </button>
          </div>
        </div>
      </section>

        {/* Final CTA */}
      <section className="bg-gradient-to-r from-purple-light to-purple-dark py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Ready to study smarter?
          </h2>
          <p className="text-lg text-white opacity-90 mb-8">
            Start with any tool — quizzes, explanations, notes, or a timer
          </p>
          <button
            onClick={() => navigate('/quiz')}
            className="px-10 py-4 bg-accent-red text-white font-bold text-lg rounded-xl hover:bg-red-600 transform hover:scale-105 transition-all duration-200 shadow-xl"
          >
            Try the Quiz Generator
          </button>
          <div className="mt-4">
            <button
              onClick={() => navigate('/doubt')}
              className="text-white font-semibold hover:underline"
            >
              Or use the Doubt Solver →
            </button>
          </div>
          <p className="text-white opacity-75 mt-4 text-sm">
            No credit card required • {liveTools.length} tools ready instantly
          </p>
        </div>
      </section>

      {/* Coming Soon Modal */}
      {selectedTool && (
        <ComingSoonModal
          tool={selectedTool}
          onClose={() => setSelectedTool(null)}
        />
      )}
    </div>
  );
}
