# System Design - Theory, Patterns & Methodologies

> **Status: REFERENCE (unratified).** A general-purpose system-design knowledge base distilled
> 2026-09-16. It exists so future sessions can reason from established theory instead of re-deriving
> it, and so project choices (`doc/19-production-blueprint.md`, `decisions/06-decisions-log.md`) can
> cite a common vocabulary.
>
> **Scope:** distributed-systems first principles, scalability/data architecture, component and
> communication patterns, architecture styles, cross-cutting concerns, and design/evaluation
> methodologies. A companion doc applies the edge/ML-specific slice (`doc/32`), and
> `doc/30` covers CPU-AI optimization.
>
> **Evidence tiering:** this is synthesized from canonical books/papers, official docs, and reputable
> engineering blogs (sources in Sec 8). It is not medical/regulatory advice. Where a claim is a rule
> of thumb (e.g., "run at 50-70% utilization"), treat the direction as reliable and the exact number
> as needing local measurement.

---

## 1. First principles & theory

### 1.1 Fallacies of distributed computing

Articulated by L. Peter Deutsch et al. (Sun, 1994; Gosling added the 8th). Every one is false, and
design errors trace back to assuming otherwise.

| # | Fallacy | Why it breaks |
|---|---------|---------------|
| 1 | The network is reliable | Packets drop, connections time out, DNS fails, AZs go down. Every call needs timeouts, retries, idempotency. |
| 2 | Latency is zero | A local call is nanoseconds; a network call is 10^5-10^6x slower. N+1 call patterns collapse. |
| 3 | Bandwidth is infinite | Chatty protocols saturate links; payload size dominates. |
| 4 | The network is secure | Internal traffic was historically plaintext; a perimeter breach yields lateral movement. |
| 5 | Topology doesn't change | Cloud instances are ephemeral; service discovery is mandatory. |
| 6 | There is one administrator | Systems span teams/orgs/clouds with different policies. |
| 7 | Transport cost is zero | Serialization, TLS handshakes, data-transfer fees are real line items. |
| 8 | The network is homogeneous | Traffic crosses Wi-Fi, cellular, firewalls, CDNs. |

Modern additions (Richards & Ford, *Fundamentals of Software Architecture*, 2020): **versioning is
simple**, **compensating updates always work**, **observability is optional** - all false.

### 1.2 CAP, PACELC, and the consistency spectrum

**CAP** (Brewer PODC 2000; proven Gilbert & Lynch 2002): under an asynchronous network that can
partition, a store cannot simultaneously guarantee **C** (linearizability), **A** (every non-failing
node returns non-error), **P** (keeps working despite dropped/delayed messages).

**Misconceptions to kill:**
1. **"Pick 2 of 3" is misleading.** P is not optional in a real distributed system; the real choice
   *under partition* is C vs A. With no partition you can have both - CAP says nothing about normal
   operation.
2. **CAP's "C" is linearizability**, not the "C" in ACID.
3. **CAP is not the main reason systems weaken consistency** - Abadi: the consistency/latency
   trade-off during normal operation dominates.

**PACELC** (Abadi, 2010/2012): if **P**artition -> trade **A** vs **C**; **E**lse -> trade **L**atency
vs **C**onsistency.

| Class | Behavior | Examples |
|-------|----------|----------|
| PA/EL | Available under partition; low latency, weaker consistency normally | Dynamo, Cassandra, Riak (defaults) |
| PC/EC | Conserves consistency always | Spanner, VoltDB, HBase, CockroachDB |
| PA/EC | Available under partition; consistent normally | MongoDB (historical) |
| PC/EL | Consistent under partition; latency-optimized normally | PNUTS |

PACELC classifies *defaults*; modern systems are tunable per operation (Cassandra CL, DynamoDB
`ConsistentRead`, Cosmos DB levels).

**Consistency models, strong -> weak:**

| Model | Guarantee | Typical use |
|-------|-----------|-------------|
| Strict | Every read sees latest write vs a perfect global clock | Theoretical only |
| Linearizable ("strong") | Real-time global total order | Ledgers, locks, leader election, Spanner/etcd |
| Sequential | Some total order consistent with per-process order | Replicated state machines |
| Causal | Causal ops ordered; concurrent may reorder | Feeds, messaging, collaborative editing |
| Session | Read-your-writes, monotonic reads (per client) | User sessions/carts |
| Eventual | Replicas converge if writes stop; no time bound | DNS, CDNs, metrics, caches |

Precision: "strict" != "strong"; vendor "strong consistency" usually means *linearizable*. Quorums
(`R + W > N`) give read freshness but **not** linearizability or total ordering. "Eventual" has no
upper time bound.

### 1.3 ACID vs BASE, transactions, isolation, MVCC

**ACID** (Harder & Reuter 1983): Atomicity, Consistency (invariants), Isolation, Durability. **BASE**
(Pritchett 2008): Basically Available, Soft state, Eventual consistency.

**Isolation levels and the anomalies they permit:**

| Level | Dirty read | Non-repeatable read | Phantom | Write skew |
|-------|-----------|--------------------|---------|-----------|
| Read Uncommitted | Yes | Yes | Yes | Yes |
| Read Committed | No | Yes | Yes | Yes |
| Repeatable Read | No | No | Yes* | Yes |
| Snapshot Isolation | No | No | No | **Yes** |
| Serializable | No | No | No | No |

*Postgres implements Repeatable Read as snapshot isolation (also prevents phantoms) but still permits
write skew - a real correctness trap (e.g., two doctors both going off-call). SSI (Postgres 9.1+)
adds conflict detection.

**MVCC:** readers see a consistent snapshot without blocking writers; versions retained (Postgres) or
reconstructed from undo logs (Oracle/InnoDB). Trades space and vacuum/bloat for read scalability.

