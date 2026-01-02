import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function MCQBank() {
    const navigate = useNavigate();
    const [content, setContent] = useState('');
    const [questions, setQuestions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [currentQ, setCurrentQ] = useState(0);
    const [selected, setSelected] = useState(null);
    const [showAnswer, setShowAnswer] = useState(false);
    const [score, setScore] = useState(0);

    const generate = async () => {
        if (!content.trim()) return;
        setLoading(true);
        try {
            const response = await axios.post('/api/doubt/solve', {
                question: `Create 10 multiple choice questions from this content. Return as JSON: [{"question":"...", "options":["A","B","C","D"], "correct":0, "explanation":"..."}]. Content: ${content}`,
                subject: 'Quiz'
            });
            const text = response.data.solution?.explanation || '';
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
                setQuestions(JSON.parse(match[0]));
                setCurrentQ(0);
                setScore(0);
            }
        } catch (error) {
            alert('Error generating questions');
        }
        setLoading(false);
    };

    const selectAnswer = (idx) => {
        if (showAnswer) return;
        setSelected(idx);
        setShowAnswer(true);
        if (idx === questions[currentQ].correct) setScore(s => s + 1);
    };

    const nextQuestion = () => {
        setSelected(null);
        setShowAnswer(false);
        setCurrentQ(q => q + 1);
    };

    const q = questions[currentQ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-6 text-center">📋 MCQ Bank</h1>

                    {questions.length === 0 ? (
                        <>
                            <textarea value={content} onChange={(e) => setContent(e.target.value)}
                                placeholder="Paste your study content..." className="w-full px-4 py-3 rounded-xl bg-white/20 text-white h-48 resize-none mb-4" />
                            <button onClick={generate} disabled={loading} className="w-full py-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-50">
                                {loading ? 'Generating...' : 'Generate MCQs'}
                            </button>
                        </>
                    ) : currentQ < questions.length ? (
                        <>
                            <div className="flex justify-between items-center mb-4">
                                <span className="text-white/60">Question {currentQ + 1} of {questions.length}</span>
                                <span className="text-green-400">Score: {score}</span>
                            </div>
                            <h2 className="text-xl text-white mb-6">{q.question}</h2>
                            <div className="space-y-3 mb-6">
                                {q.options.map((opt, idx) => (
                                    <button key={idx} onClick={() => selectAnswer(idx)} disabled={showAnswer}
                                        className={`w-full text-left p-4 rounded-xl transition-all ${showAnswer
                                                ? idx === q.correct ? 'bg-green-500/30 border-2 border-green-500'
                                                    : idx === selected ? 'bg-red-500/30 border-2 border-red-500'
                                                        : 'bg-white/5'
                                                : selected === idx ? 'bg-indigo-500/30' : 'bg-white/10 hover:bg-white/20'
                                            } text-white`}>
                                        {String.fromCharCode(65 + idx)}. {opt}
                                    </button>
                                ))}
                            </div>
                            {showAnswer && (
                                <>
                                    <p className="text-white/70 mb-4">💡 {q.explanation}</p>
                                    <button onClick={nextQuestion} className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold">
                                        {currentQ < questions.length - 1 ? 'Next Question' : 'See Results'}
                                    </button>
                                </>
                            )}
                        </>
                    ) : (
                        <div className="text-center">
                            <div className="text-6xl mb-4">{score >= questions.length * 0.7 ? '🎉' : '📚'}</div>
                            <h2 className="text-3xl font-bold text-white mb-2">Quiz Complete!</h2>
                            <p className="text-white/60 mb-6">Score: {score} / {questions.length} ({Math.round((score / questions.length) * 100)}%)</p>
                            <button onClick={() => { setQuestions([]); setContent(''); }} className="px-8 py-3 bg-indigo-500 text-white rounded-xl font-bold">
                                New Quiz
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
