// Centralized API base URL with sensible fallbacks for local and deployed environments
const API_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:3000/api');

export default API_URL;
