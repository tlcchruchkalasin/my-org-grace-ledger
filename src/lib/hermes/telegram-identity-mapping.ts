/**
 * Grace Ledger — Telegram Identity Mapping & Verification Engine
 * 
 * Secure 2-way account binding between Telegram User IDs and Grace Ledger Profiles.
 * Enforces cryptographic link tokens with 5-minute TTL, single-use binding, and audit logging.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { UserRole } from "../rbac";

export interface TelegramIdentityMapping {
  telegram_user_id: number;
  telegram_username?: string;
  user_id: string;
  church_id: string;
  role: UserRole;
  is_verified: boolean;
  linked_at: string;
}

export interface LinkTokenPayload {
  token: string;
  otp: string;
  telegram_user_id: number;
  telegram_username?: string;
  expires_at: string;
}

export class TelegramIdentityService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * 1. Generates a secure binding OTP/Token initiated from Telegram
   */
  public async generateLinkRequest(params: {
    telegram_user_id: number;
    telegram_username?: string;
  }): Promise<{ success: boolean; linkToken?: LinkTokenPayload; message: string }> {
    if (!params.telegram_user_id || params.telegram_user_id <= 0) {
      return { success: false, message: "รหัส Telegram User ID ไม่ถูกต้อง" };
    }

    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.randomUUID || !cryptoApi.getRandomValues) {
      return { success: false, message: "ระบบไม่พร้อมสร้างรหัสยืนยันที่ปลอดภัย" };
    }

    const otpBytes = new Uint32Array(1);
    cryptoApi.getRandomValues(otpBytes);
    const otp = (100000 + (otpBytes[0] % 900000)).toString();
    const token = `tok_${cryptoApi.randomUUID().replace(/-/g, "")}`;
    const expiresAt = new Date(Date.now() + 300000).toISOString(); // 5 minutes TTL

    const payload: LinkTokenPayload = {
      token,
      otp,
      telegram_user_id: params.telegram_user_id,
      telegram_username: params.telegram_username,
      expires_at: expiresAt,
    };

    // Store in link requests cache/table
    await (this.supabase.from("telegram_link_requests") as any).insert({
      token,
      otp,
      telegram_user_id: params.telegram_user_id,
      telegram_username: params.telegram_username || null,
      expires_at: expiresAt,
      is_used: false,
    });

    return {
      success: true,
      linkToken: payload,
      message: `กรุณากรอกรหัส OTP ${otp} ในหน้าตั้งค่าบัญชีของ Grace Ledger เพื่อยืนยันการผูกบัญชี (รหัสหมดอายุใน 5 นาที)`,
    };
  }

  /**
   * 2. Binds Telegram account to authenticated Grace Ledger User Profile
   */
  public async verifyAndBindAccount(params: {
    otpOrToken: string;
    authenticatedUserId: string;
  }): Promise<{ success: boolean; churchId?: string; role?: UserRole; message: string; error?: string }> {
    // 1. Fetch valid pending link request
    const { data: linkReq, error: reqErr } = await (this.supabase
      .from("telegram_link_requests") as any)
      .select("token, otp, telegram_user_id, telegram_username, expires_at, is_used")
      .or(`otp.eq.${params.otpOrToken},token.eq.${params.otpOrToken}`)
      .eq("is_used", false)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .single();

    if (reqErr || !linkReq) {
      return {
        success: false,
        message: "รหัส OTP หรือลิงก์ยืนยันไม่ถูกต้อง หรือหมดอายุแล้ว",
        error: "INVALID_OR_EXPIRED_TOKEN",
      };
    }

    // 2. Fetch authenticated profile
    const { data: profile, error: profErr } = await (this.supabase
      .from("profiles") as any)
      .select("id, church_id, role, email")
      .eq("id", params.authenticatedUserId)
      .single();

    if (profErr || !profile || !profile.church_id) {
      return {
        success: false,
        message: "ไม่พบข้อมูลโปรไฟล์ผู้ใช้ในระบบ",
        error: "PROFILE_NOT_FOUND",
      };
    }

    // 3. Mark token as consumed
    await (this.supabase.from("telegram_link_requests") as any)
      .update({ is_used: true })
      .eq("token", linkReq.token);

    // 4. Save binding record
    await (this.supabase.from("telegram_user_mappings") as any).upsert(
      {
        telegram_user_id: linkReq.telegram_user_id,
        telegram_username: linkReq.telegram_username,
        user_id: profile.id,
        church_id: profile.church_id,
        is_verified: true,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "telegram_user_id" }
    );

    // 5. Dual-actor audit log
    await (this.supabase.from("audit_logs") as any).insert({
      church_id: profile.church_id,
      actor_id: profile.id,
      action: "TELEGRAM_ACCOUNT_LINKED",
      category: "security",
      metadata: {
        telegram_user_id: linkReq.telegram_user_id,
        telegram_username: linkReq.telegram_username,
        user_id: profile.id,
        role: profile.role,
      },
    });

    return {
      success: true,
      churchId: profile.church_id,
      role: profile.role as UserRole,
      message: `ผูกบัญชี Telegram กับระบบ Grace Ledger เรียบร้อยแล้ว (สิทธิ์: ${profile.role})`,
    };
  }

  /**
   * 3. Resolves linked Grace Ledger profile for incoming Telegram messages
   */
  public async resolveTelegramUser(
    telegramUserId: number
  ): Promise<{ isLinked: boolean; mapping?: TelegramIdentityMapping; message?: string }> {
    const { data: mapping, error } = await (this.supabase
      .from("telegram_user_mappings") as any)
      .select("telegram_user_id, telegram_username, user_id, church_id, is_verified, linked_at")
      .eq("telegram_user_id", telegramUserId)
      .eq("is_verified", true)
      .single();

    if (error || !mapping) {
      return {
        isLinked: false,
        message: "บัญชี Telegram นี้ยังไม่ได้เชื่อมต่อกับ Grace Ledger กรุณาพิมพ์ /link เพื่อเชื่อมต่อบัญชี",
      };
    }

    // Resolve current role from profile
    const { data: profile } = await (this.supabase
      .from("profiles") as any)
      .select("role")
      .eq("id", mapping.user_id)
      .single();

    return {
      isLinked: true,
      mapping: {
        telegram_user_id: mapping.telegram_user_id,
        telegram_username: mapping.telegram_username,
        user_id: mapping.user_id,
        church_id: mapping.church_id,
        role: (profile?.role as UserRole) || "member",
        is_verified: true,
        linked_at: mapping.linked_at,
      },
    };
  }

  /**
   * 4. Unlinks Telegram account
   */
  public async unlinkTelegramAccount(
    telegramUserId: number
  ): Promise<{ success: boolean; message: string }> {
    const { data: mapping } = await (this.supabase
      .from("telegram_user_mappings") as any)
      .select("user_id, church_id")
      .eq("telegram_user_id", telegramUserId)
      .single();

    if (!mapping) {
      return { success: false, message: "ไม่พบบัญชีที่เชื่อมต่ออยู่" };
    }

    await (this.supabase.from("telegram_user_mappings") as any)
      .delete()
      .eq("telegram_user_id", telegramUserId);

    await (this.supabase.from("audit_logs") as any).insert({
      church_id: mapping.church_id,
      actor_id: mapping.user_id,
      action: "TELEGRAM_ACCOUNT_UNLINKED",
      category: "security",
      metadata: { telegram_user_id: telegramUserId },
    });

    return { success: true, message: "ยกเลิกการเชื่อมต่อบัญชี Telegram เรียบร้อยแล้ว" };
  }
}
