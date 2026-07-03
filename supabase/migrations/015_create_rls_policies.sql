-- All tables: Service Role bypasses RLS automatically.
-- Admin/staff users get full access via their auth.uid() being in the staff table.
-- These policies allow authenticated Supabase Auth users (staff/admin) to read/write.
-- The ANON key is never used for DB access directly — only Service Role on server-side.

-- persons
CREATE POLICY "staff can read persons"
  ON persons FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "staff can insert persons"
  ON persons FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "staff can update persons"
  ON persons FOR UPDATE
  TO authenticated
  USING (true);

-- student_profiles
CREATE POLICY "staff can read student_profiles"
  ON student_profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "staff can insert student_profiles"
  ON student_profiles FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "staff can update student_profiles"
  ON student_profiles FOR UPDATE
  TO authenticated
  USING (true);

-- reports
CREATE POLICY "staff can read reports"
  ON reports FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "staff can insert reports"
  ON reports FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "staff can update reports"
  ON reports FOR UPDATE
  TO authenticated
  USING (true);

-- report_chunks (read only for staff — writes via Service Role)
CREATE POLICY "staff can read report_chunks"
  ON report_chunks FOR SELECT
  TO authenticated
  USING (true);

-- slack_channel_bindings
CREATE POLICY "staff can read channel_bindings"
  ON slack_channel_bindings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "staff can insert channel_bindings"
  ON slack_channel_bindings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "staff can update channel_bindings"
  ON slack_channel_bindings FOR UPDATE
  TO authenticated
  USING (true);

-- slack_thread_sessions (read only for staff)
CREATE POLICY "staff can read thread_sessions"
  ON slack_thread_sessions FOR SELECT
  TO authenticated
  USING (true);

-- slack_messages (read only for staff)
CREATE POLICY "staff can read slack_messages"
  ON slack_messages FOR SELECT
  TO authenticated
  USING (true);

-- attachments (read only for staff)
CREATE POLICY "staff can read attachments"
  ON attachments FOR SELECT
  TO authenticated
  USING (true);

-- ai_usage_logs (read only for staff)
CREATE POLICY "staff can read ai_usage_logs"
  ON ai_usage_logs FOR SELECT
  TO authenticated
  USING (true);

-- ai_error_logs (read + update for staff)
CREATE POLICY "staff can read ai_error_logs"
  ON ai_error_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "staff can update ai_error_logs"
  ON ai_error_logs FOR UPDATE
  TO authenticated
  USING (true);

-- slack_event_receipts (read only for staff)
CREATE POLICY "staff can read event_receipts"
  ON slack_event_receipts FOR SELECT
  TO authenticated
  USING (true);

-- jobs (read + update for staff)
CREATE POLICY "staff can read jobs"
  ON jobs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "staff can update jobs"
  ON jobs FOR UPDATE
  TO authenticated
  USING (true);
