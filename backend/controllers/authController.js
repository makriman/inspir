import { supabase } from '../utils/supabaseClient.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { logAuditEvent, AuditEventTypes, AuditActions, AuditStatus } from '../utils/auditLogger.js';
import { sanitizeUsername } from '../utils/sanitizer.js';

// JWT_SECRET is validated at startup in server.js
const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10;

export async function signup(req, res) {
  try {
    const { username, password, confirmPassword } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required'
      });
    }

    // Sanitize and validate username
    let sanitizedUsername;
    try {
      sanitizedUsername = sanitizeUsername(username);
    } catch (error) {
      return res.status(400).json({
        error: error.message
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        error: 'Passwords do not match'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters'
      });
    }

    // Check if username already exists
    const { data: existingUsers } = await supabase
      .from('users')
      .select('id')
      .eq('username', sanitizedUsername)
      .limit(1);

    if (existingUsers && existingUsers.length > 0) {
      return res.status(400).json({
        error: 'Username already exists'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const { data: user, error } = await supabase
      .from('users')
      .insert([
        { username: sanitizedUsername, password_hash: passwordHash }
      ])
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return res.status(400).json({
        error: 'Failed to create user'
      });
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Log successful signup
    await logAuditEvent({
      eventType: AuditEventTypes.USER_SIGNUP,
      action: AuditActions.SIGNUP,
      status: AuditStatus.SUCCESS,
      req,
      userId: user.id,
      username: user.username,
      resourceType: 'user',
      resourceId: user.id
    });

    res.json({
      user: {
        id: user.id,
        username: user.username
      },
      token
    });
  } catch (error) {
    console.error('Signup error:', error);

    // Log failed signup
    await logAuditEvent({
      eventType: AuditEventTypes.USER_SIGNUP,
      action: AuditActions.SIGNUP,
      status: AuditStatus.FAILURE,
      req,
      username: req.body?.username,
      errorMessage: error.message
    });

    res.status(500).json({
      error: 'Failed to create account',
      message: error.message
    });
  }
}

export async function login(req, res) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required'
      });
    }

    // Get user from database
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .limit(1);

    if (error || !users || users.length === 0) {
      // Log failed login attempt
      await logAuditEvent({
        eventType: AuditEventTypes.AUTH_FAILURE,
        action: AuditActions.LOGIN,
        status: AuditStatus.FAILURE,
        req,
        username: username,
        errorMessage: 'Invalid username or password'
      });

      return res.status(401).json({
        error: 'Invalid username or password'
      });
    }

    const user = users[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      // Log failed login attempt
      await logAuditEvent({
        eventType: AuditEventTypes.AUTH_FAILURE,
        action: AuditActions.LOGIN,
        status: AuditStatus.FAILURE,
        req,
        username: username,
        errorMessage: 'Invalid password'
      });

      return res.status(401).json({
        error: 'Invalid username or password'
      });
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Log successful login
    await logAuditEvent({
      eventType: AuditEventTypes.USER_LOGIN,
      action: AuditActions.LOGIN,
      status: AuditStatus.SUCCESS,
      req,
      userId: user.id,
      username: user.username,
      resourceType: 'user',
      resourceId: user.id
    });

    res.json({
      user: {
        id: user.id,
        username: user.username
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);

    // Log login error
    await logAuditEvent({
      eventType: AuditEventTypes.AUTH_FAILURE,
      action: AuditActions.LOGIN,
      status: AuditStatus.FAILURE,
      req,
      username: req.body?.username,
      errorMessage: error.message
    });

    res.status(500).json({
      error: 'Failed to login',
      message: error.message
    });
  }
}

export async function logout(req, res) {
  try {
    // With JWT, logout is handled client-side by removing the token
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      error: 'Failed to logout',
      message: error.message
    });
  }
}

export async function getCurrentUser(req, res) {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        error: 'Not authenticated'
      });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      error: 'Failed to get user',
      message: error.message
    });
  }
}
