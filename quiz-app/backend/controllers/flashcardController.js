import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabaseClient.js';
import processFile from '../utils/fileProcessor.js';
import {
  calculateNextReview,
  getDueCards,
  getNewCards,
  calculateMasteryStats,
  getRecommendedSession
} from '../utils/spacedRepetition.js';
import { v4 as uuidv4 } from 'uuid';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generateFlashcards(req, res) {
  try {
    let { content, deckName, sourceName, cardCount = 10 } = req.body;
    const userId = req.user?.id || null;

    // Process file if uploaded
    if (req.file) {
      try {
        content = await processFile(req.file);
        if (!sourceName) {
          sourceName = req.file.originalname;
        }
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

    // Validate card count
    cardCount = Math.min(Math.max(parseInt(cardCount), 5), 50); // Between 5 and 50

    // Generate flashcards with Claude
    const prompt = `Generate ${cardCount} high-quality flashcards from the following content.

Content:
${content}

Create flashcards with:
1. **Front**: A clear question or prompt (concise, specific, testable)
2. **Back**: Concise answer (2-4 sentences maximum)
3. **Explanation**: Brief context, mnemonic, or additional info (optional, 1 sentence)

Guidelines:
- Focus on key concepts, definitions, and important facts
- Make questions specific and unambiguous
- Avoid yes/no questions
- Use active recall principles
- Include variety (definitions, explanations, applications, comparisons)

Return your response as JSON in this exact format:
{
  "deckTitle": "Suggested deck name (3-6 words)",
  "cards": [
    {
      "front": "Question or prompt text",
      "back": "Answer text",
      "explanation": "Optional context or mnemonic"
    }
  ]
}

Important: Return ONLY the JSON object, no additional text. Generate exactly ${cardCount} cards.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Parse Claude's response
    let flashcardData;
    try {
      const responseText = message.content[0].text;
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                       responseText.match(/```\s*([\s\S]*?)\s*```/) ||
                       [null, responseText];
      flashcardData = JSON.parse(jsonMatch[1]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      return res.status(500).json({
        error: 'Failed to parse AI response',
        details: 'The AI returned an invalid format'
      });
    }

    // Validate flashcard data
    if (!flashcardData.cards || !Array.isArray(flashcardData.cards)) {
      return res.status(500).json({
        error: 'Invalid AI response',
        details: 'Missing cards array'
      });
    }

    // Add unique IDs to each card
    const cardsWithIds = flashcardData.cards.map(card => ({
      ...card,
      id: uuidv4()
    }));

    // Use provided deck name or AI-generated one
    const finalDeckName = deckName || flashcardData.deckTitle || 'Untitled Deck';

    // Save to database if user is authenticated
    let savedDeck = null;
    if (userId) {
      const { data, error } = await supabase
        .from('flashcard_decks')
        .insert({
          user_id: userId,
          deck_name: finalDeckName,
          source_name: sourceName || null,
          description: `Generated from ${sourceName || 'custom content'}`,
          cards: cardsWithIds,
          card_count: cardsWithIds.length
        })
        .select()
        .single();

      if (error) {
        console.error('Database error:', error);
      } else {
        savedDeck = data;
      }
    }

    res.json({
      success: true,
      deck: {
        id: savedDeck?.id || null,
        deckName: finalDeckName,
        sourceName: sourceName,
        cards: cardsWithIds,
        cardCount: cardsWithIds.length
      }
    });

  } catch (error) {
    console.error('Error generating flashcards:', error);
    res.status(500).json({
      error: 'Failed to generate flashcards',
      details: error.message
    });
  }
}

export async function getUserDecks(req, res) {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('flashcard_decks')
      .select('id, deck_name, source_name, description, card_count, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // For each deck, get progress statistics
    const decksWithProgress = await Promise.all(
      data.map(async (deck) => {
        const { data: progressData } = await supabase
          .from('flashcard_progress')
          .select('mastery_level, next_review_at')
          .eq('user_id', userId)
          .eq('deck_id', deck.id);

        const stats = calculateMasteryStats(progressData || []);
        const now = new Date();
        const dueCount = (progressData || []).filter(p =>
          new Date(p.next_review_at) <= now
        ).length;

        return {
          ...deck,
          stats,
          dueCount,
          newCount: deck.card_count - (progressData?.length || 0)
        };
      })
    );

    res.json({
      success: true,
      decks: decksWithProgress
    });

  } catch (error) {
    console.error('Error fetching decks:', error);
    res.status(500).json({
      error: 'Failed to fetch decks',
      details: error.message
    });
  }
}

export async function getDeckById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const { data, error } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    // Check access permissions
    if (data.user_id !== userId && !data.is_shared) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get progress if user is authenticated
    let progress = null;
    let stats = null;
    if (userId) {
      const { data: progressData } = await supabase
        .from('flashcard_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('deck_id', id);

      progress = progressData;
      stats = calculateMasteryStats(progressData || []);
    }

    res.json({
      success: true,
      deck: data,
      progress,
      stats
    });

  } catch (error) {
    console.error('Error fetching deck:', error);
    res.status(500).json({
      error: 'Failed to fetch deck',
      details: error.message
    });
  }
}

export async function getStudySession(req, res) {
  try {
    const { id } = req.params; // deck ID
    const userId = req.user.id;
    const { mode = 'flip', maxCards = 25 } = req.query;

    // Get deck
    const { data: deck, error: deckError } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', id)
      .single();

    if (deckError || !deck) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    // Check access
    if (deck.user_id !== userId && !deck.is_shared) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get user's progress for this deck
    const { data: progressData } = await supabase
      .from('flashcard_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('deck_id', id);

    const allCardIds = deck.cards.map(c => c.id);

    // Get due cards and new cards
    const dueCardIds = getDueCards(progressData || [], maxCards);
    const newCardIds = getNewCards(
      allCardIds,
      progressData || [],
      Math.max(0, maxCards - dueCardIds.length)
    );

    // Combine and shuffle
    const sessionCardIds = [...dueCardIds, ...newCardIds];

    // Get actual card data
    const sessionCards = deck.cards.filter(card =>
      sessionCardIds.includes(card.id)
    );

    // Get progress for each card
    const cardsWithProgress = sessionCards.map(card => {
      const cardProgress = (progressData || []).find(p => p.card_id === card.id);
      return {
        ...card,
        progress: cardProgress || null,
        isNew: !cardProgress
      };
    });

    // Shuffle cards (Fisher-Yates algorithm)
    for (let i = cardsWithProgress.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cardsWithProgress[i], cardsWithProgress[j]] = [cardsWithProgress[j], cardsWithProgress[i]];
    }

    const stats = calculateMasteryStats(progressData || []);
    const recommendation = getRecommendedSession(
      deck.card_count,
      newCardIds.length,
      dueCardIds.length
    );

    res.json({
      success: true,
      session: {
        deckId: deck.id,
        deckName: deck.deck_name,
        mode,
        cards: cardsWithProgress,
        totalCards: sessionCards.length,
        dueCards: dueCardIds.length,
        newCards: newCardIds.length
      },
      stats,
      recommendation
    });

  } catch (error) {
    console.error('Error creating study session:', error);
    res.status(500).json({
      error: 'Failed to create study session',
      details: error.message
    });
  }
}

export async function recordStudyProgress(req, res) {
  try {
    const { id } = req.params; // deck ID
    const userId = req.user.id;
    const { results, mode, durationSeconds } = req.body;

    // Validate results
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'Results array is required' });
    }

    // Process each card result and update progress
    const updates = [];
    let correctCount = 0;

    for (const result of results) {
      const { cardId, quality, correct } = result;

      if (quality < 0 || quality > 5) {
        continue;
      }

      if (correct) correctCount++;

      // Get current progress or create new
      const { data: existingProgress } = await supabase
        .from('flashcard_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('deck_id', id)
        .eq('card_id', cardId)
        .single();

      // Calculate next review using SM-2 algorithm
      const newProgress = calculateNextReview(quality, existingProgress || {});

      if (existingProgress) {
        // Update existing progress
        await supabase
          .from('flashcard_progress')
          .update({
            mastery_level: newProgress.masteryLevel,
            ease_factor: newProgress.easeFactor,
            interval_days: newProgress.intervalDays,
            review_count: newProgress.reviewCount,
            correct_count: existingProgress.correct_count + (correct ? 1 : 0),
            last_reviewed_at: newProgress.lastReviewedAt,
            next_review_at: newProgress.nextReviewAt
          })
          .eq('id', existingProgress.id);
      } else {
        // Create new progress entry
        await supabase
          .from('flashcard_progress')
          .insert({
            user_id: userId,
            deck_id: id,
            card_id: cardId,
            mastery_level: newProgress.masteryLevel,
            ease_factor: newProgress.easeFactor,
            interval_days: newProgress.intervalDays,
            review_count: newProgress.reviewCount,
            correct_count: correct ? 1 : 0,
            last_reviewed_at: newProgress.lastReviewedAt,
            next_review_at: newProgress.nextReviewAt
          });
      }

      updates.push({
        cardId,
        ...newProgress
      });
    }

    // Record session
    await supabase
      .from('flashcard_sessions')
      .insert({
        user_id: userId,
        deck_id: id,
        study_mode: mode,
        cards_studied: results.length,
        cards_correct: correctCount,
        duration_seconds: durationSeconds,
        session_data: results
      });

    // Get updated stats
    const { data: allProgress } = await supabase
      .from('flashcard_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('deck_id', id);

    const stats = calculateMasteryStats(allProgress || []);

    res.json({
      success: true,
      updates,
      stats,
      summary: {
        cardsStudied: results.length,
        cardsCorrect: correctCount,
        accuracy: Math.round((correctCount / results.length) * 100)
      }
    });

  } catch (error) {
    console.error('Error recording progress:', error);
    res.status(500).json({
      error: 'Failed to record progress',
      details: error.message
    });
  }
}

export async function shareDeck(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const { data: deck, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('user_id, is_shared, share_token')
      .eq('id', id)
      .single();

    if (fetchError || !deck) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    if (deck.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // If already shared, return existing token
    if (deck.is_shared && deck.share_token) {
      return res.json({
        success: true,
        shareUrl: `${process.env.FRONTEND_URL || 'https://quiz.inspir.uk'}/shared/flashcards/${deck.share_token}`,
        shareToken: deck.share_token
      });
    }

    // Generate share token
    const shareToken = uuidv4();

    await supabase
      .from('flashcard_decks')
      .update({
        is_shared: true,
        share_token: shareToken
      })
      .eq('id', id);

    res.json({
      success: true,
      shareUrl: `${process.env.FRONTEND_URL || 'https://quiz.inspir.uk'}/shared/flashcards/${shareToken}`,
      shareToken
    });

  } catch (error) {
    console.error('Error sharing deck:', error);
    res.status(500).json({
      error: 'Failed to share deck',
      details: error.message
    });
  }
}

export async function deleteDeck(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from('flashcard_decks')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      message: 'Deck deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting deck:', error);
    res.status(500).json({
      error: 'Failed to delete deck',
      details: error.message
    });
  }
}

export async function getSharedDeck(req, res) {
  try {
    const { token } = req.params;

    const { data, error } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('share_token', token)
      .eq('is_shared', true)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Deck not found or not shared' });
    }

    res.json({
      success: true,
      deck: data
    });

  } catch (error) {
    console.error('Error fetching shared deck:', error);
    res.status(500).json({
      error: 'Failed to fetch deck',
      details: error.message
    });
  }
}
