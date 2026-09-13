// 不信任 Content-Length，按实际读取字节限制请求体。
export async function readBody(request: Request) {
  if (!request.body) return { error: '请填写评价', status: 400 as const };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return { error: '评价内容过长', status: 413 as const };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { error: '请求格式不正确', status: 400 as const };
  } finally { reader.releaseLock(); }
}
