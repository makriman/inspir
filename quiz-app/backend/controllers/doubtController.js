import { supabase } from '../utils/supabaseClient.js';
import { extractTextFromImage, generateDoubtSolution } from '../utils/claudeClient.js';
import crypto from 'crypto';

// Upload image and extract text using Claude Vision API
export async function uploadAndExtractImage(req, res) {
  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    // Validate image size (max 10MB)
    const sizeInBytes = Buffer.from(imageBase64.split(',')[1] || imageBase64, 'base64').length;
    const sizeInMB = sizeInBytes / (1024 * 1024);

    if (sizeInMB > 10) {
      return res.status(400).json({ error: 'Image size must be less than 10MB' });
    }

    // Extract text from image using Claude Vision API
    const { extractedText, detectedSubject, confidence } = await extractTextFromImage(imageBase64);

    res.json({
      extracted_text: extractedText,
      detected_subject: detectedSubject,
      confidence: confidence
    });

  } catch (error) {
    console.error('Error extracting text from image:', error);
    res.status(500).json({ error: 'Failed to extract text from image' });
  }
}

// Solve a doubt question
export async function solveDoubt(req, res) {
  try {
    const { question_text, subject, source_type, image_url, extracted_text } = req.body;
    const userId = req.user?.id || null;

    if (!question_text || question_text.trim().length < 5) {
      return res.status(400).json({
        error: 'Question must be at least 5 characters long'
      });
    }

    // Generate solution using Claude API
    const solutionData = await generateDoubtSolution(question_text, subject);

    // Save to database
    const { data, error } = await supabase
      .from('doubt_questions')
      .insert({
        user_id: userId,
        question_text: question_text,
        subject: subject || null,
        source_type: source_type || 'text',
        image_url: image_url || null,
        extracted_text: extracted_text || null,
        solution_text: solutionData.solution,
        solution_steps: solutionData.steps,
        key_concepts: solutionData.key_concepts,
        estimated_difficulty: solutionData.difficulty,
        is_public: false // Default to private
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving doubt:', error);
      return res.json({
        ...solutionData,
        saved: false,
        error: 'Solution generated but not saved'
      });
    }

    res.json({
      ...solutionData,
      saved: true,
      doubtId: data.id,
      data: data
    });

  } catch (error) {
    console.error('Error solving doubt:', error);
    res.status(500).json({ error: 'Failed to solve doubt' });
  }
}

// Get user's doubt history
export async function getDoubtHistory(req, res) {
  try {
    const userId = req.user.id;
    const { subject, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('doubt_questions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (subject && subject !== 'all') {
      query = query.eq('subject', subject);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    res.json({
      doubts: data,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Error fetching doubt history:', error);
    res.status(500).json({ error: 'Failed to fetch doubt history' });
  }
}

// Get a specific doubt
export async function getDoubt(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    let query = supabase
      .from('doubt_questions')
      .select('*')
      .eq('id', id);

    // If user is authenticated, only show their own doubts
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Doubt not found' });
    }

    res.json(data);

  } catch (error) {
    console.error('Error fetching doubt:', error);
    res.status(500).json({ error: 'Failed to fetch doubt' });
  }
}

// Update a doubt
export async function updateDoubt(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { is_public } = req.body;

    const updateData = {
      ...(is_public !== undefined && { is_public }),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('doubt_questions')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Doubt not found' });
    }

    res.json(data);

  } catch (error) {
    console.error('Error updating doubt:', error);
    res.status(500).json({ error: 'Failed to update doubt' });
  }
}

// Delete a doubt
export async function deleteDoubt(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from('doubt_questions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    res.json({ message: 'Doubt deleted successfully' });

  } catch (error) {
    console.error('Error deleting doubt:', error);
    res.status(500).json({ error: 'Failed to delete doubt' });
  }
}

// Get recent public solutions
export async function getRecentSolutions(req, res) {
  try {
    const { limit = 10 } = req.query;

    const { data, error } = await supabase
      .from('doubt_questions')
      .select('id, question_text, subject, created_at, estimated_difficulty')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) {
      throw error;
    }

    res.json({
      solutions: data || []
    });

  } catch (error) {
    console.error('Error fetching recent solutions:', error);
    res.status(500).json({ error: 'Failed to fetch recent solutions' });
  }
}

// Create a shareable link for a doubt
export async function createShare(req, res) {
  try {
    const { doubtId } = req.params;
    const userId = req.user.id;

    // Verify the doubt belongs to the user
    const { data: doubt, error: doubtError } = await supabase
      .from('doubt_questions')
      .select('id')
      .eq('id', doubtId)
      .eq('user_id', userId)
      .single();

    if (doubtError || !doubt) {
      return res.status(404).json({ error: 'Doubt not found' });
    }

    // Generate a unique share token
    const shareToken = crypto.randomBytes(6).toString('hex');

    const { data, error } = await supabase
      .from('doubt_shares')
      .insert({
        doubt_id: doubtId,
        share_token: shareToken
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    const shareUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/doubt/shared/${shareToken}`;

    res.json({
      share_token: shareToken,
      share_url: shareUrl,
      data: data
    });

  } catch (error) {
    console.error('Error creating share:', error);
    res.status(500).json({ error: 'Failed to create share' });
  }
}

// Get a shared doubt by token
export async function getSharedDoubt(req, res) {
  try {
    const { shareToken } = req.params;

    // Find the share record
    const { data: share, error: shareError } = await supabase
      .from('doubt_shares')
      .select('doubt_id')
      .eq('share_token', shareToken)
      .single();

    if (shareError || !share) {
      return res.status(404).json({ error: 'Shared doubt not found' });
    }

    // Get the doubt
    const { data: doubt, error: doubtError } = await supabase
      .from('doubt_questions')
      .select('*')
      .eq('id', share.doubt_id)
      .single();

    if (doubtError || !doubt) {
      return res.status(404).json({ error: 'Doubt not found' });
    }

    // Increment views count
    await supabase
      .from('doubt_shares')
      .update({ views_count: (share.views_count || 0) + 1 })
      .eq('share_token', shareToken);

    await supabase
      .from('doubt_questions')
      .update({ views_count: (doubt.views_count || 0) + 1 })
      .eq('id', share.doubt_id);

    res.json(doubt);

  } catch (error) {
    console.error('Error fetching shared doubt:', error);
    res.status(500).json({ error: 'Failed to fetch shared doubt' });
  }
}
