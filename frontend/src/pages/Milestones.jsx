import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Milestones() {
    const navigate = useNavigate();

    const milestones = [
        { id: 1, title: 'First Steps', desc: 'Complete your first study session', completed: true, date: '2024-01-01' },
        { id: 2, title: 'Getting Started', desc: 'Complete 5 quizzes', completed: true, date: '2024-01-05' },
        { id: 3, title: 'Building Momentum', desc: 'Reach a 7-day streak', completed: true, date: '2024-01-12' },
        { id: 4, title: 'Flashcard Novice', desc: 'Create 50 flashcards', completed: true, date: '2024-01-18' },
        { id: 5, title: 'Level 5', desc: 'Reach Level 5', completed: false, progress: 80 },
        { id: 6, title: 'Study Marathon', desc: '10 hours total study time', completed: false, progress: 60 },
        { id: 7, title: 'Quiz Champion', desc: 'Complete 25 quizzes', completed: false, progress: 40 },
        { id: 8, title: 'Ultimate Scholar', desc: 'Complete all other milestones', completed: false, progress: 50 },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-yellow-900 via-amber-900 to-orange-900 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-2 text-center">🏅 Milestones</h1>
                    <p className="text-white/60 text-center mb-6">Track your learning journey</p>

                    <div className="relative">
                        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-white/20" />

                        <div className="space-y-6">
                            {milestones.map((milestone, i) => (
                                <div key={milestone.id} className="relative pl-16">
                                    <div className={`absolute left-4 w-5 h-5 rounded-full border-2 ${milestone.completed ? 'bg-green-500 border-green-500' : 'bg-transparent border-white/40'} flex items-center justify-center`}>
                                        {milestone.completed && <span className="text-xs">✓</span>}
                                    </div>

                                    <div className={`p-4 rounded-xl ${milestone.completed ? 'bg-green-500/20' : 'bg-white/10'}`}>
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="text-white font-bold">{milestone.title}</h3>
                                                <p className="text-white/60 text-sm">{milestone.desc}</p>
                                            </div>
                                            {milestone.completed && <span className="text-green-400 text-sm">{milestone.date}</span>}
                                        </div>
                                        {!milestone.completed && milestone.progress && (
                                            <div className="mt-3">
                                                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                                    <div className="h-full bg-amber-500" style={{ width: `${milestone.progress}%` }} />
                                                </div>
                                                <span className="text-white/50 text-xs">{milestone.progress}% complete</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
