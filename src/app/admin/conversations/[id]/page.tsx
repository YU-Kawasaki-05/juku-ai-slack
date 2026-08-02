/** @file
 * 機能: 会話ログ詳細（SCR-13 / FR-19）。スレッドのメッセージを時系列で表示
 * @implements FR-19
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Bot, GraduationCap, ImageIcon } from 'lucide-react'
import { createServerClient } from '@shared/lib/supabase/serverClient'
import { getThreadDetail, formatMessageTime } from '@features/conversation-logs'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { isUuid } from '../../searchParams'

export const metadata: Metadata = { title: '会話ログ詳細' }

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // UUID でない ID をそのままクエリすると Postgres 22P02 で 500 になるため事前に 404 に倒す（H-5）
  if (!isUuid(id)) notFound()
  const detail = await getThreadDetail(createServerClient(), id)
  if (!detail) notFound()

  const { session, channelName, messages } = detail

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{session.persons?.name ?? '会話ログ'}</h1>
        <p className="text-sm text-muted-foreground">
          {channelName ? `#${channelName}` : session.slack_channel_id} ／ 全 {messages.length} 件
          {session.person_id && (
            <>
              {' '}
              ／{' '}
              <Link
                href={`/admin/persons/${session.person_id}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                生徒ページ
              </Link>
            </>
          )}
        </p>
      </div>

      {session.thread_summary && (
        <Card>
          <CardContent className="pt-4">
            <p className="mb-1 text-xs font-medium text-muted-foreground">スレッド要約</p>
            <p className="text-sm leading-6">{session.thread_summary}</p>
          </CardContent>
        </Card>
      )}

      {messages.length === 0 ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          このスレッドのメッセージは見つかりませんでした
        </p>
      ) : (
        <ol className="space-y-4">
          {messages.map((m) => {
            const isBot = m.role === 'assistant'
            return (
              <li key={m.id} className={cn('flex gap-3', isBot ? 'flex-row' : 'flex-row-reverse')}>
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                    isBot
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                  aria-hidden="true"
                >
                  {isBot ? <Bot className="h-4 w-4" /> : <GraduationCap className="h-4 w-4" />}
                </div>
                <div className={cn('max-w-[75%] space-y-1', isBot ? 'items-start' : 'items-end')}>
                  <div
                    className={cn(
                      'flex items-center gap-2 text-xs text-muted-foreground',
                      isBot ? 'justify-start' : 'justify-end',
                    )}
                  >
                    <span className="font-medium">{isBot ? 'じゅくAI' : session.persons?.name ?? '生徒'}</span>
                    <span className="tabular-nums">{formatMessageTime(m.createdAt)}</span>
                  </div>
                  <div
                    className={cn(
                      'rounded-lg px-3 py-2 text-sm',
                      isBot ? 'bg-muted' : 'bg-primary text-primary-foreground',
                    )}
                  >
                    {m.text ? (
                      <p className="whitespace-pre-wrap break-words leading-6">{m.text}</p>
                    ) : (
                      <p className="italic opacity-70">（本文なし）</p>
                    )}
                    {m.hasAttachments && (
                      <p
                        className={cn(
                          'mt-1 flex items-center gap-1 text-xs',
                          isBot ? 'text-muted-foreground' : 'text-primary-foreground/80',
                        )}
                      >
                        <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        画像添付あり
                      </p>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
