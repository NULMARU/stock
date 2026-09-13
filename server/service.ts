import { randomUUID } from "node:crypto";
import { SnapshotSchema, analyzeFinancials } from "@stock/financial-analysis";
import { collectDART, collectSEC, type Security } from "./providers";
import { Store, type State, type Job } from "./store";
const TTL = 5 * 60 * 1000;
export class FinancialService {
  constructor(
    readonly store: Store,
    private collect = (issuer: string) =>
      issuer.startsWith("sec:") ? collectSEC(issuer) : collectDART(issuer),
  ) {}
  async register(security: Security) {
    await this.store.transaction((s) => {
      if (
        Object.keys(s.securities).length >= 2000 &&
        !s.securities[security.securityId]
      )
        throw new Error("Registry capacity reached");
      s.securities[security.securityId] = security;
      if (security.issuerId)
        s.issuers[security.issuerId] ??= {
          versions: {},
          lastRequestedAt: Date.now(),
        };
    });
    return security;
  }
  private enqueue(s: State, id: string, now: number): Job {
    const issuer = s.issuers[id];
    if (!issuer) throw new Error("Unknown issuer");
    const old = issuer.jobId ? s.jobs[issuer.jobId] : undefined;
    if (
      old &&
      (old.state === "queued" ||
        (old.state === "failed" && old.nextAt > now) ||
        (old.state === "fetching" && old.leaseUntil > now) ||
        now - Date.parse(old.createdAt) < 60000)
    )
      return old;
    // Bounded durable history; snapshots retain versions independently.
    for (const job of Object.values(s.jobs))
      if (
        ["ready", "failed"].includes(job.state) &&
        now - Date.parse(job.createdAt) > 7 * 86400000
      )
        delete s.jobs[job.id];
    const job: Job = {
      id: randomUUID(),
      issuerId: id,
      state: "queued",
      attempts: 0,
      createdAt: new Date(now).toISOString(),
      nextAt: now,
      leaseUntil: 0,
    };
    s.jobs[job.id] = job;
    issuer.jobId = job.id;
    return job;
  }
  async financials(id: string, force = false) {
    return this.store.transaction((s) => {
      const issuer = s.issuers[id];
      if (!issuer) throw new Error("Unknown issuer");
      const now = Date.now();
      issuer.lastRequestedAt = now;
      const stale =
        !issuer.sourceCheckedAt ||
        now - Date.parse(issuer.sourceCheckedAt) > TTL ||
        !!issuer.error;
      const job =
        force || stale
          ? this.enqueue(s, id, now)
          : issuer.jobId
            ? s.jobs[issuer.jobId]
            : undefined;
      return {
        snapshot: issuer.snapshot ?? null,
        sourceCheckedAt: issuer.sourceCheckedAt ?? null,
        isStale: stale,
        updateStatus: job?.state ?? "ready",
        jobId: job?.id ?? null,
        error: issuer.error ?? null,
        analysisStatus: issuer.snapshot ? "rules-ready" : "pending",
      };
    });
  }
  async job(id: string) {
    return this.store.transaction((s) => s.jobs[id] ?? null);
  }
  async analysis(id: string, version: string) {
    return this.store.transaction((s) => {
      const snap = s.issuers[id]?.versions[version];
      if (!snap) return null;
      const p = snap.periods.find((p) => p.kind === "ttm") ?? snap.periods[0];
      return {
        financialVersion: version,
        kind: "deterministic-rules",
        metrics: p ? analyzeFinancials(snap, p) : [],
        unknowns: ["만기·한도·TAM·일회성 손익 조정은 근거 자료 미확보"],
        aiStatus: "not-configured",
      };
    });
  }
  async tick() {
    const now = Date.now();
    const job = await this.store.transaction((s) => {
      for (const [id, i] of Object.entries(s.issuers))
        if (
          now - i.lastRequestedAt < 24 * 3600000 &&
          (!i.sourceCheckedAt || now - Date.parse(i.sourceCheckedAt) > TTL)
        )
          this.enqueue(s, id, now);
      const j = Object.values(s.jobs).find(
        (j) =>
          j.nextAt <= now &&
          (j.state === "queued" ||
            (j.state === "fetching" && j.leaseUntil <= now)),
      );
      if (j) {
        j.state = "fetching";
        j.attempts++;
        j.leaseUntil = now + 15 * 60000;
      }
      return j ? { ...j } : null;
    });
    if (!job) return false;
    try {
      const snapshot = SnapshotSchema.parse(await this.collect(job.issuerId));
      if (snapshot.issuerId !== job.issuerId)
        throw new Error("Issuer mismatch");
      await this.store.transaction((s) => {
        const j = s.jobs[job.id];
        if (!j || j.leaseUntil !== job.leaseUntil || j.state !== "fetching")
          return;
        const i = s.issuers[job.issuerId]!;
        i.snapshot = snapshot;
        i.versions[snapshot.financialVersion] = snapshot;
        i.sourceCheckedAt = new Date().toISOString();
        delete i.error;
        j.state = "ready";
        j.financialVersion = snapshot.financialVersion;
      });
    } catch (error) {
      await this.store.transaction((s) => {
        const j = s.jobs[job.id];
        if (!j || j.leaseUntil !== job.leaseUntil) return;
        const message =
          error instanceof Error ? error.message : "Collection failed";
        s.issuers[job.issuerId]!.error = message;
        j.error = message;
        j.state = j.attempts < 3 ? "queued" : "failed";
        j.nextAt = Date.now() + Math.min(3600000, 60000 * 2 ** j.attempts);
      });
    }
    return true;
  }
}
