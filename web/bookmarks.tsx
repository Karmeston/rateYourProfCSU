import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon } from './icons';

const storageKey = 'csu-saved-courses-v1';
const maxSaved = 100;
function readSaved(value: string | null): number[] {
  try {
    const ids: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(ids)
      ? [
          ...new Set(
            ids.filter(
              (id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id !== 0,
            ),
          ),
        ].slice(0, maxSaved)
      : [];
  } catch {
    return [];
  }
}
type Bookmarks = { ids: number[]; message: string; toggle: (id: number, name: string) => void };
const SavedContext = createContext<Bookmarks | null>(null);

export function SavedCoursesProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState(() => {
    try {
      return readSaved(localStorage.getItem(storageKey));
    } catch {
      return [];
    }
  });
  const [message, setMessage] = useState('');
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setIds(readSaved(event.newValue));
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);
  function toggle(id: number, name: string) {
    const saved = ids.includes(id);
    if (!saved && ids.length >= maxSaved) {
      setMessage('最多收藏 100 门课程，可以先取消不再需要的课程。');
      return;
    }
    const next = saved ? ids.filter((value) => value !== id) : [...ids, id];
    setIds(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setMessage(saved ? `已取消收藏「${name}」` : `已收藏「${name}」`);
    } catch {
      setMessage('已在本次浏览中更新收藏；浏览器未能保存到本机。');
    }
  }
  return (
    <SavedContext.Provider value={{ ids, toggle, message }}>
      {children}
      <div className={`toast${message ? ' toast-visible' : ''}`} role="status" aria-live="polite">
        {message && (
          <>
            <Icon name="check" />
            {message}
          </>
        )}
      </div>
    </SavedContext.Provider>
  );
}
export function useSavedCourses() {
  const value = useContext(SavedContext);
  if (!value) throw new Error('SavedCoursesProvider is required');
  return value;
}
export function SaveButton({
  id,
  name,
  label = false,
}: {
  id: number;
  name: string;
  label?: boolean;
}) {
  const { ids, toggle } = useSavedCourses();
  const saved = ids.includes(id);
  return (
    <button
      type="button"
      className={label ? 'secondary-button save-button' : 'icon-button save-button'}
      aria-label={`${saved ? '取消收藏' : '收藏'}${name}`}
      aria-pressed={saved}
      title={saved ? '取消收藏' : '收藏课程'}
      onClick={() => toggle(id, name)}
    >
      <Icon name="bookmark" />
      {label && (saved ? '已收藏' : '收藏课程')}
    </button>
  );
}
