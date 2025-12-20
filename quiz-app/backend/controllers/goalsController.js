import { supabase } from '../utils/supabaseClient.js';

function todayDate() {
  return new Date().toISOString().split('T')[0];
}

function nowIso() {
  return new Date().toISOString();
}

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// =========================
// Daily goals
// =========================

export async function getDailyGoalSettings(req, res) {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('daily_goal_settings')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;

    res.json({
      success: true,
      settings: data || {
        user_id: userId,
        target_minutes: 60,
        target_sessions: 2,
        target_tasks: 3,
        updated_at: nowIso(),
      },
    });
  } catch (error) {
    console.error('Daily goals get settings error:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
}

export async function upsertDailyGoalSettings(req, res) {
  try {
    const userId = req.user.id;
    const { target_minutes, target_sessions, target_tasks } = req.body;

    const payload = {
      user_id: userId,
      target_minutes: Math.min(600, Math.max(0, safeInt(target_minutes, 60))),
      target_sessions: Math.min(20, Math.max(0, safeInt(target_sessions, 2))),
      target_tasks: Math.min(50, Math.max(0, safeInt(target_tasks, 3))),
      updated_at: nowIso(),
    };

    const { data, error } = await supabase
      .from('daily_goal_settings')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, settings: data });
  } catch (error) {
    console.error('Daily goals upsert settings error:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
}

export async function getTodayProgress(req, res) {
  try {
    const userId = req.user.id;
    const date = todayDate();
    const { data, error } = await supabase
      .from('daily_goal_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('goal_date', date)
      .single();
    if (error && error.code !== 'PGRST116') throw error;

    res.json({
      success: true,
      progress: data || {
        user_id: userId,
        goal_date: date,
        minutes_done: 0,
        sessions_done: 0,
        tasks_done: 0,
        updated_at: nowIso(),
      },
    });
  } catch (error) {
    console.error('Daily goals get progress error:', error);
    res.status(500).json({ error: 'Failed to load progress' });
  }
}

export async function incrementTodayProgress(req, res) {
  try {
    const userId = req.user.id;
    const date = todayDate();
    const { minutes_delta = 0, sessions_delta = 0, tasks_delta = 0 } = req.body;

    const { data: existing, error: existingError } = await supabase
      .from('daily_goal_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('goal_date', date)
      .single();
    if (existingError && existingError.code !== 'PGRST116') throw existingError;

    const next = {
      user_id: userId,
      goal_date: date,
      minutes_done: Math.max(0, (existing?.minutes_done || 0) + safeInt(minutes_delta, 0)),
      sessions_done: Math.max(0, (existing?.sessions_done || 0) + safeInt(sessions_delta, 0)),
      tasks_done: Math.max(0, (existing?.tasks_done || 0) + safeInt(tasks_delta, 0)),
      updated_at: nowIso(),
    };

    const { data, error } = await supabase
      .from('daily_goal_progress')
      .upsert(next, { onConflict: 'user_id,goal_date' })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, progress: data });
  } catch (error) {
    console.error('Daily goals increment error:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
}

// =========================
// Habits
// =========================

export async function listHabits(req, res) {
  try {
    const userId = req.user.id;
    const includeArchived = req.query.includeArchived === 'true';

    let query = supabase
      .from('habits')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (!includeArchived) query = query.eq('is_archived', false);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, habits: data || [] });
  } catch (error) {
    console.error('Habits list error:', error);
    res.status(500).json({ error: 'Failed to load habits' });
  }
}

export async function createHabit(req, res) {
  try {
    const userId = req.user.id;
    const { name } = req.body;

    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({ error: 'Habit name is required' });
    }

    const { data, error } = await supabase
      .from('habits')
      .insert({
        user_id: userId,
        name: String(name).trim().slice(0, 120),
      })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, habit: data });
  } catch (error) {
    console.error('Habit create error:', error);
    res.status(500).json({ error: 'Failed to create habit' });
  }
}

export async function updateHabit(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { name, is_archived } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = String(name).trim().slice(0, 120);
    if (is_archived !== undefined) updates.is_archived = Boolean(is_archived);

    const { data, error } = await supabase
      .from('habits')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, habit: data });
  } catch (error) {
    console.error('Habit update error:', error);
    res.status(500).json({ error: 'Failed to update habit' });
  }
}

export async function setHabitCheckin(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { checkin_date, done = true } = req.body;
    const date = checkin_date ? String(checkin_date) : todayDate();

    const { data: habit, error: habitError } = await supabase
      .from('habits')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (habitError || !habit) return res.status(404).json({ error: 'Habit not found' });

    const payload = {
      habit_id: id,
      user_id: userId,
      checkin_date: date,
      done: Boolean(done),
    };

    const { data, error } = await supabase
      .from('habit_checkins')
      .upsert(payload, { onConflict: 'habit_id,checkin_date' })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, checkin: data });
  } catch (error) {
    console.error('Habit checkin error:', error);
    res.status(500).json({ error: 'Failed to save check-in' });
  }
}

export async function getHabitCheckins(req, res) {
  try {
    const userId = req.user.id;
    const { from, to } = req.query;

    let query = supabase
      .from('habit_checkins')
      .select('id, habit_id, checkin_date, done, created_at')
      .eq('user_id', userId)
      .order('checkin_date', { ascending: false })
      .limit(1000);

    if (from) query = query.gte('checkin_date', String(from));
    if (to) query = query.lte('checkin_date', String(to));

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, checkins: data || [] });
  } catch (error) {
    console.error('Habit checkins list error:', error);
    res.status(500).json({ error: 'Failed to load check-ins' });
  }
}

