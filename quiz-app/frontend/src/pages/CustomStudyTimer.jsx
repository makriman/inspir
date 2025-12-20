import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const PRESETS_KEY = 'inspirquiz_timer_presets_v1';
const ACTIVE_PRESET_KEY = 'inspirquiz_timer_active_preset_v1';

function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistPresets(presets) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // ignore
  }
}

export default function CustomStudyTimer() {
  const navigate = useNavigate();

  const [presets, setPresets] = useState(() => loadPresets());
  const [name, setName] = useState('');
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);

  const sorted = useMemo(
    () => [...presets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [presets]
  );

  const addPreset = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const preset = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: trimmed,
      focusMinutes: Math.max(1, Math.min(180, Number(focusMinutes) || 25)),
      breakMinutes: Math.max(1, Math.min(60, Number(breakMinutes) || 5)),
      createdAt: new Date().toISOString(),
    };
    const next = [preset, ...presets].slice(0, 50);
    setPresets(next);
    persistPresets(next);
    setName('');
  };

  const removePreset = (id) => {
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    persistPresets(next);
  };

  const usePreset = (preset) => {
    localStorage.setItem(ACTIVE_PRESET_KEY, preset.id);
    navigate('/study-timer');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Focus & Productivity</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Custom Study Timer</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Save timer presets (focus + break). Launch them instantly in the Study Timer.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Create a preset</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-3">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Preset name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., 50/10 Deep Work"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Focus (min)</label>
              <input
                type="number"
                min={1}
                max={180}
                value={focusMinutes}
                onChange={(e) => setFocusMinutes(Number(e.target.value))}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Break (min)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(Number(e.target.value))}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
              />
            </div>

            <div className="flex items-end">
              <button
                onClick={addPreset}
                disabled={!name.trim()}
                className={`w-full py-3 rounded-lg font-semibold transition-all ${
                  name.trim()
                    ? 'bg-purple-600 text-white hover:bg-purple-700 shadow-md'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              >
                Save preset
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-900">Your presets</h2>
            <span className="text-sm text-gray-500">{sorted.length}/50</span>
          </div>

          {sorted.length === 0 ? (
            <div className="text-gray-600 bg-gray-50 border border-gray-200 rounded-xl p-6">
              No presets yet. Create one above.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sorted.map((preset) => (
                <div key={preset.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-gray-900">{preset.name}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        Focus {preset.focusMinutes} min • Break {preset.breakMinutes} min
                      </div>
                      <div className="text-xs text-gray-500 mt-2">{new Date(preset.createdAt).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={() => removePreset(preset.id)}
                      className="text-sm font-semibold text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => usePreset(preset)}
                      className="px-4 py-2 rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-all"
                    >
                      Start in Study Timer
                    </button>
                    <button
                      onClick={() => {
                        localStorage.setItem(ACTIVE_PRESET_KEY, preset.id);
                        navigate('/focus-mode');
                      }}
                      className="px-4 py-2 rounded-lg font-semibold bg-white border border-gray-200 hover:border-purple-300 text-gray-700 transition-all"
                    >
                      Start in Focus Mode
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

