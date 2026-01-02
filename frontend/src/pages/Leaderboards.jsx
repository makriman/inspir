import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Leaderboards() {
    const navigate = useNavigate();
    const [timeframe, setTimeframe] = useState('weekly');
    const [category, setCategory] = useState('xp');

    // Mock leaderboard data - in production would come from API
    const leaderboardData = {
        xp: [
            { rank: 1, name: 'StudyMaster', avatar: '👑', score: 2450, change: '+5' },
            { rank: 2, name: 'QuizKing', avatar: '🎓', score: 2180, change: '+2' },
            { rank: 3, name: 'FlashcardPro', avatar: '🌟', score: 1950, change: '-1' },
            { rank: 4, name: 'NightOwl', avatar: '🦉', score: 1820, change: '+3' },
            { rank: 5, name: 'EarlyBird', avatar: '🐦', score: 1650, change: '0' },
            { rank: 6, name: 'You', avatar: '😊', score: 1200, change: '+8', isUser: true },
        ],
        streak: [
            { rank: 1, name: 'Consistent', avatar: '🔥', score: 45, change: '0' },
            { rank: 2, name: 'Dedicated', avatar: '💪', score: 38, change: '+1' },
            { rank: 3, name: 'Focused', avatar: '🎯', score: 32, change: '-1' },
        ],
        quizzes: [
            { rank: 1, name: 'QuizWiz', avatar: '📝', score: 156, change: '+2' },
            { rank: 2, name: 'TestAce', avatar: '✏️', score: 142, change: '0' },
            { rank: 3, name: 'BrainPower', avatar: '🧠', score: 128, change: '+3' },
        ]
    };

    const data = leaderboardData[category] || leaderboardData.xp;

    return (
        <div className="min-h-screen bg-gradient-to-br from-amber-900 via-orange-900 to-red-900 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-6 text-center">🏆 Leaderboards</h1>

                    <div className="flex gap-2 mb-4 justify-center">
                        {['daily', 'weekly', 'monthly', 'allTime'].map(t => (
                            <button key={t} onClick={() => setTimeframe(t)}
                                className={`px-4 py-2 rounded-full text-sm ${timeframe === t ? 'bg-orange-500 text-white' : 'bg-white/10 text-white/70'}`}>
                                {t === 'allTime' ? 'All Time' : t.charAt(0).toUpperCase() + t.slice(1)}
                            </button>
                        ))}
                    </div>

                    <div className="flex gap-2 mb-6 justify-center">
                        {[
                            { key: 'xp', label: '⭐ XP' },
                            { key: 'streak', label: '🔥 Streak' },
                            { key: 'quizzes', label: '📝 Quizzes' }
                        ].map(c => (
                            <button key={c.key} onClick={() => setCategory(c.key)}
                                className={`px-4 py-2 rounded-xl ${category === c.key ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'}`}>
                                {c.label}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-3">
                        {data.map((user, i) => (
                            <div key={i} className={`flex items-center gap-4 p-4 rounded-xl ${user.isUser ? 'bg-orange-500/30 border-2 border-orange-500' : 'bg-white/10'}`}>
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${user.rank <= 3 ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-white' : 'bg-white/20 text-white/60'}`}>
                                    {user.rank <= 3 ? ['🥇', '🥈', '🥉'][user.rank - 1] : user.rank}
                                </div>
                                <div className="text-2xl">{user.avatar}</div>
                                <div className="flex-1">
                                    <div className="text-white font-medium">{user.name}</div>
                                    {user.isUser && <div className="text-orange-400 text-xs">That's you!</div>}
                                </div>
                                <div className="text-right">
                                    <div className="text-white font-bold">{user.score.toLocaleString()}</div>
                                    <div className={`text-xs ${user.change.startsWith('+') ? 'text-green-400' : user.change.startsWith('-') ? 'text-red-400' : 'text-white/40'}`}>
                                        {user.change} ranks
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
