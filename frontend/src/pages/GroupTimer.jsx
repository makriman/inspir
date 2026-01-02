import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function GroupTimer() {
    const navigate = useNavigate();
    const [sessionCode, setSessionCode] = useState('');
    const [isHost, setIsHost] = useState(false);
    const [inSession, setInSession] = useState(false);
    const [time, setTime] = useState(25 * 60);
    const [isRunning, setIsRunning] = useState(false);
    const [participants, setParticipants] = useState(['You']);

    useEffect(() => {
        let timer;
        if (isRunning && time > 0) {
            timer = setInterval(() => setTime(t => t - 1), 1000);
        }
        return () => clearInterval(timer);
    }, [isRunning, time]);

    const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

    const createSession = () => {
        setSessionCode(Math.random().toString(36).substr(2, 6).toUpperCase());
        setIsHost(true);
        setInSession(true);
        setParticipants(['You (Host)', 'Alex', 'Jordan']);
    };

    const joinSession = () => {
        if (sessionCode.length >= 4) {
            setInSession(true);
            setParticipants(['Host', 'You', 'Sam']);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-pink-900 via-rose-900 to-red-900 py-8 px-4">
            <div className="max-w-lg mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                {!inSession ? (
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 text-center">
                        <h1 className="text-3xl font-bold text-white mb-2">👥 Group Timer</h1>
                        <p className="text-white/60 mb-8">Study together in sync</p>

                        <button onClick={createSession} className="w-full py-4 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold mb-4">
                            Create Session
                        </button>

                        <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/20"></div></div>
                            <div className="relative flex justify-center"><span className="px-4 text-white/40 bg-transparent">or</span></div>
                        </div>

                        <input value={sessionCode} onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                            placeholder="Enter session code..." className="w-full px-4 py-3 rounded-xl bg-white/20 text-white text-center text-xl tracking-widest mb-4" maxLength={6} />
                        <button onClick={joinSession} disabled={sessionCode.length < 4}
                            className="w-full py-4 bg-white/20 hover:bg-white/30 text-white rounded-xl font-bold disabled:opacity-50">
                            Join Session
                        </button>
                    </div>
                ) : (
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 text-center">
                        <div className="flex justify-between items-center mb-6">
                            <span className="text-white/60">Session: {sessionCode}</span>
                            <button onClick={() => setInSession(false)} className="text-red-400 hover:text-red-300">Leave</button>
                        </div>

                        <div className="text-7xl font-mono text-white mb-8">{formatTime(time)}</div>

                        <div className="flex gap-4 justify-center mb-8">
                            {isHost && (
                                <>
                                    <button onClick={() => setIsRunning(!isRunning)}
                                        className={`px-8 py-3 rounded-full font-bold ${isRunning ? 'bg-red-500' : 'bg-green-500'} text-white`}>
                                        {isRunning ? 'Pause' : 'Start'}
                                    </button>
                                    <button onClick={() => { setTime(25 * 60); setIsRunning(false); }}
                                        className="px-8 py-3 bg-white/20 text-white rounded-full">Reset</button>
                                </>
                            )}
                            {!isHost && !isRunning && <p className="text-white/50">Waiting for host to start...</p>}
                        </div>

                        <div className="bg-white/5 rounded-xl p-4">
                            <h3 className="text-white/60 text-sm mb-3">Participants ({participants.length})</h3>
                            <div className="flex flex-wrap gap-2 justify-center">
                                {participants.map((p, i) => (
                                    <span key={i} className="px-3 py-1 bg-white/10 rounded-full text-white text-sm">{p}</span>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
