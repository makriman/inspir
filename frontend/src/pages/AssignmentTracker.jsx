import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AssignmentTracker() {
    const navigate = useNavigate();
    const [assignments, setAssignments] = useState(() => JSON.parse(localStorage.getItem('assignments') || '[]'));
    const [newAssignment, setNewAssignment] = useState({ title: '', course: '', dueDate: '', priority: 'medium', status: 'pending' });
    const [filter, setFilter] = useState('all');

    useEffect(() => { localStorage.setItem('assignments', JSON.stringify(assignments)); }, [assignments]);

    const addAssignment = () => {
        if (newAssignment.title.trim() && newAssignment.dueDate) {
            setAssignments([...assignments, { ...newAssignment, id: Date.now(), createdAt: new Date().toISOString() }]);
            setNewAssignment({ title: '', course: '', dueDate: '', priority: 'medium', status: 'pending' });
        }
    };
    const updateStatus = (id, status) => setAssignments(assignments.map(a => a.id === id ? { ...a, status } : a));
    const deleteAssignment = (id) => setAssignments(assignments.filter(a => a.id !== id));

    const priorityColors = { high: 'text-red-400 bg-red-500/20', medium: 'text-yellow-400 bg-yellow-500/20', low: 'text-green-400 bg-green-500/20' };
    const statusColors = { pending: 'bg-gray-500', 'in-progress': 'bg-blue-500', completed: 'bg-green-500' };

    const getDaysUntilDue = (date) => Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24));

    const filteredAssignments = assignments
        .filter(a => filter === 'all' || a.status === filter)
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    return (
        <div className="min-h-screen bg-gradient-to-br from-rose-900 via-pink-900 to-purple-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6">
                    <h1 className="text-2xl font-bold text-white mb-4">📋 Assignment Tracker</h1>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
                        <input value={newAssignment.title} onChange={(e) => setNewAssignment({ ...newAssignment, title: e.target.value })}
                            placeholder="Assignment title..." className="px-4 py-3 rounded-xl bg-white/20 text-white" />
                        <input value={newAssignment.course} onChange={(e) => setNewAssignment({ ...newAssignment, course: e.target.value })}
                            placeholder="Course..." className="px-4 py-3 rounded-xl bg-white/20 text-white" />
                        <input type="date" value={newAssignment.dueDate} onChange={(e) => setNewAssignment({ ...newAssignment, dueDate: e.target.value })}
                            className="px-4 py-3 rounded-xl bg-white/20 text-white" />
                        <div className="flex gap-2">
                            <select value={newAssignment.priority} onChange={(e) => setNewAssignment({ ...newAssignment, priority: e.target.value })}
                                className="flex-1 px-3 py-3 rounded-xl bg-white/20 text-white">
                                <option value="high">🔴 High</option>
                                <option value="medium">🟡 Medium</option>
                                <option value="low">🟢 Low</option>
                            </select>
                            <button onClick={addAssignment} className="px-6 py-3 bg-pink-500 hover:bg-pink-600 text-white rounded-xl font-bold">Add</button>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                    {['all', 'pending', 'in-progress', 'completed'].map(f => (
                        <button key={f} onClick={() => setFilter(f)}
                            className={`px-4 py-2 rounded-full whitespace-nowrap ${filter === f ? 'bg-pink-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
                            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1).replace('-', ' ')}
                        </button>
                    ))}
                </div>

                <div className="space-y-3">
                    {filteredAssignments.map(a => {
                        const daysLeft = getDaysUntilDue(a.dueDate);
                        return (
                            <div key={a.id} className={`p-4 bg-white/10 backdrop-blur rounded-xl ${a.status === 'completed' ? 'opacity-60' : ''}`}>
                                <div className="flex items-center gap-4">
                                    <div className={`w-3 h-3 rounded-full ${statusColors[a.status]}`} />
                                    <div className="flex-1">
                                        <h3 className={`text-white font-medium ${a.status === 'completed' ? 'line-through' : ''}`}>{a.title}</h3>
                                        <p className="text-white/60 text-sm">{a.course || 'No course'}</p>
                                    </div>
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${priorityColors[a.priority]}`}>{a.priority}</span>
                                    <span className={`text-sm ${daysLeft < 0 ? 'text-red-400' : daysLeft <= 3 ? 'text-yellow-400' : 'text-white/60'}`}>
                                        {daysLeft < 0 ? 'Overdue' : daysLeft === 0 ? 'Today' : `${daysLeft}d left`}
                                    </span>
                                    <select value={a.status} onChange={(e) => updateStatus(a.id, e.target.value)}
                                        className="px-2 py-1 rounded bg-white/20 text-white text-sm">
                                        <option value="pending">Pending</option>
                                        <option value="in-progress">In Progress</option>
                                        <option value="completed">Completed</option>
                                    </select>
                                    <button onClick={() => deleteAssignment(a.id)} className="text-red-400 hover:text-red-300">×</button>
                                </div>
                            </div>
                        );
                    })}
                    {filteredAssignments.length === 0 && <p className="text-center text-white/50 py-8">No assignments to show</p>}
                </div>
            </div>
        </div>
    );
}
