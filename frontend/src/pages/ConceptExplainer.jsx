import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function ConceptExplainer() {
    const navigate = useNavigate();
    const [concept, setConcept] = useState('');
    const [level, setLevel] = useState('simple');
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);

    const explain = async () => {
        if (!concept.trim()) return;
        setLoading(true);
        try {
            const levels = {
                simple: 'Explain like I\'m 5 years old',
                student: 'Explain for a high school student',
                detailed: 'Provide a detailed academic explanation',
                expert: 'Explain with technical depth for an expert'
            };
            const response = await axios.post('/api/doubt/solve', {
                question: `${levels[level]}: "${concept}". Include examples and analogies where helpful.`,
                subject: 'General'
            });
            setResult(response.data.solution?.explanation || response.data.solution || 'Unable to explain.');
        } catch (error) {
            setResult('Error explaining. Please try again.');
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-cyan-900 via-teal-900 to-emerald-900 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-2 text-center">💡 Concept Explainer</h1>
                    <p className="text-white/60 text-center mb-6">Understand any concept at your level</p>

                    <input value={concept} onChange={(e) => setConcept(e.target.value)}
                        placeholder="Enter a concept to understand..."
                        className="w-full px-4 py-4 rounded-xl bg-white/20 text-white placeholder-white/50 text-lg mb-4" />

                    <div className="flex gap-2 mb-6 justify-center">
                        {[
                            { key: 'simple', label: '🧒 Simple', desc: 'ELI5' },
                            { key: 'student', label: '🎓 Student', desc: 'High school level' },
                            { key: 'detailed', label: '📚 Detailed', desc: 'Academic' },
                            { key: 'expert', label: '🔬 Expert', desc: 'Technical' }
                        ].map(l => (
                            <button key={l.key} onClick={() => setLevel(l.key)}
                                className={`px-4 py-2 rounded-xl ${level === l.key ? 'bg-teal-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
                                {l.label}
                            </button>
                        ))}
                    </div>

                    <button onClick={explain} disabled={loading || !concept.trim()}
                        className="w-full py-4 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-bold disabled:opacity-50 mb-6">
                        {loading ? 'Explaining...' : 'Explain This'}
                    </button>

                    {result && (
                        <div className="p-6 bg-white/10 rounded-xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-white font-bold">Explanation</h3>
                                <button onClick={() => navigator.clipboard.writeText(result)} className="text-teal-400 hover:text-teal-300 text-sm">Copy</button>
                            </div>
                            <div className="text-white/90 whitespace-pre-wrap">{result}</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
