export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_error_logs: {
        Row: {
          created_at: string
          error_code: string
          id: string
          internal_message: string | null
          message_ts: string | null
          notes: string | null
          person_id: string | null
          provider: string | null
          raw_error: Json | null
          resolved: boolean
          retryable: boolean
          severity: string
          slack_channel_id: string | null
          thread_ts: string | null
          updated_at: string
          user_facing_message: string | null
        }
        Insert: {
          created_at?: string
          error_code: string
          id?: string
          internal_message?: string | null
          message_ts?: string | null
          notes?: string | null
          person_id?: string | null
          provider?: string | null
          raw_error?: Json | null
          resolved?: boolean
          retryable?: boolean
          severity: string
          slack_channel_id?: string | null
          thread_ts?: string | null
          updated_at?: string
          user_facing_message?: string | null
        }
        Update: {
          created_at?: string
          error_code?: string
          id?: string
          internal_message?: string | null
          message_ts?: string | null
          notes?: string | null
          person_id?: string | null
          provider?: string | null
          raw_error?: Json | null
          resolved?: boolean
          retryable?: boolean
          severity?: string
          slack_channel_id?: string | null
          thread_ts?: string | null
          updated_at?: string
          user_facing_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_error_logs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_logs: {
        Row: {
          created_at: string
          estimated_cost: number
          has_image: boolean
          id: string
          input_tokens: number
          latency_ms: number | null
          message_ts: string
          model: string
          output_tokens: number
          person_id: string
          slack_channel_id: string
          thread_ts: string
          total_tokens: number
        }
        Insert: {
          created_at?: string
          estimated_cost?: number
          has_image?: boolean
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          message_ts: string
          model: string
          output_tokens?: number
          person_id: string
          slack_channel_id: string
          thread_ts: string
          total_tokens?: number
        }
        Update: {
          created_at?: string
          estimated_cost?: number
          has_image?: boolean
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          message_ts?: string
          model?: string
          output_tokens?: number
          person_id?: string
          slack_channel_id?: string
          thread_ts?: string
          total_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_logs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          file_size: number | null
          file_type: string
          height: number | null
          id: string
          message_ts: string
          mime_type: string | null
          ocr_text: string | null
          original_name: string | null
          person_id: string | null
          slack_channel_id: string
          slack_file_id: string
          status: string
          storage_path: string | null
          thread_ts: string
          width: number | null
        }
        Insert: {
          created_at?: string
          file_size?: number | null
          file_type: string
          height?: number | null
          id?: string
          message_ts: string
          mime_type?: string | null
          ocr_text?: string | null
          original_name?: string | null
          person_id?: string | null
          slack_channel_id: string
          slack_file_id: string
          status?: string
          storage_path?: string | null
          thread_ts: string
          width?: number | null
        }
        Update: {
          created_at?: string
          file_size?: number | null
          file_type?: string
          height?: number | null
          id?: string
          message_ts?: string
          mime_type?: string | null
          ocr_text?: string | null
          original_name?: string | null
          person_id?: string | null
          slack_channel_id?: string
          slack_file_id?: string
          status?: string
          storage_path?: string | null
          thread_ts?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempt_count: number
          created_at: string
          error_code: string | null
          finished_at: string | null
          id: string
          job_type: string
          max_attempts: number
          payload: Json
          scheduled_at: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          job_type: string
          max_attempts?: number
          payload: Json
          scheduled_at?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          job_type?: string
          max_attempts?: number
          payload?: Json
          scheduled_at?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      learning_concepts: {
        Row: {
          archived_at: string | null
          concept: string
          created_at: string
          difficulty: number
          due: string
          elapsed_days: number
          id: string
          lapses: number
          last_review: string | null
          person_id: string
          reps: number
          scheduled_days: number
          source_misconception: string | null
          stability: number
          state: number
          subject: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          concept: string
          created_at?: string
          difficulty?: number
          due?: string
          elapsed_days?: number
          id?: string
          lapses?: number
          last_review?: string | null
          person_id: string
          reps?: number
          scheduled_days?: number
          source_misconception?: string | null
          stability?: number
          state?: number
          subject?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          concept?: string
          created_at?: string
          difficulty?: number
          due?: string
          elapsed_days?: number
          id?: string
          lapses?: number
          last_review?: string | null
          person_id?: string
          reps?: number
          scheduled_days?: number
          source_misconception?: string | null
          stability?: number
          state?: number
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_concepts_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      persons: {
        Row: {
          created_at: string
          display_name: string | null
          grade: string | null
          guardian_email: string | null
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          grade?: string | null
          guardian_email?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          grade?: string | null
          guardian_email?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      report_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          embedding: string | null
          id: string
          metadata: Json | null
          person_id: string
          report_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          person_id: string
          report_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          person_id?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_chunks_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_chunks_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          body_markdown: string | null
          created_at: string
          created_by: string | null
          embeddings_updated_at: string | null
          error_message: string | null
          generated_by_ai: boolean
          id: string
          is_ai_reference: boolean
          person_id: string
          report_month: string
          slack_message_ts: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          body_markdown?: string | null
          created_at?: string
          created_by?: string | null
          embeddings_updated_at?: string | null
          error_message?: string | null
          generated_by_ai?: boolean
          id?: string
          is_ai_reference?: boolean
          person_id: string
          report_month: string
          slack_message_ts?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          body_markdown?: string | null
          created_at?: string
          created_by?: string | null
          embeddings_updated_at?: string | null
          error_message?: string | null
          generated_by_ai?: boolean
          id?: string
          is_ai_reference?: boolean
          person_id?: string
          report_month?: string
          slack_message_ts?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_channel_bindings: {
        Row: {
          created_at: string
          default_report_id: string | null
          id: string
          person_id: string
          person_name_snapshot: string | null
          slack_channel_id: string
          slack_channel_name: string | null
          slack_team_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_report_id?: string | null
          id?: string
          person_id: string
          person_name_snapshot?: string | null
          slack_channel_id: string
          slack_channel_name?: string | null
          slack_team_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_report_id?: string | null
          id?: string
          person_id?: string
          person_name_snapshot?: string | null
          slack_channel_id?: string
          slack_channel_name?: string | null
          slack_team_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_channel_bindings_default_report_id_fkey"
            columns: ["default_report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slack_channel_bindings_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_event_receipts: {
        Row: {
          event_id: string
          event_ts: string | null
          event_type: string
          id: string
          processed_at: string | null
          received_at: string
          slack_team_id: string
          status: string
        }
        Insert: {
          event_id: string
          event_ts?: string | null
          event_type: string
          id?: string
          processed_at?: string | null
          received_at?: string
          slack_team_id: string
          status?: string
        }
        Update: {
          event_id?: string
          event_ts?: string | null
          event_type?: string
          id?: string
          processed_at?: string | null
          received_at?: string
          slack_team_id?: string
          status?: string
        }
        Relationships: []
      }
      slack_messages: {
        Row: {
          created_at: string
          has_attachments: boolean
          id: string
          message_ts: string
          person_id: string | null
          raw_event: Json | null
          role: string
          slack_channel_id: string
          slack_team_id: string
          slack_user_id: string | null
          text: string | null
          thread_ts: string
        }
        Insert: {
          created_at?: string
          has_attachments?: boolean
          id?: string
          message_ts: string
          person_id?: string | null
          raw_event?: Json | null
          role: string
          slack_channel_id: string
          slack_team_id: string
          slack_user_id?: string | null
          text?: string | null
          thread_ts: string
        }
        Update: {
          created_at?: string
          has_attachments?: boolean
          id?: string
          message_ts?: string
          person_id?: string | null
          raw_event?: Json | null
          role?: string
          slack_channel_id?: string
          slack_team_id?: string
          slack_user_id?: string | null
          text?: string | null
          thread_ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_messages_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_thread_sessions: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          person_id: string
          report_id: string | null
          root_message_ts: string
          slack_channel_id: string
          slack_team_id: string
          status: string
          thread_summary: string | null
          thread_ts: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          person_id: string
          report_id?: string | null
          root_message_ts: string
          slack_channel_id: string
          slack_team_id: string
          status?: string
          thread_summary?: string | null
          thread_ts: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          person_id?: string
          report_id?: string | null
          root_message_ts?: string
          slack_channel_id?: string
          slack_team_id?: string
          status?: string
          thread_summary?: string | null
          thread_ts?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_thread_sessions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slack_thread_sessions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      student_episodic_memories: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          id: string
          importance: number
          person_id: string
          source_thread_ts: string | null
          superseded_by: string | null
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          importance: number
          person_id: string
          source_thread_ts?: string | null
          superseded_by?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          importance?: number
          person_id?: string
          source_thread_ts?: string | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_episodic_memories_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_episodic_memories_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "student_episodic_memories"
            referencedColumns: ["id"]
          },
        ]
      }
      student_knowledge_states: {
        Row: {
          attempt_count: number
          consecutive_correct: number
          created_at: string
          forgetting_applied_at: string | null
          id: string
          last_seen_at: string | null
          p_mastery: number
          person_id: string
          subject: string
          topic: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          consecutive_correct?: number
          created_at?: string
          forgetting_applied_at?: string | null
          id?: string
          last_seen_at?: string | null
          p_mastery?: number
          person_id: string
          subject: string
          topic: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          consecutive_correct?: number
          created_at?: string
          forgetting_applied_at?: string | null
          id?: string
          last_seen_at?: string | null
          p_mastery?: number
          person_id?: string
          subject?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_knowledge_states_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      student_profiles: {
        Row: {
          exam_mode_until: string | null
          exam_subjects: string[] | null
          id: string
          instruction_notes: string | null
          learning_style: string | null
          person_id: string
          strengths: string | null
          summary: string | null
          updated_at: string
          weaknesses: string | null
        }
        Insert: {
          exam_mode_until?: string | null
          exam_subjects?: string[] | null
          id?: string
          instruction_notes?: string | null
          learning_style?: string | null
          person_id: string
          strengths?: string | null
          summary?: string | null
          updated_at?: string
          weaknesses?: string | null
        }
        Update: {
          exam_mode_until?: string | null
          exam_subjects?: string[] | null
          id?: string
          instruction_notes?: string | null
          learning_style?: string | null
          person_id?: string
          strengths?: string | null
          summary?: string | null
          updated_at?: string
          weaknesses?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_profiles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
