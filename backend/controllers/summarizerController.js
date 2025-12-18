import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../config/supabaseClient.js';
import processFile from '../utils/fileProcessor.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const lengthInstructions = {
  short: '2-3 sentences capturing only the most essential points',
  medium: '1 paragraph (5-7 sentences) covering main ideas and key details',
  long: '2-3 paragraphs providing a comprehensive overview with examples and context'
};

export async function generateSummary(req, res) {
  try {
    let { content, length = 'medium', format = 'bullets', includeKeyConcepts = true, title } = req.body;
    const userId = req.user?.id || null;

    // Process file if uploaded
    if (req.file) {
      try {
        content = await processFile(req.file);
      } catch (error) {
        return res.status(400).json({
          error: 'Failed to process file',
          details: error.message
        });
      }
    }

    // Validate content
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (!['short', 'medium', 'long'].includes(length)) {
      return res.status(400).json({ error: 'Invalid summary length' });
    }

    if (!['bullets', 'paragraph'].includes(format)) {
      return res.status(400).json({ error: 'Invalid output format' });
    }

    // Count words in original content
    const originalWordCount = content.trim().split(/\s+/).length;

    // Generate summary with Claude
    const prompt = `Summarize the following content.

Length: ${lengthInstructions[length]}
Format: ${format === 'bullets' ? 'Use bullet points (3-7 bullets). Each bullet should be a complete sentence.' : 'Write in paragraph form with clear, flowing prose.'}
${includeKeyConcepts ? '\nAlso extract 5-8 key concepts/terms as a separate list. These should be important terms, names, or ideas from the content.' : ''}

Content to summarize:
${content}

Return your response as JSON in this exact format:
{
  "summary": ${format === 'bullets' ? '["First key point...", "Second key point...", "Third key point..."]' : '"Your paragraph summary here..."'},
  ${includeKeyConcepts ? '"keyConcepts": ["concept1", "concept2", "concept3"],' : ''}
  "title": "A short, descriptive title for this content (5-8 words)"
}

Important: Return ONLY the JSON object, no additional text.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Parse Claude's response
    let summaryData;
    try {
      const responseText = message.content[0].text;
      // Try to extract JSON if it's wrapped in markdown code blocks
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                       responseText.match(/```\s*([\s\S]*?)\s*```/) ||
                       [null, responseText];
      summaryData = JSON.parse(jsonMatch[1]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      return res.status(500).json({
        error: 'Failed to parse AI response',
        details: 'The AI returned an invalid format'
      });
    }

    // Validate summary data
    if (!summaryData.summary) {
      return res.status(500).json({
        error: 'Invalid AI response',
        details: 'Missing summary in response'
      });
    }

    // Calculate summary word count
    let summaryWordCount;
    if (format === 'bullets' && Array.isArray(summaryData.summary)) {
      summaryWordCount = summaryData.summary.join(' ').trim().split(/\s+/).length;
    } else if (typeof summaryData.summary === 'string') {
      summaryWordCount = summaryData.summary.trim().split(/\s+/).length;
    } else {
      summaryWordCount = 0;
    }

    // Prepare summary for storage
    const summaryText = format === 'bullets'
      ? JSON.stringify(summaryData.summary)
      : summaryData.summary;

    const keyConcepts = includeKeyConcepts && summaryData.keyConcepts
      ? summaryData.keyConcepts
      : [];

    const summaryTitle = title || summaryData.title || 'Untitled Summary';

    // Save to database if user is authenticated
    let savedSummary = null;
    if (userId) {
      const { data, error } = await supabase
        .from('text_summaries')
        .insert({
          user_id: userId,
          title: summaryTitle,
          original_content: content.substring(0, 10000), // Limit stored content
          summary_text: summaryText,
          key_concepts: keyConcepts,
          summary_length: length,
          output_format: format,
          word_count: {
            original: originalWordCount,
            summary: summaryWordCount
          }
        })
        .select()
        .single();

      if (error) {
        console.error('Database error:', error);
        // Continue anyway, return summary even if save failed
      } else {
        savedSummary = data;
      }
    }

    // Return response
    res.json({
      success: true,
      summary: format === 'bullets' ? summaryData.summary : summaryData.summary,
      keyConcepts: keyConcepts,
      title: summaryTitle,
      wordCount: {
        original: originalWordCount,
        summary: summaryWordCount,
        reduction: Math.round((1 - summaryWordCount / originalWordCount) * 100)
      },
      summaryId: savedSummary?.id || null,
      format: format,
      length: length
    });

  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({
      error: 'Failed to generate summary',
      details: error.message
    });
  }
}

export async function getSummaryHistory(req, res) {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('text_summaries')
      .select('id, title, summary_text, key_concepts, summary_length, output_format, word_count, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw error;
    }

    // Parse summary_text for bullets format
    const summaries = data.map(summary => ({
      ...summary,
      summary_text: summary.output_format === 'bullets'
        ? JSON.parse(summary.summary_text)
        : summary.summary_text
    }));

    res.json({
      success: true,
      summaries: summaries
    });

  } catch (error) {
    console.error('Error fetching summary history:', error);
    res.status(500).json({
      error: 'Failed to fetch summary history',
      details: error.message
    });
  }
}

export async function getSummaryById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const { data, error } = await supabase
      .from('text_summaries')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Summary not found' });
    }

    // Check if user owns this summary
    if (data.user_id !== userId && data.user_id !== null) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Parse summary_text if it's bullets format
    if (data.output_format === 'bullets') {
      data.summary_text = JSON.parse(data.summary_text);
    }

    res.json({
      success: true,
      summary: data
    });

  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({
      error: 'Failed to fetch summary',
      details: error.message
    });
  }
}

export async function deleteSummary(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from('text_summaries')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      message: 'Summary deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting summary:', error);
    res.status(500).json({
      error: 'Failed to delete summary',
      details: error.message
    });
  }
}
