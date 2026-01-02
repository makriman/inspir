import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CustomTimer() {
    const navigate = useNavigate();
    const [time, setTime] = useState(25 * 60);
    const [isRunning, setIsRunning] = useState(false);
    const [customMinutes, setCustomMinutes] = useState(25);

    useEffect(() => {
        let interval;
        if (isRunning && time > 0) {
            interval = setInterval(() => setTime(t => t - 1), 1000);
        } else if (time === 0) {
            new Audio('https://assets.mixkit.co/sfx/preview/mixkit-alarm-digital-clock-beep-989.mp3').play().catch(() => { });
            setIsRunning(false);
        }
        return () => clearInterval(interval);
    }, [isRunning, time]);

    const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
    const progress = ((customMinutes * 60 - time) / (customMinutes * 60)) * 100;

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 py-8 px-4">
            <div className="max-w-md mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6 flex items-center gap-2">
                    ← Back to Tools
                </button>
                <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 text-center">
                    <h1 className="text-3xl font-bold text-white mb-8">⏲️ Custom Timer</h1>

                    <div className="relative w-64 h-64 mx-auto mb-8">
                        <svg className="w-full h-full transform -rotate-90">
                            <circle cx="128" cy="128" r="120" stroke="rgba(255,255,255,0.1)" strokeWidth="8" fill="none" />
                            <circle cx="128" cy="128" r="120" stroke="url(#gradient)" strokeWidth="8" fill="none"
                                strokeDasharray={`${progress * 7.54} 754`} strokeLinecap="round" />
                            <defs>
                                <linearGradient id="gradient"><stop offset="0%" stopColor="#60a5fa" /><stop offset="100%" stopColor="#c084fc" /></linearGradient>
                            </defs>
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-6xl font-mono text-white">{formatTime(time)}</span>
                        </div>
                    </div>

                    <div className="flex gap-4 justify-center mb-6">
                        <button onClick={() => setIsRunning(!isRunning)}
                            className={`px-8 py-3 rounded-full font-bold text-lg ${isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'} text-white`}>
                            {isRunning ? 'Pause' : 'Start'}
                        </button>
                        <button onClick={() => { setTime(customMinutes * 60); setIsRunning(false); }}
                            className="px-8 py-3 rounded-full bg-white/20 hover:bg-white/30 text-white font-bold">Reset</button>
                    </div>

                    <div className="flex items-center justify-center gap-4">
                        <label className="text-white/70">Minutes:</label>
                        <input type="number" value={customMinutes} onChange={(e) => { setCustomMinutes(+e.target.value || 1); if (!isRunning) setTime((+e.target.value || 1) * 60); }}
                            className="w-20 px-3 py-2 rounded-lg bg-white/20 text-white text-center" min="1" max="180" />
                    </div>

                    <div className="flex gap-2 justify-center mt-4">
                        {[15, 25, 45, 60].map(m => (
                            <button key={m} onClick={() => { setCustomMinutes(m); setTime(m * 60); setIsRunning(false); }}
                                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm">{m}m</button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
