import { supabase } from '../utils/supabaseClient.js';

function todayDate() {
  return new Date().toISOString().split('T')[0];
}

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day + 6) % 7; // make Monday start (0)
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getProgressOverview(req, res) {
  try {
    const userId = req.user.id;
    const days = Math.min(365, Math.max(1, safeInt(req.query.days, 30)));
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [study, tasks, taskSessions, deepWork, goals, habits] = await Promise.all([
      supabase
        .from('study_activity')
        .select('activity_date, activity_type, total_time_minutes')
        .eq('user_id', userId)
        .gte('activity_date', startDate),
      supabase
        .from('task_timer_tasks')
        .select('id, is_completed, updated_at')
        .eq('user_id', userId),
      supabase
        .from('task_timer_sessions')
        .select('duration_seconds, created_at')
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()),
      supabase
        .from('deep_work_sessions')
        .select('focus_minutes, completed_cycles, status, created_at')
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()),
      supabase
        .from('daily_goal_progress')
        .select('goal_date, minutes_done, sessions_done, tasks_done')
        .eq('user_id', userId)
        .gte('goal_date', startDate),
      supabase
        .from('habit_checkins')
        .select('checkin_date, done')
        .eq('user_id', userId)
        .gte('checkin_date', startDate),
    ]);

    if (study.error) throw study.error;
    if (tasks.error) throw tasks.error;
    if (taskSessions.error) throw taskSessions.error;
    if (deepWork.error) throw deepWork.error;
    if (goals.error) throw goals.error;
    if (habits.error) throw habits.error;

    const totalStudyMinutes = (study.data || []).reduce((sum, row) => sum + (row.total_time_minutes || 0), 0);
    const completedTasks = (tasks.data || []).filter((t) => t.is_completed).length;
    const totalTaskTimerSeconds = (taskSessions.data || []).reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
    const deepWorkMinutes = (deepWork.data || [])
      .filter((s) => s.status === 'completed')
      .reduce((sum, s) => sum + (s.focus_minutes || 0) * (s.completed_cycles || 0), 0);
    const habitDoneCount = (habits.data || []).filter((h) => h.done).length;

    const today = todayDate();
    const todaysGoals = (goals.data || []).find((g) => g.goal_date === today) || null;

    res.json({
      success: true,
      windowDays: days,
      totals: {
        studyMinutes: totalStudyMinutes,
        taskTimerMinutes: Math.round(totalTaskTimerSeconds / 60),
        deepWorkMinutes,
        completedTasks,
        habitCheckinsDone: habitDoneCount,
      },
      today: {
        date: today,
        goals: todaysGoals,
      },
      raw: {
        studyActivity: study.data || [],
        dailyGoals: goals.data || [],
      },
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
}

export async function getReportPreferences(req, res) {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('report_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;

    res.json({
      success: true,
      preferences: data || {
        user_id: userId,
        enabled: true,
        cadence: 'weekly',
        timezone: 'UTC',
      },
    });
  } catch (error) {
    console.error('Report preferences get error:', error);
    res.status(500).json({ error: 'Failed to load preferences' });
  }
}

export async function upsertReportPreferences(req, res) {
  try {
    const userId = req.user.id;
    const { enabled, cadence, timezone } = req.body;

    const payload = {
      user_id: userId,
      enabled: enabled === undefined ? true : Boolean(enabled),
      cadence: cadence ? String(cadence).slice(0, 20) : 'weekly',
      timezone: timezone ? String(timezone).slice(0, 64) : 'UTC',
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('report_preferences')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, preferences: data });
  } catch (error) {
    console.error('Report preferences upsert error:', error);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
}

export async function generateWeeklyReport(req, res) {
  try {
    const userId = req.user.id;
    const requested = req.body?.week_start ? new Date(req.body.week_start) : new Date();
    const weekStartDate = startOfWeek(requested);
    const weekStart = weekStartDate.toISOString().split('T')[0];

    const overviewReq = { ...req, query: { days: 14 } };
    const collector = {};
    const proxyRes = {
      json: (obj) => {
        Object.assign(collector, obj);
      },
      status: () => proxyRes,
    };
    await getProgressOverview(overviewReq, proxyRes);

    if (!collector.success) {
      return res.status(500).json({ error: 'Failed to generate report' });
    }

    const payload = {
      weekStart,
      generatedAt: new Date().toISOString(),
      highlights: {
        totalStudyMinutes: collector.totals.studyMinutes,
        deepWorkMinutes: collector.totals.deepWorkMinutes,
        taskTimerMinutes: collector.totals.taskTimerMinutes,
        completedTasks: collector.totals.completedTasks,
        habitCheckinsDone: collector.totals.habitCheckinsDone,
      },
      notes: 'This is an in-app weekly summary. Email delivery can be added later.',
    };

    const { data, error } = await supabase
      .from('weekly_reports')
      .upsert({
        user_id: userId,
        week_start: weekStart,
        payload,
      }, { onConflict: 'user_id,week_start' })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, report: data });
  } catch (error) {
    console.error('Generate weekly report error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
}

export async function listWeeklyReports(req, res) {
  try {
    const userId = req.user.id;
    const limit = Math.min(52, Math.max(1, safeInt(req.query.limit, 12)));

    const { data, error } = await supabase
      .from('weekly_reports')
      .select('id, week_start, created_at, payload')
      .eq('user_id', userId)
      .order('week_start', { ascending: false })
      .limit(limit);
    if (error) throw error;

    res.json({ success: true, reports: data || [] });
  } catch (error) {
    console.error('List weekly reports error:', error);
    res.status(500).json({ error: 'Failed to load reports' });
  }
}

