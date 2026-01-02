import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const allChallenges = [
    { id: 1, title: '7-Day Streak', desc: 'Study for 7 days in a row', reward: 500, type: 'streak', target: 7, icon: '🔥' },
    { id: 2, title: 'Quiz Master', desc: 'Complete 10 quizzes', reward: 300, type: 'quizzes', target: 10, icon: '📝' },
    { id: 3, title: 'Flashcard Pro', desc: 'Review 100 flashcards', reward: 250, type: 'flashcards', target: 100, icon: '🎴' },
    { id: 4, title: 'Deep Focus', desc: '2 hours of deep work', reward: 400, type: 'focus', target: 120, icon: '🧠' },
    { id: 5, title: 'Goal Getter', desc: 'Complete all daily goals 5 days', reward: 350, type: 'goals', target: 5, icon: '🎯' },
    { id: 6, title: 'Early Bird', desc: 'Study before 7 AM', reward: 150, type: 'special', target: 1, icon: '🐦' },
    { id: 7, title: 'Weekend Warrior', desc: 'Study on Sat and Sun', reward: 200, type: 'special', target: 2, icon: '⚔️' },
    { id: 8, title: 'Perfect Week', desc: 'Hit all goals for a week', reward: 1000, type: 'special', target: 7, icon: '👑' },
];

export default function Challenges() {
    const navigate = useNavigate();
    const [progress, setProgress] = useState(() => JSON.parse(localStorage.getItem('challengeProgress') || '{}'));
    const [filter, setFilter] = useState('all');

    const getProgress = (challenge) => progress[challenge.id] || 0;
    const isComplete = (challenge) => getProgress(challenge) >= challenge.target;
    const progressPercent = (challenge) => Math.min(100, (getProgress(challenge) / challenge.target) * 100);

    const filtered = filter === 'all' ? allChallenges :
        filter === 'active' ? allChallenges.filter(c => !isComplete(c)) :
            allChallenges.filter(c => isComplete(c));

    const simulateProgress = (id) => {
        const challenge = allChallenges.find(c => c.id === id);
        const current = progress[id] || 0;
        if (current < challenge.target) {
            const updated = { ...progress, [id]: Math.min(current + 1, challenge.target) };
            setProgress(updated);
            localStorage.setItem('challengeProgress', JSON.stringify(updated));
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-900 via-violet-900 to-indigo-900 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-2 text-center">⚔️ Challenges</h1>
                    <p className="text-white/60 text-center mb-6">Complete challenges to earn XP rewards</p>

                    <div className="flex gap-2 mb-6 justify-center">
                        {['all', 'active', 'completed'].map(f => (
                            <button key={f} onClick={() => setFilter(f)}
                                className={`px-4 py-2 rounded-full ${filter === f ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/70'}`}>
                                {f.charAt(0).toUpperCase() + f.slice(1)}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-4">
                        {filtered.map(challenge => (
                            <div key={challenge.id} className={`p-4 rounded-xl transition-all ${isComplete(challenge) ? 'bg-green-500/20 border border-green-500/50' : 'bg-white/10'}`}>
                                <div className="flex items-start gap-4">
                                    <div className="text-3xl">{challenge.icon}</div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="text-white font-bold">{challenge.title}</h3>
                                                <p className="text-white/60 text-sm">{challenge.desc}</p>
                                            </div>
                                            <div className="text-yellow-400 font-bold">+{challenge.reward} XP</div>
                                        </div>
                                        <div className="mt-3">
                                            <div className="flex justify-between text-xs text-white/60 mb-1">
                                                <span>{getProgress(challenge)} / {challenge.target}</span>
                                                <span>{Math.round(progressPercent(challenge))}%</span>
                                            </div>
                                            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                                <div className={`h-full transition-all ${isComplete(challenge) ? 'bg-green-500' : 'bg-purple-500'}`} style={{ width: `${progressPercent(challenge)}%` }} />
                                            </div>
                                        </div>
                                        {isComplete(challenge) && <div className="text-green-400 text-sm mt-2">✓ Completed!</div>}
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
