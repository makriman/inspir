import { useState } from 'react';
import Login from '../components/Login';
import Signup from '../components/Signup';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);

  return isLogin ? (
    <Login onToggle={() => setIsLogin(false)} />
  ) : (
    <Signup onToggle={() => setIsLogin(true)} />
  );
}
