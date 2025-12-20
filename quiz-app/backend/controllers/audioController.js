import { supabase } from '../utils/supabaseClient.js';

function nowIso() {
  return new Date().toISOString();
}

export async function getAudioPreferences(req, res) {
  try {
    const userId = req.user.id;
    const toolId = req.query.toolId ? String(req.query.toolId) : 'focus-music';

    const { data, error } = await supabase
      .from('focus_audio_preferences')
      .select('*')
      .eq('user_id', userId)
      .eq('tool_id', toolId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({
      success: true,
      preferences: data || {
        user_id: userId,
        tool_id: toolId,
        volume: 0.5,
        preset_id: null,
        settings: {},
        updated_at: nowIso(),
      },
    });
  } catch (error) {
    console.error('Audio preferences get error:', error);
    res.status(500).json({ error: 'Failed to load preferences' });
  }
}

export async function upsertAudioPreferences(req, res) {
  try {
    const userId = req.user.id;
    const { tool_id, volume, preset_id, settings } = req.body;

    const toolId = tool_id ? String(tool_id) : 'focus-music';
    const payload = {
      user_id: userId,
      tool_id: toolId,
      volume: typeof volume === 'number' ? Math.min(1, Math.max(0, volume)) : 0.5,
      preset_id: preset_id ? String(preset_id).slice(0, 50) : null,
      settings: settings && typeof settings === 'object' ? settings : {},
      updated_at: nowIso(),
    };

    const { data, error } = await supabase
      .from('focus_audio_preferences')
      .upsert(payload, { onConflict: 'user_id,tool_id' })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, preferences: data });
  } catch (error) {
    console.error('Audio preferences upsert error:', error);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
}
