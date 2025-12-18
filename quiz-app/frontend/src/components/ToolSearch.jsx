import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchTools } from '../config/tools';

export default function ToolSearch({ placeholder, large = false, onToolClick }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchRef = useRef(null);
  const navigate = useNavigate();

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search when query changes
  useEffect(() => {
    if (query.trim() === '') {
      setResults([]);
      setShowResults(false);
      return;
    }

    const searchResults = searchTools(query).slice(0, 10);
    setResults(searchResults);
    setShowResults(true);
    setFocusedIndex(-1);
  }, [query]);

  const handleToolClick = (tool) => {
    setQuery('');
    setShowResults(false);

    if (tool.status === 'live' && tool.route) {
      navigate(tool.route);
    } else if (onToolClick) {
      onToolClick(tool);
    }
  };

  const handleKeyDown = (e) => {
    if (!showResults || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) =>
        prev < results.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && focusedIndex >= 0) {
      e.preventDefault();
      handleToolClick(results[focusedIndex]);
    } else if (e.key === 'Escape') {
      setShowResults(false);
    }
  };

  const highlightMatch = (text, query) => {
    if (!query) return text;

    const regex = new RegExp(`(${query})`, 'gi');
    const parts = text.split(regex);

    return (
      <span>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <span key={i} className="bg-accent-yellow text-black font-semibold">
              {part}
            </span>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </span>
    );
  };

  return (
    <div ref={searchRef} className="relative w-full">
      {/* Search Input */}
      <div className="relative">
        <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
          <svg
            className={`${large ? 'w-6 h-6' : 'w-5 h-5'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query && setShowResults(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Search all 67 tools..."}
          className={`
            w-full bg-white border-2 border-gray-200
            rounded-xl pl-12 pr-4
            focus:border-primary-blue focus:outline-none
            transition-all duration-200
            ${large
              ? 'py-4 text-lg placeholder:text-gray-400'
              : 'py-3 text-base placeholder:text-gray-400'
            }
          `}
        />

        {/* Clear Button */}
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              setShowResults(false);
            }}
            className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border-2 border-gray-100 max-h-96 overflow-y-auto z-50">
          {results.map((tool, index) => (
            <div
              key={tool.id}
              onClick={() => handleToolClick(tool)}
              className={`
                p-4 cursor-pointer transition-colors duration-150
                hover:bg-off-white border-b border-gray-100 last:border-b-0
                ${focusedIndex === index ? 'bg-off-white' : ''}
              `}
            >
              <div className="flex items-start space-x-3">
                {/* Tool Icon */}
                <div className="text-3xl flex-shrink-0">
                  {tool.icon}
                </div>

                <div className="flex-grow min-w-0">
                  {/* Tool Name */}
                  <div className="flex items-center space-x-2 mb-1">
                    <h4 className="font-semibold text-gray-900">
                      {highlightMatch(tool.name, query)}
                    </h4>

                    {/* Status Badge */}
                    {tool.status === 'live' ? (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">
                        Live
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-bold rounded-full">
                        Coming Soon
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-sm text-gray-600 line-clamp-1">
                    {tool.description.slice(0, 60)}...
                  </p>

                  {/* Category */}
                  <div className="mt-1">
                    <span className="text-xs text-gray-500">
                      {tool.category}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No Results */}
      {showResults && query && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border-2 border-gray-100 p-8 text-center z-50">
          <div className="text-4xl mb-2">🔍</div>
          <p className="text-gray-600">
            No tools found for "<span className="font-semibold">{query}</span>"
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Try searching for "quiz", "timer", "notes", or "AI"
          </p>
        </div>
      )}
    </div>
  );
}
