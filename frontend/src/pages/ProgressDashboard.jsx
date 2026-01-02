import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ProgressDashboard() {
    const navigate = useNavigate();
    const [stats, setStats] = useState({
        totalStudyTime: parseInt(localStorage.getItem('deepWorkToday') || '0'),
        quizzesCompleted: parseInt(localStorage.getItem('quizzesCompleted') || '5'),
        flashcardsReviewed: parseInt(localStorage.getItem('flashcardsReviewed') || '45'),
        currentStreak: parseInt(localStorage.getItem('studyStreak') || '7'),
        level: JSON.parse(localStorage.getItem('xpStats') || '{"level":1}').level || 1,
        goalsCompleted: JSON.parse(localStorage.getItem('dailyGoals') || '{"goals":[]}').goals?.filter(g => g.completed).length || 0,
        habitsTracked: JSON.parse(localStorage.getItem('habitTracker') || '[]').length || 0
    });

    const weeklyData = [
        { day: 'Mon', minutes: 45 },
        { day: 'Tue', minutes: 60 },
        { day: 'Wed', minutes: 30 },
        { day: 'Thu', minutes: 90 },
        { day: 'Fri', minutes: 75 },
        { day: 'Sat', minutes: 45 },
        { day: 'Sun', minutes: stats.totalStudyTime }
    ];
    const maxMinutes = Math.max(...weeklyData.map(d => d.minutes));

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-gray-900 to-zinc-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                <h1 className="text-3xl font-bold text-white mb-6">📊 Progress Dashboard</h1>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {[
                        { label: 'Study Time', value: `${Math.floor(stats.totalStudyTime / 60)}h ${stats.totalStudyTime % 60}m`, icon: '⏱️', color: 'from-blue-500 to-cyan-500' },
                        { label: 'Current Streak', value: `${stats.currentStreak} days`, icon: '🔥', color: 'from-orange-500 to-red-500' },
                        { label: 'Level', value: stats.level, icon: '⭐', color: 'from-yellow-500 to-amber-500' },
                        { label: 'Quizzes Done', value: stats.quizzesCompleted, icon: '📝', color: 'from-purple-500 to-pink-500' }
                    ].map((stat, i) => (
                        <div key={i} className={`p-4 rounded-2xl bg-gradient-to-br ${stat.color} bg-opacity-20`}>
                            <div className="text-3xl mb-2">{stat.icon}</div>
                            <div className="text-2xl font-bold text-white">{stat.value}</div>
                            <div className="text-white/60 text-sm">{stat.label}</div>
                        </div>
                    ))}
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                        <h2 className="text-white font-bold mb-4">📈 This Week's Study Time</h2>
                        <div className="flex items-end justify-between h-40 gap-2">
                            {weeklyData.map((d, i) => (
                                <div key={i} className="flex-1 flex flex-col items-center">
                                    <div className="flex-1 w-full flex items-end">
                                        <div className="w-full bg-gradient-to-t from-blue-500 to-cyan-500 rounded-t-lg transition-all"
                                            style={{ height: `${(d.minutes / maxMinutes) * 100}%`, minHeight: '4px' }} />
                                    </div>
                                    <span className="text-white/60 text-xs mt-2">{d.day}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                        <h2 className="text-white font-bold mb-4">🎯 Activity Summary</h2>
                        <div className="space-y-4">
                            {[
                                { label: 'Flashcards Reviewed', value: stats.flashcardsReviewed, max: 100, color: 'bg-green-500' },
                                { label: 'Goals Completed Today', value: stats.goalsCompleted, max: 5, color: 'bg-yellow-500' },
                                { label: 'Habits Tracked', value: stats.habitsTracked, max: 10, color: 'bg-purple-500' }
                            ].map((item, i) => (
                                <div key={i}>
                                    <div className="flex justify-between text-white/80 text-sm mb-1">
                                        <span>{item.label}</span>
                                        <span>{item.value}</span>
                                    </div>
                                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                        <div className={`h-full ${item.color} transition-all`} style={{ width: `${Math.min(100, (item.value / item.max) * 100)}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-6 bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h2 className="text-white font-bold mb-4">🏆 Recent Achievements</h2>
                    <div className="flex gap-4 overflow-x-auto pb-2">
                        {['📝 First Quiz', '🔥 3 Day Streak', '⭐ Level Up', '🎴 50 Cards'].map((badge, i) => (
                            <div key={i} className="flex-shrink-0 px-4 py-2 bg-white/10 rounded-full text-white/80">{badge}</div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
