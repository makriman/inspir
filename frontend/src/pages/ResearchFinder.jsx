import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function ResearchFinder() {
    const navigate = useNavigate();
    const [topic, setTopic] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    const search = async () => {
        if (!topic.trim()) return;
        setLoading(true);
        try {
            const response = await axios.post('/api/doubt/solve', {
                question: `Find and summarize key research and sources for: "${topic}". Provide 5 helpful academic resources with: title, type (journal/book/website), key findings, and relevance. Format as a structured list.`,
                subject: 'Research'
            });
            const text = response.data.solution?.explanation || response.data.solution || '';
            setResults([{ id: 1, content: text }]);
        } catch (error) {
            alert('Error searching');
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-2 text-center">🔍 Research Finder</h1>
                    <p className="text-white/60 text-center mb-6">Find sources and research for any topic</p>

                    <div className="flex gap-3 mb-6">
                        <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
                            placeholder="Enter your research topic..." className="flex-1 px-4 py-3 rounded-xl bg-white/20 text-white" />
                        <button onClick={search} disabled={loading} className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold disabled:opacity-50">
                            {loading ? '...' : 'Search'}
                        </button>
                    </div>

                    {results.length > 0 && (
                        <div className="p-6 bg-white/10 rounded-xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-white font-bold">Research Results</h3>
                                <button onClick={() => navigator.clipboard.writeText(results[0].content)} className="text-blue-400 hover:text-blue-300 text-sm">
                                    Copy
                                </button>
                            </div>
                            <div className="text-white/90 whitespace-pre-wrap leading-relaxed">{results[0].content}</div>
                        </div>
                    )}

                    <div className="mt-6 p-4 bg-white/5 rounded-xl">
                        <h4 className="text-white/80 font-medium mb-2">💡 Research Tips</h4>
                        <ul className="text-white/60 text-sm space-y-1">
                            <li>• Be specific with your topic for better results</li>
                            <li>• Use Google Scholar for peer-reviewed articles</li>
                            <li>• Check your library's database access</li>
                            <li>• Verify sources before using in papers</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
