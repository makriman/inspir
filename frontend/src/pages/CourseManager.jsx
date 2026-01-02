import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CourseManager() {
    const navigate = useNavigate();
    const [courses, setCourses] = useState(() => JSON.parse(localStorage.getItem('managedCourses') || '[]'));
    const [newCourse, setNewCourse] = useState({ name: '', instructor: '', schedule: '', color: '#8B5CF6' });
    const [selectedCourse, setSelectedCourse] = useState(null);

    useEffect(() => { localStorage.setItem('managedCourses', JSON.stringify(courses)); }, [courses]);

    const colors = ['#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#EF4444'];

    const addCourse = () => {
        if (newCourse.name.trim()) {
            setCourses([...courses, { ...newCourse, id: Date.now(), notes: '', resources: [] }]);
            setNewCourse({ name: '', instructor: '', schedule: '', color: '#8B5CF6' });
        }
    };
    const updateCourse = (id, updates) => setCourses(courses.map(c => c.id === id ? { ...c, ...updates } : c));
    const deleteCourse = (id) => { setCourses(courses.filter(c => c.id !== id)); setSelectedCourse(null); };

    return (
        <div className="min-h-screen bg-gradient-to-br from-violet-900 via-purple-900 to-fuchsia-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                <div className="grid md:grid-cols-3 gap-6">
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                        <h1 className="text-xl font-bold text-white mb-4">📚 Courses</h1>

                        <div className="space-y-2 mb-6">
                            {courses.map(course => (
                                <button key={course.id} onClick={() => setSelectedCourse(course)}
                                    className={`w-full text-left p-3 rounded-xl transition-all ${selectedCourse?.id === course.id ? 'bg-white/20' : 'bg-white/5 hover:bg-white/10'}`}>
                                    <div className="flex items-center gap-3">
                                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: course.color }} />
                                        <span className="text-white font-medium">{course.name}</span>
                                    </div>
                                </button>
                            ))}
                        </div>

                        <div className="border-t border-white/10 pt-4">
                            <input value={newCourse.name} onChange={(e) => setNewCourse({ ...newCourse, name: e.target.value })}
                                placeholder="Course name..." className="w-full px-3 py-2 rounded-lg bg-white/20 text-white text-sm mb-2" />
                            <input value={newCourse.instructor} onChange={(e) => setNewCourse({ ...newCourse, instructor: e.target.value })}
                                placeholder="Instructor..." className="w-full px-3 py-2 rounded-lg bg-white/20 text-white text-sm mb-2" />
                            <div className="flex gap-2 mb-2">
                                {colors.map(c => (
                                    <button key={c} onClick={() => setNewCourse({ ...newCourse, color: c })}
                                        className={`w-6 h-6 rounded-full ${newCourse.color === c ? 'ring-2 ring-white' : ''}`} style={{ backgroundColor: c }} />
                                ))}
                            </div>
                            <button onClick={addCourse} className="w-full py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-bold text-sm">
                                Add Course
                            </button>
                        </div>
                    </div>

                    <div className="md:col-span-2 bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                        {selectedCourse ? (
                            <>
                                <div className="flex justify-between items-start mb-6">
                                    <div>
                                        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: selectedCourse.color }} />
                                            {selectedCourse.name}
                                        </h2>
                                        {selectedCourse.instructor && <p className="text-white/60">Instructor: {selectedCourse.instructor}</p>}
                                    </div>
                                    <button onClick={() => deleteCourse(selectedCourse.id)} className="text-red-400 hover:text-red-300">Delete</button>
                                </div>

                                <div className="mb-6">
                                    <label className="text-white/80 block mb-2">Schedule</label>
                                    <input value={selectedCourse.schedule || ''} onChange={(e) => updateCourse(selectedCourse.id, { schedule: e.target.value })}
                                        placeholder="e.g., Mon/Wed 10:00 AM" className="w-full px-4 py-2 rounded-lg bg-white/20 text-white" />
                                </div>

                                <div>
                                    <label className="text-white/80 block mb-2">Course Notes</label>
                                    <textarea value={selectedCourse.notes || ''} onChange={(e) => updateCourse(selectedCourse.id, { notes: e.target.value })}
                                        placeholder="Add notes about this course..." className="w-full px-4 py-3 rounded-lg bg-white/20 text-white h-48 resize-none" />
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center justify-center h-full text-white/50">
                                <p>Select a course to view details</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
