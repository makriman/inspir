import { processFile } from '../utils/fileProcessor.js';
import { generateQuiz, scoreQuiz } from '../utils/claudeClient.js';
import { supabase } from '../utils/supabaseClient.js';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { logAuditEvent, AuditEventTypes, AuditActions, AuditStatus } from '../utils/auditLogger.js';
import { sanitizeSourceName, sanitizeContent, sanitizeAttemptName, sanitizeAnswers } from '../utils/sanitizer.js';

export async function createQuiz(req, res) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  try {
    const { content, sourceName } = req.body;
    const userId = req.user?.id;

    console.log('[Quiz] Generate start', {
      requestId,
      userId: userId || 'guest',
      hasFile: !!req.file,
      contentChars: typeof content === 'string' ? content.length : 0
    });

    // Sanitize inputs
    const sanitizedSourceName = sanitizeSourceName(sourceName);
    let textContent = content;
    const uploadedFilePath = req.file?.path;

    try {
      // If file was uploaded, process it
      if (req.file) {
        textContent = await processFile(req.file);
      }
    } finally {
      // Always clean up uploaded file (even if processing fails)
      if (uploadedFilePath) {
        await fs.unlink(uploadedFilePath).catch(() => {});
      }
    }

    // Sanitize content
    if (textContent) {
      try {
        textContent = sanitizeContent(textContent);
      } catch (error) {
        return res.status(400).json({
          error: error.message
        });
      }
    }

    // If no content provided, use the topic name as the basis for quiz generation
    if (!textContent || textContent.trim().length === 0) {
      if (!sanitizedSourceName || sanitizedSourceName === 'Untitled Quiz') {
        return res.status(400).json({
          error: 'Please provide either a topic or content for quiz generation.'
        });
      }
      // Use topic as the content - AI will generate questions based on general knowledge
      textContent = `Topic: ${sanitizedSourceName}`;
    }

    // Generate quiz using Claude
    const llmStartedAt = Date.now();
    const quizData = await generateQuiz(textContent, sanitizedSourceName);
    console.log('[Quiz] Generate completed', {
      requestId,
      durationMs: Date.now() - llmStartedAt,
      questionCount: Array.isArray(quizData?.questions) ? quizData.questions.length : null
    });

    // Save quiz to database if user is logged in
    if (userId) {
      const username = req.user?.username || 'Anonymous';
      const { data: savedQuiz, error } = await supabase
        .from('quizzes')
        .insert([
          {
            user_id: userId,
            source_name: sanitizedSourceName,
            questions: quizData.questions,
            created_by_username: username,
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (error) {
        console.error('Error saving quiz:', error);
      } else {
        quizData.quizId = savedQuiz.id;

        // Log quiz creation
        await logAuditEvent({
          eventType: AuditEventTypes.QUIZ_CREATED,
          action: AuditActions.CREATE,
          status: AuditStatus.SUCCESS,
          req,
          userId: userId,
          username: username,
          resourceType: 'quiz',
          resourceId: savedQuiz.id,
          details: {
            sourceName: sanitizedSourceName,
            questionCount: quizData.questions.length,
            hasFile: !!req.file
          }
        });
      }
    }

    res.json(quizData);
  } catch (error) {
    console.error('[Quiz] Generate failed', {
      requestId,
      durationMs: Date.now() - startedAt,
      message: error?.message,
      causeName: error?.cause?.name
    });
    console.error('Error creating quiz:', error);

    // Log quiz creation failure
    await logAuditEvent({
      eventType: AuditEventTypes.QUIZ_CREATED,
      action: AuditActions.CREATE,
      status: AuditStatus.FAILURE,
      req,
      userId: req.user?.id,
      username: req.user?.username,
      errorMessage: error.message
    });

    const causeName = error?.cause?.name;
    const isTimeout =
      causeName === 'APIConnectionTimeoutError' ||
      causeName === 'AbortError' ||
      /timeout/i.test(error?.message || '');

    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? 'Quiz generation timed out' : 'Failed to create quiz',
      message: error.message
    });
  }
}

