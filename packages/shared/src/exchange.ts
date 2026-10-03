import type { TaskDTO } from './domain';

/** Legacy exchanges embedded routing and resume instructions in the visible prompt. */
export function exchangeMessage(task: Pick<TaskDTO, 'prompt' | 'exchangeKind' | 'exchange'>): string {
  if (!task.exchangeKind || task.exchange) return task.prompt;
  let message = task.prompt.replace(/^\[(?:Delegated task|Delegation result|Message) from [^\r\n]*\]\r?\n/, '');
  if (task.exchangeKind === 'result') {
    message = message.replace(/\r?\n\r?\nContinue the original request using this result\. Other delegated tasks may still be pending\.$/, '');
  }
  return message;
}
