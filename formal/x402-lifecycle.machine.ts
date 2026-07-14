// Formal model of the x402 agent-payment lifecycle (the go-live target ordering:
// verify -> serve -> settle). Proves the core billing-safety properties that the
// design note (docs/x402-billing-design.md) calls go-live blockers:
//
//   chargeNeedsServe : a payment is SETTLED (the agent is charged) only after the
//                      data was actually SERVED. This is exactly the guarantee the
//                      CURRENT merged code (verify -> settle -> serve) VIOLATES —
//                      a paid request to an unknown chain settles, then 404s, so
//                      the agent is charged with nothing delivered. Modeling the
//                      target ordering makes this invariant hold; modeling the
//                      current ordering (move settle before serve) makes TLC find
//                      a counterexample. That's the formal case for the reorder.
//   serveNeedsVerify : data is only served after the facilitator verified payment.
//   No double-charge  : `settled` and `denied` are terminal (no outgoing action),
//                      so a nonce can never settle twice — enforced by construction.
//
// This machine documents & guards the design; it is not wired to a table (no
// runtimeAdapter metadata) — `check` proves it, no `build` needed.
import {
  defineMachine, variable, mapVar,
  enumType, boolType,
  lit, param, eq, or, not, forall, index,
  setMap, ids,
} from "tla-precheck";

const phase = variable("phase");
const verified = variable("verified");
const served = variable("served");

export const x402Lifecycle = defineMachine({
  version: 2,
  moduleName: "X402Lifecycle",
  variables: {
    // per payment attempt: where it is in the gate
    phase: mapVar("Reqs", enumType("awaiting", "verified", "served", "settled", "denied"), lit("awaiting")),
    // history flags so ordering can be asserted as a state invariant
    verified: mapVar("Reqs", boolType(), lit(false)),
    served: mapVar("Reqs", boolType(), lit(false)),
  },
  actions: {
    // facilitator /verify succeeds
    verifyOk: {
      params: { r: "Reqs" },
      guard: eq(index(phase, param("r")), lit("awaiting")),
      updates: [setMap("phase", param("r"), lit("verified")), setMap("verified", param("r"), lit(true))],
    },
    // facilitator /verify rejects (invalid / structural mismatch / facilitator down)
    verifyReject: {
      params: { r: "Reqs" },
      guard: eq(index(phase, param("r")), lit("awaiting")),
      updates: [setMap("phase", param("r"), lit("denied"))],
    },
    // route handler serves the paid data (only possible after verify)
    serveOk: {
      params: { r: "Reqs" },
      guard: eq(index(phase, param("r")), lit("verified")),
      updates: [setMap("phase", param("r"), lit("served")), setMap("served", param("r"), lit(true))],
    },
    // handler throws / 404s AFTER verify but BEFORE settle: NOT charged (the fix).
    serveError: {
      params: { r: "Reqs" },
      guard: eq(index(phase, param("r")), lit("verified")),
      updates: [setMap("phase", param("r"), lit("denied"))],
    },
    // facilitator /settle succeeds — charge happens, only reachable from `served`
    settleOk: {
      params: { r: "Reqs" },
      guard: eq(index(phase, param("r")), lit("served")),
      updates: [setMap("phase", param("r"), lit("settled"))],
    },
    // settle fails after serving: client keeps funds but got data (accepted, logged)
    settleFail: {
      params: { r: "Reqs" },
      guard: eq(index(phase, param("r")), lit("served")),
      updates: [setMap("phase", param("r"), lit("denied"))],
    },
  },
  invariants: {
    chargeNeedsServe: {
      description: "A settled (charged) request must have been served — never charge without delivering.",
      formula: forall("Reqs", "r", or(
        not(eq(index(phase, param("r")), lit("settled"))),
        eq(index(served, param("r")), lit(true)),
      )),
    },
    serveNeedsVerify: {
      description: "A served request must have been verified first.",
      formula: forall("Reqs", "r", or(
        not(eq(index(served, param("r")), lit(true))),
        eq(index(verified, param("r")), lit(true)),
      )),
    },
    settleNeedsVerify: {
      description: "A settled request must have been verified (transitive safety).",
      formula: forall("Reqs", "r", or(
        not(eq(index(phase, param("r")), lit("settled"))),
        eq(index(verified, param("r")), lit(true)),
      )),
    },
  },
  proof: {
    defaultTier: "pr",
    tiers: {
      pr: {
        domains: { Reqs: ids({ prefix: "q", size: 2 }) },
        budgets: { maxEstimatedStates: 10_000 },
        // This lifecycle terminates: every request ends at settled/denied, so a
        // "deadlock" (no enabled action) is the correct terminal state, not a bug.
        checks: { deadlock: false },
      },
    },
  },
});

export default x402Lifecycle;
