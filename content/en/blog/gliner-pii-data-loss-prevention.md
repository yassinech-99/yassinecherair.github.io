---
title: "PII detection that actually understands context: NVIDIA GLiNER-PII"
date: 2026-05-30
description: "Traditional DLP fails on unstructured text. Here's how a 570M-parameter span-scoring transformer handles what regex can't — architecture, fine-tuning, benchmarks, and a live demo."
tags: ["ai", "security", "dlp", "pii", "nvidia", "nlp"]
draft: false
---

## The DLP problem nobody talks about

Most organizations have *some* form of data loss prevention. A credit card number in an email gets flagged. An SSN in a database field triggers an alert. These work because the data is structured — there's a known format, a known location, and often a checksum you can validate against.

The Luhn algorithm catches `4111 1111 1111 1111`. A regex like `\d{3}-\d{2}-\d{4}` catches US Social Security Numbers in clean text. A network DLP appliance doing deep packet inspection will intercept these on the wire before they leave the perimeter.

Then someone pastes a clinical note into a ticketing system:

> *"Patient Jordan Wells, DOB 04/14/1979, was admitted for follow-up on record #MR-88421. Contact via (202) 555-0193 or j.wells@outlook.com. Insurance: Anthem BCBS, member 901-224-3311."*

No field labels. No consistent formatting. Multiple entity types interleaved with prose. A regex scanner will catch the phone number and email if the patterns match, miss the medical record number (non-standard prefix), and have no idea that "Jordan Wells" is a name rather than a company, a street, or a product.

This is the gap traditional DLP was never designed to close.

---

## Why rule-based systems fail at scale

### Context blindness

`"Call extension 4567"` and `"(555) 123-4567"` both match a loose phone regex. Only context — the surrounding sentence structure, the presence of an area code, the word "extension" — tells them apart. Regex has no context model.

The same problem applies to names. "Wells" is a surname, a city in Somerset, a financial institution, and a plural noun. Without understanding the sentence, a keyword list either flags everything or nothing.

### The international format problem

US SSN: `\d{3}-\d{2}-\d{4}`. French NIR: `[12]\d{2}(0[1-9]|1[0-2]|20)\d{2}[0-9AB]\d{3}\d{2}`. German Steueridentifikationsnummer: eleven digits with a specific check algorithm. UK National Insurance: `[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]`. Each jurisdiction, each document type, each vendor data format adds a new pattern to maintain. At enterprise scale this becomes hundreds of regex rules in a config file that someone updates manually after incidents.

### The false positive problem

High recall (catch everything) means high false positives. Security teams learn to ignore alerts. Low false positives mean tuning the rules until they miss real incidents. There is no threshold where a regex rule is both precise and complete for unstructured text — the problem isn't the threshold, it's that the underlying approach doesn't model language.

### What network DLP misses

DLP at the wire catches exfiltration in transit. It does nothing about data already in a document repository, a support ticket, an LLM training corpus, or a code review comment. The majority of PII exposure incidents involve data at rest or data in use, not data in motion.

---

## Why LLMs are not the answer either

GPT-4 with a prompt can extract PII from a document. In practice:

- **Non-determinism**: run the same text twice and get different entity offsets. Unacceptable for audit logging.
- **Cost at scan volume**: a SIEM ingesting millions of log lines per day cannot send each one to an LLM API at $0.01/1k tokens.
- **Data leaves your perimeter**: calling an external API with the exact data you're trying to protect is a contradiction in a HIPAA or GDPR context.
- **Latency**: a generative model processes tokens sequentially. A 512-token document takes hundreds of milliseconds. Inline scanning at ingestion speed is not viable.
- **No structured output guarantee**: the model may return entities as prose, as JSON, or hallucinate entities that aren't in the text.

The right tool is something that behaves more like a classifier than a generator — fast, deterministic, structured output, no data sent to an external service if run locally.

---

## GLiNER: the architecture

