import type { Evidence } from '../shared/electives';

export function EvidenceLink({ evidence, demo = false, label }: {
  evidence: Evidence;
  demo?: boolean;
  label?: string;
}) {
  if (demo) return <span className="fine-print">虚构演示资料</span>;
  try {
    const url = new URL(evidence.sourceUrl);
    if (url.protocol !== 'https:') return <span className="pending">来源待核实</span>;
    return (
      <a href={url.href} target="_blank" rel="noopener noreferrer" title={evidence.sourceLocator}>
        {label ?? evidence.sourceLabel} ↗
      </a>
    );
  } catch {
    return <span className="pending">来源待核实</span>;
  }
}
