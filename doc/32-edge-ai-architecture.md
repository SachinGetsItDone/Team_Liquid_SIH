# Edge & On-Device AI Architecture - Patterns and MLOps Methodology

> **Status: REFERENCE (unratified).** Researched 2026-09-16. This doc covers the *intersection* of
> `doc/30` (CPU-AI optimization) and `doc/31` (system-design theory): how to architect, deploy,
> evaluate, and govern AI pipelines that run at the edge, offline, under tight resources. It is
> written with the MediKiosk context in view (CPU-only, offline-first, ~4 GB kiosk + on-prem hospital
> edge server, 4,000-10,000 patients/day) but the patterns are general.
>
> **Relationship to existing KB:** `doc/19-production-blueprint.md` already fixes the project
> topology and invariants; `doc/20-module-b-production-design.md` fixes Module B's eval-set, engine,
> sync, and review design. This doc is the **methodology reference** those docs can cite - it does not
> re-decide anything there.

---

## 1. Edge / on-device AI deployment topologies

### 1.1 The canonical topologies

| Topology | Where inference runs | Latency | Offline behavior | Fit for a kiosk |
|---|---|---|---|---|
| Pure on-device | Kiosk CPU (GGUF-quantized small models) | Zero network hop | Total | Session-critical capture/validation only |
| Thin-device + edge server | Kiosk captures; on-prem server runs models | Intra-LAN ~1-10 ms | Works if LAN up | **Primary target** when a 4 GB kiosk cannot host good models |
| Cloud offload | Remote GPU | 100 ms - seconds | Fails | Opportunistic sync only, never critical path |
| Tiered / hierarchical | Device -> edge -> cloud routed dynamically | Varies | Degrees of fallback | Long-term target if cloud ever allowed |

The 2026 literature frames this as a **three-tier inference architecture** (Tier 1 on-device SLMs,
Tier 2 private/on-prem, Tier 3 frontier cloud). Production deployments report **70-80% of queries
never need a frontier model** - classification, extraction, formatting, simple reasoning
[Zylos 2026-05-10; Tian Pan 2026-04-10]. For a kiosk with **no cloud tier at all**, that number is the
design lever: **do not run a generative model where a deterministic extractor or small classifier
suffices.**

### 1.2 When to split inference (and when not to)

Splitting is only worth it if the activation transfer is small relative to compute saved.

- **DNN partition rules:** split at layer boundaries where the intermediate payload is smallest.
  SWEET jointly optimizes per-layer bitwidth and split point against an accuracy-degradation budget,
  cutting communication payload >80% with <1% accuracy loss [SWEET, Frontiers 2026-06-04].
- **LLM partition rules differ:** inference is *stateful* (growing KV cache) with two asymmetric
  phases (compute-bound prefill, bandwidth-bound decode) and unpredictable output length. Device ->
  edge -> cloud is bandwidth-sensitive for long prompts [Network Edge Inference for LLMs, arXiv
  2604.22906].
- **Heuristic:** split only when (a) the split point's activation is small, (b) the link is stable and
  low-latency (LAN, not cellular), and (c) the model genuinely does not fit. **On a hospital LAN this
  is usually unnecessary** - have the edge server run the model whole and keep the kiosk a thin
  client.

### 1.3 Model serving topologies

| Pattern | Mechanism | Cold start | Isolation | Best for |
|---|---|---|---|---|
| Single-process | Model loaded in the app process | Process startup + weight load | None | One device, one model |
| Sidecar model server | Each app loads its own model from local storage | Slow (disk-bound on CPU) | Strong | Per-container workloads |
| Shared model daemon | Central service loads models into RAM, serves many clients | Amortized once; per-model first use | Medium | **Hospital edge server serving many kiosks** |
| Centralized store + pre-warmed spares | Store pre-loads into shared memory/NVMe; pods attach | Near-zero for pre-warmed | Depends | Production fleets, multi-model |

Key fact: **each new process pays a full cold start** (runtime init, weight load, graph compile)
before serving one request [llm-d]. CPU systems are simpler than GPU sleep/wake schemes, but the plan
is the same: keep the embedding model and small classifiers resident; load the large generative model
only if needed; **never let a request trigger a cold load on the hot path**. A shared model daemon on
the edge server is the default for a fleet; kiosks should not load large models at all.

### 1.4 Containerization on edge

Containers are the standard edge packaging unit: fault containment (one crashing module can't take
down the loop), strict memory/CPU limits, atomic OTA with instant rollback [Aicademy 2026-04-27].

- **Lightweight orchestration:** K3s is a single <100 MB binary, runs in ~512 MB RAM, embeds SQLite
  instead of etcd, supports ARM64/ARMv7. Reasonable on the edge server; **on a 4 GB kiosk prefer plain
  systemd + containers (or bare processes)** - K3s plus workloads on <4 GB invites memory pressure.
- **Pull-based GitOps** (e.g. Rancher Fleet): each site pulls its declarative bundle; an offline site
  is a **normal state, not an incident**, and reconciles on reconnect.
- **Image staging is the #1 far-edge failure:** bundles apply cleanly and sit in `ImagePullBackOff`
  where there's no registry. Stage images locally and **gate rollouts on digest presence**.
- **Granularity check:** if the fleet is really simple devices, KubeEdge or plain process supervision
  may fit better than full Kubernetes.

### 1.5 OTA model updates, versioning, rollback

The strongest operational conclusion: **do not bind firmware, model, and configuration into one
version number** - they have different blast radii and rollback costs [ZedIoT 2026-03-26]. Track three
independent version planes:

1. **Firmware/runtime** (OS, inference runtime, drivers)
2. **Model** (weights, quantization config, label maps, pre/post-processing)
3. **Config** (thresholds, sampling policy, model-selection rules, feature flags)

