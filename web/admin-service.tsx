import { useState } from 'react';
import { quotaOperations, serviceEvents, serviceGroups, type ServiceStatus } from '../shared/service-monitor';
import { AdminFailure } from './admin-api';
import { useData } from './use-data';

export function AdminService({ relogin }: { relogin: () => void }) {
  const [days, setDays] = useState('7');
  const { data, error, status, retry } = useData<ServiceStatus>(`/api/admin/service?days=${days}`);
  return (
    <section>
      <div className="admin-toolbar">
        <h2>运行状态</h2>
        <label>统计范围{' '}
          <select value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="7">近7天</option>
            <option value="30">近30天</option>
          </select>
        </label>
        <button onClick={retry}>刷新</button>
      </div>
      {error ? <AdminFailure {...{ error, status, retry, relogin }} /> : !data ? (
        <p role="status">正在加载运行统计…</p>
      ) : (
        <>
          <p className="fine-print">
            {data.firstDay ? `记录始于${data.firstDay}。` : '尚无运行记录。'}
            次数按北京时间汇总，保留30天。放行表示通过数据库预算检查，包含随后失败的操作。
            静态查课与缓存命中不在放行次数内。
          </p>
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead><tr>
                <th>功能</th><th>期间放行</th><th>单网络日限额拦截</th><th>全站日预算拦截</th><th>当前预算使用</th>
              </tr></thead>
              <tbody>
                {data.operations.map((row) => (
                  <tr key={row.operation}>
                    <th scope="row">{quotaOperations[row.operation]}</th>
                    <td>{row.allowed}</td><td>{row.networkLimited}</td><td>{row.budgetLimited}</td>
                    <td>{row.used.toLocaleString()} / {row.budget.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fine-print">
            当前预算使用值为服务内部估算权重，每天北京时间8点重置。Cloudflare实际读写用量需在其控制台核对。
          </p>
          <h3>已记录的接口异常</h3>
          <p className="fine-print">
            短时限流、数据库日额度耗尽及其他服务异常，每个服务实例每分钟最多采集60次。
            下表是已记录次数，突发流量下可能少计。采集不保存地址、搜索词或用户内容。
          </p>
          {data.signals.length ? (
            <table className="admin-table">
              <thead><tr><th>接口范围</th><th>异常</th><th>已记录次数</th></tr></thead>
              <tbody>{data.signals.map((row) => (
                <tr key={row.group + row.event}>
                  <th scope="row">{serviceGroups[row.group]}</th>
                  <td>{serviceEvents[row.event]}</td><td>{row.count}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p>所选期间尚无异常采集记录。</p>}
        </>
      )}
    </section>
  );
}