export async function submitQuiz(req, res) {
  try {
    const { quizId, questions, answers } = req.body;
    const userId = req.user?.id;

    if (!questions || !answers || questions.length !== answers.length) {
      return res.status(400).json({
        error: 'Invalid submission data'
      });
    }

    // Score the quiz
    const scoringResult = await scoreQuiz(questions, answers);

    // Save result to database if user is logged in
    if (userId && quizId) {
      // Save to quiz_results (legacy)
      const { error } = await supabase
        .from('quiz_results')
        .insert([
          {
            user_id: userId,
            quiz_id: quizId,
            score: scoringResult.score,
            total_questions: scoringResult.totalQuestions,
            percentage: scoringResult.percentage,
            answers: scoringResult.results,
            submitted_at: new Date().toISOString()
          }
        ]);

      if (error) {
        console.error('Error saving quiz result:', error);
      }

      // Also save to quiz_attempts for tracking
      // Get username for attempt_name
      const { data: userData } = await supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .single();

      const attemptName = userData?.username || 'User';

      const { error: attemptError } = await supabase
        .from('quiz_attempts')
        .insert([
          {
            quiz_id: quizId,
            user_id: userId,
            attempt_name: attemptName,
            is_guest: false,
            score: scoringResult.score,
            total_questions: scoringResult.totalQuestions,
            percentage: scoringResult.percentage,
            answers: scoringResult.results,
            completed_at: new Date().toISOString()
          }
        ]);

      if (attemptError) {
        console.error('Error saving quiz attempt:', attemptError);
      }
    }

    res.json(scoringResult);
  } catch (error) {
    console.error('Error submitting quiz:', error);
    res.status(500).json({
      error: 'Failed to submit quiz',
      message: error.message
    });
  }
}

export async function getQuizHistory(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    // Get all quizzes and results for the user
    const { data: results, error } = await supabase
      .from('quiz_results')
      .select(`
        *,
        quizzes (
          id,
          source_name,
          created_at
        )
      `)
      .eq('user_id', userId)
      .order('submitted_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json(results);
  } catch (error) {
    console.error('Error getting quiz history:', error);
    res.status(500).json({
      error: 'Failed to get quiz history',
      message: error.message
    });
  }
}

export async function getQuizById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const { data: quiz, error } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Database error fetching quiz:', error.message);
      throw error;
    }

    if (!quiz) {
      return res.status(404).json({
        error: 'Quiz not found'
      });
    }

    // Check if user owns this quiz
    if (userId && quiz.user_id !== userId) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }

    res.json(quiz);
  } catch (error) {
    console.error('Error getting quiz:', error.message);
    res.status(500).json({
      error: 'Failed to get quiz',
      message: error.message
    });
  }
}

