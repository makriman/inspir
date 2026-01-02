import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function EssayAssistant() {
    const navigate = useNavigate();
    const [mode, setMode] = useState('outline'); // outline, expand, introduction, conclusion
    const [topic, setTopic] = useState('');
    const [content, setContent] = useState('');
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);

    const generate = async () => {
        if (!topic.trim()) return;
        setLoading(true);
        try {
            const prompts = {
                outline: `Create a detailed essay outline for: "${topic}". Include thesis, main arguments, supporting points, and conclusion structure.`,
                expand: `Expand this essay section with more detail and analysis:\n\nTopic: ${topic}\nContent: ${content || 'Introduction needed'}`,
                introduction: `Write a compelling essay introduction for the topic: "${topic}". Include a hook, background context, and thesis statement.`,
                conclusion: `Write a strong conclusion for an essay about: "${topic}". Summarize key points and end with impact.`
            };

            const response = await axios.post('/api/doubt/solve', { question: prompts[mode], subject: 'Writing' });
            setResult(response.data.solution?.explanation || response.data.solution || 'Unable to generate. Please try again.');
        } catch (error) {
            setResult('Error generating content. Please try again.');
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-6 text-center">✍️ Essay Assistant</h1>

                    <div className="flex gap-2 mb-6 justify-center flex-wrap">
                        {[
                            { key: 'outline', label: '📋 Outline', desc: 'Generate essay structure' },
                            { key: 'introduction', label: '🎬 Introduction', desc: 'Write opening' },
                            { key: 'expand', label: '📝 Expand', desc: 'Develop ideas' },
                            { key: 'conclusion', label: '🎯 Conclusion', desc: 'Write ending' }
                        ].map(m => (
                            <button key={m.key} onClick={() => setMode(m.key)}
                                className={`px-4 py-2 rounded-xl ${mode === m.key ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
                                {m.label}
                            </button>
                        ))}
                    </div>

                    <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Enter essay topic..."
                        className="w-full px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50 mb-4" />

                    {mode === 'expand' && (
                        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste your current content to expand..."
                            className="w-full px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50 h-32 mb-4 resize-none" />
                    )}

                    <button onClick={generate} disabled={loading || !topic.trim()}
                        className="w-full py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-bold disabled:opacity-50">
                        {loading ? 'Generating...' : 'Generate'}
                    </button>

                    {result && (
                        <div className="mt-6 p-6 bg-white/10 rounded-xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-white font-bold">Result</h3>
                                <button onClick={() => navigator.clipboard.writeText(result)} className="text-purple-400 hover:text-purple-300 text-sm">Copy</button>
                            </div>
                            <div className="text-white/90 whitespace-pre-wrap">{result}</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
