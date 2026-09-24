# CureBid engineering notes

## Repayment and reimbursement are separate operations

A borrower wants to reduce an existing Aave debt without withdrawing their collateral. A provider can supply USDC on Sepolia, but should receive CTC on Creditcoin only after meeting that obligation. The chains do not share an atomic transaction, and an HTTP response from a proof service is not authority to release escrow.

```text
Borrower / provider wallets
        │
        ├── Creditcoin CC3 Testnet: CureMarket
        │      deposit → quotes → selection → reserved reimbursement
        │
        └── Ethereum Sepolia: CureRouter → Aave V3 Pool
               repayment or source expiry
                         │
                  authenticated receipt
                         │
               AttestcoinVerifier on Creditcoin
                         │
               CureMarket settlement → pull credit → withdrawal
```

The [router](../contracts/src/CureRouter.sol), [market](../contracts/src/CureMarket.sol), and [verifier](../contracts/src/AttestcoinVerifier.sol) have separate responsibilities. The web application reads contract state and submits wallet-authorized calls. Its unsigned proof endpoint is a courier, not a trusted settlement service. This bounded prototype does not need a database or a background operator with custody of funds.

## Contract state and accounting

| Market state                 | Allowed transition            | Authority                                                   |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------- |
| Open                         | Assigned                      | Borrower selects a provider and confirms the expected quote |
| Open                         | Cancelled                     | Borrower cancels before assignment                          |
| Assigned                     | Settled                       | Authenticated source repayment                              |
| Assigned                     | Refunded                      | Authenticated source expiry                                 |
| Settled, Refunded, Cancelled | No further request transition | Beneficiaries withdraw their recorded credits separately    |

Providers quote a fixed total CTC reimbursement, capped by the deposit. Quote acceptance supplies the expected amount so an intervening quote update cannot silently change the selected price. The market allows at most 32 providers per request.

When a quote is selected, the difference between the deposit cap and reimbursement becomes borrower credit. The reimbursement remains reserved. Settlement moves that reserve into provider or borrower credit according to the proven outcome. `withdraw` clears the caller's credit before transferring CTC and uses a reentrancy guard; a rejected transfer reverts that withdrawal without undoing a previously confirmed settlement.

The solvency condition is `market balance >= reserved + totalCredits`. Keeping reservations and payable credits separate avoids treating settlement as proof that an external payout already succeeded.

## No refund based only on elapsed time

The source router records one terminal outcome per execution digest: `Repaid` or `Expired`. Repayment must happen by the execution deadline; expiry must happen after it. Either outcome prevents the other.

An assigned destination request cannot refund on a destination timer alone. Otherwise, a provider could repay before the deadline, wait for a delayed proof, and find that the borrower had already reclaimed reimbursement. CureBid requires proof of source expiry instead.

This choice protects earned reimbursement but accepts a liveness cost: if attestation stops, assigned escrow can remain locked. There is no administrator override that converts an unavailable proof into success or refund.

## Bind proof to the obligation

[`CureTerms`](../contracts/src/CureTerms.sol) hashes a versioned tuple containing the destination chain, market, request ID, source chain, router, Aave Pool, asset, borrower, provider, amount, and execution deadline. Solidity and the client must agree on this encoding.

The immutable verifier calls Creditcoin's native `0xFD2` verifier in the settlement transaction. It then decodes the authenticated EIP-1559 transaction/receipt and requires:

- the configured Attestcoin chain key and the expected EVM chain IDs;
- a successful source receipt;
- exactly one matching router outcome with the bound parties, amount, and deadline;
- for repayment, a matching Aave Pool repayment event in that same receipt;
- bounded proof, log, and continuity data.

Replay identity derives from the verified transaction bytes, source height, chain key, and matched log index, rather than a caller's claimed transaction hash. The market records proof use and closes the assigned request before making credit available. Anyone may transport the proof, but its submitter cannot choose the beneficiary.

The supported source encoding is deliberately restricted to type-2 transactions. Attestcoin's chain key is a separate identity from an EVM chain ID. See the [security model](integration-security.md) for the remaining consensus, RPC, wallet, and configuration trust assumptions.

## Check Aave's accounting, including rounding

The router requires the selected provider, transfers the agreed USDC amount, calls Aave's variable-rate repayment path, and clears the Pool allowance afterward. It requires Aave to return the exact requested repayment and checks that the borrower's variable debt decreased.

Aave's scaled-debt arithmetic means the difference between two debt-balance reads need not equal the returned repayment down to a single base unit. During public execution, the original router reverted when Aave returned 3,000,000 base units but the debt reads differed by 3,000,002. The original fixed one-unit tolerance was too small for the accrued index.

The corrected router bounds the balance-read discrepancy using `ceil(index / (2 * RAY)) + 1`, while retaining the exact repayment-amount requirement. A regression pins the block that reproduced the failure. The original transaction remains recorded as failed, and the original deployment is retained as superseded. [Execution and rounding evidence](evidence/execution-notes.md) explains the correction; [cleanup evidence](evidence/superseded-cleanup.json) records the old escrow's completed refund and withdrawal.

## Frontend and operator boundaries

[`apps/web`](../apps/web/) uses Next.js and React for the routes and wallet controls, ethers for chain reads/writes, and Three.js for a state-aware explanatory mechanism. Financial controls remain ordinary HTML. Reduced motion, pause, mobile, and WebGL fallback behavior are tested separately from contract execution.

The UI distinguishes source repayment from destination settlement, and settlement from withdrawal. The public verification page labels committed receipt snapshots as historical evidence. Current request cards use RPC reads rather than seeded orders or invented balances.

Operator scripts record deployment intent and transaction identities so confirmed deployments can be reconciled after an interruption. A source terminal-state check prevents a repeated repayment. Ambiguous intents without a recoverable transaction identity stop for inspection; this is not an autonomous exactly-once transaction scheduler. Repository renaming does not change the `CureBid.v1` protocol domain, deployed addresses, wallet locations, package names, or toolchain location.

## Verification layers

| Layer                        | What it establishes                                                                              | What it does not establish                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Foundry unit/fuzz tests      | State transitions, accounting, authorization, malformed proofs, replay handling                  | Public consensus or real cryptography when fixtures supply verifier outcomes |
| Pinned Sepolia fork          | Aave supply, borrowing, third-party repayment, and accrued-index rounding against protocol state | A broadcast public transaction                                               |
| Vitest                       | Shared chain, amount, wallet, deployment, presentation, and proof policies                       | Browser rendering or settlement                                              |
| Playwright and axe           | Wallet-free UI behavior, accessibility checks, layouts, fallbacks, and repository links          | Wallet signing or new payments                                               |
| Historical feasibility proof | Authentication of an existing third-party Aave repayment                                         | CureBid-owned execution                                                      |
| Owned testnet evidence       | Deployed repayment, settlement, refund, and withdrawal receipts                                  | Audit coverage or production readiness                                       |
| `pnpm judge:verify`          | Current deployed identities, solvency, and request-state readback                                | A fresh cryptographic replay of every historical receipt                     |

The [public execution file](evidence/live-execution.json), [negative-proof results](evidence/live-negative-proofs.json), and [delivery checklist](delivery-status.md) keep those evidence classes separate. Reproducing a new funded lifecycle is optional and belongs to the [testnet runbook](testnet-runbook.md), not the read-only verification path.
