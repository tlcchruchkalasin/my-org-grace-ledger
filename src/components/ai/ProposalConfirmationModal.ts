import { ActionProposalUiCard } from "../../lib/ai/grace-ai-proposals";
import { UserRole } from "../../lib/rbac";
import { escapeHtml } from "../../lib/format";

export interface ProposalConfirmationModalProps {
  proposal: ActionProposalUiCard | null;
  isOpen: boolean;
  onClose?: () => void;
  onConfirm?: (confirmationContext: {
    confirmation_id: string;
    nonce: string;
    payload_hash: string;
  }) => Promise<void> | void;
  isLoading?: boolean;
  error?: string | null;
  currentUserRole?: UserRole;
}

const ICON_LOCK = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const ICON_CLOSE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
const ICON_ALERT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
const ICON_SHIELD = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const ICON_ARROW = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

export function renderProposalConfirmationModalHtml(props: ProposalConfirmationModalProps): string {
  if (!props.isOpen || !props.proposal) {
    return "";
  }

  const { proposal, isLoading = false, error = null, currentUserRole } = props;
  const isUnauthorized = currentUserRole && !["super_admin", "treasurer"].includes(currentUserRole);

  const expiresAt = new Date(proposal.expires_at).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const isExpired = diffSec <= 0;

  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  const countdownText = isExpired
    ? "ข้อเสนอหมดอายุแล้ว"
    : `หมดอายุใน ${mins}:${secs.toString().padStart(2, "0")} นาที`;

  // One Thai mapping drives both the confirm button and the action badge, so
  // the badge can never fall back to the raw database enum.
  let actionTitle = "ยืนยันการทำรายการ";
  let actionLabel = "ทำรายการ";
  if (proposal.action === "fund_transfer") {
    actionTitle = `ยืนยันการโอนเงิน ${proposal.amount}`;
    actionLabel = "โอนเงิน";
  } else if (proposal.action === "post_transaction") {
    actionTitle = `ยืนยันลงบัญชีรายการ ${proposal.amount}`;
    actionLabel = "ลงบัญชี";
  } else if (proposal.action === "void_transaction") {
    actionTitle = `ยืนยันยกเลิกรายการ ${proposal.amount}`;
    actionLabel = "ยกเลิกรายการ";
  }

  return `
  <div class="gl-modal-backdrop" id="gl-proposal-modal-backdrop">
    <div class="gl-modal-content" role="dialog" aria-modal="true" aria-labelledby="gl-proposal-modal-title" style="max-width: 520px;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: var(--space-4); margin-bottom: var(--space-4);">
        <div style="display: flex; align-items: center; gap: var(--space-3);">
          <div style="display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: var(--radius-md); background: rgba(245, 158, 11, 0.1); color: var(--warning);">
            ${ICON_LOCK}
          </div>
          <div>
            <h2 id="gl-proposal-modal-title" style="font-size: var(--text-base); font-weight: var(--weight-bold); margin: 0; color: var(--foreground);">
              การตรวจสอบและยืนยันโดยมนุษย์
            </h2>
          </div>
        </div>
        <button type="button" class="gl-modal-close gl-btn gl-btn--ghost gl-btn--sm" aria-label="ปิด" ${isLoading ? "disabled" : ""}>
          ${ICON_CLOSE}
        </button>
      </div>

      <!-- TTL Timer Banner -->
      <div class="gl-proposal-timer" style="display: flex; justify-content: space-between; align-items: center; background: var(--muted); padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); font-size: var(--text-xs); margin-bottom: var(--space-4);">
        <span style="color: var(--muted-foreground);">ความถูกต้องของข้อเสนอ:</span>
        <span class="gl-countdown-badge ${isExpired ? "gl-badge--expired" : "gl-badge--active"}" style="font-weight: var(--weight-bold); color: ${isExpired ? "var(--destructive)" : "var(--warning)"};">
          ${countdownText}
        </span>
      </div>

      <!-- Action Card -->
      <div class="gl-proposal-card" style="border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4); background: var(--card); margin-bottom: var(--space-4);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2);">
          <span class="gl-badge gl-badge--action" style="font-size: var(--text-xs); font-weight: var(--weight-bold);">
            ${actionLabel}
          </span>
          <span class="num-display" style="font-size: var(--text-lg); font-weight: var(--weight-bold);">
            ${proposal.amount}
          </span>
        </div>

        <h3 style="font-size: var(--text-sm); font-weight: var(--weight-bold); margin: var(--space-1) 0; color: var(--foreground);">
          ${escapeHtml(proposal.title)}
        </h3>
        <p style="font-size: var(--text-xs); color: var(--muted-foreground); margin-bottom: var(--space-3);">
          ${escapeHtml(proposal.summary)}
        </p>

        <!-- Financial Effect -->
        <div class="gl-financial-effect" style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-md); padding: var(--space-3); font-size: var(--text-xs); color: var(--foreground); margin-bottom: var(--space-3);">
          <div style="font-weight: var(--weight-bold); display: flex; align-items: center; gap: var(--space-1); margin-bottom: var(--space-1); color: var(--warning);">
            ${ICON_ALERT} <span>ผลกระทบทางการเงิน:</span>
          </div>
          <div style="padding-left: var(--space-4); line-height: 1.5;">
            ${escapeHtml(proposal.financial_effect)}
          </div>
        </div>

        <!-- Transfer Balance Breakdown -->
        ${
          proposal.action === "fund_transfer"
            ? `
        <div class="gl-transfer-breakdown" style="background: var(--muted); border-radius: var(--radius-md); padding: var(--space-3); font-size: var(--text-xs); margin-bottom: var(--space-3);">
          <div style="font-weight: var(--weight-medium); margin-bottom: var(--space-2);">การเปลี่ยนแปลงยอดกองทุน:</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2);">
            <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-2);">
              <div style="color: var(--muted-foreground);">ต้นทาง (${escapeHtml(proposal.source ?? "")}):</div>
              <div class="num-display" style="color: var(--foreground);">ก่อน: ${proposal.current_state.from_fund_balance}</div>
              <div class="num-display" style="color: var(--destructive); font-weight: var(--weight-bold); display: flex; align-items: center; gap: 2px;">
                ${ICON_ARROW} หลัง: ${proposal.current_state.projected_from_balance}
              </div>
            </div>
            <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-2);">
              <div style="color: var(--muted-foreground);">ปลายทาง (${escapeHtml(proposal.destination ?? "")}):</div>
              <div class="num-display" style="color: var(--foreground);">ก่อน: ${proposal.current_state.to_fund_balance}</div>
              <div class="num-display" style="color: var(--success); font-weight: var(--weight-bold); display: flex; align-items: center; gap: 2px;">
                ${ICON_ARROW} หลัง: ${proposal.current_state.projected_to_balance}
              </div>
            </div>
          </div>
        </div>
        `
            : ""
        }

        <!-- Void Warning -->
        ${
          proposal.action === "void_transaction"
            ? `
        <div class="gl-void-warning" style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: var(--radius-md); padding: var(--space-3); font-size: var(--text-xs); color: var(--destructive); margin-bottom: var(--space-3);">
          <div style="font-weight: var(--weight-bold); display: flex; align-items: center; gap: var(--space-1); margin-bottom: var(--space-1);">
            ${ICON_SHIELD} <span>คำเตือนการยกเลิกรายการถาวร:</span>
          </div>
          <div style="padding-left: var(--space-4); line-height: 1.5;">
            รายการนี้จะถูกทำเครื่องหมายว่ายกเลิกในบัญชี และระบบจะบันทึกรายการกลับบัญชีอัตโนมัติ ไม่สามารถย้อนกลับได้
          </div>
        </div>
        `
            : ""
        }

        ${
          proposal.reason
            ? `<div style="font-size: var(--text-xs); color: var(--muted-foreground);"><strong style="color: var(--foreground);">เหตุผลประกอบ:</strong> ${escapeHtml(proposal.reason)}</div>`
            : ""
        }
      </div>

      <!-- Error State -->
      ${
        error
          ? `
      <div class="gl-error-banner" style="background: rgba(239, 68, 68, 0.1); border: 1px solid var(--destructive); border-radius: var(--radius-md); padding: var(--space-3); font-size: var(--text-xs); color: var(--destructive); margin-bottom: var(--space-4);" role="alert">
        <strong>เกิดข้อผิดพลาดในการดำเนินการ:</strong> ${escapeHtml(error)}
      </div>
      `
          : ""
      }

      <!-- Unauthorized State -->
      ${
        isUnauthorized
          ? `
      <div class="gl-unauthorized-banner" style="background: rgba(239, 68, 68, 0.1); border: 1px solid var(--destructive); border-radius: var(--radius-md); padding: var(--space-3); font-size: var(--text-xs); color: var(--destructive); margin-bottom: var(--space-4);" role="alert">
        <strong>ไม่มีสิทธิ์ยืนยันการดำเนินการ:</strong> เฉพาะเหรัญญิกหรือผู้ดูแลระบบเท่านั้นที่สามารถยืนยันการเงินนี้ได้
      </div>
      `
          : ""
      }

      <!-- Actions -->
      <div class="gl-actions" style="display: flex; justify-content: flex-end; gap: var(--space-3);">
        <button type="button" class="gl-btn-cancel gl-btn gl-btn--ghost" ${isLoading ? "disabled" : ""}>
          ยกเลิก
        </button>
        <button
          type="button"
          class="gl-btn-confirm gl-btn ${proposal.action === "void_transaction" ? "gl-btn--destructive" : "gl-btn--primary"}"
          ${isExpired || isUnauthorized || isLoading ? "disabled" : ""}
          style="min-height: 44px;">
          ${
            isLoading
              ? "กำลังประมวลผล..."
              : isExpired
              ? "ข้อเสนอหมดอายุแล้ว"
              : actionTitle
          }
        </button>
      </div>
    </div>
  </div>
  `;
}

