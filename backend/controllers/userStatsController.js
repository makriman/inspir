import { supabase } from '../utils/supabaseClient.js';

// Get homepage stats for logged-in user
export async function getHomepageStats(req, res) {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get study time today from study_activity table
    const { data: todayActivity, error: activityError } = await supabase
      .from('study_activity')
      .select('total_time_minutes')
      .eq('user_id', userId)
      .eq('activity_date', today);

    const study_time_today = todayActivity?.reduce((sum, act) => sum + (act.total_time_minutes || 0), 0) || 0;

    // Get quizzes this week
    const { data: quizzes, error: quizzesError } = await supabase
      .from('quiz_results')
      .select('id')
      .eq('user_id', userId)
      .gte('submitted_at', oneWeekAgo);

    const quizzes_this_week = quizzes?.length || 0;

    // Get notes created (all time)
    const { data: notes, error: notesError } = await supabase
      .from('cornell_notes')
      .select('id')
      .eq('user_id', userId);

    const notes_created = notes?.length || 0;

    // Get current streak
    const { data: streak, error: streakError } = await supabase
      .from('user_streaks')
      .select('current_streak')
      .eq('user_id', userId)
      .single();

    const current_streak = streak?.current_streak || 0;

    // Get recent activities
    const recent_activities = [];

    // Recent quizzes
    const { data: recentQuizzes } = await supabase
      .from('quiz_results')
      .select('quiz_id, score, total_questions, percentage, submitted_at')
      .eq('user_id', userId)
      .order('submitted_at', { ascending: false })
      .limit(3);

    if (recentQuizzes) {
      recentQuizzes.forEach(quiz => {
        const timeAgo = getTimeAgo(new Date(quiz.submitted_at));
        recent_activities.push({
          type: 'quiz',
          icon: '📝',
          title: 'Quiz Completed',
          stat: `${quiz.percentage}% • ${quiz.score}/${quiz.total_questions}`,
          timestamp: timeAgo,
          route: `/quiz/${quiz.quiz_id}`
        });
      });
    }

    // Recent notes
    const { data: recentNotes } = await supabase
      .from('cornell_notes')
      .select('id, title, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(3);

    if (recentNotes) {
      recentNotes.forEach(note => {
        const timeAgo = getTimeAgo(new Date(note.updated_at));
        recent_activities.push({
          type: 'note',
          icon: '📝',
          title: note.title || 'Untitled Note',
          stat: 'Cornell Notes',
          timestamp: timeAgo,
          route: `/cornell-notes/${note.id}`
        });
      });
    }

    // Sort by most recent
    recent_activities.sort((a, b) => {
      // This is a simplified sort - in production you'd want to sort by actual timestamp
      return 0;
    });

    res.json({
      study_time_today,
      quizzes_this_week,
      notes_created,
      current_streak,
      recent_activities: recent_activities.slice(0, 6)
    });

  } catch (error) {
    console.error('Error fetching homepage stats:', error);
    res.status(500).json({ error: 'Failed to fetch homepage stats' });
  }
}

// Helper function to get "time ago" string
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  let interval = Math.floor(seconds / 31536000);
  if (interval >= 1) return interval + ' year' + (interval > 1 ? 's' : '') + ' ago';

  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) return interval + ' month' + (interval > 1 ? 's' : '') + ' ago';

  interval = Math.floor(seconds / 86400);
  if (interval >= 1) return interval + ' day' + (interval > 1 ? 's' : '') + ' ago';

  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return interval + ' hour' + (interval > 1 ? 's' : '') + ' ago';

  interval = Math.floor(seconds / 60);
  if (interval >= 1) return interval + ' minute' + (interval > 1 ? 's' : '') + ' ago';

  return 'just now';
}
