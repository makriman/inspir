import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function FocusMode() {
    const navigate = useNavigate();
    const [isActive, setIsActive] = useState(false);
    const [blockedSites, setBlockedSites] = useState(() => JSON.parse(localStorage.getItem('focusBlockedSites') || '["twitter.com", "facebook.com", "instagram.com", "tiktok.com", "youtube.com", "reddit.com"]'));
    const [newSite, setNewSite] = useState('');
    const [focusTime, setFocusTime] = useState(0);

    useEffect(() => {
        let interval;
        if (isActive) interval = setInterval(() => setFocusTime(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, [isActive]);

    useEffect(() => { localStorage.setItem('focusBlockedSites', JSON.stringify(blockedSites)); }, [blockedSites]);

    const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
    const addSite = () => { if (newSite.trim() && !blockedSites.includes(newSite.trim())) { setBlockedSites([...blockedSites, newSite.trim()]); setNewSite(''); } };
    const removeSite = (site) => setBlockedSites(blockedSites.filter(s => s !== site));

    return (
        <div className={`min-h-screen py-8 px-4 transition-all duration-1000 ${isActive ? 'bg-gray-950' : 'bg-gradient-to-br from-violet-900 via-purple-900 to-indigo-900'}`}>
            <div className="max-w-lg mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 text-center">
                    <h1 className="text-3xl font-bold text-white mb-2">🎯 Focus Mode</h1>
                    <p className="text-white/60 mb-8">Block distractions and stay focused</p>

                    <div className={`w-40 h-40 mx-auto rounded-full mb-8 flex items-center justify-center transition-all duration-500 ${isActive ? 'bg-green-500/30 border-4 border-green-500' : 'bg-white/10'}`}>
                        {isActive ? (
                            <div>
                                <div className="text-3xl font-mono text-white">{formatTime(focusTime)}</div>
                                <div className="text-green-400 text-sm mt-1">Focused</div>
                            </div>
                        ) : (
                            <span className="text-6xl">🎯</span>
                        )}
                    </div>

                    <button onClick={() => { setIsActive(!isActive); if (!isActive) setFocusTime(0); }}
                        className={`px-8 py-4 rounded-full font-bold text-lg transition-all ${isActive ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-green-500 hover:bg-green-600 text-white'}`}>
                        {isActive ? 'Exit Focus Mode' : 'Enter Focus Mode'}
                    </button>

                    {!isActive && (
                        <div className="mt-8 text-left">
                            <h3 className="text-white font-bold mb-3">Blocked Sites</h3>
                            <div className="flex gap-2 mb-4">
                                <input value={newSite} onChange={(e) => setNewSite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSite()}
                                    placeholder="Add site to block..." className="flex-1 px-4 py-2 rounded-lg bg-white/20 text-white placeholder-white/50" />
                                <button onClick={addSite} className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg">Add</button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {blockedSites.map(site => (
                                    <span key={site} className="px-3 py-1 bg-red-500/20 text-red-300 rounded-full text-sm flex items-center gap-2">
                                        {site}
                                        <button onClick={() => removeSite(site)} className="hover:text-red-100">×</button>
                                    </span>
                                ))}
                            </div>
                            <p className="text-white/40 text-xs mt-4">Note: For full site blocking, use a browser extension like BlockSite</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
