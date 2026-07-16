#!/usr/bin/env python3
"""Generate complete ignored translation candidates with one local NLLB load.

The TypeScript orchestrator owns source enumeration, strict bundle validation,
quarantine, and curated promotion. This worker is deliberately offline and
writes one complete candidate atomically only after every field is generated.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
import re
import select
import stat
import subprocess
import sys
import unicodedata
import uuid
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any, NamedTuple, Optional

PIPELINE_VERSION = "inspir-long-tail-local-nllb-v5"
EXECUTION_PROFILE_MATERIAL: dict[str, Any] = {
    "schemaVersion": 2,
    "kind": "inspir-long-tail-local-nllb-execution-profile-v2",
    "pipelineVersion": PIPELINE_VERSION,
    "environment": {
        "MKL_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "PYTORCH_ENABLE_MPS_FALLBACK": "0",
        "VECLIB_MAXIMUM_THREADS": "1",
    },
    "torch": {
        "interopThreads": 1,
        "intraopThreads": 1,
    },
    "terminalRescue": {
        "device": "cpu",
        "dtype": "float32",
        "independentDecodes": 2,
        "deterministicAlgorithms": True,
    },
}
EXECUTION_PROFILE_SHA256 = hashlib.sha256(
    json.dumps(
        EXECUTION_PROFILE_MATERIAL,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")
).hexdigest()
EXECUTION_PROFILE: dict[str, Any] = {
    **EXECUTION_PROFILE_MATERIAL,
    "executionProfileSha256": EXECUTION_PROFILE_SHA256,
}

for _environment_name, _environment_value in EXECUTION_PROFILE["environment"].items():
    os.environ[_environment_name] = _environment_value
os.environ["HF_DATASETS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import torch


def assert_runtime_execution_profile() -> None:
    observed_environment = {
        name: os.environ.get(name) for name in EXECUTION_PROFILE["environment"]
    }
    observed_threads = {
        "interopThreads": int(torch.get_num_interop_threads()),
        "intraopThreads": int(torch.get_num_threads()),
    }
    if (
        observed_environment != EXECUTION_PROFILE["environment"]
        or observed_threads != EXECUTION_PROFILE["torch"]
    ):
        raise RuntimeError(
            "Local NLLB execution environment or torch thread profile drifted"
        )


torch.set_num_threads(EXECUTION_PROFILE["torch"]["intraopThreads"])
torch.set_num_interop_threads(EXECUTION_PROFILE["torch"]["interopThreads"])
assert_runtime_execution_profile()


from transformers import (
    AutoModelForSeq2SeqLM,
    AutoTokenizer,
    LogitsProcessor,
    LogitsProcessorList,
)


MASTER_KIND = "inspir-long-tail-translation-worklist-v1"
GENERATION_OVERRIDES_KIND = "inspir-long-tail-generation-overrides-v1"
PACK_KIND = "inspir-long-tail-translation-pack-worklist-v1"
CANDIDATE_KIND = "inspir-long-tail-translation-candidate-v1"
VALIDATOR_POLICY_KIND = "inspir-long-tail-validator-policy-v1"
VALIDATOR_POLICY_RELATIVE_PATHS = (
    "lib/content/languages.ts",
    "lib/i18n/translation-candidate-quality.ts",
    "lib/i18n/translation-field-validation.ts",
    "lib/i18n/translation-quality.ts",
    "lib/i18n/translation-types.ts",
    "lib/i18n/translation-validation.ts",
    "scripts/translation-validator-policy-provenance.ts",
)
MODEL_FILES = (
    "config.json",
    "generation_config.json",
    "pytorch_model.bin",
    "sentencepiece.bpe.model",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
)
LONG_SEGMENT_LIMIT = 320
SENTENCE_OR_CLAUSE_GAP = re.compile(
    r"\n+|(?<=[.!?…])\s+(?=[A-Z0-9“\"'([{])|"
    r"(?<=[,;:])\s+|"
    r"\s+(?=(?:To|For|In|When|If|Unless|Because|However|Additionally|"
    r"including|unless|and|or|but|which|that)\b)"
)
ASCII_LETTER = re.compile(r"[A-Za-z]")
ASCII_WORD = re.compile(r"[A-Za-z][A-Za-z'-]*")
STRUCTURED_CITATION_CONTEXT = re.compile(
    r"^[\s()[\].,;:/\\-]*\([A-Za-z]\)[\s()[\].,;:/\\-]*$"
)
STRUCTURAL_RETRY_DELIMITER = re.compile(r"[()[\]]")
QUOTED_TEXT = re.compile(r'“([^”\n]+)”|"([^"\n]+)"')
QUOTED_ALIAS_PART = re.compile(
    r'^([“"])([A-Za-z][A-Za-z\'’\-]*)([”"])(.*)$',
    re.DOTALL,
)
RETRY_WORD = re.compile(r"[^\W_]+(?:['’\-][^\W_]+)*", re.UNICODE)
LEGAL_QUOTED_ALIAS_SET = frozenset({"we", "us", "our"})
SOURCE_NEGATION = re.compile(
    r"\b(?:not|no|never|without|neither|nor|none|nothing|nobody|nowhere|"
    r"cannot|unable|can['’]t|don['’]t|doesn['’]t|didn['’]t|won['’]t|"
    r"isn['’]t|aren['’]t|wasn['’]t|weren['’]t|shouldn['’]t|wouldn['’]t|"
    r"couldn['’]t|mustn['’]t|haven['’]t|hasn['’]t|hadn['’]t)\b",
    re.IGNORECASE,
)
SHA256 = re.compile(r"^[a-f0-9]{64}$")
MAXIMUM_JSON_BYTES = 64 * 1024 * 1024
MAXIMUM_MASTER_WORKLIST_BYTES = 160 * 1024 * 1024
MAXIMUM_ASSIGNED_LANGUAGES = 128
MAXIMUM_VALIDATION_FAILURE_REASON_KINDS = 32
MAXIMUM_VALIDATION_FAILURE_SAMPLES = 8
MAXIMUM_EMPTY_OUTPUT_DIAGNOSTICS = 16
MAXIMUM_TERMINAL_RESCUE_SOURCES = 64
MAXIMUM_GENERATION_OVERRIDES = 64
CURRENT_GENERATION_OVERRIDE_ENTRIES = 10
CURRENT_GENERATION_OVERRIDE_BINDING_SHA256 = (
    "3f8cfb3438f54bad2676a5869a60948989c7313a9bbd4634e2a6e409dadb55c5"
)
CURRENT_GENERATION_OVERRIDE_VALUE_SHA256_BY_SOURCE = {
    "8e227ba67e984856c878dc5209abe51751c834ad4f5742239e4f482175aef2a3":
        "a12cb2b04be6637fc9c542ed89816dcbc47f2073fed7cd425f3fcd2e54ceec06",
    "f20e1ae1b0659633731779b7e2a20b3f586d09b582c1f57160905cd6618e0e17":
        "7b52389138278c3b190e4caa1d23760c69d123efa9234bf0fbe519ad753bbaa3",
    "f29c6dd11a9cb5a2e3134f68923ee2bf46dfb03233002dc2eee1a05088a51396":
        "3b0c87fb7a637bbbfb48341a5b5935e4191bfebec04f145e6bab130134be89d0",
    "f2dd0879eda2a2159b958b34e01896ce68879c683a7ecb35f3044d2e4774f19e":
        "90a1781478c0fadd3476793b039670812152c68d9683a3ca29400594640368b6",
    "f5ba6c92e3394f99029e39962d75cd0f6c29beb36ee00ad7391548a9a912d847":
        "f10534aa4fa724db16086e1f6ecc01eb780be4ab212c9e6b944b20b49a471fb6",
    "f6cea7a517ad59034fc3154fe4d97f83a1923390b1ead3fd12414f5b20618645":
        "6ff166c64e9b29c9767206ee17b6559b42ea08dc37675082245a2e3f654b12f4",
    "fb14c9272c033b45dbc06016367bf68d312a4d0f8de61b5991f383c26084aaf7":
        "1d68db3fd21cd5277401fb2e0271357787ec9262656882df18a04b67db7a950e",
    "fbb48c0f62b2d0866c8618a1a2eef5b6f11d7999518bacf20abe638c0ade274f":
        "6bab86f06e71bf38fd79dd1021f99c462bdf5742c9c02f892c12077ff8f1439f",
    "fc6bff84341dbb08437a1ec23f662a8064b07d38c23097a29216b1b2883bee79":
        "63f0fccf816c452e43451d8a3d422f637e215afe88cc38a047bba635b29830f9",
    "fc7e2f06c58930f1e58c65b27d7fff131d5badddd5e91bf72edc35b238bf3820":
        "24de7171c86b64dbc662be2e6104e345d5f3947f6b97eb80a2d2d46dc8efc681",
}
CURRENT_GENERATION_OVERRIDE_SOURCE_SHA256S = frozenset(
    CURRENT_GENERATION_OVERRIDE_VALUE_SHA256_BY_SOURCE
)
TERMINAL_RESCUE_EVIDENCE_KIND = (
    "inspir-long-tail-terminal-cpu-rescue-evidence-v2"
)
TERMINAL_RESCUE_CONFIGURED_DECODES = 2
PRIMARY_MANUAL_SEED = 0
RETRY_PRESERVED_WORDS = frozenset(
    {
        "ai",
        "api",
        "apis",
        "chatgpt",
        "cloudflare",
        "css",
        "dall-e",
        "eslams",
        "github",
        "google",
        "html",
        "inspir",
        "javascript",
        "nllb",
        "openai",
        "pdf",
        "seo",
        "typescript",
        "url",
        "urls",
    }
)
OPAQUE_LITERAL_MARKER = re.compile(r"\{inspir_literal[a-z]*_[a-z]+\}")
PLACEHOLDER = re.compile(r"\{[a-zA-Z0-9_]+\}")
BOUNDARY_SENSITIVE_LITERAL = re.compile(
    r"^(?:https?://|mailto:|tel:|/).+|"
    r"^[\w.+-]+@[\w.-]+\.[a-z]{2,}$|"
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}$",
    re.IGNORECASE,
)
HARD_RETRY_FAILURE_REASONS = frozenset(
    {
        "bundle-invalid",
        "email-parity",
        "empty",
        "excessive-length",
        "field-invalid",
        "invariant-parity",
        "non-nfc",
        "number-parity",
        "placeholder-parity",
        "protected-literal-parity",
        "repeated-sequence",
        "source-equality",
        "url-parity",
    }
)
SEMANTIC_RETRY_FAILURE_REASONS = frozenset({"negation-marker-missing"})
FLUENCY_RETRY_FAILURE_REASONS = frozenset({"field-fluency"})
RETRY_DECODE_PROFILES = {
    # Balanced/coverage deliberately retain shared target-language vocabulary;
    # unchanged TypeScript validation remains the source-copy authority.
    "balanced": (4, 1.0, None),
    "wide": (8, 0.9, 4),
    "coverage": (8, 1.1, None),
}
EMPTY_OUTPUT_RECOVERY_PROFILES = ("balanced", "coverage", "wide")
EMPTY_OUTPUT_CASE_NORMALIZED_PROFILE = "balanced"
AUDITED_EMPTY_OUTPUT_SOURCE_NORMALIZATIONS = {
    (
        "als_Latn",
        "2686fb9824c8f903de98952cb8f5a6626b3894a547cb35803aa985b202f7388d",
    ): ("STATUTES,", "Statutes,"),
}


class BlockGeneratedNumericTokens(LogitsProcessor):
    """Numbers are source literals, so decoder-produced digits are invalid."""

    def __init__(self, token_ids: list[int]):
        self.token_ids = token_ids

    def __call__(self, input_ids: Any, scores: Any) -> Any:
        del input_ids
        if self.token_ids:
            scores[:, self.token_ids] = -torch.inf
        return scores


class RetryCandidateValidation(NamedTuple):
    failures: Counter[str]
    fluency_reasons: frozenset[str]


class TerminalRescueResult(NamedTuple):
    source_values: dict[tuple[str, str], str]
    source_set_sha256: str
    output_map_sha256: str
    replica_output_map_sha256s: tuple[str, str]
    rescued_sources: int
    retried_segments: int
    attempted_replicas: int
    completed_replicas: int


class TerminalRescueFailed(RuntimeError):
    """A terminal CPU rescue failed without authorizing partial adoption."""

    ALLOWED_DETAILS = {
        (
            "configuration-invalid",
            "preflight",
            "execution-profile-mismatch",
        ),
        (
            "configuration-invalid",
            "preflight",
            "primary-device-not-mps",
        ),
        (
            "configuration-invalid",
            "replica-aggregation",
            "replica-count-mismatch",
        ),
        (
            "determinism-unavailable",
            "determinism-setup",
            "thread-count-mismatch",
        ),
        (
            "determinism-unavailable",
            "determinism-setup",
            "algorithm-enable-failed",
        ),
        (
            "determinism-unavailable",
            "determinism-restore",
            "algorithm-restore-failed",
        ),
        (
            "exact-source-scope-invalid",
            "scope-validation",
            "source-count-out-of-bounds",
        ),
        (
            "exact-source-scope-invalid",
            "scope-validation",
            "source-entry-integrity-failed",
        ),
        (
            "exact-source-scope-invalid",
            "scope-validation",
            "source-memory-mismatch",
        ),
        (
            "exact-source-scope-invalid",
            "scope-validation",
            "duplicate-source-collision",
        ),
        (
            "model-load-or-generation-failed",
            "replica-model-load",
            "model-load-error",
        ),
        (
            "model-load-or-generation-failed",
            "replica-generation",
            "generation-error",
        ),
        (
            "model-load-or-generation-failed",
            "replica-validation",
            "validation-error",
        ),
        (
            "model-load-or-generation-failed",
            "replica-execution",
            "unexpected-error",
        ),
        (
            "replica-invalid",
            "replica-generation",
            "retry-source-count-mismatch",
        ),
        (
            "replica-invalid",
            "replica-generation",
            "no-strict-improvement",
        ),
        (
            "replica-invalid",
            "replica-validation",
            "post-generation-validation-failed",
        ),
        (
            "replica-invalid",
            "replica-output-map",
            "missing-source-output",
        ),
        (
            "replica-mismatch",
            "replica-comparison",
            "output-map-mismatch",
        ),
    }

    def __init__(
        self,
        reason: str,
        cause: BaseException | None = None,
        *,
        stage: str,
        subtype: str,
        attempted_replicas: int = 0,
        completed_replicas: int = 0,
        failing_replica_index: int | None = None,
    ) -> None:
        if (reason, stage, subtype) not in self.ALLOWED_DETAILS:
            raise RuntimeError("Terminal rescue failure detail is unsupported")
        self.reason = reason
        self.stage = stage
        self.subtype = subtype
        self.cause_type = type(cause).__name__ if cause is not None else None
        self.cause_message_sha256 = (
            hashlib.sha256(str(cause).encode("utf-8")).hexdigest()
            if cause is not None
            else None
        )
        self.bind_replica_progress(
            attempted_replicas,
            completed_replicas,
            failing_replica_index,
        )
        super().__init__(f"Terminal CPU rescue failed: {reason}")

    def bind_replica_progress(
        self,
        attempted_replicas: int,
        completed_replicas: int,
        failing_replica_index: int | None,
    ) -> TerminalRescueFailed:
        if (
            isinstance(attempted_replicas, bool)
            or not isinstance(attempted_replicas, int)
            or isinstance(completed_replicas, bool)
            or not isinstance(completed_replicas, int)
            or attempted_replicas < 0
            or attempted_replicas > TERMINAL_RESCUE_CONFIGURED_DECODES
            or completed_replicas < 0
            or completed_replicas > attempted_replicas
        ):
            raise RuntimeError("Terminal rescue replica progress is invalid")
        if failing_replica_index is not None and (
            isinstance(failing_replica_index, bool)
            or not isinstance(failing_replica_index, int)
            or failing_replica_index < 0
            or failing_replica_index >= attempted_replicas
        ):
            raise RuntimeError("Terminal rescue failing replica index is invalid")
        self.attempted_replicas = attempted_replicas
        self.completed_replicas = completed_replicas
        self.failing_replica_index = failing_replica_index
        self.failure_sha256 = canonical_sha256(self.evidence_summary())
        return self

    def evidence_summary(self) -> dict[str, Any]:
        return {
            "reason": self.reason,
            "stage": self.stage,
            "subtype": self.subtype,
            "configuredIndependentDecodes": TERMINAL_RESCUE_CONFIGURED_DECODES,
            "attemptedReplicas": self.attempted_replicas,
            "completedReplicas": self.completed_replicas,
            "failingReplicaIndex": self.failing_replica_index,
            "causeType": self.cause_type,
            "causeMessageSha256": self.cause_message_sha256,
        }


class SourceGenerationRetryExhausted(RuntimeError):
    """A source-bound, recoverable generation budget was exhausted."""

    reasons: Counter[str]

    def summary(self) -> dict[str, Any]:
        raise NotImplementedError


class DecodeProfileRejected(RuntimeError):
    """A complete decode profile failed output-only reconstruction checks."""


class EmptyOutputGenerationRetryExhausted(SourceGenerationRetryExhausted):
    """One generation batch retained empty rows after every bounded decode."""

    def __init__(
        self,
        target_code: str,
        batch_offset: int,
        batch_size: int,
        completed_empty_retry_rounds: int,
        case_normalized_recovery_attempted: bool,
        attempted_recovery_profiles: tuple[str, ...],
        row_diagnostics: list[str],
        omitted_rows: int,
    ) -> None:
        if (
            not re.fullmatch(r"[a-z]{3}_[A-Z][a-z]{3}", target_code)
            or batch_offset < 0
            or batch_size < 1
            or not 0 <= completed_empty_retry_rounds <= 3
            or not isinstance(case_normalized_recovery_attempted, bool)
            or omitted_rows < 0
            or not row_diagnostics
            or len(row_diagnostics) > MAXIMUM_EMPTY_OUTPUT_DIAGNOSTICS
            or len(attempted_recovery_profiles) > len(EMPTY_OUTPUT_RECOVERY_PROFILES)
            or len(set(attempted_recovery_profiles))
            != len(attempted_recovery_profiles)
            or any(
                profile not in EMPTY_OUTPUT_RECOVERY_PROFILES
                for profile in attempted_recovery_profiles
            )
        ):
            raise RuntimeError("Empty-output exhaustion diagnostics are malformed")
        normalized_diagnostics: list[str] = []
        prior_index = -1
        for diagnostic in row_diagnostics:
            match = re.fullmatch(r"([0-9]+):([a-f0-9]{64})", diagnostic)
            if match is None:
                raise RuntimeError(
                    "Empty-output exhaustion row diagnostics are malformed"
                )
            row_index = int(match.group(1))
            if row_index >= batch_size or row_index <= prior_index:
                raise RuntimeError(
                    "Empty-output exhaustion row order is malformed"
                )
            prior_index = row_index
            normalized_diagnostics.append(diagnostic)
        self.target_code = target_code
        self.batch_offset = batch_offset
        self.batch_size = batch_size
        self.completed_empty_retry_rounds = completed_empty_retry_rounds
        self.case_normalized_recovery_attempted = (
            case_normalized_recovery_attempted
        )
        self.attempted_recovery_profiles = attempted_recovery_profiles
        self.row_diagnostics = normalized_diagnostics
        self.omitted_rows = omitted_rows
        self.empty_rows = len(normalized_diagnostics) + omitted_rows
        self.reasons: Counter[str] = Counter({"empty-output": self.empty_rows})
        super().__init__(
            "NLLB empty-output generation exhausted bounded recovery: "
            f"targetCode={target_code};batchOffset={batch_offset};"
            f"rows={','.join(normalized_diagnostics)}"
            f"{f',+{omitted_rows}-more' if omitted_rows else ''}"
        )

    def summary(self) -> dict[str, Any]:
        return {
            "targetCode": self.target_code,
            "batchOffset": self.batch_offset,
            "batchSize": self.batch_size,
            "emptyRows": self.empty_rows,
            "emptyRowDiagnostics": list(self.row_diagnostics),
            "omittedRows": self.omitted_rows,
            "completedEmptyRetryRounds": self.completed_empty_retry_rounds,
            "caseNormalizedRecoveryAttempted": (
                self.case_normalized_recovery_attempted
            ),
            "attemptedRecoveryProfiles": list(
                self.attempted_recovery_profiles
            ),
        }


class LanguageSourceGenerationRetryExhausted(RuntimeError):
    """One language could not generate every source after bounded recovery."""

    def __init__(
        self,
        language: str,
        cause: SourceGenerationRetryExhausted,
    ) -> None:
        if not language or len(language) > 128:
            raise RuntimeError("Source-generation language diagnostics are malformed")
        self.language = language
        self.language_sha256 = hashlib.sha256(language.encode("utf-8")).hexdigest()
        self.cause = cause
        self.reasons = Counter(cause.reasons)
        super().__init__(
            "Source generation exhausted for "
            f"languageSha256={self.language_sha256};"
            f"failureSha256={canonical_sha256(cause.summary())}"
        )

    def summary(self) -> dict[str, Any]:
        return {
            "languageSha256": self.language_sha256,
            "failureKind": "source-generation",
            "reasons": dict(self.reasons),
            "generationFailure": self.cause.summary(),
        }


class SourceDecodeProfilesRetryExhausted(SourceGenerationRetryExhausted):
    """Every bounded output-only reconstruction profile was rejected."""

    def __init__(
        self,
        source_sha256: str,
        retry_attempt: int,
        attempted_profiles: tuple[str, ...],
    ) -> None:
        validate_hash(source_sha256, "decode-profile exhaustion source hash")
        if (
            not 1 <= retry_attempt <= 3
            or not attempted_profiles
            or len(attempted_profiles) > len(RETRY_DECODE_PROFILES)
            or len(set(attempted_profiles)) != len(attempted_profiles)
            or any(
                profile not in RETRY_DECODE_PROFILES
                for profile in attempted_profiles
            )
        ):
            raise RuntimeError("Decode-profile exhaustion diagnostics are malformed")
        self.source_sha256 = source_sha256
        self.retry_attempt = retry_attempt
        self.attempted_profiles = attempted_profiles
        self.reasons = Counter({"decode-profile-exhausted": 1})
        super().__init__(
            "Source decode profiles exhausted for "
            f"sourceSha256={source_sha256};retryAttempt={retry_attempt}"
        )

    def summary(self) -> dict[str, Any]:
        return {
            "sourceSha256": self.source_sha256,
            "retryAttempt": self.retry_attempt,
            "attemptedProfiles": list(self.attempted_profiles),
        }


class LanguageValidationRetryExhausted(RuntimeError):
    """One language remained invalid after its source-bound retry budget."""

    def __init__(
        self,
        language: str,
        completed_retry_rounds: int,
        maximum_retry_attempts: int,
        failing_packs: int,
        failing_fields: int,
        retryable_sources: int,
        reasons: Counter[str],
        samples: list[dict[str, Any]],
        retried_sources: int,
        retried_segments: int,
        improved_sources: int,
    ) -> None:
        if (
            not language
            or len(language) > 128
            or completed_retry_rounds < 0
            or not 1 <= maximum_retry_attempts <= 3
            or any(
                count < 0
                for count in (
                    failing_packs,
                    failing_fields,
                    retryable_sources,
                    retried_sources,
                    retried_segments,
                    improved_sources,
                )
            )
            or not reasons
            or len(reasons) > MAXIMUM_VALIDATION_FAILURE_REASON_KINDS
            or len(samples) > MAXIMUM_VALIDATION_FAILURE_SAMPLES
        ):
            raise RuntimeError("Validation retry exhaustion diagnostics are malformed")
        normalized_reasons: dict[str, int] = {}
        for reason, count in sorted(reasons.items()):
            if (
                not isinstance(reason, str)
                or not reason
                or len(reason) > 128
                or isinstance(count, bool)
                or not isinstance(count, int)
                or count < 1
            ):
                raise RuntimeError(
                    "Validation retry exhaustion reason counts are malformed"
                )
            normalized_reasons[reason] = count
        normalized_samples: list[dict[str, Any]] = []
        for sample in samples:
            source_sha256 = validate_hash(
                sample.get("sourceSha256") if isinstance(sample, dict) else None,
                "validation retry exhaustion source hash",
            )
            sample_reasons = sample.get("reasons")
            if (
                not isinstance(sample_reasons, list)
                or not sample_reasons
                or len(sample_reasons) > MAXIMUM_VALIDATION_FAILURE_REASON_KINDS
                or any(
                    not isinstance(reason, str)
                    or not reason
                    or len(reason) > 128
                    for reason in sample_reasons
                )
                or sample_reasons != sorted(set(sample_reasons))
            ):
                raise RuntimeError(
                    "Validation retry exhaustion samples are malformed"
                )
            normalized_samples.append(
                {
                    "sourceSha256": source_sha256,
                    "reasons": list(sample_reasons),
                }
            )
        self.language = language
        self.language_sha256 = hashlib.sha256(language.encode("utf-8")).hexdigest()
        self.completed_retry_rounds = completed_retry_rounds
        self.maximum_retry_attempts = maximum_retry_attempts
        self.failing_packs = failing_packs
        self.failing_fields = failing_fields
        self.retryable_sources = retryable_sources
        self.reasons = normalized_reasons
        self.samples = normalized_samples
        self.retried_sources = retried_sources
        self.retried_segments = retried_segments
        self.improved_sources = improved_sources
        sample_hashes = ",".join(
            sample["sourceSha256"] for sample in normalized_samples
        )
        super().__init__(
            "Strict TypeScript validation exhausted bounded retries for "
            f"languageSha256={self.language_sha256};sources={sample_hashes}"
        )

    def summary(self) -> dict[str, Any]:
        return {
            "languageSha256": self.language_sha256,
            "completedRetryRounds": self.completed_retry_rounds,
            "maximumRetryAttempts": self.maximum_retry_attempts,
            "failingPacks": self.failing_packs,
            "failingFields": self.failing_fields,
            "retryableSources": self.retryable_sources,
            "reasons": dict(self.reasons),
            "samples": [dict(sample) for sample in self.samples],
            "retriedSources": self.retried_sources,
            "retriedSegments": self.retried_segments,
            "improvedSources": self.improved_sources,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--master-worklist", required=True)
    parser.add_argument("--worklist-root", required=True)
    parser.add_argument("--candidate-root", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--model-sha256", required=True)
    parser.add_argument("--worker-implementation-sha256", required=True)
    parser.add_argument("--pipeline-script", required=True)
    parser.add_argument("--pipeline-implementation-sha256", required=True)
    parser.add_argument("--validator-policy-sha256", required=True)
    parser.add_argument("--execution-profile-json", required=True)
    parser.add_argument("--execution-profile-sha256", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--worker-index", type=int, required=True)
    parser.add_argument("--worker-count", type=int, required=True)
    parser.add_argument("--batch-size", type=int, required=True)
    parser.add_argument("--num-beams", type=int, required=True)
    parser.add_argument("--no-repeat-ngram-size", type=int, required=True)
    parser.add_argument("--max-source-tokens", type=int, required=True)
    parser.add_argument("--max-new-tokens", type=int, required=True)
    parser.add_argument("--max-retry-attempts", type=int, required=True)
    parser.add_argument("--dtype", choices=("float16", "float32"), required=True)
    parser.add_argument("--device", choices=("auto", "cpu", "mps"), required=True)
    return parser.parse_args()


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def parse_strict_execution_profile_json(value: Any) -> Any:
    if not isinstance(value, str):
        raise RuntimeError("Requested execution profile JSON is malformed")

    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        parsed: dict[str, Any] = {}
        for key, item in pairs:
            if key in parsed:
                raise RuntimeError("Requested execution profile JSON has duplicate keys")
            parsed[key] = item
        return parsed

    try:
        return json.loads(value, object_pairs_hook=reject_duplicate_keys)
    except RuntimeError:
        raise
    except (ValueError, TypeError) as error:
        raise RuntimeError("Requested execution profile JSON is malformed") from error


def validate_execution_profile(value: Any, requested_sha256: Any) -> dict[str, Any]:
    requested = validate_hash(
        requested_sha256,
        "requested execution profile hash",
    )
    if not isinstance(value, dict) or set(value) != {
        "schemaVersion",
        "kind",
        "pipelineVersion",
        "environment",
        "torch",
        "terminalRescue",
        "executionProfileSha256",
    }:
        raise RuntimeError("Requested execution profile is malformed")
    material = dict(value)
    embedded = validate_hash(
        material.pop("executionProfileSha256"),
        "embedded execution profile hash",
    )
    if (
        requested != EXECUTION_PROFILE_SHA256
        or embedded != EXECUTION_PROFILE_SHA256
        or canonical_sha256(material) != EXECUTION_PROFILE_SHA256
        or value != EXECUTION_PROFILE
    ):
        raise RuntimeError("Requested execution profile is stale or tampered")
    return EXECUTION_PROFILE


def read_json(path: Path, maximum_bytes: int = MAXIMUM_JSON_BYTES) -> Any:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
        raise RuntimeError(f"JSON input is not a regular non-symlink file: {path}")
    if metadata.st_size > maximum_bytes:
        raise RuntimeError(
            f"JSON input exceeds the {maximum_bytes}-byte bound: {path}"
        )
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_relative_path(value: Any) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise RuntimeError("Worklist contains an unsafe relative path")
    candidate = Path(value)
    if candidate.is_absolute() or any(part in ("", ".", "..") for part in candidate.parts):
        raise RuntimeError("Worklist contains an unsafe relative path")
    if candidate.as_posix() != value:
        raise RuntimeError("Worklist relative path is not normalized POSIX form")
    return value


def contained_path(root: Path, relative: Any) -> Path:
    normalized = validate_relative_path(relative)
    target = (root / normalized).resolve(strict=False)
    try:
        target.relative_to(root)
    except ValueError as error:
        raise RuntimeError("Worklist path escaped its declared root") from error
    return target


def validate_hash(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise RuntimeError(f"{label} is not a canonical SHA-256 digest")
    return value


def validator_policy_sha256(files: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    digest.update(f"{VALIDATOR_POLICY_KIND}\0".encode("utf-8"))
    for file in files:
        digest.update(file["relativePath"].encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(file["bytes"]).encode("utf-8"))
        digest.update(b"\0")
        digest.update(file["sha256"].encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def validate_validator_policy_provenance(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "kind",
        "files",
        "validatorPolicySha256",
    }:
        raise RuntimeError("Validator policy provenance manifest is malformed")
    if value.get("kind") != VALIDATOR_POLICY_KIND:
        raise RuntimeError("Validator policy provenance kind is unsupported")
    files = value.get("files")
    if not isinstance(files, list) or len(files) != len(
        VALIDATOR_POLICY_RELATIVE_PATHS
    ):
        raise RuntimeError("Validator policy provenance file count is invalid")
    for index, relative_path in enumerate(VALIDATOR_POLICY_RELATIVE_PATHS):
        file = files[index]
        if not isinstance(file, dict) or set(file) != {
            "relativePath",
            "bytes",
            "sha256",
        }:
            raise RuntimeError("Validator policy provenance file record is malformed")
        byte_count = file.get("bytes")
        if (
            file.get("relativePath") != relative_path
            or isinstance(byte_count, bool)
            or not isinstance(byte_count, int)
            or not 0 <= byte_count <= 64 * 1024 * 1024
        ):
            raise RuntimeError("Validator policy provenance file order/bytes are invalid")
        validate_hash(file.get("sha256"), "validator policy dependency hash")
    expected = validate_hash(
        value.get("validatorPolicySha256"),
        "validator policy hash",
    )
    if validator_policy_sha256(files) != expected:
        raise RuntimeError("Validator policy provenance digest is internally stale")
    return value


def stable_policy_file_identity(
    metadata: os.stat_result,
    relative_path: str,
) -> tuple[int, ...]:
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise RuntimeError(
            "Validator policy dependency must be a regular non-symlink, "
            f"non-hardlinked file: {relative_path}"
        )
    getuid = getattr(os, "getuid", None)
    if getuid is not None and metadata.st_uid != getuid():
        raise RuntimeError(
            f"Validator policy dependency is not owned by this user: {relative_path}"
        )
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_nlink,
        metadata.st_uid,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def read_validator_policy_dependency(
    repo_root: Path,
    relative_path: str,
) -> dict[str, Any]:
    root = repo_root.resolve(strict=True)
    if (
        not relative_path
        or "\0" in relative_path
        or "\\" in relative_path
        or Path(relative_path).is_absolute()
        or Path(relative_path).as_posix() != relative_path
        or any(part in ("", ".", "..") for part in Path(relative_path).parts)
    ):
        raise RuntimeError(
            f"Unsafe validator policy dependency path: {relative_path}"
        )
    dependency = root.joinpath(*relative_path.split("/"))
    try:
        dependency.relative_to(root)
    except ValueError as error:
        raise RuntimeError(
            f"Validator policy dependency escaped repository: {relative_path}"
        ) from error
    if dependency.resolve(strict=True) != dependency:
        raise RuntimeError(
            f"Validator policy dependency resolves through a symlink: {relative_path}"
        )
    path_before = stable_policy_file_identity(
        dependency.lstat(),
        relative_path,
    )
    if path_before[5] > 64 * 1024 * 1024:
        raise RuntimeError(
            f"Validator policy dependency exceeds 64 MiB: {relative_path}"
        )
    no_follow = getattr(os, "O_NOFOLLOW", None)
    if no_follow is None:
        raise RuntimeError("This platform cannot pin validator policy file reads")
    descriptor = os.open(dependency, os.O_RDONLY | no_follow)
    try:
        descriptor_before = stable_policy_file_identity(
            os.fstat(descriptor),
            relative_path,
        )
        if descriptor_before[5] > 64 * 1024 * 1024:
            raise RuntimeError(
                f"Validator policy dependency exceeds 64 MiB: {relative_path}"
            )
        chunks: list[bytes] = []
        while chunk := os.read(descriptor, 8 * 1024 * 1024):
            chunks.append(chunk)
        descriptor_after = stable_policy_file_identity(
            os.fstat(descriptor),
            relative_path,
        )
    finally:
        os.close(descriptor)
    content = b"".join(chunks)
    path_after = stable_policy_file_identity(
        dependency.lstat(),
        relative_path,
    )
    if not (
        path_before == descriptor_before == descriptor_after == path_after
        and len(content) == descriptor_after[5]
    ):
        raise RuntimeError(
            f"Validator policy dependency changed while hashing: {relative_path}"
        )
    return {
        "relativePath": relative_path,
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def create_validator_policy_provenance(repo_root: Path) -> dict[str, Any]:
    files = [
        read_validator_policy_dependency(repo_root, relative_path)
        for relative_path in VALIDATOR_POLICY_RELATIVE_PATHS
    ]
    return {
        "kind": VALIDATOR_POLICY_KIND,
        "files": files,
        "validatorPolicySha256": validator_policy_sha256(files),
    }


def assert_current_validator_policy(
    repo_root: Path,
    expected_value: Any,
    requested_sha256: str,
) -> dict[str, Any]:
    expected = validate_validator_policy_provenance(expected_value)
    requested = validate_hash(requested_sha256, "requested validator policy hash")
    if expected["validatorPolicySha256"] != requested:
        raise RuntimeError("Master worklist validator policy differs from request")
    current = create_validator_policy_provenance(repo_root)
    if current != expected:
        raise RuntimeError(
            "Validator policy dependencies changed after provenance creation"
        )
    return expected


def validate_master(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "schemaVersion",
        "kind",
        "provenance",
        "seedMemory",
        "generationOverrides",
        "sources",
        "jobs",
        "worklistSha256",
    }:
        raise RuntimeError("Master worklist is not an object")
    if value.get("schemaVersion") != 1 or value.get("kind") != MASTER_KIND:
        raise RuntimeError("Master worklist kind/version is invalid")
    expected = validate_hash(value.get("worklistSha256"), "master worklist hash")
    material = dict(value)
    del material["worklistSha256"]
    if canonical_sha256(material) != expected:
        raise RuntimeError("Master worklist hash is stale or tampered")
    jobs = value.get("jobs")
    sources = value.get("sources")
    provenance = value.get("provenance")
    if not isinstance(jobs, list) or not isinstance(sources, list) or not isinstance(provenance, dict):
        raise RuntimeError("Master worklist collections are malformed")
    if set(provenance) != {
        "pipelineVersion",
        "executionProfile",
        "protectorVersion",
        "protectorSha256",
        "pipelineImplementationSha256",
        "workerImplementationSha256",
        "validatorPolicy",
        "modelLabel",
        "modelSha256",
        "seedMemorySha256",
        "seedMemoryEntries",
        "seedMemoryConflicts",
        "generationOverridesSha256",
        "generationOverrideEntries",
        "generationConfig",
    }:
        raise RuntimeError("Master worklist provenance is malformed")
    if provenance.get("pipelineVersion") != PIPELINE_VERSION:
        raise RuntimeError("Master worklist pipeline version is unsupported")
    validate_execution_profile(
        provenance.get("executionProfile"),
        EXECUTION_PROFILE_SHA256,
    )
    return value


def validated_seed_entries(master: dict[str, Any]) -> list[dict[str, Any]]:
    seed = master.get("seedMemory")
    provenance = master["provenance"]
    if not isinstance(seed, dict):
        raise RuntimeError("Master seed translation memory is malformed")
    if (
        seed.get("schemaVersion") != 1
        or seed.get("kind") != "inspir-long-tail-translation-seed-memory-v1"
    ):
        raise RuntimeError("Master seed translation memory kind/version is invalid")
    expected_hash = validate_hash(seed.get("seedMemorySha256"), "seed memory hash")
    material = dict(seed)
    del material["seedMemorySha256"]
    if canonical_sha256(material) != expected_hash:
        raise RuntimeError("Seed translation memory hash is stale or tampered")
    entries = seed.get("entries")
    conflicts = seed.get("conflicts")
    if not isinstance(entries, list) or not isinstance(conflicts, list):
        raise RuntimeError("Seed translation memory entries are malformed")
    if (
        provenance.get("seedMemorySha256") != expected_hash
        or provenance.get("seedMemoryEntries") != len(entries)
        or provenance.get("seedMemoryConflicts") != len(conflicts)
    ):
        raise RuntimeError("Seed translation memory differs from provenance")
    prior_identity = ""
    for entry in entries:
        if not isinstance(entry, dict):
            raise RuntimeError("Seed translation memory entry is malformed")
        locale = entry.get("locale")
        source = entry.get("source")
        value = entry.get("value")
        source_sha256 = validate_hash(entry.get("sourceSha256"), "seed source hash")
        value_sha256 = validate_hash(entry.get("valueSha256"), "seed value hash")
        if not isinstance(locale, str) or not isinstance(source, str) or not isinstance(value, str):
            raise RuntimeError("Seed translation memory entry fields are malformed")
        identity = f"{locale}\0{source_sha256}"
        if identity <= prior_identity:
            raise RuntimeError("Seed translation memory order/uniqueness is invalid")
        if hashlib.sha256(source.encode("utf-8")).hexdigest() != source_sha256:
            raise RuntimeError("Seed translation memory source hash drifted")
        if hashlib.sha256(value.encode("utf-8")).hexdigest() != value_sha256:
            raise RuntimeError("Seed translation memory value hash drifted")
        if value != unicodedata.normalize("NFC", value):
            raise RuntimeError("Seed translation memory value is not NFC")
        prior_identity = identity
    prior_conflict_identity = ""
    entry_identities = {
        f"{entry['locale']}\0{entry['sourceSha256']}" for entry in entries
    }
    for conflict in conflicts:
        if not isinstance(conflict, dict):
            raise RuntimeError("Seed translation conflict record is malformed")
        locale = conflict.get("locale")
        source_sha256 = validate_hash(
            conflict.get("sourceSha256"),
            "seed conflict source hash",
        )
        if not isinstance(locale, str):
            raise RuntimeError("Seed translation conflict locale is malformed")
        identity = f"{locale}\0{source_sha256}"
        if identity <= prior_conflict_identity or identity in entry_identities:
            raise RuntimeError("Seed translation conflict order/uniqueness is invalid")
        prior_conflict_identity = identity
    return entries


def validated_generation_overrides(
    master: dict[str, Any],
    seed_entries: list[dict[str, Any]],
) -> dict[tuple[str, str], dict[str, Any]]:
    value = master.get("generationOverrides")
    if not isinstance(value, dict) or set(value) != {
        "schemaVersion",
        "kind",
        "entries",
        "generationOverridesSha256",
    }:
        raise RuntimeError("Master generation overrides are malformed")
    if (
        value.get("schemaVersion") != 1
        or value.get("kind") != GENERATION_OVERRIDES_KIND
    ):
        raise RuntimeError("Master generation overrides kind/version is invalid")
    expected_hash = validate_hash(
        value.get("generationOverridesSha256"),
        "generation overrides hash",
    )
    material = dict(value)
    del material["generationOverridesSha256"]
    if canonical_sha256(material) != expected_hash:
        raise RuntimeError("Generation overrides hash is stale or tampered")
    entries = value.get("entries")
    if (
        not isinstance(entries, list)
        or len(entries) > MAXIMUM_GENERATION_OVERRIDES
    ):
        raise RuntimeError("Generation overrides exceed their bounded contract")
    provenance = master.get("provenance")
    if (
        not isinstance(provenance, dict)
        or provenance.get("generationOverridesSha256") != expected_hash
        or provenance.get("generationOverrideEntries") != len(entries)
    ):
        raise RuntimeError(
            "Generation overrides differ from their provenance binding"
        )
    seed_by_identity = {
        (entry.get("locale"), entry.get("sourceSha256")): entry
        for entry in seed_entries
    }
    sources = master.get("sources")
    if not isinstance(sources, list):
        raise RuntimeError("Master source catalog is malformed")
    result: dict[tuple[str, str], dict[str, Any]] = {}
    prior_identity = ""
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {
            "language",
            "locale",
            "source",
            "sourceSha256",
            "value",
            "valueSha256",
            "requiredOccurrences",
        }:
            raise RuntimeError("Generation override entry is malformed")
        language = entry.get("language")
        locale = entry.get("locale")
        source = entry.get("source")
        reviewed_value = entry.get("value")
        source_sha256 = validate_hash(
            entry.get("sourceSha256"),
            "generation override source hash",
        )
        value_sha256 = validate_hash(
            entry.get("valueSha256"),
            "generation override value hash",
        )
        if not all(
            isinstance(field, str) and field
            for field in (language, locale, source, reviewed_value)
        ):
            raise RuntimeError("Generation override fields are malformed")
        identity_text = f"{locale}\0{source_sha256}"
        identity = (locale, source_sha256)
        if identity_text <= prior_identity or identity in result:
            raise RuntimeError(
                "Generation override order/uniqueness is invalid"
            )
        if hashlib.sha256(source.encode("utf-8")).hexdigest() != source_sha256:
            raise RuntimeError("Generation override source hash drifted")
        if (
            hashlib.sha256(reviewed_value.encode("utf-8")).hexdigest()
            != value_sha256
            or reviewed_value != unicodedata.normalize("NFC", reviewed_value)
        ):
            raise RuntimeError("Generation override reviewed value drifted")
        seed_entry = seed_by_identity.get(identity)
        if seed_entry is None or any(
            seed_entry.get(key) != entry.get(key)
            for key in (
                "language",
                "locale",
                "source",
                "sourceSha256",
                "value",
                "valueSha256",
            )
        ):
            raise RuntimeError(
                "Generation override differs from its exact seed entry"
            )
        occurrences = entry.get("requiredOccurrences")
        if not isinstance(occurrences, list) or not 1 <= len(occurrences) <= 100:
            raise RuntimeError("Generation override occurrences are malformed")
        prior_occurrence = ""
        for occurrence in occurrences:
            if not isinstance(occurrence, dict) or set(occurrence) != {
                "namespace",
                "sourceHash",
                "key",
            }:
                raise RuntimeError("Generation override occurrence is malformed")
            namespace = occurrence.get("namespace")
            key = occurrence.get("key")
            source_hash = validate_hash(
                occurrence.get("sourceHash"),
                "generation override occurrence source hash",
            )
            if not isinstance(namespace, str) or not namespace or not isinstance(key, str) or not key:
                raise RuntimeError("Generation override occurrence fields are malformed")
            occurrence_identity = f"{namespace}\0{source_hash}\0{key}"
            if occurrence_identity <= prior_occurrence:
                raise RuntimeError(
                    "Generation override occurrence order/uniqueness is invalid"
                )
            prior_occurrence = occurrence_identity
        observed_occurrences: list[dict[str, str]] = []
        for catalog_source in sources:
            if not isinstance(catalog_source, dict):
                raise RuntimeError("Master source catalog entry is malformed")
            namespace = catalog_source.get("namespace")
            source_hash = catalog_source.get("sourceHash")
            catalog_entries = catalog_source.get("entries")
            if (
                not isinstance(namespace, str)
                or not isinstance(source_hash, str)
                or not isinstance(catalog_entries, list)
            ):
                raise RuntimeError("Master source catalog entry is malformed")
            for catalog_entry in catalog_entries:
                if (
                    isinstance(catalog_entry, dict)
                    and catalog_entry.get("sourceSha256") == source_sha256
                ):
                    if catalog_entry.get("source") != source:
                        raise RuntimeError(
                            "Generation override source catalog binding drifted"
                        )
                    catalog_key = catalog_entry.get("key")
                    if not isinstance(catalog_key, str) or not catalog_key:
                        raise RuntimeError(
                            "Generation override source catalog key is malformed"
                        )
                    observed_occurrences.append(
                        {
                            "namespace": namespace,
                            "sourceHash": source_hash,
                            "key": catalog_key,
                        }
                    )
        observed_occurrences.sort(
            key=lambda occurrence: (
                occurrence["namespace"],
                occurrence["sourceHash"],
                occurrence["key"],
            )
        )
        if observed_occurrences != occurrences:
            raise RuntimeError(
                "Generation override occurrence provenance drifted"
            )
        result[identity] = entry
        prior_identity = identity_text
    binding = [
        {
            "language": entry["language"],
            "locale": entry["locale"],
            "sourceSha256": entry["sourceSha256"],
            "valueSha256": entry["valueSha256"],
        }
        for entry in entries
    ]
    required_source_sha256s = {
        entry["sourceSha256"]
        for entry in seed_entries
        if entry.get("locale") == "af"
        and entry.get("sourceSha256")
        in CURRENT_GENERATION_OVERRIDE_SOURCE_SHA256S
    }
    source_by_namespace = {
        catalog_source.get("namespace"): catalog_source
        for catalog_source in sources
        if isinstance(catalog_source, dict)
    }
    for job in master.get("jobs", []):
        if not isinstance(job, dict) or job.get("language") != "Afrikaans":
            continue
        catalog_source = source_by_namespace.get(job.get("namespace"))
        if not isinstance(catalog_source, dict):
            continue
        for catalog_entry in catalog_source.get("entries", []):
            if (
                isinstance(catalog_entry, dict)
                and catalog_entry.get("sourceSha256")
                in CURRENT_GENERATION_OVERRIDE_SOURCE_SHA256S
            ):
                required_source_sha256s.add(catalog_entry["sourceSha256"])
    expected_binding = [
        {
            "language": "Afrikaans",
            "locale": "af",
            "sourceSha256": source_sha256,
            "valueSha256": (
                CURRENT_GENERATION_OVERRIDE_VALUE_SHA256_BY_SOURCE[
                    source_sha256
                ]
            ),
        }
        for source_sha256 in sorted(required_source_sha256s)
    ]
    if binding != expected_binding:
        raise RuntimeError(
            "Generation overrides differ from the exact required reviewed set"
        )
    if (
        len(binding) == CURRENT_GENERATION_OVERRIDE_ENTRIES
        and canonical_sha256(binding)
        != CURRENT_GENERATION_OVERRIDE_BINDING_SHA256
    ):
        raise RuntimeError(
            "Generation overrides differ from the full reviewed binding digest"
        )
    return result


def validate_pack(
    value: Any,
    master: dict[str, Any],
    expected_job: dict[str, Any],
    model_sha256: str,
    worker_sha256: str,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "schemaVersion",
        "kind",
        "masterWorklistSha256",
        "provenance",
        "job",
        "source",
        "packWorklistSha256",
    }:
        raise RuntimeError("Pack worklist is not an object")
    if value.get("schemaVersion") != 1 or value.get("kind") != PACK_KIND:
        raise RuntimeError("Pack worklist kind/version is invalid")
    expected_hash = validate_hash(value.get("packWorklistSha256"), "pack worklist hash")
    material = dict(value)
    del material["packWorklistSha256"]
    if canonical_sha256(material) != expected_hash:
        raise RuntimeError("Pack worklist hash is stale or tampered")
    if value.get("masterWorklistSha256") != master["worklistSha256"]:
        raise RuntimeError("Pack worklist belongs to another master")
    if value.get("job") != expected_job:
        raise RuntimeError("Pack worklist job differs from the master")
    provenance = value.get("provenance")
    source = value.get("source")
    if not isinstance(provenance, dict) or not isinstance(source, dict):
        raise RuntimeError("Pack provenance/source is malformed")
    if provenance != master.get("provenance"):
        raise RuntimeError("Pack provenance differs from the master worklist")
    if provenance.get("pipelineVersion") != PIPELINE_VERSION:
        raise RuntimeError("Pack pipeline version is unsupported")
    if provenance.get("modelSha256") != model_sha256:
        raise RuntimeError("Pack model digest differs from the local model")
    if provenance.get("workerImplementationSha256") != worker_sha256:
        raise RuntimeError("Pack worker digest differs from this worker")
    entries = source.get("entries")
    if not isinstance(entries, list) or len(entries) != expected_job.get("entryCount"):
        raise RuntimeError("Pack source entry cardinality is invalid")
    if canonical_sha256(entries) != expected_job.get("sourceEntriesSha256"):
        raise RuntimeError("Pack source entries differ from the job binding")
    for entry in entries:
        if not isinstance(entry, dict):
            raise RuntimeError("Pack source entry is malformed")
        source_text = entry.get("source")
        if not isinstance(source_text, str):
            raise RuntimeError("Pack source text is malformed")
        if hashlib.sha256(source_text.encode("utf-8")).hexdigest() != entry.get("sourceSha256"):
            raise RuntimeError("Pack source text digest is stale")
    return value


def hash_model(model_root: Path) -> str:
    digest = hashlib.sha256()
    digest.update(b"inspir-local-model-tree-v1\0")
    for relative in MODEL_FILES:
        path = model_root / relative
        metadata = path.lstat()
        if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
            raise RuntimeError(f"Required model file is not regular: {relative}")
        digest.update(f"{relative}\0{metadata.st_size}\0".encode("utf-8"))
        with path.open("rb") as handle:
            while chunk := handle.read(8 * 1024 * 1024):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def implementation_sha256() -> str:
    return hashlib.sha256(Path(__file__).resolve().read_bytes()).hexdigest()


class TypeScriptCandidateValidator:
    """Persistent exact validator using the source-bound TypeScript policy."""

    def __init__(
        self,
        node: Path,
        pipeline_script: Path,
        pipeline_sha256: str,
        validator_policy_sha256: str,
    ) -> None:
        if hashlib.sha256(pipeline_script.read_bytes()).hexdigest() != pipeline_sha256:
            raise RuntimeError(
                "TypeScript validation policy changed after provenance creation"
            )
        self.process = subprocess.Popen(
            [
                str(node),
                "--import",
                "tsx",
                str(pipeline_script),
                "--worker-validator-stdio",
            ],
            cwd=pipeline_script.parent.parent,
            env={
                **os.environ,
                "HF_DATASETS_OFFLINE": "1",
                "HF_HUB_OFFLINE": "1",
                "INSPIR_LONG_TAIL_VALIDATOR_POLICY_SHA256": validate_hash(
                    validator_policy_sha256,
                    "validator subprocess policy hash",
                ),
                "TRANSFORMERS_OFFLINE": "1",
            },
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

    def validate(
        self,
        pack: dict[str, Any],
        values: dict[str, str],
    ) -> list[dict[str, Any]]:
        if self.process.stdin is None or self.process.stdout is None:
            raise RuntimeError("TypeScript candidate validator pipes are unavailable")
        if self.process.poll() is not None:
            raise RuntimeError(
                "TypeScript candidate validator exited before receiving a request"
            )
        request = json.dumps(
            {"pack": pack, "values": values},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        try:
            self.process.stdin.write(request + "\n")
            self.process.stdin.flush()
        except BrokenPipeError as error:
            raise RuntimeError(
                "TypeScript candidate validator closed its input unexpectedly"
            ) from error
        readable, _, _ = select.select([self.process.stdout], [], [], 60)
        if not readable:
            self.process.terminate()
            self.process.wait(timeout=10)
            raise RuntimeError("TypeScript candidate validator timed out")
        response_line = self.process.stdout.readline()
        if not response_line:
            status = self.process.poll()
            raise RuntimeError(
                f"TypeScript candidate validator exited unexpectedly: {status}"
            )
        try:
            response = json.loads(response_line)
        except json.JSONDecodeError as error:
            raise RuntimeError(
                "TypeScript candidate validator returned malformed JSON"
            ) from error
        if not isinstance(response, dict) or response.get("ok") is not True:
            reason = response.get("error") if isinstance(response, dict) else response
            raise RuntimeError(f"TypeScript candidate validator rejected request: {reason}")
        failures = response.get("failures")
        if not isinstance(failures, list):
            raise RuntimeError("TypeScript candidate validator response is malformed")
        expected_keys = [entry["key"] for entry in pack["source"]["entries"]]
        key_indexes = {key: index for index, key in enumerate(expected_keys)}
        if len(key_indexes) != len(expected_keys):
            raise RuntimeError("Pack contains duplicate source entry keys")
        prior_index = -1
        for failure in failures:
            if not isinstance(failure, dict) or set(failure) != {
                "key",
                "reasons",
                "fluencyReason",
            }:
                raise RuntimeError(
                    "TypeScript candidate validator failure record is malformed"
                )
            key = failure.get("key")
            reasons = failure.get("reasons")
            fluency_reason = failure.get("fluencyReason")
            if not isinstance(key, str) or key not in key_indexes:
                raise RuntimeError(
                    "TypeScript candidate validator returned an unknown field key"
                )
            index = key_indexes[key]
            if index <= prior_index:
                raise RuntimeError(
                    "TypeScript candidate validator failure order is invalid"
                )
            prior_index = index
            if (
                not isinstance(reasons, list)
                or not reasons
                or len(reasons) > MAXIMUM_VALIDATION_FAILURE_REASON_KINDS
                or any(
                    not isinstance(reason, str) or not reason or len(reason) > 128
                    for reason in reasons
                )
                or reasons != sorted(set(reasons))
            ):
                raise RuntimeError(
                    "TypeScript candidate validator failure reasons are malformed"
                )
            if (
                fluency_reason is not None
                and (
                    not isinstance(fluency_reason, str)
                    or not fluency_reason
                    or len(fluency_reason) > 128
                )
            ):
                raise RuntimeError(
                    "TypeScript candidate validator fluency reason is malformed"
                )
            if ("field-fluency" in reasons) != (fluency_reason is not None):
                raise RuntimeError(
                    "TypeScript candidate validator fluency diagnostics drifted"
                )
        return failures

    def close(self) -> None:
        if self.process.stdin is not None:
            try:
                self.process.stdin.close()
            except BrokenPipeError:
                pass
        try:
            status = self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            status = self.process.wait(timeout=10)
        if status != 0:
            raise RuntimeError(
                f"TypeScript candidate validator exited with status {status}"
            )


def numeric_logits_processor(tokenizer: Any) -> LogitsProcessorList:
    token_ids: list[int] = []
    for token_id in range(len(tokenizer)):
        token = tokenizer.convert_ids_to_tokens(token_id)
        if isinstance(token, str) and any(
            unicodedata.category(character) == "Nd" for character in token
        ):
            token_ids.append(token_id)
    if not token_ids:
        raise RuntimeError("Tokenizer exposes no numeric tokens to block")
    return LogitsProcessorList([BlockGeneratedNumericTokens(token_ids)])


def forbidden_source_token_sequences(
    tokenizer: Any,
    values: list[str],
    minimum_word_length: Optional[int],
    opaque_markers: tuple[str, ...] = (),
) -> list[list[int]]:
    """Forbid per-row source-copy paths without poisoning sibling decoding."""

    if minimum_word_length is None:
        return []
    if minimum_word_length < 4:
        raise RuntimeError("Source-copy word constraints cannot be shorter than four")
    text_candidates: set[str] = set(values)
    for value in values:
        lexical_value = value
        for marker in opaque_markers:
            lexical_value = lexical_value.replace(marker, "")
        for match in ASCII_WORD.finditer(lexical_value):
            word = match.group(0)
            if (
                len(word) < minimum_word_length
                or word.casefold() in RETRY_PRESERVED_WORDS
            ):
                continue
            text_candidates.add(word)
            text_candidates.add(word.casefold())
            text_candidates.add(word.capitalize())
    token_sequences: set[tuple[int, ...]] = set()
    unknown_token_id = tokenizer.unk_token_id
    for candidate in sorted(text_candidates, key=lambda value: (len(value), value)):
        for tokenization_input in (candidate, f" {candidate}"):
            encoded = tokenizer(
                tokenization_input,
                add_special_tokens=False,
                truncation=False,
            ).get("input_ids")
            if (
                not isinstance(encoded, list)
                or not encoded
                or any(not isinstance(token_id, int) for token_id in encoded)
                or (
                    unknown_token_id is not None
                    and unknown_token_id in encoded
                )
            ):
                continue
            token_sequences.add(tuple(encoded))
    return [
        list(sequence)
        for sequence in sorted(token_sequences, key=lambda value: (len(value), value))
    ]


def append_bounded_text(parts: list[tuple[bool, str]], value: str) -> None:
    cursor = 0
    while len(value) - cursor > LONG_SEGMENT_LIMIT:
        maximum = cursor + LONG_SEGMENT_LIMIT
        minimum = cursor + LONG_SEGMENT_LIMIT // 2
        boundary = value.rfind(" ", minimum, maximum + 1)
        if boundary < minimum:
            boundary = value.find(" ", maximum)
        if boundary < 0:
            break
        if boundary > cursor:
            parts.append((True, value[cursor:boundary]))
        parts.append((False, value[boundary : boundary + 1]))
        cursor = boundary + 1
    if cursor < len(value):
        parts.append((True, value[cursor:]))


def split_text_segment(value: str) -> list[tuple[bool, str]]:
    parts: list[tuple[bool, str]] = []
    cursor = 0
    for match in SENTENCE_OR_CLAUSE_GAP.finditer(value):
        if match.start() > cursor:
            append_bounded_text(parts, value[cursor : match.start()])
        parts.append((False, match.group(0)))
        cursor = match.end()
    if cursor < len(value):
        append_bounded_text(parts, value[cursor:])
    if not parts:
        parts.append((True, value))
    normalized: list[tuple[bool, str]] = []
    for is_text, part in parts:
        if not is_text:
            normalized.append((False, part))
            continue
        match = re.fullmatch(r"(\s*)(.*?)(\s*)", part, flags=re.DOTALL)
        if not match:
            normalized.append((True, part))
            continue
        leading, core, trailing = match.groups()
        if leading:
            normalized.append((False, leading))
        if core:
            normalized.append((bool(ASCII_LETTER.search(core)), core))
        if trailing:
            normalized.append((False, trailing))
    return normalized


def isolate_quoted_retry_parts(
    parts: list[tuple[bool, str]],
) -> list[tuple[bool, str]]:
    """Expose quoted text to NLLB while preserving exact quote bytes."""

    encoded = "".join(value for _, value in parts)
    matches = list(QUOTED_TEXT.finditer(encoded))
    if not matches or any(
        any(character in match.group(0)[1:-1] for character in ('"', "“", "”"))
        for match in matches
    ):
        return parts
    isolated: list[tuple[bool, str]] = []
    cursor = 0
    for match in matches:
        if match.start() > cursor:
            isolated.extend(split_text_segment(encoded[cursor : match.start()]))
        quoted = match.group(0)
        isolated.append((False, quoted[0]))
        isolated.extend(split_text_segment(quoted[1:-1]))
        isolated.append((False, quoted[-1]))
        cursor = match.end()
    if cursor < len(encoded):
        isolated.extend(split_text_segment(encoded[cursor:]))
    if "".join(value for _, value in isolated) != encoded:
        raise RuntimeError("Quoted retry parts do not reconstruct encoded source")
    return isolated


def alphabetic_index(value: int) -> str:
    if value < 0:
        raise RuntimeError("Opaque literal marker index cannot be negative")
    encoded = ""
    remaining = value
    while True:
        encoded = chr(ord("a") + remaining % 26) + encoded
        remaining = remaining // 26 - 1
        if remaining < 0:
            return encoded


def opaque_marker_prefix(source: str, salt: int) -> str:
    del source
    return "inspir_literal" if salt == 0 else (
        f"inspir_literal{alphabetic_index(salt - 1)}"
    )


def opaque_literal_markers(
    entry: dict[str, Any],
) -> tuple[tuple[str, str], ...]:
    """Create deterministic, source-collision-free markers for exact literals."""

    source = entry.get("source")
    segments = entry.get("segments")
    if not isinstance(source, str) or not isinstance(segments, list):
        raise RuntimeError("Protected source entry is malformed")
    literals = [
        segment.get("value")
        for segment in segments
        if isinstance(segment, dict) and segment.get("kind") == "literal"
    ]
    if any(not isinstance(literal, str) for literal in literals):
        raise RuntimeError("Protected literal is malformed")
    if not literals:
        return ()
    existing_placeholders = set(PLACEHOLDER.findall(source))
    for salt in range(32):
        prefix = opaque_marker_prefix(source, salt)
        markers = tuple(
            f"{{{prefix}_{alphabetic_index(index)}}}"
            for index in range(len(literals))
        )
        if any(OPAQUE_LITERAL_MARKER.fullmatch(marker) is None for marker in markers):
            raise RuntimeError("Opaque literal marker format drifted")
        if len(set(markers)) != len(markers):
            raise RuntimeError("Opaque literal marker generation collided internally")
        if any(marker in source for marker in markers):
            continue
        if any(
            placeholder.startswith(f"{{{prefix}_")
            for placeholder in existing_placeholders
        ):
            continue
        return tuple(zip(markers, literals))
    raise RuntimeError("Could not create collision-free opaque literal markers")


def contextual_source_parts(
    entry: dict[str, Any],
) -> tuple[list[tuple[bool, str]], tuple[tuple[str, str], ...]]:
    """Keep protected literals inside bounded sentence/clause context."""

    source = entry.get("source")
    segments = entry.get("segments")
    if not isinstance(source, str) or not isinstance(segments, list) or not segments:
        raise RuntimeError("Source entry has no protected segments")
    markers = opaque_literal_markers(entry)
    encoded_parts: list[str] = []
    marker_index = 0
    for segment in segments:
        if not isinstance(segment, dict) or segment.get("kind") not in (
            "text",
            "literal",
        ):
            raise RuntimeError("Protected source segment is malformed")
        value = segment.get("value")
        if not isinstance(value, str):
            raise RuntimeError("Protected source segment value is malformed")
        if segment["kind"] == "text":
            encoded_parts.append(value)
            continue
        marker = markers[marker_index][0]
        encoded_parts.append(marker)
        marker_index += 1
    if marker_index != len(markers):
        raise RuntimeError("Opaque literal marker cardinality drifted")
    encoded = "".join(encoded_parts)
    parts = split_text_segment(encoded)
    if "".join(value for _, value in parts) != encoded:
        raise RuntimeError("Contextual source parts do not reconstruct encoded source")
    return parts, markers


def restore_opaque_literals(
    value: str,
    markers: tuple[tuple[str, str], ...],
) -> str:
    """Require exact marker identity/order/cardinality before literal restoration."""

    if not markers:
        return value
    positions: list[int] = []
    for marker, _ in markers:
        if value.count(marker) != 1:
            raise RuntimeError("Opaque literal marker cardinality was not preserved")
        positions.append(value.index(marker))
    if positions != sorted(positions) or len(set(positions)) != len(positions):
        raise RuntimeError("Opaque literal marker order was not preserved")
    expected = {marker for marker, _ in markers}
    observed = set(OPAQUE_LITERAL_MARKER.findall(value))
    if observed != expected:
        raise RuntimeError("Opaque literal marker identity was not preserved")
    restored = value
    for marker, literal in markers:
        restored = restored.replace(marker, literal)
    if OPAQUE_LITERAL_MARKER.search(restored) is not None:
        raise RuntimeError("Opaque literal marker bytes remain after restoration")
    return unicodedata.normalize("NFC", restored)


def restore_opaque_literals_with_source_boundaries(
    value: str,
    source: str,
    markers: tuple[tuple[str, str], ...],
) -> str:
    """Keep whitespace-delimited URL-like literals lexically isolated."""

    isolated = value
    for marker, literal in markers:
        if BOUNDARY_SENSITIVE_LITERAL.fullmatch(literal) is None:
            continue
        if source.count(marker) != 1 or isolated.count(marker) != 1:
            # The strict restorer below owns the canonical marker failure.
            continue
        source_index = source.index(marker)
        output_index = isolated.index(marker)
        source_left = source[source_index - 1] if source_index else ""
        source_right_index = source_index + len(marker)
        source_right = (
            source[source_right_index]
            if source_right_index < len(source)
            else ""
        )
        output_left = isolated[output_index - 1] if output_index else ""
        if source_left.isspace() and not output_left.isspace():
            isolated = isolated[:output_index] + source_left + isolated[output_index:]
            output_index += 1
        output_right_index = output_index + len(marker)
        output_right = (
            isolated[output_right_index]
            if output_right_index < len(isolated)
            else ""
        )
        if source_right.isspace() and not output_right.isspace():
            isolated = (
                isolated[:output_right_index]
                + source_right
                + isolated[output_right_index:]
            )
            if output_right == "/":
                slash_index = output_right_index + len(source_right)
                isolated = (
                    isolated[: slash_index + 1]
                    + source_right
                    + isolated[slash_index + 1 :]
                )
    return restore_opaque_literals(isolated, markers)


def source_parts(entry: dict[str, Any]) -> list[tuple[bool, str]]:
    segments = entry.get("segments")
    if not isinstance(segments, list) or not segments:
        raise RuntimeError("Source entry has no protected segments")
    parts: list[tuple[bool, str]] = []
    for segment in segments:
        if not isinstance(segment, dict) or segment.get("kind") not in ("text", "literal"):
            raise RuntimeError("Protected source segment is malformed")
        value = segment.get("value")
        if not isinstance(value, str):
            raise RuntimeError("Protected source segment value is malformed")
        if segment["kind"] == "literal":
            parts.append((False, value))
        else:
            parts.extend(split_text_segment(value))
    if "".join(value for _, value in parts) != entry["source"]:
        raise RuntimeError("Protected segments do not reconstruct the exact source")
    return parts


def retry_decode_profile_options(
    decode_profile: str,
    generation_attempt: int,
    requested_beams: int,
) -> tuple[int, float, Optional[int]]:
    profile = RETRY_DECODE_PROFILES.get(decode_profile)
    if profile is None:
        raise RuntimeError(f"Unknown bounded decode profile: {decode_profile}")
    if generation_attempt < 1:
        raise RuntimeError("Bounded decode profiles require a positive retry attempt")
    base_beams, base_length_penalty, minimum_word_length = profile
    variant = min(generation_attempt, 3) - 1
    beams = max(requested_beams, min(12, base_beams + variant * 2))
    penalty_adjustment = (0.0, -0.1, 0.1)[variant]
    length_penalty = round(base_length_penalty + penalty_adjustment, 3)
    return beams, length_penalty, minimum_word_length


def canonical_eos_token_id(tokenizer: Any) -> int:
    eos_token_id = getattr(tokenizer, "eos_token_id", None)
    if (
        isinstance(eos_token_id, bool)
        or not isinstance(eos_token_id, int)
        or eos_token_id < 0
    ):
        raise RuntimeError("NLLB tokenizer has no canonical integer EOS token id")
    return eos_token_id


def canonical_target_language_token_id(tokenizer: Any, target_code: str) -> int:
    if re.fullmatch(r"[a-z]{3}_[A-Z][a-z]{3}", target_code) is None:
        raise RuntimeError("NLLB target language code is malformed")
    token_id = tokenizer.convert_tokens_to_ids(target_code)
    unknown_token_id = getattr(tokenizer, "unk_token_id", None)
    if (
        isinstance(token_id, bool)
        or not isinstance(token_id, int)
        or token_id < 0
        or isinstance(unknown_token_id, bool)
        or not isinstance(unknown_token_id, int)
        or unknown_token_id < 0
        or token_id == unknown_token_id
    ):
        raise RuntimeError(
            "NLLB target language token id is missing, unknown, or non-canonical"
        )
    return token_id


def enable_primary_deterministic_algorithms() -> None:
    try:
        torch.use_deterministic_algorithms(True, warn_only=False)
    except (TypeError, RuntimeError) as error:
        raise RuntimeError(
            "Hard deterministic algorithms are unavailable for primary generation"
        ) from error
    if (
        not bool(torch.are_deterministic_algorithms_enabled())
        or bool(torch.is_deterministic_algorithms_warn_only_enabled())
    ):
        raise RuntimeError(
            "Hard deterministic algorithms did not remain enabled in hard mode"
        )


def prepare_deterministic_decode() -> None:
    if (
        not bool(torch.are_deterministic_algorithms_enabled())
        or bool(torch.is_deterministic_algorithms_warn_only_enabled())
    ):
        raise RuntimeError(
            "Hard deterministic algorithms drifted before a decode phase"
        )
    torch.manual_seed(PRIMARY_MANUAL_SEED)
    if (
        not bool(torch.are_deterministic_algorithms_enabled())
        or bool(torch.is_deterministic_algorithms_warn_only_enabled())
    ):
        raise RuntimeError(
            "Hard deterministic algorithms drifted while seeding a decode phase"
        )


def generate_translation_batch_once(
    model: Any,
    tokenizer: Any,
    device: str,
    target_code: str,
    values: list[str],
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    maximum_new_tokens: int,
    logits_processor: LogitsProcessorList,
    generation_attempt: int,
    decode_profile: Optional[str] = None,
    opaque_markers: tuple[str, ...] = (),
) -> list[str]:
    inputs = tokenizer(
        values,
        return_tensors="pt",
        padding=True,
        truncation=False,
    )
    input_length = int(inputs["attention_mask"].sum(dim=1).max().item())
    if input_length > max_source_tokens:
        raise RuntimeError(f"Bounded source segment unexpectedly uses {input_length} tokens")
    inputs = {key: value.to(device) for key, value in inputs.items()}
    max_new_tokens = min(maximum_new_tokens, max(48, input_length * 2 + 20))
    retry_beams = num_beams
    length_penalty = 1.0
    minimum_word_length: Optional[int] = None
    if decode_profile is not None:
        retry_beams, length_penalty, minimum_word_length = (
            retry_decode_profile_options(
                decode_profile,
                generation_attempt,
                num_beams,
            )
        )
    elif generation_attempt >= 1:
        retry_beams = max(num_beams, 4 if generation_attempt == 1 else 8)
        length_penalty = 0.9 if generation_attempt == 2 else (
            1.1 if generation_attempt >= 3 else 1.0
        )
        minimum_word_length = 4
    bad_words_ids = forbidden_source_token_sequences(
        tokenizer,
        values,
        minimum_word_length,
        opaque_markers,
    )
    retry_options: dict[str, Any] = {}
    if bad_words_ids:
        retry_options["bad_words_ids"] = bad_words_ids
    prepare_deterministic_decode()
    with torch.inference_mode():
        generated = model.generate(
            **inputs,
            forced_bos_token_id=canonical_target_language_token_id(
                tokenizer,
                target_code,
            ),
            do_sample=False,
            max_new_tokens=max_new_tokens,
            num_beams=retry_beams,
            no_repeat_ngram_size=no_repeat_ngram_size,
            length_penalty=length_penalty,
            logits_processor=logits_processor,
            **retry_options,
        )
    generated_rows = len(generated)
    if generated_rows != len(values):
        raise RuntimeError(
            "NLLB generated row cardinality mismatch: "
            f"expected {len(values)}, received {generated_rows}"
        )
    eos_token_id = canonical_eos_token_id(tokenizer)
    unterminated = [
        index
        for index, sequence in enumerate(generated)
        if not bool((sequence == eos_token_id).any().item())
    ]
    if unterminated:
        raise RuntimeError(
            f"NLLB output reached its token bound without EOS: {unterminated}"
        )
    outputs = [
        unicodedata.normalize("NFC", value)
        for value in tokenizer.batch_decode(generated.cpu(), skip_special_tokens=True)
    ]
    if len(outputs) != len(values):
        raise RuntimeError(
            "NLLB decoded row cardinality mismatch: "
            f"expected {len(values)}, received {len(outputs)}"
        )
    return outputs


def bounded_semantic_candidate_count(requested: int, beams: int) -> int:
    if not 1 <= requested <= 4:
        raise RuntimeError("Semantic retry candidate bound must be between one and four")
    if beams < 1:
        raise RuntimeError("Semantic retry beam count must be positive")
    return min(requested, beams)


def generate_translation_variants_once(
    model: Any,
    tokenizer: Any,
    device: str,
    target_code: str,
    value: str,
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    maximum_new_tokens: int,
    logits_processor: LogitsProcessorList,
    generation_attempt: int,
    decode_profile: str,
    opaque_markers: tuple[str, ...],
    maximum_candidates: int = 4,
) -> list[str]:
    """Generate deterministic N-best beams for one semantic retry segment."""

    if not 1 <= maximum_candidates <= 4:
        raise RuntimeError("Semantic retry candidate bound must be between one and four")
    inputs = tokenizer(
        [value],
        return_tensors="pt",
        padding=True,
        truncation=False,
    )
    input_length = int(inputs["attention_mask"].sum(dim=1).max().item())
    if input_length > max_source_tokens:
        raise RuntimeError(
            f"Bounded semantic retry segment unexpectedly uses {input_length} tokens"
        )
    inputs = {key: tensor.to(device) for key, tensor in inputs.items()}
    max_new_tokens = min(
        maximum_new_tokens,
        max(48, input_length * 2 + 20),
    )
    retry_beams, length_penalty, minimum_word_length = (
        retry_decode_profile_options(
            decode_profile,
            generation_attempt,
            num_beams,
        )
    )
    candidate_count = bounded_semantic_candidate_count(
        maximum_candidates,
        retry_beams,
    )
    bad_words_ids = forbidden_source_token_sequences(
        tokenizer,
        [value],
        minimum_word_length,
        opaque_markers,
    )
    retry_options: dict[str, Any] = {}
    if bad_words_ids:
        retry_options["bad_words_ids"] = bad_words_ids
    prepare_deterministic_decode()
    with torch.inference_mode():
        generated = model.generate(
            **inputs,
            forced_bos_token_id=canonical_target_language_token_id(
                tokenizer,
                target_code,
            ),
            do_sample=False,
            max_new_tokens=max_new_tokens,
            num_beams=retry_beams,
            num_return_sequences=candidate_count,
            no_repeat_ngram_size=no_repeat_ngram_size,
            length_penalty=length_penalty,
            logits_processor=logits_processor,
            **retry_options,
        )
    if len(generated) != candidate_count:
        raise RuntimeError(
            "NLLB semantic retry candidate cardinality mismatch: "
            f"expected {candidate_count}, received {len(generated)}"
        )
    eos_token_id = canonical_eos_token_id(tokenizer)
    if any(
        not bool((sequence == eos_token_id).any().item())
        for sequence in generated
    ):
        raise RuntimeError("NLLB semantic retry candidate reached its token bound")
    decoded = [
        unicodedata.normalize("NFC", candidate)
        for candidate in tokenizer.batch_decode(
            generated.cpu(),
            skip_special_tokens=True,
        )
    ]
    if len(decoded) != candidate_count:
        raise RuntimeError(
            "NLLB semantic retry decoded candidate cardinality mismatch: "
            f"expected {candidate_count}, received {len(decoded)}"
        )
    return list(dict.fromkeys(candidate for candidate in decoded if candidate.strip()))


def empty_output_diagnostics(values: list[str], indexes: list[int]) -> list[str]:
    return [
        f"{index}:{hashlib.sha256(values[index].encode('utf-8')).hexdigest()}"
        for index in indexes[:MAXIMUM_EMPTY_OUTPUT_DIAGNOSTICS]
    ]


def bounded_empty_output_recovery_profiles(
    active_profile: Optional[str],
) -> tuple[str, ...]:
    if active_profile is not None and active_profile not in RETRY_DECODE_PROFILES:
        raise RuntimeError(f"Unknown bounded decode profile: {active_profile}")
    return tuple(
        profile
        for profile in EMPTY_OUTPUT_RECOVERY_PROFILES
        if profile != active_profile
    )


def audited_empty_output_source_normalization(
    target_code: str,
    value: str,
) -> Optional[str]:
    source_sha256 = hashlib.sha256(value.encode("utf-8")).hexdigest()
    audited = AUDITED_EMPTY_OUTPUT_SOURCE_NORMALIZATIONS.get(
        (target_code, source_sha256)
    )
    if audited is None or value != audited[0]:
        return None
    return audited[1]


def is_empty_or_audited_source_echo(
    target_code: str,
    source: str,
    output: str,
) -> bool:
    if not output.strip():
        return True
    if audited_empty_output_source_normalization(target_code, source) is None:
        return False
    return (
        unicodedata.normalize("NFKC", output).strip().casefold()
        == unicodedata.normalize("NFKC", source).strip().casefold()
    )


def require_translation_output_cardinality(
    values: list[str],
    outputs: list[str],
    stage: str,
) -> None:
    if len(outputs) != len(values):
        raise RuntimeError(
            f"NLLB {stage} row cardinality mismatch: "
            f"expected {len(values)}, received {len(outputs)}"
        )


def translate_batch(
    model: Any,
    tokenizer: Any,
    device: str,
    target_code: str,
    values: list[str],
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    maximum_new_tokens: int,
    logits_processor: LogitsProcessorList,
    maximum_empty_retries: int,
    batch_offset: int,
    retry_attempt: int = 0,
    decode_profile: Optional[str] = None,
    opaque_markers: tuple[str, ...] = (),
) -> list[str]:
    """Translate a batch, selectively retrying only empty decoded rows."""

    if not 0 <= maximum_empty_retries <= 3:
        raise RuntimeError("Empty-output retry bound must be between zero and three")
    if batch_offset < 0:
        raise RuntimeError("Translation batch offset cannot be negative")
    outputs = generate_translation_batch_once(
        model,
        tokenizer,
        device,
        target_code,
        values,
        num_beams,
        no_repeat_ngram_size,
        max_source_tokens,
        maximum_new_tokens,
        logits_processor,
        retry_attempt,
        decode_profile,
        opaque_markers,
    )
    require_translation_output_cardinality(values, outputs, "translated")
    empty_indexes = [
        index
        for index, output in enumerate(outputs)
        if is_empty_or_audited_source_echo(
            target_code,
            values[index],
            output,
        )
    ]
    completed_empty_retries = 0
    while empty_indexes and completed_empty_retries < maximum_empty_retries:
        completed_empty_retries += 1
        print(
            json.dumps(
                {
                    "event": "long_tail_worker_empty_output_retry",
                    "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                    "targetCode": target_code,
                    "batchOffset": batch_offset,
                    "batchSize": len(values),
                    "emptyRows": len(empty_indexes),
                    "emptyRowDiagnostics": empty_output_diagnostics(
                        values,
                        empty_indexes,
                    ),
                    "retryRound": completed_empty_retries,
                    "maximumRetryRounds": maximum_empty_retries,
                }
            ),
            flush=True,
        )
        retry_values = [values[index] for index in empty_indexes]
        retry_outputs = generate_translation_batch_once(
            model,
            tokenizer,
            device,
            target_code,
            retry_values,
            num_beams,
            no_repeat_ngram_size,
            max_source_tokens,
            maximum_new_tokens,
            logits_processor,
            retry_attempt + completed_empty_retries,
            decode_profile,
            opaque_markers,
        )
        require_translation_output_cardinality(
            retry_values,
            retry_outputs,
            "selective-retry",
        )
        next_empty_indexes: list[int] = []
        for original_index, retry_output in zip(empty_indexes, retry_outputs):
            if is_empty_or_audited_source_echo(
                target_code,
                values[original_index],
                retry_output,
            ):
                next_empty_indexes.append(original_index)
                continue
            outputs[original_index] = retry_output
        empty_indexes = next_empty_indexes
    case_normalized_recovery_attempted = False
    recovery_profiles = bounded_empty_output_recovery_profiles(decode_profile)
    attempted_recovery_profiles: list[str] = []
    for recovery_attempt, recovery_profile in enumerate(
        recovery_profiles,
        start=1,
    ):
        if not empty_indexes:
            break
        attempted_recovery_profiles.append(recovery_profile)
        print(
            json.dumps(
                {
                    "event": "long_tail_worker_empty_output_recovery",
                    "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                    "targetCode": target_code,
                    "batchOffset": batch_offset,
                    "batchSize": len(values),
                    "emptyRows": len(empty_indexes),
                    "emptyRowDiagnostics": empty_output_diagnostics(
                        values,
                        empty_indexes,
                    ),
                    "recoveryAttempt": recovery_attempt,
                    "recoveryProfile": recovery_profile,
                    "maximumRecoveryAttempts": len(recovery_profiles),
                }
            ),
            flush=True,
        )
        recovery_values = [values[index] for index in empty_indexes]
        recovery_outputs = generate_translation_batch_once(
            model,
            tokenizer,
            device,
            target_code,
            recovery_values,
            num_beams,
            no_repeat_ngram_size,
            max_source_tokens,
            maximum_new_tokens,
            logits_processor,
            recovery_attempt,
            recovery_profile,
            opaque_markers,
        )
        require_translation_output_cardinality(
            recovery_values,
            recovery_outputs,
            f"empty-output-recovery-{recovery_profile}",
        )
        next_empty_indexes = []
        for original_index, recovery_output in zip(
            empty_indexes,
            recovery_outputs,
        ):
            if is_empty_or_audited_source_echo(
                target_code,
                values[original_index],
                recovery_output,
            ):
                next_empty_indexes.append(original_index)
                continue
            outputs[original_index] = recovery_output
        empty_indexes = next_empty_indexes
    case_normalized_rows = [
        (index, normalized)
        for index in empty_indexes
        if (
            normalized := audited_empty_output_source_normalization(
                target_code,
                values[index],
            )
        )
        is not None
    ]
    if case_normalized_rows:
        case_normalized_recovery_attempted = True
        case_indexes = [index for index, _ in case_normalized_rows]
        case_values = [normalized for _, normalized in case_normalized_rows]
        print(
            json.dumps(
                {
                    "event": "long_tail_worker_empty_output_case_recovery",
                    "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                    "targetCode": target_code,
                    "batchOffset": batch_offset,
                    "batchSize": len(values),
                    "emptyRows": len(empty_indexes),
                    "caseNormalizedRows": len(case_normalized_rows),
                    "caseNormalizedRowDiagnostics": empty_output_diagnostics(
                        values,
                        case_indexes,
                    ),
                    "recoveryProfile": EMPTY_OUTPUT_CASE_NORMALIZED_PROFILE,
                }
            ),
            flush=True,
        )
        case_outputs = generate_translation_batch_once(
            model,
            tokenizer,
            device,
            target_code,
            case_values,
            num_beams,
            no_repeat_ngram_size,
            max_source_tokens,
            maximum_new_tokens,
            logits_processor,
            1,
            EMPTY_OUTPUT_CASE_NORMALIZED_PROFILE,
            opaque_markers,
        )
        require_translation_output_cardinality(
            case_values,
            case_outputs,
            "empty-output-case-recovery",
        )
        recovered_case_indexes: set[int] = set()
        for (original_index, _), case_output in zip(
            case_normalized_rows,
            case_outputs,
        ):
            if is_empty_or_audited_source_echo(
                target_code,
                values[original_index],
                case_output,
            ):
                continue
            outputs[original_index] = case_output
            recovered_case_indexes.add(original_index)
        empty_indexes = [
            index for index in empty_indexes if index not in recovered_case_indexes
        ]
    if empty_indexes:
        diagnostics = empty_output_diagnostics(values, empty_indexes)
        omitted = len(empty_indexes) - len(diagnostics)
        raise EmptyOutputGenerationRetryExhausted(
            target_code=target_code,
            batch_offset=batch_offset,
            batch_size=len(values),
            completed_empty_retry_rounds=completed_empty_retries,
            case_normalized_recovery_attempted=(
                case_normalized_recovery_attempted
            ),
            attempted_recovery_profiles=tuple(attempted_recovery_profiles),
            row_diagnostics=diagnostics,
            omitted_rows=omitted,
        )
    return outputs


def populate_language_source_memory(
    entries: list[dict[str, Any]],
    locale: str,
    target_code: str,
    model: Any,
    tokenizer: Any,
    device: str,
    batch_size: int,
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    max_new_tokens: int,
    max_empty_retries: int,
    logits_processor: LogitsProcessorList,
    forced_generation_source_keys: frozenset[tuple[str, str]],
    source_memory: dict[tuple[str, str], str],
    source_texts: dict[tuple[str, str], str],
) -> tuple[int, int, frozenset[tuple[str, str]]]:
    pending: dict[tuple[str, str], tuple[dict[str, Any], list[tuple[bool, str]]]] = {}
    segment_texts: dict[str, str] = {}
    forced_segment_sha256s: set[str] = set()
    for entry in entries:
        source_key = (locale, entry["sourceSha256"])
        prior_source = source_texts.get(source_key)
        if prior_source is not None and prior_source != entry["source"]:
            raise RuntimeError("SHA-256 collision in exact-source translation memory")
        source_texts[source_key] = entry["source"]
        if source_key in pending or (
            source_key in source_memory
            and source_key not in forced_generation_source_keys
        ):
            continue
        parts = source_parts(entry)
        pending[source_key] = (entry, parts)
        for is_text, value in parts:
            if not is_text:
                continue
            segment_sha256 = hashlib.sha256(value.encode("utf-8")).hexdigest()
            prior_segment = segment_texts.get(segment_sha256)
            if prior_segment is not None and prior_segment != value:
                raise RuntimeError("SHA-256 collision in protected-segment cache")
            segment_texts[segment_sha256] = value
            if source_key in forced_generation_source_keys:
                forced_segment_sha256s.add(segment_sha256)
    ordered = sorted(segment_texts.items(), key=lambda item: (len(item[1]), item[1]))
    ordered_cohorts = (
        [pair for pair in ordered if pair[0] in forced_segment_sha256s],
        [pair for pair in ordered if pair[0] not in forced_segment_sha256s],
    )
    translated_segments: dict[str, str] = {}
    cohort_offset = 0
    for cohort in ordered_cohorts:
        for offset in range(0, len(cohort), batch_size):
            batch_pairs = cohort[offset : offset + batch_size]
            batch = [value for _, value in batch_pairs]
            outputs = translate_batch(
                model,
                tokenizer,
                device,
                target_code,
                batch,
                num_beams,
                no_repeat_ngram_size,
                max_source_tokens,
                max_new_tokens,
                logits_processor,
                maximum_empty_retries=max_empty_retries,
                batch_offset=cohort_offset + offset,
            )
            for (segment_sha256, _), translated in zip(batch_pairs, outputs):
                translated_segments[segment_sha256] = translated
        cohort_offset += len(cohort)
    for source_key, (entry, parts) in pending.items():
        translated = unicodedata.normalize(
            "NFC",
            "".join(
                translated_segments[hashlib.sha256(value.encode("utf-8")).hexdigest()]
                if is_text
                else value
                for is_text, value in parts
            ),
        )
        if not translated:
            raise RuntimeError(f"Generated empty translation for {entry['key']}")
        source_memory[source_key] = translated
    return len(pending), len(translated_segments), frozenset(pending)


def adopt_reviewed_generation_overrides(
    entries: list[dict[str, Any]],
    locale: str,
    generation_overrides: dict[tuple[str, str], dict[str, Any]],
    source_memory: dict[tuple[str, str], str],
    retryable_source_keys: frozenset[tuple[str, str]],
) -> tuple[frozenset[tuple[str, str]], int]:
    exact_sources: dict[str, str] = {}
    for entry in entries:
        prior_source = exact_sources.get(entry["sourceSha256"])
        if prior_source is not None and prior_source != entry["source"]:
            raise RuntimeError("SHA-256 collision in generation override cohort")
        exact_sources[entry["sourceSha256"]] = entry["source"]
    required_keys = {
        (locale, entry["sourceSha256"])
        for entry in entries
        if (locale, entry["sourceSha256"]) in generation_overrides
    }
    reviewed_values: dict[tuple[str, str], str] = {}
    for source_key in sorted(required_keys):
        override = generation_overrides[source_key]
        if source_key not in source_memory:
            raise RuntimeError(
                "Generation override source was omitted from the initial decode cohort"
            )
        if override["source"] != exact_sources.get(source_key[1]):
            raise RuntimeError("Generation override source binding drifted")
        reviewed_values[source_key] = override["value"]
    # No generated override value is observable by validation, retry, or
    # persistence: all reviewed replacements are adopted in one dict update.
    source_memory.update(reviewed_values)
    return (
        frozenset(retryable_source_keys.difference(required_keys)),
        len(reviewed_values),
    )


def ordered_retry_decode_profiles(reasons: Counter[str]) -> tuple[str, ...]:
    if reasons["negation-marker-missing"]:
        return ("coverage", "balanced", "wide")
    if reasons["source-equality"]:
        return ("wide", "balanced", "coverage")
    if any(
        reasons[reason]
        for reason in (
            "invariant-parity",
            "placeholder-parity",
            "protected-literal-parity",
            "url-parity",
            "email-parity",
            "number-parity",
        )
    ):
        return ("balanced", "coverage", "wide")
    return ("balanced", "coverage", "wide")


def retry_failure_score(failures: Counter[str]) -> tuple[int, int, int, int]:
    hard = 0
    semantic = 0
    fluency = 0
    for reason, count in failures.items():
        if count < 1:
            raise RuntimeError("Retry failure counts must be positive")
        if reason in SEMANTIC_RETRY_FAILURE_REASONS:
            semantic += count
        elif reason in FLUENCY_RETRY_FAILURE_REASONS:
            fluency += count
        elif reason in HARD_RETRY_FAILURE_REASONS:
            hard += count
        else:
            # Unknown future validator failures remain fail-closed and hard.
            hard += count
    return hard, semantic, fluency, hard + semantic + fluency


def should_preserve_balanced_delimiters(
    validation: RetryCandidateValidation,
) -> bool:
    return (
        set(validation.failures) == {"field-fluency"}
        and validation.fluency_reasons == frozenset({"unbalanced-delimiters"})
    )


def should_use_repeated_token_n_best(
    validation: RetryCandidateValidation,
) -> bool:
    return (
        set(validation.failures) == {"field-fluency"}
        and validation.fluency_reasons == frozenset({"repeated-token-run"})
    )


def select_strictly_improved_retry_candidate(
    prior_value: str,
    prior_failures: Counter[str],
    candidates: list[tuple[str, str, Counter[str]]],
) -> tuple[str, Counter[str], Optional[str]]:
    """Preserve the prior on ties and never trade parity for fluency."""

    best_value = prior_value
    best_failures = Counter(prior_failures)
    best_score = retry_failure_score(best_failures)
    best_profile: Optional[str] = None
    for profile, value, failures in candidates:
        score = retry_failure_score(failures)
        if score >= best_score:
            continue
        best_value = value
        best_failures = Counter(failures)
        best_score = score
        best_profile = profile
        if score == (0, 0, 0, 0):
            break
    return best_value, best_failures, best_profile


def literal_local_context_parts(
    parts: list[tuple[bool, str]],
    markers: tuple[tuple[str, str], ...],
) -> list[tuple[bool, str]]:
    """Split a multi-literal clause into exact one-literal local windows."""

    expanded: list[tuple[bool, str]] = []
    for is_text, value in parts:
        if not is_text:
            expanded.append((False, value))
            continue
        local_markers = [
            marker
            for marker, _ in markers
            if marker in value
        ]
        if len(local_markers) <= 1:
            expanded.append((True, value))
            continue
        positions = [value.index(marker) for marker in local_markers]
        if positions != sorted(positions):
            raise RuntimeError("Opaque literal marker order drifted inside its clause")
        boundaries = [0, *positions[1:], len(value)]
        for start, end in zip(boundaries, boundaries[1:]):
            window = value[start:end]
            if sum(window.count(marker) for marker in local_markers) != 1:
                raise RuntimeError(
                    "Literal-local context window does not contain exactly one marker"
                )
            expanded.append((True, window))
    if "".join(value for _, value in expanded) != "".join(
        value for _, value in parts
    ):
        raise RuntimeError("Literal-local context windows do not reconstruct clauses")
    for marker, _ in markers:
        if sum(value.count(marker) for _, value in expanded) != 1:
            raise RuntimeError("Opaque literal marker cardinality drifted across windows")
    return expanded


def isolate_balanced_structural_delimiters(
    parts: list[tuple[bool, str]],
) -> list[tuple[bool, str]]:
    """Keep balanced parentheses/brackets out of model-generated bytes."""

    if not has_balanced_structural_delimiters(parts):
        return parts
    isolated: list[tuple[bool, str]] = []
    for is_text, value in parts:
        if not is_text:
            isolated.append((False, value))
            continue
        cursor = 0
        for match in STRUCTURAL_RETRY_DELIMITER.finditer(value):
            if match.start() > cursor:
                fragment = value[cursor : match.start()]
                isolated.append((bool(ASCII_LETTER.search(fragment)), fragment))
            isolated.append((False, match.group(0)))
            cursor = match.end()
        if cursor < len(value):
            fragment = value[cursor:]
            isolated.append((bool(ASCII_LETTER.search(fragment)), fragment))
    if "".join(value for _, value in isolated) != "".join(
        value for _, value in parts
    ):
        raise RuntimeError("Structural retry parts do not reconstruct source")
    return isolated


def has_balanced_structural_delimiters(
    parts: list[tuple[bool, str]],
) -> bool:
    opening = {"(", "["}
    matching_opening = {")": "(", "]": "["}
    stack: list[str] = []
    for _, value in parts:
        for character in value:
            if character in opening:
                stack.append(character)
            elif character in matching_opening:
                if not stack or stack.pop() != matching_opening[character]:
                    return False
    return not stack


def translate_literal_context_part(
    value: str,
    markers: tuple[tuple[str, str], ...],
    target_code: str,
    model: Any,
    tokenizer: Any,
    device: str,
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    max_new_tokens: int,
    max_empty_retries: int,
    logits_processor: LogitsProcessorList,
    retry_attempt: int,
    decode_profile: str,
    part_index: int,
) -> str:
    """Translate one literal-local window and restore it before assembly."""

    untranslated = value
    for marker, _ in markers:
        untranslated = untranslated.replace(marker, "")
    if (
        not ASCII_LETTER.search(untranslated)
        or STRUCTURED_CITATION_CONTEXT.fullmatch(untranslated) is not None
    ):
        return restore_opaque_literals_with_source_boundaries(
            value,
            value,
            markers,
        )
    profiles = (decode_profile,) + tuple(
        profile for profile in RETRY_DECODE_PROFILES if profile != decode_profile
    )
    opaque_markers = tuple(marker for marker, _ in markers)
    for profile in profiles:
        output = translate_batch(
            model,
            tokenizer,
            device,
            target_code,
            [value],
            num_beams,
            no_repeat_ngram_size,
            max_source_tokens,
            max_new_tokens,
            logits_processor,
            maximum_empty_retries=max_empty_retries,
            batch_offset=part_index,
            retry_attempt=retry_attempt,
            decode_profile=profile,
            opaque_markers=opaque_markers,
        )[0]
        try:
            return restore_opaque_literals_with_source_boundaries(
                output,
                value,
                markers,
            )
        except RuntimeError:
            continue
    raise DecodeProfileRejected(
        "No literal-local decode preserved exact marker identity"
    )


def quoted_alias_part(value: str) -> Optional[tuple[str, str, str, str]]:
    match = QUOTED_ALIAS_PART.fullmatch(value)
    if match is None:
        return None
    opening, alias, closing, suffix = match.groups()
    if (opening, closing) not in (("\"", "\""), ("“", "”")):
        return None
    return opening, alias, closing, suffix


def normalized_retry_words(value: str) -> list[str]:
    return [
        unicodedata.normalize("NFKC", match.group(0)).casefold()
        for match in RETRY_WORD.finditer(value)
    ]


def has_consecutive_retry_token_run(value: str, minimum_run: int) -> bool:
    if minimum_run < 2:
        raise RuntimeError("Retry token-run bound must be at least two")
    words = normalized_retry_words(value)
    run = 1
    for index in range(1, len(words)):
        run = run + 1 if words[index] == words[index - 1] else 1
        if run >= minimum_run:
            return True
    return False


def quoted_alias_repetition_groups(
    parts: list[tuple[bool, str]],
    translated_parts: list[str],
) -> list[tuple[int, ...]]:
    """Find distinct quoted aliases collapsed to one target-language token."""

    if len(parts) != len(translated_parts):
        raise RuntimeError("Translated clause assembly cardinality drifted")
    groups: list[tuple[int, ...]] = []
    current: list[int] = []
    current_word: Optional[str] = None

    def flush() -> None:
        nonlocal current, current_word
        aliases = [
            quoted_alias_part(parts[index][1])
            for index in current
        ]
        alias_values = [alias[1].casefold() for alias in aliases if alias]
        if (
            len(current) == len(LEGAL_QUOTED_ALIAS_SET)
            and frozenset(alias_values) == LEGAL_QUOTED_ALIAS_SET
        ):
            groups.append(tuple(current))
        current = []
        current_word = None

    for index, (is_text, source_value) in enumerate(parts):
        alias = quoted_alias_part(source_value) if is_text else None
        translated_words = normalized_retry_words(translated_parts[index])
        if alias is None or len(translated_words) != 1:
            if is_text or normalized_retry_words(source_value):
                flush()
            continue
        word = translated_words[0]
        if current:
            previous = current[-1]
            intervening_has_words = any(
                normalized_retry_words(value)
                for _, value in parts[previous + 1 : index]
            )
            if word != current_word or intervening_has_words:
                flush()
        if not current:
            current_word = word
        current.append(index)
    flush()
    return groups


def retry_echo_marker(encoded_source: str, part_index: int) -> str:
    for salt in range(32):
        prefix = "inspir_literalrepair" + (
            "" if salt == 0 else alphabetic_index(salt - 1)
        )
        marker = f"{{{prefix}_{alphabetic_index(part_index)}}}"
        if OPAQUE_LITERAL_MARKER.fullmatch(marker) and marker not in encoded_source:
            return marker
    raise RuntimeError("Could not create collision-free quoted-alias echo marker")


def repair_quoted_alias_repetitions(
    parts: list[tuple[bool, str]],
    translated_parts: list[str],
    target_code: str,
    model: Any,
    tokenizer: Any,
    device: str,
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    max_new_tokens: int,
    max_empty_retries: int,
    logits_processor: LogitsProcessorList,
    retry_attempt: int,
    decode_profile: str,
) -> None:
    """Disambiguate adjacent legal aliases that collapse to one target token."""

    groups = quoted_alias_repetition_groups(parts, translated_parts)
    if not groups:
        return
    encoded_source = "".join(value for _, value in parts)
    for group in groups:
        for part_index in group:
            alias = quoted_alias_part(parts[part_index][1])
            if alias is None:
                raise RuntimeError("Quoted alias repetition group lost its source alias")
            opening, source_alias, closing, suffix = alias
            marker = retry_echo_marker(encoded_source, part_index)
            translated_alias = translate_literal_context_part(
                f"{source_alias} ({marker})",
                ((marker, source_alias),),
                target_code,
                model,
                tokenizer,
                device,
                num_beams,
                no_repeat_ngram_size,
                max_source_tokens,
                max_new_tokens,
                max_empty_retries,
                logits_processor,
                retry_attempt,
                decode_profile,
                part_index,
            )
            if any(quote in translated_alias for quote in ('"', "“", "”")):
                raise DecodeProfileRejected(
                    "Quoted alias repair generated an unexpected quote"
                )
            translated_parts[part_index] = (
                f"{opening}{translated_alias}{closing}{suffix}"
            )
    if quoted_alias_repetition_groups(parts, translated_parts):
        raise DecodeProfileRejected(
            "Quoted alias repetition remained after bounded repair"
        )


def translate_retry_parts(
    parts: list[tuple[bool, str]],
    markers: tuple[tuple[str, str], ...],
    target_code: str,
    model: Any,
    tokenizer: Any,
    device: str,
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    max_new_tokens: int,
    max_empty_retries: int,
    logits_processor: LogitsProcessorList,
    retry_attempt: int,
    decode_profile: str,
    preserve_balanced_delimiters: bool = False,
) -> tuple[str, int]:
    if preserve_balanced_delimiters:
        parts = isolate_balanced_structural_delimiters(parts)
    parts = literal_local_context_parts(parts, markers)
    translated_parts = [value if not is_text else "" for is_text, value in parts]
    text_indexes = [index for index, (is_text, _) in enumerate(parts) if is_text]
    markers_by_index: dict[int, tuple[tuple[str, str], ...]] = {}
    for marker_pair in markers:
        marker = marker_pair[0]
        indexes = [
            index
            for index in text_indexes
            if marker in parts[index][1]
        ]
        if len(indexes) != 1 or parts[indexes[0]][1].count(marker) != 1:
            raise RuntimeError("Opaque literal marker lost its exact local context")
        markers_by_index[indexes[0]] = (
            *markers_by_index.get(indexes[0], ()),
            marker_pair,
        )
    for index, local_markers in markers_by_index.items():
        translated_parts[index] = translate_literal_context_part(
            parts[index][1],
            local_markers,
            target_code,
            model,
            tokenizer,
            device,
            num_beams,
            no_repeat_ngram_size,
            max_source_tokens,
            max_new_tokens,
            max_empty_retries,
            logits_processor,
            retry_attempt,
            decode_profile,
            index,
        )
    ordinary_indexes = [
        index for index in text_indexes if index not in markers_by_index
    ]
    _, _, minimum_word_length = retry_decode_profile_options(
        decode_profile,
        retry_attempt,
        num_beams,
    )
    group_size = 4 if minimum_word_length is None else 1
    for offset in range(0, len(ordinary_indexes), group_size):
        indexes = ordinary_indexes[offset : offset + group_size]
        values = [parts[index][1] for index in indexes]
        outputs = translate_batch(
            model,
            tokenizer,
            device,
            target_code,
            values,
            num_beams,
            no_repeat_ngram_size,
            max_source_tokens,
            max_new_tokens,
            logits_processor,
            maximum_empty_retries=max_empty_retries,
            batch_offset=indexes[0],
            retry_attempt=retry_attempt,
            decode_profile=decode_profile,
            opaque_markers=(),
        )
        for index, output in zip(indexes, outputs):
            translated_parts[index] = output
    repair_quoted_alias_repetitions(
        parts,
        translated_parts,
        target_code,
        model,
        tokenizer,
        device,
        num_beams,
        no_repeat_ngram_size,
        max_source_tokens,
        max_new_tokens,
        max_empty_retries,
        logits_processor,
        retry_attempt,
        decode_profile,
    )
    assembled = unicodedata.normalize("NFC", "".join(translated_parts))
    if any(marker in assembled for marker, _ in markers):
        raise DecodeProfileRejected(
            "Opaque literal marker bytes remain after clause assembly"
        )
    return assembled, len(text_indexes)


def translate_semantic_retry_parts(
    parts: list[tuple[bool, str]],
    markers: tuple[tuple[str, str], ...],
    target_code: str,
    model: Any,
    tokenizer: Any,
    device: str,
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    max_new_tokens: int,
    logits_processor: LogitsProcessorList,
    retry_attempt: int,
    decode_profile: str,
) -> tuple[list[str], int]:
    """Build at most four deterministic N-best whole-field candidates."""

    opaque_markers = tuple(marker for marker, _ in markers)
    variants_by_index: dict[int, list[str]] = {}
    translated_segments = 0
    for part_index, (is_text, value) in enumerate(parts):
        if not is_text:
            continue
        if SOURCE_NEGATION.search(value):
            variants = generate_translation_variants_once(
                model,
                tokenizer,
                device,
                target_code,
                value,
                num_beams,
                no_repeat_ngram_size,
                max_source_tokens,
                max_new_tokens,
                logits_processor,
                retry_attempt,
                decode_profile,
                opaque_markers,
            )
        else:
            variants = translate_batch(
                model,
                tokenizer,
                device,
                target_code,
                [value],
                num_beams,
                no_repeat_ngram_size,
                max_source_tokens,
                max_new_tokens,
                logits_processor,
                maximum_empty_retries=1,
                batch_offset=part_index,
                retry_attempt=retry_attempt,
                decode_profile=decode_profile,
                opaque_markers=opaque_markers,
            )
        if not variants:
            raise DecodeProfileRejected(
                "Semantic retry generated no candidate variants"
            )
        variants_by_index[part_index] = variants
        translated_segments += 1
    if not any(
        SOURCE_NEGATION.search(value)
        for is_text, value in parts
        if is_text
    ):
        raise RuntimeError("Semantic retry has no explicit source negation segment")
    candidate_count = min(
        4,
        max(len(variants) for variants in variants_by_index.values()),
    )
    candidates: list[str] = []
    for candidate_index in range(candidate_count):
        encoded = unicodedata.normalize(
            "NFC",
            "".join(
                variants_by_index[index][
                    min(candidate_index, len(variants_by_index[index]) - 1)
                ]
                if is_text
                else value
                for index, (is_text, value) in enumerate(parts)
            ),
        )
        try:
            restored = restore_opaque_literals(encoded, markers)
        except RuntimeError:
            continue
        if restored not in candidates:
            candidates.append(restored)
    return candidates, translated_segments


def translate_repeated_token_retry_variants(
    entry: dict[str, Any],
    target_code: str,
    model: Any,
    tokenizer: Any,
    device: str,
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    max_new_tokens: int,
    logits_processor: LogitsProcessorList,
    retry_attempt: int,
    decode_profile: str,
) -> tuple[list[str], int]:
    """Retry a degenerate segmented field as one bounded semantic unit."""

    source = entry.get("source")
    if not isinstance(source, str) or not ASCII_LETTER.search(source):
        raise RuntimeError("Repeated-token retry source is not translatable text")
    if opaque_literal_markers(entry):
        raise RuntimeError(
            "Whole-field repeated-token retry cannot contain protected literals"
        )
    # Validate the source contract before deliberately bypassing clause splitting.
    source_parts(entry)
    variants = generate_translation_variants_once(
        model,
        tokenizer,
        device,
        target_code,
        source,
        num_beams,
        no_repeat_ngram_size,
        max_source_tokens,
        max_new_tokens,
        logits_processor,
        retry_attempt,
        decode_profile,
        (),
    )
    if not variants:
        raise DecodeProfileRejected(
            "Repeated-token N-best retry generated no candidates"
        )
    return variants, 1


def whole_field_retry_source_fits_token_bound(
    source: str,
    tokenizer: Any,
    max_source_tokens: int,
) -> bool:
    """Preflight whether whole-field N-best is an applicable retry strategy."""

    if not isinstance(source, str) or not ASCII_LETTER.search(source):
        raise RuntimeError("Repeated-token retry source is not translatable text")
    if max_source_tokens < 1:
        raise RuntimeError("Whole-field retry source-token bound must be positive")
    inputs = tokenizer(
        [source],
        return_tensors="pt",
        padding=True,
        truncation=False,
    )
    input_length = int(inputs["attention_mask"].sum(dim=1).max().item())
    return input_length <= max_source_tokens


def retry_source_entries(
    entries: list[dict[str, Any]],
    locale: str,
    target_code: str,
    model: Any,
    tokenizer: Any,
    device: str,
    batch_size: int,
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    max_new_tokens: int,
    max_empty_retries: int,
    logits_processor: LogitsProcessorList,
    retry_attempt: int,
    source_memory: dict[tuple[str, str], str],
    source_texts: dict[tuple[str, str], str],
    candidate_validator: Callable[
        [tuple[str, str], str],
        RetryCandidateValidation,
    ],
    evidence_phase: str | None = None,
    replica_index: int | None = None,
) -> tuple[int, int, int]:
    """Regenerate each exact failed source and retain only strict improvement."""

    if retry_attempt < 1:
        raise RuntimeError("Retry source generation requires a positive attempt")
    if evidence_phase is None:
        if replica_index is not None:
            raise RuntimeError("Retry replica evidence requires an explicit phase")
    elif (
        evidence_phase != "terminal-rescue"
        or isinstance(replica_index, bool)
        or not isinstance(replica_index, int)
        or replica_index < 0
        or replica_index >= TERMINAL_RESCUE_CONFIGURED_DECODES
        or device != "cpu"
    ):
        raise RuntimeError("Terminal rescue retry evidence is invalid")
    sources: dict[
        tuple[str, str],
        tuple[dict[str, Any], list[tuple[bool, str]]],
    ] = {}
    for entry in entries:
        source_key = (locale, entry["sourceSha256"])
        prior_source = source_texts.get(source_key)
        if prior_source is None or prior_source != entry["source"]:
            raise RuntimeError("Retry source differs from exact-source translation memory")
        prior_entry = sources.get(source_key)
        if prior_entry is not None:
            if prior_entry[0]["source"] != entry["source"]:
                raise RuntimeError("SHA-256 collision in retry source set")
            continue
        sources[source_key] = (entry, source_parts(entry))
    if not sources:
        raise RuntimeError("Strict validation failed without a retryable text segment")
    if batch_size < 1:
        raise RuntimeError("Retry batch size must be positive")
    translated_segment_count = 0
    improved_sources = 0
    for source_key, (entry, fallback_parts) in sorted(sources.items()):
        prior_value = source_memory[source_key]
        prior_validation = candidate_validator(source_key, prior_value)
        prior_failures = prior_validation.failures
        profiles = ordered_retry_decode_profiles(prior_failures)
        contextual_parts, markers = contextual_source_parts(entry)
        repeated_token_n_best = (
            should_use_repeated_token_n_best(prior_validation)
            and has_consecutive_retry_token_run(prior_value, 3)
            and not markers
        )
        if repeated_token_n_best:
            repeated_token_n_best = whole_field_retry_source_fits_token_bound(
                entry["source"],
                tokenizer,
                max_source_tokens,
            )
        semantic_retry = prior_failures["negation-marker-missing"] > 0
        retry_parts = (
            isolate_quoted_retry_parts(contextual_parts)
            if semantic_retry
            else contextual_parts
        )
        candidates: list[tuple[str, str, Counter[str]]] = []
        seen_values = {prior_value}
        contextual_passed = False
        for profile in profiles:
            if repeated_token_n_best:
                try:
                    profile_values, translated_segments = (
                        translate_repeated_token_retry_variants(
                            entry,
                            target_code,
                            model,
                            tokenizer,
                            device,
                            num_beams,
                            no_repeat_ngram_size,
                            max_source_tokens,
                            max_new_tokens,
                            logits_processor,
                            retry_attempt,
                            profile,
                        )
                    )
                except DecodeProfileRejected:
                    profile_values = []
                    translated_segments = 0
                translated_segment_count += translated_segments
                for candidate_index, value in enumerate(profile_values):
                    if not value or value in seen_values:
                        continue
                    seen_values.add(value)
                    validation = candidate_validator(source_key, value)
                    candidates.append(
                        (
                            f"whole-field-nbest-{profile}-{candidate_index + 1}",
                            value,
                            validation.failures,
                        )
                    )
                    if not validation.failures:
                        contextual_passed = True
                        break
                if contextual_passed:
                    break
            try:
                if semantic_retry:
                    profile_values, translated_segments = (
                        translate_semantic_retry_parts(
                            retry_parts,
                            markers,
                            target_code,
                            model,
                            tokenizer,
                            device,
                            num_beams,
                            no_repeat_ngram_size,
                            max_source_tokens,
                            max_new_tokens,
                            logits_processor,
                            retry_attempt,
                            profile,
                        )
                    )
                else:
                    value, translated_segments = translate_retry_parts(
                        retry_parts,
                        markers,
                        target_code,
                        model,
                        tokenizer,
                        device,
                        num_beams,
                        no_repeat_ngram_size,
                        max_source_tokens,
                        max_new_tokens,
                        max_empty_retries,
                        logits_processor,
                        retry_attempt,
                        profile,
                    )
                    profile_values = [value]
            except DecodeProfileRejected:
                # Marker corruption is a rejected decode profile, never restoration.
                continue
            translated_segment_count += translated_segments
            for candidate_index, value in enumerate(profile_values):
                if not value or value in seen_values:
                    continue
                seen_values.add(value)
                validation = candidate_validator(source_key, value)
                failures = validation.failures
                label = (
                    f"semantic-{profile}-{candidate_index + 1}"
                    if semantic_retry
                    else f"contextual-{profile}"
                )
                candidates.append((label, value, failures))
                if not failures:
                    contextual_passed = True
                    break
                if (
                    not semantic_retry
                    and should_preserve_balanced_delimiters(validation)
                    and has_balanced_structural_delimiters(retry_parts)
                ):
                    try:
                        delimiter_value, delimiter_segments = translate_retry_parts(
                            retry_parts,
                            markers,
                            target_code,
                            model,
                            tokenizer,
                            device,
                            num_beams,
                            no_repeat_ngram_size,
                            max_source_tokens,
                            max_new_tokens,
                            max_empty_retries,
                            logits_processor,
                            retry_attempt,
                            profile,
                            preserve_balanced_delimiters=True,
                        )
                    except DecodeProfileRejected:
                        delimiter_value = ""
                        delimiter_segments = 0
                    translated_segment_count += delimiter_segments
                    if delimiter_value and delimiter_value not in seen_values:
                        seen_values.add(delimiter_value)
                        delimiter_validation = candidate_validator(
                            source_key,
                            delimiter_value,
                        )
                        candidates.append(
                            (
                                f"contextual-{profile}-balanced-delimiters",
                                delimiter_value,
                                delimiter_validation.failures,
                            )
                        )
                        if not delimiter_validation.failures:
                            contextual_passed = True
                            break
            if contextual_passed:
                break
        if not contextual_passed:
            fallback_profile = profiles[-1]
            try:
                value, translated_segments = translate_retry_parts(
                    fallback_parts,
                    (),
                    target_code,
                    model,
                    tokenizer,
                    device,
                    num_beams,
                    no_repeat_ngram_size,
                    max_source_tokens,
                    max_new_tokens,
                    max_empty_retries,
                    logits_processor,
                    retry_attempt,
                    fallback_profile,
                )
            except DecodeProfileRejected as error:
                if retry_attempt >= max_empty_retries:
                    raise SourceDecodeProfilesRetryExhausted(
                        source_key[1],
                        retry_attempt,
                        profiles,
                    ) from error
                value = ""
                translated_segments = 0
            translated_segment_count += translated_segments
            if value and value not in seen_values:
                validation = candidate_validator(source_key, value)
                candidates.append(
                    (
                        f"segmented-{fallback_profile}",
                        value,
                        validation.failures,
                    )
                )
        selected_value, selected_failures, selected_profile = (
            select_strictly_improved_retry_candidate(
                prior_value,
                prior_failures,
                candidates,
            )
        )
        if selected_profile is not None:
            source_memory[source_key] = selected_value
            improved_sources += 1
        evidence = {
            "event": "long_tail_worker_retry_source",
            "executionProfileSha256": EXECUTION_PROFILE_SHA256,
            "sourceSha256": source_key[1],
            "retryAttempt": retry_attempt,
            "candidateProfiles": [profile for profile, _, _ in candidates],
            "selectedProfile": selected_profile,
            "priorReasons": dict(sorted(prior_failures.items())),
            "selectedReasons": dict(sorted(selected_failures.items())),
            "strictlyImproved": selected_profile is not None,
        }
        if evidence_phase is not None:
            evidence.update(
                {
                    "phase": evidence_phase,
                    "device": device,
                    "replicaIndex": replica_index,
                }
            )
        print(json.dumps(evidence), flush=True)
    return len(sources), translated_segment_count, improved_sources


def build_source_validation_references(
    language_packs: list[tuple[dict[str, Any], Path]],
) -> dict[tuple[str, str], list[tuple[dict[str, Any], tuple[str, ...]]]]:
    pending: dict[
        tuple[str, str],
        dict[int, tuple[dict[str, Any], list[str]]],
    ] = {}
    for pack, _ in language_packs:
        job = pack["job"]
        for entry in pack["source"]["entries"]:
            source_key = (job["locale"], entry["sourceSha256"])
            pack_references = pending.setdefault(source_key, {})
            pack_identity = id(pack)
            reference = pack_references.get(pack_identity)
            if reference is None:
                reference = (pack, [])
                pack_references[pack_identity] = reference
            reference[1].append(entry["key"])
    return {
        source_key: [
            (pack, tuple(keys))
            for pack, keys in pack_references.values()
        ]
        for source_key, pack_references in pending.items()
    }


def validate_exact_source_candidate(
    source_key: tuple[str, str],
    value: str,
    references: dict[
        tuple[str, str],
        list[tuple[dict[str, Any], tuple[str, ...]]],
    ],
    source_memory: dict[tuple[str, str], str],
    validator: TypeScriptCandidateValidator,
) -> RetryCandidateValidation:
    """Validate one whole candidate field in every source-bound pack context."""

    source_references = references.get(source_key)
    if not source_references:
        raise RuntimeError("Retry candidate has no exact source validation reference")
    prior_value = source_memory[source_key]
    source_memory[source_key] = value
    failures: Counter[str] = Counter()
    fluency_reasons: set[str] = set()
    try:
        for pack, keys in source_references:
            job = pack["job"]
            values = {
                entry["key"]: source_memory[
                    (job["locale"], entry["sourceSha256"])
                ]
                for entry in pack["source"]["entries"]
            }
            failures_by_key = {
                failure["key"]: failure
                for failure in validator.validate(pack, values)
            }
            for key in keys:
                failure = failures_by_key.get(key)
                if failure is None:
                    continue
                failures.update(failure["reasons"])
                fluency_reason = failure["fluencyReason"]
                if fluency_reason is not None:
                    fluency_reasons.add(fluency_reason)
    finally:
        source_memory[source_key] = prior_value
    return RetryCandidateValidation(failures, frozenset(fluency_reasons))


def load_translation_model(model_root: Path, device: str, dtype: str) -> Any:
    """Load one provenance-bound model instance for primary or rescue decoding."""

    if (
        not bool(torch.are_deterministic_algorithms_enabled())
        or bool(torch.is_deterministic_algorithms_warn_only_enabled())
    ):
        raise RuntimeError(
            "Hard deterministic algorithms must be enabled before model load"
        )
    if device not in ("cpu", "mps") or dtype not in ("float16", "float32"):
        raise RuntimeError("Translation model load configuration is invalid")
    if device == "cpu" and dtype != "float32":
        raise RuntimeError("CPU translation model loads require float32")
    model_dtype = torch.float16 if dtype == "float16" else torch.float32
    return AutoModelForSeq2SeqLM.from_pretrained(
        model_root,
        torch_dtype=model_dtype,
        local_files_only=True,
    ).to(device).eval()


def release_primary_mps_model() -> None:
    """Release the sole primary MPS model before loading a CPU rescue replica."""

    gc.collect()
    torch.mps.synchronize()
    torch.mps.empty_cache()


def terminal_rescue_scope(
    entries: list[dict[str, Any]],
    locale: str,
    source_memory: dict[tuple[str, str], str],
    source_texts: dict[tuple[str, str], str],
) -> tuple[list[dict[str, Any]], tuple[tuple[str, str], ...], str]:
    """Pin a bounded, unique set of exact failed sources before CPU rescue."""

    if not entries or len(entries) > MAXIMUM_TERMINAL_RESCUE_SOURCES:
        raise TerminalRescueFailed(
            "exact-source-scope-invalid",
            stage="scope-validation",
            subtype="source-count-out-of-bounds",
        )
    scoped: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in entries:
        source = entry.get("source")
        source_sha256 = entry.get("sourceSha256")
        if (
            not isinstance(source, str)
            or not isinstance(source_sha256, str)
            or hashlib.sha256(source.encode("utf-8")).hexdigest() != source_sha256
        ):
            raise TerminalRescueFailed(
                "exact-source-scope-invalid",
                stage="scope-validation",
                subtype="source-entry-integrity-failed",
            )
        source_key = (locale, source_sha256)
        if (
            source_key not in source_memory
            or source_texts.get(source_key) != source
        ):
            raise TerminalRescueFailed(
                "exact-source-scope-invalid",
                stage="scope-validation",
                subtype="source-memory-mismatch",
            )
        prior = scoped.get(source_key)
        if prior is not None and prior.get("source") != source:
            raise TerminalRescueFailed(
                "exact-source-scope-invalid",
                stage="scope-validation",
                subtype="duplicate-source-collision",
            )
        scoped[source_key] = entry
    if len(scoped) > MAXIMUM_TERMINAL_RESCUE_SOURCES:
        raise TerminalRescueFailed(
            "exact-source-scope-invalid",
            stage="scope-validation",
            subtype="source-count-out-of-bounds",
        )
    ordered_keys = tuple(sorted(scoped))
    ordered_entries = [scoped[key] for key in ordered_keys]
    source_set_material = [
        {
            "locale": key[0],
            "sourceSha256": key[1],
            "source": source_texts[key],
        }
        for key in ordered_keys
    ]
    return ordered_entries, ordered_keys, canonical_sha256(source_set_material)


def terminal_rescue_output_map(
    source_keys: tuple[tuple[str, str], ...],
    source_memory: dict[tuple[str, str], str],
    source_texts: dict[tuple[str, str], str],
) -> tuple[list[dict[str, str]], str]:
    records: list[dict[str, str]] = []
    for source_key in source_keys:
        value = source_memory.get(source_key)
        source = source_texts.get(source_key)
        if not isinstance(value, str) or not value or not isinstance(source, str):
            raise TerminalRescueFailed(
                "replica-invalid",
                stage="replica-output-map",
                subtype="missing-source-output",
            )
        records.append(
            {
                "locale": source_key[0],
                "sourceSha256": source_key[1],
                "source": source,
                "value": value,
                "valueSha256": hashlib.sha256(value.encode("utf-8")).hexdigest(),
            }
        )
    return records, canonical_sha256(records)


def run_terminal_rescue_replica(
    entries: list[dict[str, Any]],
    source_keys: tuple[tuple[str, str], ...],
    replica_index: int,
    locale: str,
    target_code: str,
    model_root: Path,
    tokenizer: Any,
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    max_new_tokens: int,
    max_empty_retries: int,
    logits_processor: LogitsProcessorList,
    source_memory: dict[tuple[str, str], str],
    source_texts: dict[tuple[str, str], str],
    source_validation_references: dict[
        tuple[str, str],
        list[tuple[dict[str, Any], tuple[str, ...]]],
    ],
    validator: TypeScriptCandidateValidator,
) -> tuple[dict[tuple[str, str], str], list[dict[str, str]], str, int]:
    """Run one fresh CPU-float32 rescue replica without mutating shared memory."""

    replica_memory = dict(source_memory)
    model: Any = None
    try:
        try:
            model = load_translation_model(model_root, "cpu", "float32")
        except Exception as error:
            raise TerminalRescueFailed(
                "model-load-or-generation-failed",
                error,
                stage="replica-model-load",
                subtype="model-load-error",
            ) from error
        try:
            retried_sources, retried_segments, improved_sources = (
                retry_source_entries(
                    entries,
                    locale,
                    target_code,
                    model,
                    tokenizer,
                    "cpu",
                    1,
                    num_beams,
                    no_repeat_ngram_size,
                    max_source_tokens,
                    max_new_tokens,
                    max_empty_retries,
                    logits_processor,
                    max_empty_retries,
                    replica_memory,
                    source_texts,
                    lambda source_key, candidate: validate_exact_source_candidate(
                        source_key,
                        candidate,
                        source_validation_references,
                        replica_memory,
                        validator,
                    ),
                    "terminal-rescue",
                    replica_index,
                )
            )
        except TerminalRescueFailed:
            raise
        except Exception as error:
            raise TerminalRescueFailed(
                "model-load-or-generation-failed",
                error,
                stage="replica-generation",
                subtype="generation-error",
            ) from error
        if retried_sources != len(source_keys):
            raise TerminalRescueFailed(
                "replica-invalid",
                stage="replica-generation",
                subtype="retry-source-count-mismatch",
            )
        if improved_sources != len(source_keys):
            raise TerminalRescueFailed(
                "replica-invalid",
                stage="replica-generation",
                subtype="no-strict-improvement",
            )
        try:
            for source_key in source_keys:
                validation = validate_exact_source_candidate(
                    source_key,
                    replica_memory[source_key],
                    source_validation_references,
                    replica_memory,
                    validator,
                )
                if validation.failures:
                    raise TerminalRescueFailed(
                        "replica-invalid",
                        stage="replica-validation",
                        subtype="post-generation-validation-failed",
                    )
        except TerminalRescueFailed:
            raise
        except Exception as error:
            raise TerminalRescueFailed(
                "model-load-or-generation-failed",
                error,
                stage="replica-validation",
                subtype="validation-error",
            ) from error
        records, output_map_sha256 = terminal_rescue_output_map(
            source_keys,
            replica_memory,
            source_texts,
        )
        return (
            {source_key: replica_memory[source_key] for source_key in source_keys},
            records,
            output_map_sha256,
            retried_segments,
        )
    finally:
        model = None
        gc.collect()


def run_deterministic_terminal_rescue(
    entries: list[dict[str, Any]],
    locale: str,
    target_code: str,
    primary_device: str,
    model_root: Path,
    tokenizer: Any,
    num_beams: int,
    no_repeat_ngram_size: int,
    max_source_tokens: int,
    max_new_tokens: int,
    max_empty_retries: int,
    logits_processor: LogitsProcessorList,
    source_memory: dict[tuple[str, str], str],
    source_texts: dict[tuple[str, str], str],
    source_validation_references: dict[
        tuple[str, str],
        list[tuple[dict[str, Any], tuple[str, ...]]],
    ],
    validator: TypeScriptCandidateValidator,
) -> TerminalRescueResult:
    """Require two independent, identical, strictly valid CPU rescue replicas."""

    policy = EXECUTION_PROFILE.get("terminalRescue")
    expected_policy = {
        "device": "cpu",
        "dtype": "float32",
        "independentDecodes": TERMINAL_RESCUE_CONFIGURED_DECODES,
        "deterministicAlgorithms": True,
    }
    if policy != expected_policy:
        raise TerminalRescueFailed(
            "configuration-invalid",
            stage="preflight",
            subtype="execution-profile-mismatch",
        )
    if primary_device != "mps":
        raise TerminalRescueFailed(
            "configuration-invalid",
            stage="preflight",
            subtype="primary-device-not-mps",
        )
    ordered_entries, source_keys, source_set_sha256 = terminal_rescue_scope(
        entries,
        locale,
        source_memory,
        source_texts,
    )
    if (
        int(torch.get_num_threads()) != EXECUTION_PROFILE["torch"]["intraopThreads"]
        or int(torch.get_num_interop_threads())
        != EXECUTION_PROFILE["torch"]["interopThreads"]
    ):
        raise TerminalRescueFailed(
            "determinism-unavailable",
            stage="determinism-setup",
            subtype="thread-count-mismatch",
        )
    try:
        if (
            not bool(torch.are_deterministic_algorithms_enabled())
            or bool(torch.is_deterministic_algorithms_warn_only_enabled())
        ):
            raise RuntimeError("primary hard-deterministic state is absent")
        torch.use_deterministic_algorithms(True, warn_only=False)
        if (
            not bool(torch.are_deterministic_algorithms_enabled())
            or bool(torch.is_deterministic_algorithms_warn_only_enabled())
        ):
            raise RuntimeError("rescue hard-deterministic state did not hold")
    except Exception as error:
        raise TerminalRescueFailed(
            "determinism-unavailable",
            error,
            stage="determinism-setup",
            subtype="algorithm-enable-failed",
        ) from error
    replicas: list[
        tuple[dict[tuple[str, str], str], list[dict[str, str]], str, int]
    ] = []
    attempted_replicas = 0
    completed_replicas = 0
    try:
        for replica_index in range(expected_policy["independentDecodes"]):
            attempted_replicas += 1
            try:
                torch.manual_seed(0)
                replica = run_terminal_rescue_replica(
                    ordered_entries,
                    source_keys,
                    replica_index,
                    locale,
                    target_code,
                    model_root,
                    tokenizer,
                    num_beams,
                    no_repeat_ngram_size,
                    max_source_tokens,
                    max_new_tokens,
                    max_empty_retries,
                    logits_processor,
                    source_memory,
                    source_texts,
                    source_validation_references,
                    validator,
                )
                replicas.append(replica)
                completed_replicas += 1
            except TerminalRescueFailed as error:
                error.bind_replica_progress(
                    attempted_replicas,
                    completed_replicas,
                    replica_index,
                )
                raise
            except Exception as error:
                raise TerminalRescueFailed(
                    "model-load-or-generation-failed",
                    error,
                    stage="replica-execution",
                    subtype="unexpected-error",
                    attempted_replicas=attempted_replicas,
                    completed_replicas=completed_replicas,
                    failing_replica_index=replica_index,
                ) from error
    finally:
        try:
            torch.use_deterministic_algorithms(True, warn_only=False)
            if (
                not bool(torch.are_deterministic_algorithms_enabled())
                or bool(torch.is_deterministic_algorithms_warn_only_enabled())
            ):
                raise RuntimeError(
                    "primary hard-deterministic state was not restored"
                )
        except Exception as error:
            raise TerminalRescueFailed(
                "determinism-unavailable",
                error,
                stage="determinism-restore",
                subtype="algorithm-restore-failed",
                attempted_replicas=attempted_replicas,
                completed_replicas=completed_replicas,
            ) from error
    if len(replicas) != TERMINAL_RESCUE_CONFIGURED_DECODES:
        raise TerminalRescueFailed(
            "configuration-invalid",
            stage="replica-aggregation",
            subtype="replica-count-mismatch",
            attempted_replicas=attempted_replicas,
            completed_replicas=completed_replicas,
        )
    first_values, first_records, first_sha256, first_segments = replicas[0]
    second_values, second_records, second_sha256, second_segments = replicas[1]
    if (
        first_values != second_values
        or first_records != second_records
        or first_sha256 != second_sha256
    ):
        raise TerminalRescueFailed(
            "replica-mismatch",
            stage="replica-comparison",
            subtype="output-map-mismatch",
            attempted_replicas=attempted_replicas,
            completed_replicas=completed_replicas,
        )
    return TerminalRescueResult(
        source_values=first_values,
        source_set_sha256=source_set_sha256,
        output_map_sha256=first_sha256,
        replica_output_map_sha256s=(first_sha256, second_sha256),
        rescued_sources=len(source_keys),
        retried_segments=first_segments + second_segments,
        attempted_replicas=attempted_replicas,
        completed_replicas=completed_replicas,
    )


def literals_appear_in_order(entry: dict[str, Any], value: str) -> bool:
    cursor = 0
    for segment in entry["segments"]:
        if segment["kind"] != "literal":
            continue
        index = value.find(segment["value"], cursor)
        if index < 0:
            return False
        cursor = index + len(segment["value"])
    return True


def existing_candidate_values(
    path: Path,
    pack: dict[str, Any],
) -> dict[str, str] | None:
    try:
        path.lstat()
    except FileNotFoundError:
        return None
    candidate = parse_strict_candidate_json(
        read_stable_private_candidate(path),
        path,
    )
    job = pack["job"]
    expected = {
        "schemaVersion": 1,
        "kind": CANDIDATE_KIND,
        "pipelineVersion": PIPELINE_VERSION,
        "executionProfileSha256": EXECUTION_PROFILE_SHA256,
        "masterWorklistSha256": pack["masterWorklistSha256"],
        "packWorklistSha256": pack["packWorklistSha256"],
        "jobSha256": job["jobSha256"],
        "language": job["language"],
        "locale": job["locale"],
        "namespace": job["namespace"],
        "sourceHash": job["sourceHash"],
        "sourceEntriesSha256": job["sourceEntriesSha256"],
        "modelLabel": pack["provenance"]["modelLabel"],
        "modelSha256": pack["provenance"]["modelSha256"],
        "workerImplementationSha256": pack["provenance"]["workerImplementationSha256"],
        "validatorPolicySha256": pack["provenance"]["validatorPolicy"][
            "validatorPolicySha256"
        ],
    }
    if (
        not isinstance(candidate, dict)
        or set(candidate) != set(expected) | {"entries"}
        or any(candidate.get(key) != value for key, value in expected.items())
    ):
        raise RuntimeError(f"Existing candidate has stale provenance: {path}")
    candidate_entries = candidate.get("entries")
    source_entries = pack["source"]["entries"]
    if not isinstance(candidate_entries, list) or len(candidate_entries) != len(source_entries):
        raise RuntimeError(f"Existing candidate has stale entry cardinality: {path}")
    values: dict[str, str] = {}
    for source_entry, candidate_entry in zip(source_entries, candidate_entries):
        if not isinstance(candidate_entry, dict) or set(candidate_entry) != {
            "key",
            "source",
            "sourceSha256",
            "value",
        }:
            raise RuntimeError(f"Existing candidate entry is malformed: {path}")
        if any(
            candidate_entry.get(key) != source_entry[key]
            for key in ("key", "source", "sourceSha256")
        ):
            raise RuntimeError(f"Existing candidate source binding drifted: {path}")
        value = candidate_entry.get("value")
        if (
            not isinstance(value, str)
            or not value
            or value != unicodedata.normalize("NFC", value)
            or not literals_appear_in_order(source_entry, value)
        ):
            raise RuntimeError(f"Existing candidate literal preservation failed: {path}")
        values[source_entry["key"]] = value
    return values


def remember_existing_candidate_values(
    pack: dict[str, Any],
    values: dict[str, str],
    generation_overrides: dict[tuple[str, str], dict[str, Any]],
    source_memory: dict[tuple[str, str], str],
    source_texts: dict[tuple[str, str], str],
) -> None:
    job = pack["job"]
    for entry in pack["source"]["entries"]:
        key = (job["locale"], entry["sourceSha256"])
        value = values[entry["key"]]
        prior_source = source_texts.get(key)
        if prior_source is not None and prior_source != entry["source"]:
            raise RuntimeError("SHA-256 collision in exact-source translation memory")
        source_texts[key] = entry["source"]
        override = generation_overrides.get(key)
        if override is not None:
            if value != override["value"]:
                raise RuntimeError(
                    "Existing candidate conflicts with reviewed generation override"
                )
            continue
        prior = source_memory.get(key)
        if prior is not None and prior != value:
            raise RuntimeError(
                f"Exact-source translation memory conflict for {job['locale']}: {entry['source'][:120]}"
            )
        source_memory[key] = value


def candidate_payload(pack: dict[str, Any], values: dict[str, str]) -> dict[str, Any]:
    job = pack["job"]
    entries = []
    for source_entry in pack["source"]["entries"]:
        entries.append(
            {
                "key": source_entry["key"],
                "source": source_entry["source"],
                "sourceSha256": source_entry["sourceSha256"],
                "value": values[source_entry["key"]],
            }
        )
    return {
        "schemaVersion": 1,
        "kind": CANDIDATE_KIND,
        "pipelineVersion": PIPELINE_VERSION,
        "executionProfileSha256": EXECUTION_PROFILE_SHA256,
        "masterWorklistSha256": pack["masterWorklistSha256"],
        "packWorklistSha256": pack["packWorklistSha256"],
        "jobSha256": job["jobSha256"],
        "language": job["language"],
        "locale": job["locale"],
        "namespace": job["namespace"],
        "sourceHash": job["sourceHash"],
        "sourceEntriesSha256": job["sourceEntriesSha256"],
        "modelLabel": pack["provenance"]["modelLabel"],
        "modelSha256": pack["provenance"]["modelSha256"],
        "workerImplementationSha256": pack["provenance"]["workerImplementationSha256"],
        "validatorPolicySha256": pack["provenance"]["validatorPolicy"][
            "validatorPolicySha256"
        ],
        "entries": entries,
    }


def assert_no_symlink_ancestors(path: Path) -> None:
    cursor = Path(path.anchor)
    for part in path.parts[1:]:
        cursor = cursor / part
        if cursor.is_symlink():
            raise RuntimeError(f"Candidate path contains a symbolic link: {cursor}")


def stable_candidate_file_identity(
    metadata: os.stat_result,
    path: Path,
) -> tuple[int, ...]:
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise RuntimeError(
            f"Candidate must be a regular non-symlink, single-link file: {path}"
        )
    if stat.S_IMODE(metadata.st_mode) != 0o600:
        raise RuntimeError(f"Candidate must have owner-only mode 0600: {path}")
    getuid = getattr(os, "getuid", None)
    if getuid is not None and metadata.st_uid != getuid():
        raise RuntimeError(f"Candidate is not owned by this user: {path}")
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_nlink,
        metadata.st_uid,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def read_stable_private_candidate(
    path: Path,
    maximum_bytes: int = MAXIMUM_JSON_BYTES,
) -> bytes:
    path_before = stable_candidate_file_identity(path.lstat(), path)
    if path_before[5] > maximum_bytes:
        raise RuntimeError(
            f"Candidate exceeds the {maximum_bytes}-byte bound: {path}"
        )
    no_follow = getattr(os, "O_NOFOLLOW", None)
    non_block = getattr(os, "O_NONBLOCK", None)
    if no_follow is None or non_block is None:
        raise RuntimeError("This platform cannot pin candidate file reads")
    try:
        descriptor = os.open(path, os.O_RDONLY | no_follow | non_block)
    except OSError as error:
        raise RuntimeError(f"Candidate changed before stable read: {path}") from error
    try:
        descriptor_before = stable_candidate_file_identity(
            os.fstat(descriptor),
            path,
        )
        if descriptor_before[5] > maximum_bytes:
            raise RuntimeError(
                f"Candidate exceeds the {maximum_bytes}-byte bound: {path}"
            )
        chunks: list[bytes] = []
        byte_count = 0
        while chunk := os.read(descriptor, 8 * 1024 * 1024):
            byte_count += len(chunk)
            if byte_count > maximum_bytes:
                raise RuntimeError(
                    f"Candidate exceeded the {maximum_bytes}-byte bound while reading: {path}"
                )
            chunks.append(chunk)
        descriptor_after = stable_candidate_file_identity(
            os.fstat(descriptor),
            path,
        )
    finally:
        os.close(descriptor)
    try:
        path_after = stable_candidate_file_identity(path.lstat(), path)
    except (FileNotFoundError, RuntimeError) as error:
        raise RuntimeError(f"Candidate changed during stable read: {path}") from error
    content = b"".join(chunks)
    if not (
        path_before == descriptor_before == descriptor_after == path_after
        and len(content) == descriptor_after[5]
    ):
        raise RuntimeError(f"Candidate changed during stable read: {path}")
    return content


def parse_strict_candidate_json(content: bytes, path: Path) -> Any:
    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        parsed: dict[str, Any] = {}
        for key, value in pairs:
            if key in parsed:
                raise RuntimeError(f"Existing candidate contains duplicate keys: {path}")
            parsed[key] = value
        return parsed

    try:
        decoded = content.decode("utf-8", errors="strict")
        return json.loads(decoded, object_pairs_hook=reject_duplicate_keys)
    except RuntimeError:
        raise
    except (UnicodeDecodeError, ValueError, TypeError) as error:
        raise RuntimeError(f"Existing candidate JSON is malformed: {path}") from error


def write_candidate_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    assert_no_symlink_ancestors(path.parent)
    encoded = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    try:
        path.lstat()
    except FileNotFoundError:
        pass
    else:
        if read_stable_private_candidate(path) == encoded:
            return
        raise RuntimeError(f"Refusing to replace conflicting candidate: {path}")
    temporary = path.with_name(f"{path.name}.tmp-{os.getpid()}-{uuid.uuid4()}")
    descriptor: int | None = None
    temporary_identity: tuple[int, int] | None = None
    created_target = False
    completed = False
    try:
        no_follow = getattr(os, "O_NOFOLLOW", None)
        non_block = getattr(os, "O_NONBLOCK", None)
        if no_follow is None or non_block is None:
            raise RuntimeError("This platform cannot create pinned candidate files")
        descriptor = os.open(
            temporary,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY | no_follow,
            0o600,
        )
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            descriptor = None
            os.fchmod(handle.fileno(), 0o600)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
            temporary_metadata = os.fstat(handle.fileno())
            temporary_identity = (
                temporary_metadata.st_dev,
                temporary_metadata.st_ino,
            )
        try:
            os.link(temporary, path, follow_symlinks=False)
            created_target = True
        except FileExistsError:
            pass
        if created_target:
            temporary.unlink()
        directory_fd = os.open(
            path.parent,
            os.O_RDONLY
            | no_follow
            | non_block
            | getattr(os, "O_DIRECTORY", 0),
        )
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        if read_stable_private_candidate(path) != encoded:
            raise RuntimeError(f"Candidate changed concurrently: {path}")
        completed = True
    finally:
        if descriptor is not None:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)
        if created_target and not completed and temporary_identity is not None:
            try:
                target_metadata = path.lstat()
            except FileNotFoundError:
                pass
            else:
                if (
                    target_metadata.st_dev,
                    target_metadata.st_ino,
                ) == temporary_identity:
                    path.unlink()


def checkpoint_validated_language_candidates(
    language_packs: list[tuple[dict[str, Any], Path]],
    failed_packs: list[tuple[dict[str, Any], list[dict[str, Any]]]],
    source_memory: dict[tuple[str, str], str],
) -> dict[str, int]:
    """Persist only packs proven independent of the exhausted failures.

    A passing pack that references a source which failed in another context is
    deliberately withheld.  Otherwise a resumed run could seed that old value
    from the checkpoint and later generate a different value for the failed
    context, violating exact-source consistency across packs.
    """

    failed_job_sha256s = {
        pack["job"]["jobSha256"] for pack, _failures in failed_packs
    }
    failed_source_keys: set[tuple[str, str]] = set()
    for pack, failures in failed_packs:
        job = pack["job"]
        entries_by_key = {
            entry["key"]: entry for entry in pack["source"]["entries"]
        }
        for failure in failures:
            entry = entries_by_key[failure["key"]]
            failed_source_keys.add((job["locale"], entry["sourceSha256"]))

    written_packs = 0
    shared_source_blocked_packs = 0
    for pack, candidate_path in language_packs:
        job = pack["job"]
        if job["jobSha256"] in failed_job_sha256s:
            continue
        pack_source_keys = {
            (job["locale"], entry["sourceSha256"])
            for entry in pack["source"]["entries"]
        }
        if pack_source_keys & failed_source_keys:
            shared_source_blocked_packs += 1
            continue
        values = {
            entry["key"]: source_memory[(job["locale"], entry["sourceSha256"])]
            for entry in pack["source"]["entries"]
        }
        write_candidate_atomic(candidate_path, candidate_payload(pack, values))
        written_packs += 1

    return {
        "writtenPacks": written_packs,
        "failedPacks": len(failed_packs),
        "sharedSourceBlockedPacks": shared_source_blocked_packs,
        "blockedPacks": len(failed_packs) + shared_source_blocked_packs,
        "blockedSources": len(failed_source_keys),
    }


def main() -> int:
    args = parse_args()
    assert_runtime_execution_profile()
    execution_profile = validate_execution_profile(
        parse_strict_execution_profile_json(args.execution_profile_json),
        args.execution_profile_sha256,
    )
    if args.worker_count < 1 or not 0 <= args.worker_index < args.worker_count:
        raise RuntimeError("Worker index/count contract is invalid")
    if (
        args.batch_size < 1
        or args.num_beams < 1
        or args.no_repeat_ngram_size < 0
        or not 1 <= args.max_source_tokens <= 1022
        or not 1 <= args.max_new_tokens <= 1022
        or not 1 <= args.max_retry_attempts <= 3
    ):
        raise RuntimeError("Generation integer configuration is invalid")
    if args.worker_count > 1 and args.device != "cpu":
        raise RuntimeError("Multiple resident workers are only permitted on CPU")
    if args.device == "cpu" and args.dtype != "float32":
        raise RuntimeError("CPU generation requires float32")
    model_sha256 = validate_hash(args.model_sha256, "requested model hash")
    worker_sha256 = validate_hash(
        args.worker_implementation_sha256,
        "requested worker implementation hash",
    )
    pipeline_sha256 = validate_hash(
        args.pipeline_implementation_sha256,
        "requested pipeline implementation hash",
    )
    validator_policy_sha256 = validate_hash(
        args.validator_policy_sha256,
        "requested validator policy hash",
    )
    if implementation_sha256() != worker_sha256:
        raise RuntimeError("Worker implementation bytes changed after provenance creation")
    model_root = Path(args.model).resolve()
    pipeline_script = Path(args.pipeline_script).resolve()
    node = Path(args.node).resolve()
    if not pipeline_script.is_file() or pipeline_script.is_symlink():
        raise RuntimeError("TypeScript validation policy is not a regular local file")
    if not node.is_file() or node.is_symlink() or not os.access(node, os.X_OK):
        raise RuntimeError("Node runtime is not an executable regular local file")
    master_path = Path(args.master_worklist).resolve()
    worklist_root = Path(args.worklist_root).resolve()
    candidate_root = Path(args.candidate_root).resolve()
    master = validate_master(
        read_json(master_path, MAXIMUM_MASTER_WORKLIST_BYTES)
    )
    provenance = master["provenance"]
    if provenance.get("executionProfile") != execution_profile:
        raise RuntimeError("Master worklist execution profile differs from request")
    assert_current_validator_policy(
        pipeline_script.parent.parent,
        provenance.get("validatorPolicy"),
        validator_policy_sha256,
    )
    seed_entries = validated_seed_entries(master)
    generation_overrides = validated_generation_overrides(
        master,
        seed_entries,
    )
    if provenance.get("modelSha256") != model_sha256:
        raise RuntimeError("Master worklist is bound to a different model")
    if provenance.get("workerImplementationSha256") != worker_sha256:
        raise RuntimeError("Master worklist is bound to a different worker")
    if provenance.get("pipelineImplementationSha256") != pipeline_sha256:
        raise RuntimeError("Master worklist is bound to a different validation policy")
    generation = provenance.get("generationConfig")
    expected_generation = {
        "batchSize": args.batch_size,
        "numBeams": args.num_beams,
        "noRepeatNgramSize": args.no_repeat_ngram_size,
        "dtype": args.dtype,
        "device": args.device,
        "maxSourceTokens": args.max_source_tokens,
        "maxNewTokens": args.max_new_tokens,
        "maxRetryAttempts": args.max_retry_attempts,
        "deterministicAlgorithms": True,
        "manualSeed": PRIMARY_MANUAL_SEED,
    }
    if generation != expected_generation:
        raise RuntimeError("Worker arguments differ from source-bound generation config")
    jobs = master["jobs"]
    languages = sorted({job["language"] for job in jobs})
    if len(languages) > MAXIMUM_ASSIGNED_LANGUAGES:
        raise RuntimeError(
            "Master worklist exceeds the bounded assigned-language count"
        )
    assigned_languages = {
        language
        for index, language in enumerate(languages)
        if index % args.worker_count == args.worker_index
    }
    assigned_jobs = [job for job in jobs if job["language"] in assigned_languages]
    packs: list[tuple[dict[str, Any], Path]] = []
    source_memory: dict[tuple[str, str], str] = {}
    source_texts: dict[tuple[str, str], str] = {}
    for entry in seed_entries:
        if entry["language"] not in assigned_languages:
            continue
        key = (entry["locale"], entry["sourceSha256"])
        prior_source = source_texts.get(key)
        if prior_source is not None and prior_source != entry["source"]:
            raise RuntimeError("SHA-256 collision in seed translation memory")
        prior_value = source_memory.get(key)
        if prior_value is not None and prior_value != entry["value"]:
            raise RuntimeError("Conflicting exact-source seed translation memory")
        source_texts[key] = entry["source"]
        if key in generation_overrides:
            continue
        source_memory[key] = entry["value"]
    for job in assigned_jobs:
        worklist_path = contained_path(worklist_root, job["worklistRelativePath"])
        pack = validate_pack(
            read_json(worklist_path),
            master,
            job,
            model_sha256,
            worker_sha256,
        )
        candidate_path = contained_path(candidate_root, job["candidateRelativePath"])
        existing = existing_candidate_values(candidate_path, pack)
        if existing is None:
            packs.append((pack, candidate_path))
            continue
        remember_existing_candidate_values(
            pack,
            existing,
            generation_overrides,
            source_memory,
            source_texts,
        )
    print(
        json.dumps(
            {
                "event": "long_tail_worker_start",
                "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                "workerIndex": args.worker_index,
                "workerCount": args.worker_count,
                "languages": sorted(assigned_languages),
                "pendingPacks": len(packs),
                "cachedSources": len(source_memory),
            }
        ),
        flush=True,
    )
    if not packs:
        return 0
    if args.device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was requested but is unavailable")
    device = args.device if args.device != "auto" else (
        "mps" if torch.backends.mps.is_available() else "cpu"
    )
    if device == "cpu" and args.dtype != "float32":
        raise RuntimeError("Resolved CPU execution requires float32 provenance")
    enable_primary_deterministic_algorithms()
    if hash_model(model_root) != model_sha256:
        raise RuntimeError("Local model bytes differ from the source-bound provenance")
    tokenizer = AutoTokenizer.from_pretrained(
        model_root,
        src_lang="eng_Latn",
        local_files_only=True,
    )
    canonical_eos_token_id(tokenizer)
    for target_code in sorted({job["nllbCode"] for job in assigned_jobs}):
        canonical_target_language_token_id(tokenizer, target_code)
    logits_processor = numeric_logits_processor(tokenizer)
    model: Any | None = load_translation_model(model_root, device, args.dtype)
    packs_by_language: dict[str, list[tuple[dict[str, Any], Path]]] = {}
    for pack, candidate_path in packs:
        packs_by_language.setdefault(pack["job"]["language"], []).append(
            (pack, candidate_path)
        )
    generated = 0
    total_retry_rounds = 0
    total_retried_sources = 0
    total_retried_segments = 0
    total_improved_sources = 0
    retry_reason_counts: Counter[str] = Counter()
    failed_languages: list[
        LanguageValidationRetryExhausted
        | LanguageSourceGenerationRetryExhausted
    ] = []
    validator = TypeScriptCandidateValidator(
        node,
        pipeline_script,
        pipeline_sha256,
        validator_policy_sha256,
    )
    try:
        language_order = sorted(packs_by_language)
        for language_index, language in enumerate(language_order):
            more_languages = language_index + 1 < len(language_order)
            language_packs = packs_by_language[language]
            first_job = language_packs[0][0]["job"]
            language_retry_rounds = 0
            language_retried_sources = 0
            language_retried_segments = 0
            language_improved_sources = 0
            language_failed = False
            terminal_rescue_attempted = False
            language_entries = [
                entry
                for pack, _ in language_packs
                for entry in pack["source"]["entries"]
            ]
            try:
                if model is None:
                    raise RuntimeError("Primary translation model is unavailable")
                (
                    unique_sources,
                    unique_segments,
                    retryable_source_keys,
                ) = populate_language_source_memory(
                    language_entries,
                    first_job["locale"],
                    first_job["nllbCode"],
                    model,
                    tokenizer,
                    device,
                    args.batch_size,
                    args.num_beams,
                    args.no_repeat_ngram_size,
                    args.max_source_tokens,
                    args.max_new_tokens,
                    args.max_retry_attempts,
                    logits_processor,
                    frozenset(generation_overrides),
                    source_memory,
                    source_texts,
                )
                (
                    retryable_source_keys,
                    _adopted_generation_overrides,
                ) = adopt_reviewed_generation_overrides(
                    language_entries,
                    first_job["locale"],
                    generation_overrides,
                    source_memory,
                    retryable_source_keys,
                )
            except SourceGenerationRetryExhausted as cause:
                error = LanguageSourceGenerationRetryExhausted(
                    language,
                    cause,
                )
                failed_languages.append(error)
                print(
                    json.dumps(
                        {
                            "event": "long_tail_worker_language_failed",
                            "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                            "workerIndex": args.worker_index,
                            "generatedPacks": generated,
                            "pendingPacks": len(packs),
                            **error.summary(),
                        }
                    ),
                    flush=True,
                )
                if device == "mps":
                    torch.mps.empty_cache()
                continue
            source_validation_references = build_source_validation_references(
                language_packs
            )
            while True:
                failed_packs: list[
                    tuple[dict[str, Any], list[dict[str, Any]]]
                ] = []
                round_reasons: Counter[str] = Counter()
                for pack, _ in language_packs:
                    job = pack["job"]
                    values = {
                        entry["key"]: source_memory[
                            (job["locale"], entry["sourceSha256"])
                        ]
                        for entry in pack["source"]["entries"]
                    }
                    failures = validator.validate(pack, values)
                    if failures:
                        failed_packs.append((pack, failures))
                        for failure in failures:
                            for reason in failure["reasons"]:
                                round_reasons[reason] += 1
                                retry_reason_counts[reason] += 1
                if not failed_packs:
                    break
                retry_entries_by_source: dict[
                    tuple[str, str],
                    dict[str, Any],
                ] = {}
                failure_samples: list[dict[str, Any]] = []
                failing_fields = 0
                for pack, failures in failed_packs:
                    job = pack["job"]
                    entries_by_key = {
                        entry["key"]: entry for entry in pack["source"]["entries"]
                    }
                    for failure in failures:
                        failing_fields += 1
                        entry = entries_by_key[failure["key"]]
                        source_key = (job["locale"], entry["sourceSha256"])
                        if source_key in retryable_source_keys:
                            prior = retry_entries_by_source.get(source_key)
                            if prior is not None and prior["source"] != entry["source"]:
                                raise RuntimeError("SHA-256 collision in failed source set")
                            retry_entries_by_source[source_key] = entry
                        if (
                            len(failure_samples)
                            < MAXIMUM_VALIDATION_FAILURE_SAMPLES
                        ):
                            failure_samples.append(
                                {
                                    "sourceSha256": entry["sourceSha256"],
                                    "reasons": failure["reasons"],
                                }
                            )
                can_retry = (
                    language_retry_rounds < args.max_retry_attempts
                    and bool(retry_entries_by_source)
                )
                print(
                    json.dumps(
                        {
                            "event": (
                                "long_tail_worker_retry"
                                if can_retry
                                else "long_tail_worker_retry_exhausted"
                            ),
                            "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                            "workerIndex": args.worker_index,
                            "language": language,
                            "completedRetryRounds": language_retry_rounds,
                            "nextRetryAttempt": (
                                language_retry_rounds + 1 if can_retry else None
                            ),
                            "maximumRetryAttempts": args.max_retry_attempts,
                            "failingPacks": len(failed_packs),
                            "failingFields": failing_fields,
                            "retryableSources": len(retry_entries_by_source),
                            "reasons": dict(sorted(round_reasons.items())),
                            "samples": failure_samples,
                        }
                    ),
                    flush=True,
                )
                if not can_retry:
                    should_attempt_terminal_rescue = (
                        device == "mps"
                        and not terminal_rescue_attempted
                        and bool(retry_entries_by_source)
                        and language_retry_rounds >= args.max_retry_attempts
                    )
                    if should_attempt_terminal_rescue:
                        terminal_rescue_attempted = True
                        rescue_entries = sorted(
                            retry_entries_by_source.values(),
                            key=lambda entry: (
                                entry["sourceSha256"],
                                entry["key"],
                            ),
                        )
                        requested_source_set_sha256 = canonical_sha256(
                            [
                                {
                                    "locale": first_job["locale"],
                                    "sourceSha256": entry["sourceSha256"],
                                }
                                for entry in rescue_entries
                            ]
                        )
                        print(
                            json.dumps(
                                {
                                    "event": "long_tail_worker_terminal_rescue_start",
                                    "evidenceKind": TERMINAL_RESCUE_EVIDENCE_KIND,
                                    "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                                    "workerIndex": args.worker_index,
                                    "language": language,
                                    "requestedSources": len(rescue_entries),
                                    "requestedSourceSetSha256": requested_source_set_sha256,
                                    "configuredIndependentDecodes": (
                                        TERMINAL_RESCUE_CONFIGURED_DECODES
                                    ),
                                    **EXECUTION_PROFILE["terminalRescue"],
                                }
                            ),
                            flush=True,
                        )
                        rescue_result: TerminalRescueResult | None = None
                        rescue_failure: TerminalRescueFailed | None = None
                        try:
                            model = None
                            release_primary_mps_model()
                            rescue_result = run_deterministic_terminal_rescue(
                                rescue_entries,
                                first_job["locale"],
                                first_job["nllbCode"],
                                device,
                                model_root,
                                tokenizer,
                                args.num_beams,
                                args.no_repeat_ngram_size,
                                args.max_source_tokens,
                                args.max_new_tokens,
                                args.max_retry_attempts,
                                logits_processor,
                                source_memory,
                                source_texts,
                                source_validation_references,
                                validator,
                            )
                        except TerminalRescueFailed as error:
                            rescue_failure = error
                        except Exception as error:
                            rescue_failure = TerminalRescueFailed(
                                "model-load-or-generation-failed",
                                error,
                                stage="replica-execution",
                                subtype="unexpected-error",
                            )
                        if rescue_result is not None:
                            source_memory.update(rescue_result.source_values)
                            language_retried_sources += (
                                rescue_result.rescued_sources * 2
                            )
                            language_retried_segments += (
                                rescue_result.retried_segments
                            )
                            language_improved_sources += (
                                rescue_result.rescued_sources
                            )
                            print(
                                json.dumps(
                                    {
                                        "event": "long_tail_worker_terminal_rescue_complete",
                                        "evidenceKind": TERMINAL_RESCUE_EVIDENCE_KIND,
                                        "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                                        "workerIndex": args.worker_index,
                                        "language": language,
                                        "rescuedSources": rescue_result.rescued_sources,
                                        "sourceSetSha256": rescue_result.source_set_sha256,
                                        "outputMapSha256": rescue_result.output_map_sha256,
                                        "replicaOutputMapSha256s": list(
                                            rescue_result.replica_output_map_sha256s
                                        ),
                                        "configuredIndependentDecodes": (
                                            TERMINAL_RESCUE_CONFIGURED_DECODES
                                        ),
                                        "attemptedReplicas": (
                                            rescue_result.attempted_replicas
                                        ),
                                        "completedReplicas": (
                                            rescue_result.completed_replicas
                                        ),
                                        "failingReplicaIndex": None,
                                        **EXECUTION_PROFILE["terminalRescue"],
                                    }
                                ),
                                flush=True,
                            )
                            if more_languages:
                                model = load_translation_model(
                                    model_root,
                                    device,
                                    args.dtype,
                                )
                            continue
                        if rescue_failure is None:
                            raise RuntimeError(
                                "Terminal rescue ended without a result or failure"
                            )
                        print(
                            json.dumps(
                                {
                                    "event": "long_tail_worker_terminal_rescue_failed",
                                    "evidenceKind": TERMINAL_RESCUE_EVIDENCE_KIND,
                                    "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                                    "workerIndex": args.worker_index,
                                    "language": language,
                                    "requestedSources": len(rescue_entries),
                                    "requestedSourceSetSha256": requested_source_set_sha256,
                                    **rescue_failure.evidence_summary(),
                                    "failureSha256": rescue_failure.failure_sha256,
                                    **EXECUTION_PROFILE["terminalRescue"],
                                }
                            ),
                            flush=True,
                        )
                    partial_checkpoint = checkpoint_validated_language_candidates(
                        language_packs,
                        failed_packs,
                        source_memory,
                    )
                    generated += partial_checkpoint["writtenPacks"]
                    print(
                        json.dumps(
                            {
                                "event": "long_tail_worker_language_partial_checkpoint",
                                "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                                "workerIndex": args.worker_index,
                                "language": language,
                                "generatedPacks": generated,
                                "pendingPacks": len(packs),
                                **partial_checkpoint,
                            }
                        ),
                        flush=True,
                    )
                    try:
                        raise LanguageValidationRetryExhausted(
                            language=language,
                            completed_retry_rounds=language_retry_rounds,
                            maximum_retry_attempts=args.max_retry_attempts,
                            failing_packs=len(failed_packs),
                            failing_fields=failing_fields,
                            retryable_sources=len(retry_entries_by_source),
                            reasons=round_reasons,
                            samples=failure_samples,
                            retried_sources=language_retried_sources,
                            retried_segments=language_retried_segments,
                            improved_sources=language_improved_sources,
                        )
                    except LanguageValidationRetryExhausted as error:
                        failed_languages.append(error)
                        print(
                            json.dumps(
                                {
                                    "event": "long_tail_worker_language_failed",
                                    "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                                    "workerIndex": args.worker_index,
                                    "language": language,
                                    "generatedPacks": generated,
                                    "pendingPacks": len(packs),
                                    **error.summary(),
                                }
                            ),
                            flush=True,
                        )
                        language_failed = True
                        break
                retry_attempt = language_retry_rounds + 1
                retry_entries = sorted(
                    retry_entries_by_source.values(),
                    key=lambda entry: (entry["sourceSha256"], entry["key"]),
                )
                try:
                    if model is None:
                        raise RuntimeError("Primary translation model is unavailable")
                    retried_sources, retried_segments, improved_sources = (
                        retry_source_entries(
                            retry_entries,
                            first_job["locale"],
                            first_job["nllbCode"],
                            model,
                            tokenizer,
                            device,
                            args.batch_size,
                            args.num_beams,
                            args.no_repeat_ngram_size,
                            args.max_source_tokens,
                            args.max_new_tokens,
                            args.max_retry_attempts,
                            logits_processor,
                            retry_attempt,
                            source_memory,
                            source_texts,
                            lambda source_key, candidate: validate_exact_source_candidate(
                                source_key,
                                candidate,
                                source_validation_references,
                                source_memory,
                                validator,
                            ),
                        )
                    )
                except SourceGenerationRetryExhausted as cause:
                    partial_checkpoint = checkpoint_validated_language_candidates(
                        language_packs,
                        failed_packs,
                        source_memory,
                    )
                    generated += partial_checkpoint["writtenPacks"]
                    print(
                        json.dumps(
                            {
                                "event": "long_tail_worker_language_partial_checkpoint",
                                "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                                "workerIndex": args.worker_index,
                                "language": language,
                                "generatedPacks": generated,
                                "pendingPacks": len(packs),
                                **partial_checkpoint,
                            }
                        ),
                        flush=True,
                    )
                    error = LanguageSourceGenerationRetryExhausted(
                        language,
                        cause,
                    )
                    failed_languages.append(error)
                    print(
                        json.dumps(
                            {
                                "event": "long_tail_worker_language_failed",
                                "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                                "workerIndex": args.worker_index,
                                "generatedPacks": generated,
                                "pendingPacks": len(packs),
                                **error.summary(),
                            }
                        ),
                        flush=True,
                    )
                    language_failed = True
                    break
                language_retry_rounds = retry_attempt
                language_retried_sources += retried_sources
                language_retried_segments += retried_segments
                language_improved_sources += improved_sources
            if language_failed:
                total_retry_rounds += language_retry_rounds
                total_retried_sources += language_retried_sources
                total_retried_segments += language_retried_segments
                total_improved_sources += language_improved_sources
                if device == "mps":
                    torch.mps.empty_cache()
                if model is None and more_languages:
                    model = load_translation_model(
                        model_root,
                        device,
                        args.dtype,
                    )
                continue
            for pack, candidate_path in language_packs:
                job = pack["job"]
                values = {
                    entry["key"]: source_memory[
                        (job["locale"], entry["sourceSha256"])
                    ]
                    for entry in pack["source"]["entries"]
                }
                write_candidate_atomic(candidate_path, candidate_payload(pack, values))
                generated += 1
            total_retry_rounds += language_retry_rounds
            total_retried_sources += language_retried_sources
            total_retried_segments += language_retried_segments
            total_improved_sources += language_improved_sources
            print(
                json.dumps(
                    {
                        "event": "long_tail_worker_language_complete",
                        "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                        "workerIndex": args.worker_index,
                        "language": language,
                        "generatedPacks": generated,
                        "pendingPacks": len(packs),
                        "newUniqueSources": unique_sources,
                        "newUniqueSegments": unique_segments,
                        "retryRounds": language_retry_rounds,
                        "retriedSources": language_retried_sources,
                        "retriedSegments": language_retried_segments,
                        "improvedSources": language_improved_sources,
                        "cachedSources": len(source_memory),
                    }
                ),
                flush=True,
            )
            if device == "mps":
                torch.mps.empty_cache()
    finally:
        validator.close()
    if failed_languages:
        failure_summaries = [failure.summary() for failure in failed_languages]
        failed_reason_counts: Counter[str] = Counter()
        for failure in failed_languages:
            failed_reason_counts.update(failure.reasons)
        print(
            json.dumps(
                {
                    "event": "long_tail_worker_failed_languages",
                    "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                    "workerIndex": args.worker_index,
                    "generatedPacks": generated,
                    "failedLanguageCount": len(failure_summaries),
                    "failedLanguagesSha256": canonical_sha256(failure_summaries),
                    "failedLanguages": failure_summaries,
                    "failedLanguageReasons": dict(
                        sorted(failed_reason_counts.items())
                    ),
                    "retryRounds": total_retry_rounds,
                    "retriedSources": total_retried_sources,
                    "retriedSegments": total_retried_segments,
                    "improvedSources": total_improved_sources,
                    "retryFailureReasons": dict(
                        sorted(retry_reason_counts.items())
                    ),
                }
            ),
            flush=True,
        )
        return 1
    print(
        json.dumps(
            {
                "event": "long_tail_worker_complete",
                "executionProfileSha256": EXECUTION_PROFILE_SHA256,
                "workerIndex": args.worker_index,
                "generatedPacks": generated,
                "retryRounds": total_retry_rounds,
                "retriedSources": total_retried_sources,
                "retriedSegments": total_retried_segments,
                "improvedSources": total_improved_sources,
                "retryFailureReasons": dict(sorted(retry_reason_counts.items())),
            }
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print(
            "Local translation worker interrupted; completed packs are restart-safe; "
            f"executionProfileSha256={EXECUTION_PROFILE_SHA256}.",
            file=sys.stderr,
        )
        raise SystemExit(130)
    except Exception as error:
        print(
            "Local translation worker failed: "
            f"executionProfileSha256={EXECUTION_PROFILE_SHA256}; {error}",
            file=sys.stderr,
        )
        raise SystemExit(1)
