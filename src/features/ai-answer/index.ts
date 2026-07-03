export { selectMode } from './lib/selectMode'
export { calculateCost } from './lib/calculateCost'
export { buildPrompt } from './lib/buildPrompt'
export type { BuildPromptInput } from './lib/buildPrompt'
export { generateAnswer } from './lib/generateAnswer'
export type { GenerateAnswerInput } from './lib/generateAnswer'
export { getLlmClient, __setLlmClientForTest } from './lib/llm/getLlmClient'
export type { TutorMode, SelectModeInput } from './types'
export type {
  LlmClient,
  LlmMessage,
  LlmGenerateParams,
  LlmResult,
  LlmUsage,
  LlmRole,
} from './lib/llm/types'
