import { supabase } from '../utils/supabaseClient.js';

// Add email to waitlist
export async function addToWaitlist(req, res) {
  try {
    const { email, tool_name, tool_id } = req.body;

    if (!email || !tool_name) {
      return res.status(400).json({ error: 'Email and tool name are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if already on waitlist for this tool
    const { data: existing, error: checkError } = await supabase
      .from('waitlist')
      .select('id')
      .eq('email', email.toLowerCase())
      .eq('tool_id', tool_id)
      .single();

    if (existing) {
      return res.json({ message: 'Already on waitlist for this tool' });
    }

    // Add to waitlist
    const { data, error } = await supabase
      .from('waitlist')
      .insert([
        {
          email: email.toLowerCase().trim(),
          tool_name: tool_name,
          tool_id: tool_id
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Successfully added to waitlist',
      data
    });

  } catch (error) {
    console.error('Error adding to waitlist:', error);
    res.status(500).json({ error: 'Failed to add to waitlist' });
  }
}

// Get waitlist count for a tool (optional admin endpoint)
export async function getWaitlistCount(req, res) {
  try {
    const { tool_id } = req.params;

    const { count, error } = await supabase
      .from('waitlist')
      .select('*', { count: 'exact', head: true })
      .eq('tool_id', tool_id);

    if (error) throw error;

    res.json({ tool_id, count });

  } catch (error) {
    console.error('Error getting waitlist count:', error);
    res.status(500).json({ error: 'Failed to get waitlist count' });
  }
}
