# Running AI on CPU - Optimization Methodology & Playbook

> **Status: REFERENCE (unratified).** General engineering knowledge, researched 2026-09-16 for the
> MediKiosk CPU-only constraint (`doc/19`, `doc/20`, `doc/14`). This is a **methodology playbook**,
> not a project decision: it explains *how* to make AI run on CPU and *in what order* to apply
> techniques. Project-specific picks (which engine for Module B, etc.) stay in
> `decisions/06-decisions-log.md`.
>
> **Evidence tiering is mandatory when reading this doc.** Numbers marked **[primary]** come from a
> vendor/official benchmark or peer-reviewed paper; **[measured]** from a single reproducible device
> run; **[weak]** from forums/blogs and are indicative only. Never promote a **[weak]** number to a
> design threshold without re-measuring on the target kiosk (4 GB CPU/iGPU class - see `doc/19`).

---

## 0. Governing physics (read first)

Nearly every CPU trick reduces to three facts:

1. **Decode (token generation) is memory-bandwidth-bound GEMV.** Generating one token reads every
   weight once; arithmetic intensity is ~1 FLOP/byte at 16-bit. Throughput ≈ `DRAM bandwidth /
   bytes-per-weight`. Cheaper than "more GHz" is **moving fewer bytes** (weight quantization).
2. **Prefill (prompt processing) is compute-bound GEMM.** Long prompts stress compute and are where
   low-bit *activation* quantization and AMX/VNNI pay off.
3. **Weight-only quantization helps decode; activation quantization helps prefill.** The two phases
   can prefer different formats - measured directly on RK3588 **[measured]**: `Q4_K_M` won
   generation on every model, while `Q8_0` gave the fastest prompt processing. This is not a
   contradiction; it is phase separation.

Second-order physics that shows up constantly:
- **Memory bandwidth is the CPU ceiling, not clock speed.** Dual-socket SPR GEMV is 2.4-4.6x slower
  than an A100 despite high FP throughput (low memory bandwidth per core) [Kim et al., IEEE LCA 2024].
- **Per-token decode under-utilizes wide vectors**, which is why batching/continuous serving matters
  (and why single-stream CPU latency is hard to beat).
- **AMX pays at batch, not at batch=1.** BF16 AMX gave 21-72% latency improvement at batch>=8 on
  Amazon m8i, but small models at batch=1 could *regress* (tile setup overhead) [AWS, 2026-03-30,
  primary].

---

## 1. Model-level techniques

### 1.1 Quantization

**PTQ vs QAT**

| | Post-Training Quantization (PTQ) | Quantization-Aware Training (QAT) |
|---|---|---|
| Cost | Calibration pass (~128-300 samples) | Full/partial retraining |
| Accuracy | ~1-3% at INT8; 1.8-2.9% at INT4 [ACL 2025, primary] | Closest to FP16 at aggressive bits |
| CPU use | Default path (NNCF PTQ, ORT `quantize_static`, `llama-quantize`) | Only if PTQ misses the accuracy floor |

**Weight-only vs weight+activation**

- **W4A16 (weights only)** - dequantize to FP16 at compute time. Gains are pure memory-bandwidth
  reduction. GPTQ, AWQ, NF4, GGUF K-quants. **Dominant and pragmatic default for LLM decode on CPU**,
  because GGUF W4A16 has universal runtime support.
- **W8A8 (weights + activations)** - integer GEMM, unlocks VNNI/AMX integer throughput; better for
  compute-bound prefill/batch. Smoother ops support (SmoothQuant, ORT static QDQ). Use only when
  prefill/batch throughput is the SLO.

**GGUF K-quants** (llama.cpp reference; the CPU workhorse):

| Format | bits/wt | Size GiB | pp512 t/s | tg128 t/s |
|---|---:|---:|---:|---:|
| F16 | 16.0 | 14.96 | 923.5 | 29.2 |
| Q8_0 | 8.50 | 7.95 | 865.1 | 50.9 |
| Q6_K | 6.56 | 6.14 | 812.0 | 58.7 |
| Q5_K_M | 5.70 | 5.33 | 758.7 | 67.2 |
| Q4_K_M | 4.89 | 4.58 | 821.8 | 71.9 |
| IQ4_NL | 4.68 | 4.38 | 806.0 | 76.6 |
| Q3_K_S | 3.64 | 3.41 | 752.2 | 69.8 |
| Q2_K | 3.16 | 2.95 | 784.5 | 79.9 |

Llama-3.1-8B, llama.cpp README **[primary]**. A unified Jan-2026 study (dual Xeon 8488C, AVX-512)
found **5-bit is the best quality/speed default**, Q4_K_S near-max compression with quality close to
F16, and **Q3_K_S the largest degradation**; format identity mattered as much as bit-width for
instruction/reasoning benchmarks [arXiv 2601.14277].

**Embedded/ARM real device** (RK3588, Cortex-A76/A55, 4 threads) **[measured]**:

