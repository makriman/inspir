import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import { Link } from 'react-router-dom';
import { useState } from 'react';

export default function Blog() {
  const [selectedCategory, setSelectedCategory] = useState('All');

  const articles = [
    {
      slug: 'students-exam-prep',
      title: 'How to Actually Prepare for Exams (Without Just Re-Reading Your Notes)',
      excerpt: 'Re-reading your notes feels productive, but it\'s one of the least effective study methods. Here\'s what actually works.',
      category: 'Study Tips',
      readTime: '8 min',
      icon: '📚'
    },
    {
      slug: 'teachers-lesson-plans',
      title: 'Creating Assessments From Lesson Plans in Minutes, Not Hours',
      excerpt: 'Teachers spend countless hours writing quiz questions. Here\'s how to cut that time down to minutes while maintaining quality.',
      category: 'For Teachers',
      readTime: '7 min',
      icon: '👩‍🏫'
    },
    {
      slug: 'study-smarter-notes',
      title: 'Study Smarter: Turn Your Notes Into Active Learning',
      excerpt: 'Your notes are just sitting there. Here\'s how to transform them into an active learning tool that actually improves retention.',
      category: 'Study Tips',
      readTime: '9 min',
      icon: '📝'
    },
    {
      slug: 'quiz-yourself-quickly',
      title: 'The 5-Minute Study Hack That Actually Works',
      excerpt: 'Don\'t have time to study? This quick technique helps you retain more in less time.',
      category: 'Quick Tips',
      readTime: '5 min',
      icon: '⚡'
    },
    {
      slug: 'self-directed-learning',
      title: 'Self-Directed Learning: How to Actually Retain What You Teach Yourself',
      excerpt: 'Teaching yourself something new? Here\'s how to ensure the information sticks beyond next week.',
      category: 'Learning Strategies',
      readTime: '10 min',
      icon: '🎯'
    },
    {
      slug: 'effective-study-quizzes',
      title: 'What Makes a Good Study Quiz? (It\'s Not What You Think)',
      excerpt: 'Not all quizzes are created equal. Learn what separates effective learning tools from time-wasters.',
      category: 'Study Tips',
      readTime: '8 min',
      icon: '✅'
    },
    {
      slug: 'professional-training',
      title: 'Professional Development That Actually Sticks: A Training Guide',
      excerpt: 'Most professional training is forgotten within a week. Here\'s how to make it stick.',
      category: 'Professional',
      readTime: '9 min',
      icon: '💼'
    },
    {
      slug: 'active-recall-learning',
      title: 'Why Active Recall Beats Every Other Study Method',
      excerpt: 'Science says active recall is the most effective way to learn. Here\'s what it is and how to use it.',
      category: 'Learning Science',
      readTime: '11 min',
      icon: '🧠'
    },
    {
      slug: 'textbook-quizzes',
      title: 'Stop Highlighting Your Textbook and Do This Instead',
      excerpt: 'Highlighting feels like studying, but it barely helps. Here\'s a better way to process textbook content.',
      category: 'Study Tips',
      readTime: '7 min',
      icon: '📖'
    },
    {
      slug: 'language-learning',
      title: 'Language Learning Beyond Flashcards: Testing Comprehension, Not Just Vocabulary',
      excerpt: 'Flashcards help with vocabulary, but they won\'t make you fluent. Here\'s what will.',
      category: 'Language Learning',
      readTime: '10 min',
      icon: '🌍'
    },
    {
      slug: 'medical-students-guide',
      title: 'Medical School Study Strategies: Managing Information Overload',
      excerpt: 'Medical students face an impossible amount of material. Here\'s how to actually learn it all.',
      category: 'Medical Education',
      readTime: '12 min',
      icon: '⚕️'
    },
    {
      slug: 'law-school-study',
      title: 'Law School Success: Beyond Case Briefs and Outlines',
      excerpt: 'Case briefs and outlines are important, but they won\'t prepare you for exams. Here\'s what will.',
      category: 'Legal Education',
      readTime: '10 min',
      icon: '⚖️'
    },
    {
      slug: 'homeschool-assessments',
      title: 'Homeschool Assessments Without the Stress',
      excerpt: 'Creating homeschool assessments doesn\'t have to take hours. Here\'s how to test understanding efficiently.',
      category: 'Homeschooling',
      readTime: '8 min',
      icon: '🏠'
    },
    {
      slug: 'corporate-training',
      title: 'Corporate Training That Employees Actually Remember',
      excerpt: 'Most corporate training is forgotten immediately. Here\'s how to design training that sticks.',
      category: 'Corporate',
      readTime: '9 min',
      icon: '🏢'
    },
    {
      slug: 'study-groups-collaboration',
      title: 'Making Study Groups Actually Productive',
      excerpt: 'Study groups often devolve into social hour. Here\'s how to make them effective learning sessions.',
      category: 'Study Tips',
      readTime: '8 min',
      icon: '👥'
    },
    {
      slug: 'certification-exam-prep',
      title: 'Certification Exam Prep: How to Study When You Have a Full-Time Job',
      excerpt: 'Studying for certifications while working full-time requires strategy. Here\'s what actually works.',
      category: 'Professional',
      readTime: '10 min',
      icon: '🎓'
    },
    {
      slug: 'vs-traditional-flashcards',
      title: 'AI Quizzes vs. Traditional Flashcards: What Works Better?',
      excerpt: 'Flashcards have been the go-to study tool for decades. But are they still the best option?',
      category: 'Learning Tools',
      readTime: '9 min',
      icon: '🆚'
    },
    {
      slug: 'science-active-recall',
      title: 'The Science of Active Recall: Why Testing Yourself Works',
      excerpt: 'Active recall isn\'t just a study hack—it\'s backed by decades of cognitive science research.',
      category: 'Learning Science',
      readTime: '11 min',
      icon: '🔬'
    },
    {
      slug: 'research-paper-quizzes',
      title: 'Academic Research: Using Quizzes to Understand Dense Papers',
      excerpt: 'Research papers are hard to parse. Here\'s how quizzes can help you actually understand them.',
      category: 'Academic',
      readTime: '9 min',
      icon: '📄'
    },
    {
      slug: 'general-knowledge-fun',
      title: 'Learning for Fun: Building General Knowledge Without Formal Classes',
      excerpt: 'Want to be smarter and more knowledgeable? Here\'s how to learn effectively outside of formal education.',
      category: 'Lifelong Learning',
      readTime: '8 min',
      icon: '💡'
    }
  ];

  const categories = ['All', ...new Set(articles.map(a => a.category))];

  const filteredArticles = selectedCategory === 'All'
    ? articles
    : articles.filter(a => a.category === selectedCategory);

  return (
    <>
      <Navigation />

      {/* Hero Section */}
      <div className="bg-gradient-to-r from-purple-dark via-purple-darker to-deep-blue text-white py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">
            The InspirQuiz <span className="text-vibrant-yellow">Learning Blog</span>
          </h1>
          <p className="text-xl md:text-2xl text-purple-100 max-w-3xl mx-auto mb-8">
            Evidence-based study strategies, learning science, and practical tips to help you learn smarter, not harder.
          </p>
          <div className="flex justify-center items-center gap-8 text-purple-200">
            <div className="text-center">
              <div className="text-3xl font-bold text-vibrant-yellow">{articles.length}</div>
              <div className="text-sm">Articles</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-vibrant-yellow">{categories.length - 1}</div>
              <div className="text-sm">Categories</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-vibrant-yellow">100%</div>
              <div className="text-sm">Free</div>
            </div>
          </div>
        </div>
      </div>

      <main className="min-h-screen bg-gradient-to-br from-gray-50 to-purple-50">
        <div className="max-w-6xl mx-auto px-4 py-12">
          {/* Category Filter */}
          <div className="mb-10">
            <div className="flex flex-wrap gap-2 justify-center">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-4 py-2 rounded-full font-medium transition-all ${
                    selectedCategory === category
                      ? 'bg-gradient-to-r from-purple-dark to-purple-darker text-white shadow-md scale-105'
                      : 'bg-white text-gray-700 hover:bg-purple-100 hover:text-purple-dark border border-gray-200'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            <p className="text-center text-gray-600 mt-4">
              Showing {filteredArticles.length} {filteredArticles.length === 1 ? 'article' : 'articles'}
            </p>
          </div>

          {/* Articles Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredArticles.map((article) => (
              <Link
                key={article.slug}
                to={`/blog/${article.slug}`}
                className="group bg-white rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col transform hover:-translate-y-1"
              >
                {/* Icon Header */}
                <div className="bg-gradient-to-br from-purple-100 to-blue-100 p-8 text-center">
                  <div className="text-6xl mb-2">{article.icon}</div>
                  <span className="inline-block text-xs font-semibold px-3 py-1 bg-white text-purple-dark rounded-full shadow-sm">
                    {article.category}
                  </span>
                </div>

                {/* Content */}
                <div className="p-6 flex flex-col flex-grow">
                  <h2 className="text-xl font-bold text-deep-blue mb-3 group-hover:text-purple-dark transition-colors leading-snug">
                    {article.title}
                  </h2>
                  <p className="text-gray-700 text-sm mb-4 flex-grow leading-relaxed">
                    {article.excerpt}
                  </p>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                    <span className="text-xs text-gray-500 flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {article.readTime}
                    </span>
                    <span className="text-purple-dark font-semibold text-sm group-hover:text-coral-red transition-colors flex items-center">
                      Read more
                      <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* CTA Section */}
          <div className="mt-16 bg-gradient-to-r from-purple-dark via-purple-darker to-deep-blue text-white rounded-2xl p-8 md:p-12 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Put These Tips Into Practice?</h2>
            <p className="text-xl text-purple-100 mb-6 max-w-2xl mx-auto">
              Generate your first quiz and start learning more effectively today
            </p>
            <Link
              to="/"
              className="inline-block bg-gradient-to-r from-coral-red to-red-600 text-white px-10 py-4 rounded-xl font-bold text-lg hover:shadow-lg hover:scale-105 transition-all"
            >
              Create a Quiz Now →
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
