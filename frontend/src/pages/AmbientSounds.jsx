import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const sounds = {
    rain: { name: 'Rain', emoji: '🌧️', url: 'https://assets.mixkit.co/sfx/preview/mixkit-light-rain-loop-2393.mp3' },
    forest: { name: 'Forest', emoji: '🌲', url: 'https://assets.mixkit.co/sfx/preview/mixkit-forest-birds-ambience-1210.mp3' },
    ocean: { name: 'Ocean', emoji: '🌊', url: 'https://assets.mixkit.co/sfx/preview/mixkit-sea-waves-loop-1196.mp3' },
    fire: { name: 'Fireplace', emoji: '🔥', url: 'https://assets.mixkit.co/sfx/preview/mixkit-campfire-crackles-1330.mp3' },
    wind: { name: 'Wind', emoji: '💨', url: 'https://assets.mixkit.co/sfx/preview/mixkit-blizzard-cold-winds-1153.mp3' },
    cafe: { name: 'Café', emoji: '☕', url: 'https://assets.mixkit.co/sfx/preview/mixkit-hotel-lobby-with-dining-702.mp3' }
};

export default function AmbientSounds() {
    const navigate = useNavigate();
    const [activeSounds, setActiveSounds] = useState({});
    const [volumes, setVolumes] = useState(() => Object.fromEntries(Object.keys(sounds).map(k => [k, 50])));
    const audioRefs = useRef({});

    useEffect(() => {
        Object.entries(activeSounds).forEach(([key, isActive]) => {
            if (!audioRefs.current[key]) {
                audioRefs.current[key] = new Audio(sounds[key].url);
                audioRefs.current[key].loop = true;
            }
            audioRefs.current[key].volume = volumes[key] / 100;
            if (isActive) audioRefs.current[key].play().catch(() => { });
            else audioRefs.current[key].pause();
        });
    }, [activeSounds, volumes]);

    useEffect(() => {
        return () => Object.values(audioRefs.current).forEach(audio => { audio.pause(); audio.src = ''; });
    }, []);

    const toggleSound = (key) => setActiveSounds(prev => ({ ...prev, [key]: !prev[key] }));
    const setVolume = (key, vol) => setVolumes(prev => ({ ...prev, [key]: vol }));

    const activeCount = Object.values(activeSounds).filter(Boolean).length;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/5 backdrop-blur-lg rounded-3xl p-8">
                    <h1 className="text-3xl font-bold text-white mb-2 text-center">🌧️ Ambient Sounds</h1>
                    <p className="text-white/60 text-center mb-8">Mix sounds for the perfect study atmosphere</p>

                    {activeCount > 0 && (
                        <div className="bg-green-500/20 border border-green-500/30 rounded-xl p-4 mb-6 text-center">
                            <p className="text-green-400">Playing {activeCount} sound{activeCount !== 1 ? 's' : ''}</p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {Object.entries(sounds).map(([key, sound]) => (
                            <div key={key} className={`p-4 rounded-2xl transition-all cursor-pointer ${activeSounds[key] ? 'bg-purple-500/30 border-2 border-purple-500' : 'bg-white/10 border-2 border-transparent hover:bg-white/20'}`}>
                                <div onClick={() => toggleSound(key)} className="text-center mb-3">
                                    <span className="text-4xl block mb-2">{sound.emoji}</span>
                                    <span className="text-white font-medium">{sound.name}</span>
                                </div>
                                {activeSounds[key] && (
                                    <input type="range" min="0" max="100" value={volumes[key]} onChange={(e) => setVolume(key, +e.target.value)}
                                        className="w-full accent-purple-500" />
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="mt-8 flex gap-4 justify-center">
                        <button onClick={() => setActiveSounds({})} className="px-6 py-3 bg-red-500/20 text-red-400 rounded-xl hover:bg-red-500/30">
                            Stop All
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
