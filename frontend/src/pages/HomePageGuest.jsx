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
            The AI Study Toolkit
          </h2>
          <p className="text-lg md:text-xl text-gray-600 max-w-3xl mx-auto">
            Quizzes, step-by-step explanations, Cornell notes, citations, timers, and progress tools — in one place.
          </p>
        </div>

        {/* Search Bar */}
        <div className="max-w-3xl mx-auto mb-8">
          <ToolSearch
            placeholder="What do you want to study today? Try 'Generate quiz', 'AI tutor', 'Citation'..."
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
          Built for students, teachers, and self-learners — focused on active recall.
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

      {/* Built For */}
      <section className="bg-off-white py-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white rounded-2xl p-8 text-center shadow-md">
              <div className="text-5xl font-bold text-primary-blue mb-2">🎓</div>
              <div className="text-gray-600 font-semibold">Students</div>
              <div className="text-sm text-gray-500 mt-2">Turn notes into quizzes for active recall</div>
            </div>

            <div className="bg-white rounded-2xl p-8 text-center shadow-md">
              <div className="text-5xl font-bold text-primary-blue mb-2">👩‍🏫</div>
              <div className="text-gray-600 font-semibold">Teachers</div>
              <div className="text-sm text-gray-500 mt-2">Create quick checks for understanding</div>
            </div>

            <div className="bg-white rounded-2xl p-8 text-center shadow-md">
              <div className="text-5xl font-bold text-primary-blue mb-2">🧠</div>
              <div className="text-gray-600 font-semibold">Self‑Learners</div>
              <div className="text-sm text-gray-500 mt-2">Study any topic with better questions</div>
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
