import { supabase } from '../utils/supabaseClient.js';

function nowIso() {
  return new Date().toISOString();
}

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

// =========================
// Note organizer
// =========================

export async function listNotes(req, res) {
  try {
    const userId = req.user.id;
    const tag = req.query.tag ? String(req.query.tag).trim().toLowerCase() : null;
    const q = req.query.q ? String(req.query.q).trim().toLowerCase() : null;

    let query = supabase
      .from('organized_notes')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(500);

    if (tag) query = query.contains('tags', [tag]);
    if (q) query = query.ilike('title', `%${q}%`);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, notes: data || [] });
  } catch (error) {
    console.error('List notes error:', error);
    res.status(500).json({ error: 'Failed to load notes' });
  }
}

export async function createNote(req, res) {
  try {
    const userId = req.user.id;
    const title = req.body?.title ? String(req.body.title).trim().slice(0, 200) : '';
    const content = req.body?.content ? String(req.body.content).slice(0, 20000) : null;
    const tags = normalizeTags(req.body?.tags);

    if (!title) return res.status(400).json({ error: 'title is required' });

    const { data, error } = await supabase
      .from('organized_notes')
      .insert({ user_id: userId, title, content, tags, updated_at: nowIso() })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, note: data });
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({ error: 'Failed to create note' });
  }
}

export async function updateNote(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const updates = { updated_at: nowIso() };
    if (req.body?.title !== undefined) updates.title = String(req.body.title).trim().slice(0, 200);
    if (req.body?.content !== undefined) updates.content = req.body.content ? String(req.body.content).slice(0, 20000) : null;
    if (req.body?.tags !== undefined) updates.tags = normalizeTags(req.body.tags);

    const { data, error } = await supabase
      .from('organized_notes')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, note: data });
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
}

export async function deleteNote(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { error } = await supabase.from('organized_notes').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
}

// =========================
// Study planner events
// =========================

export async function listPlannerEvents(req, res) {
  try {
    const userId = req.user.id;
    const from = req.query.from ? new Date(String(req.query.from)).toISOString() : null;
    const to = req.query.to ? new Date(String(req.query.to)).toISOString() : null;

    let query = supabase
      .from('planner_events')
      .select('*')
      .eq('user_id', userId)
      .order('start_at', { ascending: true })
      .limit(1000);

    if (from) query = query.gte('start_at', from);
    if (to) query = query.lte('start_at', to);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, events: data || [] });
  } catch (error) {
    console.error('List planner events error:', error);
    res.status(500).json({ error: 'Failed to load events' });
  }
}

export async function createPlannerEvent(req, res) {
  try {
    const userId = req.user.id;
    const title = req.body?.title ? String(req.body.title).trim().slice(0, 200) : '';
    const startAt = req.body?.start_at ? new Date(String(req.body.start_at)).toISOString() : null;
    const endAt = req.body?.end_at ? new Date(String(req.body.end_at)).toISOString() : null;
    const eventType = req.body?.event_type ? String(req.body.event_type).slice(0, 30) : 'study';
    const location = req.body?.location ? String(req.body.location).slice(0, 120) : null;
    const notes = req.body?.notes ? String(req.body.notes).slice(0, 2000) : null;

    if (!title || !startAt) return res.status(400).json({ error: 'title and start_at are required' });

    const { data, error } = await supabase
      .from('planner_events')
      .insert({ user_id: userId, title, start_at: startAt, end_at: endAt, event_type: eventType, location, notes })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, event: data });
  } catch (error) {
    console.error('Create planner event error:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
}

export async function updatePlannerEvent(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const updates = {};
    if (req.body?.title !== undefined) updates.title = String(req.body.title).trim().slice(0, 200);
    if (req.body?.start_at !== undefined) updates.start_at = new Date(String(req.body.start_at)).toISOString();
    if (req.body?.end_at !== undefined) updates.end_at = req.body.end_at ? new Date(String(req.body.end_at)).toISOString() : null;
    if (req.body?.event_type !== undefined) updates.event_type = String(req.body.event_type).slice(0, 30);
    if (req.body?.location !== undefined) updates.location = req.body.location ? String(req.body.location).slice(0, 120) : null;
    if (req.body?.notes !== undefined) updates.notes = req.body.notes ? String(req.body.notes).slice(0, 2000) : null;

    const { data, error } = await supabase
      .from('planner_events')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, event: data });
  } catch (error) {
    console.error('Update planner event error:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
}

export async function deletePlannerEvent(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { error } = await supabase.from('planner_events').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Delete planner event error:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
}

// =========================
// Courses
// =========================

export async function listCourses(req, res) {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ success: true, courses: data || [] });
  } catch (error) {
    console.error('List courses error:', error);
    res.status(500).json({ error: 'Failed to load courses' });
  }
}

