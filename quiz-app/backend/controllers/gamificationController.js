import { supabase } from '../utils/supabaseClient.js';
import { sanitizeUsername } from '../utils/sanitizer.js';

function nowIso() {
  return new Date().toISOString();
}

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function xpToLevel(totalXp) {
  const xp = Math.max(0, safeInt(totalXp, 0));
  const level = Math.floor(xp / 100) + 1;
  const currentLevelBase = (level - 1) * 100;
  const nextLevelXp = level * 100;
  return { level, currentLevelBase, nextLevelXp };
}

const DEFAULT_BADGES = [
  { id: 'first-login', name: 'First Login', description: 'Signed in for the first time.', icon: '🔑' },
  { id: 'first-task', name: 'First Task', description: 'Completed your first task.', icon: '✅' },
  { id: 'first-deep-work', name: 'Deep Work Starter', description: 'Completed your first deep work session.', icon: '🧠' },
  { id: 'goal-setter', name: 'Goal Setter', description: 'Set daily goals.', icon: '🎯' },
  { id: 'habit-starter', name: 'Habit Starter', description: 'Created your first habit.', icon: '📅' },
  { id: 'streak-3', name: '3-Day Streak', description: 'Studied 3 days in a row.', icon: '🔥' },
  { id: 'streak-7', name: '7-Day Streak', description: 'Studied 7 days in a row.', icon: '🔥' },
  { id: 'weekly-review', name: 'Weekly Review', description: 'Generated a weekly report.', icon: '📋' },
];

async function ensureDefaultBadges() {
  const { data, error } = await supabase.from('badges').select('id').limit(1);
  if (error) throw error;
  if (data && data.length > 0) return;

  const { error: insertError } = await supabase.from('badges').insert(DEFAULT_BADGES);
  if (insertError) throw insertError;
}

// =========================
// XP
// =========================

export async function getXp(req, res) {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('user_xp')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    const row = data || { user_id: userId, total_xp: 0, level: 1, updated_at: nowIso() };
    const calc = xpToLevel(row.total_xp);

    res.json({
      success: true,
      xp: {
        total_xp: row.total_xp,
        level: calc.level,
        next_level_xp: calc.nextLevelXp,
        current_level_base_xp: calc.currentLevelBase,
        updated_at: row.updated_at,
      },
    });
  } catch (error) {
    console.error('Get XP error:', error);
    res.status(500).json({ error: 'Failed to load XP' });
  }
}

export async function listXpEvents(req, res) {
  try {
    const userId = req.user.id;
    const limit = Math.min(200, Math.max(1, safeInt(req.query.limit, 50)));

    const { data, error } = await supabase
      .from('xp_events')
      .select('id, delta, reason, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json({ success: true, events: data || [] });
  } catch (error) {
    console.error('List XP events error:', error);
    res.status(500).json({ error: 'Failed to load XP history' });
  }
}

export async function awardXp(req, res) {
  try {
    const userId = req.user.id;
    const delta = safeInt(req.body?.delta, 0);
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 200) : null;

    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ error: 'delta must be a non-zero integer' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('user_xp')
      .select('total_xp')
      .eq('user_id', userId)
      .single();
    if (existingError && existingError.code !== 'PGRST116') throw existingError;

    const nextTotal = Math.max(0, (existing?.total_xp || 0) + delta);
    const calc = xpToLevel(nextTotal);

    const { data: updated, error } = await supabase
      .from('user_xp')
      .upsert(
        { user_id: userId, total_xp: nextTotal, level: calc.level, updated_at: nowIso() },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) throw error;

    await supabase.from('xp_events').insert({ user_id: userId, delta, reason });

    res.json({
      success: true,
      xp: {
        total_xp: updated.total_xp,
        level: updated.level,
        next_level_xp: calc.nextLevelXp,
        current_level_base_xp: calc.currentLevelBase,
        updated_at: updated.updated_at,
      },
    });
  } catch (error) {
    console.error('Award XP error:', error);
    res.status(500).json({ error: 'Failed to award XP' });
  }
}

// =========================
// Badges
// =========================

export async function listBadges(req, res) {
  try {
    const userId = req.user.id;
    await ensureDefaultBadges();

    const [badges, earned] = await Promise.all([
      supabase.from('badges').select('*').order('created_at', { ascending: true }),
      supabase.from('user_badges').select('badge_id, earned_at').eq('user_id', userId),
    ]);

    if (badges.error) throw badges.error;
    if (earned.error) throw earned.error;

    const earnedMap = new Map((earned.data || []).map((b) => [b.badge_id, b.earned_at]));
    const merged = (badges.data || []).map((b) => ({
      ...b,
      earned_at: earnedMap.get(b.id) || null,
      is_earned: earnedMap.has(b.id),
    }));

    res.json({ success: true, badges: merged });
  } catch (error) {
    console.error('List badges error:', error);
    res.status(500).json({ error: 'Failed to load badges' });
  }
}

