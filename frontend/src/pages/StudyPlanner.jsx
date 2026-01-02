import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function StudyPlanner() {
    const navigate = useNavigate();
    const [events, setEvents] = useState(() => JSON.parse(localStorage.getItem('studyPlanner') || '[]'));
    const [newEvent, setNewEvent] = useState({ title: '', date: '', time: '', type: 'study', duration: 60 });
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

    useEffect(() => { localStorage.setItem('studyPlanner', JSON.stringify(events)); }, [events]);

    const addEvent = () => {
        if (newEvent.title.trim() && newEvent.date) {
            setEvents([...events, { ...newEvent, id: Date.now() }].sort((a, b) => new Date(a.date + 'T' + (a.time || '00:00')) - new Date(b.date + 'T' + (b.time || '00:00'))));
            setNewEvent({ title: '', date: '', time: '', type: 'study', duration: 60 });
        }
    };
    const deleteEvent = (id) => setEvents(events.filter(e => e.id !== id));

    const typeColors = { study: 'bg-blue-500', exam: 'bg-red-500', assignment: 'bg-yellow-500', break: 'bg-green-500' };
    const todayEvents = events.filter(e => e.date === selectedDate);
    const upcomingEvents = events.filter(e => new Date(e.date) >= new Date(new Date().toISOString().split('T')[0])).slice(0, 10);

    return (
        <div className="min-h-screen bg-gradient-to-br from-cyan-900 via-blue-900 to-indigo-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                <div className="grid md:grid-cols-3 gap-6">
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                        <h2 className="text-white font-bold mb-4">📅 Add Event</h2>
                        <input value={newEvent.title} onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                            placeholder="Event title..." className="w-full px-4 py-3 rounded-xl bg-white/20 text-white mb-3" />
                        <input type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
                            className="w-full px-4 py-3 rounded-xl bg-white/20 text-white mb-3" />
                        <input type="time" value={newEvent.time} onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })}
                            className="w-full px-4 py-3 rounded-xl bg-white/20 text-white mb-3" />
                        <select value={newEvent.type} onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value })}
                            className="w-full px-4 py-3 rounded-xl bg-white/20 text-white mb-3">
                            <option value="study">📚 Study Session</option>
                            <option value="exam">📝 Exam</option>
                            <option value="assignment">📋 Assignment Due</option>
                            <option value="break">☕ Break</option>
                        </select>
                        <button onClick={addEvent} className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold">Add Event</button>
                    </div>

                    <div className="md:col-span-2 space-y-6">
                        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-white font-bold">📆 {new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
                                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                                    className="px-3 py-2 rounded-lg bg-white/20 text-white" />
                            </div>
                            {todayEvents.length > 0 ? (
                                <div className="space-y-3">
                                    {todayEvents.map(event => (
                                        <div key={event.id} className="flex items-center gap-4 p-4 bg-white/10 rounded-xl">
                                            <div className={`w-3 h-3 rounded-full ${typeColors[event.type]}`} />
                                            <div className="flex-1">
                                                <h3 className="text-white font-medium">{event.title}</h3>
                                                <p className="text-white/60 text-sm">{event.time || 'All day'}</p>
                                            </div>
                                            <button onClick={() => deleteEvent(event.id)} className="text-red-400 hover:text-red-300">×</button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-white/50 text-center py-8">No events scheduled for this day</p>
                            )}
                        </div>

                        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                            <h2 className="text-white font-bold mb-4">📋 Upcoming Events</h2>
                            {upcomingEvents.map(event => (
                                <div key={event.id} className="flex items-center gap-4 p-3 border-b border-white/10 last:border-0">
                                    <div className={`w-2 h-2 rounded-full ${typeColors[event.type]}`} />
                                    <span className="text-white/60 text-sm min-w-[80px]">{new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                    <span className="text-white flex-1">{event.title}</span>
                                </div>
                            ))}
                            {upcomingEvents.length === 0 && <p className="text-white/50 text-center py-4">No upcoming events</p>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
