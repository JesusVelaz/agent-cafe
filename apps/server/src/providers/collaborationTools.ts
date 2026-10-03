import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { collaborationSpecs, type CollaborationTools } from '../orchestrator/collaboration.js';

/** The same validated tool schemas serve both harnesses. */
export const codexCollaborationTools = collaborationSpecs.map((spec) => ({
  type: 'function' as const, name: spec.name, description: spec.description,
  inputSchema: z.toJSONSchema(spec.schema),
}));

export function claudeCollaborationServer(collaboration: CollaborationTools) {
  return createSdkMcpServer({
    name: 'cafe', version: '1.0.0',
    tools: collaborationSpecs.map((spec) => tool(spec.name, spec.description, spec.schema.shape, async (input) => {
      try {
        const result = await collaboration.call(spec.name, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] };
      }
    })),
  });
}
