import { supabase } from '../utils/supabaseClient.js';

// Log study activity and update streak
export async function logActivity(req, res) {
  try {
    const userId = req.user.id;
    const { activityType, timeMinutes = 0 } = req.body;

    if (!activityType) {
      return res.status(400).json({ error: 'Activity type is required' });
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    // Insert or update activity for today
    const { data: activity, error: activityError } = await supabase
      .from('study_activity')
      .upsert({
        user_id: userId,
        activity_date: today,
        activity_type: activityType,
        activity_count: 1,
        total_time_minutes: timeMinutes
      }, {
        onConflict: 'user_id,activity_date,activity_type',
        returning: 'representation'
      })
      .select()
      .single();

    if (activityError) {
      throw activityError;
    }

    // Get updated streak information
    const { data: streak, error: streakError } = await supabase
      .from('user_streaks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (streakError && streakError.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw streakError;
    }

    res.json({
      activity,
      streak: streak || { current_streak: 0, longest_streak: 0, total_study_days: 0 }
    });

  } catch (error) {
    console.error('Error logging study activity:', error);
    res.status(500).json({ error: 'Failed to log study activity' });
  }
}

// Get current user's streak information
export async function getStreak(req, res) {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('user_streaks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    // If no streak data exists, return default
    if (!data) {
      return res.json({
        current_streak: 0,
        longest_streak: 0,
        total_study_days: 0,
        last_activity_date: null,
        streak_freeze_count: 0
      });
    }

    res.json(data);

  } catch (error) {
    console.error('Error fetching streak:', error);
    res.status(500).json({ error: 'Failed to fetch streak information' });
  }
}

// Get study activity history
export async function getActivityHistory(req, res) {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const { data, error } = await supabase
      .from('study_activity')
      .select('*')
      .eq('user_id', userId)
      .gte('activity_date', startDate.toISOString().split('T')[0])
      .order('activity_date', { ascending: false });

    if (error) {
      throw error;
    }

    // Group by date for easier frontend consumption
    const groupedByDate = data.reduce((acc, activity) => {
      if (!acc[activity.activity_date]) {
        acc[activity.activity_date] = [];
      }
      acc[activity.activity_date].push(activity);
      return acc;
    }, {});

    res.json({
      activities: data,
      groupedByDate,
      totalDays: Object.keys(groupedByDate).length
    });

  } catch (error) {
    console.error('Error fetching activity history:', error);
    res.status(500).json({ error: 'Failed to fetch activity history' });
  }
}

// Get activity stats by type
export async function getActivityStats(req, res) {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const { data, error } = await supabase
      .from('study_activity')
      .select('activity_type, activity_count, total_time_minutes')
      .eq('user_id', userId)
      .gte('activity_date', startDate.toISOString().split('T')[0]);

    if (error) {
      throw error;
    }

    // Aggregate stats by activity type
    const stats = data.reduce((acc, activity) => {
      if (!acc[activity.activity_type]) {
        acc[activity.activity_type] = {
          count: 0,
          totalTimeMinutes: 0
        };
      }
      acc[activity.activity_type].count += activity.activity_count || 1;
      acc[activity.activity_type].totalTimeMinutes += activity.total_time_minutes || 0;
      return acc;
    }, {});

    res.json(stats);

  } catch (error) {
    console.error('Error fetching activity stats:', error);
    res.status(500).json({ error: 'Failed to fetch activity statistics' });
  }
}
