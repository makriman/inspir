import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function TrueFalseQuiz() {
    const navigate = useNavigate();
    const [content, setContent] = useState('');
    const [questions, setQuestions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [userAnswers, setUserAnswers] = useState({});
    const [showResults, setShowResults] = useState(false);

    const generate = async () => {
        if (!content.trim()) return;
        setLoading(true);
        try {
            const response = await axios.post('/api/doubt/solve', {
                question: `Create 8 true/false questions from this content. Return as JSON: [{"statement":"The earth is flat.","answer":false,"explanation":"The earth is spherical."}]. Content: ${content}`,
                subject: 'Quiz'
            });
            const text = response.data.solution?.explanation || '';
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
                setQuestions(JSON.parse(match[0]));
                setUserAnswers({});
                setShowResults(false);
            }
        } catch (error) {
            alert('Error generating quiz');
        }
        setLoading(false);
    };

    const score = questions.filter((q, i) => userAnswers[i] === q.answer).length;

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-900 via-teal-900 to-cyan-900 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-6 text-center">✓✗ True/False Quiz</h1>

                    {questions.length === 0 ? (
                        <>
                            <textarea value={content} onChange={(e) => setContent(e.target.value)}
                                placeholder="Paste your study content..." className="w-full px-4 py-3 rounded-xl bg-white/20 text-white h-48 resize-none mb-4" />
                            <button onClick={generate} disabled={loading} className="w-full py-4 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-bold disabled:opacity-50">
                                {loading ? 'Generating...' : 'Generate Quiz'}
                            </button>
                        </>
                    ) : (
                        <>
                            {showResults && (
                                <div className={`p-4 rounded-xl mb-6 text-center ${score >= questions.length * 0.7 ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                    Score: {score} / {questions.length}
                                </div>
                            )}
                            <div className="space-y-4 mb-6">
                                {questions.map((q, i) => (
                                    <div key={i} className="p-4 bg-white/10 rounded-xl">
                                        <p className="text-white mb-3">{q.statement}</p>
                                        <div className="flex gap-4">
                                            {[true, false].map(val => (
                                                <button key={val.toString()} onClick={() => !showResults && setUserAnswers({ ...userAnswers, [i]: val })}
                                                    disabled={showResults}
                                                    className={`flex-1 py-3 rounded-xl font-bold transition-all ${userAnswers[i] === val ? (showResults ? (q.answer === val ? 'bg-green-500' : 'bg-red-500') : 'bg-teal-500') : 'bg-white/10 hover:bg-white/20'
                                                        } text-white`}>
                                                    {val ? 'True' : 'False'}
                                                </button>
                                            ))}
                                        </div>
                                        {showResults && userAnswers[i] !== q.answer && <p className="text-green-400 text-sm mt-2">{q.explanation}</p>}
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-4 justify-center">
                                {!showResults ? (
                                    <button onClick={() => setShowResults(true)} className="px-8 py-3 bg-green-500 text-white rounded-xl font-bold">Check Answers</button>
                                ) : (
                                    <button onClick={() => { setQuestions([]); setContent(''); }} className="px-8 py-3 bg-teal-500 text-white rounded-xl font-bold">New Quiz</button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
