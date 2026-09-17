# Module B CPU-Only Model Research (2026-09-11, opencode session)

> **Purpose:** paper-level research pass for Module B (= "Module 2" in team numbering) under a
> **CPU-only constraint** (GPU treated as unavailable; 12-16GB system RAM ceiling). Complements
> `13-module-b-deep-dive.md` (which assumed a GPU for the VLM lane). This is research output
> with findings - **NOT a ratified decision**. Pending decision row: `decisions/06-decisions-log.md`
> "Document AI for Module B: VLM-first vs classical OCR vs router".
>
> **Method:** every latency/RAM/accuracy claim below traces to a paper, maintainer-published
> benchmark table, or repo/model-card fact fetched live on 2026-09-11. Community/forum numbers
> are labeled as such and never used as sole support. A `/last30days` sweep (2026-08-12 to
> 2026-09-11, Reddit/HN/GitHub) found no fresh community evidence clearing its relevance floor.
>
> **Pipeline diagram:** `doc/diagrams/module-b-cpu-pipeline.excalidraw` (rendered PNG alongside)
> — scan → route → primary/fallback + voting → confidence gate → verify-default → structure →
> FHIR/ABDM, with the phase-2 VLM lane and constraints footer.

---

## 1. Scope being researched (confirmed in writing)

Module 2 = **Module B: document digitization** (doc/08 §2, doc/13). Inputs: printed +
handwritten prescriptions, lab tables, discharge summaries, Hindi/English + Indic scripts.
Two tasks: (1) reading (OCR), (2) structuring to NRCeS ABDM FHIR profiles. Offline-first,
DPDP/ABDM, no non-Indian cloud. This pass covers the **reading** models; structuring rides the
Module A llama.cpp/Qwen3 runtime class (doc/13 §3.3).

## 2. Comparison table (CPU evidence only)

"Maintainer" = paper authors or official docs/benchmark tables. "Community" = forum/issue
reports (weak tier). RAM ceiling = 12-16GB.