A **release object** states target device groups, which layer(s) change, prerequisite versions,
success definition, and which layer rolls back first. Then:

- **Staged rollout must test *recovery*, not just delivery:** 1% -> 10% -> 100% checks device start,
  inference quality/resource behavior, and automatic rollback.
- **Rollback triggers must be health signals, not timeouts:** model started? latency within bound?
  memory/temperature normal? input streams present? Device-online alone is insufficient - a device can
  be online while inference is broken.
- **Delta OTA:** tensor-level deltas ship only changed weights (a 2.1 MB update can be ~1,263 bytes;
  one fleet measured 60.51% bandwidth reduction) [InTechHouse 2026-07-03].
- **Signed artifacts + A/B or dual-partition rootfs:** verify signature/checksum before activation;
  post-update health check + sample-inference replay; auto-revert in a bounded window.
- **Model as a versioned bundle artifact**, so it inherits the same OTA/rollback/integrity workflow as
  code.
- Fleet case: 600-device fleet, manual deploys 9 days -> median **38 minutes** after
  registry + signed OTA + canary + drift-triggered rollback; ~1.2 drift-triggered auto-rollbacks/month
  with none escalating [Yantrix 2026-05-04].

### 1.6 Federated / pipeline-parallel inference on CPU

- **Federated learning** (training, not inference) on resource-constrained devices is active research
  but heavy: heterogeneity, non-IID data, communication/energy budgets, and stragglers blocking
  synchronous aggregation.
- **Reality check:** FL training on ~4 GB CPU kiosks is not practical for a first deployment; FL
  inference is a category error. What *is* useful is **periodic centralized retraining** on consented,
  de-identified data exported from kiosk/edge.
- **Pipeline-parallel inference across CPU nodes** is possible but the activation-transfer and
  orchestration overhead rarely beats "run it whole on the edge server" for models that fit in RAM.

### 1.7 Recommended topology (kiosk context)

```
Kiosk (4 GB CPU)                    Hospital edge server (on-prem)
+---------------------------+       +------------------------------------+
| UI / voice capture        |  LAN  | Shared model daemon (llama-server) |
| Deterministic validation  |<----->| Embedding model (resident)         |
| Small classifiers (tiny)  |       | RAG index (sqlite-vec)             |
| Local SQLite queue (outbox)|      | Summary generation                 |
| Session cache             |       | Model registry + OTA agent         |
+---------------------------+       +------------------------------------+
        |                                      |
        +---- no cloud on the critical path ----+
                 (opportunistic sync to HIS/ABDM when link is healthy)
```

---

## 2. Offline-first and unreliable-network patterns

### 2.1 Local-first principles

Kleppmann et al.'s seven ideals: no spinners; your work is not hostage; network optional; seamless
collaboration; long-term preservation; security/privacy by default; user control
[Ink & Switch 2019]. The architectural inversion: **the local replica is authoritative; the server is
a relay**, not the source of truth. For a kiosk this means **a session must complete end-to-end with
the network unplugged**, and sync is a background concern.

Classic anti-patterns to avoid: **Global State Fallacy** (centralized state with no local cache ->
network partition halts operations) and **Centralized Chokepoint** (single gateway with no failover)
[Anti-Patterns in Industrial Cloud-Edge Systems, TechRxiv 2025-04-11].

### 2.2 CRDT vs OT vs last-write-wins

| Approach | Merge semantics | Best for | Costs |
|---|---|---|---|
| CRDT | Deterministic, coordination-free convergence | Concurrent edits to different fields; multi-writer offline | Metadata/tombstone growth; compaction; hard schema migration |
| OT | Central server transforms concurrent ops | Real-time collaborative text with a trusted server | Requires central authority; poor offline |
| LWW register | Highest timestamp/causal wins | Single-value fields | Silent loss of concurrent writes; **never trust wall-clock** |
| Event sourcing / append-only log | Replay + reconcile | Audit-heavy clinical records | Unbounded log; needs snapshots |

Practical guidance: OR-Set for membership (deletes stick), LWW-Register for single values, sequence
CRDTs (RGA/YATA) for text, counters for tallies; split large documents into small CRDT scopes. Two
production killers: **unbounded history growth** and **schema migration with offline clients**
replaying old-schema writes. The 2026 reframing: the question is not "CRDT or OT?" but **which
sync-engine boundary** (rows vs document ops vs event logs), because that dictates migration and
multi-device identity behavior.

### 2.3 Store-and-forward and the transactional outbox

The **dual-write problem** - write to DB then publish to broker, with a crash window between - is the
most common reliability bug in event-driven systems. The fix is the **transactional outbox**: write
the event into an `outbox` table **in the same transaction** as the business state change; a separate
relay publishes asynchronously.

Essential mechanics:
- **Relay claims rows with `SELECT ... FOR UPDATE SKIP LOCKED`** so multiple relays don't
  double-publish or serialize.
- **Order is fixed: publish first, then stamp `published`.** Reversing it loses events.
- **At-least-once is guaranteed; exactly-once is not.** Consumers must be idempotent - the **inbox
  pattern**: insert the message ID into a `processed_events` table (unique-constrained) **in the same
  transaction** as the side effect. `INSERT ... ON CONFLICT DO NOTHING` returning zero rows = duplicate,
  skip.
- **Retention window**: prune processed keys after longer than the maximum redelivery window.
- **DLQ**: move events failing past the attempt cap with original payload/error/attempt history;
  **alert on DLQ growth**; build replay before the incident.
- **Monitor**: outbox lag (P99 > SLA), pending row count growing monotonically, retry distribution,
  DLQ size, relay health.

