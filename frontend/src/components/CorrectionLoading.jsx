import { useEffect, useState } from 'react';

export default function CorrectionLoading() {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    { text: 'Analyzing your answers...', icon: '🔍' },
    { text: 'Checking multiple choice questions...', icon: '✓' },
    { text: 'Evaluating open-ended responses...', icon: '📝' },
    { text: 'Calculating your score...', icon: '🧮' },
    { text: 'Preparing your results...', icon: '📊' }
  ];

  useEffect(() => {
    // Step rotation
    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % steps.length);
    }, 2000);

    return () => {
      clearInterval(stepInterval);
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-purple-gradient p-4">
      <div className="bg-off-white p-8 md:p-12 rounded-3xl shadow-2xl max-w-lg w-full">
        {/* Animated Icon */}
        <div className="text-center mb-8">
          <div className="inline-block text-7xl animate-bounce mb-6">
            {steps[currentStep].icon}
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-deep-blue mb-3">
            {steps[currentStep].text}
          </h2>
          <p className="text-gray-600 text-lg">
            This will only take a moment
          </p>
        </div>

        {/* Loading Dots */}
        <div className="flex justify-center space-x-3 mb-8">
          <div className="w-4 h-4 bg-vibrant-purple rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
          <div className="w-4 h-4 bg-coral-red rounded-full animate-pulse" style={{ animationDelay: '200ms' }}></div>
          <div className="w-4 h-4 bg-vibrant-yellow rounded-full animate-pulse" style={{ animationDelay: '400ms' }}></div>
        </div>

        {/* Step Indicators */}
        <div className="flex justify-center space-x-2">
          {steps.map((_, index) => (
            <div
              key={index}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                index === currentStep
                  ? 'bg-vibrant-purple w-8'
                  : index < currentStep
                  ? 'bg-vibrant-purple opacity-50'
                  : 'bg-gray-300'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
