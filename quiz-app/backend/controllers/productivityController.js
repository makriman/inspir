import { supabase } from '../utils/supabaseClient.js';

function nowIso() {
  return new Date().toISOString();
}

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// =========================
// Task Timer
// =========================

export async function listTaskTimerTasks(req, res) {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('task_timer_tasks')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, tasks: data || [] });
  } catch (error) {
    console.error('Task timer list tasks error:', error);
    res.status(500).json({ error: 'Failed to load tasks' });
  }
}

export async function createTaskTimerTask(req, res) {
  try {
    const userId = req.user.id;
    const { title, notes } = req.body;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const { data, error } = await supabase
      .from('task_timer_tasks')
      .insert({
        user_id: userId,
        title: title.trim().slice(0, 200),
        notes: notes ? String(notes).slice(0, 2000) : null,
        updated_at: nowIso(),
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, task: data });
  } catch (error) {
    console.error('Task timer create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
}

export async function updateTaskTimerTask(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { title, notes, is_completed } = req.body;

    const updates = { updated_at: nowIso() };
    if (title !== undefined) updates.title = String(title).trim().slice(0, 200);
    if (notes !== undefined) updates.notes = notes ? String(notes).slice(0, 2000) : null;
    if (is_completed !== undefined) updates.is_completed = Boolean(is_completed);

    const { data, error } = await supabase
      .from('task_timer_tasks')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, task: data });
  } catch (error) {
    console.error('Task timer update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
}

export async function deleteTaskTimerTask(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { error } = await supabase
      .from('task_timer_tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Task timer delete task error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
}

export async function logTaskTimerSession(req, res) {
  try {
    const userId = req.user.id;
    const { task_id, duration_seconds, started_at, ended_at } = req.body;

    const duration = Math.max(0, safeInt(duration_seconds, 0));
    const payload = {
      user_id: userId,
      task_id: task_id || null,
      duration_seconds: duration,
      started_at: started_at ? new Date(started_at).toISOString() : null,
      ended_at: ended_at ? new Date(ended_at).toISOString() : null,
    };

    const { data, error } = await supabase
      .from('task_timer_sessions')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, session: data });
  } catch (error) {
    console.error('Task timer log session error:', error);
    res.status(500).json({ error: 'Failed to save session' });
  }
}

export async function listTaskTimerSessions(req, res) {
  try {
    const userId = req.user.id;
    const days = Math.min(180, Math.max(1, safeInt(req.query.days, 30)));
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('task_timer_sessions')
      .select('id, task_id, duration_seconds, started_at, ended_at, created_at')
      .eq('user_id', userId)
      .gte('created_at', startDate)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw error;
    res.json({ success: true, sessions: data || [] });
  } catch (error) {
    console.error('Task timer list sessions error:', error);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
}

// =========================
// Break Reminder
// =========================

export async function getBreakReminderSettings(req, res) {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('break_reminder_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({
      success: true,
      settings: data || {
        user_id: userId,
        enabled: true,
        work_minutes: 50,
        break_minutes: 10,
        sound_enabled: true,
        notifications_enabled: false,
        updated_at: nowIso(),
      },
    });
  } catch (error) {
    console.error('Break reminder get settings error:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
}

export async function upsertBreakReminderSettings(req, res) {
  try {
    const userId = req.user.id;
    const {
      enabled,
      work_minutes,
      break_minutes,
      sound_enabled,
      notifications_enabled,
    } = req.body;

    const payload = {
      user_id: userId,
      enabled: enabled === undefined ? true : Boolean(enabled),
      work_minutes: Math.min(180, Math.max(1, safeInt(work_minutes, 50))),
      break_minutes: Math.min(60, Math.max(1, safeInt(break_minutes, 10))),
      sound_enabled: sound_enabled === undefined ? true : Boolean(sound_enabled),
      notifications_enabled: notifications_enabled === undefined ? false : Boolean(notifications_enabled),
      updated_at: nowIso(),
    };

    const { data, error } = await supabase
      .from('break_reminder_settings')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, settings: data });
  } catch (error) {
    console.error('Break reminder upsert settings error:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
}

// =========================
// Deep Work
// =========================

export async function createDeepWorkSession(req, res) {
  try {
    const userId = req.user.id;
    const { title, focus_minutes, break_minutes, planned_cycles } = req.body;

    const payload = {
      user_id: userId,
      title: title ? String(title).slice(0, 200) : null,
      focus_minutes: Math.min(180, Math.max(1, safeInt(focus_minutes, 50))),
      break_minutes: Math.min(60, Math.max(1, safeInt(break_minutes, 10))),
      planned_cycles: Math.min(12, Math.max(1, safeInt(planned_cycles, 1))),
      completed_cycles: 0,
      status: 'planned',
      created_at: nowIso(),
    };

    const { data, error } = await supabase
      .from('deep_work_sessions')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, session: data });
  } catch (error) {
    console.error('Deep work create session error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
}

export async function updateDeepWorkSession(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status, started_at, ended_at, completed_cycles } = req.body;

    const updates = {};
    if (status) updates.status = String(status).slice(0, 20);
    if (started_at) updates.started_at = new Date(started_at).toISOString();
    if (ended_at) updates.ended_at = new Date(ended_at).toISOString();
    if (completed_cycles !== undefined) updates.completed_cycles = Math.max(0, safeInt(completed_cycles, 0));

    const { data, error } = await supabase
      .from('deep_work_sessions')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, session: data });
  } catch (error) {
    console.error('Deep work update session error:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
}

export async function listDeepWorkSessions(req, res) {
  try {
    const userId = req.user.id;
    const limit = Math.min(200, Math.max(1, safeInt(req.query.limit, 50)));
    const { data, error } = await supabase
      .from('deep_work_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json({ success: true, sessions: data || [] });
  } catch (error) {
    console.error('Deep work list sessions error:', error);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
}

