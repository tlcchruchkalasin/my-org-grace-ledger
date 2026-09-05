import {
  PendingApprovalItem,
  ProjectedFundBalanceResult,
} from "../../lib/transactions/types";
import { escapeHtml } from "../../lib/format";
import { renderStatusBadgeHtml } from "./StatusBadge";
import { renderProjectedBalanceCardHtml } from "./ProjectedBalanceCard";

export interface ApprovalDecisionSheetProps {
  item: PendingApprovalItem;
  projections: ProjectedFundBalanceResult[];
  isStaleState?: boolean;
}

const ICON_CLOSE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
const ICON_LOCK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`;
const ICON_RECEIPT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3z"/><path d="M9 8h6M9 12h6"/></svg>`;
const ICON_ALERT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`;

export function renderApprovalDecisionSheetHtml(
  props: ApprovalDecisionSheetProps,
): string {
  const { item, projections, isStaleState } = props;

  const sign =
    item.direction === "expense" ? "−" : item.direction === "income" ? "+" : "";
  const formattedAmount = `${sign}${item.amount.format({ currency: "THB", showSign: false })}`;
  const statusBadge = renderStatusBadgeHtml({ status: item.status });

  if (isStaleState) {
    return `
    <section class="gl-decision-sheet gl-card" aria-labelledby="gl-stale-title">
      <div class="gl-notice gl-notice--warning" role="status">
        ${ICON_ALERT}
        <div class="gl-notice__body">
          <h2 id="gl-stale-title" style="font-size: var(--text-md); font-weight: var(--weight-semibold); margin: 0 0 var(--space-1);">
            รายการนี้ได้รับการดำเนินการไปแล้ว
          </h2>
          <p style="margin: 0 0 var(--space-3);">
            ผู้อนุมัติท่านอื่นพิจารณา ${escapeHtml(item.referenceNumber || item.description)} ไปแล้ว
          </p>
          <button type="button" class="gl-btn-refresh-queue gl-btn gl-btn--primary gl-btn--sm">
            ปิดหน้าต่างและรีเฟรชรายการ
          </button>
        </div>
      </div>
    </section>
    `;
  }

  const twoPersonBanner = item.isCreator
    ? `
    <div class="gl-notice" id="gl-approve-blocked" style="margin-bottom: var(--space-4);">
      ${ICON_LOCK}
      <div class="gl-notice__body">
        <strong>หลักการแบ่งแยกหน้าที่</strong><br>
        คุณเป็นผู้สร้างรายการนี้ ไม่สามารถอนุมัติตัวเองได้ ต้องให้ผู้มีอำนาจอีกท่านอนุมัติ
      </div>
    </div>
    `
    : "";

  const receiptHtml = item.hasReceipt
    ? `
    <div class="gl-surface" style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4);">
      <span style="display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); font-weight: var(--weight-semibold);">
        ${ICON_RECEIPT} มีเอกสารใบเสร็จแนบ
      </span>
      <a href="${item.receiptUrl || "#"}" target="_blank" rel="noopener noreferrer" style="font-size: var(--text-sm); font-weight: var(--weight-semibold);">
        เปิดเอกสาร
      </a>
    </div>
    `
    : `
    <div class="gl-notice gl-notice--warning" style="margin-bottom: var(--space-4);">
      ${ICON_ALERT}
      <div class="gl-notice__body">
        <strong>ยังไม่มีใบเสร็จแนบ</strong> — ตรวจสอบกับผู้ขอเบิกก่อนอนุมัติ
      </div>
    </div>
    `;

  const projectionsHtml = projections
    .map((p) => renderProjectedBalanceCardHtml({ projection: p }))
    .join("");

  return `
  <section class="gl-decision-sheet gl-card gl-card--elevated" aria-labelledby="gl-decision-title" style="max-width: 640px; margin: var(--space-6) auto 0;">
    <div class="gl-approval-sheet__head">
      <div style="min-width: 0;">
        <div class="kicker">${escapeHtml(item.referenceNumber || "คำขออนุมัติ")}</div>
        <h2 id="gl-decision-title" style="font-size: var(--text-xl); font-weight: var(--weight-bold); margin: var(--space-1) 0 0;">
          ${escapeHtml(item.description)}
        </h2>
      </div>
      <div class="gl-approval-sheet__head-actions">
        ${statusBadge}
        <button type="button" class="gl-sheet-close gl-btn gl-btn--ghost gl-btn--sm" aria-label="ปิดรายละเอียด">
          ${ICON_CLOSE}
        </button>
      </div>
    </div>

    <div class="gl-surface gl-approval-amount">
      <div class="gl-approval-amount__label">จำนวนเงินที่ขออนุมัติ</div>
      <div class="num-display gl-approval-amount__value" style="color: ${item.direction === "expense" ? "var(--expense)" : "var(--income)"};">
        ${formattedAmount}
      </div>
      <div class="gl-approval-amount__meta">
        ${escapeHtml(item.creatorName || "ไม่ระบุผู้ขอ")} · ${escapeHtml(item.accountName ?? "")}
      </div>
    </div>

    ${twoPersonBanner}
    ${receiptHtml}

    <div style="margin-bottom: var(--space-6);">
      <h3 style="font-size: var(--text-sm); font-weight: var(--weight-semibold); margin: 0 0 var(--space-3);">
        ผลกระทบต่อกองทุน
      </h3>
      <div class="gl-stack gl-stack--tight">
        ${projectionsHtml}
      </div>
    </div>

    <div class="gl-actions">
      <button type="button" class="gl-btn-reject gl-btn gl-btn--ghost">ปฏิเสธ</button>
      <button type="button" class="gl-btn-request-revision gl-btn gl-btn--secondary">ขอแก้ไข</button>
      <button type="button" class="gl-btn-approve gl-btn gl-btn--primary" ${
        item.isCreator ? 'disabled aria-describedby="gl-approve-blocked"' : ""
      }>อนุมัติ</button>
    </div>
  </section>
  `;
}