export async function createCourse(req, res) {
  try {
    const userId = req.user.id;
    const name = req.body?.name ? String(req.body.name).trim().slice(0, 200) : '';
    const code = req.body?.code ? String(req.body.code).trim().slice(0, 40) : null;
    const term = req.body?.term ? String(req.body.term).trim().slice(0, 60) : null;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const { data, error } = await supabase
      .from('courses')
      .insert({ user_id: userId, name, code, term })
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, course: data });
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ error: 'Failed to create course' });
  }
}

export async function updateCourse(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const updates = {};
    if (req.body?.name !== undefined) updates.name = String(req.body.name).trim().slice(0, 200);
    if (req.body?.code !== undefined) updates.code = req.body.code ? String(req.body.code).trim().slice(0, 40) : null;
    if (req.body?.term !== undefined) updates.term = req.body.term ? String(req.body.term).trim().slice(0, 60) : null;

    const { data, error } = await supabase
      .from('courses')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, course: data });
  } catch (error) {
    console.error('Update course error:', error);
    res.status(500).json({ error: 'Failed to update course' });
  }
}

export async function deleteCourse(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { error } = await supabase.from('courses').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Delete course error:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
}

// =========================
// Assignments
// =========================

export async function listAssignments(req, res) {
  try {
    const userId = req.user.id;
    const status = req.query.status ? String(req.query.status) : null;

    let query = supabase
      .from('assignments')
      .select('*')
      .eq('user_id', userId)
      .order('due_at', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(500);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, assignments: data || [] });
  } catch (error) {
    console.error('List assignments error:', error);
    res.status(500).json({ error: 'Failed to load assignments' });
  }
}

export async function createAssignment(req, res) {
  try {
    const userId = req.user.id;
    const title = req.body?.title ? String(req.body.title).trim().slice(0, 200) : '';
    const dueAt = req.body?.due_at ? new Date(String(req.body.due_at)).toISOString() : null;
    const courseId = req.body?.course_id ? String(req.body.course_id) : null;
    const status = req.body?.status ? String(req.body.status).slice(0, 30) : 'todo';
    const priority = Math.min(3, Math.max(1, safeInt(req.body?.priority, 2)));
    const notes = req.body?.notes ? String(req.body.notes).slice(0, 2000) : null;

    if (!title) return res.status(400).json({ error: 'title is required' });

    const { data, error } = await supabase
      .from('assignments')
      .insert({ user_id: userId, title, due_at: dueAt, course_id: courseId, status, priority, notes, updated_at: nowIso() })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, assignment: data });
  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
}

export async function updateAssignment(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const updates = { updated_at: nowIso() };
    if (req.body?.title !== undefined) updates.title = String(req.body.title).trim().slice(0, 200);
    if (req.body?.due_at !== undefined) updates.due_at = req.body.due_at ? new Date(String(req.body.due_at)).toISOString() : null;
    if (req.body?.course_id !== undefined) updates.course_id = req.body.course_id ? String(req.body.course_id) : null;
    if (req.body?.status !== undefined) updates.status = String(req.body.status).slice(0, 30);
    if (req.body?.priority !== undefined) updates.priority = Math.min(3, Math.max(1, safeInt(req.body.priority, 2)));
    if (req.body?.notes !== undefined) updates.notes = req.body.notes ? String(req.body.notes).slice(0, 2000) : null;

    const { data, error } = await supabase
      .from('assignments')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, assignment: data });
  } catch (error) {
    console.error('Update assignment error:', error);
    res.status(500).json({ error: 'Failed to update assignment' });
  }
}