| Model | Quant | tg t/s | Peak RSS |
|---|---|---:|---:|
| Qwen2.5-1.5B | Q4_K_M | 22.57 | 2.0 GiB |
| Qwen2.5-1.5B | Q8_0 | 15.26 | 3.2 GiB |
| Llama-3.2-3B | Q4_K_M | 11.25 | 4.0 GiB |
| Qwen2.5-7B | Q4_K_M | 5.44 | 8.68 GiB |
| Qwen2.5-7B | Q8_0 | 3.43 | 14.78 GiB |

Also: Q4_K_M won generation on all four; Q8_0 won `pp1024`; Q6_K gave almost no generation
advantage over Q5_K_M for more memory; **4 threads beat 8** on this SoC.

**PTQ algorithms, and where they run on CPU**

| Method | Regime | Mechanism | CPU viability |
|---|---|---|---|
| RTN | any | round-to-nearest | Yes (baseline; outlier-sensitive) |
| GPTQ | W4A16 | layer-wise Hessian error compensation | Via GGUF/OV converters |
| AWQ | W4A16 | protects ~1% activation-salient channels via scaling | NNCF data-free AWQ supported |
| SmoothQuant | W8A8 INT8/FP8 | migrates activation outliers into weights | NNCF `nncf.quantize()` |
| bitsandbytes | W8A16/W4A16 | mixed-precision outlier split | GPU-only currently |
| HQQ | 1-8 bit | calibration-free | Limited |

Do **not** treat "AWQ > GPTQ" as a universal rule: a 500k-evaluation study showed tuned W8A8-INT
degradation is only 1-3% (not 10%+) and a simple GPTQ variant can beat AWQ on real tasks [ACL 2025].

**ONNX Runtime CPU quantization matrix** (using the wrong combination is a common cause of
quantized models running *slower* than FP32) [ORT, 2026]:

| Target CPU | Format | activation | weight | reduce_range | per_channel |
|---|---|---|---|---|---|
| x64 non-VNNI (pre-Skylake-SP) | QDQ | QUInt8 | QInt8 | True | False (throughput) |
| x64 VNNI (Skylake-SP+, Zen4+) | QDQ | QUInt8 | QInt8 | False | False |
| ARM (Cortex-A, Apple, Graviton) | QDQ | QInt8 | QInt8 | False | False |

**Accuracy cliffs / failure mechanics**
- **4-bit = signal degradation** (structurally intact, precision impaired; repairable with targeted
  protection). **2-bit = computation collapse** (components non-functional; not repairable by
  low-rank compensation). Quantizing just the first two layers of Llama-3.1 at 2-bit dropped
  factual-recall 100% -> 41.65% [ACL Findings 2026].
- Quantization errors correlate across methods (rho~0.82); the **MLP gate projection** is a key
  sensitive component; long-tail inputs are *not* disproportionately hurt [EMNLP 2025]. **Perplexity
  alone is insufficient** - always test on the real task distribution.
- FP8 (W8A8-FP) is effectively lossless at Llama-3.1 scales [ACL 2025]; x86 FP8 acceleration is
  limited, so BF16 is the practical x86 mixed-precision target.

### 1.2 Knowledge distillation

- **ASR:** Distil-Whisper (pseudo-label + KL) is the reference recipe. ASKD-Whisper (2026) reports
  **5x latency reduction while beating the 1.5B teacher by 1.07% WER** on a specialized domain;
  DQLoRA (2025) distills Whisper into a <10M-trainable-param Wav2Vec2 student [arXiv 2601.19919,
  2507.10313].
- **OCR:** the PP-OCR "mobile" tier is effectively the distilled deployment tier.
- **NLP/classification:** DistilBERT-class models (~40% smaller, ~60% faster, ~97% of BERT accuracy)
  are the canonical cheap router/gate.
- Caveat: static distillation inherits teacher blind spots and over-confidence; capacity gap limits
  how small a student can be. Prefer adaptive/self-distillation schedules.

### 1.3 Pruning and sparsity - a *memory* tool on CPU, not a latency tool

| Type | Granularity | CPU reality |
|---|---|---|
| Unstructured | individual weights | Rarely speeds up CPU unless sparsity-aware kernels (DeepSparse, SparAMX). 50%+ compression at low loss (SparseGPT, Wanda). |
| Semi-structured 2:4 | 2 of every 4 | Native on NVIDIA tensor cores; **no widespread x86/ARM CPU speedup**. |
| Structured | rows/cols/heads/layers | Real dense-matrix CPU speedup; higher accuracy loss. |

Exception: **SparAMX** (Intel Labs, 2025, "load-as-sparse, compute-as-dense" over AVX-512 `vpexpandw`
into AMX tiles) reports 1.42x decode latency reduction vs stock PyTorch for Llama-3-8B and 1.14x
attention speedup at <1% accuracy loss [arXiv 2502.12444]. Bottom line: **do not plan CPU latency
wins from pruning unless you adopt a dedicated sparse-kernel runtime.**

