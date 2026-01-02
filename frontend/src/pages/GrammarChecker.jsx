import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function GrammarChecker() {
    const navigate = useNavigate();
    const [text, setText] = useState('');
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);

    const checkGrammar = async () => {
        if (!text.trim()) return;
        setLoading(true);
        try {
            const response = await axios.post('/api/doubt/solve', {
                question: `Check this text for grammar, spelling, and style issues. For each issue found, explain what's wrong and how to fix it. Then provide the corrected version:\n\n"${text}"`,
                subject: 'Grammar'
            });
            setResult(response.data.solution?.explanation || response.data.solution || 'Unable to check. Please try again.');
        } catch (error) {
            setResult('Error checking grammar. Please try again.');
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-green-900 via-emerald-900 to-teal-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-2 text-center">✓ Grammar Checker</h1>
                    <p className="text-white/60 text-center mb-6">Check your writing for grammar, spelling, and style issues</p>

                    <div className="grid md:grid-cols-2 gap-6">
                        <div>
                            <label className="text-white/80 block mb-2">Your Text</label>
                            <textarea value={text} onChange={(e) => setText(e.target.value)}
                                placeholder="Paste or type your text here..."
                                className="w-full px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50 h-64 resize-none" />
                            <div className="flex justify-between mt-2">
                                <span className="text-white/50 text-sm">{text.split(/\s+/).filter(Boolean).length} words</span>
                                <button onClick={checkGrammar} disabled={loading || !text.trim()}
                                    className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-bold disabled:opacity-50">
                                    {loading ? 'Checking...' : 'Check Grammar'}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="text-white/80 block mb-2">Analysis & Corrections</label>
                            <div className={`w-full px-4 py-3 rounded-xl bg-white/10 h-64 overflow-y-auto ${result ? 'text-white/90' : 'text-white/50'}`}>
                                {result ? (
                                    <div className="whitespace-pre-wrap">{result}</div>
                                ) : (
                                    <div className="flex items-center justify-center h-full">
                                        <p>Results will appear here</p>
                                    </div>
                                )}
                            </div>
                            {result && (
                                <button onClick={() => navigator.clipboard.writeText(result)} className="mt-2 text-emerald-400 hover:text-emerald-300 text-sm">
                                    Copy corrections
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