**Why distributed transactions are hard:** 2PC/XA's coordinator can crash after votes but before the
decision, leaving participants *in-doubt* and holding locks indefinitely (Gray & Lamport's Paxos
Commit replicates the coordinator via consensus to remove this blocking failure). WAN 2PC routinely
exceeds 200 ms/txn and one slow participant stalls all. Modern remakes: Spanner/CockroachDB/TiDB
layer 2PC over consensus; application-level sagas + outbox.

### 1.4 Availability math, SLA/SLO/SLI, error budgets

Availability = `MTBF / (MTBF + MTTR)`.

| Availability | Per year | Per month |
|--------------|----------|-----------|
| 99% (two nines) | 3.65 days | 7.2 h |
| 99.9% (three nines) | 8.77 h | 43.2 min |
| 99.95% | 4.38 h | 21.6 min |
| 99.99% (four nines) | 52.6 min | 4.32 min |
| 99.999% (five nines) | 5.26 min | 26 s |

Serial availability of independent components *multiplies* (0.999 x 0.999 ~ 0.998); beating that
requires **redundancy** with failover (`1-(1-p)^2`).

- **SLI** - measured indicator (e.g., % requests < 300 ms).
- **SLO** - internal target (e.g., 99.9% over 30 days).
- **SLA** - contractual external promise with consequences.
- **Error budget** = `1 - SLO`. Burn rate = observed error rate / allowed error rate. Google's
  multi-window multi-burn-rate alerting pages at high burn over short+long windows.

### 1.5 Back-of-the-envelope estimation & performance laws

**Latency numbers (orders of magnitude, ~2020s hardware):**

| Operation | Approx. latency |
|-----------|-----------------|
| L1 cache reference | ~1 ns |
| Branch mispredict | ~3 ns |
| L2 cache reference | ~4 ns |
| Mutex lock/unlock | ~15-20 ns |
| Main memory reference | ~80-100 ns |
| Compress 1 KB (Snappy) | ~2-3 us |
| 1 KB over 1 Gbps | ~10 us |
| Read 1 MB from RAM | ~10-100 us |
| Random 4 KB SSD read | ~50-150 us |
| Read 1 MB from SSD | ~200 us-1 ms |
| Disk seek | ~2-10 ms |
| Read 1 MB from disk | ~1-10 ms |
| Datacenter round trip | ~0.5 ms |
| CA <-> Netherlands RTT | ~150 ms |

Rules of thumb: memory ~100x faster than SSD; SSD ~100x faster than disk; a datacenter RTT is
~1,000x a memory reference; cross-continent RTT ~300x a datacenter RTT.

**Throughput vs latency** are not inversely linear: batching raises throughput and *raises*
per-request latency; pipelining lowers latency at fixed throughput. Optimize the one your SLO names.

- **Little's Law:** `L = lambda * W` (concurrency = arrival rate x mean latency). Sizes pools. E.g.,
  10,000 req/s at 50 ms -> ~500 in flight.
- **Amdahl's Law:** max speedup `1 / (s + (1-s)/N)`; the serial fraction caps gains.
- **Gustafson's Law:** weak scaling `s + N(1-s)`.
- **Universal Scalability Law** (Gunther 1993/2008): `C(N) = N / (1 + alpha(N-1) + beta*N(N-1))`,
  where **alpha** = contention and **beta** = coherency/crosstalk (~N^2). Subsumes Amdahl (beta=0) and
  predicts **retrograde scalability** (throughput falls past a peak). Fit coefficients from measured
  throughput.

### 1.6 Queueing theory basics

For **M/M/1** with utilization `rho = lambda/mu < 1`: mean queue length `L = rho/(1-rho)`; mean
response `R = S/(1-rho)` where `S = 1/mu`.

- Latency grows **hyperbolically** as `rho -> 1` ("the hockey stick"). At 80% utilization response
  time is 5x the *service* time; at 90%, 10x; at 95%, 20x.
- **Kingman's formula** (G/G/1): wait time rises with variability. Reducing variance is as valuable
  as reducing mean load.
- **Kleinrock's conservation law:** cannot reduce the weighted sum of waiting times across classes;
  optimizing one class penalizes others.
- **Practical consequence:** run production at 50-70% target utilization, not 95%. High utilization
  leaves no headroom for bursts/retries/slow deps ("utilization kills latency").

---

## 2. Scalability & data architecture

### 2.1 Vertical vs horizontal scaling; stateful vs stateless

| Axis | Vertical (up) | Horizontal (out) |
|------|---------------|------------------|
| Mechanism | Bigger CPU/RAM/disk | More nodes behind a balancer |
| Ceiling | Hardware limits, superlinear cost | Near-linear if stateless/sharded |
| Failure | Single point of failure | Tolerates node loss |
| Complexity | Low | High (coordination, data distribution) |

**Stateless services** hold no per-user session state -> trivial horizontal scaling and rolling
deploys. **Stateful services** need replication, sharding, ownership transfer. Push state to
purpose-built stores; use externalized sessions or signed tokens instead of in-memory sessions.
Sticky sessions are a smell that state leaked into compute.

### 2.2 Replication, failover, split-brain

- **Leader-follower:** one writer, many readers. Synchronous = no data loss on failover, higher write
  latency; asynchronous = lower latency but potential data loss (RPO > 0) and stale replicas.
- **Multi-leader:** multiple writers (multi-region, offline editors); needs conflict resolution (LWW,
  vector clocks, CRDTs).
- **Leaderless (Dynamo-style):** quorum `R + W > N`; read repair, hinted handoff, anti-entropy
  (Merkle trees).
- **Failover** needs leader election, promotion, client redirection, and **fencing** of the old
  leader. **Split-brain** (two partitions each believing they are primary) is mitigated by
  quorum-based election (Raft), leases with fencing tokens, and STONITH.
