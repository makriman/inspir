import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function FocusMusic() {
    const navigate = useNavigate();
    const [playing, setPlaying] = useState(null);
    const [volume, setVolume] = useState(50);
    const audioRef = useRef(null);

    const playlists = [
        { id: 'lofi', name: 'Lo-Fi Beats', emoji: '🎧', color: 'from-purple-500 to-pink-500', desc: 'Chill beats to study to' },
        { id: 'classical', name: 'Classical Focus', emoji: '🎻', color: 'from-blue-500 to-cyan-500', desc: 'Baroque & Classical for concentration' },
        { id: 'nature', name: 'Nature Sounds', emoji: '🌿', color: 'from-green-500 to-emerald-500', desc: 'Forest, rain, and bird sounds' },
        { id: 'electronic', name: 'Electronic Focus', emoji: '⚡', color: 'from-yellow-500 to-orange-500', desc: 'Ambient electronic for deep work' },
        { id: 'jazz', name: 'Jazz Cafe', emoji: '☕', color: 'from-amber-500 to-red-500', desc: 'Smooth jazz for studying' },
        { id: 'piano', name: 'Piano Solo', emoji: '🎹', color: 'from-slate-500 to-gray-600', desc: 'Peaceful piano instrumentals' },
    ];

    const togglePlay = (id) => {
        if (playing === id) {
            setPlaying(null);
        } else {
            setPlaying(id);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-2 text-center">🎵 Focus Music</h1>
                    <p className="text-white/60 text-center mb-8">Background music for better concentration</p>

                    {playing && (
                        <div className="bg-white/10 rounded-xl p-4 mb-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center animate-pulse">
                                🎵
                            </div>
                            <div className="flex-1">
                                <p className="text-white font-medium">Now Playing: {playlists.find(p => p.id === playing)?.name}</p>
                                <p className="text-white/50 text-sm">Use your preferred music app for actual playback</p>
                            </div>
                            <button onClick={() => setPlaying(null)} className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30">
                                Stop
                            </button>
                        </div>
                    )}

                    <div className="mb-6 flex items-center gap-4">
                        <span className="text-white/60">🔊</span>
                        <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(+e.target.value)}
                            className="flex-1 accent-purple-500" />
                        <span className="text-white/60 w-12">{volume}%</span>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        {playlists.map(playlist => (
                            <button key={playlist.id} onClick={() => togglePlay(playlist.id)}
                                className={`p-4 rounded-xl text-left transition-all ${playing === playlist.id ? 'ring-2 ring-white' : 'hover:bg-white/5'}`}>
                                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${playlist.color} flex items-center justify-center text-2xl mb-3`}>
                                    {playlist.emoji}
                                </div>
                                <h3 className="text-white font-bold">{playlist.name}</h3>
                                <p className="text-white/50 text-sm">{playlist.desc}</p>
                                {playing === playlist.id && (
                                    <div className="flex gap-1 mt-2">
                                        {[1, 2, 3, 4, 5].map(i => (
                                            <div key={i} className="w-1 bg-purple-500 rounded-full animate-pulse" style={{ height: `${Math.random() * 16 + 8}px`, animationDelay: `${i * 0.1}s` }} />
                                        ))}
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>

                    <p className="text-white/40 text-center text-sm mt-6">
                        💡 Tip: For actual music streaming, we recommend Spotify's focus playlists or YouTube's lo-fi streams
                    </p>
                </div>
            </div>
        </div>
    );
}
