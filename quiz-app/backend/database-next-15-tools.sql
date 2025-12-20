-- ============================================
-- INSPIR: Next 15 Tools (Gamification + Organization + Social)
-- UI-first release:
-- - xp-leveling, badges, leaderboards, challenges, progress-viz, milestones, accountability
-- - note-organizer, study-planner, course-manager, assignment-tracker, gpa-tracker, schedule-builder
-- - study-groups, resource-sharing
--
-- This schema matches the app's local JWT auth (`public.users` table).
-- Run in Supabase SQL Editor for the `quiz-app` project database.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1) GAMIFICATION: XP + BADGES + CHALLENGES
-- ============================================

CREATE TABLE IF NOT EXISTS user_xp (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS xp_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xp_events_user_created ON xp_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user_earned ON user_badges(user_id, earned_at DESC);

CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL, -- null = global
  title TEXT NOT NULL,
  description TEXT,
  target_count INTEGER NOT NULL DEFAULT 1,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_challenge_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  progress_count INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, challenge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_challenge_progress_user ON user_challenge_progress(user_id, updated_at DESC);

-- ============================================
-- 2) MILESTONES
-- ============================================

CREATE TABLE IF NOT EXISTS milestones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  milestone_type TEXT NOT NULL,
  title TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestones_user_created ON milestones(user_id, created_at DESC);

-- ============================================
-- 3) ACCOUNTABILITY PARTNER
-- ============================================

CREATE TABLE IF NOT EXISTS accountability_partnerships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active', -- active|paused|ended
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, partner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_accountability_partnerships_user ON accountability_partnerships(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS accountability_checkins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partnership_id UUID NOT NULL REFERENCES accountability_partnerships(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accountability_checkins_partnership ON accountability_checkins(partnership_id, created_at DESC);

-- ============================================
-- 4) NOTE ORGANIZER
-- ============================================

CREATE TABLE IF NOT EXISTS organized_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organized_notes_user_updated ON organized_notes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_organized_notes_tags ON organized_notes USING gin(tags);

-- ============================================
-- 5) STUDY PLANNER / CALENDAR
-- ============================================

CREATE TABLE IF NOT EXISTS planner_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  event_type TEXT NOT NULL DEFAULT 'study', -- study|exam|assignment|other
  location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planner_events_user_start ON planner_events(user_id, start_at);

-- ============================================
-- 6) COURSES + ASSIGNMENTS + GPA TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  term TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courses_user_created ON courses(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'todo', -- todo|in-progress|done
  priority INTEGER NOT NULL DEFAULT 2, -- 1 high, 2 medium, 3 low
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_user_due ON assignments(user_id, due_at);
CREATE INDEX IF NOT EXISTS idx_assignments_user_status ON assignments(user_id, status);

CREATE TABLE IF NOT EXISTS grade_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 100,
  weight REAL NOT NULL DEFAULT 1, -- relative weight
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grade_items_user_created ON grade_items(user_id, created_at DESC);

-- ============================================
-- 7) SCHEDULE BUILDER (TIME BLOCKS)
-- ============================================

CREATE TABLE IF NOT EXISTS schedule_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL, -- 0=Sun ... 6=Sat
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_blocks_user_day ON schedule_blocks(user_id, day_of_week, start_time);

-- ============================================
-- 8) STUDY GROUPS + RESOURCE SHARING
-- ============================================

CREATE TABLE IF NOT EXISTS study_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  join_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_private BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_groups_owner ON study_groups(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS study_group_memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- owner|member
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_study_group_memberships_group ON study_group_memberships(group_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_group_memberships_user ON study_group_memberships(user_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS shared_resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES study_groups(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_resources_group_created ON shared_resources(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_resources_user_created ON shared_resources(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_resources_tags ON shared_resources USING gin(tags);

