import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function Paraphrasing() {
    const navigate = useNavigate();
    const [text, setText] = useState('');
    const [style, setStyle] = useState('standard');
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);

    const paraphrase = async () => {
        if (!text.trim()) return;
        setLoading(true);
        try {
            const styles = {
                standard: 'Paraphrase this text clearly while maintaining the original meaning',
                formal: 'Paraphrase this text in a formal, academic style',
                simple: 'Paraphrase this text using simpler words and shorter sentences',
                creative: 'Paraphrase this text creatively with fresh vocabulary and engaging style',
                concise: 'Paraphrase this text more concisely, reducing word count'
            };

            const response = await axios.post('/api/doubt/solve', {
                question: `${styles[style]}:\n\n"${text}"`,
                subject: 'Writing'
            });
            setResult(response.data.solution?.explanation || response.data.solution || 'Unable to paraphrase. Please try again.');
        } catch (error) {
            setResult('Error paraphrasing. Please try again.');
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-orange-900 via-red-900 to-pink-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-2 text-center">🔄 Paraphrasing Tool</h1>
                    <p className="text-white/60 text-center mb-6">Rewrite text in different styles</p>

                    <div className="flex gap-2 mb-6 justify-center flex-wrap">
                        {[
                            { key: 'standard', label: 'Standard' },
                            { key: 'formal', label: 'Formal' },
                            { key: 'simple', label: 'Simple' },
                            { key: 'creative', label: 'Creative' },
                            { key: 'concise', label: 'Concise' }
                        ].map(s => (
                            <button key={s.key} onClick={() => setStyle(s.key)}
                                className={`px-4 py-2 rounded-full ${style === s.key ? 'bg-orange-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
                                {s.label}
                            </button>
                        ))}
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                        <div>
                            <label className="text-white/80 block mb-2">Original Text</label>
                            <textarea value={text} onChange={(e) => setText(e.target.value)}
                                placeholder="Enter text to paraphrase..."
                                className="w-full px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50 h-48 resize-none" />
                        </div>
                        <div>
                            <label className="text-white/80 block mb-2">Paraphrased Text</label>
                            <div className="w-full px-4 py-3 rounded-xl bg-white/10 h-48 overflow-y-auto text-white/90 whitespace-pre-wrap">
                                {result || <span className="text-white/50">Paraphrased text will appear here</span>}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-center gap-4 mt-6">
                        <button onClick={paraphrase} disabled={loading || !text.trim()}
                            className="px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold disabled:opacity-50">
                            {loading ? 'Paraphrasing...' : 'Paraphrase'}
                        </button>
                        {result && (
                            <button onClick={() => navigator.clipboard.writeText(result)}
                                className="px-8 py-3 bg-white/20 hover:bg-white/30 text-white rounded-xl">Copy Result</button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
