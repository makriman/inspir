import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function NoteOrganizer() {
    const navigate = useNavigate();
    const [notes, setNotes] = useState(() => JSON.parse(localStorage.getItem('organizedNotes') || '[]'));
    const [folders, setFolders] = useState(() => JSON.parse(localStorage.getItem('noteFolders') || '["General", "Math", "Science", "History"]'));
    const [selectedFolder, setSelectedFolder] = useState('All');
    const [editingNote, setEditingNote] = useState(null);
    const [newNote, setNewNote] = useState({ title: '', content: '', folder: 'General' });
    const [newFolder, setNewFolder] = useState('');

    useEffect(() => { localStorage.setItem('organizedNotes', JSON.stringify(notes)); }, [notes]);
    useEffect(() => { localStorage.setItem('noteFolders', JSON.stringify(folders)); }, [folders]);

    const addNote = () => {
        if (newNote.title.trim()) {
            setNotes([...notes, { ...newNote, id: Date.now(), createdAt: new Date().toISOString() }]);
            setNewNote({ title: '', content: '', folder: 'General' });
        }
    };
    const updateNote = (id, updates) => setNotes(notes.map(n => n.id === id ? { ...n, ...updates } : n));
    const deleteNote = (id) => setNotes(notes.filter(n => n.id !== id));
    const addFolder = () => { if (newFolder.trim() && !folders.includes(newFolder)) { setFolders([...folders, newFolder]); setNewFolder(''); } };

    const filteredNotes = selectedFolder === 'All' ? notes : notes.filter(n => n.folder === selectedFolder);

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4">
                        <h2 className="text-white font-bold mb-4">📁 Folders</h2>
                        <button onClick={() => setSelectedFolder('All')} className={`w-full text-left px-3 py-2 rounded-lg mb-2 ${selectedFolder === 'All' ? 'bg-purple-500 text-white' : 'text-white/70 hover:bg-white/10'}`}>
                            All Notes ({notes.length})
                        </button>
                        {folders.map(folder => (
                            <button key={folder} onClick={() => setSelectedFolder(folder)}
                                className={`w-full text-left px-3 py-2 rounded-lg mb-1 ${selectedFolder === folder ? 'bg-purple-500 text-white' : 'text-white/70 hover:bg-white/10'}`}>
                                {folder} ({notes.filter(n => n.folder === folder).length})
                            </button>
                        ))}
                        <div className="mt-4 pt-4 border-t border-white/10">
                            <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="New folder..." className="w-full px-3 py-2 rounded-lg bg-white/10 text-white text-sm mb-2" />
                            <button onClick={addFolder} className="w-full py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg text-sm">Add Folder</button>
                        </div>
                    </div>

                    <div className="md:col-span-3 space-y-4">
                        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4">
                            <h2 className="text-white font-bold mb-4">📝 New Note</h2>
                            <input value={newNote.title} onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
                                placeholder="Note title..." className="w-full px-4 py-3 rounded-xl bg-white/20 text-white mb-3" />
                            <textarea value={newNote.content} onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                                placeholder="Write your note..." className="w-full px-4 py-3 rounded-xl bg-white/20 text-white h-24 mb-3 resize-none" />
                            <div className="flex gap-3">
                                <select value={newNote.folder} onChange={(e) => setNewNote({ ...newNote, folder: e.target.value })}
                                    className="px-4 py-2 rounded-lg bg-white/20 text-white">
                                    {folders.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                                <button onClick={addNote} className="px-6 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-bold">Save Note</button>
                            </div>
                        </div>

                        <div className="space-y-3">
                            {filteredNotes.map(note => (
                                <div key={note.id} className="bg-white/10 backdrop-blur-lg rounded-2xl p-4">
                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className="text-white font-bold">{note.title}</h3>
                                        <button onClick={() => deleteNote(note.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button>
                                    </div>
                                    <p className="text-white/70 text-sm mb-2">{note.content}</p>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="px-2 py-1 bg-white/10 rounded text-white/60">{note.folder}</span>
                                        <span className="text-white/40">{new Date(note.createdAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            ))}
                            {filteredNotes.length === 0 && <p className="text-center text-white/50 py-8">No notes in this folder</p>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