- **Quorum math:** N=3, W=2, R=2 tolerates one failure with overlap - but quorums do **not** give
  linearizability.

### 2.3 Partitioning / sharding

| Strategy | Description | Pros / cons |
|----------|-------------|-------------|
| Range | Partition by key ranges | Efficient range scans; hot ranges |
| Hash | `hash(key) mod N` | Even spread; resharding moves most keys |
| Consistent hashing | Keys and nodes on a ring; virtual nodes | Adding/removing a node moves ~K/N keys |
| Directory / lookup | Explicit mapping table | Flexible; extra lookup + SPOF |
| Geo / tenant | Partition by region/tenant | Residency + isolation; uneven tenants |

**Hotspots** come from skewed keys, celebrity users, monotonic IDs. Mitigate with key salting/write
sharding, pre-splitting, adaptive/load-based splitting, coalescing, hot-key caches. **Secondary
indexes** are hard with sharding: local (scatter-gather) vs global (distributed maintenance / separate
search system). **Rebalancing** must be online, throttled, observable.

### 2.4 Caching strategies

| Pattern | Read path | Write path | Consistency | Failure mode |
|---------|-----------|-----------|-------------|--------------|
| Cache-aside (lazy) | App checks cache; on miss loads DB and populates | Write DB, **delete** cache key | Brief staleness | Cache down -> fallback to DB |
| Read-through | Cache library loads DB on miss | Write DB | As aside | Cache layer must be up |
| Write-through | Cache updated synchronously with DB | Both sync | Strong (read-your-writes) | Slower writes; cache failure stalls writes |
| Write-behind | Write cache; async flush | Batched async | Weak (flush window = loss window) | Crash loses unflushed writes |
| Refresh-ahead | Proactively reload before expiry | - | Bounded staleness | Extra load if predictions wrong |

**Eviction:** LRU (scan-vulnerable), LFU (stale-popularity), 2Q/ARC (scan-resistant), **W-TinyLFU**
(Caffeine default; count-min-sketch admission + LRU window), plus TTL.

**Invalidation is a distributed-consistency problem.** Default: write DB, then **DEL** (never SET -
SET-on-write races can persist stale values). Stronger: double-delete, versioned keys
(`user:123:v42`), CDC-driven invalidation (Debezium WAL -> Kafka -> invalidator), surrogate/tag
purges at CDNs. Short TTLs as a safety net.

**Stampede/thundering herd** (hot key expires, N simultaneous misses): TTL jitter (+/-10%),
single-flight/request coalescing, distributed lock + recompute, stale-while-revalidate,
probabilistic early expiry. Facebook's **leases** (NSDI 2013) let only the leaseholder SET.

**Negative caching/penetration:** cache "not found" with short TTL; Bloom filter to short-circuit
absent keys.

### 2.5 Data storage selection & polyglot persistence

| Family | Model | Examples | Sweet spot |
|--------|-------|----------|-----------|
| Relational (RDBMS) | Tables, joins, ACID | PostgreSQL, MySQL, SQL Server, Oracle | Transactions, ad-hoc queries, integrity |
| Key-value | Opaque value by key | Redis, DynamoDB, Riak | Sessions, caches, high-throughput lookups |
| Document | JSON documents | MongoDB, Couchbase, Firestore | Evolving schemas, aggregate reads |
| Wide-column | Sparse column families by row key | Cassandra, HBase, Bigtable | Huge write volume, high availability |
| Graph | Nodes + edges | Neo4j, JanusGraph, Neptune | Relationship traversals |
| Search | Inverted index | Elasticsearch/OpenSearch, Solr | Full-text, faceting, log analytics |
| Time-series | Timestamped metrics | InfluxDB, TimescaleDB, Prometheus | Metrics/IoT, retention, downsampling |
| Vector | Embeddings + ANN index | pgvector, Pinecone, Weaviate, Milvus, Qdrant, LanceDB, sqlite-vec | Semantic search, RAG |
| Object | Immutable blobs | S3, GCS, Azure Blob | Backups, media, data lakes |

**Vector DBs** differ by **ANN index**: HNSW (graph, high recall/low latency, memory-heavy),
IVF/IVF-PQ (clustering + product quantization, memory-efficient), DiskANN (disk-based), plus
scalar/binary quantization. Trade recall vs latency vs memory; filter-aware and hybrid (BM25 +
vector) retrieval matter.

**Polyglot persistence** = right store per access pattern, at the cost of operational surface,
cross-store consistency, duplicated data. Prefer fewer systems until a pattern demands an engine.

### 2.6 Data modeling: normalization, denormalization, CQRS

- **Normalization** (1NF-3NF/BCNF) eliminates redundancy/update anomalies; write-optimized; needs
  joins.
- **Denormalization** precomputes/duplicates for read speed; update-anomaly risk.
- **Materialized views** are stored query results refreshed on schedule/commit/incrementally.
- **CQRS** separates the write model (normalized, invariant-enforcing) from one or more **read
  models** optimized per query. Read models are projections and eventually consistent. Pairs with
  event sourcing. Cost: dual models, projection lag, rebuild tooling.

### 2.7 Batch vs stream; Lambda vs Kappa; delivery semantics

- **Batch:** bounded input, high throughput, high latency (MapReduce, Spark, warehouse ELT).
- **Stream:** unbounded, low latency (Flink, Kafka Streams); needs event-time vs processing-time,
  watermarks, windows, late-data policy.
- **Lambda architecture** (Marz): batch layer + speed layer + serving layer. Accurate but two
  codebases.
- **Kappa architecture** (Kreps 2014): single streaming path; reprocess by replaying the immutable
  log. Simpler; requires a replayable, long-retention log and incrementally expressible logic.
  **Default for most new systems**; Lambda remains for logic that can't be incremental (global sorts,
  full-history training).

**Delivery semantics (end-to-end):**

