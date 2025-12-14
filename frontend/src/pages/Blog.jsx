import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { blogPosts } from '../seo/blogPosts';

export default function Blog() {
  const [selectedCategory, setSelectedCategory] = useState('All');

  const articles = blogPosts.map((post) => ({
    slug: post.slug,
    title: post.title,
    excerpt: post.description,
    category: post.category,
    readTime: post.readTime,
    icon: post.icon,
  }));

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
            The inspir <span className="text-vibrant-yellow">Learning Blog</span>
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
              Build a simple study system: focus, learn, test yourself, fix gaps, repeat.
            </p>
            <Link
              to="/how-it-works"
              className="inline-block bg-gradient-to-r from-coral-red to-red-600 text-white px-10 py-4 rounded-xl font-bold text-lg hover:shadow-lg hover:scale-105 transition-all"
            >
              Explore The Toolkit →
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
