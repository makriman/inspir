import { useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';

export default function ComingSoonModal({ tool, onClose }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await axios.post(`${API_URL}/waitlist`, {
        email: email.trim(),
        tool_name: tool.name,
        tool_id: tool.id
      });

      setSubmitted(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join waitlist. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl animate-fadeIn">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl font-bold"
        >
          ×
        </button>

        {!submitted ? (
          <>
            {/* Tool Icon */}
            <div className="text-7xl text-center mb-4">
              {tool.icon}
            </div>

            {/* Title */}
            <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
              {tool.name} is Coming Soon!
            </h2>

            {/* Description */}
            <p className="text-gray-600 text-center mb-6">
              {tool.description}
            </p>

            {/* Waitlist Form */}
            <div className="bg-off-white rounded-xl p-4 mb-6">
              <p className="text-sm text-gray-700 text-center mb-4">
                Want early access when it launches?
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                  className="w-full px-4 py-3 rounded-lg border-2 border-gray-200 focus:border-primary-blue focus:outline-none transition-colors"
                />

                {error && (
                  <p className="text-red-500 text-sm text-center">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-accent-red text-white font-bold py-3 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Joining...' : 'Notify Me'}
                </button>
              </form>
            </div>

            {/* No Thanks Link */}
            <button
              onClick={onClose}
              className="w-full text-gray-500 hover:text-gray-700 text-sm transition-colors"
            >
              No thanks
            </button>
          </>
        ) : (
          <div className="text-center py-8">
            <div className="text-6xl mb-4">✅</div>
            <h3 className="text-2xl font-bold text-green-600 mb-2">
              You're on the list!
            </h3>
            <p className="text-gray-600">
              We'll email you when {tool.name} is ready.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