| Guarantee | Behavior on failure | Notes |
|-----------|---------------------|-------|
| At-most-once | May lose messages | Fire-and-forget |
| At-least-once | May duplicate | Default in practice; pair with idempotent consumers |
| Exactly-once | Neither loss nor duplicates | Costly; requires replayable source + checkpointing + transactional/idempotent sink |

Kafka EOS = idempotent producers (PID + sequence numbers) + transactions (fencing by producer epoch;
`read_committed`). Flink = distributed snapshots (Chandy-Lamport) + 2PC sinks. **Practical guidance:
use at-least-once + idempotent writes** unless the op is genuinely non-idempotent (counters, payments,
notifications).

---

## 3. Component & communication patterns

### 3.1 Load balancing

- **L4 (transport):** routes by IP/port/TCP; fast; cannot inspect HTTP path/headers.
- **L7 (application):** parses HTTP/gRPC; path/host/header routing, TLS termination, retries, sticky
  sessions.
- **Algorithms:** round robin, weighted RR, least connections, least response time, consistent hash
  (affinity), and **Power of Two Choices (P2C)** - pick two random backends, route to the less
  loaded; dramatically better than random/RR under heterogeneity with O(1) state.
- **Health checks:** active probes + passive ejection; readiness vs liveness; slow-start/outlier
  ejection (Envoy). DNS balancing is coarse due to TTL caching.

### 3.2 API styles

| Style | Transport | Strengths | Weaknesses |
|-------|-----------|-----------|------------|
| REST | HTTP/JSON | Ubiquitous, cacheable, stateless | Over/under-fetching; chatty |
| gRPC | HTTP/2 + Protobuf | Typed contracts, streaming, low latency | Browser via proxy; binary debugging |
| GraphQL | HTTP | Client-specified shape, one round trip | Query complexity/DoS, N+1 resolvers, caching |
| Webhooks | Server->server HTTP | Decoupled push | Delivery guarantees, retries, signatures |
| WebSockets | Bidirectional TCP | Full-duplex real-time | Stateful connections, scaling |
| SSE | HTTP server->client | Simple one-way streaming, auto-reconnect | Unidirectional |

- **Idempotency keys:** client sends a unique key; server dedupes and returns the stored result,
  making retries of non-idempotent ops safe (unique constraint + stored response, scoped, TTL).
- **Pagination:** offset (unstable under writes), **keyset/cursor** (stable, efficient), page tokens.
- **Versioning:** URI, header/media-type, or additive "never break" evolution; consumer-driven
  contract testing (Pact) + Tolerant Reader.

### 3.3 Asynchronous messaging

| Model | Semantics | Examples |
|-------|-----------|----------|
| Queue | Point-to-point; one consumer per message | SQS, RabbitMQ queue |
| Pub/Sub | Fan-out to all subscribers | SNS, Google Pub/Sub |
| Log | Append-only, ordered, replayable, consumer groups | Kafka, Pulsar, Kinesis |

- **Ordering** only within a partition/queue and often only per producer key -> partition by entity
  ID, don't assume global order.
- **Dead-letter queues (DLQ):** route after N failures; **alert on DLQ growth**.
- **Backpressure:** bounded queues + blocking/buffering; consumer-driven pull; credit-based flow
  control; load shedding. Unbounded queues hide overload and turn it into an OOM/timeout cliff.
- **Rate limiting:** token bucket (bursts), leaky bucket (smoothing), fixed window (boundary bursts),
  sliding window log/counter (accurate, more memory). Return `429` + `Retry-After`; combine with
  quotas and priority classes.

### 3.4 Resilience patterns

| Pattern | Purpose | Notes |
|---------|---------|-------|
| Timeout | Bound worst-case wait | Every remote call; propagate deadlines |
| Retry + exponential backoff + jitter | Recover transient faults | `delay = min(cap, base*2^n)` + jitter; retry budgets; retry idempotent ops only |
| Circuit breaker | Stop hammering a failing dependency | Closed -> open -> half-open; per dependency |
| Bulkhead | Isolate failures | Separate pools per dependency |
| Graceful degradation / fallback | Keep partial service | Cached/static responses, reduced feature set |
| Hedging | Attack tail latency | Duplicate after p95, cancel losers; amplifies load |
| Idempotent consumers | Safe at-least-once | Dedup keys stored transactionally with side effects |
| Chaos engineering | Validate resilience | Fault injection, game days |

**Retry amplification is a top outage cause:** synchronous retries across N layers multiply load by
`r^depth`. Use jittered backoff, a **retry budget** (retries <= ~10% of requests), circuit breakers,
and server-side overload protection (adaptive concurrency limits, load shedding).

### 3.5 Coordination, consensus, avoiding distributed transactions

- **Distributed locks:** unsafe without **fencing tokens** - a monotonic token the resource server
  checks so a stalled client's late write is rejected (Kleppmann). Prefer consensus-backed leases
  (etcd/ZooKeeper/Spanner) over naive Redlock.
- **Leader election & leases:** time-bounded ownership + fencing.
- **Consensus:** Paxos (Lamport) and Raft (Ongaro & Ousterhout) give linearizable replicated logs.
  Raft = leader election + log replication + safety, randomized election timeouts, joint-consensus
  membership. Five nodes tolerate two failures. FLP impossibility -> timeouts/randomness for liveness.
- **Alternatives to distributed transactions:**
  - **Saga** - sequence of local transactions with compensations (Garcia-Molina & Salem 1987).
  - **Transactional outbox/inbox** - write DB row + outbox row in one local transaction; a relay
    (often CDC/Debezium) publishes; consumers dedupe via an inbox table. Solves the dual-write
    problem without XA.
  - **Event sourcing** - state as an append-only log; derive state by replay; audit by construction.
  - **Consensus-backed 2PC** - Spanner/CockroachDB make 2PC non-blocking by replicating coordinator.

