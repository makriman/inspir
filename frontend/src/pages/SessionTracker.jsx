import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function SessionTracker() {
    const navigate = useNavigate();
    const [sessions, setSessions] = useState(() => JSON.parse(localStorage.getItem('studySessions') || '[]'));
    const [isTracking, setIsTracking] = useState(false);
    const [currentSession, setCurrentSession] = useState({ subject: '', startTime: null, elapsed: 0 });

    useEffect(() => {
        let interval;
        if (isTracking && currentSession.startTime) {
            interval = setInterval(() => {
                setCurrentSession(prev => ({ ...prev, elapsed: Math.floor((Date.now() - prev.startTime) / 1000) }));
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isTracking, currentSession.startTime]);

    useEffect(() => { localStorage.setItem('studySessions', JSON.stringify(sessions)); }, [sessions]);

    const formatTime = (s) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;

    const startSession = () => {
        setCurrentSession({ subject: currentSession.subject, startTime: Date.now(), elapsed: 0 });
        setIsTracking(true);
    };

    const stopSession = () => {
        if (currentSession.elapsed > 0) {
            setSessions([{
                id: Date.now(),
                subject: currentSession.subject || 'General Study',
                duration: currentSession.elapsed,
                date: new Date().toISOString()
            }, ...sessions]);
        }
        setIsTracking(false);
        setCurrentSession({ subject: '', startTime: null, elapsed: 0 });
    };

    const totalToday = sessions.filter(s => new Date(s.date).toDateString() === new Date().toDateString()).reduce((sum, s) => sum + s.duration, 0);
    const totalWeek = sessions.filter(s => new Date(s.date) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).reduce((sum, s) => sum + s.duration, 0);

    return (
        <div className="min-h-screen bg-gradient-to-br from-violet-900 via-purple-900 to-fuchsia-900 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-6 text-center">📊 Session Tracker</h1>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                        <div className="bg-white/10 rounded-xl p-4 text-center">
                            <p className="text-white/60 text-sm">Today</p>
                            <p className="text-2xl font-bold text-white">{Math.floor(totalToday / 60)}m</p>
                        </div>
                        <div className="bg-white/10 rounded-xl p-4 text-center">
                            <p className="text-white/60 text-sm">This Week</p>
                            <p className="text-2xl font-bold text-white">{Math.floor(totalWeek / 3600)}h {Math.floor((totalWeek % 3600) / 60)}m</p>
                        </div>
                    </div>

                    <div className="bg-white/10 rounded-xl p-6 mb-6">
                        {!isTracking ? (
                            <>
                                <input value={currentSession.subject} onChange={(e) => setCurrentSession({ ...currentSession, subject: e.target.value })}
                                    placeholder="What are you studying?" className="w-full px-4 py-3 rounded-lg bg-white/20 text-white mb-4" />
                                <button onClick={startSession} className="w-full py-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold">
                                    Start Session
                                </button>
                            </>
                        ) : (
                            <div className="text-center">
                                <p className="text-white/60 mb-2">{currentSession.subject || 'Studying...'}</p>
                                <p className="text-5xl font-mono text-white mb-6">{formatTime(currentSession.elapsed)}</p>
                                <button onClick={stopSession} className="px-8 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold">
                                    Stop & Save
                                </button>
                            </div>
                        )}
                    </div>

                    <h3 className="text-white font-bold mb-3">Recent Sessions</h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                        {sessions.slice(0, 10).map(session => (
                            <div key={session.id} className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                                <div>
                                    <span className="text-white">{session.subject}</span>
                                    <span className="text-white/40 text-sm ml-2">{new Date(session.date).toLocaleDateString()}</span>
                                </div>
                                <span className="text-purple-400 font-mono">{formatTime(session.duration)}</span>
                            </div>
                        ))}
                        {sessions.length === 0 && <p className="text-white/50 text-center py-4">No sessions yet</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}
