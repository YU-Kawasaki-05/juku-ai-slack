export { chunkReport } from './lib/chunkReport'
export { searchChunks } from './lib/searchChunks'
export type { RagChunk, SearchChunksParams } from './lib/searchChunks'
export { rebuildReportEmbeddings } from './lib/rebuildReportEmbeddings'
export { needsEmbeddingRebuild } from './lib/embeddingFreshness'
export {
  getEmbeddingClient,
  createOpenAiCompatibleEmbeddingClient,
  __setEmbeddingClientForTest,
  EmbeddingNotConfiguredError,
  EmbeddingResponseInvalidError,
} from './lib/embeddingClient'
export type { EmbeddingClient } from './lib/embeddingClient'
