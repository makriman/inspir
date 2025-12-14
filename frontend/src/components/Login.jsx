import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

export default function Login({ onToggle }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await signIn(username, password);

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-purple-gradient flex items-center justify-center p-4">
      <div className="bg-off-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-deep-blue mb-2">
            Welcome Back!
          </h1>
          <p className="text-gray-600">Sign in to continue your learning</p>
        </div>

        {error && (
          <div className="bg-coral-red bg-opacity-10 border border-coral-red text-coral-red px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium text-deep-blue mb-2"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-deep-blue transition-colors"
              placeholder="your_username"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-deep-blue mb-2"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-deep-blue transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-coral-red text-white py-3 px-6 rounded-lg font-semibold hover:bg-opacity-90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-gray-600">
            Don't have an account?{' '}
            <button
              onClick={onToggle}
              className="text-deep-blue font-semibold hover:underline"
            >
              Sign up
            </button>
          </p>
        </div>

        <div className="mt-4 text-center">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-gray-500 hover:text-deep-blue transition-colors"
          >
            Continue as guest
          </button>
        </div>

        <div className="mt-6 p-4 bg-gray-100 rounded-lg">
          <p className="text-xs text-gray-600 text-center">
            No email required. This account is for saving quizzes and results. If you forget your credentials, recovery is limited.
            See our <Link to="/privacy" className="font-semibold text-deep-blue hover:underline">Privacy Policy</Link> for details.
          </p>
        </div>
      </div>
    </div>
  );
}
