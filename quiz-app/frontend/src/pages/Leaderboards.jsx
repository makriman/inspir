import { useEffect, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { Link } from 'react-router-dom';

export default function Leaderboards() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await axios.get(`${API_URL}/gamification/leaderboards?limit=20`);
        setRows(res.data.leaderboard || []);
      } catch (e) {
        console.error(e);
        setError('Failed to load leaderboard.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Gamification</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Leaderboards</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            See who’s showing up. Rankings are based on total XP.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Top learners</h2>
            <div className="flex flex-wrap gap-2">
              <Link to="/xp-leveling" className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                Earn XP
              </Link>
              <Link to="/badges" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                Badges
              </Link>
            </div>
          </div>

          {loading && <div className="text-sm text-gray-500">Loading…</div>}
          {error && <div className="text-sm text-red-600">{error}</div>}

          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-4">Rank</th>
                    <th className="py-2 pr-4">User</th>
                    <th className="py-2 pr-4">Level</th>
                    <th className="py-2 pr-4">XP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.user_id} className="border-t border-gray-100">
                      <td className="py-3 pr-4 font-bold text-gray-900">{r.rank}</td>
                      <td className="py-3 pr-4 text-gray-900 font-semibold">{r.username}</td>
                      <td className="py-3 pr-4 text-gray-700">{r.level}</td>
                      <td className="py-3 pr-4 text-purple-700 font-extrabold">{r.total_xp}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-gray-600">
                        No leaderboard data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

