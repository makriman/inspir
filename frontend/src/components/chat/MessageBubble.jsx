import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ThumbsUp, ThumbsDown, Star, Pin, Copy, Sparkles } from 'lucide-react';
import { useState } from 'react';

export default function MessageBubble({ message, user, index, isStreaming = false }) {
  const [showActions, setShowActions] = useState(false);
  const [liked, setLiked] = useState(null); // true for thumbs up, false for thumbs down
  const animationDelay = Number.isFinite(index) ? index * 0.05 : 0;

  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <motion.div
      className={`mb-8 ${isUser ? 'flex justify-end' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: animationDelay }}
      onMouseEnter={() => !isUser && setShowActions(true)}
      onMouseLeave={() => !isUser && setShowActions(false)}
    >
      <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''} max-w-[85%]`}>
        {/* Avatar */}
        {isAssistant && (
          <motion.div
            className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-lg"
            whileHover={{ scale: 1.1, rotate: 360 }}
            transition={{ duration: 0.5 }}
          >
            <Sparkles className="w-5 h-5 text-white" />
          </motion.div>
        )}

        {isUser && (
          <motion.div
            className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center flex-shrink-0 text-white font-bold shadow-lg"
            whileHover={{ scale: 1.1 }}
          >
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </motion.div>
        )}

        {/* Message Content */}
        <div className="flex-1 min-w-0">
          {isUser && (
            <motion.div
              className="inline-block bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-2xl px-5 py-3 shadow-lg"
              whileHover={{ scale: 1.01, boxShadow: '0 8px 16px rgba(37, 99, 235, 0.3)' }}
            >
              <p className="text-base whitespace-pre-wrap break-words">{message.content}</p>
            </motion.div>
          )}

          {isAssistant && (
            <motion.div
              className="bg-white border-l-4 border-purple-500 rounded-2xl px-5 py-4 shadow-md relative"
              whileHover={{ boxShadow: '0 8px 20px rgba(0,0,0,0.1)' }}
            >
              {/* Message Type Icon */}
              <div className="absolute -left-3 top-4 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-white text-xs">
                💡
              </div>

              <div className="prose prose-slate max-w-none">
                <ReactMarkdown
                  components={{
                    code({ node, inline, className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      return !inline && match ? (
                        <div className="relative group">
                          <SyntaxHighlighter
                            style={oneDark}
                            language={match[1]}
                            PreTag="div"
                            className="rounded-lg"
                            {...props}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                          <motion.button
                            className="absolute top-2 right-2 p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => {
                              navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
                            }}
                          >
                            <Copy className="w-4 h-4" />
                          </motion.button>
                        </div>
                      ) : (
                        <code className={`${className} bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded`} {...props}>
                          {children}
                        </code>
                      );
                    },
                    p({ children }) {
                      return <p className="mb-3 last:mb-0 text-gray-800 leading-relaxed">{children}</p>;
                    },
                    ul({ children }) {
                      return <ul className="mb-3 space-y-1 list-disc list-inside text-gray-800">{children}</ul>;
                    },
                    ol({ children }) {
                      return <ol className="mb-3 space-y-1 list-decimal list-inside text-gray-800">{children}</ol>;
                    },
                    h1({ children }) {
                      return <h1 className="text-2xl font-bold mb-3 text-gray-900">{children}</h1>;
                    },
                    h2({ children }) {
                      return <h2 className="text-xl font-bold mb-2 text-gray-900">{children}</h2>;
                    },
                    h3({ children }) {
                      return <h3 className="text-lg font-bold mb-2 text-gray-900">{children}</h3>;
                    },
                    blockquote({ children }) {
                      return (
                        <blockquote className="border-l-4 border-purple-400 pl-4 py-1 italic text-gray-700 bg-purple-50 rounded-r-lg">
                          {children}
                        </blockquote>
                      );
                    }
                  }}
                >
                  {message.content}
                </ReactMarkdown>

                {isStreaming && (
                  <motion.span
                    className="inline-block w-2 h-5 bg-purple-600 ml-1"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                  />
                )}
              </div>

              {/* Inline Actions */}
              <motion.div
                className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-200"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: showActions ? 1 : 0, height: showActions ? 'auto' : 0 }}
                transition={{ duration: 0.2 }}
              >
                <motion.button
                  className={`p-1.5 rounded-lg transition-colors ${
                    liked === true ? 'bg-green-100 text-green-600' : 'hover:bg-gray-100 text-gray-600'
                  }`}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setLiked(liked === true ? null : true)}
                  title="Helpful"
                >
                  <ThumbsUp className="w-4 h-4" />
                </motion.button>

                <motion.button
                  className={`p-1.5 rounded-lg transition-colors ${
                    liked === false ? 'bg-red-100 text-red-600' : 'hover:bg-gray-100 text-gray-600'
                  }`}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setLiked(liked === false ? null : false)}
                  title="Not helpful"
                >
                  <ThumbsDown className="w-4 h-4" />
                </motion.button>

                <div className="w-px h-4 bg-gray-300" />

                <motion.button
                  className="p-1.5 hover:bg-yellow-100 text-gray-600 hover:text-yellow-600 rounded-lg transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  title="Save to favorites"
                >
                  <Star className="w-4 h-4" />
                </motion.button>

                <motion.button
                  className="p-1.5 hover:bg-blue-100 text-gray-600 hover:text-blue-600 rounded-lg transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  title="Pin to notes"
                >
                  <Pin className="w-4 h-4" />
                </motion.button>

                <div className="flex-1" />

                <span className="text-xs text-gray-500">
                  {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </motion.div>
            </motion.div>
          )}

          {/* User message timestamp */}
          {isUser && (
            <div className="text-right mt-1">
              <span className="text-xs text-gray-500">
                {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
