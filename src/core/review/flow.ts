export type CodeFlow = { nodes: Array<{ label: string; line: number }>; edges: Array<{ from: number; to: number; label?: string }> };

export function flowDiagram(flow: CodeFlow): string {
  const node = (index: number) => `L${flow.nodes[index].line} ${flow.nodes[index].label.replace(/[\r\n`]/g, ' ')}`;
  return flow.edges.map(edge => `${node(edge.from)}\n  └─${edge.label ? ` ${edge.label.replace(/[\r\n`]/g, ' ')} ` : ''}→ ${node(edge.to)}`).join('\n\n');
}
