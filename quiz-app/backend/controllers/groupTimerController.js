import { supabase } from '../utils/supabaseClient.js';

function nowIso() {
  return new Date().toISOString();
}

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

async function createUniqueRoomCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomRoomCode();
    const { data, error } = await supabase
      .from('group_timer_rooms')
      .select('id')
      .eq('room_code', code)
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return code;
  }
  throw new Error('Failed to generate unique room code');
}

async function getRoomByCodeOr404(roomCode, res) {
  const { data: room, error } = await supabase
    .from('group_timer_rooms')
    .select('*')
    .eq('room_code', roomCode)
    .single();
  if (error) {
    res.status(404).json({ error: 'Room not found' });
    return null;
  }
  return room;
}

export async function createRoom(req, res) {
  try {
    const userId = req.user.id;
    const { title, focus_minutes, break_minutes } = req.body;

    const roomCode = await createUniqueRoomCode();
    const payload = {
      host_user_id: userId,
      room_code: roomCode,
      title: title ? String(title).slice(0, 200) : null,
      focus_minutes: Math.min(180, Math.max(1, safeInt(focus_minutes, 50))),
      break_minutes: Math.min(60, Math.max(1, safeInt(break_minutes, 10))),
      status: 'lobby',
      created_at: nowIso(),
    };

    const { data: room, error } = await supabase
      .from('group_timer_rooms')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    await supabase
      .from('group_timer_participants')
      .upsert({
        room_id: room.id,
        user_id: userId,
        last_seen_at: nowIso(),
      }, { onConflict: 'room_id,user_id' });

    res.json({ success: true, room });
  } catch (error) {
    console.error('Group timer create room error:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
}

export async function joinRoom(req, res) {
  try {
    const userId = req.user.id;
    const { roomCode } = req.params;
    const room = await getRoomByCodeOr404(roomCode, res);
    if (!room) return;

    const { error } = await supabase
      .from('group_timer_participants')
      .upsert({
        room_id: room.id,
        user_id: userId,
        last_seen_at: nowIso(),
      }, { onConflict: 'room_id,user_id' });
    if (error) throw error;

    res.json({ success: true, room });
  } catch (error) {
    console.error('Group timer join room error:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
}

export async function getRoomState(req, res) {
  try {
    const { roomCode } = req.params;
    const room = await getRoomByCodeOr404(roomCode, res);
    if (!room) return;

    const { data: participants, error } = await supabase
      .from('group_timer_participants')
      .select('user_id, joined_at, last_seen_at')
      .eq('room_id', room.id);
    if (error) throw error;

    res.json({
      success: true,
      room,
      participantCount: participants?.length || 0,
      participants: participants || [],
      serverTime: nowIso(),
    });
  } catch (error) {
    console.error('Group timer state error:', error);
    res.status(500).json({ error: 'Failed to fetch room state' });
  }
}

export async function startRoom(req, res) {
  try {
    const userId = req.user.id;
    const { roomCode } = req.params;
    const room = await getRoomByCodeOr404(roomCode, res);
    if (!room) return;

    if (room.host_user_id !== userId) {
      return res.status(403).json({ error: 'Only the host can start the room' });
    }

    const { data: updated, error } = await supabase
      .from('group_timer_rooms')
      .update({
        status: 'running',
        started_at: nowIso(),
      })
      .eq('id', room.id)
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, room: updated });
  } catch (error) {
    console.error('Group timer start room error:', error);
    res.status(500).json({ error: 'Failed to start room' });
  }
}

export async function heartbeat(req, res) {
  try {
    const userId = req.user.id;
    const { roomCode } = req.params;
    const room = await getRoomByCodeOr404(roomCode, res);
    if (!room) return;

    await supabase
      .from('group_timer_participants')
      .upsert({
        room_id: room.id,
        user_id: userId,
        last_seen_at: nowIso(),
      }, { onConflict: 'room_id,user_id' });

    res.json({ success: true, serverTime: nowIso() });
  } catch (error) {
    console.error('Group timer heartbeat error:', error);
    res.status(500).json({ error: 'Failed to update presence' });
  }
}