### 3.6 Workflow orchestration vs choreography; the saga pattern

| Concern | Choreography | Orchestration |
|---------|--------------|---------------|
| Control | Each service reacts to events; saga emerges | Central orchestrator drives commands/state |
| Coupling | Loose; no central owner | Services know the orchestrator |
| Visibility | Scattered; hard beyond ~3 steps | Central state machine; easy to query |
| Compensation | Distributed per service | Centralized reverse-order |
| Cycles | Risk of event cycles | Avoided |
| Best for | Short, stable, loosely coupled flows | Complex workflows with ordering/visibility |

**Saga mechanics:** happy path `T1..Tn`; a **compensating transaction Ci** for each compensatable
step; the **pivot transaction** is the point of no return. **Sagas lack isolation** - intermediate
states are visible, so every saga bug is an isolation bug. Countermeasures: semantic locks,
commutative updates, pessimistic views, version checks. Orchestrator state must be durable;
commands/compensations must be idempotent. Implementations: Temporal, AWS Step Functions, Netflix
Conductor, Camunda/Zeebe.

---

## 4. Architecture patterns & styles

### 4.1 Layered, hexagonal, clean/onion

- **Layered:** presentation -> application -> domain -> infrastructure; simple but can degrade into a
  "big ball of mud".
- **Hexagonal / Ports & Adapters** (Cockburn): the core defines **ports** (interfaces); **adapters**
  implement them for HTTP/DB/messaging. Enables testing the core without infrastructure.
- **Clean / Onion** (Martin): **Dependency Rule** - source dependencies point inward; inner layers
  know nothing of outer layers. Equivalent to the Dependency Inversion Principle.

### 4.2 Modular monolith vs microservices vs SOA

| Approach | Pros | Cons | Best when |
|----------|------|------|-----------|
| Monolith | Simple, fast to build/debug, no network tax, ACID | Deploy queue; all-or-nothing scaling | Early stage, <~30 engineers |
| Modular monolith | Enforced internal boundaries, one deploy, extractable later | Needs enforcement tooling (ArchUnit, Packwerk, import-linter) | ~30-150 engineers, single product |
| Microservices | Independent deploy/scale, team autonomy, polyglot, fault isolation | Full distributed tax, 30-50% capacity overhead | 150+ engineers, platform team, clear bounded contexts |
| SOA | Enterprise reuse via ESB | Heavy governance, ESB bottleneck | Legacy enterprise integration |

**Distributed monolith anti-pattern:** services split on paper that must deploy together, share a DB,
or form deep synchronous chains. You pay the distributed tax and keep monolith coupling. **Detection:**
"how many services deploy together in a typical release?" If most, consolidate. Recommended path:
**modular monolith first**, prove boundaries, extract modules only for a named reason (divergent
scaling, regulatory isolation, team autonomy). Conway's Law means architecture mirrors org chart.

### 4.3 Event-driven, CQRS, event sourcing, and other styles

- **Event-driven architecture (EDA):** components communicate via events; decoupling/extensibility at
  the cost of eventual consistency, opaque flow, hard debugging.
- **CQRS / Event sourcing:** see Sec 2.6. Event sourcing stores events, replays to views, gives a
  natural audit log; needs event versioning and snapshotting.
- **Strangler Fig** (Fowler): incrementally replace a legacy system by routing slices of traffic to
  new implementations.
- **BFF (Backend-for-Frontend):** a dedicated aggregation edge API per client type.
- **Sidecar:** cross-cutting concerns (proxy, logging, mTLS) alongside each instance; basis of service
  meshes.
- **Service mesh:** data plane (Envoy sidecars) + control plane (Istio, Linkerd) for mTLS, traffic
  shifting, retries, observability - at complexity/latency cost.
- **API gateway:** single entry point for routing, authN/Z, rate limiting, aggregation.
- **Cell-based architecture** (AWS): partition the whole stack into independent cells with a
  cell-router, containing blast radius.
- **Edge computing patterns:** push compute/caching near users; trade consistency and ops complexity.

### 4.4 Multi-tenancy and offline-first

**Multi-tenancy models:** **silo** (dedicated resources per tenant; strongest isolation, highest
cost), **pool** (shared + tenant ID + row-level security; cheapest, noisy neighbors), **bridge/hybrid**
(shared infra, per-tenant schema/DB). Enforce tenant scoping in code and DB; test for cross-tenant
leakage.

**Offline-first / sync** (clients write locally first, sync when connectivity returns):
- **CRDTs:** state that merges deterministically -> strong eventual consistency. Types: LWW-Register,
  G-/PN-Counter, OR-Set (add-wins), MV-Register. Commutative, associative, idempotent merge. Used by
  Automerge, Yjs. Costs: metadata/tombstone growth; schema migration; compaction.
- **Operational transformation (OT):** server-arbitrated; poor offline.
- **Conflict resolution:** LWW (silent loss risk; never trust wall-clock), vector clocks, semantic
  merge, application-level resolution.
- **Local-first software** (Kleppmann et al. 2019): user-owned data, on-device, fast, offline-capable,
  sync as background replication. Related: store-and-forward/queue-sync, thin client + edge node.

### 4.5 12-Factor App & cloud-native

**12-Factor** (Wiggins/Heroku 2011): codebase; explicit dependencies; config in environment; backing
services as attached resources; strict build/release/run; stateless processes; port binding;
concurrency via processes; disposability; dev/prod parity; logs as event streams; admin processes as
one-off runs. Cloud-native (CNCF) adds containers, orchestration, declarative APIs, immutable infra,
observability; measure with **DORA metrics** (deploy frequency, lead time, change-failure rate, MTTR).

---

## 5. Cross-cutting concerns

### 5.1 Security

