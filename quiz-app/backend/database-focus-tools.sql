-- ============================================
-- INSPIR: Focus + Goals + Analytics (10 tools)
-- UI-first release: Task Timer, Break Reminder, Deep Work, Group Timer,
-- Focus Music, Ambient Sounds, Daily Goals, Habit Tracker, Progress Dashboard,
-- Weekly Reports
--
-- This schema matches the app's local JWT auth (`public.users` table).
-- Run in Supabase SQL Editor for the `quiz-app` project database.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1) TASK TIMER
-- ============================================

CREATE TABLE IF NOT EXISTS task_timer_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_timer_tasks_user_id ON task_timer_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_task_timer_tasks_updated_at ON task_timer_tasks(updated_at DESC);

CREATE TABLE IF NOT EXISTS task_timer_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES task_timer_tasks(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_timer_sessions_user_id ON task_timer_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_timer_sessions_created_at ON task_timer_sessions(created_at DESC);

-- ============================================
-- 2) BREAK REMINDER
-- ============================================

CREATE TABLE IF NOT EXISTS break_reminder_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  work_minutes INTEGER NOT NULL DEFAULT 50,
  break_minutes INTEGER NOT NULL DEFAULT 10,
  sound_enabled BOOLEAN NOT NULL DEFAULT true,
  notifications_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 3) DEEP WORK SESSIONS
-- ============================================

CREATE TABLE IF NOT EXISTS deep_work_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  focus_minutes INTEGER NOT NULL DEFAULT 50,
  break_minutes INTEGER NOT NULL DEFAULT 10,
  planned_cycles INTEGER NOT NULL DEFAULT 1,
  completed_cycles INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'planned', -- planned|running|completed|canceled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deep_work_sessions_user_id ON deep_work_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_deep_work_sessions_created_at ON deep_work_sessions(created_at DESC);

-- ============================================
-- 4) GROUP STUDY TIMER (POLLING SYNC)
-- ============================================

CREATE TABLE IF NOT EXISTS group_timer_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  host_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_code TEXT UNIQUE NOT NULL,
  title TEXT,
  focus_minutes INTEGER NOT NULL DEFAULT 50,
  break_minutes INTEGER NOT NULL DEFAULT 10,
  started_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'lobby', -- lobby|running|ended
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_timer_rooms_host ON group_timer_rooms(host_user_id);
CREATE INDEX IF NOT EXISTS idx_group_timer_rooms_created_at ON group_timer_rooms(created_at DESC);

CREATE TABLE IF NOT EXISTS group_timer_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES group_timer_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_timer_participants_room_id ON group_timer_participants(room_id);

-- ============================================
-- 5) FOCUS MUSIC + AMBIENT SOUNDS (PREFERENCES)
-- ============================================

CREATE TABLE IF NOT EXISTS focus_audio_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL DEFAULT 'focus-music', -- focus-music|ambient-sounds
  volume REAL NOT NULL DEFAULT 0.5,
  preset_id TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tool_id)
);

-- ============================================
-- 6) DAILY GOALS
-- ============================================

CREATE TABLE IF NOT EXISTS daily_goal_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  target_minutes INTEGER NOT NULL DEFAULT 60,
  target_sessions INTEGER NOT NULL DEFAULT 2,
  target_tasks INTEGER NOT NULL DEFAULT 3,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_goal_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_date DATE NOT NULL,
  minutes_done INTEGER NOT NULL DEFAULT 0,
  sessions_done INTEGER NOT NULL DEFAULT 0,
  tasks_done INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, goal_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_goal_progress_user_date ON daily_goal_progress(user_id, goal_date DESC);

-- ============================================
-- 7) HABIT TRACKER
-- ============================================

CREATE TABLE IF NOT EXISTS habits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits(user_id);

CREATE TABLE IF NOT EXISTS habit_checkins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  habit_id UUID NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL,
  done BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(habit_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_habit_checkins_user_date ON habit_checkins(user_id, checkin_date DESC);

-- ============================================
-- 8) WEEKLY REPORTS (IN-APP)
-- ============================================

CREATE TABLE IF NOT EXISTS report_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  cadence TEXT NOT NULL DEFAULT 'weekly', -- weekly|monthly (future)
  timezone TEXT NOT NULL DEFAULT 'UTC',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weekly_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_user_week ON weekly_reports(user_id, week_start DESC);
