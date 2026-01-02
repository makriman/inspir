import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function BreakReminder() {
    const navigate = useNavigate();
    const [interval, setIntervalMins] = useState(25);
    const [breakDuration, setBreakDuration] = useState(5);
    const [isActive, setIsActive] = useState(false);
    const [timeLeft, setTimeLeft] = useState(25 * 60);
    const [isBreak, setIsBreak] = useState(false);
    const [sessionsCompleted, setSessionsCompleted] = useState(0);

    useEffect(() => {
        let timer;
        if (isActive && timeLeft > 0) {
            timer = setInterval(() => setTimeLeft(t => t - 1), 1000);
        } else if (isActive && timeLeft === 0) {
            new Audio('https://assets.mixkit.co/sfx/preview/mixkit-bell-notification-933.mp3').play().catch(() => { });
            if (isBreak) {
                setIsBreak(false);
                setTimeLeft(interval * 60);
            } else {
                setSessionsCompleted(s => s + 1);
                setIsBreak(true);
                setTimeLeft(breakDuration * 60);
            }
        }
        return () => clearInterval(timer);
    }, [isActive, timeLeft, isBreak, interval, breakDuration]);

    const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

    const start = () => { setIsActive(true); if (!isActive) setTimeLeft(interval * 60); };
    const pause = () => setIsActive(false);
    const reset = () => { setIsActive(false); setIsBreak(false); setTimeLeft(interval * 60); };

    return (
        <div className="min-h-screen bg-gradient-to-br from-teal-900 via-cyan-900 to-blue-900 py-8 px-4">
            <div className="max-w-md mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 text-center">
                    <h1 className="text-3xl font-bold text-white mb-2">🔔 Break Reminder</h1>
                    <p className="text-white/60 mb-6">Stay healthy with regular breaks</p>

                    <div className={`text-8xl font-mono mb-4 ${isBreak ? 'text-green-400' : 'text-white'}`}>
                        {formatTime(timeLeft)}
                    </div>

                    <p className={`text-xl mb-6 ${isBreak ? 'text-green-400' : 'text-blue-400'}`}>
                        {isBreak ? '🧘 Break Time!' : '💼 Focus Time'}
                    </p>

                    <div className="flex gap-3 justify-center mb-8">
                        {!isActive ? (
                            <button onClick={start} className="px-8 py-3 bg-green-500 hover:bg-green-600 text-white rounded-full font-bold">Start</button>
                        ) : (
                            <button onClick={pause} className="px-8 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-full font-bold">Pause</button>
                        )}
                        <button onClick={reset} className="px-8 py-3 bg-white/20 hover:bg-white/30 text-white rounded-full font-bold">Reset</button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div>
                            <label className="text-white/60 text-sm">Work (min)</label>
                            <input type="number" value={interval} onChange={(e) => setIntervalMins(+e.target.value || 25)}
                                className="w-full px-3 py-2 rounded-lg bg-white/20 text-white text-center" min="1" max="120" />
                        </div>
                        <div>
                            <label className="text-white/60 text-sm">Break (min)</label>
                            <input type="number" value={breakDuration} onChange={(e) => setBreakDuration(+e.target.value || 5)}
                                className="w-full px-3 py-2 rounded-lg bg-white/20 text-white text-center" min="1" max="30" />
                        </div>
                    </div>

                    <div className="bg-white/5 rounded-xl p-4">
                        <p className="text-white/60">Sessions completed today</p>
                        <p className="text-4xl font-bold text-white">{sessionsCompleted}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
