import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabaseClient.js';
import { processFile } from '../utils/fileProcessor.js';
import { v4 as uuidv4 } from 'uuid';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generateStudyGuide(req, res) {
  try {
    let { content, title, subject } = req.body;
    const userId = req.user?.id || null;
    const sourceMaterials = [];

    // Process uploaded files
    if (req.files && req.files.length > 0) {
      let combinedContent = '';

      for (const file of req.files) {
        try {
          const fileContent = await processFile(file);
          combinedContent += `\n\n--- ${file.originalname} ---\n\n${fileContent}`;
          sourceMaterials.push(file.originalname);
        } catch (error) {
          console.error(`Error processing file ${file.originalname}:`, error);
        }
      }

      content = combinedContent;
    }

    // Validate content
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Generate study guide with Claude (multi-step process)
    const prompt = `Create a comprehensive study guide from the following material.

Material:
${content}

Generate a structured study guide with the following sections:

1. **Overview** (2-3 sentences summarizing the main topic and its importance)

2. **Key Concepts** (5-10 main concepts, each with a brief 1-sentence description)

3. **Detailed Definitions** (Define each key concept in detail, 2-3 sentences each)

4. **Examples & Applications** (Provide 3-5 real-world examples or applications of the concepts)

5. **Practice Questions** (Generate 5-10 practice questions of varying difficulty - mix of multiple choice, short answer, and discussion questions)

6. **Summary** (2-3 paragraphs reviewing the main points and how they connect)

Return your response as JSON in this exact format:
{
  "title": "Suggested title for the study guide (5-10 words)",
  "subject": "Subject area (e.g., Biology, History, Mathematics)",
  "overview": "Brief overview text...",
  "keyConcepts": [
    {
      "concept": "Concept name",
      "description": "Brief description..."
    }
  ],
  "definitions": [
    {
      "term": "Term name",
      "definition": "Detailed definition..."
    }
  ],
  "examples": [
    {
      "title": "Example title",
      "description": "Example description..."
    }
  ],
  "questions": [
    {
      "type": "multiple_choice" | "short_answer" | "discussion",
      "question": "Question text...",
      "options": ["A", "B", "C", "D"], // only for multiple_choice
      "answer": "Correct answer or sample answer"
    }
  ],
  "summary": "Summary text in 2-3 paragraphs..."
}

Important: Return ONLY the JSON object, no additional text.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Parse Claude's response
    let guideData;
    try {
      const responseText = message.content[0].text;
      // Try to extract JSON if it's wrapped in markdown code blocks
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
        responseText.match(/```\s*([\s\S]*?)\s*```/) ||
        [null, responseText];
      guideData = JSON.parse(jsonMatch[1]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      return res.status(500).json({
        error: 'Failed to parse AI response',
        details: 'The AI returned an invalid format'
      });
    }

    // Validate guide data
    if (!guideData.overview || !guideData.keyConcepts || !guideData.summary) {
      return res.status(500).json({
        error: 'Invalid AI response',
        details: 'Missing required sections in study guide'
      });
    }

    // Calculate word count
    const wordCount = JSON.stringify(guideData).split(/\s+/).length;

    // Use provided title/subject or AI-generated ones
    const guideTitle = title || guideData.title || 'Study Guide';
    const guideSubject = subject || guideData.subject || 'General';

    // Save to database if user is authenticated
    let savedGuide = null;
    if (userId) {
      const { data, error } = await supabase
        .from('study_guides')
        .insert({
          user_id: userId,
          title: guideTitle,
          subject: guideSubject,
          source_materials: sourceMaterials.length > 0 ? sourceMaterials : null,
          structure: guideData,
          word_count: wordCount,
          is_editable: true
        })
        .select()
        .single();

      if (error) {
        console.error('Database error:', error);
        // Continue anyway, return guide even if save failed
      } else {
        savedGuide = data;
      }
    }

    // Return response
    res.json({
      success: true,
      guide: {
        id: savedGuide?.id || null,
        title: guideTitle,
        subject: guideSubject,
        sourceMaterials: sourceMaterials,
        ...guideData,
        wordCount: wordCount
      }
    });

  } catch (error) {
    console.error('Error generating study guide:', error);
    res.status(500).json({
      error: 'Failed to generate study guide',
      details: error.message
    });
  }
}

export async function getStudyGuides(req, res) {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('study_guides')
      .select('id, title, subject, source_materials, word_count, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      guides: data
    });

  } catch (error) {
    console.error('Error fetching study guides:', error);
    res.status(500).json({
      error: 'Failed to fetch study guides',
      details: error.message
    });
  }
}

export async function getStudyGuideById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const { data, error } = await supabase
      .from('study_guides')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Study guide not found' });
    }

    // Check access permissions
    if (data.user_id !== userId && !data.is_shared) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      success: true,
      guide: data
    });

  } catch (error) {
    console.error('Error fetching study guide:', error);
    res.status(500).json({
      error: 'Failed to fetch study guide',
      details: error.message
    });
  }
}

export async function updateStudyGuide(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { title, subject, structure } = req.body;

    // Verify ownership
    const { data: existingGuide, error: fetchError } = await supabase
      .from('study_guides')
      .select('user_id, is_editable')
      .eq('id', id)
      .single();

    if (fetchError || !existingGuide) {
      return res.status(404).json({ error: 'Study guide not found' });
    }

    if (existingGuide.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!existingGuide.is_editable) {
      return res.status(400).json({ error: 'This study guide is not editable' });
    }

    // Update study guide
    const updates = {};
    if (title) updates.title = title;
    if (subject) updates.subject = subject;
    if (structure) {
      updates.structure = structure;
      updates.word_count = JSON.stringify(structure).split(/\s+/).length;
    }

    const { data, error } = await supabase
      .from('study_guides')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      guide: data
    });

  } catch (error) {
    console.error('Error updating study guide:', error);
    res.status(500).json({
      error: 'Failed to update study guide',
      details: error.message
    });
  }
}

export async function shareStudyGuide(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const { data: existingGuide, error: fetchError } = await supabase
      .from('study_guides')
      .select('user_id, is_shared, share_token')
      .eq('id', id)
      .single();

    if (fetchError || !existingGuide) {
      return res.status(404).json({ error: 'Study guide not found' });
    }

    if (existingGuide.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // If already shared, return existing token
    if (existingGuide.is_shared && existingGuide.share_token) {
      return res.json({
        success: true,
        shareUrl: `${process.env.FRONTEND_URL || 'https://quiz.inspir.uk'}/shared/study-guide/${existingGuide.share_token}`,
        shareToken: existingGuide.share_token
      });
    }

    // Generate share token and enable sharing
    const shareToken = uuidv4();

    const { data, error } = await supabase
      .from('study_guides')
      .update({
        is_shared: true,
        share_token: shareToken
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      shareUrl: `${process.env.FRONTEND_URL || 'https://quiz.inspir.uk'}/shared/study-guide/${shareToken}`,
      shareToken: shareToken
    });

  } catch (error) {
    console.error('Error sharing study guide:', error);
    res.status(500).json({
      error: 'Failed to share study guide',
      details: error.message
    });
  }
}

export async function deleteStudyGuide(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from('study_guides')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      message: 'Study guide deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting study guide:', error);
    res.status(500).json({
      error: 'Failed to delete study guide',
      details: error.message
    });
  }
}

export async function getSharedStudyGuide(req, res) {
  try {
    const { token } = req.params;

    const { data, error } = await supabase
      .from('study_guides')
      .select('*')
      .eq('share_token', token)
      .eq('is_shared', true)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Study guide not found or not shared' });
    }

    res.json({
      success: true,
      guide: data
    });

  } catch (error) {
    console.error('Error fetching shared study guide:', error);
    res.status(500).json({
      error: 'Failed to fetch study guide',
      details: error.message
    });
  }
}
