import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function XPLeveling() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [stats, setStats] = useState(() => JSON.parse(localStorage.getItem('xpStats') || '{"xp":0,"level":1,"totalXP":0}'));
    const [recentActivity, setRecentActivity] = useState(() => JSON.parse(localStorage.getItem('xpActivity') || '[]'));

    const xpForLevel = (level) => Math.floor(100 * Math.pow(1.5, level - 1));
    const xpToNextLevel = xpForLevel(stats.level);
    const progress = (stats.xp / xpToNextLevel) * 100;

    useEffect(() => {
        localStorage.setItem('xpStats', JSON.stringify(stats));
        localStorage.setItem('xpActivity', JSON.stringify(recentActivity.slice(0, 20)));
    }, [stats, recentActivity]);

    const addXP = (amount, activity) => {
        let newXP = stats.xp + amount;
        let newLevel = stats.level;
        let newTotalXP = stats.totalXP + amount;

        while (newXP >= xpForLevel(newLevel)) {
            newXP -= xpForLevel(newLevel);
            newLevel++;
        }

        setStats({ xp: newXP, level: newLevel, totalXP: newTotalXP });
        setRecentActivity([{ activity, amount, time: new Date().toISOString() }, ...recentActivity]);
    };

    const activities = [
        { name: 'Complete Quiz', xp: 50, emoji: '📝' },
        { name: 'Study Session (30min)', xp: 30, emoji: '⏱️' },
        { name: 'Create Flashcards', xp: 25, emoji: '🎴' },
        { name: 'Read Notes', xp: 15, emoji: '📖' },
        { name: 'Help a Peer', xp: 40, emoji: '🤝' },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-yellow-900 via-amber-900 to-orange-900 py-8 px-4">
            <div className="max-w-lg mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8">
                    <h1 className="text-3xl font-bold text-white mb-6 text-center">⭐ XP & Leveling</h1>

                    <div className="text-center mb-8 p-6 bg-gradient-to-br from-yellow-500/20 to-orange-500/20 rounded-2xl border border-yellow-500/30">
                        <div className="text-6xl mb-2">⭐</div>
                        <div className="text-5xl font-bold text-white mb-1">Level {stats.level}</div>
                        <div className="text-white/60 mb-4">{stats.totalXP.toLocaleString()} Total XP</div>

                        <div className="mb-2">
                            <div className="flex justify-between text-white/80 text-sm mb-1">
                                <span>{stats.xp} XP</span>
                                <span>{xpToNextLevel} XP</span>
                            </div>
                            <div className="h-4 bg-black/30 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-yellow-400 to-orange-500 transition-all" style={{ width: `${progress}%` }} />
                            </div>
                        </div>
                        <p className="text-white/50 text-sm">{xpToNextLevel - stats.xp} XP to Level {stats.level + 1}</p>
                    </div>

                    <h3 className="text-white font-bold mb-4">Earn XP</h3>
                    <div className="grid grid-cols-2 gap-3 mb-8">
                        {activities.map(act => (
                            <button key={act.name} onClick={() => addXP(act.xp, act.name)}
                                className="p-4 bg-white/10 hover:bg-white/20 rounded-xl text-left transition-all group">
                                <span className="text-2xl block mb-1">{act.emoji}</span>
                                <span className="text-white text-sm font-medium">{act.name}</span>
                                <span className="text-yellow-400 text-sm block">+{act.xp} XP</span>
                            </button>
                        ))}
                    </div>

                    <h3 className="text-white font-bold mb-3">Recent Activity</h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                        {recentActivity.slice(0, 10).map((act, i) => (
                            <div key={i} className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                                <span className="text-white/80 text-sm">{act.activity}</span>
                                <span className="text-yellow-400 text-sm font-bold">+{act.amount} XP</span>
                            </div>
                        ))}
                        {recentActivity.length === 0 && <p className="text-white/50 text-center py-4">No activity yet. Start earning XP!</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}
