import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function DeepWork() {
    const navigate = useNavigate();
    const [phase, setPhase] = useState('setup'); // setup, focus, break, complete
    const [sessionDuration, setSessionDuration] = useState(90);
    const [timeLeft, setTimeLeft] = useState(90 * 60);
    const [totalDeepWorkToday, setTotalDeepWorkToday] = useState(() => parseInt(localStorage.getItem('deepWorkToday') || '0'));
    const [goal, setGoal] = useState('');
    const [distractions, setDistractions] = useState(0);

    useEffect(() => {
        let timer;
        if (phase === 'focus' && timeLeft > 0) {
            timer = setInterval(() => setTimeLeft(t => t - 1), 1000);
        } else if (phase === 'focus' && timeLeft === 0) {
            const newTotal = totalDeepWorkToday + sessionDuration;
            setTotalDeepWorkToday(newTotal);
            localStorage.setItem('deepWorkToday', newTotal.toString());
            setPhase('complete');
            new Audio('https://assets.mixkit.co/sfx/preview/mixkit-achievement-bell-600.mp3').play().catch(() => { });
        }
        return () => clearInterval(timer);
    }, [phase, timeLeft, sessionDuration, totalDeepWorkToday]);

    const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

    const startSession = () => { setTimeLeft(sessionDuration * 60); setPhase('focus'); setDistractions(0); };
    const logDistraction = () => setDistractions(d => d + 1);

    return (
        <div className={`min-h-screen py-8 px-4 transition-colors duration-500 ${phase === 'focus' ? 'bg-gray-900' : 'bg-gradient-to-br from-indigo-900 via-purple-900 to-indigo-900'}`}>
            <div className="max-w-lg mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                {phase === 'setup' && (
                    <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8">
                        <h1 className="text-3xl font-bold text-white mb-2 text-center">🧠 Deep Work Session</h1>
                        <p className="text-white/60 text-center mb-8">Eliminate distractions. Focus intensely.</p>

                        <div className="mb-6">
                            <label className="text-white/80 block mb-2">What's your goal for this session?</label>
                            <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g., Finish chapter 5 notes..."
                                className="w-full px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50" />
                        </div>

                        <div className="mb-8">
                            <label className="text-white/80 block mb-2">Session Duration</label>
                            <div className="flex gap-2">
                                {[45, 60, 90, 120].map(m => (
                                    <button key={m} onClick={() => setSessionDuration(m)}
                                        className={`flex-1 py-3 rounded-xl font-bold ${sessionDuration === m ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
                                        {m}m
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button onClick={startSession} className="w-full py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-bold text-lg hover:opacity-90">
                            Start Deep Work
                        </button>

                        <div className="mt-6 text-center">
                            <p className="text-white/60">Today's deep work</p>
                            <p className="text-2xl font-bold text-white">{Math.floor(totalDeepWorkToday / 60)}h {totalDeepWorkToday % 60}m</p>
                        </div>
                    </div>
                )}

                {phase === 'focus' && (
                    <div className="text-center">
                        <h2 className="text-xl text-white/60 mb-4">DEEP WORK IN PROGRESS</h2>
                        {goal && <p className="text-white/80 mb-8 text-lg">Goal: {goal}</p>}

                        <div className="text-9xl font-mono text-white mb-8">{formatTime(timeLeft)}</div>

                        <button onClick={logDistraction} className="px-6 py-3 bg-red-500/20 text-red-400 rounded-xl mb-8 hover:bg-red-500/30">
                            Log Distraction ({distractions})
                        </button>

                        <div className="flex gap-4 justify-center">
                            <button onClick={() => { setPhase('complete'); const newTotal = totalDeepWorkToday + (sessionDuration - Math.floor(timeLeft / 60)); setTotalDeepWorkToday(newTotal); localStorage.setItem('deepWorkToday', newTotal.toString()); }}
                                className="px-8 py-3 bg-white/20 text-white rounded-xl hover:bg-white/30">End Early</button>
                        </div>
                    </div>
                )}

                {phase === 'complete' && (
                    <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 text-center">
                        <div className="text-6xl mb-4">🎉</div>
                        <h2 className="text-3xl font-bold text-white mb-4">Session Complete!</h2>
                        <p className="text-white/60 mb-6">You focused for {sessionDuration} minutes with {distractions} distraction{distractions !== 1 ? 's' : ''}</p>
                        <button onClick={() => setPhase('setup')} className="px-8 py-3 bg-purple-500 text-white rounded-xl font-bold hover:bg-purple-600">
                            Start Another Session
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
