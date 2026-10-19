import { useMemo } from 'react';
import { Wrench } from 'lucide-react';
import { useStore } from '../../store';
import { useModels } from '../../lib/use-models';
import { toolCallsIn } from '../../lib/tool-markup';
import { isAgentModel } from '../../lib/agents/agent-runtime';
import { HARNESS_AGENT_MODEL, isHarnessAgentModel } from '../../lib/atlas/dsh-bridge';
import { isViewerMode } from '../../lib/viewer';
import { useT } from '../../i18n';
import type { ThoughtData } from '../../types';

/** An answer that wrote a tool call as text (it did not run, see
 *  lib/tool-markup.ts) can go to the same model as an agent, which runs
 *  tools: pin the node to that agent entry and regenerate. Shown only where
 *  the catalog has such an entry for the model that wrote the answer. */
export function AgentRerunButton({ nodeId, data, size = 'sm' }: { nodeId: string; data: ThoughtData; size?: 'sm' | 'md' }) {
  const t = useT();
  const models = useModels();
  const setNodeModel = useStore((s) => s.setNodeModel);
  const rerunNode = useStore((s) => s.rerunNode);
  const calls = useMemo(() => toolCallsIn(data.response), [data.response]);
  const by = data.generatedBy?.[data.responseIndex] ?? undefined;
  if (isViewerMode || calls.length === 0 || !by || isAgentModel(by) || isHarnessAgentModel(by)) return null;
  const agent = `${HARNESS_AGENT_MODEL}/${by}`;
  if (!models?.models.some((m) => m.id === agent)) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); setNodeModel(nodeId, agent); void rerunNode(nodeId, {}); }}
      className={`rounded-full ${size === 'md' ? 'h-7 px-2.5 text-xs' : 'h-6 px-2 text-2xs'} inline-flex items-center gap-1 shrink-0 text-accent hover:bg-wash transition-colors`}
      title={t('node.agentRerunTitle')}
      data-agent-rerun
    >
      <Wrench size={size === 'md' ? 13 : 12} strokeWidth={1.75} /> {t('node.agentRerun')}
    </button>
  );
}
