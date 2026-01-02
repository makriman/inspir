import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function TaskTimer() {
    const navigate = useNavigate();
    const [tasks, setTasks] = useState(() => JSON.parse(localStorage.getItem('taskTimerTasks') || '[]'));
    const [newTask, setNewTask] = useState('');
    const [activeTask, setActiveTask] = useState(null);
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => { localStorage.setItem('taskTimerTasks', JSON.stringify(tasks)); }, [tasks]);

    useEffect(() => {
        let interval;
        if (activeTask !== null) {
            interval = setInterval(() => setElapsed(e => e + 1), 1000);
        }
        return () => clearInterval(interval);
    }, [activeTask]);

    const formatTime = (s) => `${Math.floor(s / 3600).toString().padStart(2, '0')}:${Math.floor((s % 3600) / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

    const addTask = () => {
        if (newTask.trim()) {
            setTasks([...tasks, { id: Date.now(), name: newTask, totalTime: 0, completed: false }]);
            setNewTask('');
        }
    };

    const startTask = (id) => { setActiveTask(id); setElapsed(0); };

    const stopTask = () => {
        if (activeTask !== null) {
            setTasks(tasks.map(t => t.id === activeTask ? { ...t, totalTime: t.totalTime + elapsed } : t));
            setActiveTask(null);
            setElapsed(0);
        }
    };

    const toggleComplete = (id) => setTasks(tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
    const deleteTask = (id) => { if (activeTask === id) stopTask(); setTasks(tasks.filter(t => t.id !== id)); };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8">
                    <h1 className="text-3xl font-bold text-white mb-6 text-center">⌛ Task Timer</h1>

                    <div className="flex gap-2 mb-6">
                        <input value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTask()}
                            placeholder="Add a new task..." className="flex-1 px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50" />
                        <button onClick={addTask} className="px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-bold">Add</button>
                    </div>

                    {activeTask !== null && (
                        <div className="bg-green-500/20 border border-green-500/50 rounded-xl p-4 mb-6 text-center">
                            <p className="text-green-400 mb-2">Working on: {tasks.find(t => t.id === activeTask)?.name}</p>
                            <p className="text-4xl font-mono text-white mb-4">{formatTime(elapsed)}</p>
                            <button onClick={stopTask} className="px-6 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg">Stop & Save</button>
                        </div>
                    )}

                    <div className="space-y-3">
                        {tasks.map(task => (
                            <div key={task.id} className={`flex items-center gap-4 p-4 rounded-xl ${task.completed ? 'bg-white/5' : 'bg-white/10'}`}>
                                <input type="checkbox" checked={task.completed} onChange={() => toggleComplete(task.id)} className="w-5 h-5" />
                                <span className={`flex-1 text-white ${task.completed ? 'line-through opacity-50' : ''}`}>{task.name}</span>
                                <span className="text-white/60 font-mono">{formatTime(task.totalTime + (activeTask === task.id ? elapsed : 0))}</span>
                                {activeTask !== task.id && !task.completed && (
                                    <button onClick={() => startTask(task.id)} className="px-3 py-1 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30">Start</button>
                                )}
                                <button onClick={() => deleteTask(task.id)} className="px-3 py-1 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30">Delete</button>
                            </div>
                        ))}
                        {tasks.length === 0 && <p className="text-center text-white/50 py-8">No tasks yet. Add one above!</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}
