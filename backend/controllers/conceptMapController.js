import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../config/supabaseClient.js';
import { v4 as uuidv4 } from 'uuid';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateConceptMap(req, res) {
  try {
    const { topic, content } = req.body;
    const userId = req.user?.id || null;

    if (!topic || topic.trim().length === 0) {
      return res.status(400).json({ error: 'Topic is required' });
    }

    const prompt = \`Create a concept map showing relationships for: \${topic}
\${content ? \`Context: \${content}\` : ''}

Generate concepts and their relationships:
Return as JSON:
{
  "title": "Concept map title",
  "concepts": [
    {"id": "1", "label": "Concept 1", "category": "main"},
    {"id": "2", "label": "Concept 2", "category": "sub"}
  ],
  "relationships": [
    {"id": "r1", "source": "1", "target": "2", "label": "causes", "type": "causal"}
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
      const { data } = await supabase.from('concept_maps').insert({
        user_id: userId,
        title: mapData.title || topic,
        topic,
        concepts: mapData.concepts,
        relationships: mapData.relationships
      }).select().single();
      savedMap = data;
    }

    res.json({ success: true, conceptMap: { id: savedMap?.id || null, ...mapData } });
  } catch (error) {
    console.error('Error generating concept map:', error);
    res.status(500).json({ error: 'Failed to generate concept map' });
  }
}

export async function getConceptMaps(req, res) {
  try {
    const userId = req.user.id;
    const { data } = await supabase.from('concept_maps')
      .select('id, title, topic, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    res.json({ success: true, conceptMaps: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch concept maps' });
  }
}

export async function getConceptMapById(req, res) {
  try {
    const { id } = req.params;
    const { data } = await supabase.from('concept_maps').select('*').eq('id', id).single();
    if (!data) return res.status(404).json({ error: 'Concept map not found' });
    res.json({ success: true, conceptMap: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch concept map' });
  }
}

export async function updateConceptMap(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { title, concepts, relationships } = req.body;
    
    const { data } = await supabase.from('concept_maps')
      .update({ title, concepts, relationships })
      .eq('id', id)
      .eq('user_id', userId)
      .select().single();
    
    res.json({ success: true, conceptMap: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update concept map' });
  }
}

export async function deleteConceptMap(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    await supabase.from('concept_maps').delete().eq('id', id).eq('user_id', userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete concept map' });
  }
}
