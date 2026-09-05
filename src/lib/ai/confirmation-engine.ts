import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../supabase/types";
import { Money } from "../money";

/**
 * =====================================================================
 * CANONICAL PAYLOAD & CONFIRMATION STATE ENGINE
 * =====================================================================
 * Invariants:
 * 1. Hashing is 100% deterministic (recursively sorted keys).
 * 2. Numbers and currency strings are normalized to exact decimal representations.
 * 3. Human Confirmation != Authorization (Authorization is validated at execution).
 * 4. Confirmation tokens are single-use, server-timed, and tenant/user isolated.
 * =====================================================================
 */

export interface CanonicalProposalPayload {
  action: string;
  tool_name: string;
  church_id: string;
  user_id: string;
  resource_id: string | null;
  parameters: Record<string, any>;
  nonce: string;
}

export interface CreateConfirmationInput {
  church_id: string;
  action: string;
  tool_name: string;
  resource_id?: string | null;
  parameters: Record<string, any>;
  ttl_seconds?: number;
}

export interface CreateConfirmationResult {
  confirmation_id: string;
  expires_at: string;
  nonce: string;
  payload_hash: string;
}

export interface ConsumeConfirmationInput {
  confirmation_id: string;
  church_id: string;
  expected_payload_hash: string;
  expected_nonce: string;
}

export interface ConsumedConfirmationData {
  status: "consumed";
  confirmation_id: string;
  action: string;
  tool_name: string;
  resource_id: string | null;
  normalized_parameters: Record<string, any>;
  consumed_at: string;
}

/**
 * Generates a cryptographically strong 32-character security nonce
 */
export function generateConfirmationNonce(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.randomUUID) {
    throw new Error("Cryptographically secure randomness is unavailable");
  }

  return "conf_nonce_" + cryptoApi.randomUUID().replace(/-/g, "");
}

/**
 * Normalizes values recursively (formats amounts, trims strings, sorts object keys)
 */
export function normalizeValue(val: any): any {
  if (val === null || val === undefined) {
    return null;
  }

  if (typeof val === "number") {
    // If integer, keep integer. If float, format to max 4 decimals
    return Number.isInteger(val) ? val : Number(val.toFixed(4));
  }

  if (typeof val === "string") {
    const trimmed = val.trim();
    // Try to normalize monetary strings (e.g. "1000.0" -> "1000.00")
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      try {
        const m = Money.from(trimmed);
        return m.toFixed(2);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  if (Array.isArray(val)) {
    return val.map((item) => normalizeValue(item));
  }

  if (typeof val === "object") {
    const sortedObj: Record<string, any> = {};
    const keys = Object.keys(val).sort();
    for (const key of keys) {
      sortedObj[key] = normalizeValue(val[key]);
    }
    return sortedObj;
  }

  return val;
}

/**
 * Deterministic JSON Stringifier (Recursively sorts object keys)
 */
export function canonicalizeJson(obj: any): string {
  const normalized = normalizeValue(obj);
  return JSON.stringify(normalized);
}

/**
 * Computes deterministic SHA-256 hex string of canonical payload
 */
export async function computeProposalPayloadHash(payload: CanonicalProposalPayload): Promise<string> {
  const canonicalString = canonicalizeJson({
    action: payload.action.trim(),
    tool_name: payload.tool_name.trim(),
    church_id: payload.church_id.trim(),
    user_id: payload.user_id.trim(),
    resource_id: payload.resource_id ? payload.resource_id.trim() : null,
    parameters: payload.parameters,
    nonce: payload.nonce.trim(),
  });

  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalString);

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Node.js crypto fallback
  const nodeCrypto = await import("crypto");
  return nodeCrypto.createHash("sha256").update(canonicalString).digest("hex");
}

/**
 * Computes deterministic SHA-256 hex string directly from parameters object
 */
export async function computePayloadHash(parameters: Record<string, any>): Promise<string> {
  const canonicalString = canonicalizeJson(parameters);

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(canonicalString);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const nodeCrypto = await import("crypto");
  return nodeCrypto.createHash("sha256").update(canonicalString).digest("hex");
}


/**
 * Confirmation State Engine Client
 */
export class ActionConfirmationEngine {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Creates a server-backed, single-use action confirmation
   */
  public async createConfirmation(
    input: CreateConfirmationInput
  ): Promise<{ success: boolean; data?: CreateConfirmationResult; error?: string; code?: string }> {
    try {
      const { data: userRes, error: userErr } = await this.supabase.auth.getUser();
      if (userErr || !userRes?.user) {
        return { success: false, error: "Unauthorized: User session required", code: "401" };
      }

      const nonce = generateConfirmationNonce();
      const normalizedParams = normalizeValue(input.parameters);

      const canonicalPayload: CanonicalProposalPayload = {
        action: input.action,
        tool_name: input.tool_name,
        church_id: input.church_id,
        user_id: userRes.user.id,
        resource_id: input.resource_id || null,
        parameters: normalizedParams,
        nonce,
      };

      const payload_hash = await computeProposalPayloadHash(canonicalPayload);

      const { data, error } = await (this.supabase.rpc as any)("create_action_confirmation", {
        p_church_id: input.church_id,
        p_action: input.action,
        p_tool_name: input.tool_name,
        p_resource_id: input.resource_id || null,
        p_normalized_parameters: normalizedParams,
        p_payload_hash: payload_hash,
        p_nonce: nonce,
        p_ttl_seconds: input.ttl_seconds || 300,
      });

      if (error) {
        return { success: false, error: error.message, code: error.code };
      }

      return {
        success: true,
        data: {
          confirmation_id: data.confirmation_id,
          expires_at: data.expires_at,
          nonce,
          payload_hash,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to create action confirmation" };
    }
  }

  /**
   * Atomically consumes a confirmation record with tamper and single-use checks
   */
  public async consumeConfirmation(
    input: ConsumeConfirmationInput
  ): Promise<{ success: boolean; data?: ConsumedConfirmationData; error?: string; code?: string }> {
    try {
      const { data, error } = await (this.supabase.rpc as any)("consume_action_confirmation", {
        p_confirmation_id: input.confirmation_id,
        p_church_id: input.church_id,
        p_expected_payload_hash: input.expected_payload_hash,
        p_expected_nonce: input.expected_nonce,
      });

      if (error) {
        return { success: false, error: error.message, code: error.code };
      }

      return { success: true, data: data as ConsumedConfirmationData };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to consume action confirmation" };
    }
  }
}
