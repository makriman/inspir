import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import API_URL from '../utils/api';

export default function Chat() {
  const { user, session, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingTitle, setEditingTitle] = useState(null);
  const [editTitle, setEditTitle] = useState('');

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const textareaRef = useRef(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  // Load conversations on mount
  useEffect(() => {
    if (user && session) {
      loadConversations();
    }
  }, [user, session]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessage]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [inputMessage]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadConversations = async () => {
    try {
      const response = await axios.get(`${API_URL}/chat/conversations`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      setConversations(response.data);
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const createNewConversation = async () => {
    try {
      const response = await axios.post(
        `${API_URL}/chat/conversations`,
        { title: 'New Chat' },
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );
      const newConv = response.data;
      setConversations(prev => [newConv, ...prev]);
      setCurrentConversation(newConv);
      setMessages([]);
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error creating conversation:', error);
    }
  };

  const loadMessages = async (conversationId) => {
    try {
      const response = await axios.get(
        `${API_URL}/chat/conversations/${conversationId}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );
      setMessages(response.data);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const selectConversation = (conversation) => {
    setCurrentConversation(conversation);
    loadMessages(conversation.id);
    setStreamingMessage('');
    // Auto-close sidebar on mobile after selecting conversation
    if (window.innerWidth < 640) {
      setSidebarCollapsed(true);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || isStreaming) {
      return;
    }

    // Create new conversation if none selected
    if (!currentConversation) {
      await createNewConversation();
      return;
    }

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setIsStreaming(true);
    setStreamingMessage('');

    // Add user message to UI immediately
    const tempUserMsg = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const response = await fetch(
        `${API_URL}/chat/conversations/${currentConversation.id}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ content: userMessage })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let fullText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'content') {
                fullText += data.text;
                setStreamingMessage(fullText);
              } else if (data.type === 'done') {
                const assistantMsg = {
                  id: data.messageId,
                  role: 'assistant',
                  content: fullText,
                  created_at: new Date().toISOString()
                };
                setMessages(prev => [...prev, assistantMsg]);
                setStreamingMessage('');
                loadConversations();
              } else if (data.type === 'error') {
                console.error('Streaming error:', data.error);
                alert('Error: ' + data.error);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please try again.');
      // Remove temporary user message on error
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
    } finally {
      setIsStreaming(false);
    }
  };

  const deleteConversation = async (convId, e) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation? This cannot be undone.')) return;

    try {
      await axios.delete(`${API_URL}/chat/conversations/${convId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      setConversations(prev => prev.filter(c => c.id !== convId));
      if (currentConversation?.id === convId) {
        setCurrentConversation(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
    }
  };

  const startEditingTitle = (conv, e) => {
    e.stopPropagation();
    setEditingTitle(conv.id);
    setEditTitle(conv.title);
  };

  const saveTitle = async (convId) => {
    if (!editTitle.trim()) {
      setEditingTitle(null);
      return;
    }

    try {
      await axios.patch(
        `${API_URL}/chat/conversations/${convId}`,
        { title: editTitle.trim() },
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );
      loadConversations();
      setEditingTitle(null);
    } catch (error) {
      console.error('Error updating title:', error);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-white overflow-hidden">
      {/* Sidebar */}
      <div className={`${sidebarCollapsed ? 'w-0' : 'w-full sm:w-64'} ${sidebarCollapsed ? '' : 'fixed sm:relative'} inset-0 sm:inset-auto z-40 sm:z-auto flex-shrink-0 transition-all duration-300 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden`}>
        {!sidebarCollapsed && (
          <>
            {/* Sidebar Header */}
            <div className="p-4 border-b border-gray-200">
              <button
                onClick={createNewConversation}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New chat
              </button>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto p-2">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => selectConversation(conv)}
                  className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer mb-1 ${
                    currentConversation?.id === conv.id
                      ? 'bg-gray-200'
                      : 'hover:bg-gray-100'
                  }`}
                >
                  <svg className="w-4 h-4 flex-shrink-0 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>

                  {editingTitle === conv.id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => saveTitle(conv.id)}
                      onKeyPress={(e) => e.key === 'Enter' && saveTitle(conv.id)}
                      className="flex-1 bg-white border border-gray-300 rounded px-2 py-1 text-sm"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 text-sm truncate">{conv.title}</span>
                  )}

                  <div className="hidden group-hover:flex items-center gap-1">
                    <button
                      onClick={(e) => startEditingTitle(conv, e)}
                      className="p-1 hover:bg-gray-200 rounded"
                      title="Rename"
                    >
                      <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => deleteConversation(conv.id, e)}
                      className="p-1 hover:bg-red-100 rounded"
                      title="Delete"
                    >
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* User Info */}
            <div className="p-4 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-semibold">
                  {user?.username?.[0]?.toUpperCase() || 'U'}
                </div>
                <span className="text-sm font-medium truncate">{user?.username}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative">
        {/* Toggle Sidebar Button */}
        <div className="absolute top-2 sm:top-4 left-2 sm:left-4 z-10">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2 bg-white shadow-md sm:shadow-none hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {sidebarCollapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              )}
            </svg>
          </button>
        </div>

        {currentConversation ? (
          <>
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-8 pt-14 sm:pt-16">
                {messages.length === 0 && !streamingMessage && (
                  <div className="text-center py-8 sm:py-12">
                    <h2 className="text-2xl sm:text-3xl font-semibold text-gray-800 mb-3 sm:mb-4">How can I help you today?</h2>
                    <p className="text-sm sm:text-base text-gray-600">Ask me anything - I'm here to assist with your studies and questions.</p>
                  </div>
                )}

                {messages.map((msg, idx) => (
                  <div key={msg.id} className={`mb-4 sm:mb-8 ${msg.role === 'user' ? 'ml-auto max-w-[85%] sm:max-w-[80%]' : ''}`}>
                    <div className="flex items-start gap-2 sm:gap-4">
                      {msg.role === 'assistant' && (
                        <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        </div>
                      )}

                      <div className={`flex-1 ${msg.role === 'user' ? 'text-right' : ''}`}>
                        {msg.role === 'user' && (
                          <div className="inline-block bg-gray-100 rounded-2xl px-3 sm:px-5 py-2 sm:py-3 text-left max-w-full">
                            <p className="text-sm sm:text-base text-gray-900 whitespace-pre-wrap break-words">{msg.content}</p>
                          </div>
                        )}

                        {msg.role === 'assistant' && (
                          <div className="prose prose-slate max-w-none">
                            <ReactMarkdown
                              components={{
                                code({node, inline, className, children, ...props}) {
                                  const match = /language-(\w+)/.exec(className || '');
                                  return !inline && match ? (
                                    <SyntaxHighlighter
                                      style={oneDark}
                                      language={match[1]}
                                      PreTag="div"
                                      {...props}
                                    >
                                      {String(children).replace(/\n$/, '')}
                                    </SyntaxHighlighter>
                                  ) : (
                                    <code className={className} {...props}>
                                      {children}
                                    </code>
                                  );
                                },
                              }}
                            >
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>

                      {msg.role === 'user' && (
                        <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 text-white text-xs sm:text-sm font-semibold">
                          {user?.username?.[0]?.toUpperCase() || 'U'}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Streaming message */}
                {streamingMessage && (
                  <div className="mb-4 sm:mb-8">
                    <div className="flex items-start gap-2 sm:gap-4">
                      <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="prose prose-slate max-w-none">
                          <ReactMarkdown
                            components={{
                              code({node, inline, className, children, ...props}) {
                                const match = /language-(\w+)/.exec(className || '');
                                return !inline && match ? (
                                  <SyntaxHighlighter
                                    style={oneDark}
                                    language={match[1]}
                                    PreTag="div"
                                    {...props}
                                  >
                                    {String(children).replace(/\n$/, '')}
                                  </SyntaxHighlighter>
                                ) : (
                                  <code className={className} {...props}>
                                    {children}
                                  </code>
                                );
                              },
                            }}
                          >
                            {streamingMessage}
                          </ReactMarkdown>
                          <span className="inline-block w-1.5 h-5 bg-purple-600 ml-1 animate-pulse"></span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input Area */}
            <div className="border-t border-gray-200 bg-white">
              <div className="max-w-3xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
                <div className="relative flex items-end gap-2 bg-white border border-gray-300 rounded-xl p-2 focus-within:border-gray-400 transition-colors">
                  <textarea
                    ref={textareaRef}
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Message InspirQuiz AI..."
                    disabled={isStreaming}
                    rows={1}
                    className="flex-1 resize-none bg-transparent border-none focus:outline-none text-sm sm:text-base text-gray-900 placeholder-gray-500 max-h-32 sm:max-h-40 px-1 sm:px-2 py-2 disabled:opacity-50"
                    style={{ minHeight: '24px' }}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={isStreaming || !inputMessage.trim()}
                    className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-gray-900 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                  </button>
                </div>
                <p className="text-xs text-gray-500 text-center mt-2">
                  InspirQuiz AI can make mistakes. Check important information.
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center px-4">
            <div className="text-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-purple-600 flex items-center justify-center mx-auto mb-4 sm:mb-6">
                <svg className="w-6 h-6 sm:w-8 sm:h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h1 className="text-2xl sm:text-4xl font-semibold text-gray-800 mb-2 sm:mb-3">InspirQuiz AI</h1>
              <p className="text-sm sm:text-base text-gray-600 mb-6 sm:mb-8">How can I help you today?</p>
              <button
                onClick={createNewConversation}
                className="px-4 sm:px-6 py-2 sm:py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors font-medium text-sm sm:text-base"
              >
                Start a conversation
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
