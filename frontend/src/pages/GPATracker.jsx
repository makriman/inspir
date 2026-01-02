import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function GPATracker() {
    const navigate = useNavigate();
    const [courses, setCourses] = useState(() => JSON.parse(localStorage.getItem('gpaCourses') || '[]'));
    const [newCourse, setNewCourse] = useState({ name: '', credits: 3, grade: 'A' });
    const [targetGPA, setTargetGPA] = useState(3.5);

    useEffect(() => { localStorage.setItem('gpaCourses', JSON.stringify(courses)); }, [courses]);

    const gradePoints = { 'A+': 4.0, 'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7, 'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D+': 1.3, 'D': 1.0, 'F': 0.0 };

    const calculateGPA = () => {
        if (courses.length === 0) return 0;
        const totalPoints = courses.reduce((sum, c) => sum + (gradePoints[c.grade] * c.credits), 0);
        const totalCredits = courses.reduce((sum, c) => sum + c.credits, 0);
        return totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : 0;
    };

    const addCourse = () => {
        if (newCourse.name.trim()) {
            setCourses([...courses, { ...newCourse, id: Date.now() }]);
            setNewCourse({ name: '', credits: 3, grade: 'A' });
        }
    };
    const updateCourse = (id, field, value) => setCourses(courses.map(c => c.id === id ? { ...c, [field]: value } : c));
    const deleteCourse = (id) => setCourses(courses.filter(c => c.id !== id));

    const gpa = parseFloat(calculateGPA());
    const totalCredits = courses.reduce((sum, c) => sum + c.credits, 0);

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-blue-900 to-cyan-900 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6">
                    <h1 className="text-3xl font-bold text-white mb-6 text-center">📊 GPA Tracker</h1>

                    <div className="grid md:grid-cols-3 gap-4 mb-8">
                        <div className="bg-gradient-to-br from-blue-500/30 to-cyan-500/30 rounded-xl p-4 text-center">
                            <div className="text-4xl font-bold text-white">{gpa}</div>
                            <div className="text-white/60">Current GPA</div>
                        </div>
                        <div className="bg-gradient-to-br from-purple-500/30 to-pink-500/30 rounded-xl p-4 text-center">
                            <div className="text-4xl font-bold text-white">{totalCredits}</div>
                            <div className="text-white/60">Total Credits</div>
                        </div>
                        <div className="bg-gradient-to-br from-green-500/30 to-emerald-500/30 rounded-xl p-4 text-center">
                            <div className={`text-4xl font-bold ${gpa >= targetGPA ? 'text-green-400' : 'text-yellow-400'}`}>
                                {gpa >= targetGPA ? '✓' : `${(targetGPA - gpa).toFixed(2)} away`}
                            </div>
                            <div className="text-white/60">Target: {targetGPA}</div>
                        </div>
                    </div>

                    <div className="grid md:grid-cols-4 gap-3 mb-6">
                        <input value={newCourse.name} onChange={(e) => setNewCourse({ ...newCourse, name: e.target.value })}
                            placeholder="Course name..." className="px-4 py-3 rounded-xl bg-white/20 text-white" />
                        <input type="number" value={newCourse.credits} onChange={(e) => setNewCourse({ ...newCourse, credits: parseInt(e.target.value) || 1 })}
                            min="1" max="6" className="px-4 py-3 rounded-xl bg-white/20 text-white" />
                        <select value={newCourse.grade} onChange={(e) => setNewCourse({ ...newCourse, grade: e.target.value })}
                            className="px-4 py-3 rounded-xl bg-white/20 text-white">
                            {Object.keys(gradePoints).map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <button onClick={addCourse} className="px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold">Add</button>
                    </div>

                    <div className="space-y-3">
                        {courses.map(course => (
                            <div key={course.id} className="flex items-center gap-4 p-4 bg-white/10 rounded-xl">
                                <span className="flex-1 text-white font-medium">{course.name}</span>
                                <span className="text-white/60">{course.credits} cr</span>
                                <select value={course.grade} onChange={(e) => updateCourse(course.id, 'grade', e.target.value)}
                                    className="px-3 py-1 rounded-lg bg-white/20 text-white">
                                    {Object.keys(gradePoints).map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                                <span className="text-white/60 w-12">{gradePoints[course.grade].toFixed(1)}</span>
                                <button onClick={() => deleteCourse(course.id)} className="text-red-400 hover:text-red-300">×</button>
                            </div>
                        ))}
                        {courses.length === 0 && <p className="text-center text-white/50 py-8">Add courses to calculate your GPA</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}
