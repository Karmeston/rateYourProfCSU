import { useRef, useState } from 'react';
import { browserId } from './browser-id';
import { useData } from './use-data';

type Stats = { likes: number; dislikes: number; myVote: number; replyCount: number };
type Replies = { replies: {id:string;body:string;created_at:string}[]; offset:number;hasMore:boolean };
async function send(url:string, method:string, body:unknown) {
  const response = await fetch(url, {method, headers:{'Content-Type':'application/json','X-Browser-ID':browserId()}, body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '提交失败，请重试。');
  return data;
}
function ReplyPanel({endpoint,onPosted}:{endpoint:string;onPosted:(count:number)=>void}) {
  const [offset,setOffset]=useState(0);
  const {data,error,retry}=useData<Replies>(`${endpoint}/replies?offset=${offset}`);
  const [body,setBody]=useState('');
  const [sending,setSending]=useState(false);
  const [message,setMessage]=useState('');
  const requestId=useRef(crypto.randomUUID());
  const busy=useRef(false);
  return <div className="reply-panel">
    {!data ? error ? <p role="alert">{error} <button onClick={retry}>重试</button></p> : <p role="status">正在加载…</p> : <>
      {data.replies.length ? <ul className="reply-list">{data.replies.map(row=><li key={row.id}><div className="review-meta"><span>匿名用户</span><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleDateString('zh-CN')}</time></div><p className="review-body">{row.body}</p></li>)}</ul> : <p className="metadata">暂无回复</p>}
      {(offset>0||data.hasMore)&&<nav className="pagination" aria-label="回复分页"><button disabled={!offset} onClick={()=>setOffset(offset-20)}>上一页</button><span>第 {offset/20+1} 页</span><button disabled={!data.hasMore} onClick={()=>setOffset(offset+20)}>下一页</button></nav>}
    </>}
    <form onSubmit={async event=>{
      event.preventDefault();if(busy.current||!body.trim())return;
      busy.current=true;setSending(true);setMessage('');
      try {const result=await send(`${endpoint}/replies`,'POST',{id:requestId.current,body});onPosted(result.replyCount);setBody('');requestId.current=crypto.randomUUID();setOffset(Math.floor(Math.max(0,result.replyCount-1)/20)*20);retry();setMessage('回复已发布。');}
      catch(cause){setMessage(cause instanceof Error && cause.name!=='TimeoutError' ? cause.message : '提交结果未确认，请原样重试。');}
      finally{busy.current=false;setSending(false);}
    }}>
      <label>回复<textarea required maxLength={1000} rows={3} value={body} disabled={sending} onChange={event=>{setBody(event.target.value);requestId.current=crypto.randomUUID();setMessage('');}} /></label>
      <div className="form-actions"><span className="metadata">{body.length} / 1000</span><button type="submit" disabled={sending||!body.trim()}>{sending?'提交中…':'发布回复'}</button></div>
      {message&&<p className="metadata" role="status">{message}</p>}
    </form>
  </div>;
}
export function ReviewInteractions({endpoint,initial}:{endpoint:string;initial:Stats}) {
  const [stats,setStats]=useState(initial);
  const [expanded,setExpanded]=useState(false);
  const [sending,setSending]=useState(false);
  const [error,setError]=useState('');
  const busy=useRef(false);
  async function vote(value:number){
    if(busy.current)return;busy.current=true;setSending(true);setError('');
    try{const result=await send(`${endpoint}/vote`,'PUT',{value:stats.myVote===value?0:value});setStats(old=>({...old,...result}));}
    catch{setError('投票结果未确认，请重试。');}
    finally{busy.current=false;setSending(false);}
  }
  return <>
    <div className="review-actions">
      <button aria-pressed={stats.myVote===1} disabled={sending} onClick={()=>void vote(1)}>赞 {stats.likes}</button>
      <button aria-pressed={stats.myVote===-1} disabled={sending} onClick={()=>void vote(-1)}>踩 {stats.dislikes}</button>
      <button aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>回复 {stats.replyCount}</button>
    </div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {expanded&&<ReplyPanel endpoint={endpoint} onPosted={replyCount=>setStats(old=>({...old,replyCount}))} />}
  </>;
}