export async function awardBadge(req, res) {
  try {
    const userId = req.user.id;
    const badgeId = req.body?.badge_id ? String(req.body.badge_id) : null;
    if (!badgeId) return res.status(400).json({ error: 'badge_id is required' });

    await ensureDefaultBadges();

    const { data: badge, error: badgeError } = await supabase
      .from('badges')
      .select('id')
      .eq('id', badgeId)
      .single();
    if (badgeError || !badge) return res.status(404).json({ error: 'Badge not found' });

    const { data, error } = await supabase
      .from('user_badges')
      .upsert({ user_id: userId, badge_id: badgeId, earned_at: nowIso() }, { onConflict: 'user_id,badge_id' })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, earned: data });
  } catch (error) {
    console.error('Award badge error:', error);
    res.status(500).json({ error: 'Failed to award badge' });
  }
}

// =========================
// Leaderboards (public)
// =========================

export async function getLeaderboards(req, res) {
  try {
    const limit = Math.min(100, Math.max(1, safeInt(req.query.limit, 20)));
    const { data, error } = await supabase
      .from('user_xp')
      .select('user_id, total_xp, level, updated_at')
      .order('total_xp', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    const userIds = Array.from(new Set((data || []).map((r) => r.user_id))).filter(Boolean);
    let usersById = new Map();
    if (userIds.length > 0) {
      const usersRes = await supabase.from('users').select('id, username').in('id', userIds);
      if (!usersRes.error) {
        usersById = new Map((usersRes.data || []).map((u) => [u.id, u.username]));
      }
    }

    res.json({
      success: true,
      leaderboard: (data || []).map((row, index) => ({
        rank: index + 1,
        user_id: row.user_id,
        username: usersById.get(row.user_id) || 'Anonymous',
        total_xp: row.total_xp,
        level: row.level,
      })),
    });
  } catch (error) {
    console.error('Leaderboards error:', error);
    res.status(500).json({ error: 'Failed to load leaderboards' });
  }
}

// =========================
// Challenges
// =========================

export async function listChallenges(req, res) {
  try {
    const userId = req.user.id;
    const { data: challenges, error } = await supabase
      .from('challenges')
      .select('*')
      .or(`created_by.is.null,created_by.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    const { data: progress, error: progressError } = await supabase
      .from('user_challenge_progress')
      .select('challenge_id, progress_count, completed_at, updated_at')
      .eq('user_id', userId);
    if (progressError) throw progressError;

    const map = new Map((progress || []).map((p) => [p.challenge_id, p]));
    const merged = (challenges || []).map((c) => ({
      ...c,
      progress: map.get(c.id) || { progress_count: 0, completed_at: null, updated_at: null },
    }));

    res.json({ success: true, challenges: merged });
  } catch (error) {
    console.error('List challenges error:', error);
    res.status(500).json({ error: 'Failed to load challenges' });
  }
}

export async function createChallenge(req, res) {
  try {
    const userId = req.user.id;
    const title = req.body?.title ? String(req.body.title).trim() : '';
    const description = req.body?.description ? String(req.body.description).slice(0, 500) : null;
    const targetCount = Math.min(1000, Math.max(1, safeInt(req.body?.target_count, 1)));
    const startDate = req.body?.start_date ? String(req.body.start_date) : null;
    const endDate = req.body?.end_date ? String(req.body.end_date) : null;

    if (!title) return res.status(400).json({ error: 'title is required' });

    const { data, error } = await supabase
      .from('challenges')
      .insert({
        created_by: userId,
        title: title.slice(0, 120),
        description,
        target_count: targetCount,
        start_date: startDate,
        end_date: endDate,
      })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, challenge: data });
  } catch (error) {
    console.error('Create challenge error:', error);
    res.status(500).json({ error: 'Failed to create challenge' });
  }
}

export async function updateChallengeProgress(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const delta = safeInt(req.body?.delta, 1);

    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('id, target_count')
      .eq('id', id)
      .single();
    if (challengeError || !challenge) return res.status(404).json({ error: 'Challenge not found' });

    const { data: existing, error: existingError } = await supabase
      .from('user_challenge_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('challenge_id', id)
      .single();
    if (existingError && existingError.code !== 'PGRST116') throw existingError;

    const nextProgress = Math.max(0, (existing?.progress_count || 0) + delta);
    const isComplete = nextProgress >= (challenge.target_count || 1);

    const { data, error } = await supabase
      .from('user_challenge_progress')
      .upsert(
        {
          user_id: userId,
          challenge_id: id,
          progress_count: nextProgress,
          completed_at: isComplete ? existing?.completed_at || nowIso() : null,
          updated_at: nowIso(),
        },
        { onConflict: 'user_id,challenge_id' }
      )
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, progress: data });
  } catch (error) {
    console.error('Update challenge progress error:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
}

// =========================
// Milestones
// =========================

export async function listMilestones(req, res) {
  try {
    const userId = req.user.id;
    const limit = Math.min(500, Math.max(1, safeInt(req.query.limit, 50)));

    const { data, error } = await supabase
      .from('milestones')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    res.json({ success: true, milestones: data || [] });
  } catch (error) {
    console.error('List milestones error:', error);
    res.status(500).json({ error: 'Failed to load milestones' });
  }
}

export async function createMilestone(req, res) {
  try {
    const userId = req.user.id;
    const milestoneType = req.body?.milestone_type ? String(req.body.milestone_type).slice(0, 50) : 'custom';
    const title = req.body?.title ? String(req.body.title).trim().slice(0, 200) : '';
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};

    if (!title) return res.status(400).json({ error: 'title is required' });

    const { data, error } = await supabase
      .from('milestones')
      .insert({ user_id: userId, milestone_type: milestoneType, title, metadata })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, milestone: data });
  } catch (error) {
    console.error('Create milestone error:', error);
    res.status(500).json({ error: 'Failed to create milestone' });
  }
}

// =========================
// Accountability partner
// =========================

async function getOrCreatePartnership(userId, partnerUserId) {
  const { data, error } = await supabase
    .from('accountability_partnerships')
    .upsert(
      { user_id: userId, partner_user_id: partnerUserId, status: 'active', updated_at: nowIso() },
      { onConflict: 'user_id,partner_user_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getAccountabilityPartner(req, res) {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('accountability_partnerships')
      .select('id, partner_user_id, status, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.json({ success: true, partner: null });
    }

    const userRes = await supabase.from('users').select('id, username').eq('id', data.partner_user_id).single();
    const username = userRes.data?.username || 'Unknown';

    res.json({
      success: true,
      partner: {
        partnership_id: data.id,
        partner_user_id: data.partner_user_id,
        username,
        status: data.status,
        updated_at: data.updated_at,
      },
    });
  } catch (error) {
    console.error('Get accountability partner error:', error);
    res.status(500).json({ error: 'Failed to load partner' });
  }
}

export async function setAccountabilityPartner(req, res) {
  try {
    const userId = req.user.id;
    const usernameRaw = req.body?.username ? String(req.body.username) : '';
    let username;
    try {
      username = sanitizeUsername(usernameRaw);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const { data: users, error } = await supabase.from('users').select('id, username').eq('username', username).limit(1);
    if (error) throw error;
    if (!users || users.length === 0) return res.status(404).json({ error: 'User not found' });

    const partner = users[0];
    if (partner.id === userId) return res.status(400).json({ error: 'You cannot select yourself' });

    const a = await getOrCreatePartnership(userId, partner.id);
    const b = await getOrCreatePartnership(partner.id, userId);

    res.json({
      success: true,
      partner: { partnership_id: a.id, partner_user_id: partner.id, username: partner.username, status: a.status },
      reciprocal: { partnership_id: b.id },
    });
  } catch (error) {
    console.error('Set accountability partner error:', error);
    res.status(500).json({ error: 'Failed to set partner' });
  }
}

export async function listAccountabilityCheckins(req, res) {
  try {
    const userId = req.user.id;
    const limit = Math.min(200, Math.max(1, safeInt(req.query.limit, 50)));

    const { data: partnerships, error } = await supabase
      .from('accountability_partnerships')
      .select('id, partner_user_id')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(5);
    if (error) throw error;

    const partnershipIds = (partnerships || []).map((p) => p.id);
    if (partnershipIds.length === 0) return res.json({ success: true, checkins: [] });

    const { data, error: checkinsError } = await supabase
      .from('accountability_checkins')
      .select('id, partnership_id, from_user_id, message, created_at')
      .in('partnership_id', partnershipIds)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (checkinsError) throw checkinsError;

    const userIds = Array.from(new Set((data || []).map((c) => c.from_user_id))).filter(Boolean);
    let usersById = new Map();
    if (userIds.length > 0) {
      const usersRes = await supabase.from('users').select('id, username').in('id', userIds);
      if (!usersRes.error) usersById = new Map((usersRes.data || []).map((u) => [u.id, u.username]));
    }

    res.json({
      success: true,
      checkins: (data || []).map((c) => ({
        ...c,
        from_username: usersById.get(c.from_user_id) || 'Unknown',
      })),
    });
  } catch (error) {
    console.error('List accountability checkins error:', error);
    res.status(500).json({ error: 'Failed to load check-ins' });
  }
}

export async function sendAccountabilityCheckin(req, res) {
  try {
    const userId = req.user.id;
    const message = req.body?.message ? String(req.body.message).slice(0, 1000) : null;

    const { data: partnership, error } = await supabase
      .from('accountability_partnerships')
      .select('id, partner_user_id')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!partnership) return res.status(400).json({ error: 'No partner set' });

    const reciprocal = await getOrCreatePartnership(partnership.partner_user_id, userId);

    const payload = { from_user_id: userId, message };
    const { data: a, error: aErr } = await supabase
      .from('accountability_checkins')
      .insert([{ partnership_id: partnership.id, ...payload }, { partnership_id: reciprocal.id, ...payload }])
      .select();
    if (aErr) throw aErr;

    res.json({ success: true, created: a || [] });
  } catch (error) {
    console.error('Send accountability checkin error:', error);
    res.status(500).json({ error: 'Failed to send check-in' });
  }
}