For a kiosk the outbox **is** the sync queue: every completed session writes a `pending_sync` row
transactionally with the local session record; a relay pushes to the HIS/ABDM bridge and marks
acknowledged.

### 2.4 Retry, backoff, reconciliation

- Exponential backoff **with jitter** (otherwise failed clients stampede the recovering dependency).
- **Cap attempts** (unbounded retries let one poison message occupy a worker forever).
- **Classify errors first:** retriable (timeouts, 5xx, lock contention) vs terminal (validation, 4xx,
  business-rule rejection). Terminal errors go straight to the DLQ.
- **Retry budgets:** retries <= ~10% of first-attempt traffic, so retry load is <=1.1x, not `k`x.
- **Per-key ordering only:** partition by business identity (`patient_id`, `session_id`), not random.

### 2.5 Delta sync, CDC, tombstones, clock skew

- **Delta sync** sends only changes since a cursor/vector clock; bootstrap new devices with a snapshot
  + recent deltas.
- **CDC** (Debezium/WAL tailing) gives near-real-time outbox publication with lower DB load but more
  operational complexity; start with `SKIP LOCKED` polling, migrate to CDC when forced.
- **Tombstones** mark deletes so delayed replays don't resurrect data; prune after all peers ack.
- **Clock skew is not a merge primitive.** Use Lamport/vector clocks or per-actor monotonic counters;
  never rely on wall-clock time for correctness.

### 2.6 Offline auth and token expiry

A distinct hazard: **an expired token must not halt patient care.**

- Cache the last-known-good authorization state; make **consent and identity the offline source of
  truth** for the current session.
- **Long-lived device credentials + short-lived session tokens:** the kiosk authenticates to the edge
  server with a device certificate (mTLS); session tokens are issued locally with bounded TTL and
  refreshed opportunistically.
- **Resumable sessions:** persist session state (partial transcript, captured documents, consent
  draft) so a crash/power cut resumes where it stopped. Never lose a partially completed intake.
- ABDM itself supports offline ABHA creation via paper forms scanned later (permission-gated mode);
  the kiosk should mirror capture-and-queue behavior.

### 2.7 Degradation ladder

Decide the ladder **in advance**. Every system eventually sees load it cannot serve.

| Trigger | Degradation |
|---|---|
| Edge server unreachable | Kiosk runs deterministic-only capture + validation; defers AI summary |
| Model daemon OOM/error | Fall back to rules + template summary; queue for later enrichment |
| LLM latency over budget | Return structured deterministic output with "AI summary pending" flag |
| Network to HIS/ABDM down | Outbox queues; kiosk continues; sync on reconnect |
| Kiosk under memory pressure | Disable non-critical models (embeddings, rerankers) first; keep capture alive |
| Sync backlog large | Increase backoff; prioritise clinical records over telemetry |

**The single most important rule: never show a spinner that blocks the patient because the network or
model is unavailable.**

---

## 3. ML system design & MLOps for edge

### 3.1 Problem framing: predict vs retrieve vs generate vs deterministic rules

Decide the paradigm **before** choosing a model:

| Paradigm | Use when | Example |
|---|---|---|
| Deterministic rules / state machine | Logic is knowable, auditable, must never fail | Question ordering, red-flag checks, consent gating, unit conversion |
| Retrieve | The answer exists in a corpus and must be cited | Guideline snippets, drug lookups, local policy |
| Classify / predict | Small label space and labeled data exist | Triage acuity, "needs review" flag, language detection |
| Generate | Free-text synthesis from structured facts is required | Summary prose, patient-friendly explanation |

The clinical-AI literature strongly favours **deterministic-first**: rules own hard safety, ML
assists. The KRD architecture short-circuits to a rule-cited blocking response whenever a hard
violation fires, **never invoking the language model**, and issued 47% fewer LLM calls per benchmark
pass as a side effect [KRD, JIMH 2026].

### 3.2 Data collection, ground truth, and labeling

- **Ground truth is the scarce resource** - budget for clinician adjudication.
- **Label reliability must be measured**: Cohen's kappa (two raters) / Fleiss' kappa (multiple) with
  CIs; log the adjudication protocol as provenance [TeMLM, arXiv 2601.19191].
- **Patient-level splits** for clinical notes - never split by note (leaks identity/style).
- **Structured feedback capture is a labeling pipeline**: every clinician accept/reject/edit is a
  labeled datapoint tied to model version, prompt version, context hash, reviewer role.
- **Missingness is a clinical signal**, not noise; record field-level missingness as a feature/caveat.
- **De-identification must be validated by sampling**, not trusted because a tool ran; report a
  residual-PHI-risk proxy.

### 3.3 Evaluation sets and error analysis

Build and freeze **three evaluation artifacts:**
1. **Golden set** - clinician-adjudicated, held out, never tuned on.
2. **Regression set** - one case per known past failure; every fixed bug adds a case.
3. **Adversarial/shift set** - dialect, code-switching, abbreviation-dense notes, sparse notes,
   contradictory histories, OOD.

Error analysis must be **stratified** by subgroup (language, age, sex, department), input length, and
confidence band. Offline metrics (AUC/F1/ROUGE) do not predict online impact; **model failures are
usually silent** (a degraded model returns a confident wrong answer, no 500 error); distribution shift
degrades a model with zero code changes. For generative output, run **error audits** classifying
hallucination, omission, and clinically-unsafe-summary rates - not one score.

### 3.4 Model selection: accuracy floor vs constraints

Set **hard constraints first**, then optimize accuracy within them:

