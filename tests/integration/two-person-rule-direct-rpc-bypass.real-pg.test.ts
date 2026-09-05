import { describe, it, expect, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PgLab } from "../../scripts/pg-lab.mjs";

// REAL-PostgreSQL integration test: Two-Person Rule / Segregation of Duties
// enforced at the DATABASE, not the client.
//
// Boots a throwaway PostgreSQL 17 instance (scripts/pg-lab.mjs), applies every
// migration in supabase/migrations in order, then calls post_transaction()
// and approve_transaction() directly with lab.asUser() — the same simulated
// auth.uid() session a real Supabase RPC call runs under. No client code
// (TransactionsPage, ApprovalsPage, approvals-service.ts, lifecycle.ts) is
// involved: this proves the server-side check in the SQL function itself
// rejects a creator acting on their own transaction, so a caller who skips
// every client-side check (a raw fetch to PostgREST, a compromised client, a
// malicious script) still cannot self-approve or self-post.
//
// If the lab cannot boot in this environment (no binaries / not elevated),
// the suite is SKIPPED rather than failed so the deterministic unit suite
// stays green; run under an elevated shell for the full verification.
//
// Verification points required by the task:
//   (1) draft -> posted (direct post) by the creator is rejected by
//       post_transaction() with "Segregation of Duties"
//   (2) pending_approval -> approved by the creator is rejected by
//       approve_transaction() with "Segregation of Duties"
//   (3) neither call mutates the transaction's status or any balance

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

const lab = new PgLab();
let booted = false;

const CHURCH_A = "10000000-0000-0000-0000-0000000000cc";
const CREATOR = "30000000-0000-0000-0000-0000000000ee"; // sole treasurer; also the transaction creator
const OTHER_TREASURER = "30000000-0000-0000-0000-0000000000ff"; // legitimate second person
const ACCOUNT_A = "40000000-0000-0000-0000-0000000000cc";
const FUND_MAIN = "50000000-0000-0000-0000-0000000000cc";

async function seed() {
  const c = lab.client!;
  await c.query(
    `INSERT INTO churches (id, name) VALUES ($1,'SoD Test Church')`,
    [CHURCH_A],
  );
  await c.query(
    `INSERT INTO profiles (id, church_id, email, full_name) VALUES ($1,$2,'creator@a.local','Creator'), ($3,$2,'other@a.local','Other Treasurer')`,
    [CREATOR, CHURCH_A, OTHER_TREASURER],
  );
  await c.query(
    `INSERT INTO user_roles (user_id, church_id, role) VALUES ($1,$2,'treasurer'), ($3,$2,'treasurer')`,
    [CREATOR, CHURCH_A, OTHER_TREASURER],
  );
  await c.query(
    `INSERT INTO accounts (id, church_id, name, type, current_balance) VALUES ($1,$2,'Cash Drawer','cash_drawer',10000.00)`,
    [ACCOUNT_A, CHURCH_A],
  );
  await c.query(
    `INSERT INTO funds (id, church_id, name, current_balance) VALUES ($1,$2,'General Fund',10000.00)`,
    [FUND_MAIN, CHURCH_A],
  );
}

async function insertTransaction(
  id: string,
  status: "draft" | "pending_approval",
) {
  const c = lab.client!;
  await c.query("SELECT set_config('request.jwt.claims', '{}', false)");
  await c.query(
    `INSERT INTO transactions (id, church_id, account_id, amount, direction, status, description, created_by, reference_number)
     VALUES ($1,$2,$3,1000.00,'income','${status}','SoD bypass attempt',$4,'T-SOD-1')`,
    [id, CHURCH_A, ACCOUNT_A, CREATOR],
  );
  await c.query(
    `INSERT INTO transaction_splits (transaction_id, church_id, fund_id, amount, note)
     VALUES ($1,$2,$3,1000.00,'main')`,
    [id, CHURCH_A, FUND_MAIN],
  );
}

try {
  await lab.start({ migrationsDir });
  await seed();
  booted = true;
} catch (err) {
  booted = false;
  const reason = (err as Error).message;
  console.warn(
    [
      "",
      "############################################################",
      "# SKIPPED: two-person-rule-direct-rpc-bypass (real PostgreSQL 17)",
      "# This suite did NOT run. A Segregation-of-Duties regression in",
      "# post_transaction()/approve_transaction() would reach",
      "# production undetected while this stays skipped.",
      `# Reason: ${reason}`,
      "# Fix: run under an elevated shell so the embedded PG lab can",
      "# create its unprivileged service account, then re-run.",
      "############################################################",
      "",
    ].join("\n"),
  );
}

describe.runIf(booted)(
  "Two-Person Rule enforced by the database when the client is bypassed entirely",
  () => {
    it("draft -> posted: creator calling post_transaction() directly on their own draft is rejected", async () => {
      const txnId = "60000000-0000-0000-0000-0000000000c1";
      await insertTransaction(txnId, "draft");

      // The creator calls the RPC directly, exactly as a raw PostgREST/RPC
      // request would — no client-side "am I the creator?" check runs first.
      await expect(
        lab.asUser(CREATOR, "authenticated", () =>
          lab.client!.query("SELECT post_transaction($1)", [txnId]),
        ),
      ).rejects.toThrow(/Segregation of Duties/i);

      // No mutation: still draft, account balance unchanged.
      const txn = await lab.client!.query(
        "SELECT status FROM transactions WHERE id=$1",
        [txnId],
      );
      expect(txn.rows[0].status).toBe("draft");
      const acc = await lab.client!.query(
        "SELECT current_balance FROM accounts WHERE id=$1",
        [ACCOUNT_A],
      );
      expect(Number(acc.rows[0].current_balance)).toBe(10000.0);

      // Control: a different treasurer posting the same draft succeeds,
      // proving the rejection above is specifically about self-posting.
      await lab.asUser(OTHER_TREASURER, "authenticated", () =>
        lab.client!.query("SELECT post_transaction($1)", [txnId]),
      );
      const posted = await lab.client!.query(
        "SELECT status FROM transactions WHERE id=$1",
        [txnId],
      );
      expect(posted.rows[0].status).toBe("posted");
    }, 60000);

    it("pending_approval -> approved: creator calling approve_transaction() directly on their own submission is rejected", async () => {
      const txnId = "60000000-0000-0000-0000-0000000000c2";
      await insertTransaction(txnId, "pending_approval");

      await expect(
        lab.asUser(CREATOR, "authenticated", () =>
          lab.client!.query("SELECT approve_transaction($1)", [txnId]),
        ),
      ).rejects.toThrow(/Segregation of Duties/i);

      // No mutation: still pending_approval, not approved.
      const txn = await lab.client!.query(
        "SELECT status, approved_by FROM transactions WHERE id=$1",
        [txnId],
      );
      expect(txn.rows[0].status).toBe("pending_approval");
      expect(txn.rows[0].approved_by).toBeNull();

      // Control: a different treasurer approving the same submission succeeds.
      await lab.asUser(OTHER_TREASURER, "authenticated", () =>
        lab.client!.query("SELECT approve_transaction($1)", [txnId]),
      );
      const approved = await lab.client!.query(
        "SELECT status FROM transactions WHERE id=$1",
        [txnId],
      );
      expect(approved.rows[0].status).toBe("approved");
    }, 60000);
  },
);

afterAll(async () => {
  await lab.stop();
  console.log("real-PG lab torn down (two-person-rule-direct-rpc-bypass).");
});
