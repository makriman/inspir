import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabaseClient.js';
import {
  moderateContent,
  generateBlockedMessage,
  generateConversationTitle,
  estimateTokens,
  STUDENT_SYSTEM_PROMPT
} from '../utils/contentModeration.js';
import { logAuditEvent, AuditEventTypes, AuditActions, AuditStatus } from '../utils/auditLogger.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Allow overriding model via env but default to Claude Sonnet 4.5
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

/**
 * Create a new chat conversation
 */
export async function createConversation(req, res) {
  try {
    const userId = req.user?.id;
    const { title, folder } = req.body;

    console.log('[Chat] Create conversation request:', { userId, title, folder });

    if (!userId) {
      console.log('[Chat] No userId found in request');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { data: conversation, error } = await supabase
      .from('chat_conversations')
      .insert([
        {
          user_id: userId,
          title: title || 'New Chat',
          folder: folder || 'general',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('[Chat] Database error creating conversation:', error);
      throw error;
    }

    console.log('[Chat] Conversation created successfully:', conversation.id);
    res.json(conversation);
  } catch (error) {
    console.error('[Chat] Error creating conversation:', error);
    console.error('[Chat] Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to create conversation',
      message: error.message,
      details: error.details || error.hint || 'No additional details'
    });
  }
}

/**
 * Get all conversations for a user
 */
export async function getConversations(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { data: conversations, error } = await supabase
      .from('chat_conversations')
      .select('*')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false });

    if (error) {
      console.error('Error fetching conversations:', error.message);
      throw error;
    }

    res.json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error.message);
    res.status(500).json({
      error: 'Failed to fetch conversations',
      message: error.message
    });
  }
}

/**
 * Get messages for a specific conversation
 */
export async function getMessages(req, res) {
  try {
    const userId = req.user?.id;
    const { conversationId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify user owns this conversation
    const { data: conversation, error: convError } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();

    if (convError || !conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching messages:', error.message);
      throw error;
    }

    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error.message);
    res.status(500).json({
      error: 'Failed to fetch messages',
      message: error.message
    });
  }
}

/**
 * Send a message with streaming response
 */
export async function sendMessage(req, res) {
  console.log('[Chat] ===== SEND MESSAGE START =====');
  try {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    const { content } = req.body;

    console.log('[Chat] User ID:', userId);
    console.log('[Chat] Conversation ID:', conversationId);
    console.log('[Chat] Content:', content);

    if (!userId) {
      console.log('[Chat] ERROR: No user ID');
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Content moderation
    const moderation = moderateContent(content);
    if (!moderation.allowed) {
      return res.status(400).json({
        error: 'Content not allowed',
        message: generateBlockedMessage(moderation.reason),
        blocked: true
      });
    }

    // Verify user owns this conversation
    const { data: conversation, error: convError } = await supabase
      .from('chat_conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();

    if (convError || !conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Save user message
    const { data: userMessage, error: userMsgError } = await supabase
      .from('chat_messages')
      .insert([
        {
          conversation_id: conversationId,
          role: 'user',
          content: content.trim(),
          tokens_used: estimateTokens(content),
          was_flagged: moderation.flagged,
          moderation_reason: moderation.reason,
          created_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (userMsgError) {
      console.error('Error saving user message:', userMsgError.message);
      throw userMsgError;
    }

    // Get conversation history
    const { data: historyMessages, error: histError } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20); // Last 20 messages for context

    if (histError) {
      console.error('Error fetching history:', histError.message);
      throw histError;
    }

    // Format messages for Claude API
    const messages = historyMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Set up SSE (Server-Sent Events) for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let fullResponse = '';
    let tokenCount = 0;

    try {
      console.log('[Chat] Starting Claude API stream with model:', MODEL);
      console.log('[Chat] Message count:', messages.length);

      // Stream response from Claude
      const stream = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: STUDENT_SYSTEM_PROMPT,
        messages: messages,
        stream: true,
      });

      console.log('[Chat] Stream created successfully');

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          const text = event.delta.text;
          fullResponse += text;

          // Send chunk to client
          res.write(`data: ${JSON.stringify({ type: 'content', text })}\n\n`);
        }

        if (event.type === 'message_delta') {
          if (event.usage) {
            tokenCount = event.usage.output_tokens || 0;
          }
        }
      }

      // Save assistant message
      const { data: assistantMessage, error: assistMsgError } = await supabase
        .from('chat_messages')
        .insert([
          {
            conversation_id: conversationId,
            role: 'assistant',
            content: fullResponse,
            tokens_used: tokenCount,
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (assistMsgError) {
        console.error('Error saving assistant message:', assistMsgError.message);
      }

      // Auto-generate title if this is the first message
      if (historyMessages.length <= 1) {
        const autoTitle = generateConversationTitle(content);
        await supabase
          .from('chat_conversations')
          .update({ title: autoTitle })
          .eq('id', conversationId);
      }

      // Send completion event
      res.write(`data: ${JSON.stringify({
        type: 'done',
        messageId: assistantMessage?.id,
        tokens: tokenCount
      })}\n\n`);

      res.end();

    } catch (streamError) {
      console.error('[Chat] Streaming error:', streamError);
      console.error('[Chat] Error name:', streamError.name);
      console.error('[Chat] Error message:', streamError.message);
      console.error('[Chat] Error status:', streamError.status);
      console.error('[Chat] Error stack:', streamError.stack);

      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: streamError.message || 'Failed to generate response'
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    console.error('Error sending message:', error.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to send message',
        message: error.message
      });
    }
  }
}

/**
 * Delete a conversation
 */
export async function deleteConversation(req, res) {
  try {
    const userId = req.user?.id;
    const { conversationId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { error } = await supabase
      .from('chat_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting conversation:', error.message);
      throw error;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error.message);
    res.status(500).json({
      error: 'Failed to delete conversation',
      message: error.message
    });
  }
}

/**
 * Update conversation (title, folder, pin status)
 */
export async function updateConversation(req, res) {
  try {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    const { title, folder, is_pinned } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (folder !== undefined) updates.folder = folder;
    if (is_pinned !== undefined) updates.is_pinned = is_pinned;

    const { data: conversation, error } = await supabase
      .from('chat_conversations')
      .update(updates)
      .eq('id', conversationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating conversation:', error.message);
      throw error;
    }

    res.json(conversation);
  } catch (error) {
    console.error('Error updating conversation:', error.message);
    res.status(500).json({
      error: 'Failed to update conversation',
      message: error.message
    });
  }
}

/**
 * Search through all user's messages
 */
export async function searchMessages(req, res) {
  try {
    const userId = req.user?.id;
    const { query } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    // Get user's conversation IDs
    const { data: conversations, error: convError } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('user_id', userId);

    if (convError) {
      throw convError;
    }

    const conversationIds = conversations.map(c => c.id);

    // Full-text search using PostgreSQL
    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('id, conversation_id, role, content, created_at')
      .in('conversation_id', conversationIds)
      .textSearch('content', query, {
        type: 'websearch',
        config: 'english'
      })
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error searching messages:', error.message);
      throw error;
    }

    res.json(messages);
  } catch (error) {
    console.error('Error searching messages:', error.message);
    res.status(500).json({
      error: 'Failed to search messages',
      message: error.message
    });
  }
}
