import { useState, useEffect } from 'react';

export default function LoadingScreen() {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Analyzing your content...');

  useEffect(() => {
    const messages = [
      'Analyzing your content...',
      'Extracting key concepts...',
      'Generating questions...',
      'Crafting multiple choice options...',
      'Creating short answer questions...',
      'Finalizing your quiz...',
    ];

    let currentMessage = 0;
    let currentProgress = 0;

    const interval = setInterval(() => {
      currentProgress += Math.random() * 15;

      if (currentProgress >= 95) {
        currentProgress = 95;
      }

      setProgress(Math.min(currentProgress, 95));

      const messageIndex = Math.floor((currentProgress / 100) * messages.length);
      if (messageIndex !== currentMessage && messageIndex < messages.length) {
        currentMessage = messageIndex;
        setMessage(messages[messageIndex]);
      }
    }, 800);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-purple-gradient flex items-center justify-center p-4">
      <div className="bg-off-white rounded-2xl shadow-2xl p-12 w-full max-w-2xl text-center">
        <div className="mb-8">
          <div className="text-6xl mb-6">🤖</div>
          <h2 className="text-3xl font-bold text-deep-blue mb-4">
            Creating Your Quiz
          </h2>
          <p className="text-xl text-gray-600">{message}</p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
            <div
              className="bg-vibrant-yellow h-4 rounded-full transition-all duration-500 ease-out relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-pulse" />
            </div>
          </div>
          <div className="mt-3 flex justify-between items-center">
            <span className="text-sm text-gray-500">AI is working its magic</span>
            <span className="text-2xl font-bold text-deep-blue">{Math.round(progress)}%</span>
          </div>
        </div>

        {/* Animated Dots */}
        <div className="flex justify-center gap-2">
          <div className="w-3 h-3 bg-deep-blue rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-3 h-3 bg-deep-blue rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-3 h-3 bg-deep-blue rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>

        <p className="text-sm text-gray-500 mt-8">
          This usually takes 10-30 seconds
        </p>
      </div>
    </div>
  );
}
