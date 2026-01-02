import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ScheduleBuilder() {
    const navigate = useNavigate();
    const [schedule, setSchedule] = useState(() => JSON.parse(localStorage.getItem('weekSchedule') || '{}'));
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [newEvent, setNewEvent] = useState('');

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 7 AM to 8 PM

    useEffect(() => { localStorage.setItem('weekSchedule', JSON.stringify(schedule)); }, [schedule]);

    const colors = ['#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#06B6D4'];
    const getEventColor = (event) => colors[event.charCodeAt(0) % colors.length];

    const addEvent = () => {
        if (selectedSlot && newEvent.trim()) {
            setSchedule({ ...schedule, [selectedSlot]: newEvent });
            setSelectedSlot(null);
            setNewEvent('');
        }
    };
    const removeEvent = (key) => {
        const updated = { ...schedule };
        delete updated[key];
        setSchedule(updated);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-gray-900 to-zinc-900 py-8 px-4">
            <div className="max-w-6xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <h1 className="text-3xl font-bold text-white mb-6">📅 Schedule Builder</h1>

                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 overflow-x-auto">
                    <table className="w-full min-w-[600px]">
                        <thead>
                            <tr>
                                <th className="text-white/60 p-2 w-16"></th>
                                {days.map(day => <th key={day} className="text-white font-bold p-2">{day}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {hours.map(hour => (
                                <tr key={hour} className="border-t border-white/10">
                                    <td className="text-white/60 text-sm p-2">{hour}:00</td>
                                    {days.map(day => {
                                        const key = `${day}-${hour}`;
                                        const event = schedule[key];
                                        return (
                                            <td key={key} className="p-1">
                                                {event ? (
                                                    <div className="p-2 rounded-lg text-white text-sm relative group" style={{ backgroundColor: getEventColor(event) + '80' }}>
                                                        {event}
                                                        <button onClick={() => removeEvent(key)} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-xs opacity-0 group-hover:opacity-100">×</button>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => setSelectedSlot(key)} className="w-full h-8 rounded-lg bg-white/5 hover:bg-white/20 transition-all" />
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {selectedSlot && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedSlot(null)}>
                        <div className="bg-gray-800 rounded-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
                            <h3 className="text-white font-bold mb-4">Add Event - {selectedSlot.replace('-', ' at ')}:00</h3>
                            <input value={newEvent} onChange={(e) => setNewEvent(e.target.value)} placeholder="Event name..."
                                className="w-full px-4 py-2 rounded-lg bg-white/20 text-white mb-4" autoFocus />
                            <div className="flex gap-2">
                                <button onClick={addEvent} className="flex-1 py-2 bg-blue-500 text-white rounded-lg font-bold">Add</button>
                                <button onClick={() => setSelectedSlot(null)} className="flex-1 py-2 bg-white/20 text-white rounded-lg">Cancel</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
