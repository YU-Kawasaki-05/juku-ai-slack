export { chunkReport } from './lib/chunkReport'
export { searchChunks } from './lib/searchChunks'
export type { RagChunk, SearchChunksParams } from './lib/searchChunks'
export { rebuildReportEmbeddings } from './lib/rebuildReportEmbeddings'
export {
  getEmbeddingClient,
  createOpenAiCompatibleEmbeddingClient,
  __setEmbeddingClientForTest,
} from './lib/embeddingClient'
export type { EmbeddingClient } from './lib/embeddingClient'
