import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const languages = ['Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Hindi', 'Russian'];

export default function Translator() {
    const navigate = useNavigate();
    const [text, setText] = useState('');
    const [targetLang, setTargetLang] = useState('Spanish');
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);

    const translate = async () => {
        if (!text.trim()) return;
        setLoading(true);
        try {
            const response = await axios.post('/api/doubt/solve', {
                question: `Translate the following text to ${targetLang}. Also provide pronunciation guide if applicable:\n\n"${text}"`,
                subject: 'Translation'
            });
            setResult(response.data.solution?.explanation || response.data.solution || 'Unable to translate.');
        } catch (error) {
            setResult('Error translating. Please try again.');
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-violet-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                    <h1 className="text-3xl font-bold text-white mb-6 text-center">🌍 Translator</h1>

                    <div className="flex gap-2 mb-6 justify-center flex-wrap">
                        {languages.map(lang => (
                            <button key={lang} onClick={() => setTargetLang(lang)}
                                className={`px-3 py-1 rounded-full text-sm ${targetLang === lang ? 'bg-blue-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
                                {lang}
                            </button>
                        ))}
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                        <div>
                            <label className="text-white/80 block mb-2">English</label>
                            <textarea value={text} onChange={(e) => setText(e.target.value)}
                                placeholder="Enter text to translate..."
                                className="w-full px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50 h-48 resize-none" />
                        </div>
                        <div>
                            <label className="text-white/80 block mb-2">{targetLang}</label>
                            <div className="w-full px-4 py-3 rounded-xl bg-white/10 h-48 overflow-y-auto text-white/90 whitespace-pre-wrap">
                                {result || <span className="text-white/50">Translation will appear here</span>}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-center gap-4 mt-6">
                        <button onClick={translate} disabled={loading || !text.trim()}
                            className="px-8 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold disabled:opacity-50">
                            {loading ? 'Translating...' : 'Translate'}
                        </button>
                        {result && (
                            <button onClick={() => navigator.clipboard.writeText(result)}
                                className="px-8 py-3 bg-white/20 hover:bg-white/30 text-white rounded-xl">Copy</button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