GLiNER (Generalist Model for Named Entity Recognition using Bidirectional Transformer) was published in [arxiv:2311.08526](https://arxiv.org/abs/2311.08526) by researchers from Paris-Nord University. The core idea: decouple the entity type set from the model weights.

Traditional NER models like spaCy's `en_core_web_trf` have a fixed output layer — one neuron per entity class, trained and frozen. To add a new class you retrain. GLiNER's output is a **score for each (span, label) pair**, where both the span and the label are encoded by the same transformer.

### How scoring works

The model encodes the full input text with a **bidirectional transformer encoder** (BERT-style, not causal). This produces a contextual embedding for every token — "Wells" in `"patient Jordan Wells"` gets a different embedding than "Wells" in `"Wells Fargo account"`.

The label strings (`"name"`, `"account_number"`, `"swift_bic"`) are also passed through the same encoder as short sequences.

For each candidate text span and each label, the model computes a dot-product similarity score between the span's pooled representation and the label's representation. Spans where the score exceeds `threshold` are returned as entities.

```
Input: "His account 90012234 (Swift: WFBIUS6S) was flagged at 09:42 AM."
Labels: ["account_number", "swift_bic", "time"]

→ span "90012234"   × "account_number"  → score 0.94  ✓
→ span "WFBIUS6S"   × "swift_bic"       → score 0.97  ✓
→ span "09:42 AM"   × "time"            → score 0.91  ✓
```

**No text is generated.** The output is purely a list of `{start, end, text, label, score}` tuples. This makes it deterministic, auditable, and fast.

### Open-vocabulary NER

Because the label is encoded as text at inference time, you can ask the model to find any entity type without retraining. Pass `"vehicle_identifier"` and it will look for license plates, VINs, and vehicle IDs — not because that specific string was in the training data, but because the model learned to match semantic similarity between span context and label meaning.

### Nested entity detection

With `flat_ner: false`, overlapping spans are allowed. A document containing `"Dr. Jordan Wells, 2901 Connecticut Ave NW, Washington DC 20008"` can simultaneously yield:

- `name`: "Jordan Wells"
- `address`: "2901 Connecticut Ave NW, Washington DC 20008"
- `city`: "Washington"
- `postcode`: "20008"

All from the same text, none conflicting.

---

## NVIDIA GLiNER-PII: the fine-tune

NVIDIA fine-tuned the GLiNER base (`urchade/gliner_large-v2.1`) into a PII-specific model. The result is [`nvidia/gliner-PII`](https://huggingface.co/nvidia/gliner-PII), released October 2025 on HuggingFace and served via NVIDIA NIM since March 2026.

### Architecture

- **Base**: `urchade/gliner_large-v2.1` / `knowledgator/gliner-bi-large-v1.0`
- **Architecture type**: Transformer, bidirectional encoder
- **Parameters**: 570 million (5.7 × 10⁸)
- **Runtime**: PyTorch, GLiNER Python library
- **Hardware**: NVIDIA Ampere through Blackwell; also runs on CPU (x86_64)

### Training data: Nemotron-PII

Training a PII detection model on real PII is self-defeating — you'd be handling the very data you're trying to protect. NVIDIA solved this with [`nvidia/Nemotron-PII`](https://huggingface.co/datasets/nvidia/nemotron-pii): a fully synthetic dataset generated with NVIDIA NeMo Data Designer.

- **Size**: ~100,000 records, under 1 billion tokens
- **Method**: persona-grounded generation. Personas were derived from US Census demographic distributions, not invented at random. This matters: a model trained on `"John Doe at 123 Main Street"` will miss real-world name distributions. A model trained on realistically diverse names, addresses, and identifiers generalizes to actual documents.
- **Coverage**: 50+ industries, 55+ entity types, US and international formats
- **Labeling**: automatic — spans were injected at generation time, eliminating human annotator contact with sensitive data

### Entity categories

The 55+ supported types group into six domains:

**Identity** — `name`, `first_name`, `last_name`, `ssn`, `national_id`, `tax_id`, `date_of_birth`, `age`, `gender`, `employee_id`, `customer_id`, `certificate_license_number`

**Financial** — `account_number`, `credit_debit_card`, `cvv`, `pin`, `bank_routing_number`, `swift_bic`, `iban`

**Medical** — `medical_record_number`, `health_plan_beneficiary_number`, `blood_type`, `biometric_identifier`

**Location** — `address`, `street_address`, `city`, `state`, `postcode`, `country`, `latitude`, `longitude`, `coordinate`

**Contact** — `email`, `phone_number`, `fax_number`, `url`

**Network / Device** — `ipv4`, `ipv6`, `mac_address`, `api_key`, `user_name`, `password`, `http_cookie`, `device_identifier`, `vehicle_identifier`, `license_plate`

**Demographic / Other** — `occupation`, `company_name`, `language`, `education_level`, `employment_status`, `political_view`, `race_ethnicity`, `religious_belief`, `sexuality`, `date`, `date_time`, `time`, `unique_identifier`

### Benchmarks

Evaluated at `threshold=0.3` (strict F1 — both entity text and label must match exactly):

| Benchmark | V1 | V2 (current) | Δ |
|---|---|---|---|
| Argilla PII | 0.64 | **0.70** | +0.06 |
| AI4Privacy | 0.60 | **0.64** | +0.04 |
| nvidia/Nemotron-PII | 0.66 | **0.87** | +0.21 |

The three evaluation sets (Argilla, AI4Privacy, Gretel PII V1/V2) use hybrid human+automated labeling — intentionally different from the synthetic training data to test real-world generalization. The +0.21 jump on the NVIDIA dataset between versions reflects both better training coverage and improved label-to-span alignment in V2.

Evaluation hardware: NVIDIA A100 (Ampere, PCIe/SXM).

---

## The API

NVIDIA NIM exposes GLiNER-PII through an OpenAI-compatible endpoint with additional parameters:

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

const completion = await openai.chat.completions.create({
  model: "nvidia/gliner-pii",
  messages: [{
    role: "user",
    content: "Dr. Jordan Wells, DOB 04/14/1979, MRN MR-88421. Contact: (202) 555-0193"
  }],

  // GLiNER-specific parameters:
  labels: ["name", "date_of_birth", "medical_record_number", "phone_number"],
  threshold: 0.5,      // 0–1. Lower = more recall, more false positives. Tune per use case.
  chunk_length: 384,   // token window for long documents
  overlap: 128,        // overlap between chunks — prevents entities split at boundaries
  flat_ner: false,     // allow nested spans
});

const result = JSON.parse(completion.choices[0].message.content);
// result.entities  → [{text, label, start, end, score}, ...]
// result.tagged_text → original text with entity markers
```

**`chunk_length` and `overlap`** matter for anything beyond a paragraph. A ten-page contract tokenizes to roughly 4,000 tokens. The model processes it as overlapping 384-token windows; the 128-token overlap prevents an entity that straddles a chunk boundary from being missed by both chunks.

**`threshold`** is a business-level decision. For HIPAA audit logging you want high recall — set it low (0.3) and accept more false positives for human review. For automated inline redaction you want high precision — raise it to 0.7+ and let borderline cases pass through to a secondary review queue.

---

## Demo

The recording below shows a Python script calling `nvidia/gliner-pii` via the NIM API against a banking record with eight PII entities. Entities are printed with confidence scores and a reconstructed tagged-text output.

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/asciinema-player@3.8.0/dist/bundle/asciinema-player.min.css">
<div id="gliner-cast" style="margin: 1.5rem 0;"></div>
<script src="https://cdn.jsdelivr.net/npm/asciinema-player@3.8.0/dist/bundle/asciinema-player.min.js"></script>
<script>
AsciinemaPlayer.create('/casts/gliner-pii-demo.cast', document.getElementById('gliner-cast'), {
  cols: 100,
  rows: 32,
  theme: 'monokai',
  autoPlay: false,
  loop: true,
  fit: 'width',
  poster: 'npt:5',
  terminalFontFamily: 'JetBrains Mono, ui-monospace, monospace',
});
</script>

To run this yourself: get a [free NIM API key](https://build.nvidia.com/nvidia/gliner-pii), install `openai` (`pip install openai`), and swap in your key.

---

## Where GLiNER-PII fits — and what it doesn't replace

GLiNER-PII is a detection component. It has no policy engine, no network interception layer, no storage classification system, and no alerting pipeline. What it provides is a reliable answer to: *"does this text contain sensitive entities, and where?"*

Plugged into a pipeline it looks like:

```
Document ingestion
  → chunk (384 tokens, 128 overlap)
  → GLiNER-PII (labels: your required categories, threshold: tuned per use case)
  → decision: redact / tag / alert / pass
  → audit log (entity type, offset, document ID, score — not the entity value itself)
```

**On threshold tuning**: NVIDIA evaluated the model at `threshold=0.3`. The default in the NIM API is `0.5`. Neither is universally correct. For HIPAA audit logging in healthcare, you want to catch everything — set the threshold low and route borderline detections to a human review queue. For automated inline redaction of customer support tickets, you want high precision — a false positive that redacts a legitimate part number frustrates engineers. The model is the same either way; the threshold is an operational parameter.

**On running it locally**: the GLiNER Python library (`pip install gliner`) lets you run `nvidia/gliner-PII` entirely on your own hardware with `GLiNER.from_pretrained("nvidia/gliner-pii")`. The data never leaves your perimeter. For GDPR or HIPAA contexts this matters more than the latency difference.

**On human review**: NVIDIA's own model card states it directly — *"performance varies by domain, format, and threshold, so validation and human review are recommended for high-stakes deployments."* A strict F1 of 0.70 on Argilla PII means 30% of entities in that benchmark were either missed or mislabeled. In a medical records context that is not an acceptable autonomous redaction rate; it is, however, an excellent triage signal for a human reviewer to work from.

---

*Model card: [HuggingFace](https://huggingface.co/nvidia/gliner-PII) · [NVIDIA NIM](https://docs.api.nvidia.com/nim/reference/nvidia-gliner-pii) · GLiNER paper: [arxiv:2311.08526](https://arxiv.org/abs/2311.08526)*
