import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

export default function StudyGroups() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [groups, setGroups] = useState([
        { id: 1, name: 'AP Biology Study Group', members: 12, subject: 'Biology', active: true, nextSession: '2024-01-15T18:00' },
        { id: 2, name: 'Calculus Help', members: 8, subject: 'Math', active: true, nextSession: '2024-01-16T15:00' },
        { id: 3, name: 'History Essay Writers', members: 5, subject: 'History', active: false },
    ]);
    const [showCreate, setShowCreate] = useState(false);
    const [newGroup, setNewGroup] = useState({ name: '', subject: '', description: '' });

    const createGroup = () => {
        if (newGroup.name.trim()) {
            setGroups([...groups, { ...newGroup, id: Date.now(), members: 1, active: true }]);
            setNewGroup({ name: '', subject: '', description: '' });
            setShowCreate(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-violet-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold text-white">👥 Study Groups</h1>
                    <button onClick={() => setShowCreate(true)} className="px-6 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold">
                        + Create Group
                    </button>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                    {groups.map(group => (
                        <div key={group.id} className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 hover:bg-white/15 transition-all">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-xl font-bold text-white">{group.name}</h3>
                                    <span className="text-white/60 text-sm">{group.subject}</span>
                                </div>
                                <span className={`px-2 py-1 rounded-full text-xs ${group.active ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/50'}`}>
                                    {group.active ? 'Active' : 'Inactive'}
                                </span>
                            </div>

                            <div className="flex items-center gap-4 text-white/60 text-sm mb-4">
                                <span>👥 {group.members} members</span>
                                {group.nextSession && (
                                    <span>📅 Next: {new Date(group.nextSession).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                                )}
                            </div>

                            <div className="flex gap-2">
                                <button className="flex-1 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-bold">Join</button>
                                <button className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg">View</button>
                            </div>
                        </div>
                    ))}
                </div>

                {showCreate && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
                        <div className="bg-gray-800 rounded-2xl p-6 w-96" onClick={e => e.stopPropagation()}>
                            <h2 className="text-xl font-bold text-white mb-4">Create Study Group</h2>
                            <input value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                                placeholder="Group name..." className="w-full px-4 py-2 rounded-lg bg-white/20 text-white mb-3" />
                            <input value={newGroup.subject} onChange={(e) => setNewGroup({ ...newGroup, subject: e.target.value })}
                                placeholder="Subject..." className="w-full px-4 py-2 rounded-lg bg-white/20 text-white mb-3" />
                            <textarea value={newGroup.description} onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                                placeholder="Description..." className="w-full px-4 py-2 rounded-lg bg-white/20 text-white h-24 resize-none mb-4" />
                            <div className="flex gap-2">
                                <button onClick={createGroup} className="flex-1 py-2 bg-indigo-500 text-white rounded-lg font-bold">Create</button>
                                <button onClick={() => setShowCreate(false)} className="flex-1 py-2 bg-white/20 text-white rounded-lg">Cancel</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