### 1.4 Low-rank factorization / LoRA / weight sharing

- **LoRA/adapters** are a training-efficiency and multi-tenant-serving tool on CPU: useful for
  distillation students and dynamic adapter swap (OpenVINO GenAI added dynamic LoRA for VLMs in
  2026.1), not for beating quantization at equal bits.
- Genuine low-rank *deployment* compression (factorizing weight matrices) underperforms quantization
  at equal bits for LLMs.
- Weight sharing / tied embeddings is a training-time design; at CPU serving it mostly shows up as
  quantizing token embeddings at a different type.

### 1.5 Architecture choices favorable to CPU

- **Encoder-only (BERT/RoBERTa/DeBERTa)** is far cheaper than decoder-only for
  classification/embeddings: one forward pass, no autoregression, no KV cache.
- **Depthwise-separable convolutions** (MobileNet family) remain unbeatable per-FLOP on CPU.
- **Small conv/transformer hybrids** (PP-OCR mobile backbones, Zipformer ASR) are the distilled
  workhorses.
- **Model size is the highest-leverage decision.** 7B -> 1.5B roughly quadruples token throughput
  (RK3588 table: 5.44 -> 22.57 t/s). No runtime flag recovers a wrong size.
- **MoE on CPU** is memory-bandwidth-bound; attention's quadratic cost dominates at long context.

### 1.6 Speculative decoding, token pruning, KV cache, early exit

- **Speculative decoding** is supported in llama.cpp (`draft-simple/eagle3/dflash/dspark/mtp`,
  `ngram-*`; flags `-md`, `--spec-draft-*`). **CPU caveat:** it only pays when verification is
  genuinely batch-parallel. On a quantized backend the verify cost grew nearly linearly per token;
  best case 1.61x at K=6, and **3 of 5 configurations decelerated** [arXiv 2607.17283]. Measure
  acceptance rate and verify cost separately; abandon the draft below ~50-60% acceptance.
- **Early-exit / token pruning:** real research, weak CPU-runtime support; llama.cpp exposes no
  per-token early exit. Treat as phase-2.
