import { Moon, Sun, LogOut, MessageSquare } from 'lucide-react';
import { FeedbackDialog } from '../common/FeedbackDialog';
import { useState, useEffect } from 'react';
import { logout } from '../../services/api';

const THEME_STORAGE_KEY = 'lunetta_theme_v2';

export function Nav() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) !== 'light';
    } catch {
      return true;
    }
  });
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const toggleTheme = () => {
    setDark(prev => {
      const next = !prev;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-indigo-900/50 dark:bg-[#0e102b]/85">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <a href="/" className="text-xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400">
          Lunetta
        </a>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setFeedbackOpen(true)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            title="Feedback & bug reports"
          >
            <MessageSquare size={18} /><span className="hidden sm:inline">Feedback</span>
          </button>
          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={logout}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </nav>
  );
}
