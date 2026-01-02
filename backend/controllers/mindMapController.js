import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabaseClient.js';
import { v4 as uuidv4 } from 'uuid';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateMindMap(req, res) {
  try {
    const { topic, content } = req.body;
    const userId = req.user?.id || null;

    if (!topic || topic.trim().length === 0) {
      return res.status(400).json({ error: 'Topic is required' });
    }

    const prompt = \`Create a mind map for: \${topic}
\${content ? \`Additional context: \${content}\` : ''}

Generate a hierarchical mind map with:
- Central idea (root node)
- Main branches (3-6 major topics)
- Sub-branches (details for each major topic)

Return as JSON:
{
  "title": "Mind map title",
  "nodes": [
    {"id": "1", "label": "Central Idea", "type": "root", "position": {"x": 0, "y": 0}},
    {"id": "2", "label": "Branch 1", "type": "branch", "position": {"x": 200, "y": -100}},
    {"id": "3", "label": "Detail 1.1", "type": "leaf", "position": {"x": 400, "y": -150}}
  ],
  "edges": [
    {"id": "e1", "source": "1", "target": "2"},
    {"id": "e2", "source": "2", "target": "3"}
  ]
}\`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;
    const jsonMatch = responseText.match(/\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\`/) || [null, responseText];
    const mapData = JSON.parse(jsonMatch[1]);

    let savedMap = null;
    if (userId) {
      const { data } = await supabase.from('mind_maps').insert({
        user_id: userId,
        title: mapData.title || topic,
        topic,
        nodes: mapData.nodes,
        edges: mapData.edges
      }).select().single();
      savedMap = data;
    }

    res.json({ success: true, mindMap: { id: savedMap?.id || null, ...mapData } });
  } catch (error) {
    console.error('Error generating mind map:', error);
    res.status(500).json({ error: 'Failed to generate mind map' });
  }
}

export async function getMindMaps(req, res) {
  try {
    const userId = req.user.id;
    const { data } = await supabase.from('mind_maps')
      .select('id, title, topic, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    res.json({ success: true, mindMaps: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch mind maps' });
  }
}

export async function getMindMapById(req, res) {
  try {
    const { id } = req.params;
    const { data } = await supabase.from('mind_maps').select('*').eq('id', id).single();
    if (!data) return res.status(404).json({ error: 'Mind map not found' });
    res.json({ success: true, mindMap: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch mind map' });
  }
}

export async function updateMindMap(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { title, nodes, edges, viewport } = req.body;
    
    const { data } = await supabase.from('mind_maps')
      .update({ title, nodes, edges, viewport })
      .eq('id', id)
      .eq('user_id', userId)
      .select().single();
    
    res.json({ success: true, mindMap: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update mind map' });
  }
}

export async function deleteMindMap(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    await supabase.from('mind_maps').delete().eq('id', id).eq('user_id', userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete mind map' });
  }
}
