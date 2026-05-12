export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      accounts: {
        Row: {
          broker: string | null
          created_at: string
          currency: string
          id: string
          name: string
          opened_at: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          broker?: string | null
          created_at?: string
          currency?: string
          id?: string
          name: string
          opened_at?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          broker?: string | null
          created_at?: string
          currency?: string
          id?: string
          name?: string
          opened_at?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          currency: string
          eur_rate: number
          fetched_at: string
        }
        Insert: {
          currency: string
          eur_rate: number
          fetched_at?: string
        }
        Update: {
          currency?: string
          eur_rate?: number
          fetched_at?: string
        }
        Relationships: []
      }
      instruments: {
        Row: {
          asset_class: string
          bond_coupon_frequency: number | null
          bond_coupon_rate: number | null
          bond_maturity_date: string | null
          country: string | null
          created_at: string
          currency: string
          current_price: number | null
          current_price_updated_at: string | null
          id: string
          isin: string | null
          mic: string | null
          name: string
          preferred_currency: string | null
          preferred_mic: string | null
          provider: string | null
          provider_symbol: string | null
          symbol: string
          yahoo_symbol: string | null
        }
        Insert: {
          asset_class: string
          bond_coupon_frequency?: number | null
          bond_coupon_rate?: number | null
          bond_maturity_date?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          current_price?: number | null
          current_price_updated_at?: string | null
          id?: string
          isin?: string | null
          mic?: string | null
          name: string
          preferred_currency?: string | null
          preferred_mic?: string | null
          provider?: string | null
          provider_symbol?: string | null
          symbol: string
          yahoo_symbol?: string | null
        }
        Update: {
          asset_class?: string
          bond_coupon_frequency?: number | null
          bond_coupon_rate?: number | null
          bond_maturity_date?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          current_price?: number | null
          current_price_updated_at?: string | null
          id?: string
          isin?: string | null
          mic?: string | null
          name?: string
          preferred_currency?: string | null
          preferred_mic?: string | null
          provider?: string | null
          provider_symbol?: string | null
          symbol?: string
          yahoo_symbol?: string | null
        }
        Relationships: []
      }
      prices: {
        Row: {
          close: number
          currency: string
          date: string
          instrument_id: string
          source: string | null
        }
        Insert: {
          close: number
          currency?: string
          date: string
          instrument_id: string
          source?: string | null
        }
        Update: {
          close?: number
          currency?: string
          date?: string
          instrument_id?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prices_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          broker: string | null
          created_at: string
          currency: string
          execution_venue: string | null
          external_id: string | null
          fees: number
          fx_rate: number | null
          gross_amount: number
          id: string
          instrument_id: string | null
          kind: string
          notes: string | null
          price: number | null
          quantity: number | null
          settlement_date: string | null
          support: string
          tax: number
          trade_date: string
          trade_time: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          broker?: string | null
          created_at?: string
          currency?: string
          execution_venue?: string | null
          external_id?: string | null
          fees?: number
          fx_rate?: number | null
          gross_amount: number
          id?: string
          instrument_id?: string | null
          kind: string
          notes?: string | null
          price?: number | null
          quantity?: number | null
          settlement_date?: string | null
          support?: string
          tax?: number
          trade_date: string
          trade_time?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          broker?: string | null
          created_at?: string
          currency?: string
          execution_venue?: string | null
          external_id?: string | null
          fees?: number
          fx_rate?: number | null
          gross_amount?: number
          id?: string
          instrument_id?: string | null
          kind?: string
          notes?: string | null
          price?: number | null
          quantity?: number | null
          settlement_date?: string | null
          support?: string
          tax?: number
          trade_date?: string
          trade_time?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "instruments"
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

