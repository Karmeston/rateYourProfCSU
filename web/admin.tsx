import { useState } from 'react';
import {
  moderationKinds,
  actionLabels,
  type ModerationKind,
  type ModerationLog,
} from '../shared/admin';
import { useData } from './use-data';
import { AdminRequestError, AdminFailure, adminRequest } from './admin-api';
import { AdminOverviewPanel } from './admin-overview';
import { AdminContent } from './admin-content';
import './admin.css';

export default function Admin() {
  const session = useData<{ configured: boolean; authenticated: boolean }>('/api/admin/session');
  const [tab, setTab] = useState<ModerationKind | 'overview' | 'audit'>('overview');
  const [logoutError, setLogoutError] = useState(''),
    [leaving, setLeaving] = useState(false);
  async function logout() {
    if (leaving) return;
    setLeaving(true);
    setLogoutError('');
    try {
      await adminRequest('logout', {});
      session.retry();
    } catch {
      setLogoutError('退出结果未确认，请重试。');
    } finally {
      setLeaving(false);
    }
  }
  return (
    <div className="admin-page">
      <div className="admin-toolbar">
        <h1>管理后台</h1>
        <a href="#/courses">返回站点</a>
        {session.data?.authenticated && (
          <button disabled={leaving} onClick={() => void logout()}>
            {leaving ? '正在退出…' : '退出登录'}
          </button>
        )}
      </div>
      {session.error ? (
        <AdminFailure
          error={session.error}
          status={session.status}
          retry={session.retry}
          relogin={session.retry}
        />
      ) : !session.data ? (
        <p role="status">正在检查管理会话…</p>
      ) : !session.data.configured ? (
        <p>
          后台尚未启用，请维护者先按照
          <a
            href="https://github.com/Karmeston/rateYourProfCSU/blob/main/docs/admin.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            后台配置说明
          </a>
          设置管理员口令。
        </p>
      ) : !session.data.authenticated ? (
        <Login received={session.retry} />
      ) : (
        <>
          {logoutError && (
            <p role="alert" className="form-error">
              {logoutError}
            </p>
          )}
          <nav className="admin-tabs" aria-label="后台功能">
            {[['overview', '概况'], ...Object.entries(moderationKinds), ['audit', '操作日志']].map(
              ([key, name]) => (
                <button
                  key={key}
                  aria-current={tab === key ? 'page' : undefined}
                  onClick={() => setTab(key as typeof tab)}
                >
                  {name}
                </button>
              ),
            )}
          </nav>
          {tab === 'overview' ? (
            <AdminOverviewPanel relogin={session.retry} />
          ) : tab === 'audit' ? (
            <Audit relogin={session.retry} />
          ) : (
            <AdminContent key={tab} kind={tab} relogin={session.retry} />
          )}
        </>
      )}
    </div>
  );
}
function Login({ received }: { received: () => void }) {
  const [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await adminRequest('login', { password });
      setPassword('');
      received();
    } catch (cause) {
      setError(cause instanceof AdminRequestError ? cause.message : '连接失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="admin-login" onSubmit={(event) => void login(event)}>
      <h2>管理员登录</h2>
      <label>
        管理口令{' '}
        <input
          type="password"
          required
          minLength={16}
          maxLength={256}
          autoComplete="current-password"
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? '正在登录…' : '登录后台'}
      </button>
      <p className="fine-print">管理会话最长8小时；退出登录会使当前会话失效。</p>
    </form>
  );
}
function Audit({ relogin }: { relogin: () => void }) {
  const [offset, setOffset] = useState(0);
  const { data, error, status, retry } = useData<{ items: ModerationLog[]; hasMore: boolean }>(
    `/api/admin/audit?offset=${offset}`,
  );
  return (
    <section>
      <div className="admin-toolbar">
        <h2>操作日志</h2>
        <button onClick={retry}>刷新</button>
      </div>
      {error ? (
        <AdminFailure {...{ error, status, retry, relogin }} />
      ) : !data ? (
        <p role="status">正在加载日志…</p>
      ) : (
        <>
          {!data.items.length && <p>暂无处理记录。</p>}
          <ul className="admin-items">
            {data.items.map((row) => (
              <li key={row.id}>
                <strong>
                  {moderationKinds[row.target_kind]} · {actionLabels[row.action]}
                </strong>
                <p className="review-body">{row.reason}</p>
                <p className="fine-print">
                  {row.actor === 'admin' ? '网页管理' : '命令行'} ·{' '}
                  {new Date(row.created_at).toLocaleString('zh-CN')} ·{' '}
                  {row.target_revision === null ? '历史记录' : `版本 ${row.target_revision}`}
                </p>
                <code>{row.target_id}</code>
              </li>
            ))}
          </ul>
          <nav className="pagination" aria-label="操作日志分页">
            <button disabled={!offset} onClick={() => setOffset(offset - 20)}>
              上一页
            </button>
            <span>第 {offset / 20 + 1} 页</span>
            <button disabled={!data.hasMore} onClick={() => setOffset(offset + 20)}>
              下一页
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