| Constraint | Kiosk target | Edge-server target |
|---|---|---|
| Peak RAM | <= ~1.5 GB for any resident model | <= 60% of server RAM with headroom |
| P95 latency | < 2 s interactive turns | < 5 s summary generation |
| License | Permissive (Apache-2.0/MIT) for redistribution | Check commercial terms |
| Offline | Weights on disk, no network calls | Same |
| Determinism | Greedy/temperature-0 for structured extraction | Lower temperature for summaries |

Method: define an **accuracy floor per task** and exclude any model below it, *then* rank survivors by
latency/RAM - the inverse of "best accuracy wins." A clinical-coding system using a hybrid
neuro-symbolic pipeline with deterministic keyword fallback achieved **0% hallucination on covered
codes** and never failed when the model did: "reliability through redundancy is more valuable than pure
model performance in production healthcare systems" [Hybrid-Code, arXiv 2512.23743].

### 3.5 Bake-off design & benchmark methodology

Run on **target hardware** with production-representative inputs.

**Warm-up (IETF LLM benchmarking draft):** load fully; process >=100 requests or >=10,000 output
tokens; wait for queue drain; verify latency stabilization (<10% variation); **cold-start measurement
must skip warm-up and be labelled**.

**Metrics (never averages for latency):** TTFT P50/P90/P95/P99; TPOT/ITL P50/P95/P99 with jitter and
max-pause; end-to-end P50/P95/P99; throughput at target concurrency; cost per successful outcome;
task-specific quality (exact match / F1 / hallucination rate) with CIs. **Sample counts:** >=1,000
requests for P99 within 10% relative error at 95% confidence; >=10,000 for P99.9.

**Traps to avoid:**
- Measure **at production concurrency**, not one-at-a-time; find the **knee** where concurrency stops
  improving throughput.
- The benchmark client can be the bottleneck (single-process async clients inflate TTFT); use a
  multi-process generator and verify dispatch-delay medians <1 ms [arXiv 2605.24217].
- Sampling temperature changes throughput (~21% for 0 vs 0.7) - pin and report it.
- Prefix-cache hit ratio must be reported (it drives TTFT variance).
- **Saturation detection:** queue depth growing continuously, completion rate <90% of arrivals, or
  P99 >10x P50 at lower load.
- **Regression gates:** gate the tail (P95/P99) and output-token budget with a tolerance band;
  **re-baseline on every model change**.

### 3.6 Versioning, experiment tracking, model registry, reproducibility

- **Version three layers independently**: **data** (raw extract, de-identified text, labels, split
  manifests), **code**, **model** (checkpoints, exported inference artifacts). Reference by
  cryptographic hash so "same inputs -> same outputs" is testable.
- Tag build artifacts with build ID, code commit, data version.
- **Model registry** records training-data lineage, validation results, **optimization configuration**
  (quantization/pruning schedule), and per-device deployment status. Two models from the same
  checkpoint but different quantization can behave meaningfully differently - trace the exact binary.
- **Prompt/config versioning is first-class:** store `model_version`, `prompt_version`,
  `retrieval_sources`, `decision_policy_version` in every provenance record.
- **Reproducibility** needs deterministic pipelines, pinned environments, logged seeds.

### 3.7 Monitoring, HITL, feedback, silent-failure detection

The operating loop is **detect -> shadow -> rollback**:

- **Input drift** (PSI/KL vs training distribution); **output confidence** monitoring; **performance
  benchmarking** against known ground-truth samples.
- **Prediction logging** so there is a baseline; without it there is no drift detection.
- **Silent failure is the enemy:** instrument *outcome* metrics - acceptance rate, override rate,
  escalation count, citation-failure rate, confidence calibration over time.
- **Human-in-the-loop review queue:** route only low-confidence/high-risk/rare/OOD/patient-safety
  cases, and **explain why each item was escalated**; one-click accept/edit/reject/defer; require a
  brief reason for risky overrides.
- **Shadow mode** runs the new model alongside the old without influencing decisions.
- **Canary -> A/B:** canary shifts traffic incrementally with automated gates; A/B compares against a
  concurrent baseline. **AI canaries must monitor quality, not just uptime** (hallucination,
  coherence, task completion) and need **hours, not minutes**, of soak time; hash by user/session.
- **Rollback is a routing change**, not a redeployment.

### 3.8 Safety, governance, regulation

- **Frameworks crosswalk:** NIST AI RMF 1.0 (Govern/Map/Measure/Manage); ISO/IEC 42001:2023
  (certifiable AI management system); EU AI Act (binding lifecycle obligations; high-risk Annex III
  from 2 Dec 2027, Annex I embedded from 2 Aug 2028 per the 2026 AI Omnibus). A published crosswalk
  maps AI Act Arts. 9-17 to ISO 42001 Annex A controls and NIST subcategories [NIST, 2026].
- **India CDSCO MDSW guidance** (final circular 21 Jul 2026): function-based approach; software with a
  medical purpose (incl. AI/ML, mobile, cloud, COTS) is a medical device regardless of SiMD/SaMD
  terminology; risk classes A-D; clinical decision-support guiding diagnosis/treatment in critical
  situations tends toward C/D; requires QMS, ISO 14971 risk management, IS/ISO/IEC 62304, IS/ISO
  13485, IS/IEC 82304-1, IEC 81001-5-1; introduces an **Algorithm Change Protocol (ACP)** so
  predefined model updates can proceed without separate approval per change. **Critical scoping
  question:** does structured history capture + summary generation count as a medical purpose or
  administrative documentation? Any diagnostic/triage/treatment suggestion likely brings it inside -
  write the intended-use statement deliberately and get legal review before crossing the line.
  (Project-side flags already live in `doc/16` Sec 4 and `doc/07`.)
