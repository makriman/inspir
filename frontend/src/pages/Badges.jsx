import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const allBadges = [
    { id: 'first-quiz', name: 'Quiz Starter', emoji: '📝', desc: 'Complete your first quiz', requirement: 1, type: 'quizzes' },
    { id: 'quiz-master', name: 'Quiz Master', emoji: '🏆', desc: 'Complete 10 quizzes', requirement: 10, type: 'quizzes' },
    { id: 'streak-3', name: 'On Fire', emoji: '🔥', desc: '3 day study streak', requirement: 3, type: 'streak' },
    { id: 'streak-7', name: 'Week Warrior', emoji: '⚔️', desc: '7 day study streak', requirement: 7, type: 'streak' },
    { id: 'streak-30', name: 'Monthly Legend', emoji: '👑', desc: '30 day study streak', requirement: 30, type: 'streak' },
    { id: 'flashcards-100', name: 'Card Collector', emoji: '🎴', desc: 'Create 100 flashcards', requirement: 100, type: 'flashcards' },
    { id: 'level-5', name: 'Rising Star', emoji: '⭐', desc: 'Reach Level 5', requirement: 5, type: 'level' },
    { id: 'level-10', name: 'Knowledge Seeker', emoji: '🌟', desc: 'Reach Level 10', requirement: 10, type: 'level' },
    { id: 'early-bird', name: 'Early Bird', emoji: '🐦', desc: 'Study before 7 AM', requirement: 1, type: 'special' },
    { id: 'night-owl', name: 'Night Owl', emoji: '🦉', desc: 'Study after 11 PM', requirement: 1, type: 'special' },
    { id: 'helper', name: 'Helpful Hand', emoji: '🤝', desc: 'Help 5 students', requirement: 5, type: 'social' },
    { id: 'focus-1hr', name: 'Focus Master', emoji: '🎯', desc: '1 hour deep work session', requirement: 1, type: 'focus' },
];

export default function Badges() {
    const navigate = useNavigate();
    const [unlockedBadges, setUnlockedBadges] = useState(() => JSON.parse(localStorage.getItem('unlockedBadges') || '["first-quiz", "streak-3"]'));
    const [progress, setProgress] = useState(() => JSON.parse(localStorage.getItem('badgeProgress') || '{"quizzes":3,"streak":5,"flashcards":45,"level":3,"social":2,"focus":0}'));

    const isBadgeUnlocked = (badge) => unlockedBadges.includes(badge.id);
    const getProgressPercent = (badge) => {
        const current = progress[badge.type] || 0;
        return Math.min(100, (current / badge.requirement) * 100);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-900 via-violet-900 to-indigo-900 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8">
                    <h1 className="text-3xl font-bold text-white mb-2 text-center">🏅 Badges</h1>
                    <p className="text-white/60 text-center mb-6">{unlockedBadges.length} of {allBadges.length} badges earned</p>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {allBadges.map(badge => {
                            const unlocked = isBadgeUnlocked(badge);
                            const progressPct = getProgressPercent(badge);
                            return (
                                <div key={badge.id} className={`p-4 rounded-2xl text-center transition-all ${unlocked ? 'bg-gradient-to-br from-yellow-500/30 to-orange-500/30 border-2 border-yellow-500/50' : 'bg-white/5 opacity-60'}`}>
                                    <div className={`text-4xl mb-2 ${unlocked ? '' : 'grayscale'}`}>{badge.emoji}</div>
                                    <h3 className="text-white font-bold text-sm mb-1">{badge.name}</h3>
                                    <p className="text-white/50 text-xs mb-2">{badge.desc}</p>
                                    {!unlocked && (
                                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                            <div className="h-full bg-purple-500" style={{ width: `${progressPct}%` }} />
                                        </div>
                                    )}
                                    {unlocked && <span className="text-yellow-400 text-xs">✓ Earned</span>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
