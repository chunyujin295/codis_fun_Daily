'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'daily-knowledge-theme';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setDark(document.documentElement.classList.contains('dark'));
      setMounted(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggleTheme() {
    const nextDark = !dark;
    document.documentElement.classList.toggle('dark', nextDark);
    document.documentElement.style.colorScheme = nextDark ? 'dark' : 'light';
    localStorage.setItem(STORAGE_KEY, nextDark ? 'dark' : 'light');
    setDark(nextDark);
  }

  const label = dark ? '切换到浅色主题' : '切换到深色主题';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <Sun className="theme-icon-sun" />
        <Moon className="theme-icon-moon" />
        <span className="theme-toggle-thumb" />
      </span>
      <span className="theme-toggle-label">
        {mounted ? (dark ? '深色' : '浅色') : '主题'}
      </span>
    </button>
  );
}
