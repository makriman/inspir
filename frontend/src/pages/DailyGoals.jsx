import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function DailyGoals() {
    const navigate = useNavigate();
    const today = new Date().toDateString();
    const [goals, setGoals] = useState(() => {
        const saved = JSON.parse(localStorage.getItem('dailyGoals') || '{}');
        return saved.date === today ? saved.goals : [];
    });
    const [newGoal, setNewGoal] = useState('');

    useEffect(() => { localStorage.setItem('dailyGoals', JSON.stringify({ date: today, goals })); }, [goals, today]);

    const addGoal = () => { if (newGoal.trim()) { setGoals([...goals, { id: Date.now(), text: newGoal, completed: false, priority: 'medium' }]); setNewGoal(''); } };
    const toggleGoal = (id) => setGoals(goals.map(g => g.id === id ? { ...g, completed: !g.completed } : g));
    const deleteGoal = (id) => setGoals(goals.filter(g => g.id !== id));
    const setPriority = (id, priority) => setGoals(goals.map(g => g.id === id ? { ...g, priority } : g));

    const completed = goals.filter(g => g.completed).length;
    const progress = goals.length > 0 ? (completed / goals.length) * 100 : 0;

    return (
        <div className="min-h-screen bg-gradient-to-br from-amber-900 via-orange-900 to-red-900 py-8 px-4">
            <div className="max-w-lg mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8">
                    <h1 className="text-3xl font-bold text-white mb-2 text-center">🎯 Daily Goals</h1>
                    <p className="text-white/60 text-center mb-6">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>

                    <div className="mb-6">
                        <div className="flex justify-between text-white/80 mb-2">
                            <span>{completed} of {goals.length} completed</span>
                            <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="h-3 bg-white/20 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all" style={{ width: `${progress}%` }} />
                        </div>
                    </div>

                    <div className="flex gap-2 mb-6">
                        <input value={newGoal} onChange={(e) => setNewGoal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addGoal()}
                            placeholder="Add a goal for today..." className="flex-1 px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50" />
                        <button onClick={addGoal} className="px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold">Add</button>
                    </div>

                    <div className="space-y-3">
                        {goals.sort((a, b) => { const p = { high: 0, medium: 1, low: 2 }; return p[a.priority] - p[b.priority]; }).map(goal => (
                            <div key={goal.id} className={`flex items-center gap-3 p-4 rounded-xl transition-all ${goal.completed ? 'bg-green-500/20' : 'bg-white/10'}`}>
                                <input type="checkbox" checked={goal.completed} onChange={() => toggleGoal(goal.id)} className="w-5 h-5 rounded" />
                                <span className={`flex-1 text-white ${goal.completed ? 'line-through opacity-50' : ''}`}>{goal.text}</span>
                                <select value={goal.priority} onChange={(e) => setPriority(goal.id, e.target.value)}
                                    className={`px-2 py-1 rounded text-xs font-bold ${goal.priority === 'high' ? 'bg-red-500/30 text-red-300' : goal.priority === 'low' ? 'bg-blue-500/30 text-blue-300' : 'bg-yellow-500/30 text-yellow-300'}`}>
                                    <option value="high">High</option>
                                    <option value="medium">Medium</option>
                                    <option value="low">Low</option>
                                </select>
                                <button onClick={() => deleteGoal(goal.id)} className="text-red-400 hover:text-red-300">×</button>
                            </div>
                        ))}
                        {goals.length === 0 && <p className="text-center text-white/50 py-8">No goals yet. What will you accomplish today?</p>}
                    </div>

                    {progress === 100 && goals.length > 0 && (
                        <div className="mt-6 bg-green-500/20 border border-green-500/50 rounded-xl p-4 text-center">
                            <span className="text-4xl">🎉</span>
                            <p className="text-green-400 font-bold mt-2">All goals completed! Great job!</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
