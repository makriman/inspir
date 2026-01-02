import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function VocabularyBuilder() {
    const navigate = useNavigate();
    const [words, setWords] = useState(() => JSON.parse(localStorage.getItem('vocabWords') || '[]'));
    const [newWord, setNewWord] = useState('');
    const [loading, setLoading] = useState(false);
    const [quizMode, setQuizMode] = useState(false);
    const [quizWord, setQuizWord] = useState(null);
    const [showAnswer, setShowAnswer] = useState(false);

    const addWord = async () => {
        if (!newWord.trim()) return;
        setLoading(true);
        try {
            const response = await axios.post('/api/doubt/solve', {
                question: `Define "${newWord}" with: 1) Definition 2) Part of speech 3) Example sentence 4) Synonyms. Format as JSON: {"definition":"...","partOfSpeech":"...","example":"...","synonyms":["..."]}`,
                subject: 'Vocabulary'
            });
            const text = response.data.solution?.explanation || response.data.solution || '';
            let wordData = { word: newWord, definition: text, addedAt: new Date().toISOString(), mastered: false };
            try {
                const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
                if (json.definition) wordData = { ...wordData, ...json };
            } catch (e) { }
            const updated = [...words, wordData];
            setWords(updated);
            localStorage.setItem('vocabWords', JSON.stringify(updated));
            setNewWord('');
        } catch (error) {
            alert('Error looking up word');
        }
        setLoading(false);
    };

    const startQuiz = () => {
        const unmastered = words.filter(w => !w.mastered);
        if (unmastered.length === 0) { alert('No words to quiz!'); return; }
        setQuizWord(unmastered[Math.floor(Math.random() * unmastered.length)]);
        setShowAnswer(false);
        setQuizMode(true);
    };

    const markMastered = (word, mastered) => {
        const updated = words.map(w => w.word === word ? { ...w, mastered } : w);
        setWords(updated);
        localStorage.setItem('vocabWords', JSON.stringify(updated));
        if (quizMode) startQuiz();
    };

    const deleteWord = (word) => {
        const updated = words.filter(w => w.word !== word);
        setWords(updated);
        localStorage.setItem('vocabWords', JSON.stringify(updated));
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-violet-900 via-purple-900 to-fuchsia-900 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <button onClick={() => navigate('/')} className="text-white/70 hover:text-white mb-6">← Back to Tools</button>

                {!quizMode ? (
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                        <h1 className="text-3xl font-bold text-white mb-6 text-center">📚 Vocabulary Builder</h1>

                        <div className="flex gap-2 mb-6">
                            <input value={newWord} onChange={(e) => setNewWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addWord()}
                                placeholder="Enter a new word..." className="flex-1 px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50" />
                            <button onClick={addWord} disabled={loading} className="px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-bold disabled:opacity-50">
                                {loading ? '...' : 'Add'}
                            </button>
                        </div>

                        <div className="flex justify-between items-center mb-4">
                            <span className="text-white/60">{words.length} words • {words.filter(w => w.mastered).length} mastered</span>
                            <button onClick={startQuiz} className="px-4 py-2 bg-fuchsia-500 hover:bg-fuchsia-600 text-white rounded-lg">Quiz Me</button>
                        </div>

                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {words.map(w => (
                                <div key={w.word} className={`p-4 rounded-xl ${w.mastered ? 'bg-green-500/20' : 'bg-white/10'}`}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="text-white font-bold">{w.word} {w.partOfSpeech && <span className="text-white/50 text-sm font-normal">({w.partOfSpeech})</span>}</h3>
                                            <p className="text-white/70 text-sm mt-1">{w.definition?.slice(0, 200)}</p>
                                            {w.example && <p className="text-white/50 text-sm mt-1 italic">"{w.example}"</p>}
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => markMastered(w.word, !w.mastered)} className={`text-sm px-2 py-1 rounded ${w.mastered ? 'text-green-400' : 'text-white/50 hover:text-white'}`}>
                                                {w.mastered ? '✓' : '○'}
                                            </button>
                                            <button onClick={() => deleteWord(w.word)} className="text-red-400 hover:text-red-300">×</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {words.length === 0 && <p className="text-center text-white/50 py-8">Add words to build your vocabulary!</p>}
                        </div>
                    </div>
                ) : (
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 text-center">
                        <h2 className="text-2xl font-bold text-white mb-8">Quiz Time!</h2>
                        <div className="text-5xl font-bold text-white mb-8">{quizWord?.word}</div>
                        {!showAnswer ? (
                            <button onClick={() => setShowAnswer(true)} className="px-8 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-bold">
                                Show Definition
                            </button>
                        ) : (
                            <div>
                                <p className="text-white/80 mb-6">{quizWord?.definition}</p>
                                <div className="flex gap-4 justify-center">
                                    <button onClick={() => { markMastered(quizWord.word, true); }} className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl">Got it!</button>
                                    <button onClick={startQuiz} className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl">Need Practice</button>
                                </div>
                            </div>
                        )}
                        <button onClick={() => setQuizMode(false)} className="mt-8 text-white/50 hover:text-white">Exit Quiz</button>
                    </div>
                )}
            </div>
        </div>
    );
}
