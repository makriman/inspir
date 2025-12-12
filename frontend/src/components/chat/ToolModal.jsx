import { motion } from 'framer-motion';
import { X, Sparkles } from 'lucide-react';
import { useRef, useState, useEffect } from 'react';

export default function ToolModal({ tool, onClose }) {
  if (!tool) return null;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />

      {/* Modal */}
      <motion.div
        className="relative w-full sm:max-w-4xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        initial={{ y: '100%', scale: 0.9 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: '100%', scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`bg-gradient-to-r ${tool.color} p-6 text-white`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <motion.div
                className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center text-4xl"
                animate={{ rotate: [0, -10, 10, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
              >
                {tool.icon}
              </motion.div>
              <div>
                <h2 className="text-2xl font-bold">{tool.label}</h2>
                <p className="text-white/80 text-sm">{tool.description}</p>
              </div>
            </div>
            <motion.button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-xl transition-colors"
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
            >
              <X className="w-6 h-6" />
            </motion.button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <ToolContent tool={tool} />
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              <Sparkles className="w-4 h-4 inline mr-1" />
              Powered by AI
            </p>
            <motion.button
              onClick={onClose}
              className="px-6 py-2 bg-gray-200 hover:bg-gray-300 rounded-xl font-semibold text-gray-700 transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Close
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Tool-specific content components
function ToolContent({ tool }) {
  const contentMap = {
    draw: <DrawCanvas />,
    quiz: <QuizGenerator />,
    flashcards: <FlashcardsCreator />,
    practice: <PracticeTests />,
    timer: <StudyTimer />,
    habits: <HabitTracker />,
    explain: <ConceptExplainer />,
    music: <StudyMusic />,
    image: <ImageAnalysis />,
    math: <MathSolver />,
    science: <ScienceLab />,
    visual: <VisualLearning />,
    notes: <NotesSync />,
    planner: <AIPlanner />,
    goals: <GoalSetter />
  };

  return contentMap[tool.id] || <DefaultContent tool={tool} />;
}

// Individual tool content components
function DefaultContent({ tool }) {
  return (
    <div className="text-center py-12">
      <motion.div
        className="text-6xl mb-4"
        animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        {tool.icon}
      </motion.div>
      <h3 className="text-2xl font-bold text-gray-800 mb-2">{tool.label}</h3>
      <p className="text-gray-600 mb-6">{tool.description}</p>
      <motion.button
        className={`px-8 py-3 bg-gradient-to-r ${tool.color} text-white rounded-xl font-semibold shadow-lg`}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        Get Started
      </motion.button>
    </div>
  );
}

function QuizGenerator() {
  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Generate a Quiz</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Topic</label>
          <input
            type="text"
            placeholder="e.g., Quadratic Equations"
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Difficulty</label>
            <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              <option>Easy</option>
              <option>Medium</option>
              <option>Hard</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Questions</label>
            <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              <option>5 questions</option>
              <option>10 questions</option>
              <option>15 questions</option>
              <option>20 questions</option>
            </select>
          </div>
        </div>
        <motion.button
          className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-bold text-lg shadow-xl"
          whileHover={{ scale: 1.02, boxShadow: '0 20px 40px rgba(147, 51, 234, 0.4)' }}
          whileTap={{ scale: 0.98 }}
        >
          ✨ Generate Quiz with AI
        </motion.button>
      </div>
    </div>
  );
}

function StudyTimer() {
  return (
    <div className="text-center space-y-6">
      <motion.div
        className="w-48 h-48 mx-auto bg-gradient-to-br from-red-500 to-pink-500 rounded-full flex items-center justify-center text-white shadow-2xl"
        animate={{ boxShadow: ['0 10px 30px rgba(239, 68, 68, 0.3)', '0 10px 50px rgba(239, 68, 68, 0.5)', '0 10px 30px rgba(239, 68, 68, 0.3)'] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <div className="text-center">
          <div className="text-6xl font-bold">25:00</div>
          <div className="text-sm mt-2 opacity-90">Focus Time</div>
        </div>
      </motion.div>
      <div className="flex justify-center gap-4">
        <motion.button
          className="px-8 py-3 bg-green-500 text-white rounded-xl font-bold shadow-lg"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          Start
        </motion.button>
        <motion.button
          className="px-8 py-3 bg-gray-200 text-gray-700 rounded-xl font-bold"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          Reset
        </motion.button>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-6">
        {[25, 15, 5].map((minutes) => (
          <button key={minutes} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-semibold transition-colors">
            {minutes} min
          </button>
        ))}
      </div>
    </div>
  );
}

function DrawCanvas() {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentColor, setCurrentColor] = useState('black');
  const [lineWidth, setLineWidth] = useState(3);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Fill with white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();

    ctx.strokeStyle = currentColor;
    ctx.lineWidth = lineWidth;

    ctx.beginPath();
    ctx.moveTo(
      e.clientX - rect.left,
      e.clientY - rect.top
    );
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();

    ctx.lineTo(
      e.clientX - rect.left,
      e.clientY - rect.top
    );
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const saveCanvas = () => {
    const canvas = canvasRef.current;
    const dataURL = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `drawing-${Date.now()}.png`;
    link.href = dataURL;
    link.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-gray-800">Drawing Canvas</h3>
        <div className="flex gap-2">
          <button
            onClick={clearCanvas}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold transition-colors"
          >
            Clear
          </button>
          <button
            onClick={saveCanvas}
            className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg font-semibold transition-colors"
          >
            Save
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        className="w-full bg-white border-4 border-gray-300 rounded-xl h-96 cursor-crosshair"
        style={{ touchAction: 'none' }}
      />
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">Color:</span>
          <div className="flex gap-2">
            {['black', 'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'white'].map((color) => (
              <motion.button
                key={color}
                onClick={() => setCurrentColor(color)}
                className={`w-10 h-10 rounded-full border-2 transition-all ${
                  currentColor === color ? 'border-gray-800 scale-110' : 'border-gray-300'
                }`}
                style={{ backgroundColor: color }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">Brush Size:</span>
          <div className="flex gap-2">
            {[2, 4, 6, 8].map((size) => (
              <motion.button
                key={size}
                onClick={() => setLineWidth(size)}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  lineWidth === size
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                }`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {size}px
              </motion.button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FlashcardsCreator() {
  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Create Flashcards</h3>
      <div className="bg-gradient-to-br from-yellow-100 to-orange-100 rounded-2xl p-8 text-center min-h-[300px] flex items-center justify-center">
        <div>
          <p className="text-2xl font-bold text-gray-800 mb-4">Click to flip</p>
          <p className="text-gray-600">Front side content</p>
        </div>
      </div>
      <motion.button
        className="w-full py-4 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-xl font-bold text-lg shadow-xl"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        + Add New Flashcard
      </motion.button>
    </div>
  );
}

function PracticeTests() {
  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Practice Tests</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Select Subject</label>
          <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
            <option>Mathematics</option>
            <option>Science</option>
            <option>History</option>
            <option>English</option>
            <option>Computer Science</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Test Type</label>
            <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              <option>Multiple Choice</option>
              <option>True/False</option>
              <option>Mixed</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Duration</label>
            <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              <option>15 minutes</option>
              <option>30 minutes</option>
              <option>45 minutes</option>
              <option>60 minutes</option>
            </select>
          </div>
        </div>
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
          <h4 className="font-semibold text-blue-900 mb-2">Recent Practice Tests</h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center bg-white p-3 rounded-lg">
              <span className="text-sm text-gray-700">Algebra Practice Test</span>
              <span className="text-sm font-bold text-green-600">85%</span>
            </div>
            <div className="flex justify-between items-center bg-white p-3 rounded-lg">
              <span className="text-sm text-gray-700">World History Quiz</span>
              <span className="text-sm font-bold text-yellow-600">72%</span>
            </div>
          </div>
        </div>
        <motion.button
          className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-bold text-lg shadow-xl"
          whileHover={{ scale: 1.02, boxShadow: '0 20px 40px rgba(59, 130, 246, 0.4)' }}
          whileTap={{ scale: 0.98 }}
        >
          📊 Start Practice Test
        </motion.button>
      </div>
    </div>
  );
}

function HabitTracker() {
  const habits = [
    { name: 'Daily Reading', streak: 7, completed: true },
    { name: 'Practice Problems', streak: 5, completed: true },
    { name: 'Review Notes', streak: 3, completed: false },
    { name: 'Exercise', streak: 12, completed: true }
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Habit Tracker</h3>
      <div className="space-y-3">
        {habits.map((habit, index) => (
          <motion.div
            key={index}
            className={`flex items-center justify-between p-4 rounded-xl border-2 ${
              habit.completed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
            }`}
            whileHover={{ scale: 1.02 }}
          >
            <div className="flex items-center gap-3">
              <motion.div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  habit.completed ? 'bg-green-500' : 'bg-gray-300'
                }`}
                whileTap={{ scale: 0.9 }}
              >
                <span className="text-white text-lg">{habit.completed ? '✓' : ''}</span>
              </motion.div>
              <div>
                <p className="font-semibold text-gray-800">{habit.name}</p>
                <p className="text-sm text-gray-600">🔥 {habit.streak} day streak</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-orange-500">{habit.streak}</p>
              <p className="text-xs text-gray-500">days</p>
            </div>
          </motion.div>
        ))}
      </div>
      <motion.button
        className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-bold text-lg shadow-xl"
        whileHover={{ scale: 1.02, boxShadow: '0 20px 40px rgba(34, 197, 94, 0.4)' }}
        whileTap={{ scale: 0.98 }}
      >
        ✅ Add New Habit
      </motion.button>
      <div className="bg-gradient-to-br from-orange-50 to-red-50 border-2 border-orange-200 rounded-xl p-4 text-center">
        <p className="text-3xl mb-2">🔥</p>
        <p className="font-bold text-gray-800">Longest Streak: 12 days</p>
        <p className="text-sm text-gray-600">Keep it going!</p>
      </div>
    </div>
  );
}

function ConceptExplainer() {
  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Concept Explainer</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">What concept do you want to understand?</label>
          <textarea
            placeholder="e.g., Explain photosynthesis in simple terms"
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-purple-500 focus:outline-none min-h-[100px] resize-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Explanation Level</label>
            <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-purple-500 focus:outline-none">
              <option>Simple (ELI5)</option>
              <option>Intermediate</option>
              <option>Advanced</option>
              <option>Expert</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Include</label>
            <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-purple-500 focus:outline-none">
              <option>Examples</option>
              <option>Diagrams</option>
              <option>Analogies</option>
              <option>All of the above</option>
            </select>
          </div>
        </div>
        <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-4">
          <h4 className="font-semibold text-purple-900 mb-2 flex items-center gap-2">
            💡 Popular Topics
          </h4>
          <div className="flex flex-wrap gap-2">
            {['Photosynthesis', 'Pythagorean Theorem', 'World War II', 'Newton\'s Laws', 'DNA Structure'].map((topic, index) => (
              <button
                key={index}
                className="px-3 py-1 bg-white hover:bg-purple-100 border border-purple-200 rounded-lg text-sm font-medium text-purple-700 transition-colors"
              >
                {topic}
              </button>
            ))}
          </div>
        </div>
        <motion.button
          className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-bold text-lg shadow-xl"
          whileHover={{ scale: 1.02, boxShadow: '0 20px 40px rgba(147, 51, 234, 0.4)' }}
          whileTap={{ scale: 0.98 }}
        >
          💡 Explain with AI
        </motion.button>
      </div>
    </div>
  );
}

function StudyMusic() {
  const playlists = [
    { name: 'Lo-fi Beats', mood: 'Relaxed', duration: '2h 30m', icon: '🎧' },
    { name: 'Classical Focus', mood: 'Concentrated', duration: '3h 15m', icon: '🎻' },
    { name: 'Nature Sounds', mood: 'Calm', duration: '1h 45m', icon: '🌊' },
    { name: 'Binaural Beats', mood: 'Deep Focus', duration: '2h 00m', icon: '🧠' }
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Study Music</h3>
      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm opacity-80">Now Playing</p>
            <p className="text-xl font-bold">Lo-fi Study Mix</p>
          </div>
          <motion.div
            className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-3xl"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            🎵
          </motion.div>
        </div>
        <div className="flex items-center gap-4">
          <motion.button
            className="w-12 h-12 bg-white text-purple-600 rounded-full flex items-center justify-center font-bold text-xl"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            ▶
          </motion.button>
          <div className="flex-1 bg-white/20 rounded-full h-2">
            <div className="bg-white rounded-full h-2 w-1/3"></div>
          </div>
          <span className="text-sm">28:45</span>
        </div>
      </div>
      <div className="space-y-3">
        <h4 className="font-semibold text-gray-700">Recommended Playlists</h4>
        {playlists.map((playlist, index) => (
          <motion.div
            key={index}
            className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200 cursor-pointer"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-pink-400 rounded-xl flex items-center justify-center text-2xl">
                {playlist.icon}
              </div>
              <div>
                <p className="font-semibold text-gray-800">{playlist.name}</p>
                <p className="text-sm text-gray-600">{playlist.mood} • {playlist.duration}</p>
              </div>
            </div>
            <motion.button
              className="px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold"
              whileHover={{ scale: 1.05 }}
            >
              Play
            </motion.button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function ImageAnalysis() {
  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Image Analysis</h3>
      <div className="space-y-4">
        <motion.div
          className="border-4 border-dashed border-gray-300 rounded-2xl p-12 text-center bg-gray-50 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="text-6xl mb-4">📸</div>
          <p className="text-lg font-semibold text-gray-700 mb-2">Upload an image to analyze</p>
          <p className="text-sm text-gray-500 mb-4">Drag and drop or click to browse</p>
          <motion.button
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Choose File
          </motion.button>
        </motion.div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Analysis Type</label>
            <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              <option>Diagram Explanation</option>
              <option>Text Extraction (OCR)</option>
              <option>Math Problem</option>
              <option>Scientific Image</option>
              <option>General Analysis</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Language</label>
            <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              <option>English</option>
              <option>Spanish</option>
              <option>French</option>
              <option>German</option>
            </select>
          </div>
        </div>
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
          <h4 className="font-semibold text-blue-900 mb-3">What can I analyze?</h4>
          <div className="grid grid-cols-2 gap-2 text-sm text-blue-800">
            <div className="flex items-start gap-2">
              <span>✓</span>
              <span>Diagrams & Charts</span>
            </div>
            <div className="flex items-start gap-2">
              <span>✓</span>
              <span>Handwritten Notes</span>
            </div>
            <div className="flex items-start gap-2">
              <span>✓</span>
              <span>Math Equations</span>
            </div>
            <div className="flex items-start gap-2">
              <span>✓</span>
              <span>Scientific Diagrams</span>
            </div>
          </div>
        </div>
        <motion.button
          className="w-full py-4 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl font-bold text-lg shadow-xl"
          whileHover={{ scale: 1.02, boxShadow: '0 20px 40px rgba(37, 99, 235, 0.4)' }}
          whileTap={{ scale: 0.98 }}
        >
          📸 Analyze Image with AI
        </motion.button>
      </div>
    </div>
  );
}

function MathSolver() {
  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Math Solver</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Enter your math problem</label>
          <textarea
            placeholder="e.g., Solve: 2x + 5 = 15"
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none min-h-[120px] resize-none font-mono"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Problem Type</label>
            <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none">
              <option>Algebra</option>
              <option>Calculus</option>
              <option>Geometry</option>
              <option>Trigonometry</option>
              <option>Statistics</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Show Steps</label>
            <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none">
              <option>Detailed Steps</option>
              <option>Quick Solution</option>
              <option>Solution Only</option>
            </select>
          </div>
        </div>
        <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-4">
          <h4 className="font-semibold text-indigo-900 mb-3">Quick Tools</h4>
          <div className="grid grid-cols-4 gap-2">
            {['x²', '√', '∫', 'π', 'sin', 'cos', 'log', '∑'].map((symbol, index) => (
              <motion.button
                key={index}
                className="px-3 py-2 bg-white hover:bg-indigo-100 border border-indigo-200 rounded-lg font-semibold text-indigo-700 transition-colors"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {symbol}
              </motion.button>
            ))}
          </div>
        </div>
        <div className="bg-gradient-to-br from-gray-50 to-indigo-50 rounded-xl p-4 border border-indigo-100">
          <p className="text-sm font-semibold text-gray-700 mb-2">Example Problems:</p>
          <div className="space-y-1 text-sm text-gray-600">
            <div>• Solve for x: 3x² - 12x + 9 = 0</div>
            <div>• Find the derivative of: f(x) = x³ + 2x² - 5x + 7</div>
            <div>• Calculate the area of a circle with radius 5</div>
          </div>
        </div>
        <motion.button
          className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-bold text-lg shadow-xl"
          whileHover={{ scale: 1.02, boxShadow: '0 20px 40px rgba(99, 102, 241, 0.4)' }}
          whileTap={{ scale: 0.98 }}
        >
          🧮 Solve with AI
        </motion.button>
      </div>
    </div>
  );
}

function ScienceLab() {
  const experiments = [
    { title: 'Chemical Reactions', subject: 'Chemistry', difficulty: 'Medium' },
    { title: 'Physics Simulations', subject: 'Physics', difficulty: 'Hard' },
    { title: 'Biology Labs', subject: 'Biology', difficulty: 'Easy' },
    { title: 'Astronomy Observations', subject: 'Astronomy', difficulty: 'Medium' }
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Science Lab</h3>
      <div className="space-y-4">
        <div className="bg-gradient-to-br from-teal-500 to-cyan-600 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center text-4xl">
              🔬
            </div>
            <div>
              <h4 className="text-xl font-bold">Virtual Laboratory</h4>
              <p className="text-sm opacity-90">Conduct safe experiments virtually</p>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Select Subject</label>
          <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-teal-500 focus:outline-none">
            <option>Chemistry</option>
            <option>Physics</option>
            <option>Biology</option>
            <option>Astronomy</option>
            <option>Earth Science</option>
          </select>
        </div>
        <div className="space-y-3">
          <h4 className="font-semibold text-gray-700">Popular Experiments</h4>
          {experiments.map((exp, index) => (
            <motion.div
              key={index}
              className="flex items-center justify-between p-4 bg-gradient-to-r from-teal-50 to-cyan-50 hover:from-teal-100 hover:to-cyan-100 rounded-xl border-2 border-teal-200 cursor-pointer"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div>
                <p className="font-semibold text-gray-800">{exp.title}</p>
                <p className="text-sm text-gray-600">{exp.subject} • {exp.difficulty}</p>
              </div>
              <motion.button
                className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold"
                whileHover={{ scale: 1.05 }}
              >
                Start
              </motion.button>
            </motion.div>
          ))}
        </div>
        <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-yellow-900 mb-2">⚠️ Safety First</p>
          <p className="text-sm text-yellow-800">Always follow safety protocols when conducting real experiments</p>
        </div>
        <motion.button
          className="w-full py-4 bg-gradient-to-r from-teal-600 to-cyan-600 text-white rounded-xl font-bold text-lg shadow-xl"
          whileHover={{ scale: 1.02, boxShadow: '0 20px 40px rgba(20, 184, 166, 0.4)' }}
          whileTap={{ scale: 0.98 }}
        >
          🔬 Start New Experiment
        </motion.button>
      </div>
    </div>
  );
}

function VisualLearning() {
  const visualTypes = [
    { type: 'Mind Maps', icon: '🗺️', color: 'from-pink-400 to-rose-400' },
    { type: 'Infographics', icon: '📊', color: 'from-blue-400 to-indigo-400' },
    { type: 'Diagrams', icon: '🔷', color: 'from-green-400 to-emerald-400' },
    { type: 'Timelines', icon: '⏳', color: 'from-orange-400 to-amber-400' }
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Visual Learning</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">What do you want to visualize?</label>
          <textarea
            placeholder="e.g., Create a timeline of World War II events"
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none min-h-[100px] resize-none"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Visualization Type</label>
          <div className="grid grid-cols-2 gap-3">
            {visualTypes.map((item, index) => (
              <motion.div
                key={index}
                className={`p-4 bg-gradient-to-br ${item.color} rounded-xl cursor-pointer text-white shadow-lg`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <div className="text-3xl mb-2">{item.icon}</div>
                <p className="font-semibold">{item.type}</p>
              </motion.div>
            ))}
          </div>
        </div>
        <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4">
          <h4 className="font-semibold text-green-900 mb-3">Why Visual Learning?</h4>
          <div className="space-y-2 text-sm text-green-800">
            <div className="flex items-start gap-2">
              <span>✓</span>
              <span>Remember information 65% better with visuals</span>
            </div>
            <div className="flex items-start gap-2">
              <span>✓</span>
              <span>Understand complex relationships faster</span>
            </div>
            <div className="flex items-start gap-2">
              <span>✓</span>
              <span>Perfect for visual learners</span>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-gray-50 to-green-50 rounded-xl p-4 border border-green-100">
          <p className="text-sm font-semibold text-gray-700 mb-2">Popular Templates:</p>
          <div className="flex flex-wrap gap-2">
            {['Historical Timeline', 'Concept Map', 'Process Flow', 'Comparison Chart'].map((template, index) => (
              <button
                key={index}
                className="px-3 py-1 bg-white hover:bg-green-100 border border-green-200 rounded-lg text-sm font-medium text-green-700 transition-colors"
              >
                {template}
              </button>
            ))}
          </div>
        </div>
        <motion.button
          className="w-full py-4 bg-gradient-to-r from-green-600 to-teal-600 text-white rounded-xl font-bold text-lg shadow-xl"
          whileHover={{ scale: 1.02, boxShadow: '0 20px 40px rgba(22, 163, 74, 0.4)' }}
          whileTap={{ scale: 0.98 }}
        >
          🌍 Create Visual
        </motion.button>
      </div>
    </div>
  );
}

function NotesSync() {
  const recentNotes = [
    { title: 'Biology Chapter 5', subject: 'Biology', lastEdit: '2 hours ago', synced: true },
    { title: 'Calculus Notes', subject: 'Math', lastEdit: '1 day ago', synced: true },
    { title: 'History Essay Outline', subject: 'History', lastEdit: '3 days ago', synced: false }
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Notes Sync</h3>
      <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xl font-bold mb-2">Cloud Storage</h4>
            <p className="text-sm opacity-90">All your notes in one place</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold">24</p>
            <p className="text-sm opacity-90">Total Notes</p>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-gray-700">Recent Notes</h4>
          <motion.button
            className="px-4 py-2 bg-amber-600 text-white rounded-lg font-semibold text-sm"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            + New Note
          </motion.button>
        </div>
        {recentNotes.map((note, index) => (
          <motion.div
            key={index}
            className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200 cursor-pointer"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-400 rounded-xl flex items-center justify-center text-2xl">
                📓
              </div>
              <div>
                <p className="font-semibold text-gray-800">{note.title}</p>
                <p className="text-sm text-gray-600">{note.subject} • {note.lastEdit}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {note.synced ? (
                <span className="text-green-600 text-sm">✓ Synced</span>
              ) : (
                <span className="text-orange-600 text-sm">⟳ Syncing...</span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 text-center">
          <p className="text-2xl mb-2">☁️</p>
          <p className="font-semibold text-gray-800">2.3 GB</p>
          <p className="text-xs text-gray-600">Storage Used</p>
        </div>
        <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-4 text-center">
          <p className="text-2xl mb-2">📱</p>
          <p className="font-semibold text-gray-800">3 Devices</p>
          <p className="text-xs text-gray-600">Connected</p>
        </div>
      </div>
      <motion.button
        className="w-full py-4 bg-gradient-to-r from-amber-600 to-orange-600 text-white rounded-xl font-bold text-lg shadow-xl"
        whileHover={{ scale: 1.02, boxShadow: '0 20px 40px rgba(217, 119, 6, 0.4)' }}
        whileTap={{ scale: 0.98 }}
      >
        📓 Sync All Notes
      </motion.button>
    </div>
  );
}

function AIPlanner() {
  const upcomingTasks = [
    { task: 'Math Homework', due: 'Today', priority: 'High', completed: false },
    { task: 'Science Project', due: 'Tomorrow', priority: 'Medium', completed: false },
    { task: 'Read Chapter 7', due: 'This Week', priority: 'Low', completed: true }
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">AI Planner</h3>
      <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-xl font-bold">Your Study Schedule</h4>
            <p className="text-sm opacity-90">AI-powered planning</p>
          </div>
          <div className="text-5xl">📅</div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="text-center">
            <p className="text-2xl font-bold">12</p>
            <p className="text-xs opacity-80">Total Tasks</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">8</p>
            <p className="text-xs opacity-80">Completed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">4</p>
            <p className="text-xs opacity-80">Pending</p>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <h4 className="font-semibold text-gray-700">Upcoming Tasks</h4>
        {upcomingTasks.map((item, index) => (
          <motion.div
            key={index}
            className={`flex items-center justify-between p-4 rounded-xl border-2 ${
              item.completed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
            }`}
            whileHover={{ scale: 1.02 }}
          >
            <div className="flex items-center gap-3">
              <motion.div
                className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center ${
                  item.completed ? 'bg-green-500 border-green-500' : 'border-gray-300'
                }`}
                whileTap={{ scale: 0.9 }}
              >
                {item.completed && <span className="text-white text-sm">✓</span>}
              </motion.div>
              <div>
                <p className="font-semibold text-gray-800">{item.task}</p>
                <p className="text-sm text-gray-600">Due: {item.due}</p>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${
              item.priority === 'High' ? 'bg-red-100 text-red-700' :
              item.priority === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
              'bg-gray-100 text-gray-700'
            }`}>
              {item.priority}
            </span>
          </motion.div>
        ))}
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Add New Task</label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Enter task name..."
            className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
          />
          <motion.button
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Add
          </motion.button>
        </div>
      </div>
      <motion.button
        className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-bold text-lg shadow-xl"
        whileHover={{ scale: 1.02, boxShadow: '0 20px 40px rgba(99, 102, 241, 0.4)' }}
        whileTap={{ scale: 0.98 }}
      >
        📅 Generate AI Study Plan
      </motion.button>
    </div>
  );
}

function GoalSetter() {
  const goals = [
    { goal: 'Achieve 90% in Math', progress: 75, category: 'Academic', timeframe: 'This Semester' },
    { goal: 'Read 5 Books', progress: 60, category: 'Personal', timeframe: 'This Month' },
    { goal: 'Complete Science Project', progress: 40, category: 'Academic', timeframe: 'Next Week' }
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-800">Goal Setter</h3>
      <div className="bg-gradient-to-br from-pink-500 to-rose-600 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xl font-bold mb-2">Your Goals</h4>
            <p className="text-sm opacity-90">Track your progress to success</p>
          </div>
          <div className="text-6xl">🎯</div>
        </div>
      </div>
      <div className="space-y-4">
        <h4 className="font-semibold text-gray-700">Active Goals</h4>
        {goals.map((item, index) => (
          <motion.div
            key={index}
            className="p-4 bg-gray-50 rounded-xl border-2 border-gray-200"
            whileHover={{ scale: 1.02 }}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="font-semibold text-gray-800">{item.goal}</p>
                <p className="text-sm text-gray-600">{item.category} • {item.timeframe}</p>
              </div>
              <span className="text-2xl font-bold text-pink-600">{item.progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-pink-500 to-rose-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${item.progress}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            </div>
          </motion.div>
        ))}
      </div>
      <div className="space-y-3">
        <h4 className="font-semibold text-gray-700">Create New Goal</h4>
        <input
          type="text"
          placeholder="What do you want to achieve?"
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-pink-500 focus:outline-none"
        />
        <div className="grid grid-cols-2 gap-4">
          <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-pink-500 focus:outline-none">
            <option>Academic</option>
            <option>Personal</option>
            <option>Health</option>
            <option>Career</option>
          </select>
          <select className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-pink-500 focus:outline-none">
            <option>This Week</option>
            <option>This Month</option>
            <option>This Semester</option>
            <option>This Year</option>
          </select>
        </div>
      </div>
      <div className="bg-pink-50 border-2 border-pink-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-pink-900 mb-2">💪 Success Tips</p>
        <ul className="space-y-1 text-sm text-pink-800">
          <li>• Make your goals specific and measurable</li>
          <li>• Break large goals into smaller milestones</li>
          <li>• Review and adjust your goals regularly</li>
        </ul>
      </div>
      <motion.button
        className="w-full py-4 bg-gradient-to-r from-pink-600 to-rose-600 text-white rounded-xl font-bold text-lg shadow-xl"
        whileHover={{ scale: 1.02, boxShadow: '0 20px 40px rgba(236, 72, 153, 0.4)' }}
        whileTap={{ scale: 0.98 }}
      >
        🎯 Set New Goal
      </motion.button>
    </div>
  );
}
