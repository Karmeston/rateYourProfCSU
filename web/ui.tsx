import type { ReactNode } from 'react';
import { Icon } from './icons';

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name="book" size={28} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="error-state" role="alert">
      <Icon name="info" size={28} />
      <h2>暂时无法加载</h2>
      <p>{message}</p>
      <button onClick={retry}>重新加载</button>
    </div>
  );
}
export function LoadingCards() {
  return (
    <div role="status">
      <span className="sr-only">正在加载课程…</span>
      <div className="course-list course-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="course-card skeleton-card" key={i}>
            <div className="skeleton skeleton-badge" />
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-footer" />
          </div>
        ))}
      </div>
    </div>
  );
}