- **ABDM:** hospital must be an **HIP**, registered via HFR; milestones M1 (ABHA), M2 (HIP), M3
  (HIU), M4 (claims) are certified per-software through NHA's sandbox; V3 APIs are current; discovery
  is synchronous. A central patient master index (ABHA -> MRN -> LIMS -> RIS) is the critical
  integration structure.
- **DPDP Act 2023 + Rules 2025** (published 14 Nov 2025): DPDP deliberately creates **no special
  "sensitive" category for health data** - same baseline as an email address. Obligations: clear
  notice, free/specific/informed/unconditional consent with purpose limitation, minimisation, rights
  (access/correction/erasure/nomination), security safeguards, **breach notification within 72 hours**
  (CERT-In's 6-hour reporting runs in parallel and is stricter). Section 7 permits processing without
  consent for **medical emergencies** and epidemic/public-health response, not routine follow-ups.
  Retention must reconcile storage limitation with medico-legal retention (layered: full deletion for
  optional data; pseudonymisation/access restriction for mandated records).
- **Model cards / provenance:** use a machine-checkable release bundle rather than prose. A provenance
  record should contain `recommendation_id`, `patient_context_hash`, `model_name`, `model_version`,
  `prompt_version`, `retrieval_sources`, `source_timestamps`, `confidence_band`, `risk_level`,
  `human_reviewer_id`, `final_disposition`.

---

## 4. AI pipeline architecture patterns

### 4.1 Router, cascade, early-exit, ensemble

| Pattern | Mechanism | Latency | Cost | Key dependency |
|---|---|---|---|---|
| Router | One model chosen per query, ex-ante | Lowest | Low | A good quality/complexity estimator |
| Cascade | Run small model; escalate if unsatisfactory | Higher (can pay twice) | Low-medium | A reliable stopping/confidence signal |
| Early-exit | Exit at an intermediate layer when confident | Lowest | Lowest | Trained exit classifiers |
| Ensemble/voting | Multiple samples/models, aggregate | Highest | Higher | Confidence weighting; calibration |
| Cascade routing (unified) | After each response, decide stop or invoke any unselected model | Adaptive | Adaptive | Optimal under stated assumptions |

The critical factor is **good quality estimators** [Dekoninck et al., PMLR 2025]. **Calibration, not
threshold tuning, is the engineering lever:** isotonic regression maps margin uncertainty to an error
probability and reduces expected calibration error from 0.12 to 0.03; UCCI cut cost 31% at micro-F1
0.91 on production NER [arXiv 2605.18796]. RouteNLP's distillation-routing co-optimization cut cost
58% with p99 387 ms in an 8-week pilot [arXiv 2604.23577].

For a clinical kiosk: cascade is deterministic rules -> small local model -> edge-server generation ->
(never) cloud. Confidence-based escalation is correct, but confidence must be **calibrated** and
**augmented with non-model signals** (retrieval support quality, input completeness/missingness, case
criticality). A single softmax number is not clinical confidence.

### 4.2 RAG and its CPU implications

**Vector store options for an offline edge server:**

| Store | Architecture | Index | Comfortable ceiling | RAM profile | Fit |
|---|---|---|---|---|---|
| sqlite-vec | SQLite extension, pure C | Brute-force exact (ANN alpha) | ~tens of thousands (fine to 500K) | Minimal; ~0 idle | **Best default** - vectors in the same `.db`; backup = copy one file |
| Chroma | In-process, HNSW | Approximate | ~1M if it fits RAM | High (graph in RAM) | Prototyping |
| LanceDB | Rust on Lance columnar | Disk-based IVF-PQ | Billions | Low, memory-mapped | Scale + hybrid + versioning |
| FAISS | In-process C++ | Many | Varies | Varies | Research/custom |

**CPU embedding economics:** a SQLite RAG pipeline embedding 182 documents (~640 words each) took
~25 minutes on a standard CI runner; at runtime it served queries from a 4-vCPU/~100 MB server using a
300M Q8 embedding model with **~370 ms average end-to-end cycle**, using FTS5 + vector hybrid search
merged by Reciprocal Rank Fusion [SQLite AI 2025-10-23]. Right shape for a kiosk: **precompute
embeddings at build time; at runtime embed only the query.**

**RAG vs fine-tune vs rules:**

| Need | Choose |
|---|---|
| Knowledge changes frequently; must be citable | RAG |
| Task-specific behaviour/format; stable task | Fine-tune (LoRA/QLoRA) |
| Hard constraints, safety, math, ordering | Rules / state machine |
| Both up-to-date knowledge and task behaviour | Hybrid FT + RAG |

### 4.3 Deterministic-first and anti-fabrication

Rules own critical logic; ML assists; the LLM is **structurally unreachable when rules can settle the
case**. KRD's decision function is evaluated in fixed order: (1) hard violation -> blocking response
from rule citations, model never called; (2) insufficient-evidence gate -> refusal naming missing
evidence, model never called; (3) normal composition -> model writes prose over structured facts.

Complementary techniques:
- **Neuro-symbolic verification:** a symbolic auditor checks every generated claim against a
  rule/knowledge base; Hybrid-Code achieved 0% hallucination on covered codes with a deterministic
  fallback and a symbolic verifier rejecting 75.5% of unsupported proposals.
- **Guideline-as-reasoning-graph:** executable decision tree rather than retrieval; KAGR pushed
  instruction-adherence correctness above 95% where RAG fell short.
- **Confidence-led fusion:** trust the rule when the rule engine is high-confidence, the ML when not.
- **Rule-based guardrails as formal constraints:** an ontology + semantic-web rule layer reduced
  guideline-violation errors by 78% (contraindication rate 18% -> 6%) while maintaining AUC 0.84/0.87.
- **Per-field provenance:** every extracted field carries its source span and confidence so a
  clinician can verify what the model claims.

### 4.4 Human-in-the-loop patterns

- **Review queues** prioritised and explained (low-confidence/high-risk/rare/OOD only).
- **Attestation:** medium-risk output requires quick acknowledgement; high-risk requires explicit
  sign-off; **the tier is set by policy, not model whim**.
- **Correction loops:** every accept/reject/edit is structured feedback tied to model + prompt +
  context + reviewer role - the labeling pipeline for the next model.
- **Escalation** for atypical presentations, high-risk patients, weak evidence, and any hard-rule
  violation.
- **Keep the kiosk advisory, not autonomous:** `decision_support_level=autonomous` generally makes the
  software a regulated medical device. Mandatory clinician oversight is the design target.

### 4.5 Caching, dedup, prompt caching, streaming vs batch, async queues

- **Semantic/deterministic caching:** identical/near-identical inputs served from a Redis/SQLite cache
  before hitting the model (<10 ms).
- **Prompt/prefix caching:** cache the computed prefix KV when the system prompt + few-shot prefix is
  stable. **A silent cache invalidator (timestamp/UUID in the prefix) is a common bug** - if cache-read
  tokens are zero across repeated requests, look for it. On CPU, prefix caching matters enormously
  because prefill is the expensive phase.
- **Embedding caches:** memoise embeddings of templates, drug names, and the retrieval corpus.
- **Dedup:** hash incoming documents/records and skip reprocessing.
- **Streaming vs batch:** stream TTFT-sensitive interactive output; batch latency-tolerant work.
- **Async job queues for slow models:** never block the patient-facing flow on a slow generative call;
  enqueue the summary, return structured capture immediately, enrich asynchronously with a visible
  "pending" state.
- **Priority scheduling:** clinical records > AI enrichment > telemetry sync; under overload prefer
  LIFO for interactive work and priority shedding for unimportant traffic.

---

## 5. Resource-constrained systems engineering

### 5.1 Memory budgeting and OOM/watchdog handling

- **Budget explicitly, per process:** weights + KV/activations + allocator overhead + runtime. On a
  4 GB kiosk a resident 3B Q4 model (~2 GB) leaves almost nothing - **the kiosk should not host a
  large generative model.**
- Set **hard memory limits per container/process**; treat OOM as an isolated, controlled failure.
- **Watchdog + supervisor:** restart with backoff; liveness must check *inference liveness*, not just
  process existence.
- **Degrade before dying:** disable optional models first; keep capture/validation alive.
- **Avoid unbounded queues** - the most common edge OOM cause. A queue is not a buffer if arrivals
  exceed service rate; it converts an immediate 503 into a late timeout.

### 5.2 Process isolation and resource limits

Use cgroups (systemd/containers) for CPU/memory caps. On the kiosk: capture UI, ASR, deterministic
extractor, and sync relay are separate processes so one failure cannot poison the others. On the edge
server: model daemon, RAG service, and API gateway are separate; the model daemon is the only
memory-heavy component and gets the largest budget with the most headroom.

### 5.3 Power / thermal / UPS / sustained throughput

- **Profile power before deployment** (one crop-monitoring case drained batteries 3x estimates);
  design power budgets with ~40% overhead.
- **Thermal throttling is real** (Jetson AGX Xavier: claimed 60 fps -> **22 fps after 15 minutes**). A
  kiosk in a hot OPD will throttle - size for sustained, not peak.
- **UPS on every kiosk:** 2-5 minutes ride-through prevents session corruption; persist state
  continuously so a hard cut is recoverable.
- **Benchmark a full hospital day (8-12 h)** at target cadence, not a 60-second burst.

### 5.4 Capacity planning for 4,000-10,000 patients/day

**Little's Law is the anchor** (`L = lambda * W`). Worked example:
- 10,000/day over a 10-hour window -> `lambda ~ 0.28 patients/s` (~16.7/min).
- At `W = 120 s` per session -> `L ~ 33` concurrent sessions at peak (peak typically 2-3x average).
- Each kiosk is single-user, so **kiosks ~ concurrent sessions**: ~33 at peak for 10,000/day at 2 min.
  At 4,000/day with 4-min sessions: `0.11 * 240 ~ 27`. **The kiosk count, not server CPU, is usually
  the binding constraint.**
- **Utilization:** queue time scales as `1/(1-rho)` - 2x at 50%, 5x at 80%, 10x at 90%. **Plan to sit
  at 60-70% at peak.**
- **The bottleneck moves as you scale** - identify it and re-check at each order of magnitude.

**Load shedding and backpressure:**
- **Bound every queue** at `target_latency x service_rate`, and reject beyond it.
- **Rank shedding signals by lead time:** queue wait time (best) > in-flight concurrency > queue depth
  > event-loop delay > CPU (mediocre) > p99 latency (lagging) > error rate (worst).
- **Adaptive concurrency limits:** any static limit is wrong after the next deploy; estimate capacity
  continuously and adjust with AIMD (Netflix concurrency-limits Vegas/Gradient2 approach).
- **Retry budgets:** retries <= ~10% of requests; first to drop under overload.
- **Recovery needs a ramp:** a recovering server with cold caches receiving full load saturates again;
  warm caches and admit traffic gradually.

### 5.5 Session lifecycle and resume

- Persist session state after every meaningful step (each field, each scan, the consent draft).
- On resume, reload and re-validate; never trust in-memory state.
- Bound session duration; time out abandoned sessions with a clear expiry policy (and
  DPDP-compatible deletion of the partial record).
- **Hand-off artifact:** the kiosk's job ends with a structured, signed, physician-ready summary
  queued for the HIS - a durable object, not a screen.

---

## 6. Methodology frameworks to pick and evaluate an architecture

### 6.1 Quality-attribute-driven design (ADD)

**SEI ADD** is recursive: choose the element to decompose -> identify candidate architectural drivers
-> choose a design concept (tactics/patterns) satisfying the drivers -> instantiate elements, define
interfaces, turn quality attributes into **constraints** for the next level. Inputs: functional
requirements, **quality attribute scenarios**, constraints.

Example quality attribute scenarios (stimulus/source/environment/artifact/response/measure):

| Scenario | Response measure |
|---|---|
| Hospital LAN is down during a patient session | Session completes fully offline; 0 fields lost; sync within 5 min of reconnect |
| 10,000 patients/day, peak 3x average | P95 kiosk session < 4 min; 0 session drops |
| Edge model daemon OOMs mid-day | Kiosk degrades to deterministic capture within 2 s; capture continues |
| Clinician disputes an AI-extracted field | Full provenance (model/prompt/source span) retrievable in < 1 s |
| New model version has a regression | Auto-rollback within one canary stage; < 0.1% of sessions affected |

### 6.2 Architecture decision records (ADRs)

Short, dated, immutable: **context -> decision -> consequences -> alternatives considered**. The value
is the **reversibility discipline**: recording *why* makes it safe to change when context shifts.
Every ADR needs a "revisit if" trigger. (This KB's `decisions/06-decisions-log.md` is the live ADR
log - keep using it.)

### 6.3 Documentation: C4 and arc42

**C4** documents Context/Container/Component/Code, mapping cleanly to kiosk/hospital/ABDM/system
boundaries. **arc42** gives the section structure for the full architecture description. Use **C4 for
the pictures, arc42 for the prose, ADRs for the decisions.**

### 6.4 Risk-driven design

Prioritise by **risk x uncertainty**, not completeness. High-risk/high-uncertainty items in this
project: (1) MDSW regulatory classification, (2) session throughput at 10,000/day, (3) CPU
latency/quality of any generative summary, (4) ABDM integration complexity across hospital systems,
(5) PHI handling under DPDP. Attack these first with spikes and prototypes. The "big-bang integration"
experience report is a warning: a multi-partner edge/ML project merged only at the end delivered
**6 minutes of functionality against an expected 40**, from no early integration testing and operating
near technical limits. **Build the vertical slice first; integrate continuously.**

### 6.5 Running a model/engine bake-off - checklist

1. Freeze the task, golden set, accuracy floor, and hardware. No moving targets.
2. Define **exit criteria in numbers** before the bake-off (P95 end-to-end, field exact match, peak
   RSS, license).
3. Warm up (>=100 requests / 10,000 tokens; verify <10% probe variation).
4. Measure cold start separately and label it.
5. Sweep concurrency at 25/50/75/90% of estimated saturation; report the **knee**.
6. Report percentiles, never averages; report CIs for quality.
7. Pin sampling config (temperature, max tokens) and report it.
8. Report cache hit ratios and context-length buckets.
9. Run error analysis on failures, stratified by subgroup.
10. Gate regressions in CI on tail latency, output-token budget, and quality, with a tolerance band;
    re-baseline on model change.
11. Document the methodology so it is reproducible and defensible.
12. Decide with a **pre-committed rubric**, not on vibes after seeing results.

### 6.6 Lightweight ATAM for this project

1. Elicit business drivers and quality goals -> **utility tree**, prioritizing each scenario by
   (importance, risk), e.g. `(H,H)` for "complete a session fully offline".
2. Enumerate candidate architectures (pure kiosk; kiosk + edge server; kiosk + edge + cloud).
3. Analyse each attribute in isolation against each candidate (performance, availability, security,
   modifiability, cost, auditability).
4. Identify **sensitivity points** (what moves the metric) and **tradeoff points** (what moves two
   metrics oppositely).
5. Document risks, non-risks, and risk themes.
6. Convert into **measured exit criteria** and ADRs.

Worked tradeoff points: model size vs latency vs RAM (the classic); caching vs freshness; rules vs ML
in critical logic (auditability/safety vs flexibility/coverage); edge-server centralisation vs kiosk
autonomy (cost vs availability).

### 6.7 Writing measurable exit criteria

Weak: "The system should be fast and accurate and work offline."

Strong: "*On the target 4 GB kiosk with the LAN disconnected, 100% of started sessions reach a signed
summary; P95 capture-to-summary <= 4 min at 20 concurrent sessions; >=95% exact-match on the 40-field
golden set with 95% CI lower bound >=93%; <=1.5 GB peak RSS; zero PHI in logs; auto-rollback triggers
on P95 regression >20%.*"

Every criterion needs: **metric + threshold + population + measurement method + who owns it.**

### 6.8 Common anti-patterns in edge AI systems

| Anti-pattern | Symptom | Mitigation |
|---|---|---|
| Cloud-first thinking at the edge | Latency unusable; unoptimised models | Quantise, batch, remove unnecessary layers; optimise for inference speed |
| Wrong hardware sizing from theoretical maxima | Thermal throttling after minutes | Realistic 72-hour load test; size for sustained throughput |
| Offline as an afterthought | System dies when connectivity weakens | Assume zero connectivity and build up; opportunistic sync |
| No monitoring | Accuracy collapses quietly | Input-drift + output-confidence + ground-truth benchmarking from day one |
| Workflow friction | 98% accuracy fails because it adds 30 s | Prioritise integration; test with real users |
| Power as an afterthought | Batteries drain 3x estimates | Profile power; budget 40% overhead |
| Global State Fallacy | Network partition halts operations | Hierarchical state: local strong, zone eventual, global versioned |
| Unbounded Data Cascade | Raw data floods upstream links | Filter/aggregate at the edge |
| Centralized Chokepoint | Single gateway, no redundancy | Distributed communication paths + automatic failover |
| Big-bang integration | End-merge delivers a fraction of functionality | Mock-based early integration; vertical slice; continuous integration |
| Unbounded queues | Errors convert to timeouts | Bound at `target_latency x service_rate`; shed above |
| Retry storms | One blip becomes a self-sustaining outage | Jittered backoff, attempt caps, retry budgets, breakers |
| Firmware+model+config as one version | Cannot roll back the model alone | Three independent version planes |
| Treating a CRDT library as a sync engine | No auth/backup/observability at month 3 | Build/buy a sync-engine layer; ship sync telemetry first |
| Uncalibrated confidence gates | Thresholds fail next month's distribution | Calibrate first, threshold second |
| Single scalar confidence handed to clinicians | "87% confidence" means nothing | Banded, calibrated, decomposed confidence |

---

## 7. Application to MediKiosk (this project)

1. **Topology:** 4 GB kiosk = deterministic capture + thin client; all models run on the on-prem edge
   server via a shared model daemon; no cloud on the critical path. Aligns with `doc/19` Sec 3.
2. **Offline-first:** transactional outbox + idempotent consumer on kiosk and edge server; local
   replica authoritative; an explicit degradation ladder decided in advance. Module B's B-C design in
   `doc/20` already implements this shape for ABDM sync.
3. **Pipelines:** deterministic-first - rules own SOCRATES ordering, red flags, consent, units;
   retrieval (sqlite-vec + FTS5 hybrid) supplies citable context; generation only composes prose over
   structured facts and is **structurally unreachable** when a hard rule fires (`doc/18`, `doc/15`).
4. **MLOps:** three independent version planes; signed delta OTA with health-triggered auto-rollback;
   a registry tracing the exact quantized binary; calibrated confidence bands; shadow -> canary -> A/B
   with quality gates, not just uptime.
5. **Capacity:** Little's Law sizes kiosk count (~30 kiosks at peak for 10K/day at 2-min sessions);
   run at 60-70% utilization; bound every queue; shed telemetry-first, clinical-records-last.
6. **Methodology:** ADD for decomposition, ATAM for tradeoff points (model size vs latency vs RAM is
   *the* tradeoff point), ADRs for decisions, C4 + arc42 for documentation, measurable exit criteria,
   and a controlled bake-off with warm-ups, concurrency sweeps, percentiles, and CI regression gates.
   This is the generalized form of `doc/20` Sec B-A/B-B.
7. **Governance:** resolve the **MDSW intended-use question first** (see `doc/16` Sec 4 and `doc/07`);
   it determines whether the kiosk is a regulated medical device under CDSCO. Align to NIST AI RMF +
   ISO 42001 structures, ABDM HIP milestones, and DPDP consent/retention/72-hour breach rules
   regardless.

---

## 8. Source register (condensed)

**Papers/preprints:** Network Edge Inference for LLMs (arXiv 2604.22906); SWEET (Frontiers 2026);
Local-First Software (Kleppmann 2019); unified routing/cascading (PMLR 2025); UCCI (arXiv 2605.18796);
RouteNLP (arXiv 2604.23577); RLCascadeRouter (arXiv 2608.15817); LLM benchmarking methodology (arXiv
2508.10251); Systemic Measurement Bias (arXiv 2605.24217); Edge AI Doctrine (Zenodo 2026); Architectural
Anti-Patterns in Industrial Cloud-Edge Systems (TechRxiv 2025-04-11); Lessons from a Big-Bang
Integration (Springer 2025); TeMLM (arXiv 2601.19191); Hybrid-Code (arXiv 2512.23743); KRD (JIMH
2026); KAGR (NeSy 2025); hybrid CDSS (AIH 2025); FL/TinyML surveys (2025); SEI ADD and ATAM.

**Standards/government:** NIST AI RMF <-> ISO/IEC 42001 crosswalk; CDSCO MDSW guidance (final circular
2026-07-21); DPDP Rules 2025 (MeitY, 2025-11-14) and DPDP Act 2023; ABDM HMIS/LMIS guidance and
Offline ABHA guidance; IETF LLM benchmarking draft; EU AI Act high-risk checklist (2026-06-29); CHAI
Applied Model Card.

**Vendor/engineer docs:** AWS offline-first generative AI at the edge (2026-07-22); AWS MLOps planning
and load-shedding PDFs; NVIDIA LLM benchmarking concepts; llm-d Fast Model Actuation; ModelMesh/KServe;
sqlite-vec; SQLite AI RAG-on-SQLite (2025-10-23); Oxide (OTA/delta/rollback); Foundries.io; ZedIoT;
Yantrix 600-device case study; InTechHouse; MLflow canary deployment; SUSE K3s/Fleet; Mender.

**Blogs:** Zylos (local-first agents; transactional outbox); Tian Pan (hybrid cloud-edge LLM); CodeNotes
and sade.dev (outbox); HLD Handbook (CRDT); wal.sh / Verity / Curious Magazine (local-first); QASkills
(LLM cost/latency testing); CalibreOS (ML evaluation/monitoring); Quantslant (edge AI deployment
mistakes); System Design Handbook + Learn Backend + notes.elimelt (capacity/backpressure/admission);
reacts.dev and Humble AI (clinical CDSS guardrails, humble AI); ComplyZero/KPMG (DPDP healthcare);
Nirmitee/Ichelon (ABDM milestones); NatLawReview/Cyril Amarchand (CDSCO).

*Compiled September 2026. Regulatory dates reflect the 2026 status and change frequently - re-verify
before citing in a submission or a build gate.*
