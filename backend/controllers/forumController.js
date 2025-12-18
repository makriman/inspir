import { supabase } from '../utils/supabaseClient.js';

// Get all questions with answers, votes, and user info
export async function getQuestions(req, res) {
  try {
    const { tag } = req.query;

    let query = supabase
      .from('forum_questions')
      .select(`
        *,
        user:users!forum_questions_user_id_fkey(id, username),
        answers:forum_answers(
          *,
          user:users!forum_answers_user_id_fkey(id, username),
          votes:forum_votes(count)
        )
      `)
      .order('created_at', { ascending: false });

    // Filter by tag if provided
    if (tag && tag !== 'All') {
      query = query.contains('tags', [tag]);
    }

    const { data: questions, error } = await query;

    if (error) {
      console.error('Error fetching questions:', error);
      return res.status(500).json({
        error: 'Failed to fetch questions',
        message: error.message
      });
    }

    // Calculate vote counts for each answer
    const questionsWithVoteCounts = questions.map(question => ({
      ...question,
      answers: question.answers.map(answer => ({
        ...answer,
        vote_count: answer.votes?.[0]?.count || 0
      })).sort((a, b) => b.vote_count - a.vote_count) // Sort answers by votes
    }));

    res.json({ questions: questionsWithVoteCounts });
  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({
      error: 'Failed to fetch questions',
      message: error.message
    });
  }
}

// Get a single question with all details
export async function getQuestion(req, res) {
  try {
    const { id } = req.params;

    const { data: question, error } = await supabase
      .from('forum_questions')
      .select(`
        *,
        user:users!forum_questions_user_id_fkey(id, username),
        answers:forum_answers(
          *,
          user:users!forum_answers_user_id_fkey(id, username),
          votes:forum_votes(count)
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching question:', error);
      return res.status(404).json({
        error: 'Question not found'
      });
    }

    // Calculate vote counts for each answer
    const questionWithVoteCounts = {
      ...question,
      answers: question.answers.map(answer => ({
        ...answer,
        vote_count: answer.votes?.[0]?.count || 0
      })).sort((a, b) => b.vote_count - a.vote_count)
    };

    res.json({ question: questionWithVoteCounts });
  } catch (error) {
    console.error('Get question error:', error);
    res.status(500).json({
      error: 'Failed to fetch question',
      message: error.message
    });
  }
}

// Create a new question
export async function createQuestion(req, res) {
  try {
    const { title, details, tags } = req.body;
    const userId = req.user.id;

    if (!title || !details) {
      return res.status(400).json({
        error: 'Title and details are required'
      });
    }

    if (!tags || tags.length === 0) {
      return res.status(400).json({
        error: 'At least one tag is required'
      });
    }

    const { data: question, error } = await supabase
      .from('forum_questions')
      .insert([
        {
          user_id: userId,
          title,
          details,
          tags
        }
      ])
      .select(`
        *,
        user:users!forum_questions_user_id_fkey(id, username)
      `)
      .single();

    if (error) {
      console.error('Error creating question:', error);
      return res.status(500).json({
        error: 'Failed to create question',
        message: error.message
      });
    }

    res.status(201).json({ question: { ...question, answers: [] } });
  } catch (error) {
    console.error('Create question error:', error);
    res.status(500).json({
      error: 'Failed to create question',
      message: error.message
    });
  }
}

// Create an answer to a question
export async function createAnswer(req, res) {
  try {
    const { questionId } = req.params;
    const { text } = req.body;
    const userId = req.user.id;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        error: 'Answer text is required'
      });
    }

    const { data: answer, error } = await supabase
      .from('forum_answers')
      .insert([
        {
          question_id: questionId,
          user_id: userId,
          text: text.trim()
        }
      ])
      .select(`
        *,
        user:users!forum_answers_user_id_fkey(id, username)
      `)
      .single();

    if (error) {
      console.error('Error creating answer:', error);
      return res.status(500).json({
        error: 'Failed to create answer',
        message: error.message
      });
    }

    res.status(201).json({ answer: { ...answer, vote_count: 0 } });
  } catch (error) {
    console.error('Create answer error:', error);
    res.status(500).json({
      error: 'Failed to create answer',
      message: error.message
    });
  }
}

// Upvote an answer
export async function upvoteAnswer(req, res) {
  try {
    const { answerId } = req.params;
    const userId = req.user.id;

    // Check if user already voted
    const { data: existingVote } = await supabase
      .from('forum_votes')
      .select('id')
      .eq('answer_id', answerId)
      .eq('user_id', userId)
      .single();

    if (existingVote) {
      return res.status(400).json({
        error: 'You have already upvoted this answer'
      });
    }

    const { data: vote, error } = await supabase
      .from('forum_votes')
      .insert([
        {
          answer_id: answerId,
          user_id: userId
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Error upvoting answer:', error);
      return res.status(500).json({
        error: 'Failed to upvote answer',
        message: error.message
      });
    }

    res.status(201).json({ vote });
  } catch (error) {
    console.error('Upvote error:', error);
    res.status(500).json({
      error: 'Failed to upvote answer',
      message: error.message
    });
  }
}

// Remove upvote from an answer
export async function removeUpvote(req, res) {
  try {
    const { answerId } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from('forum_votes')
      .delete()
      .eq('answer_id', answerId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error removing upvote:', error);
      return res.status(500).json({
        error: 'Failed to remove upvote',
        message: error.message
      });
    }

    res.json({ message: 'Upvote removed successfully' });
  } catch (error) {
    console.error('Remove upvote error:', error);
    res.status(500).json({
      error: 'Failed to remove upvote',
      message: error.message
    });
  }
}

// Get user reputation leaderboard
export async function getLeaderboard(req, res) {
  try {
    const { data: leaderboard, error } = await supabase
      .from('user_reputation')
      .select(`
        *,
        user:users!user_reputation_user_id_fkey(id, username)
      `)
      .order('reputation', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error fetching leaderboard:', error);
      return res.status(500).json({
        error: 'Failed to fetch leaderboard',
        message: error.message
      });
    }

    res.json({ leaderboard });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({
      error: 'Failed to fetch leaderboard',
      message: error.message
    });
  }
}

// Get current user's reputation
export async function getUserReputation(req, res) {
  try {
    const userId = req.user.id;

    const { data: reputation, error } = await supabase
      .from('user_reputation')
      .select('reputation')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching reputation:', error);
      return res.status(500).json({
        error: 'Failed to fetch reputation',
        message: error.message
      });
    }

    res.json({ reputation: reputation?.reputation || 0 });
  } catch (error) {
    console.error('Get user reputation error:', error);
    res.status(500).json({
      error: 'Failed to fetch reputation',
      message: error.message
    });
  }
}

// Get statistics
export async function getStats(req, res) {
  try {
    const [questionsResult, answersResult, votesResult] = await Promise.all([
      supabase.from('forum_questions').select('id', { count: 'exact', head: true }),
      supabase.from('forum_answers').select('id', { count: 'exact', head: true }),
      supabase.from('forum_votes').select('id', { count: 'exact', head: true })
    ]);

    res.json({
      stats: {
        total_questions: questionsResult.count || 0,
        total_answers: answersResult.count || 0,
        total_upvotes: votesResult.count || 0
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      error: 'Failed to fetch stats',
      message: error.message
    });
  }
}
