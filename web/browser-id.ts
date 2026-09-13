let memoryId: string | undefined;
export function browserId() {
  if (memoryId) return memoryId;
  try {
    const stored = localStorage.getItem('rateMyProfCSU.browserId');
    memoryId = stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored) ? stored : crypto.randomUUID();
    localStorage.setItem('rateMyProfCSU.browserId', memoryId);
  } catch { memoryId = crypto.randomUUID(); }
  return memoryId;
}
