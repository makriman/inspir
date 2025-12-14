import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import Navigation from '../components/Navigation';

const API_URL = import.meta.env.VITE_API_URL;

export default function CitationGenerator() {
  const { user } = useAuth();

  const [citationType, setCitationType] = useState('book');
  const [citationStyle, setCitationStyle] = useState('MLA');
  const [sourceData, setSourceData] = useState({
    authors: [{ firstName: '', lastName: '' }],
    title: '',
    publisher: '',
    year: '',
    city: ''
  });
  const [generatedCitation, setGeneratedCitation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [citationHistory, setCitationHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // Citation type options
  const citationTypes = [
    { value: 'book', label: 'Book' },
    { value: 'article', label: 'Journal Article' },
    { value: 'website', label: 'Website' },
    { value: 'newspaper', label: 'Newspaper Article' },
    { value: 'journal', label: 'Academic Journal' },
    { value: 'video', label: 'Video' },
    { value: 'podcast', label: 'Podcast' }
  ];

  const citationStyles = ['MLA', 'APA', 'Chicago', 'Harvard'];

  // Update form fields based on citation type
  useEffect(() => {
    switch (citationType) {
      case 'book':
        setSourceData({
          authors: [{ firstName: '', lastName: '' }],
          title: '',
          publisher: '',
          year: '',
          city: '',
          edition: ''
        });
        break;
      case 'article':
      case 'journal':
        setSourceData({
          authors: [{ firstName: '', lastName: '' }],
          title: '',
          journalName: '',
          volume: '',
          issue: '',
          pages: '',
          year: '',
          doi: ''
        });
        break;
      case 'website':
        setSourceData({
          authors: [{ firstName: '', lastName: '' }],
          title: '',
          websiteName: '',
          url: '',
          accessDate: new Date().toISOString().split('T')[0],
          publishDate: ''
        });
        break;
      case 'newspaper':
        setSourceData({
          authors: [{ firstName: '', lastName: '' }],
          title: '',
          newspaperName: '',
          date: '',
          pages: '',
          url: ''
        });
        break;
      default:
        break;
    }
  }, [citationType]);

  // Load citation history if user is authenticated
  useEffect(() => {
    if (user && showHistory) {
      loadHistory();
    }
  }, [user, showHistory]);

  const loadHistory = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/citations/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCitationHistory(response.data.citations || []);
    } catch (err) {
      console.error('Error loading history:', err);
    }
  };

  const handleAuthorChange = (index, field, value) => {
    const newAuthors = [...sourceData.authors];
    newAuthors[index][field] = value;
    setSourceData({ ...sourceData, authors: newAuthors });
  };

  const addAuthor = () => {
    setSourceData({
      ...sourceData,
      authors: [...sourceData.authors, { firstName: '', lastName: '' }]
    });
  };

  const removeAuthor = (index) => {
    if (sourceData.authors.length > 1) {
      const newAuthors = sourceData.authors.filter((_, i) => i !== index);
      setSourceData({ ...sourceData, authors: newAuthors });
    }
  };

  const handleFieldChange = (field, value) => {
    setSourceData({ ...sourceData, [field]: value });
  };

  const generateCitation = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await axios.post(
        `${API_URL}/citations/generate`,
        {
          citationType,
          citationStyle,
          sourceData
        },
        { headers }
      );

      setGeneratedCitation(response.data);
      if (user && showHistory) {
        loadHistory();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate citation');
    } finally {
      setLoading(false);
    }
  };

  const copyCitation = () => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = generatedCitation.citation;
    const text = tempDiv.textContent || tempDiv.innerText;
    navigator.clipboard.writeText(text);
    alert('Citation copied to clipboard!');
  };

  const deleteCitation = async (id) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/citations/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadHistory();
    } catch (err) {
      console.error('Error deleting citation:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900">
      <Navigation />

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-4">
              📚 Citation Generator
            </h1>
            <p className="text-xl text-gray-300">
              Generate perfectly formatted citations in MLA, APA, Chicago, and Harvard styles
            </p>
          </div>

          {/* Main Card */}
          <div className="bg-white rounded-xl shadow-2xl p-8 mb-8">
            {/* Citation Type and Style Selection */}
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Citation Type
                </label>
                <select
                  value={citationType}
                  onChange={(e) => setCitationType(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all"
                >
                  {citationTypes.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Citation Style
                </label>
                <select
                  value={citationStyle}
                  onChange={(e) => setCitationStyle(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all"
                >
                  {citationStyles.map(style => (
                    <option key={style} value={style}>
                      {style}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Authors Section */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Authors
              </label>
              {sourceData.authors && sourceData.authors.map((author, index) => (
                <div key={index} className="flex gap-3 mb-3">
                  <input
                    type="text"
                    placeholder="First Name"
                    value={author.firstName}
                    onChange={(e) => handleAuthorChange(index, 'firstName', e.target.value)}
                    className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
                  />
                  <input
                    type="text"
                    placeholder="Last Name"
                    value={author.lastName}
                    onChange={(e) => handleAuthorChange(index, 'lastName', e.target.value)}
                    className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
                  />
                  {sourceData.authors.length > 1 && (
                    <button
                      onClick={() => removeAuthor(index)}
                      className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addAuthor}
                className="text-purple-600 hover:text-purple-700 font-semibold"
              >
                + Add Another Author
              </button>
            </div>

            {/* Dynamic Fields Based on Citation Type */}
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {Object.keys(sourceData).filter(key => key !== 'authors').map(key => (
                <div key={key}>
                  <label className="block text-sm font-semibold text-gray-700 mb-2 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </label>
                  <input
                    type="text"
                    value={sourceData[key]}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
                    placeholder={`Enter ${key.replace(/([A-Z])/g, ' $1').trim()}`}
                  />
                </div>
              ))}
            </div>

            {/* Generate Button */}
            <button
              onClick={generateCitation}
              disabled={loading}
              className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white py-4 rounded-lg font-bold text-lg hover:from-purple-700 hover:to-indigo-700 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Generating...' : '🎓 Generate Citation'}
            </button>

            {/* Error Message */}
            {error && (
              <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
                {error}
              </div>
            )}

            {/* Generated Citation */}
            {generatedCitation && (
              <div className="mt-6 p-6 bg-gray-50 rounded-lg border-2 border-purple-200">
                <h3 className="font-bold text-lg mb-3 text-gray-800">Generated Citation:</h3>
                <div
                  className="text-gray-700 mb-4 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: generatedCitation.citation }}
                />
                <div className="flex gap-3">
                  <button
                    onClick={copyCitation}
                    className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    📋 Copy Citation
                  </button>
                  {generatedCitation.saved && (
                    <span className="px-6 py-2 bg-green-100 text-green-700 rounded-lg font-semibold">
                      ✓ Saved to Library
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Citation History (Authenticated Users) */}
          {user && (
            <div className="bg-white rounded-xl shadow-2xl p-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">📖 Citation Library</h2>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                >
                  {showHistory ? 'Hide' : 'Show'} History
                </button>
              </div>

              {showHistory && (
                <div className="space-y-4">
                  {citationHistory.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">
                      No citations saved yet. Generate your first citation above!
                    </p>
                  ) : (
                    citationHistory.map(citation => (
                      <div key={citation.id} className="p-4 border-2 border-gray-200 rounded-lg hover:border-purple-300 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-sm font-semibold text-purple-600">
                            {citation.citation_style} • {citation.citation_type}
                          </span>
                          <button
                            onClick={() => deleteCitation(citation.id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            🗑️
                          </button>
                        </div>
                        <div
                          className="text-gray-700 text-sm"
                          dangerouslySetInnerHTML={{ __html: citation.formatted_citation }}
                        />
                        <div className="text-xs text-gray-400 mt-2">
                          {new Date(citation.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
