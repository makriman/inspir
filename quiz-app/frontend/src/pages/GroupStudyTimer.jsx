import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function GroupStudyTimer() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [title, setTitle] = useState('Study Room');
  const [focusMinutes, setFocusMinutes] = useState(50);
  const [breakMinutes, setBreakMinutes] = useState(10);

  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [serverTime, setServerTime] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!roomCode || !token) return;
    const t = setInterval(async () => {
      try {
        await axios.post(`${API_URL}/group-timer/rooms/${roomCode}/heartbeat`, {}, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        // ignore
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [roomCode, token]);

  useEffect(() => {
    if (!roomCode || !token) return;
    const poll = setInterval(async () => {
      try {
        const res = await axios.get(`${API_URL}/group-timer/rooms/${roomCode}`, { headers: { Authorization: `Bearer ${token}` } });
        setRoom(res.data.room);
        setParticipantCount(res.data.participantCount || 0);
        setServerTime(res.data.serverTime);
      } catch {
        // ignore
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [roomCode, token]);

  const createRoom = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(
        `${API_URL}/group-timer/rooms`,
        { title, focus_minutes: focusMinutes, break_minutes: breakMinutes },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setRoom(res.data.room);
      setRoomCode(res.data.room.room_code);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async () => {
    if (!isAuthed) return;
    const code = roomCode.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/group-timer/rooms/${code}/join`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setRoom(res.data.room);
      setRoomCode(code);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join room');
    } finally {
      setLoading(false);
    }
  };

  const start = async () => {
    if (!isAuthed || !roomCode) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/group-timer/rooms/${roomCode}/start`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setRoom(res.data.room);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start room');
    } finally {
      setLoading(false);
    }
  };

  const remaining = useMemo(() => {
    if (!room || room.status !== 'running' || !room.started_at) return null;
    const focusSeconds = (room.focus_minutes || 50) * 60;
    const breakSeconds = (room.break_minutes || 10) * 60;
    const cycle = focusSeconds + breakSeconds;
    const base = serverTime ? new Date(serverTime).getTime() : Date.now();
    const started = new Date(room.started_at).getTime();
    const elapsed = Math.max(0, Math.floor((base - started) / 1000));
    const within = elapsed % cycle;
    const isFocus = within < focusSeconds;
    const left = isFocus ? focusSeconds - within : cycle - within;
    return { isFocus, left };
  }, [room, serverTime]);

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-10 px-4">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="text-5xl mb-4">👥</div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Group Study Timer</h1>
          <p className="text-gray-600 mb-6">
            Create a room and sync a shared focus/break timer with friends.
          </p>
          <Link
            to="/auth"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-purple-600 text-white font-bold hover:bg-purple-700 transition-all"
          >
            Sign in to start
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Focus & Productivity</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Group Study Timer</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Create a room, share the code, and start together. Sync uses polling (no accounts for guests).
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Create a room</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-3">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Room name</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Focus (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={focusMinutes}
                    onChange={(e) => setFocusMinutes(Number(e.target.value))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Break (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={breakMinutes}
                    onChange={(e) => setBreakMinutes(Number(e.target.value))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={createRoom}
                    disabled={loading}
                    className="w-full py-3 rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 shadow-md transition-all disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>
              </div>

              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
            </div>

            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 md:p-8 text-white">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-sm text-white/70">Room</div>
                  <div className="text-2xl font-extrabold">{room ? (room.title || 'Study Room') : '—'}</div>
                  <div className="text-sm text-white/70 mt-1">Participants: {participantCount || 0}</div>
                </div>
                <div className="text-5xl font-mono">
                  {remaining ? formatSeconds(remaining.left) : '--:--'}
                </div>
                <div className="text-right">
                  <div className="text-sm text-white/70">Phase</div>
                  <div className="text-xl font-bold">{remaining ? (remaining.isFocus ? 'Focus' : 'Break') : (room?.status || 'lobby')}</div>
                </div>
              </div>
              {room && (
                <div className="mt-5 flex flex-wrap gap-2 items-center">
                  <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10 text-sm font-bold">
                    Code: {room.room_code}
                  </span>
                  {room.status !== 'running' && (
                    <button
                      onClick={start}
                      disabled={loading}
                      className="px-4 py-2 rounded-lg font-semibold bg-white text-gray-900 hover:bg-white/90 transition-all disabled:opacity-50"
                    >
                      Start
                    </button>
                  )}
                </div>
              )}
              <div className="mt-4 text-sm text-white/70">
                Share the room code with your group. Everyone sees the same phase and countdown.
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-3">Join a room</h2>
              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none font-mono tracking-widest"
              />
              <button
                onClick={joinRoom}
                disabled={loading || !roomCode.trim()}
                className="mt-3 w-full py-3 rounded-lg font-semibold bg-white border border-gray-200 hover:border-purple-300 text-gray-700 transition-all disabled:opacity-50"
              >
                Join
              </button>
              <div className="text-xs text-gray-500 mt-3">
                Presence updates every few seconds. This is a lightweight sync (no real-time sockets yet).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

