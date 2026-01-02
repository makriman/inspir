import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function FillBlankGenerator() {
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
                question: `Create 5 fill-in-the-blank questions from this content. Return as JSON array: [{"sentence":"The ___ is the powerhouse of the cell.","answer":"mitochondria","hint":"organelle"}]. Content: ${content}`,
                subject: 'Quiz'
            });
            const text = response.data.solution?.explanation || response.data.solution || '';
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
                setQuestions(JSON.parse(match[0]));
                setUserAnswers({});
                setShowResults(false);
            }
        } catch (error) {
            alert('Error generating questions');
        }
        setLoading(false);
    };

    const checkAnswers = () => setShowResults(true);
    const score = questions.filter((q, i) => userAnswers[i]?.toLowerCase().trim() === q.answer.toLowerCase().trim()).length;

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-6 text-center">📝 Fill in the Blank Generator</h1>

                    {questions.length === 0 ? (
                        <>
                            <textarea value={content} onChange={(e) => setContent(e.target.value)}
                                placeholder="Paste your study content here..."
                                className="w-full px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50 h-48 resize-none mb-4" />
                            <button onClick={generate} disabled={loading || !content.trim()}
                                className="w-full py-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-50">
                                {loading ? 'Generating...' : 'Generate Questions'}
                            </button>
                        </>
                    ) : (
                        <>
                            {showResults && (
                                <div className={`p-4 rounded-xl mb-6 text-center ${score === questions.length ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                    Score: {score} / {questions.length} ({Math.round((score / questions.length) * 100)}%)
                                </div>
                            )}

                            <div className="space-y-6 mb-6">
                                {questions.map((q, i) => (
                                    <div key={i} className="p-4 bg-white/10 rounded-xl">
                                        <p className="text-white mb-3">{q.sentence.replace('___', '_____')}</p>
                                        <input value={userAnswers[i] || ''} onChange={(e) => setUserAnswers({ ...userAnswers, [i]: e.target.value })}
                                            placeholder="Your answer..." disabled={showResults}
                                            className={`w-full px-4 py-2 rounded-lg bg-white/20 text-white ${showResults ? (userAnswers[i]?.toLowerCase().trim() === q.answer.toLowerCase().trim() ? 'border-2 border-green-500' : 'border-2 border-red-500') : ''}`} />
                                        {showResults && userAnswers[i]?.toLowerCase().trim() !== q.answer.toLowerCase().trim() && (
                                            <p className="text-green-400 text-sm mt-2">Correct answer: {q.answer}</p>
                                        )}
                                        {q.hint && !showResults && <p className="text-white/40 text-sm mt-1">Hint: {q.hint}</p>}
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-4 justify-center">
                                {!showResults ? (
                                    <button onClick={checkAnswers} className="px-8 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold">Check Answers</button>
                                ) : (
                                    <button onClick={() => { setQuestions([]); setContent(''); }} className="px-8 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold">New Questions</button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