// Share a quiz - generates a unique token for sharing
export async function shareQuiz(req, res) {
  try {
    const { quizId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    // Get the quiz to verify ownership
    const { data: quiz, error: fetchError } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', quizId)
      .single();

    if (fetchError) {
      console.error('Database error fetching quiz:', fetchError.message);
      return res.status(404).json({
        error: 'Quiz not found',
        details: fetchError.message
      });
    }

    if (!quiz) {
      return res.status(404).json({
        error: 'Quiz not found'
      });
    }

    // Verify ownership
    if (quiz.user_id !== userId) {
      return res.status(403).json({
        error: 'You can only share your own quizzes'
      });
    }

    // If already shared, return existing token
    if (quiz.is_shared && quiz.share_token) {
      const shareUrl = `${process.env.FRONTEND_URL || 'https://quiz.inspir.uk'}/shared/${quiz.share_token}`;
      return res.json({
        shareToken: quiz.share_token,
        shareUrl
      });
    }

    // Generate new share token
    const shareToken = randomUUID();

    // Update quiz with share token
    const { data: updatedQuiz, error: updateError } = await supabase
      .from('quizzes')
      .update({
        share_token: shareToken,
        is_shared: true
      })
      .eq('id', quizId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating quiz with share token:', updateError.message);
      throw updateError;
    }

    const shareUrl = `${process.env.FRONTEND_URL || 'https://quiz.inspir.uk'}/shared/${updatedQuiz.share_token}`;

    // Log quiz sharing
    await logAuditEvent({
      eventType: AuditEventTypes.QUIZ_SHARED,
      action: AuditActions.SHARE,
      status: AuditStatus.SUCCESS,
      req,
      userId: userId,
      username: req.user?.username,
      resourceType: 'quiz',
      resourceId: quizId,
      details: {
        shareToken: updatedQuiz.share_token,
        isNewShare: !quiz.is_shared
      }
    });

    res.json({
      shareToken: updatedQuiz.share_token,
      shareUrl
    });
  } catch (error) {
    console.error('Error sharing quiz:', error.message);

    // Log sharing failure
    await logAuditEvent({
      eventType: AuditEventTypes.QUIZ_SHARED,
      action: AuditActions.SHARE,
      status: AuditStatus.FAILURE,
      req,
      userId: req.user?.id,
      username: req.user?.username,
      resourceType: 'quiz',
      resourceId: req.params?.quizId,
      errorMessage: error.message
    });

    res.status(500).json({
      error: 'Failed to share quiz',
      message: error.message
    });
  }
}

// Get a shared quiz by share token (public endpoint)
export async function getSharedQuiz(req, res) {
  try {
    const { shareToken } = req.params;

    const { data: quiz, error } = await supabase
      .from('quizzes')
      .select('id, source_name, questions, created_by_username, created_at, is_shared, share_token')
      .eq('share_token', shareToken)
      .eq('is_shared', true)
      .single();

    if (error) {
      console.error('Database error fetching shared quiz:', error.message);
      return res.status(404).json({
        error: 'Shared quiz not found or no longer available',
        details: error.message
      });
    }

    if (!quiz) {
      return res.status(404).json({
        error: 'Shared quiz not found or no longer available'
      });
    }

    res.json({
      quizId: quiz.id,
      sourceName: quiz.source_name,
      questions: quiz.questions,
      createdBy: quiz.created_by_username || 'Anonymous',
      createdAt: quiz.created_at
    });
  } catch (error) {
    console.error('Error getting shared quiz:', error.message);
    res.status(500).json({
      error: 'Failed to get shared quiz',
      message: error.message
    });
  }
}

// Submit a shared quiz attempt (public endpoint)
export async function submitSharedQuiz(req, res) {
  try {
    const { shareToken } = req.params;
    const { questions, answers, attemptName, isGuest } = req.body;
    const userId = req.user?.id;

    // Sanitize and validate attempt name
    let sanitizedAttemptName;
    try {
      sanitizedAttemptName = sanitizeAttemptName(attemptName);
    } catch (error) {
      return res.status(400).json({
        error: error.message
      });
    }

    if (!questions || !answers || questions.length !== answers.length) {
      return res.status(400).json({
        error: 'Invalid submission data'
      });
    }

    // Sanitize answers
    let sanitizedAnswers;
    try {
      sanitizedAnswers = sanitizeAnswers(answers);
    } catch (error) {
      return res.status(400).json({
        error: error.message
      });
    }

    // Get the quiz by share token
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('id, is_shared')
      .eq('share_token', shareToken)
      .single();

    if (quizError || !quiz || !quiz.is_shared) {
      return res.status(404).json({
        error: 'Shared quiz not found or no longer available'
      });
    }

    // Score the quiz (use sanitized answers)
    const scoringResult = await scoreQuiz(questions, sanitizedAnswers);

    // Save attempt to quiz_attempts table
    const { error: attemptError } = await supabase
      .from('quiz_attempts')
      .insert([
        {
          quiz_id: quiz.id,
          user_id: userId || null,
          attempt_name: sanitizedAttemptName,
          is_guest: isGuest || false,
          score: scoringResult.score,
          total_questions: scoringResult.totalQuestions,
          percentage: scoringResult.percentage,
          answers: scoringResult.results,
          completed_at: new Date().toISOString()
        }
      ]);

    if (attemptError) {
      console.error('Error saving quiz attempt:', attemptError);
    }

    res.json(scoringResult);
  } catch (error) {
    console.error('Error submitting shared quiz:', error);
    res.status(500).json({
      error: 'Failed to submit quiz',
      message: error.message
    });
  }
}

// Get all attempts for a quiz (only for quiz creator)
export async function getQuizAttempts(req, res) {
  try {
    const { quizId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    // Verify quiz ownership
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('id, user_id, source_name, is_shared')
      .eq('id', quizId)
      .single();

    if (quizError || !quiz) {
      return res.status(404).json({
        error: 'Quiz not found'
      });
    }

    if (quiz.user_id !== userId) {
      return res.status(403).json({
        error: 'You can only view attempts for your own quizzes'
      });
    }

    // Get all attempts for this quiz
    const { data: attempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('quiz_id', quizId)
      .order('completed_at', { ascending: false });

    if (attemptsError) {
      throw attemptsError;
    }

    // Calculate statistics
    const stats = {
      totalAttempts: attempts.length,
      averageScore: attempts.length > 0 ? (attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length).toFixed(1) : 0,
      averagePercentage: attempts.length > 0 ? Math.round(attempts.reduce((sum, a) => sum + a.percentage, 0) / attempts.length) : 0,
      highestScore: attempts.length > 0 ? Math.max(...attempts.map(a => a.score)) : 0,
      lowestScore: attempts.length > 0 ? Math.min(...attempts.map(a => a.score)) : 0,
      highestPercentage: attempts.length > 0 ? Math.max(...attempts.map(a => a.percentage)) : 0,
      lowestPercentage: attempts.length > 0 ? Math.min(...attempts.map(a => a.percentage)) : 0
    };

    res.json({
      quizInfo: {
        id: quiz.id,
        sourceName: quiz.source_name,
        isShared: quiz.is_shared
      },
      stats,
      attempts: attempts.map(attempt => ({
        id: attempt.id,
        attemptName: attempt.attempt_name,
        isGuest: attempt.is_guest,
        score: attempt.score,
        totalQuestions: attempt.total_questions,
        percentage: attempt.percentage,
        completedAt: attempt.completed_at,
        answers: attempt.answers
      }))
    });
  } catch (error) {
    console.error('Error getting quiz attempts:', error);
    res.status(500).json({
      error: 'Failed to get quiz attempts',
      message: error.message
    });
  }
}
