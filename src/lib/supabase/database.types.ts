/**
 * Supabase Database types — hand-authored to match the SQL migrations in
 * `supabase/migrations/`. This is the same shape `supabase gen types
 * typescript` would emit; we author it by hand because generating from
 * the live project requires a Supabase access token in CI.
 *
 * KEEP IN SYNC WITH MIGRATIONS. When you add/alter a table or column,
 * update the matching Row/Insert/Update block here. Once the Supabase CLI
 * is wired into CI with an access token, replace this file with:
 *   supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Role = "super_admin" | "admin" | "creator" | "viewer";
export type AccessLevel = "read" | "write" | "admin";
export type Granularity = "day" | "week" | "month" | "total";

export interface Database {
  public: {
    Tables: {
      user_profile: {
        Row: {
          user_id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          role: Role;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          role: Role;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          role?: Role;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      podcast: {
        Row: {
          id: string;
          megaphone_id: string;
          title: string;
          subtitle: string | null;
          author: string | null;
          image_url: string | null;
          network_id: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          megaphone_id: string;
          title: string;
          subtitle?: string | null;
          author?: string | null;
          image_url?: string | null;
          network_id?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          megaphone_id?: string;
          title?: string;
          subtitle?: string | null;
          author?: string | null;
          image_url?: string | null;
          network_id?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_podcast_access: {
        Row: {
          user_id: string;
          podcast_id: string;
          access_level: AccessLevel;
          granted_by: string | null;
          granted_at: string;
        };
        Insert: {
          user_id: string;
          podcast_id: string;
          access_level?: AccessLevel;
          granted_by?: string | null;
          granted_at?: string;
        };
        Update: {
          user_id?: string;
          podcast_id?: string;
          access_level?: AccessLevel;
          granted_by?: string | null;
          granted_at?: string;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: number;
          actor_id: string | null;
          actor_email: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          metadata: Json;
          ip: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          actor_id?: string | null;
          actor_email?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: Json;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          actor_id?: string | null;
          actor_email?: string | null;
          action?: string;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: Json;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      cached_metric: {
        Row: {
          podcast_id: string;
          metric: string;
          granularity: Granularity;
          bucket_start: string;
          bucket_end: string;
          value: Json;
          fetched_at: string;
        };
        Insert: {
          podcast_id: string;
          metric: string;
          granularity: Granularity;
          bucket_start: string;
          bucket_end: string;
          value: Json;
          fetched_at?: string;
        };
        Update: {
          podcast_id?: string;
          metric?: string;
          granularity?: Granularity;
          bucket_start?: string;
          bucket_end?: string;
          value?: Json;
          fetched_at?: string;
        };
        Relationships: [];
      };
      invitation: {
        Row: {
          id: string;
          email: string;
          role: Role;
          invited_by: string | null;
          accepted_at: string | null;
          revoked_at: string | null;
          podcast_access: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          role: Role;
          invited_by?: string | null;
          accepted_at?: string | null;
          revoked_at?: string | null;
          podcast_access?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          role?: Role;
          invited_by?: string | null;
          accepted_at?: string | null;
          revoked_at?: string | null;
          podcast_access?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      megaphone_session: {
        Row: {
          id: boolean;
          organization_id: string;
          csrf_token: string;
          cookie_header: string;
          expires_at: string | null;
          updated_by: string | null;
          updated_at: string;
          storage_state: Json | null;
          last_refresh_at: string | null;
          last_refresh_status: "ok" | "failed" | null;
          last_refresh_message: string | null;
        };
        Insert: {
          id?: boolean;
          organization_id: string;
          csrf_token: string;
          cookie_header: string;
          expires_at?: string | null;
          updated_by?: string | null;
          updated_at?: string;
          storage_state?: Json | null;
          last_refresh_at?: string | null;
          last_refresh_status?: "ok" | "failed" | null;
          last_refresh_message?: string | null;
        };
        Update: {
          id?: boolean;
          organization_id?: string;
          csrf_token?: string;
          cookie_header?: string;
          expires_at?: string | null;
          updated_by?: string | null;
          updated_at?: string;
          storage_state?: Json | null;
          last_refresh_at?: string | null;
          last_refresh_status?: "ok" | "failed" | null;
          last_refresh_message?: string | null;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          id: boolean;
          dark_mode: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          dark_mode?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          dark_mode?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      current_user_role: {
        Args: Record<never, never>;
        Returns: string;
      };
      user_has_podcast_access: {
        Args: { p_podcast_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