export async function deleteAssignment(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { error } = await supabase.from('assignments').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
}

// =========================
// GPA tracker
// =========================

function percentToGpa(percentage) {
  if (percentage >= 90) return 4.0;
  if (percentage >= 80) return 3.0;
  if (percentage >= 70) return 2.0;
  if (percentage >= 60) return 1.0;
  return 0.0;
}

export async function listGradeItems(req, res) {
  try {
    const userId = req.user.id;
    const courseId = req.query.course_id ? String(req.query.course_id) : null;
    let query = supabase.from('grade_items').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(500);
    if (courseId) query = query.eq('course_id', courseId);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, items: data || [] });
  } catch (error) {
    console.error('List grade items error:', error);
    res.status(500).json({ error: 'Failed to load grade items' });
  }
}

export async function createGradeItem(req, res) {
  try {
    const userId = req.user.id;
    const name = req.body?.name ? String(req.body.name).trim().slice(0, 200) : '';
    const courseId = req.body?.course_id ? String(req.body.course_id) : null;
    const score = safeFloat(req.body?.score, 0);
    const maxScore = Math.max(1, safeFloat(req.body?.max_score, 100));
    const weight = Math.max(0, safeFloat(req.body?.weight, 1));

    if (!name) return res.status(400).json({ error: 'name is required' });

    const { data, error } = await supabase
      .from('grade_items')
      .insert({ user_id: userId, course_id: courseId, name, score, max_score: maxScore, weight })
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, item: data });
  } catch (error) {
    console.error('Create grade item error:', error);
    res.status(500).json({ error: 'Failed to create grade item' });
  }
}

export async function deleteGradeItem(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { error } = await supabase.from('grade_items').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Delete grade item error:', error);
    res.status(500).json({ error: 'Failed to delete grade item' });
  }
}

export async function getGpaSummary(req, res) {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase.from('grade_items').select('score, max_score, weight').eq('user_id', userId).limit(2000);
    if (error) throw error;

    let weightSum = 0;
    let gpaSum = 0;
    for (const row of data || []) {
      const maxScore = Math.max(1, safeFloat(row.max_score, 100));
      const pct = (safeFloat(row.score, 0) / maxScore) * 100;
      const gpa = percentToGpa(pct);
      const w = Math.max(0, safeFloat(row.weight, 1));
      weightSum += w;
      gpaSum += gpa * w;
    }

    const gpa = weightSum > 0 ? gpaSum / weightSum : 0;
    res.json({ success: true, gpa: Number(gpa.toFixed(2)), itemsCount: (data || []).length });
  } catch (error) {
    console.error('GPA summary error:', error);
    res.status(500).json({ error: 'Failed to compute GPA' });
  }
}

// =========================
// Schedule blocks
// =========================

export async function listScheduleBlocks(req, res) {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('schedule_blocks')
      .select('*')
      .eq('user_id', userId)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(2000);
    if (error) throw error;
    res.json({ success: true, blocks: data || [] });
  } catch (error) {
    console.error('List schedule blocks error:', error);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
}

export async function createScheduleBlock(req, res) {
  try {
    const userId = req.user.id;
    const day = Math.min(6, Math.max(0, safeInt(req.body?.day_of_week, 1)));
    const startTime = req.body?.start_time ? String(req.body.start_time) : null;
    const endTime = req.body?.end_time ? String(req.body.end_time) : null;
    const title = req.body?.title ? String(req.body.title).trim().slice(0, 120) : '';

    if (!startTime || !endTime || !title) return res.status(400).json({ error: 'title, start_time, end_time are required' });

    const { data, error } = await supabase
      .from('schedule_blocks')
      .insert({ user_id: userId, day_of_week: day, start_time: startTime, end_time: endTime, title })
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, block: data });
  } catch (error) {
    console.error('Create schedule block error:', error);
    res.status(500).json({ error: 'Failed to create block' });
  }
}

export async function deleteScheduleBlock(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { error } = await supabase.from('schedule_blocks').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Delete schedule block error:', error);
    res.status(500).json({ error: 'Failed to delete block' });
  }
}

