import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ResourceSharing() {
    const navigate = useNavigate();
    const [resources, setResources] = useState([
        { id: 1, title: 'AP Biology Notes', type: 'notes', subject: 'Biology', author: 'StudyMaster', downloads: 156, rating: 4.8 },
        { id: 2, title: 'Calculus Cheat Sheet', type: 'pdf', subject: 'Math', author: 'MathWiz', downloads: 234, rating: 4.9 },
        { id: 3, title: 'History Timeline', type: 'image', subject: 'History', author: 'HistoryBuff', downloads: 89, rating: 4.5 },
        { id: 4, title: 'Physics Formulas', type: 'pdf', subject: 'Physics', author: 'ScienceGuru', downloads: 312, rating: 4.7 },
    ]);
    const [filter, setFilter] = useState('all');
    const [showUpload, setShowUpload] = useState(false);

    const typeIcons = { notes: '📝', pdf: '📄', image: '🖼️', video: '🎬', other: '📁' };
    const filtered = filter === 'all' ? resources : resources.filter(r => r.subject.toLowerCase() === filter);

    return (
        <div className="min-h-screen bg-gradient-to-br from-teal-900 via-cyan-900 to-blue-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold text-white">📚 Resource Sharing</h1>
                    <button onClick={() => setShowUpload(true)} className="px-6 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-bold">
                        + Share Resource
                    </button>
                </div>

                <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                    {['all', 'biology', 'math', 'history', 'physics', 'chemistry'].map(f => (
                        <button key={f} onClick={() => setFilter(f)}
                            className={`px-4 py-2 rounded-full whitespace-nowrap ${filter === f ? 'bg-teal-500 text-white' : 'bg-white/10 text-white/70'}`}>
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                    ))}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                    {filtered.map(resource => (
                        <div key={resource.id} className="bg-white/10 backdrop-blur-lg rounded-2xl p-5 hover:bg-white/15 transition-all">
                            <div className="flex items-start gap-4">
                                <div className="text-3xl">{typeIcons[resource.type] || typeIcons.other}</div>
                                <div className="flex-1">
                                    <h3 className="text-white font-bold">{resource.title}</h3>
                                    <p className="text-white/60 text-sm">by {resource.author} • {resource.subject}</p>
                                    <div className="flex gap-4 mt-2 text-white/50 text-sm">
                                        <span>⭐ {resource.rating}</span>
                                        <span>⬇️ {resource.downloads}</span>
                                    </div>
                                </div>
                                <button className="px-4 py-2 bg-teal-500/20 text-teal-400 rounded-lg hover:bg-teal-500/30">
                                    Download
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {showUpload && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowUpload(false)}>
                        <div className="bg-gray-800 rounded-2xl p-6 w-96" onClick={e => e.stopPropagation()}>
                            <h2 className="text-xl font-bold text-white mb-4">Share a Resource</h2>
                            <input placeholder="Resource title..." className="w-full px-4 py-2 rounded-lg bg-white/20 text-white mb-3" />
                            <select className="w-full px-4 py-2 rounded-lg bg-white/20 text-white mb-3">
                                <option>Select subject...</option>
                                <option>Biology</option>
                                <option>Math</option>
                                <option>History</option>
                                <option>Physics</option>
                            </select>
                            <div className="border-2 border-dashed border-white/20 rounded-lg p-8 text-center text-white/50 mb-4">
                                Drop file here or click to upload
                            </div>
                            <div className="flex gap-2">
                                <button className="flex-1 py-2 bg-teal-500 text-white rounded-lg font-bold">Upload</button>
                                <button onClick={() => setShowUpload(false)} className="flex-1 py-2 bg-white/20 text-white rounded-lg">Cancel</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
