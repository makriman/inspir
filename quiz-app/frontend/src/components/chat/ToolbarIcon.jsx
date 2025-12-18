import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

export default function ToolbarIcon({ tool, index, isActive, onClick }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      className="relative flex flex-col items-center"
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 25,
        delay: index * 0.03
      }}
    >
      {/* Tooltip */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="absolute bottom-full mb-3 px-3 py-2 bg-gray-900 text-white text-xs font-semibold rounded-lg shadow-xl whitespace-nowrap z-50"
          >
            <div className="font-bold">{tool.label}</div>
            <div className="text-gray-300 text-[10px]">{tool.description}</div>
            {/* Arrow */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
              <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Icon Button */}
      <motion.button
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`relative w-14 h-14 rounded-2xl bg-gradient-to-br ${tool.color} flex items-center justify-center text-3xl shadow-lg transition-all ${
          isActive ? 'ring-4 ring-blue-400 ring-offset-2' : ''
        }`}
        whileHover={{
          scale: 1.3,
          rotate: [0, -10, 10, -10, 0],
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)'
        }}
        whileTap={{
          scale: 0.9
        }}
        animate={
          isActive
            ? {
                scale: [1.1, 1.15, 1.1],
                boxShadow: [
                  '0 10px 30px rgba(59, 130, 246, 0.5)',
                  '0 10px 40px rgba(59, 130, 246, 0.7)',
                  '0 10px 30px rgba(59, 130, 246, 0.5)'
                ]
              }
            : {}
        }
        transition={{
          scale: { duration: 0.3, type: 'spring', stiffness: 400 },
          rotate: { duration: 0.5 },
          boxShadow: { duration: 1.5, repeat: Infinity }
        }}
      >
        {/* Icon with micro-animation */}
        <motion.span
          animate={
            isHovered
              ? {
                  scale: [1, 1.2, 1],
                  rotate: [0, -15, 15, 0]
                }
              : {}
          }
          transition={{ duration: 0.5 }}
        >
          {tool.icon}
        </motion.span>

        {/* Active indicator */}
        {isActive && (
          <motion.div
            className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full border-2 border-white"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 15 }}
          >
            <motion.div
              className="w-full h-full bg-blue-400 rounded-full"
              animate={{
                scale: [1, 1.5, 1],
                opacity: [1, 0, 1]
              }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </motion.div>
        )}

        {/* Hover glow effect */}
        {isHovered && (
          <motion.div
            className="absolute inset-0 rounded-2xl bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.2 }}
            exit={{ opacity: 0 }}
          />
        )}
      </motion.button>
    </motion.div>
  );
}
