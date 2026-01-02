import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function HabitTracker() {
    const navigate = useNavigate();
    const [habits, setHabits] = useState(() => JSON.parse(localStorage.getItem('habitTracker') || '[]'));
    const [newHabit, setNewHabit] = useState('');
    const today = new Date().toISOString().split('T')[0];
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    useEffect(() => { localStorage.setItem('habitTracker', JSON.stringify(habits)); }, [habits]);

    const getLast7Days = () => {
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            days.push({ date: d.toISOString().split('T')[0], day: daysOfWeek[d.getDay()], isToday: i === 0 });
        }
        return days;
    };
    const last7Days = getLast7Days();

    const addHabit = () => { if (newHabit.trim()) { setHabits([...habits, { id: Date.now(), name: newHabit, icon: '✓', completedDates: [] }]); setNewHabit(''); } };
    const toggleHabit = (habitId, date) => {
        setHabits(habits.map(h => {
            if (h.id !== habitId) return h;
            const completed = h.completedDates.includes(date);
            return { ...h, completedDates: completed ? h.completedDates.filter(d => d !== date) : [...h.completedDates, date] };
        }));
    };
    const deleteHabit = (id) => setHabits(habits.filter(h => h.id !== id));
    const getStreak = (habit) => {
        let streak = 0;
        const d = new Date();
        while (true) {
            const dateStr = d.toISOString().split('T')[0];
            if (habit.completedDates.includes(dateStr)) { streak++; d.setDate(d.getDate() - 1); }
            else break;
        }
        return streak;
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-900 via-teal-900 to-cyan-900 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8">
                    <h1 className="text-3xl font-bold text-white mb-2 text-center">📅 Habit Tracker</h1>
                    <p className="text-white/60 text-center mb-6">Build consistency with daily habits</p>

                    <div className="flex gap-2 mb-8">
                        <input value={newHabit} onChange={(e) => setNewHabit(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addHabit()}
                            placeholder="Add a new habit..." className="flex-1 px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50" />
                        <button onClick={addHabit} className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold">Add</button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr>
                                    <th className="text-left text-white/60 pb-4 pr-4">Habit</th>
                                    {last7Days.map(day => (
                                        <th key={day.date} className={`text-center pb-4 px-2 ${day.isToday ? 'text-emerald-400' : 'text-white/60'}`}>
                                            <div className="text-xs">{day.day}</div>
                                            <div className="text-sm">{new Date(day.date).getDate()}</div>
                                        </th>
                                    ))}
                                    <th className="text-center text-white/60 pb-4 pl-4">Streak</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {habits.map(habit => (
                                    <tr key={habit.id} className="border-t border-white/10">
                                        <td className="py-4 pr-4 text-white font-medium">{habit.name}</td>
                                        {last7Days.map(day => (
                                            <td key={day.date} className="text-center py-4 px-2">
                                                <button onClick={() => toggleHabit(habit.id, day.date)}
                                                    className={`w-8 h-8 rounded-lg transition-all ${habit.completedDates.includes(day.date) ? 'bg-emerald-500 text-white' : 'bg-white/10 hover:bg-white/20'}`}>
                                                    {habit.completedDates.includes(day.date) ? '✓' : ''}
                                                </button>
                                            </td>
                                        ))}
                                        <td className="text-center py-4 pl-4">
                                            <span className="text-orange-400 font-bold">{getStreak(habit)}🔥</span>
                                        </td>
                                        <td className="py-4 pl-2">
                                            <button onClick={() => deleteHabit(habit.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {habits.length === 0 && <p className="text-center text-white/50 py-8">No habits yet. Start building good habits!</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}
