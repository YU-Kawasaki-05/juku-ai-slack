/** @file
 * 機能: レポート本文（Markdown）の表示（SCR-08 プレビュー / SCR-09 詳細で共用）
 * セキュリティ: react-markdown は raw HTML をデフォルトで無効化する（XSS 対策）。
 *   rehype-raw は導入しないこと
 * @implements FR-16
 */
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components: Components = {
  h1: (props) => <h1 className="mb-3 mt-6 text-xl font-bold first:mt-0" {...props} />,
  h2: (props) => <h2 className="mb-2 mt-6 border-b pb-1 text-lg font-semibold first:mt-0" {...props} />,
  h3: (props) => <h3 className="mb-2 mt-4 text-base font-semibold" {...props} />,
  h4: (props) => <h4 className="mb-1 mt-3 text-sm font-semibold" {...props} />,
  p: (props) => <p className="my-3 leading-7 first:mt-0 last:mb-0" {...props} />,
  ul: (props) => <ul className="my-3 ml-6 list-disc space-y-1" {...props} />,
  ol: (props) => <ol className="my-3 ml-6 list-decimal space-y-1" {...props} />,
  li: (props) => <li className="leading-7" {...props} />,
  a: (props) => (
    <a
      className="text-primary underline underline-offset-4 hover:opacity-80"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  blockquote: (props) => (
    <blockquote className="my-3 border-l-2 pl-4 italic text-muted-foreground" {...props} />
  ),
  pre: (props) => (
    <pre
      className="my-3 overflow-x-auto rounded-md bg-muted p-4 font-mono text-sm [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  code: (props) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]" {...props} />
  ),
  table: (props) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: (props) => (
    <th className="border bg-muted/50 px-3 py-1.5 text-left font-medium" {...props} />
  ),
  td: (props) => <td className="border px-3 py-1.5 align-top" {...props} />,
  hr: (props) => <hr className="my-6" {...props} />,
}

export function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <div className="text-sm text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