- **KV-cache optimization is a real CPU win:**
  - llama.cpp `--cache-type-k/-v q8_0` roughly halves KV RAM with minimal quality loss; q4_0 ~25%
    with long-context drift; `--cache-ram` spills KV to system RAM (30-50% slower) [llama.cpp
    docs, primary; community figures weak].
  - ORT added **INT8/INT4 symmetric quantized KV cache** to the CPU `GroupQueryAttention` op with
    AVX2/AVX512-VNNI/NEON kernels [PR #28576/#28578, primary].
  - ORT **tiled CPU flash-attention GQA** (online-softmax KV blocking + flash decoding), Xeon 8480C
    threads=8: prefill **1.2-2.7x** and peak memory **7-24x** reduction, decode **1.2-1.8x**, flash
    decoding **2-5x** for long sequences (activates when batch x heads < threads) [PR #28695].
  - OpenVINO enables **8-bit asymmetric KV cache on CPU by default** (4-bit optional).

---

## 2. Runtime / compiler / execution techniques

### 2.1 ONNX Runtime (CPU EP)

- **Graph optimizations** in levels: Basic (constant folding, dead-node elimination), Extended
  (GEMM/MatMul-add/conv-activation/GELU/LayerNorm/Attention fusions), Layout (NCHWc). Serialize
  offline (`optimized_model_filepath` -> **ORT format**) to skip startup transforms and cut
  first-inference latency. Layout-optimized models are hardware-specific.
- **Quantization:** QDQ preferred since 1.11; dynamic for transformers/RNNs, static for CNNs; use the
  CPU matrix in Sec 1.1.
- **MLAS** is the CPU kernel library (VNNI, AVX-512, AMX, KleidiAI-accelerated Arm paths).
- **Known traps:** a QDQ Conv->QLinearConv fusion with bad bias scales produced wrong CPU output in
  some versions [issue #24711]; block-quantized FP16 weights failing to fuse
  `DQ->MatMul->MatMulNBits` on CPU [commit 09b5695]. Always verify which kernel path ran.

### 2.2 OpenVINO (Intel CPU)

- **NNCF algorithms:** PTQ (INT8), weight compression (INT8/INT4/NF4/MXFP8), AWQ (incl. data-free),
  Scale Estimation, GPTQ, SmoothQuant, QAT (incl. FQ_LORA). `create_compressed_model()` is
  deprecated in favor of `nncf.quantize()`; the TF backend is being removed (2026).
- **CPU plugin:** FP32/BF16/FP16/INT8; `PERFORMANCE` vs `ACCURACY` execution mode; `inference_precision`
  override. On Intel CPU it auto-selects OpenVINO for "high-performance inference" (PaddleOCR 3.0
  TR).
- **Throughput vs latency:** `THROUGHPUT` creates N streams (one host thread each, pinned to physical
  cores aligned to NUMA nodes); `LATENCY` uses fewer streams. Model caching (`cache_dir`) skips graph
  transforms.
- **Sparse weights decompression** requires INT8 quantization **and** Intel AMX; disabled by default.
- **OVMS continuous batching:** `max_num_batched_tokens` (default 256), `max_num_seqs` (256),
  `dynamic_split_fuse`, KV `cache_size`, `enable_prefix_caching`, preemption on KV exhaustion.
- A **llama.cpp OpenVINO backend** now exists (`GGML_OPENVINO_DEVICE=CPU|GPU|NPU`) but is reported
  immature; one embedded comparison had plain llama.cpp beating it [weak].

### 2.3 llama.cpp / GGML (the CPU default for LLMs)

- **Formats:** GGUF; weights repacked at load into a cache-friendly layout (`--repack`/`-nr`).
- **Threads:** `-t` physical cores, `-tb` batch threads; hyperthreading rarely helps and can hurt.
- **Memory:** `--load-mode auto|none|mmap|mlock|mmap+mlock|dio`; `mlock` prevents swap; on tight RAM
  prefer mmap.
- **NUMA:** mainline warns but does **not** auto-bind (as of b4382); bind manually.
- **KV cache / speculative / prompt cache:** see Sec 1.6; server has `--cache-prompt`,
  `--cache-reuse`, `-kvu/--kv-unified`, `-np` slots.

### 2.4 Other CPU runtimes

| Runtime | Strengths | CPU notes |
|---|---|---|
| **MNN** (Alibaba) | Conv strategy auto-select (Winograd/Strassen/Im2col), NC4HW4, depthwise special | Fastest MobileNetV2 INT8 in one RK3588 run but slow load [weak] |
| **ncnn** (Tencent) | Hand NEON, Winograd 3x3, memory pool, tiny C footprint | Lowest peak RAM / stable P99 in same run [weak] |
| **TFLite/LiteRT + XNNPACK** | Widest mobile deployment, mature delegate fallback | Multi-thread buffers inflate RAM |
| **ExecuTorch** (Meta) | AOT export, no ONNX hop, 1.0 release | XNNPACK CPU competitive; llama.cpp often wins LLM decode [arXiv 2605.08195] |
| **Apache TVM** | Compiler-generated kernels | Steeper toolchain |
| **WASM / WASI-NN** | Browser/edge sandbox | XNNPACK supports WASM SIMD + relaxed SIMD |

### 2.5 Kernel libraries and ISAs

| Library | Platform | Role |
|---|---|---|
| oneDNN/MKL-DNN, oneMKL | x86 | CNN/GEMM primitives, AMX/VNNI dispatch |
| Apple Accelerate/BNNS | Apple | CPU/ANE |
| XNNPACK | ARM/x86/WASM/RISC-V/Hexagon | Mobile operator kernels |
| CMSIS-NN | Cortex-M | MCU |
| KleidiAI | Arm | MatMul microkernels (SME2 -> I8MM -> DotProd) |

**x86 ISA ladder:** SSE -> AVX2 -> AVX-512 -> AVX-512 VNNI (INT8 dot) -> AVX-512 BF16 -> **AMX**
(tile registers, 2048 INT8 or 1024 BF16 ops/cycle). AMX needs kernel >=5.16 and oneDNN >=2.6.
Amazon m8i BF16-AMX: 21-72% latency improvement at batch>=8 across several models; **batch=1 small
models can regress** (DialoGPT-large -44%). Practical AMX efficiency is 5-40% of theoretical,
limited by LFB saturation and multi-socket sync; NUMA-aware scheduling + tile pipelining can recover
up to 2x [IEEE LCA 2026].

**KleidiAI caution:** integrated into llama.cpp behind `GGML_CPU_KLEIDIAI=ON`; microkernel priority
SME2 -> I8MM -> DotProd. Performance is comparable to default AArch64 kernels and **degrades at high
thread counts / heterogeneous big.LITTLE**. As of Apr 2026 it was worse than the default backend on
Snapdragon 8 Elite Gen5 due to static MatMul splitting (weighted load distribution in progress).
Treat as a win mainly on homogeneous SME2 servers and always benchmark on your SoC.

### 2.6 Operator fusion, layouts, memory planning, mixed precision

- **Fusion** (ORT extended fusions; OpenVINO QKV/MLP fusion in BF16 on AMX) reduces memory
  round-trips - exactly what bandwidth-bound decode needs.
- **Layouts** (NCHWc, NC4HW4) reduce conversion overhead but add buffers.
- **Memory planning / zero-copy:** ExecuTorch plans at export; ncnn/MNN pool; llama.cpp repacks;
  CTranslate2 reuses buffers. Avoids per-call allocation.
- **Mixed precision:** BF16 is the x86 target (AVX-512-BF16 / AMX); FP16 on x86 is emulated unless
  AVX512-FP16 exists. ARM `armv8.2-a+fp16` doubles vector throughput. OpenVINO warns BF16 can exceed
  a 0.5% accuracy threshold on some models; forcing FP32 on AMX-BF16 hardware can cut throughput >60%
  when compute-bound.

### 2.7 Continuous/batched inference, prefill/decode, prompt cache, streaming

- **Continuous batching + paged attention** on CPU: OpenVINO GenAI/OVMS and vLLM CPU backend
  (`VLLM_CPU_KVCACHE_SPACE` per NUMA node).
- **Prefix/prompt caching** reuses KV for shared prefixes (system prompts, RAG boilerplate): OVMS
  `enable_prefix_caching`, llama.cpp `--cache-prompt`/`--cache-reuse`. On CPU this matters a lot
  because prefill is the expensive phase.
- **Batching is not automatically good on CPU:** one simulation found continuous batching improved
  P99 TTFT (946 -> 521 us) but *worsened* P99 E2E (3,745 -> 6,230 us) under its cost model [weak,
  simulation]. Measure at production concurrency.

---

## 3. Hardware / OS / host-level techniques

### 3.1 Threading, affinity, NUMA

- **Set threads to physical cores, not logical.** SMT siblings contend for ports and L1/L2, causing
  erratic token latency.
- **Avoid oversubscription across libraries.** A Docling deployment went from normal to
  **40-minute page processing** on a 6-vCPU VM because PyTorch/ORT/Docling each spawned threads; fix
  was consistent `OMP_NUM_THREADS` + `DOCLING_NUM_THREADS` [docling issue #3163, primary].
- **NUMA binding is mandatory on multi-socket / multi-CCD** (`numactl --cpunodebind=0 --membind=0`).
  Reported gains are large (community: +109% tok/s on dual EPYC 9654 for a 70B model [weak]; Arm PoC
  up to 55% on Neoverse N2). Default Linux interleaving creates 2.5-4x remote-latency penalties.
- Enable Sub-NUMA Clustering (Intel) / NPS (AMD); prefer independent single-socket replicas behind a
  load balancer over cross-socket tensor parallelism.

### 3.2 Power/thermal on kiosk/embedded

- Sustained vs burst: passively cooled kiosks throttle. One automotive deployment saw a Jetson AGX
  Xavier fall from a claimed 60 fps to **22 fps after 15 minutes** [weak case study].
- An 8-thread RK3588 was slower for generation than 4 threads (bandwidth/thermal).
- Lock to a sustained frequency; disable turbo for jitter predictability; test over >5 minutes (a
  full hospital day is better).
- Disable C-states / frequency scaling for latency-sensitive inference; use CPU sets to keep OS noise
  off inference cores.

### 3.3 SIMD, vector width, containers

- Vector width is chosen at build/driver time (`DNNL_MAX_CPU_ISA`/`ONEDNN_MAX_CPU_ISA`,
  `GGML_CPU_ARM_ARCH`, `-march`/`-mcpu`). One comparison had a CPU-only llama.cpp build on a
  GPU-equipped box **85% slower** - build flags and backend choice are not cosmetic [weak].
- Containers: pin CPUs (`cpuset`), set `OMP_NUM_THREADS`, use `--cpu-mask`/`--cpu-range`; in
  Kubernetes prefer CPU-manager `static` + Topology Manager `single-numa-node` for latency-sensitive
  pods.
- Huge pages reduce TLB misses for large model allocations.

---

## 4. Serving / system-level techniques for CPU inference

### 4.1 Batching, scheduling, multiplexing, warm pools

- **Warm pool / preload at boot.** Model load dominates cold start (CPU weight load is disk-bound).
  For a long-lived kiosk, preload once and keep resident; never trigger a cold load on the hot path.
- Keep the model in RAM (`mlock`/`load-mode mlock`); avoid swap.
- **Memory budget & OOM handling:** size `-c`, `-np`, and KV type against RAM; OVMS preempts or
  terminates requests when the KV pool is exhausted (watch `ovms_current_graphs`).
- **Multiplexing:** one instance per NUMA node rather than one across sockets.
- Priority queues: llama.cpp `--prio`/`--prio-batch`; OS `nice`/cgroups to prioritize interactive
  over batch.

### 4.2 Tiered inference - the single most important CPU architecture pattern

Published frameworks:
- **FrugalGPT** (2023/24): router -> cheap model -> DistilBERT quality estimator -> stop judge.
- **AutoMix** (2024): small model self-verifies, escalates on low confidence.
- **RouteNLP** (2026): 4 tiers, conformal thresholds, distillation-routing co-optimization;
  8-week pilot **-58% inference cost, p99 1,847 -> 387 ms, 91% acceptance** [arXiv 2604.23577].
- **UCCI** (2026): isotonic-calibrated token-margin uncertainty -> cost-optimal threshold; **-31%
  cost at F1=0.91** on production NER, beating entropy/conformal/FrugalGPT baselines. Key finding:
  **calibration of the routing signal matters more than threshold tuning** [arXiv 2605.18796].
- **Conformal Cascade** (2026): prediction-set size as the deferral rule, distribution-free coverage.
- **Signed Rescue Routing** (2026): predict "large rescues small" vs "large harms small" separately.

**Map to a CPU-only kiosk:**
1. Put OCR/ASR/**small classifier or embedding model** on the synchronous critical path
   (ms-scale, CPU-cheap).
2. Put the LLM summary/analysis **async**, off the user-facing latency path.
3. Cascade so heavy VLM/LLM calls happen only for evidence that needs them.

Router latency budgets (community-consistent): rule/TF-IDF+LogReg <1 ms; MiniLM-L6 embeddings ~10-30
ms warm; DistilBERT ONNX ~12 ms (vs 45 ms PyTorch); LLM-as-judge 100-500 ms (too slow for a live
path).

### 4.3 Multi-stage pipelines, caching, deduplication

- **Classical OCR first, VLM only for hard pages.** In Docling profiling, VLM enrichment was 58% of
  pipeline time; recommended optimization is routing the VLM to pages with figures/handwriting/low
  confidence [docling discussion #3442].
- **Disable unused stages.** Docling disabled OCR saved ~60% of x86-CPU runtime; disabling OCR +
  table structure saved ~75% [Docling TR, primary].
- **Semantic caching** catches query variations (exact ~14-15% -> semantic ~42% in one router, ~15 ms
  embedding overhead [weak]).
- **Deduplicate** repeated documents/pages by hash before running any model.

---

## 5. Task-specific guidance

### 5.1 OCR / document AI on CPU

**PaddleOCR PP-OCRv5/v6 mobile** (det 4.8 MB + rec 16.6 MB + cls 0.6 MB). Official CPU engine
latency, Intel Xeon Gold 6248, rec model [primary]:

| Model | Engine | Inference ms | End-to-end ms |
|---|---|---:|---:|
| PP-OCRv5_mobile_rec | onnxruntime | 2.05 | 4.91 |
| PP-OCRv5_server_rec | onnxruntime | 3.15 | 5.98 |
| PP-OCRv6_medium_rec | onnxruntime | 2.28 | 4.97 |
| PP-OCRv6_tiny_rec | onnxruntime | 0.92 | 3.12 |
| PP-OCRv6_small_rec | onnxruntime | 1.79 | 4.46 |

**Detection is the expensive stage in practice:** community profiling found det 101-210 ms vs rec
20-30 ms per frame on Windows/CPU; RapidOCR-OpenVINO closed much of a Paddle-vs-ONNX gap
[RapidOCR issue #514, 2025-07-24]. Full RapidOCR-v5 mobile pipeline on CPU reported ~0.8-1.2 s/image
[weak]. (This confirms the Module B decision to A/B onnxruntime vs OpenVINO and time per stage -
`doc/20` Sec B-B.)

**Tesseract** is CPU-only; a reproducible 2026 receipts benchmark sustained **78.6 pages/min on CPU on
SROIE**, faster than four of seven GPU engines, but with a low field-recovery ceiling
(CORD LLM field F1 0.163) [first-party, receipts only].

**Docling** (x86 CPU, 8 threads) [primary]: median **0.79 s/page**, mean **3.1 s/page**; components
EasyOCR 13 s/page, layout 633 ms/page, TableFormer fast 1.74 s/table; GPU speedups 8x OCR / 14x
layout / 4.3x table. A production deployment reports 790 ms/page on 8-core x86 CPU.

**Practical recipe:** PP-OCRv5/v6 mobile det+rec exported to ONNX, run through ORT or OpenVINO;
disable cls and unneeded stages; control detection input long side; Tesseract as the simple-print
fallback; any VLM page understanding reserved for flagged hard pages, off the critical path.

### 5.2 ASR on CPU

**faster-whisper (CTranslate2 INT8)** is the CPU default. Vendor benchmark (8 threads, i7-12700K,
13-min audio) [primary]:

| Implementation | Precision | Time | RAM |
|---|---|---:|---:|
| whisper.cpp | fp32 | 2m05s | 1049 MB |
| whisper.cpp (OpenVINO) | fp32 | 1m45s | 1642 MB |
| faster-whisper | fp32 | 2m37s | 2257 MB |
| faster-whisper | int8 | 1m42s | **1477 MB** |
| faster-whisper (batch=8) | int8 | 51s | 3608 MB |

On CPU `compute_type="int8"` is the recommendation (int8 vs fp16: ~-0.3% WER for ~2x speed). **Model
choice matters more than runtime** - use `large-v3-turbo`/`distil-large-v3` where accuracy allows.
whisper.cpp vs faster-whisper is genuinely contested on CPU (one Feb-2026 issue found whisper.cpp
9.7x slower on 31 s audio on an Intel N97 [issue #3682]); differences trace to quantization scheme
(per-tensor symmetric vs per-channel asymmetric) and threading. **Streaming:** VAD gating (Silero) +
LocalAgreement policy (`whisper_streaming`); realistic latency is 500-800 ms, not sub-200 ms. Set
`language=` explicitly and `vad_filter=True` to avoid hallucinations.

### 5.3 NLP / LLM analysis on CPU

llama.cpp with small quantized models is the CPU baseline. Concrete CPU-first decode rates:

| Hardware | Model | Quant | Decode t/s | Tier |
|---|---|---:|---:|---|
| RK3588 4-thread | Qwen2.5-1.5B | Q4_K_M | 22.57 | measured |
| RK3588 4-thread | Llama-3.2-3B | Q4_K_M | 11.25 | measured |
| RK3588 4-thread | Qwen2.5-7B | Q4_K_M | 5.44 | measured |
| Intel laptop | Qwen2.5-1.5B | Q4_K_M | ~22 | weak |
| Intel laptop | Qwen2.5-7B | Q3_K_M | ~3.6 | weak |
| Xeon 8488C dual | Llama-3.1-8B | Q4_K_M | see 1.1 | primary |

**Why LLM generation must not sit on a real-time critical path:** even 1.5B at ~22 t/s is ~45
ms/token; a 300-token summary is ~14 s. 7B at ~3.6-5.4 t/s is 200-280 ms/token. Nothing here meets a
sub-200 ms interactive budget for generative output. **Design: generation is async; classification,
embedding, OCR, ASR are sync.**

**llama.cpp vs OpenVINO is workload-specific and format-coupled:** one test had llama.cpp ~2x faster
for Qwen2.5-1.5B [weak]; another had OpenVINO GenAI CPU INT4 beating llama.cpp SYCL Q4_K_M for
Qwen3-8B [weak]. Each engine wants its own native quantized format. Note the **NPU is not a CPU win
today** (Meteor Lake NPU generation slower than CPU; 95.9 s model load vs 4.73 s).

### 5.4 Small classifiers/embeddings - the cheap alternative to LLM calls

- `all-MiniLM-L6-v2` (22.7M, ~80-90 MB RAM): 1-5 ms/query on CPU (sub-1 ms batched), 85-92% routing
  accuracy after 500-1000 labels [weak but consistent].
- DistilBERT complexity classifier: PyTorch 45 ms -> ONNX 12 ms, memory 400 -> 150 MB [weak].
- `TF-IDF + LogisticRegression`: <1 ms, ~1 MB, ~80-85% accuracy for shallow decisions.
- Static int8 embeddings (512-dim, ~16 MB) can route in ~0.15 ms via lookup + mean-pool [weak].

**Rule of thumb: if the task has a bounded label set, replace the LLM call with a small ONNX
classifier/embedder. This is the highest-ROI optimization on a CPU-only box.**

---

## 6. Decision methodology

### 6.1 The ordering (apply in this sequence)

```
0. Define gates FIRST: RAM budget, latency budget (p50/p95), accuracy floor,
   licensing, and whether the task is on the sync critical path.
1. ARCHITECTURE: pick the smallest adequate model (encoder for classify/embed/route;
   mobile tier for OCR/ASR; smallest generation model the accuracy gate allows).
   This alone determines 2-4x throughput.
2. QUANTIZE: 4-5 bit weight-only (GGUF Q4_K_M/Q5_K_M, NNCF INT4, ORT QDQ INT8).
   Use W8A8 only if prefill/batch throughput is compute-bound.
   Use QAT/FQ_LORA only if PTQ misses the accuracy floor.
   Quantize the KV cache (q8_0) separately once context grows.
3. RUNTIME: match the runtime to the artifact. llama.cpp/GGUF = CPU-first LLM;
   ORT = portability; OpenVINO = Intel CPU accel; CTranslate2 = ASR.
   Build with correct ISA flags.
4. SCHEDULE at OS level: physical-core thread count, CPU pinning, NUMA binding,
   mlock/warm pool, no oversubscription.
5. SERVE: prefix/prompt cache; continuous batching IF measured to help;
   one instance per NUMA node; watch KV/RAM budget and preemption.
6. TIER: cheap models on the sync path; LLM/VLM async; calibrated cascade.
7. MEASURE, then promote. Re-measure after any model/quant/runtime swap.
```

### 6.2 Benchmarking methodology on CPU

- **Warm up** (first call includes graph compile/page-in). Report warm numbers; report cold/first-token
  separately.
- **Pin threads and bind memory** (`taskset`/`numactl`, `--cpu-mask`, `OMP_PROC_BIND=close`). Compare
  configurations at the same thread count.
- **Report p50/p95/p99**, never means; report **peak RSS** (note RSS != exact model+KV).
- **Separate prefill and decode** (a format that wins prefill can lose decode). Report TTFT and TPOT.
- **Throughput vs latency:** tok/s, tok/s/user, req/s, goodput under SLO.
- **Quality:** compare to an F16 baseline on the **real task** - CER/WER for OCR/ASR, F1 for
  classification, perplexity delta only as a secondary signal. Check instruction/reasoning benchmarks
  for LLMs (format identity can shift them independently of perplexity).
- **Record the artifact contract:** quantizer version, calibration data, packing layout,
  tokenizer/chat template, checksum.
- **Reproducibility:** fixed seed, pinned runtime revision, controlled frequency/governor, repeated
  trials with bootstrap CIs.
- **Prove the kernel path.** Vendor "accelerated" claims are false until verified - read ORT/OV logs
  for the exec type, confirm KleidiAI SME2 ran, confirm each node's execution provider. Docs warn
  about silent CPU fallback.
- **Prove no cloud fallback.** In "offline" designs, verify there is no silent cloud API call.

### 6.3 Common pitfalls

1. **Quantization accuracy cliffs** - 4-bit gradual, 2-bit computation collapse; never ship sub-3-bit
   without task validation; format matters as much as bit width.
2. **Quantized model slower than FP32** - wrong activation/weight type/reduce_range for the CPU;
   wrong KV type; unsupported ops on slow paths; per-channel overhead.
3. **Tokenizer/postprocessing overhead** - in OCR/streaming ASR, preprocessing/postprocessing can
   exceed inference; measure the full pipeline.
4. **First-call compilation cost** - serialize offline (ORT format / OpenVINO cache_dir).
5. **Thread oversubscription** - library thread pools stack; set every thread env var.
6. **NUMA interleaving** - default policy creates 2.5-4x remote-latency penalties; bind explicitly.
7. **More threads is not more speed** - past physical cores, cache thrashing reduces throughput.
8. **Thermal throttling on kiosks** - test sustained, not burst.
9. **Silent fallback to cloud** - verify the execution provider and device actually used.
10. **"Accelerated" paths can be slower** on heterogeneous/high-core ARM SoCs (static splitting).
11. **Speculative decoding that decelerates** when verification is not batch-parallel.
12. **Batching that hurts tail latency** - continuous batching can improve TTFT while worsening P99 E2E.

---

## 7. Application to MediKiosk (this project)

- **Tiered inference is the architecture, not an optimization.** Module A capture/validation and
  Module B reading sit on the synchronous path with small CPU models; Module C generation is async
  (`doc/18`, `doc/19`).
- **Module B already follows this playbook:** PP-OCRv5-mobile via RapidOCR/ONNX is the pick; OpenVINO
  is the A/B backend; Tesseract is the fallback floor; PaddleOCR-VL GGUF is deferred because it has
  **no published CPU latency** (`doc/14` Sec 4a, `doc/20` Sec B-B).
- **The LLM narrative lane cannot be interactive** on a 4 GB kiosk - this is the quantitative basis
  for the deterministic-first Module C decision in `decisions/06`.
- **The Module B benchmark rules from `doc/20` Sec B-B/B-A are instances of Sec 6.2 here**: pin cores,
  discard warmups, report p50/p95 + peak RSS, verify the kernel path, and gate on the local eval set.
- **Kiosk thermal/power and sustained-throughput warnings in Sec 3.2/5.3 align with `doc/19`'s
  capacity and resilience sections.**

---

## 8. Source register (condensed; full tiering in the research log)

**Primary/vendor:** llama.cpp `tools/quantize/README.md`, `docs/speculative.md`, server README;
ONNX Runtime graph-optimization + quantization docs; ORT CPU quantization commit b40bdd8; ORT GQA KV
PRs #28576/#28578/#28695; OpenVINO CPU-device + precision-control docs, OVMS LLM reference, NNCF
repo; PaddleOCR text-recognition module docs (CPU engine benchmark); faster-whisper README; Docling
TR + GPU/perf docs + issues #3163/#3442; KleidiAI repo; XNNPACK/ExecuTorch docs.

**Papers:** arXiv 2601.14277 (GGUF study); ACL 2025 "Give Me BF16 or Give Me Death"; ACL Findings
2026 + EMNLP 2025 (quantization failure modes); SparAMX arXiv 2502.12444; IEEE LCA 2024 (AMX GEMV)
and 2026 (InfAMAX); ASKD-Whisper 2601.19919; DQLoRA 2507.10313; RouteNLP 2604.23577; UCCI 2605.18796;
Conformal Cascade 2607.25018; Signed Rescue Routing 2609.07786; "Lossless but Not Free" 2607.17283;
ExecuTorch benchmark 2605.08195; Docling TR 2408.09869v4.

**Measured/benchmarks:** RK3588 GGUF quantization benchmark (turingpi, 2026-07-29); CPython CPU
inference profiling lab (honest MEASURED/SIMULATED labels); AWS AMX benchmark (2026-03-30); Arm
NUMA PoC (2026-01-28); RapidOCR issue #514 (2025-07-24).

**Weak/community (label as such):** whisper.cpp-vs-faster-whisper guides; MNN/ncnn/TFLite RK3588
comparison; llama.cpp settings and NUMA guides; LLM routing blog posts; Wcowin PP-OCRv5 guide.

**Could not verify:** peer-review status/reproducibility of many 2026-dated arXiv preprints; RK3588
runtime benchmark methodology beyond its own description; whether all "2026" blog figures used
reproducible harnesses.
