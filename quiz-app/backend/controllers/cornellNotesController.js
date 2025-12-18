import { supabase } from '../utils/supabaseClient.js';
import { generateCornellNotes } from '../utils/claudeClient.js';

// Generate Cornell notes from content
export async function generateNotes(req, res) {
  try {
    const { title, subject, content } = req.body;
    const userId = req.user?.id;

    if (!content || content.trim().length < 50) {
      return res.status(400).json({
        error: 'Content must be at least 50 characters long'
      });
    }

    // Generate Cornell notes using Claude AI
    const prompt = `You are an expert note-taker. Convert the following content into Cornell Notes format.

Cornell Notes consist of three sections:
1. CUES (left column): Key questions, keywords, and main points (bullet points)
2. NOTES (right column): Detailed notes, explanations, examples (organized points)
3. SUMMARY (bottom): Brief 2-3 sentence summary of the entire content

Content to convert:
${content}

Respond in JSON format:
{
  "cues": ["question or keyword 1", "question or keyword 2", ...],
  "notes": ["detailed note 1", "detailed note 2", ...],
  "summary": "brief summary of the content"
}`;

    const result = await generateCornellNotes(prompt);

    // Parse the AI response
    let parsedNotes;
    try {
      parsedNotes = JSON.parse(result);
    } catch (e) {
      // If JSON parsing fails, create a simple structure
      parsedNotes = {
        cues: ["Main Topic", "Key Points"],
        notes: [result],
        summary: "AI-generated notes from the provided content"
      };
    }

    // If user is authenticated, save to database
    if (userId) {
      const { data, error } = await supabase
        .from('cornell_notes')
        .insert({
          user_id: userId,
          title: title || 'Untitled Notes',
          subject: subject || null,
          source_content: content,
          cues: parsedNotes.cues,
          notes: parsedNotes.notes,
          summary: parsedNotes.summary
        })
        .select()
        .single();

      if (error) {
        console.error('Error saving Cornell notes:', error);
        return res.json({
          ...parsedNotes,
          saved: false,
          error: 'Notes generated but not saved'
        });
      }

      return res.json({
        ...parsedNotes,
        saved: true,
        noteId: data.id,
        data: data
      });
    }

    // For unauthenticated users
    res.json({
      ...parsedNotes,
      saved: false
    });

  } catch (error) {
    console.error('Error generating Cornell notes:', error);
    res.status(500).json({ error: 'Failed to generate Cornell notes' });
  }
}

// Get user's Cornell notes history
export async function getNotesHistory(req, res) {
  try {
    const userId = req.user.id;
    const { subject, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('cornell_notes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (subject) {
      query = query.eq('subject', subject);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    res.json({
      notes: data,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Error fetching Cornell notes:', error);
    res.status(500).json({ error: 'Failed to fetch Cornell notes' });
  }
}

// Get a specific Cornell note
export async function getNote(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('cornell_notes')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Cornell note not found' });
    }

    res.json(data);

  } catch (error) {
    console.error('Error fetching Cornell note:', error);
    res.status(500).json({ error: 'Failed to fetch Cornell note' });
  }
}

// Update a Cornell note
export async function updateNote(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { title, subject, cues, notes, summary } = req.body;

    const updateData = {
      ...(title && { title }),
      ...(subject !== undefined && { subject }),
      ...(cues && { cues }),
      ...(notes && { notes }),
      ...(summary && { summary }),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('cornell_notes')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Cornell note not found' });
    }

    res.json(data);

  } catch (error) {
    console.error('Error updating Cornell note:', error);
    res.status(500).json({ error: 'Failed to update Cornell note' });
  }
}

// Delete a Cornell note
export async function deleteNote(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from('cornell_notes')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    res.json({ message: 'Cornell note deleted successfully' });

  } catch (error) {
    console.error('Error deleting Cornell note:', error);
    res.status(500).json({ error: 'Failed to delete Cornell note' });
  }
}
