import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';

// Custom node component for mind map nodes
const MindMapNode = ({ data }) => {
  return (
    <div
      style={{
        backgroundColor: data.color || '#3b82f6',
        borderRadius: '12px',
        padding: '12px 20px',
        border: '3px solid white',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        minWidth: '120px',
        maxWidth: '250px',
      }}
    >
      <div
        style={{
          color: 'white',
          fontWeight: data.isRoot ? 'bold' : 'semibold',
          fontSize: data.isRoot ? '18px' : '14px',
          textAlign: 'center',
          wordWrap: 'break-word',
        }}
      >
        {data.label}
      </div>
    </div>
  );
};

const nodeTypes = {
  mindMapNode: MindMapNode,
};

export default function MindMapCreator() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // View state
  const [view, setView] = useState('generate'); // 'generate', 'library', 'editor'

  // Generation state
  const [inputMethod, setInputMethod] = useState('topic'); // 'topic' or 'file'
  const [topic, setTopic] = useState('');
  const [file, setFile] = useState(null);
  const [layoutType, setLayoutType] = useState('tree'); // 'tree', 'radial'

  // Mind maps state
  const [mindMaps, setMindMaps] = useState([]);
  const [currentMindMap, setCurrentMindMap] = useState(null);

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load mind maps on mount if user is logged in
  useEffect(() => {
    if (user) {
      loadMindMaps();
    }
  }, [user]);

  const loadMindMaps = async () => {
    try {
      const response = await axios.get('/api/mindmap');
      setMindMaps(response.data.mindMaps || []);
    } catch (err) {
      console.error('Error loading mind maps:', err);
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleGenerate = async () => {
    setError(null);

    // Validation
    if (inputMethod === 'topic' && !topic.trim()) {
      setError('Please enter a topic for your mind map');
      return;
    }

    if (inputMethod === 'file' && !file) {
      setError('Please select a file to generate mind map from');
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();

      if (inputMethod === 'file') {
        formData.append('file', file);
      } else {
        formData.append('topic', topic);
      }

      formData.append('layoutType', layoutType);

      const response = await axios.post('/api/mindmap/generate', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const mindMap = response.data.mindMap;
      setCurrentMindMap(mindMap);
      setNodes(mindMap.nodes || []);
      setEdges(mindMap.edges || []);
      setView('editor');

      // Reload library if user is logged in
      if (user) {
        loadMindMaps();
      }

    } catch (err) {
      console.error('Error generating mind map:', err);
      setError(err.response?.data?.error || 'Failed to generate mind map. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }, eds)),
    [setEdges]
  );

  const handleSave = async () => {
    if (!currentMindMap || !user) return;

    try {
      await axios.put(`/api/mindmap/${currentMindMap.id}`, {
        nodes,
        edges,
      });
      alert('Mind map saved successfully!');
      loadMindMaps();
    } catch (err) {
      console.error('Error saving mind map:', err);
      setError('Failed to save mind map');
    }
  };

  const handleLoadMindMap = async (mindMap) => {
    setCurrentMindMap(mindMap);
    setNodes(mindMap.nodes || []);
    setEdges(mindMap.edges || []);
    setView('editor');
  };

  const handleDeleteMindMap = async (id) => {
    if (!confirm('Are you sure you want to delete this mind map?')) return;

    try {
      await axios.delete(`/api/mindmap/${id}`);
      loadMindMaps();
      if (currentMindMap?.id === id) {
        setCurrentMindMap(null);
        setView('generate');
      }
    } catch (err) {
      console.error('Error deleting mind map:', err);
      setError('Failed to delete mind map');
    }
  };

  const handleExport = () => {
    // Basic export to JSON
    const data = {
      title: currentMindMap.title,
      nodes,
      edges,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentMindMap.title.replace(/[^a-z0-9]/gi, '_')}_mindmap.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddNode = () => {
    const newNode = {
      id: `node-${Date.now()}`,
      type: 'mindMapNode',
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      data: { label: 'New Node', color: '#3b82f6' },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-emerald-50 to-white py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block bg-teal-100 rounded-full px-4 py-2 mb-4">
            <span className="text-teal-700 font-semibold text-sm">Visual Learning Tool</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Mind Map Creator
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Transform ideas into visual mind maps. Perfect for brainstorming, studying, and organizing thoughts.
          </p>
        </div>

        {/* View Tabs */}
        <div className="flex justify-center gap-4 mb-8">
          <button
            onClick={() => setView('generate')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              view === 'generate'
                ? 'bg-teal-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50 shadow'
            }`}
          >
            Create New
          </button>
          {user && (
            <button
              onClick={() => setView('library')}
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                view === 'library'
                  ? 'bg-teal-600 text-white shadow-lg'
                  : 'bg-white text-gray-700 hover:bg-gray-50 shadow'
              }`}
            >
              My Mind Maps ({mindMaps.length})
            </button>
          )}
        </div>

        {/* Generate View */}
        {view === 'generate' && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            {/* Input Method Selector */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Input Method
              </label>
              <div className="flex gap-4">
                <button
                  onClick={() => setInputMethod('topic')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'topic'
                      ? 'bg-teal-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Enter Topic
                </button>
                <button
                  onClick={() => setInputMethod('file')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'file'
                      ? 'bg-teal-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Upload File
                </button>
              </div>
            </div>

            {/* Topic Input */}
            {inputMethod === 'topic' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Mind Map Topic
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g., Photosynthesis, World War II, Machine Learning Algorithms"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-teal-500 focus:outline-none"
                />
              </div>
            )}

            {/* File Upload */}
            {inputMethod === 'file' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Upload Document
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-teal-400 transition-colors">
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept=".pdf,.docx,.txt"
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    {file ? (
                      <div className="text-teal-600">
                        <p className="font-medium text-lg">{file.name}</p>
                        <p className="text-sm text-gray-500 mt-1">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-gray-600 mb-2">Click to upload or drag and drop</p>
                        <p className="text-sm text-gray-400">PDF, DOCX, or TXT (max 10MB)</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>
            )}

            {/* Layout Type */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Layout Type
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label
                  className={`flex items-center p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    layoutType === 'tree'
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="layout"
                    value="tree"
                    checked={layoutType === 'tree'}
                    onChange={(e) => setLayoutType(e.target.value)}
                    className="mr-3"
                  />
                  <div>
                    <div className="font-medium text-gray-900">Tree Layout</div>
                    <div className="text-sm text-gray-500">Hierarchical top-down structure</div>
                  </div>
                </label>
                <label
                  className={`flex items-center p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    layoutType === 'radial'
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="layout"
                    value="radial"
                    checked={layoutType === 'radial'}
                    onChange={(e) => setLayoutType(e.target.value)}
                    className="mr-3"
                  />
                  <div>
                    <div className="font-medium text-gray-900">Radial Layout</div>
                    <div className="text-sm text-gray-500">Center-outward circular pattern</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full bg-gradient-to-r from-teal-600 to-emerald-600 text-white py-4 px-6 rounded-lg font-semibold text-lg hover:from-teal-700 hover:to-emerald-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating Mind Map...
                </span>
              ) : (
                'Generate Mind Map'
              )}
            </button>
          </div>
        )}

        {/* Library View */}
        {view === 'library' && user && (
          <div className="space-y-6">
            {mindMaps.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
                <p className="text-gray-500 text-lg mb-4">No mind maps yet</p>
                <button
                  onClick={() => setView('generate')}
                  className="bg-teal-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-teal-700 transition-all"
                >
                  Create Your First Mind Map
                </button>
              </div>
            ) : (
              mindMaps.map((mindMap) => (
                <div key={mindMap.id} className="bg-white rounded-2xl shadow-xl p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-2xl font-bold text-gray-900 mb-2">{mindMap.title}</h3>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span>{mindMap.node_count || mindMap.nodes?.length || 0} nodes</span>
                        <span>•</span>
                        <span className="capitalize">{mindMap.layout_type} layout</span>
                        <span>•</span>
                        <span>Created {new Date(mindMap.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLoadMindMap(mindMap)}
                        className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700 transition-all"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => handleDeleteMindMap(mindMap.id)}
                        className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                        title="Delete mind map"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Editor View */}
        {view === 'editor' && currentMindMap && (
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            {/* Editor Toolbar */}
            <div className="bg-gray-50 border-b border-gray-200 p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{currentMindMap.title}</h2>
                <p className="text-sm text-gray-500">{nodes.length} nodes, {edges.length} connections</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleAddNode}
                  className="px-4 py-2 bg-teal-100 text-teal-700 rounded-lg font-medium hover:bg-teal-200 transition-all"
                >
                  + Add Node
                </button>
                {user && (
                  <button
                    onClick={handleSave}
                    className="px-4 py-2 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-all"
                  >
                    Save
                  </button>
                )}
                <button
                  onClick={handleExport}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-all"
                >
                  Export
                </button>
                <button
                  onClick={() => setView('library')}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-all"
                >
                  Close
                </button>
              </div>
            </div>

            {/* React Flow Canvas */}
            <div style={{ height: '600px' }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                fitView
                attributionPosition="bottom-left"
              >
                <Controls />
                <MiniMap
                  nodeColor={(node) => node.data.color || '#3b82f6'}
                  style={{ backgroundColor: '#f8fafc' }}
                />
                <Background variant="dots" gap={12} size={1} />
              </ReactFlow>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
