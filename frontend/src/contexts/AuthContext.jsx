import { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing token and validate it
    const token = localStorage.getItem('auth_token');
    const initAuth = async () => {
      if (token) {
        // Validate token by fetching current user
        try {
          const response = await axios.get(`${API_URL}/auth/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          setUser(response.data.user);
          setSession({ access_token: token });
        } catch {
          // Token is invalid, clear it
          localStorage.removeItem('auth_token');
          setUser(null);
          setSession(null);
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  const value = {
    user,
    session,
    loading,
    signUp: async (username, password, confirmPassword) => {
      try {
        const response = await axios.post(`${API_URL}/auth/signup`, {
          username,
          password,
          confirmPassword,
        });

        const { user, token } = response.data;

        // Store token in localStorage
        localStorage.setItem('auth_token', token);

        setUser(user);
        setSession({ access_token: token });

        return { data: { user }, error: null };
      } catch (error) {
        return {
          data: null,
          error: {
            message: error.response?.data?.error || 'Failed to sign up',
          },
        };
      }
    },
    signIn: async (username, password) => {
      try {
        const response = await axios.post(`${API_URL}/auth/login`, {
          username,
          password,
        });

        const { user, token } = response.data;

        // Store token in localStorage
        localStorage.setItem('auth_token', token);

        setUser(user);
        setSession({ access_token: token });

        return { data: { user }, error: null };
      } catch (error) {
        return {
          data: null,
          error: {
            message: error.response?.data?.error || 'Failed to sign in',
          },
        };
      }
    },
    signOut: async () => {
      // Clear token from localStorage
      localStorage.removeItem('auth_token');

      setUser(null);
      setSession(null);

      return { error: null };
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