- **Defense in depth:** layered controls; assume each can fail.
- **Least privilege:** minimum rights, just-in-time elevation, scoped service accounts.
- **Zero Trust (NIST SP 800-207):** "never trust, always verify." All resources protected regardless
  of location; all communication encrypted/authenticated; per-session access; dynamic policy
  (identity, device health, behavior); continuous integrity monitoring. Components: Policy Engine,
  Policy Administrator, Policy Enforcement Point (+ Policy Information Points).
- **OWASP Top 10 (2021):** broken access control; cryptographic failures; injection; insecure design;
  security misconfiguration; vulnerable/outdated components; identification/auth failures; software/
  data integrity failures; logging/monitoring failures; SSRF. (A 2025 revision exists - verify current
  categories before an audit.) Also ASVS and API Security Top 10.
- **Secrets:** never in code/images; use Vault/KMS/External Secrets; short-lived credentials,
  workload identity, SPIFFE/SPIRE.
- **Encryption:** in transit (TLS 1.3, mTLS internally) and at rest (envelope encryption, KMS); key
  rotation on schedule and compromise; separate keys by purpose; AES-256-GCM / XChaCha20-Poly1305.

### 5.2 Observability

**Three pillars** (one correlated pipeline):

| Pillar | Strength | Weakness |
|--------|----------|----------|
| Metrics | Cheap, aggregatable, alertable | No request detail; cardinality limits |
| Logs | Full context, forensics | Expensive at volume; hard to aggregate |
| Traces | Cross-service causality/latency | Sampling; instrumentation effort |

Correlate via a shared **trace ID** and resource attributes (`service.name`, `deployment.environment`,
`service.version`). **Structured JSON logging** is a prerequisite.

**What to measure:**

| Method | Target | Metrics | Best for |
|--------|--------|---------|----------|
| USE (Gregg) | Resources | Utilization, Saturation, Errors | Infra bottleneck hunting |
| RED (Wilkie) | Services | Rate, Errors, Duration | Per-service dashboards/SLOs |
| Four Golden Signals (SRE) | User-facing | Latency, Traffic, Errors, Saturation | Alert definitions |

**Distributed tracing:** one span per operation with parent/child; sampling mandatory. Head-based
sampling is cheap but may miss rare bugs; **tail-based sampling** in the collector keeps all errors
and high-latency traces. **OpenTelemetry** is the de facto standard (API/SDK -> OTLP -> Collector ->
any backend; use the Collector for batching, memory limits, tail sampling, PII scrubbing).

**SLO-based alerting:** alert on **symptom** SLIs (user-visible) via multi-window multi-burn-rate,
not raw cause thresholds (CPU > 80%). Every page needs a runbook or it shouldn't exist.

### 5.3 Reliability engineering

- **Redundancy:** N+1/N+2, multi-AZ/region; eliminate SPOFs including human/process ones.
- **Failover:** automated, tested, safe (quorum + fencing to avoid split-brain); distinguish failover
  from failback.
- **Backups & restore testing:** 3-2-1 (3 copies, 2 media, 1 offsite), immutable/air-gapped for
  ransomware; **test restores**.
- **DR:** define **RTO** (max downtime) and **RPO** (max data loss); strategies backup/restore, pilot
  light, warm standby, active-active; drills validate runbooks.
- **Incident response:** roles (commander, comms, scribe), severity levels, comms cadence.
- **Blameless postmortems:** systemic causes, action items with owners, publish broadly.

### 5.4 Data privacy & compliance by design

- **Consent:** explicit, specific, withdrawable; record proof.
- **Purpose limitation; data minimization; retention & erasure** (across primary and derived systems -
  caches, search, backups, analytics); **audit trails** (tamper-evident); **residency**.
- **Privacy by design & by default** (GDPR Art. 25); DPIA for high-risk processing.
- Regulations: GDPR (EU), CCPA/CPRA (California), **DPDP Act 2023 + Rules 2025 (India)**, HIPAA (US
  health), PCI DSS (cards). Treat compliance as an architecture requirement (data classification,
  lineage, deletion pipelines), not a legal afterthought. (MediKiosk specifics: `doc/19`, `doc/20`,
  `doc/16`.)

### 5.5 Cost, performance, capacity, load shedding, multi-region

- **Cost/performance:** cost per request/GB/vCPU-hour; egress is often the surprise line item.
  Right-size, autoscale, tiered storage, caching. Track **unit economics**.
- **Capacity planning:** model demand, measure utilization, keep headroom (run 50-70% for latency),
  load-test, forecast with USL/queueing.
- **Load shedding & admission control:** reject/queue strategically - `503` + `Retry-After`,
  prioritized queues, adaptive concurrency limits, token buckets, degraded modes. Better to serve most
  requests well than all badly.
- **Multi-region:** active-passive (simpler, longer RTO) vs active-active (write conflicts, residency,
  consistency). Needs regional failover, global LB (anycast/GeoDNS), replication strategy.

---

## 6. Methodologies & frameworks for designing systems

### 6.1 Requirement- and quality-attribute-driven design

**Quality attributes** are measurable, testable non-functional properties. **ISO/IEC 25010** defines
a product quality model; the 2023 revision reorganized it (interaction capability replaces usability,
flexibility replaces portability, **safety** added).

**Quality attribute scenarios** (SEI) make requirements analyzable: *stimulus source, stimulus,
environment, artifact, response, response measure*. **Utility trees** decompose utility into quality
attributes -> refinements -> prioritized scenarios `(importance, difficulty)`.