| Model / technique | Paper / source | CPU benchmark figures | License | Maintenance (verified) | Fits RAM? | Link |
|---|---|---|---|---|---|---|
| **PP-OCRv5 mobile (5M params)** | PaddleOCR 3.0 TR (arXiv:2507.05595); PP-OCRv5 paper (arXiv:2603.24373, CVPR 2026); official perf docs | **Maintainer:** Intel Xeon Gold 6271C, PaddlePaddle 3.0.0, 200 imgs incl. disk I/O: **1.75 s/img end-to-end, peak RAM 2,220MB** (v5_server: 4.34 s, 4,021MB; full OCR-default pipeline 3.79-3.97 s). OmniDocBench edit dist 0.067 (best specialized; EN 0.058) | Apache-2.0 | Very active (repo push 2026-07-22 per doc/13; CVPR-2026 paper 2026-03-25) | **Yes** | paddleocr.ai PP-OCRv5 perf docs; arxiv.org/abs/2507.05595 |
| **PP-OCRv6 (tiny 1.5M / small / medium 34.5M)** | PP-OCRv6 paper (arXiv:2606.13108, 2026-06-11) | **Maintainer:** Intel Xeon + OpenVINO 2025.0, end-to-end 200 imgs: **tiny 0.20 s/img (3.9x faster than PP-OCRv5_mobile 0.78 s); small 0.59 s; medium 1.40 s (5.2x vs v5_server 7.30 s)**. Accuracy: medium 83.2% rec / 86.2% det (in-house, beats Qwen3-VL-235B there) | Apache-2.0 (PaddleOCR repo) | Active (paper 2026-06; shipped in 3.7.0-era releases) | **Yes** | arxiv.org/abs/2606.13108 |
| **Tesseract 5** | OmniDocBench numbers via PP-OCRv5 paper; ICON-2024 study (aclanthology 2024.icon-1.48) | Accuracy: OmniDocBench ALL edit dist **0.324** (weakest specialized); ICON-2024: **Hindi 93%, English 92%** (best of 5 libs; that study's PaddleOCR-Hindi was 56% - old model caveat). Speed: no maintainer benchmark; community ~800 ms/page (NodeLoc forum 2026-06, weak tier) | Apache-2.0 | Active (push 2026-09-11 per doc/13); full Indic traineddata | **Yes** | aclanthology.org/2024.icon-1.48 |
| **RapidOCR (ONNX packaging of PP-OCR models)** | Repo + docs; docling discussion #2451; issue #514 | **No maintainer latency benchmark.** Community evidence CONFLICTS: forum claims 200 ms/page (old v0.0.7) vs issue #514 reproducible report: det stage 101-210 ms vs PaddleOCR's own ONNX path 30-59 ms on identical models (2-3x slower det). Docling v2.56 made RapidOCR its **default OCR engine** (maintainer signal) | Apache-2.0 | Active (multi-language bindings, PP-OCRv4/v5 models) | **Yes** | github.com/RapidAI/RapidOCR |
| **Docling standard pipeline (layout + TableFormer + OCR)** | Docling TR (arXiv:2408.09869v4, Dec 2024) | **Maintainer:** x86 CPU, 8 threads: **3.1 s/page end-to-end** (layout 633 ms/page; TableFormer 1.74 s/table; EasyOCR 13 s/page - then-default OCR). Comparison on same CPU: MinerU 3.3 s, Unstructured 4.2 s, Marker(2024) >16 s/page | Code MIT; models Apache-2.0 | Active (66.3K stars, doc/13); v2.56 default OCR now RapidOCR | **Yes** | arxiv.org/abs/2408.09869 |
| **PaddleOCR-VL / 1.5 / 1.6 (0.9B VLM)** | PaddleOCR-VL TR (arXiv:2510.14528); VL-1.5 TR (arXiv:2601.21957) | **No CPU latency published anywhere** (speed tables are A100: 1.43 pages/s FastDeploy). CPU paths are OFFICIAL: x64 CPU via PaddlePaddle / Transformers / **llama.cpp (merged PR #18825, 2026-02-19; official GGUFs on HF: PaddleOCR-VL-1.5-GGUF, -1.6-GGUF)**; GGUF accuracy parity verified (92.80% llama-server vs 92.86% vLLM on OmniDocBench v1.5). Community footprint: ~1-1.5GB at Q4_K_M. Accuracy: OmniDocBench v1.5 92.86 / 94.5; **element-level Devanagari edit dist 0.097, Tamil 0.043, Telugu 0.114** (best in table); handwritten EN 0.042; 109 langs | **Apache-2.0** (weights, HF tag - doc/13) | Very active; official GGUF releases 2026-01/02 | **Yes** (quantized) | arxiv.org/abs/2510.14528; huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF |
| **GraniteDocling-258M** | SmolDocling paper (arXiv:2503.11576, ICCV 2025); IBM announcement 2025-09-24; docling issues | GPU-only published figure (0.35 s/page A100). CPU: docling issue #2348 reports **15-20 min/document on CPU** (s390x - weak platform, but consistent with transformers-on-CPU); docling bench table: SmolDocling transformers 102.2 s/page on M3 Max **MPS**; GraniteDocling MLX ~8 s (Apple only). A third-party repo claims "5 pages/s on i7 CPU" - contradicts IBM's own A100 figure, discard. **English-only (ja/ar/zh experimental) - no Devanagari** | Apache-2.0 | Active (IBM, docling team); released 2025-09-17 | Yes (Q8_0 GGUF 178MB) but pointless for Hindi | huggingface.co/ibm-granite/granite-docling-258M |
| **surya 2 (650M VLM)** | Surya 2 release v0.20.0; repo README; HF model card | llama.cpp (CPU/Apple Silicon) is a **first-class, auto-selected backend**. Published throughput table is **Apple Silicon (llama.cpp/Metal) only: 0.108 pages/s, p50 59.3 s/page, 254 tok/s**. **No x86 CPU figures.** Community: pure-CPU forced on AMD APU = "very slow" (HF discussion); Windows llama-server crash reports. Accuracy: olmOCR-bench 83.3% (best <3B); 91-lang bench 87.2%; OmniDocBench (via PP-OCRv5 paper) 0.090 edit dist | Code Apache-2.0; **weights OpenRAIL-M** (HF tag `license:openrail` verified via HF API) - Datalab $5M commercial clause (doc/13) | Active (v0.20.0; repo now datalab-to/surya) | Yes (650M) | github.com/datalab-to/surya |
| **DeepSeek-OCR / OCR-2** | DeepSeek-OCR card; llama.cpp PRs #17400 (merged, commit a970515) + #20975 (2026-05-29); arXiv:2606.29213 | GPU-first (reference: CUDA+vLLM; 0.636 pages/s A100 per PaddleOCR-VL-1.5 TR comparison). llama.cpp GGUF support merged (initially CPU-backend-only Base mode). **No CPU benchmark.** **Indic killer fact:** independent Devanagari stress-test (arXiv:2606.29213, 300 real prints): median CER **100%**, catastrophic rate **89%**, chrF++ **10.4** (last of 10), repetition loops up to 71x reference length | MIT | Active (OCR-2 pushed 2026-02 per doc/13) | Unclear (3B-class MoE, bf16 GGUFs multi-GB) | github.com/ggml-org/llama.cpp/pull/17400 |
| **HunyuanOCR-1.5** | Paper arXiv:2607.04884; repo docs/llama_cpp.md | Official llama.cpp "CPU / consumer-GPU / laptop" deployment path (GGUF + llama-server guide). Speed figures are vLLM GPU (1.408 s/page with DFlash). **No CPU latency published** | **Tencent Hunyuan Community License** - territory-limited (not EU/UK/KR), AUP-bound, NOT OSI | Active (released 2026-07-07) | Unclear (~1-2B + draft) | github.com/Tencent-Hunyuan/HunyuanOCR |
| **Qwen3-VL-8B (general VLM, GGUF)** | arXiv:2606.29213 (accuracy); arXiv:2509.03615 (CPU cost) | Best OPEN model on real Devanagari prints (chrF++ 75.2, median CER 0.0 - but on A10G GPU). CPU reality (E-ARMOR, 8-core Xeon 8375C): Qwen-VL class = **69.4 s/image, 10.8 GiB RAM** | Apache-2.0 | Active | Borderline (10.8GiB observed) | arxiv.org/abs/2509.03615 |

**Runtimes checked:**
- **ONNX Runtime** - RapidOCR's default engine (CPU EP); docling v2.56's default OCR runs on it; PP-OCRv6 paper uses PaddleX ONNX backend for CPU det benchmarks. Verified CPU figures exist only for the classical lane.
- **OpenVINO** - source of the best current CPU numbers: PP-OCRv6 paper's Xeon+OpenVINO table (tiny 0.20 s/img); PaddleOCR 3.0 "high-performance inference" auto-selects OpenVINO on Intel CPU (TR §4.1); RapidOCR offers an OpenVINO backend (community: 30-40% speedup, docling discussion #2451); Intel white paper exists for PaddleOCR+OpenVINO.
- **llama.cpp (GGML)** - now runs PaddleOCR-VL (official GGUF, merged 2026-02-19), DeepSeek-OCR/-2 (merged), surya 2 (first-class), HunyuanOCR (official guide), GraniteDocling (Ollama + community GGUF). **No doc-VLM has maintainer-published x86-CPU latency.**
- **CTranslate2** - **not applicable**: supported model list is text-Transformers + Whisper (BART/BERT/Llama/Gemma/Qwen2-3/T5/Whisper...); no vision encoders, no doc-OCR conversions maintained (opennmt/CTranslate2 README + docs, v4.8.2).

## 3. Key findings

1. **The classical lane is the only lane with current, maintainer-published CPU evidence.**
   PP-OCRv5/v6 mobile-class models run 0.2-1.75 s/page on server Xeons with <=2.2GB peak RAM
   (PaddleOCR docs + PP-OCRv6 paper). E-ARMOR (arXiv:2509.03615), the only independent
   CPU-only OCR-vs-LVLM benchmark paper found, reaches the same conclusion empirically:
   optimized traditional pipeline 4.36 s/img and 0.89 GiB on an 8-core Xeon vs 69.4 s and
   10.8 GiB for a Qwen-VL-class LVLM - "traditional wins on CPU".
2. **The VLM lane has official CPU *paths* but zero published CPU *latency*.** PaddleOCR-VL
   (Apache-2.0) now ships official GGUFs + merged llama.cpp support with verified accuracy
   parity, and is alone in publishing Devanagari/Tamil/Telugu element metrics (edit dist
   0.097/0.043/0.114) - but its own docs warn CPU inference "may be slow" and publish no
   number. Every other doc-VLM is the same or worse (see flags).
3. **Indic accuracy does not follow English/Chinese leaderboards.** The independent
   Devanagari stress-test (arXiv:2606.29213) shows the specialized OCR-VLMs collapsing on
   real Hindi prints - DeepSeek-OCR median CER 100% with 89% catastrophic repetition loops;
   olmOCR-7B chrF++ 40.5 - while Qwen3-VL-8B (75.2) trails only closed frontier models.
   PaddleOCR and GOT-OCR could not even be evaluated there (env failures). Any MediKiosk VLM
   pick MUST be validated on local real-Indic scans (doc/07's standing item; now reinforced).
4. **A 2024 academic study (ICON) found Tesseract beats old PaddleOCR multilingual on Hindi**
   (93% vs 56%) - Tesseract remains the credible CPU floor for Devanagari printed text, while
   being the weakest on the general OmniDocBench (0.324 edit dist). The PP-OCRv5-multilingual
   rec model (2M params, Devanagari/Tamil/Telugu per doc/13) postdates that study; its Hindi
   accuracy on real scans is unmeasured anywhere public.
5. **PP-OCRv6 (June 2026) changes the classical-lane math**: tiny (1.5M params) is 3.9x
   faster than PP-OCRv5_mobile on Xeon+OpenVINO with comparable accuracy - but the paper's
   CPU tables cover the zh/en/ja + Latin unified models; the Devanagari-capable multilingual
   rec model has no dedicated CPU table.
6. **GPU-first models with no CPU benchmark (disqualified/unproven per project constraint):**
   DeepSeek-OCR(-2) (also Indic-fatal per finding 3), dots.ocr (MIT-tagged, 3.0B params,
   vLLM-only; card also ships a separate "dots.ocr LICENSE AGREEMENT" file - verify),
   MonkeyOCR, MinerU2.5, olmOCR-7B, Unlimited-OCR, GLM-OCR, SmolDocling/GraniteDocling
   (CPU-runnable but minutes-per-page and English-only).
7. **Outdated-numbers flags:** PP-OCRv3 CPU table (2022, Xeon Gold 6148 + MKLDNN) predates
   current models; Docling TR's tool comparison (Dec 2024) rates Marker >16 s/page on x86 CPU
   - that was pre-Surya-2 marker and has since been rewritten (v0.20 uses a 650M VLM);
   E-ARMOR's winning system (Sprinklr-Edge-OCR) is proprietary - evidence, not an adoptable
   candidate; ICON-2024's PaddleOCR-Hindi 56% predates PP-OCRv5/v6 multilingual.
8. **License flags:** surya-ocr-2 weights = OpenRAIL-M with Datalab's <$5M-revenue free tier
   (procurement risk, doc/07 item); HunyuanOCR = Tencent community license (territorial,
   AUP); both need a conscious decision before any hospital product. PaddleOCR /
   PaddleOCR-VL / Tesseract / RapidOCR / docling models are Apache-2.0/MIT clean.

## 4. Strongest candidates by evidence quality (not a decision)

1. **PP-OCRv5-mobile / PP-OCRv6-tiny-small classical lane (Apache-2.0)** - only candidates
   with current maintainer-published CPU latency + RAM tables; trivially inside 12-16GB.
   Open risk: CPU tables are zh/en/ja variants; Devanagari-capable multilingual rec model
   unmeasured on CPU.
2. **PaddleOCR-VL-0.9B GGUF via llama.cpp (Apache-2.0)** - official GGUF + merged llama.cpp
   support + verified accuracy parity + the only published Devanagari element metrics;
   ~1-1.5GB quantized. Open risk: no CPU latency figure exists - maintainer hints "slow".
3. **Tesseract + RapidOCR as floor/packaging (Apache-2.0)** - CPU-native, full Indic
   traineddata, independently replicated Hindi accuracy; weakest general accuracy and no
   maintainer speed benchmark; RapidOCR's own speed evidence is conflicting.

### 4a. PICK (2026-09-11, per user directive - logged in decisions/06-decisions-log.md)

- **Primary: PP-OCRv5-mobile multilingual** (mobile det + Devanagari-capable multilingual
  rec, 2M params), packaged via RapidOCR/ONNX Runtime CPU; OpenVINO backend A/B-tested.
- **Fallback: Tesseract 5 `hin+eng`.**
- PaddleOCR-VL-1.6-GGUF is explicitly NOT the fallback (no published CPU latency - unproven
  under the CPU-only constraint); it remains the **phase-2 upgrade** for the router's
  hard-page minority, gated on passing the §5 benchmark's dwell-time budget. Handwriting
  stays verify-default per doc/13 §2.1.
- Upgrade note: when PP-OCRv6 ships multilingual (Devanagari) rec variants, v6-tiny/small
  supersede v5-mobile on speed (0.20-0.59 s/img on Xeon+OpenVINO) - revisit then.

## 5. The benchmark that would actually decide it

On the kiosk-equivalent CPU (the real 12-16GB machine, threads pinned to physical cores),
over the local eval set (consented real OPD scans, Hindi+English, mixed print/handwriting -
doc/07's gating item), measure **p50/p95 per-page latency, peak RSS, and field-level accuracy
(CER per field + catastrophic-rate per arXiv:2606.29213's methodology, NOT page-similarity
per RealDocBench)** for:

1. Tesseract `hin+eng` (baseline floor)
2. RapidOCR PP-OCRv5-multilingual ONNX (onnxruntime-cpu AND openvino backends)
3. PaddleOCR PP-OCRv6_tiny + PP-OCRv6_small (+ multilingual rec swap)
4. PaddleOCR-VL-1.6-GGUF Q4_K_M and Q8_0 via llama-server (element-crop mode + full pipeline)
5. (optional, license-pending) surya 2 via llama.cpp CPU

Decision rule (for the team): the VLM lane is admissible only if its p95 page latency fits
the kiosk dwell-time budget on the router's hard-minority share of pages; otherwise classical
+ verify-flag carries handwriting, which doc/13 §5's evidence already supports.

## 6. Source register (fetched 2026-09-11)

- arXiv: 2206.03001 (PP-OCRv3), 2507.05595 (PaddleOCR 3.0 TR), 2603.24373 (PP-OCRv5, CVPR
  2026 + supplemental CPU tables), 2606.13108 (PP-OCRv6), 2408.09869v4 (Docling TR),
  2503.11576 (SmolDocling, ICCV 2025), 2510.14528 (PaddleOCR-VL), 2601.21957 (VL-1.5),
  2607.04884 (HunyuanOCR-1.5), 2509.03615 (E-ARMOR), 2606.29213 (Devanagari stress-test),
  2603.23511 (DISCO - carried from doc/13).
- PaddleOCR docs: PP-OCRv5 inference-performance reference (paddleocr.ai), PaddleOCR-VL
  usage tutorial + hardware-support matrix, FAQ discussion #16822.
- GitHub: ggml-org/llama.cpp PR #18825 (PaddleOCR-VL, merged 2026-02-19), #17400
  (DeepSeek-OCR, merged), #20975 (DeepSeek-OCR-2); datalab-to/surya README + v0.20.0
  release; RapidAI/RapidOCR + issue #514; docling discussions #2451, #2348; opennmt/CTranslate2.
- HuggingFace API: datalab-to/surya-ocr-2 (`license:openrail`, 686M BF16, 2026-05-27);
  dots-studio/dots.ocr (MIT tag, 3.04B, 2025-10-31); PaddlePaddle/PaddleOCR-VL-1.5-GGUF +
  1.6-GGUF; danchev/ibm-granite-docling-258M-GGUF.
- IBM: Granite-Docling announcement (2025-09-24), granite-docling-258M card, Ollama listing.
- Community (weak tier, labeled): NodeLoc OCR comparison (2026-06-25), InsiderLLM
  PaddleOCR-VL guide (2026-02-20), felipemeres/granite-docling-implementation (contradicted,
  discarded).
