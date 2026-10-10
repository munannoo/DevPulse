import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReview } from '../../core/llm/schemas';
import { flowDiagram } from '../../core/review/flow';

test('flow diagrams validate line references, edge indexes and redacted labels', () => {
  const input = { file: 'app.ts', content: '', lineCount: 4, changedRanges: [{ start: 1, end: 3 }] };
  const flow = { nodes: [{ label: 'input', line: 1 }, { label: 'compute', line: 3 }], edges: [{ from: 0, to: 1, label: 'valid' }] };
  const finding = { file: 'app.ts', startLine: 1, endLine: 3, severity: 'warning', title: 'Guard input', explanation: 'Validate before computing.', flow };
  const review = (flow: unknown) => validateReview({ findings: [{ ...finding, flow }] }, input);
  assert.ok(flowDiagram(review(flow).findings[0].flow!).includes('→ L3 compute'));
  assert.throws(() => review({ ...flow, edges: [{ from: 0, to: 4 }] }));
  assert.throws(() => review({ ...flow, nodes: [{ label: 'input', line: 1 }, { label: 'unknown', line: 4 }] }));
  assert.throws(() => review({ ...flow, nodes: Array(7).fill({ label: 'input', line: 1 }) }));
  assert.equal(validateReview({ findings: [{ ...finding, flow: undefined }] }, input).findings[0].flow, undefined);
  assert.ok(!flowDiagram({ ...flow, nodes: [{ label: '```\ninput', line: 1 }, flow.nodes[1]] }).includes('```'));
});
