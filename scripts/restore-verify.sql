-- =============================================================================
--  リストア後の検証クエリ（読み取り専用）
-- =============================================================================
--  ⚠️ このファイルは PUBLIC な GitHub リポジトリにある。
--     接続文字列・パスワード・実データを書き込まないこと。
--
--  使い方（リストア先の DB に対して実行する）:
--    psql "$SUPABASE_DB_URL" -f scripts/restore-verify.sql
--
--    psql が無い場合（macOS など）:
--      docker run --rm -i -v "$PWD/scripts:/s:ro" \
--        public.ecr.aws/supabase/postgres:17.6.1.136 \
--        psql "$SUPABASE_DB_URL" -f /s/restore-verify.sql
--
--  手順書: docs/03_技術設計/09_バックアップとリストア.md
--  「期待値」列と一致しなければリストアは未完了。
-- =============================================================================
\pset pager off
\timing off

\echo '=== 1. スキーマ（期待値: 下の expected 列と一致） ==='
select 'public のテーブル数'        as item, count(*)::text as actual, '16' as expected
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
union all
select 'RLS 有効なテーブル数', count(*)::text, '16'
  from pg_tables where schemaname = 'public' and rowsecurity
union all
select 'RLS ポリシー数', count(*)::text, '16'
  from pg_policies where schemaname = 'public'
union all
select 'public のインデックス数', count(*)::text, '61'
  from pg_indexes where schemaname = 'public'
union all
select 'public のトリガー数（内部除く）', count(*)::text, '10'
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal
union all
select 'migration 履歴の本数', coalesce((
    select count(*)::text from supabase_migrations.schema_migrations
  ), '0（未修復）'), '32'
;

\echo ''
\echo '=== 2. 必須テーブルの欠落チェック（0 行ならOK） ==='
select missing as "欠落しているテーブル"
  from unnest(array[
    'persons','student_profiles','reports','report_chunks',
    'slack_channel_bindings','slack_thread_sessions','slack_messages','attachments',
    'ai_usage_logs','ai_error_logs','slack_event_receipts','jobs',
    'student_knowledge_states','student_episodic_memories','learning_concepts','kill_switches'
  ]) as missing
 where to_regclass('public.' || missing) is null;

\echo ''
\echo '=== 3. 必須の関数・拡張の欠落チェック（0 行ならOK） ==='
select 'function: ' || f as "欠落"
  from unnest(array[
    'match_report_chunks','rebuild_report_chunks','is_staff_or_admin',
    'admin_usage_summary','admin_usage_analytics','admin_used_models','admin_thread_list',
    'set_updated_at','set_reports_updated_at'
  ]) as f
 where not exists (
   select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f)
union all
select 'extension: ' || e
  from unnest(array['vector','pgcrypto','uuid-ossp','pg_net']) as e
 where not exists (select 1 from pg_extension where extname = e);

\echo ''
\echo '=== 4. 行数（バックアップの MANIFEST の row counts と突き合わせる） ==='
select 'persons'                   as "table", count(*) as rows from persons
union all select 'student_profiles',          count(*) from student_profiles
union all select 'reports',                   count(*) from reports
union all select 'report_chunks',             count(*) from report_chunks
union all select 'slack_channel_bindings',    count(*) from slack_channel_bindings
union all select 'slack_thread_sessions',     count(*) from slack_thread_sessions
union all select 'slack_messages',            count(*) from slack_messages
union all select 'attachments',               count(*) from attachments
union all select 'ai_usage_logs',             count(*) from ai_usage_logs
union all select 'ai_error_logs',             count(*) from ai_error_logs
union all select 'slack_event_receipts',      count(*) from slack_event_receipts
union all select 'jobs',                      count(*) from jobs
union all select 'student_knowledge_states',  count(*) from student_knowledge_states
union all select 'student_episodic_memories', count(*) from student_episodic_memories
union all select 'learning_concepts',         count(*) from learning_concepts
union all select 'kill_switches',             count(*) from kill_switches
union all select 'auth.users（スタッフ）',      count(*) from auth.users
order by 1;

\echo ''
\echo '=== 5. 中身の健全性（NG が 1 つでもあれば未完了） ==='
-- embedding は 1536 次元。text にキャストされて壊れていないかを見る
select 'embedding の次元' as item,
       coalesce((select distinct vector_dims(embedding)::text from report_chunks limit 1), 'no rows') as actual,
       case when not exists (select 1 from report_chunks) then 'SKIP（chunk 0 件）'
            when (select bool_and(vector_dims(embedding) = 1536) from report_chunks) then 'OK'
            else 'NG' end as judge
union all
-- 自己参照 FK。--data-only ダンプで pg_dump が循環 FK 警告を出す箇所
select '自己参照 FK（superseded_by）',
       (select count(*)::text from student_episodic_memories where superseded_by is not null),
       case when not exists (select 1 from student_episodic_memories m
                              where m.superseded_by is not null
                                and not exists (select 1 from student_episodic_memories x where x.id = m.superseded_by))
            then 'OK' else 'NG（参照先が無い）' end
union all
-- 日本語・改行が化けていないか
select '日本語テキスト',
       coalesce((select left(name, 12) from persons order by created_at limit 1), 'no rows'),
       case when exists (select 1 from persons where name ~ '[^\x00-\x7F]') then 'OK'
            when not exists (select 1 from persons) then 'SKIP（0 件）'
            else '要目視（ASCII のみ）' end
union all
-- 権限。service_role で読めて anon で読めないのが正しい状態
select 'GRANT: service_role → persons',
       has_table_privilege('service_role', 'public.persons', 'SELECT')::text,
       case when has_table_privilege('service_role', 'public.persons', 'SELECT') then 'OK' else 'NG' end
union all
select 'GRANT: anon → persons（false が正）',
       has_table_privilege('anon', 'public.persons', 'SELECT')::text,
       case when has_table_privilege('anon', 'public.persons', 'SELECT') then 'NG' else 'OK' end;

\echo ''
\echo '=== 6. RAG の RPC が動くか（chunk が 0 件なら SKIP） ==='
select count(*) as "match_report_chunks が返した件数"
  from report_chunks rc,
       lateral match_report_chunks(rc.person_id, rc.embedding, 5, 0.0)
 where rc.id = (select id from report_chunks limit 1);

\echo ''
\echo '=== 7. Storage（実ファイルはこのダンプに含まれない） ==='
select 'storage.buckets' as item, count(*)::text as rows from storage.buckets
union all
select 'storage.objects（メタデータのみ。実ファイルは別途）', count(*)::text from storage.objects;