| Method | Purpose | Key mechanics |
|--------|---------|---------------|
| SAAM (1993) | Early architecture analysis | Scenario-based; first SEI method |
| **ATAM** (Kazman et al. 1998/2000) | Tradeoff/risk identification | Business goals -> quality attributes -> utility tree; identify **sensitivity points** and **tradeoff points**; produces risks, non-risks, risk themes |
| CBAM (2003) | Economic cost/benefit extension of ATAM | Utility-response curves to pick cost-effective options |
| **ADD** (v2.0 2006; v3.0) | Attribute-Driven Design | Recursive: confirm requirements -> choose element -> identify drivers -> choose tactics/patterns satisfying QA scenarios -> instantiate, define interfaces, verify -> recurse |
| QAW | Quality Attribute Workshop | Elicits prioritized QA scenarios from stakeholders |

Central insight: **quality attributes conflict and cannot be maximized simultaneously**; ATAM makes
tradeoffs explicit and stakeholder-resolved rather than accidental.

### 6.2 Architecture documentation

| Framework | What it provides |
|-----------|------------------|
| 4+1 views (Kruchten 1995) | Logical, Process, Development, Physical + Scenarios |
| C4 model (Brown) | L1 Context, L2 Container, L3 Component, L4 Code; plus Deployment/Dynamic |
| arc42 | 12-section template (goals, constraints, context, solution strategy, building blocks, runtime, deployment, cross-cutting, decisions, quality, risks, glossary) |
| ADRs (Nygard 2011) | Title, Status, Context, Decision, Consequences; proposed -> accepted -> superseded; MADR template |
| Diagrams-as-code | Structurizr, Mermaid, PlantUML, D2, Graphviz - version-controlled, reviewable |

Best practice: document only **architecturally significant decisions**, record **rejected
alternatives**, date every decision, use lightweight tooling. (This KB already uses ADR-style rows in
`decisions/06-decisions-log.md` - keep that pattern.)

### 6.3 Risk-driven & evolutionary approaches

- **Risk Storming** (Brown): collaborative visual identification of risks in a specific view, scored
  for impact/likelihood with mitigations.
- **"Just enough" architecture:** defer irreversible decisions, build the smallest thing satisfying
  validated requirements, use the last responsible moment; guided by **walking skeletons** and spikes.
- **Evolutionary architecture & fitness functions** (Ford/Parsons/Kua 2017): encode quality
  requirements as **automated fitness functions** ("p95 latency < 200 ms", "no dependency cycles",
  "no shared DB across bounded contexts") run in CI to prevent architectural drift.

### 6.4 Domain-Driven Design (DDD)

- **Strategic DDD:** **Bounded Context** (explicit boundary where one model applies), **Ubiquitous
  Language** (shared vocabulary reflected in code), **Core vs Generic/Supporting Subdomains**, and
  **Context Mapping** patterns (Shared Kernel, Customer/Supplier, Conformist, Anticorruption Layer,
  Open Host Service, Published Language, Separate Ways).
- **Tactical DDD:** Entities (identity), Value Objects (immutable, value-equal), Aggregates
  (consistency boundary with a single aggregate root; reference other aggregates by ID), Domain
  Events, Repositories, Factories, Domain Services, Application Services. Principle: **a microservice
  should be no smaller than an aggregate and no larger than a bounded context**.

### 6.5 The system-design review framework (4 steps)

1. **Scope & requirements:** functional requirements, non-functional requirements (scale, latency,
   availability, consistency, cost), constraints, out-of-scope; establish numbers (QPS, storage,
   payloads).
2. **High-level design:** API sketch, data model, component diagram, data flow, storage choices;
   back-of-envelope estimation. Identify LB, gateway, services, caches, queues, DBs/sharding, CDN.
3. **Deep dive:** the 1-3 hardest/riskiest areas (consistency, partitioning, hot keys, exactly-once,
   failover) with explicit tradeoffs.
4. **Wrap-up/bottlenecks:** failure modes, monitoring, scaling limits, cost, security, evolution
   ("what breaks first?"); summarize tradeoffs and alternatives.

**Running a design review (ATAM-lite):** state problem/constraints; walk C4 context/container; evaluate
each quality attribute against QA scenarios; surface sensitivity/tradeoff points; record decisions,
risks, rejected alternatives as ADRs; assign owners.

### 6.6 MLOps / ML system design methodology

**Framing:** problem type, success metric tied to a business KPI, offline vs online evaluation,
baseline, failure cost. ("Hidden Technical Debt in ML Systems," Sculley et al. 2015: the model is a
small part of the system.)

**Pipeline stages:** (1) problem framing & data understanding; (2) data pipeline & versioning (schema
enforcement, dedup, snapshots; DVC/Delta/Iceberg); (3) **feature store** with one feature definition
for offline + online, **point-in-time correctness** to prevent leakage; (4) training & experiment
tracking (MLflow, W&B); (5) **model registry** with lineage and aliases (`@candidate`, `@champion`);
(6) deployment modes - batch, online/realtime, streaming, edge, serverless (KServe, BentoML, Triton,
Ray Serve); (7) rollout - shadow, canary, blue-green, A/B with pre-defined promote/rollback criteria;
(8) drift monitoring - data/feature drift (PSI < 0.1 stable, 0.1-0.2 moderate, > 0.2 retrain;
chi-square for categoricals) and concept drift via delayed labels; (9) human-in-the-loop review
queues; (10) retraining loop with hysteresis to avoid retrain storms.

**Central failure modes:** **training-serving skew** (different transform code/units/timezones),
**label leakage** (point-in-time joins), silent degradation without drift monitoring, feature-store
outage blocking inference.

### 6.7 Architecture evaluation checklist & common anti-patterns

**Checklist:**
- Requirements: quality attributes as **measurable scenarios**; priorities agreed?
- Data: ownership per service, consistency model per entity, schema evolution, retention, backup.
- Failure: what if each dependency is slow/down? Timeout/retry/breaker/fallback per dependency?
- Scale: expected QPS/storage growth, partitioning key, hot-key handling, rebalancing.
- Consistency: where strong vs eventual? Cross-service transactions as sagas/outbox?
- Observability: SLIs/SLOs, trace propagation, alerting, runbooks.
- Security: authN/Z, least privilege, secrets, encryption, tenancy isolation, audit.
- Cost/operability: unit economics, on-call load, deploy/rollback path, DR RTO/RPO.
- Decisions: ADRs with alternatives/consequences; fitness functions encoded.