export function attachProposalConfirmationModalHandlers(
  container: HTMLElement,
  props: ProposalConfirmationModalProps
): { destroy: () => void } {
  const closeBtn = container.querySelector<HTMLButtonElement>(".gl-modal-close");
  const cancelBtn = container.querySelector<HTMLButtonElement>(".gl-btn-cancel");
  const confirmBtn = container.querySelector<HTMLButtonElement>(".gl-btn-confirm");

  const handleClose = () => {
    if (props.onClose) props.onClose();
  };

  const handleConfirm = async () => {
    if (!props.proposal || !props.onConfirm) return;
    if (confirmBtn) confirmBtn.disabled = true;

    try {
      await props.onConfirm({
        confirmation_id: props.proposal.confirmation_id,
        nonce: props.proposal.nonce,
        payload_hash: props.proposal.payload_hash,
      });
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
    }
  };

  closeBtn?.addEventListener("click", handleClose);
  cancelBtn?.addEventListener("click", handleClose);
  confirmBtn?.addEventListener("click", handleConfirm);

  return {
    destroy: () => {
      closeBtn?.removeEventListener("click", handleClose);
      cancelBtn?.removeEventListener("click", handleClose);
      confirmBtn?.removeEventListener("click", handleConfirm);
    },
  };
}
