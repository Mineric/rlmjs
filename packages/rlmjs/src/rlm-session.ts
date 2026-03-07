import { ContextHandle, type CorpusStore } from "./corpus.js";
import {
  ReplController,
  buildReplCallGraph,
  buildReplRunHistory,
  createReplModelStack,
  type ReplCallGraphNode,
  type ReplChatLikeModel,
  type ReplControllerResult,
  type ReplModelStackOptions,
  type ReplRunHistoryNode
} from "./repl-controller.js";
import { ReplRuntime, type ReplRuntimeOptions } from "./repl-runtime.js";
import type { ReplStateStore } from "./repl-state-store.js";

export type RlmSessionOptions = {
  context: ContextHandle | CorpusStore;
  model: ReplChatLikeModel;
  recursiveModel?: ReplChatLikeModel;
  leafModel?: ReplChatLikeModel;
  sessionId?: string;
  stateStore?: ReplStateStore;
  initialState?: Record<string, unknown>;
  maxDepth?: number;
  maxChildCalls?: number;
  maxExecutionMs?: number;
  maxIterations?: number;
  maxObservationChars?: number;
  systemPrompt?: string;
  recursiveMaxIterations?: number;
  recursiveMaxObservationChars?: number;
  recursiveSystemPrompt?: string;
  leafSystemPrompt?: string;
  maxLeafContextBytes?: number;
};

export type RlmRunResult = ReplControllerResult & {
  graph: ReplCallGraphNode;
  history: ReplRunHistoryNode;
};

export class RlmSession {
  private readonly stack: ReturnType<typeof createReplModelStack>;
  private readonly runtime: ReplRuntime;
  private readonly controller: ReplController;

  constructor(options: RlmSessionOptions) {
    this.stack = createReplModelStack({
      model: options.model,
      recursiveModel: options.recursiveModel,
      leafModel: options.leafModel,
      recursiveMaxIterations: options.recursiveMaxIterations,
      recursiveMaxObservationChars: options.recursiveMaxObservationChars,
      recursiveSystemPrompt: options.recursiveSystemPrompt,
      leafSystemPrompt: options.leafSystemPrompt,
      maxLeafContextBytes: options.maxLeafContextBytes
    } satisfies ReplModelStackOptions);

    this.runtime = new ReplRuntime({
      context: options.context,
      onRecursiveCall: this.stack.onRecursiveCall,
      onLeafCall: this.stack.onLeafCall,
      initialState: options.initialState,
      sessionId: options.sessionId,
      stateStore: options.stateStore,
      maxChildCalls: options.maxChildCalls,
      maxExecutionMs: options.maxExecutionMs,
      maxDepth: options.maxDepth
    } satisfies ReplRuntimeOptions);

    this.controller = new ReplController({
      model: this.stack.model,
      runtime: this.runtime,
      maxIterations: options.maxIterations,
      maxObservationChars: options.maxObservationChars,
      systemPrompt: options.systemPrompt
    });
  }

  getRuntime(): ReplRuntime {
    return this.runtime;
  }

  getController(): ReplController {
    return this.controller;
  }

  getRecordedRuns(): ReadonlyMap<string, ReplControllerResult> {
    return this.stack.getRecordedRuns();
  }

  clearRecordedRuns(): void {
    this.stack.clearRecordedRuns();
  }

  async run(query: string): Promise<RlmRunResult> {
    const result = await this.controller.run(query);
    const recordedRuns = this.stack.getRecordedRuns();

    return {
      ...result,
      graph: buildReplCallGraph(result, recordedRuns),
      history: buildReplRunHistory(result, recordedRuns)
    };
  }
}

export function createRlm(options: RlmSessionOptions): RlmSession {
  return new RlmSession(options);
}