**Anti-patterns (with fixes):**

| Anti-pattern | Symptom | Fix |
|--------------|---------|-----|
| Distributed monolith | Services share DB / deploy together | Re-merge or enforce boundaries |
| Shared DB across services | Schema changes ripple | DB per service; contracts/events |
| Deep synchronous chains | Latency multiplies; cascading failures | Async events, aggregation/BFF, timeouts |
| Chatty services / N+1 | High latency, load amplification | Batch/aggregate, cache, coarser APIs |
| Cache-as-source-of-truth | Stale data, write races | DB authoritative; DEL-on-write; outbox |
| Retry storms | Cascading overload | Backoff + jitter + budgets + breakers |
| Big ball of mud | No enforced boundaries | Modularize; dependency rules in CI |
| Premature microservices | Ops overload, no autonomy gain | Modular monolith first |
| Sticky sessions as state | Can't scale/redeploy | Externalize state |
| Unbounded queues | Hidden overload -> OOM/timeout cliff | Bounded queues + backpressure + shedding |
| Ignoring cardinality | Unusable/expensive metrics | Treat labels as schema; review in PRs |

---

## 7. Application to MediKiosk (this project)

- **`doc/19-production-blueprint.md` is already written in this vocabulary** (invariants, gates,
  topology, capacity, resilience). Use Sec 6.1/6.5/6.7 here as the evaluation lens when the blueprint
  is revised.
- **The thin-kiosk + hospital-edge-node topology** (`doc/19` Sec 3) is the classic
  thin-client/edge pattern; Sec 3.3 (outbox, idempotent consumers, DLQ) and Sec 4.4 (offline-first,
  store-and-forward) are its design basis. `doc/20` Sec B-C already applies outbox/idempotency
  semantics to Module B's ABDM sync - consistent with Sec 3.5 here.
- **Capacity:** Little's Law + the 50-70% utilization rule (Sec 1.5/1.6) back the kiosk-count math
  already used in `doc/19`.
- **Consistency:** Module C's "never silently resolve" merge and Module B's verify-default are
  applications of Sec 2.4/2.6 (authoritative source + explicit conflict) and the anti-fabrication
  stance in `doc/32`.
- **Documentation:** this KB's dated decision rows are ADRs (Sec 6.2); `doc/19` approximates arc42/C4.
- **Compliance-as-architecture** (Sec 5.4) is the frame for the DPDP/ABDM sections of `doc/16`,
  `doc/19`, `doc/20`.

---

## 8. Source register

**Canonical books & papers:** Deutsch et al., *Fallacies of Distributed Computing* (1994/1997);
Brewer PODC 2000 + Gilbert & Lynch 2002; Abadi, *Consistency Tradeoffs...* (PACELC, IEEE Computer
2012); Kleppmann, *Designing Data-Intensive Applications* (2017) and *How to do distributed locking*
(2016); Gunther, *A General Theory of Computational Scalability* (USL, arXiv:0808.1431); Ongaro &
Ousterhout, *Raft*; Lamport, *Paxos Made Simple*; Garcia-Molina & Salem, *Sagas* (SIGMOD 1987); Gray &
Lamport, *Consensus on Transaction Commit* (TODS 2006); DeCandia et al., *Dynamo* (SOSP 2007);
Corbett et al., *Spanner* (OSDI 2012); Nishtala et al., *Scaling Memcache at Facebook* (NSDI 2013);
Sigelman et al., *Dapper* (2010); Sculley et al., *Hidden Technical Debt in ML Systems* (NeurIPS
2015); Kleppmann et al., *Local-First Software* (2019); Shapiro et al., *CRDTs* (2011); Malkov &
Yashunin, *HNSW*; Nygard, *Release It!* (2018); Evans *DDD* (2003); Vernon *Implementing DDD* (2013);
Khononov *Learning DDD* (2021); Newman *Building Microservices* (2021); Richardson *Microservices
Patterns* (2018); Bass/Clements/Kazman *Software Architecture in Practice* (4th ed.); Ford/Parsons/
Kua *Building Evolutionary Architectures*; Forsgren et al. *Accelerate*; Wiggins *Twelve-Factor App*;
Marz & Warren *Big Data* (2015).

**Official docs & standards:** Google SRE Book/Workbook; OpenTelemetry primer; NIST SP 800-207 (Zero
Trust); OWASP Top 10 + ZTA Cheat Sheet; Apache Kafka KIP-98/129/447; Azure Architecture Center
patterns; AWS Well-Architected; AWS Redis caching whitepaper; C4 model; arc42; ADR/MADR; SEI ATAM and
ADD; ISO/IEC 25010; CNCF Cloud Native Definition; Envoy docs; Temporal/Netflix Conductor; MLflow;
Google Rules of ML.

**Engineering blogs / practitioner refs:** martinfowler.com (CQRS, Strangler Fig, MonolithFirst,
Bounded Context); microservices.io; Netflix Tech Blog; Brendan Gregg (USE); Colin Scott (latency);
Jepsen; Abadi DBMS Musings; The HLD Handbook; principlesofchaos.org; Etsy Code as Craft; Caffeine;
Automerge; ByteByteGo; System Design Primer; Milan Jovanovic.

**Courses:** MIT 6.824/6.5840; CMU 15-440/640; Stanford CS244b; Kleppmann Cambridge distributed
systems; Google SRE resources.

*Compiled September 2026. Latency/availability figures are order-of-magnitude references; verify
against current hardware and vendor docs before capacity planning. OWASP/ISO standards are revised
periodically - consult live documents for audits.*
