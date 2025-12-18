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

// Custom node component for concept map nodes
const ConceptNode = ({ data }) => {
  const getCategoryColor = (category) => {
    const colors = {
      cause: '#ef4444',
      effect: '#f59e0b',
      process: '#3b82f6',
      component: '#10b981',
      attribute: '#8b5cf6',
      default: '#6b7280',
    };
    return colors[category] || colors.default;
  };

  return (
    <div
      style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '12px 16px',
        border: `3px solid ${getCategoryColor(data.category)}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        minWidth: '100px',
        maxWidth: '200px',
      }}
    >
      <div
        style={{
          color: getCategoryColor(data.category),
          fontWeight: 'semibold',
          fontSize: '13px',
          textAlign: 'center',
          wordWrap: 'break-word',
        }}
      >
        {data.label}
      </div>
      {data.category && (
        <div
          style={{
            fontSize: '10px',
            color: '#9ca3af',
            textAlign: 'center',
            marginTop: '4px',
            textTransform: 'capitalize',
          }}
        >
          {data.category}
        </div>
      )}
    </div>
  );
};

// Custom edge label component
const CustomEdge = ({ id, sourceX, sourceY, targetX, targetY, label, style = {} }) => {
  const edgePath = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;

  return (
    <>
      <path
        id={id}
        style={style}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd="url(#arrowclosed)"
      />
      {label && (
        <text>
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle" style={{ fontSize: '12px', fill: '#6b7280' }}>
            {label}
          </textPath>
        </text>
      )}
    </>
  );
};

const nodeTypes = {
  conceptNode: ConceptNode,
};

export default function ConceptMapBuilder() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // View state
  const [view, setView] = useState('generate'); // 'generate', 'library', 'editor'

  // Generation state
  const [inputMethod, setInputMethod] = useState('topic'); // 'topic' or 'file'
  const [topic, setTopic] = useState('');
  const [file, setFile] = useState(null);

  // Concept maps state
  const [conceptMaps, setConceptMaps] = useState([]);
  const [currentConceptMap, setCurrentConceptMap] = useState(null);

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [edgeLabel, setEdgeLabel] = useState('');

  // Load concept maps on mount if user is logged in
  useEffect(() => {
    if (user) {
      loadConceptMaps();
    }
  }, [user]);

  const loadConceptMaps = async () => {
    try {
      const response = await axios.get('/api/conceptmap');
      setConceptMaps(response.data.conceptMaps || []);
    } catch (err) {
      console.error('Error loading concept maps:', err);
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
      setError('Please enter a topic for your concept map');
      return;
    }

    if (inputMethod === 'file' && !file) {
      setError('Please select a file to generate concept map from');
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

      const response = await axios.post('/api/conceptmap/generate', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const conceptMap = response.data.conceptMap;
      setCurrentConceptMap(conceptMap);

      // Convert concepts to nodes
      const generatedNodes = (conceptMap.concepts || []).map((concept, index) => ({
        id: `concept-${index}`,
        type: 'conceptNode',
        position: concept.position || { x: Math.random() * 600, y: Math.random() * 400 },
        data: { label: concept.label, category: concept.category },
      }));

      // Convert relationships to edges with labels
      const generatedEdges = (conceptMap.relationships || []).map((rel, index) => ({
        id: `edge-${index}`,
        source: `concept-${rel.from}`,
        target: `concept-${rel.to}`,
        label: rel.label,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#94a3b8', strokeWidth: 2 },
      }));

      setNodes(generatedNodes);
      setEdges(generatedEdges);
      setView('editor');

      // Reload library if user is logged in
      if (user) {
        loadConceptMaps();
      }

    } catch (err) {
      console.error('Error generating concept map:', err);
      setError(err.response?.data?.error || 'Failed to generate concept map. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const onConnect = useCallback(
    (params) => {
      const newEdge = {
        ...params,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        label: 'relates to',
        style: { stroke: '#94a3b8', strokeWidth: 2 },
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges]
  );

  const onEdgeClick = (event, edge) => {
    setSelectedEdge(edge);
    setEdgeLabel(edge.label || '');
  };

  const handleUpdateEdgeLabel = () => {
    if (!selectedEdge) return;

    setEdges((eds) =>
      eds.map((edge) =>
        edge.id === selectedEdge.id
          ? { ...edge, label: edgeLabel }
          : edge
      )
    );
    setSelectedEdge(null);
    setEdgeLabel('');
  };

  const handleSave = async () => {
    if (!currentConceptMap || !user) return;

    try {
      // Convert nodes and edges back to concepts and relationships
      const concepts = nodes.map((node, index) => ({
        label: node.data.label,
        category: node.data.category,
        position: node.position,
      }));

      const relationships = edges.map((edge) => {
        const fromIndex = nodes.findIndex(n => n.id === edge.source);
        const toIndex = nodes.findIndex(n => n.id === edge.target);
        return {
          from: fromIndex,
          to: toIndex,
          label: edge.label || 'relates to',
        };
      });

      await axios.put(`/api/conceptmap/${currentConceptMap.id}`, {
        concepts,
        relationships,
      });

      alert('Concept map saved successfully!');
      loadConceptMaps();
    } catch (err) {
      console.error('Error saving concept map:', err);
      setError('Failed to save concept map');
    }
  };

  const handleLoadConceptMap = async (conceptMap) => {
    setCurrentConceptMap(conceptMap);

    // Convert concepts to nodes
    const loadedNodes = (conceptMap.concepts || []).map((concept, index) => ({
      id: `concept-${index}`,
      type: 'conceptNode',
      position: concept.position || { x: Math.random() * 600, y: Math.random() * 400 },
      data: { label: concept.label, category: concept.category },
    }));

    // Convert relationships to edges
    const loadedEdges = (conceptMap.relationships || []).map((rel, index) => ({
      id: `edge-${index}`,
      source: `concept-${rel.from}`,
      target: `concept-${rel.to}`,
      label: rel.label,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#94a3b8', strokeWidth: 2 },
    }));

    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setView('editor');
  };

  const handleDeleteConceptMap = async (id) => {
    if (!confirm('Are you sure you want to delete this concept map?')) return;

    try {
      await axios.delete(`/api/conceptmap/${id}`);
      loadConceptMaps();
      if (currentConceptMap?.id === id) {
        setCurrentConceptMap(null);
        setView('generate');
      }
    } catch (err) {
      console.error('Error deleting concept map:', err);
      setError('Failed to delete concept map');
    }
  };

  const handleExport = () => {
    const data = {
      title: currentConceptMap.title,
      concepts: nodes.map(node => ({ label: node.data.label, category: node.data.category })),
      relationships: edges.map(edge => {
        const fromIndex = nodes.findIndex(n => n.id === edge.source);
        const toIndex = nodes.findIndex(n => n.id === edge.target);
        return { from: fromIndex, to: toIndex, label: edge.label };
      }),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentConceptMap.title.replace(/[^a-z0-9]/gi, '_')}_conceptmap.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddConcept = () => {
    const categories = ['cause', 'effect', 'process', 'component', 'attribute'];
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];

    const newNode = {
      id: `concept-${Date.now()}`,
      type: 'conceptNode',
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      data: { label: 'New Concept', category: randomCategory },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-fuchsia-50 to-white py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block bg-violet-100 rounded-full px-4 py-2 mb-4">
            <span className="text-violet-700 font-semibold text-sm">Relationship Mapping</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Concept Map Builder
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Map relationships between concepts. Understand how ideas connect and influence each other.
          </p>
        </div>

        {/* View Tabs */}
        <div className="flex justify-center gap-4 mb-8">
          <button
            onClick={() => setView('generate')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              view === 'generate'
                ? 'bg-violet-600 text-white shadow-lg'
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
                  ? 'bg-violet-600 text-white shadow-lg'
                  : 'bg-white text-gray-700 hover:bg-gray-50 shadow'
              }`}
            >
              My Concept Maps ({conceptMaps.length})
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
                      ? 'bg-violet-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Enter Topic
                </button>
                <button
                  onClick={() => setInputMethod('file')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'file'
                      ? 'bg-violet-600 text-white shadow-md'
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
                  Concept Map Topic
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g., Causes of Climate Change, Immune System Response, Supply Chain Management"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-violet-500 focus:outline-none"
                />
                <p className="mt-2 text-sm text-gray-500">
                  Best for topics with clear cause-effect relationships and interconnected concepts
                </p>
              </div>
            )}

            {/* File Upload */}
            {inputMethod === 'file' && (
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Upload Document
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-violet-400 transition-colors">
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept=".pdf,.docx,.txt"
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    {file ? (
                      <div className="text-violet-600">
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

            {/* Concept Categories Legend */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Concept Categories</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { name: 'Cause', color: '#ef4444' },
                  { name: 'Effect', color: '#f59e0b' },
                  { name: 'Process', color: '#3b82f6' },
                  { name: 'Component', color: '#10b981' },
                  { name: 'Attribute', color: '#8b5cf6' },
                ].map((cat) => (
                  <div key={cat.name} className="flex items-center gap-2">
                    <div
                      style={{ backgroundColor: cat.color }}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm text-gray-600">{cat.name}</span>
                  </div>
                ))}
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
              className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white py-4 px-6 rounded-lg font-semibold text-lg hover:from-violet-700 hover:to-fuchsia-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating Concept Map...
                </span>
              ) : (
                'Generate Concept Map'
              )}
            </button>
          </div>
        )}

        {/* Library View */}
        {view === 'library' && user && (
          <div className="space-y-6">
            {conceptMaps.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
                <p className="text-gray-500 text-lg mb-4">No concept maps yet</p>
                <button
                  onClick={() => setView('generate')}
                  className="bg-violet-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-violet-700 transition-all"
                >
                  Create Your First Concept Map
                </button>
              </div>
            ) : (
              conceptMaps.map((conceptMap) => (
                <div key={conceptMap.id} className="bg-white rounded-2xl shadow-xl p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-2xl font-bold text-gray-900 mb-2">{conceptMap.title}</h3>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span>{conceptMap.concept_count || conceptMap.concepts?.length || 0} concepts</span>
                        <span>•</span>
                        <span>{conceptMap.relationship_count || conceptMap.relationships?.length || 0} relationships</span>
                        <span>•</span>
                        <span>Created {new Date(conceptMap.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLoadConceptMap(conceptMap)}
                        className="px-4 py-2 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 transition-all"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => handleDeleteConceptMap(conceptMap.id)}
                        className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                        title="Delete concept map"
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
        {view === 'editor' && currentConceptMap && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              {/* Editor Toolbar */}
              <div className="bg-gray-50 border-b border-gray-200 p-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{currentConceptMap.title}</h2>
                  <p className="text-sm text-gray-500">{nodes.length} concepts, {edges.length} relationships</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleAddConcept}
                    className="px-4 py-2 bg-violet-100 text-violet-700 rounded-lg font-medium hover:bg-violet-200 transition-all"
                  >
                    + Add Concept
                  </button>
                  {user && (
                    <button
                      onClick={handleSave}
                      className="px-4 py-2 bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 transition-all"
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
                  onEdgeClick={onEdgeClick}
                  nodeTypes={nodeTypes}
                  fitView
                  attributionPosition="bottom-left"
                >
                  <Controls />
                  <MiniMap
                    nodeColor={(node) => {
                      const colors = {
                        cause: '#ef4444',
                        effect: '#f59e0b',
                        process: '#3b82f6',
                        component: '#10b981',
                        attribute: '#8b5cf6',
                        default: '#6b7280',
                      };
                      return colors[node.data.category] || colors.default;
                    }}
                    style={{ backgroundColor: '#f8fafc' }}
                  />
                  <Background variant="dots" gap={12} size={1} />
                </ReactFlow>
              </div>
            </div>

            {/* Edge Label Editor */}
            {selectedEdge && (
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Edit Relationship Label</h3>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={edgeLabel}
                    onChange={(e) => setEdgeLabel(e.target.value)}
                    placeholder="e.g., causes, leads to, is part of..."
                    className="flex-1 px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-violet-500 focus:outline-none"
                  />
                  <button
                    onClick={handleUpdateEdgeLabel}
                    className="px-6 py-2 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 transition-all"
                  >
                    Update
                  </button>
                  <button
                    onClick={() => setSelectedEdge(null)}
                    className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-all"
                  >
                    Cancel
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-500">Click on any arrow to edit its relationship label</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
