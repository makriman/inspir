#!/usr/bin/env python3
"""Offline, fail-closed semantic audit for curated translation release packs.

This tool is intentionally independent of candidate generation and promotion. It
audits the exact union of the current curated tree and a run's candidate tree
against one authoritative long-tail worklist. Candidate packs take precedence
only after their source and generation provenance has been revalidated.

The automated evidence is a release gate, not legal advice. Every legal field
receives stricter independent model, backtranslation, sentence, length,
negation, number, placeholder, and literal checks. Exact source/value-bound
human adjudications are exceptional overrides for allowlisted model-threshold
false positives, never a way to waive structural or missing-model evidence.
"""

from __future__ import annotations

import argparse
import collections
import dataclasses
import datetime as dt
import fcntl
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import re
import stat
import sys
import unicodedata
from contextlib import AbstractContextManager
from pathlib import Path
from typing import (
    Any,
    Callable,
    Iterable,
    Mapping,
    NamedTuple,
    Optional,
    Protocol,
    Sequence,
)


AUDIT_VERSION = "inspir-translation-semantic-audit-v2"
AUDIT_MANIFEST_KIND = "inspir-translation-semantic-audit-manifest-v3"
MODEL_LOCK_KIND = "inspir-translation-semantic-model-lock-v1"
ADJUDICATION_KIND = "inspir-translation-semantic-adjudications-v1"
EXPECTED_NAMESPACE_COUNT = 125
EXPECTED_TARGET_LOCALE_COUNT = 69
EXPECTED_FULL_PACK_COUNT = 8_625
EXPECTED_AFRIKAANS_PACK_COUNT = 125
EXPECTED_STATIC_MAIN_APP_PACK_COUNT = 69
MAXIMUM_JSON_BYTES = 64 * 1024 * 1024
MAXIMUM_MASTER_WORKLIST_BYTES = 160 * 1024 * 1024
MAXIMUM_TREE_FILES = 30_000
MAXIMUM_TREE_DIRECTORIES = 30_000
MAXIMUM_TREE_DEPTH = 64
MAXIMUM_TREE_BYTES = 4 * 1024 * 1024 * 1024
MAXIMUM_FAILURE_SAMPLES = 5_000
MAXIMUM_CHECKPOINT_BYTES = 64 * 1024 * 1024
MAXIMUM_CHECKPOINT_TREE_BYTES = 4 * 1024 * 1024 * 1024
CHECKPOINT_SCHEMA_VERSION = 1
CHECKPOINT_KIND = "inspir-translation-semantic-pack-checkpoint-v1"
SESSION_KIND = "inspir-translation-semantic-audit-session-v1"
SESSION_RECORD_KIND = "inspir-translation-semantic-audit-session-record-v1"
CHECKPOINT_EVIDENCE_KIND = (
    "inspir-translation-semantic-checkpoint-chain-evidence-v1"
)
GENERATOR_PIPELINE_VERSION = "inspir-long-tail-local-nllb-v5"
GENERATOR_EXECUTION_PROFILE_KIND = (
    "inspir-long-tail-local-nllb-execution-profile-v2"
)
GENERATOR_EXECUTION_PROFILE_SHA256 = (
    "807a3bc739832f9a199618731b007dae93a8053027b971e0715e4f9ea550db8b"
)
GENERATOR_EXECUTION_PROFILE: Mapping[str, Any] = {
    "schemaVersion": 2,
    "kind": GENERATOR_EXECUTION_PROFILE_KIND,
    "pipelineVersion": GENERATOR_PIPELINE_VERSION,
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
    "executionProfileSha256": GENERATOR_EXECUTION_PROFILE_SHA256,
}
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
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
PLACEHOLDER_RE = re.compile(r"\{[A-Za-z0-9_]+\}")
NUMBER_RE = re.compile(r"(?<![A-Za-z])\d+(?:[.,:/-]\d+)*(?![A-Za-z])")
ASCII_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’\-]*")
LETTER_RE = re.compile(r"[^\W\d_]", re.UNICODE)
WORD_RE = re.compile(r"[^\W_]+(?:['’\-][^\W_]+)*", re.UNICODE)
SENTENCE_RE = re.compile(r"(?<=[.!?…])\s+|\n+")
CLAUSE_RE = re.compile(r"(?<=[.!?…;:])\s+|\n+")
URL_OR_OPAQUE_RE = re.compile(
    r"https?://\S+|(?:mailto:|tel:)\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|"
    r"\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}\b|"
    r"`[^`\n]+`|\{[A-Za-z0-9_]+\}|"
    r"(?<![\w])/(?:[A-Za-z0-9_.?=&%#-]+/)*[A-Za-z0-9_.?=&%#-]+",
    re.IGNORECASE,
)
PROTECTED_SOURCE_PATTERNS: tuple[tuple[re.Pattern[str], int], ...] = (
    (
        re.compile(r"<!--[\s\S]*?-->|<!DOCTYPE\s+[^>]+>|</?[A-Za-z][^<>]*>"),
        0,
    ),
    (re.compile(r"\{[A-Za-z0-9_]+\}|\$\{[A-Za-z0-9_.]+\}"), 1),
    (re.compile(r"%(?:\d+\$)?[sdif]"), 1),
    (re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE), 1),
    (re.compile(r"(?:mailto:|tel:)[^\s<>\"']+", re.IGNORECASE), 1),
    (
        re.compile(
            r"[A-Za-z0-9_\u017F\u212A.+-]+@"
            r"[A-Za-z0-9_\u017F\u212A.-]+\."
            r"[A-Za-z\u017F\u212A]{2,}"
        ),
        1,
    ),
    (
        re.compile(
            r"(?<![A-Za-z0-9_\u017F\u212A])"
            r"(?:[A-Za-z0-9\u017F\u212A]"
            r"(?:[A-Za-z0-9\u017F\u212A-]{0,62})\.)+"
            r"[A-Za-z\u017F\u212A]{2,63}"
            r"(?![A-Za-z0-9_\u017F\u212A])",
        ),
        1,
    ),
    (re.compile(r"`[^`\n]+`"), 1),
    (re.compile(r"\\u[0-9a-fA-F]{4}"), 1),
    (re.compile(r"&(?:[A-Za-z][A-Za-z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);"), 1),
    (
        re.compile(
            r"(?<![^\W_])(?<![+\-])/(?:[a-z_][a-z0-9_.-]*/)*"
            r"(?:[a-z_][a-z0-9_.?=&%#-]*)",
            re.IGNORECASE,
        ),
        2,
    ),
    (
        re.compile(
            r"\b(?:29AAWFG7015K1ZQ|American Express|ChatGPT|Dailyhunt|"
            r"DeepHack|Great Indian Company|GitHub|Google|"
            r"Holding Partnership Firm|Mastercard|OpenAI|Visa)\b",
            re.IGNORECASE | re.ASCII,
        ),
        2,
    ),
    (re.compile(r"(?<![A-Za-z])inspir(?![A-Za-z])", re.IGNORECASE), 2),
    (
        re.compile(
            r"[+\-\N{MINUS SIGN}]?\d+(?:[.,\N{ARABIC COMMA}"
            r"\N{ARABIC DECIMAL SEPARATOR}\N{ARABIC THOUSANDS SEPARATOR}:/-]"
            r"\d+)*(?:\s*[%\N{ARABIC PERCENT SIGN}])?"
        ),
        3,
    ),
)
ENGLISH_NEGATION_RE = re.compile(
    r"\b(?:not|no|never|without|neither|nor|none|nothing|nobody|nowhere|"
    r"cannot|unable|can['’]t|don['’]t|doesn['’]t|didn['’]t|won['’]t|"
    r"isn['’]t|aren['’]t|wasn['’]t|weren['’]t|shouldn['’]t|wouldn['’]t|"
    r"couldn['’]t|mustn['’]t|haven['’]t|hasn['’]t|hadn['’]t)\b",
    re.IGNORECASE,
)
ENGLISH_FUNCTION_WORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "because",
        "but",
        "by",
        "can",
        "do",
        "for",
        "from",
        "has",
        "have",
        "if",
        "in",
        "into",
        "is",
        "it",
        "not",
        "of",
        "on",
        "or",
        "that",
        "the",
        "then",
        "this",
        "to",
        "when",
        "which",
        "will",
        "with",
        "you",
        "your",
    }
)
TECHNICAL_SHARED_TERMS = frozenset(
    {
        "ai",
        "api",
        "apis",
        "chatgpt",
        "cloudflare",
        "css",
        "github",
        "google",
        "html",
        "inspir",
        "javascript",
        "openai",
        "pdf",
        "python",
        "seo",
        "typescript",
        "url",
        "urls",
    }
)
HIGH_RISK_SOURCE_RE = re.compile(
    r"\b(?:account|age|child|children|consent|contract|data|delete|deletion|"
    r"disclose|disclosure|law|legal|liability|liable|license|payment|personal|"
    r"privacy|refund|rights?|security|terminate|termination|warrant(?:y|ies)|"
    r"must|shall|may not|will not|prohibited|retention|jurisdiction)\b",
    re.IGNORECASE,
)
LEGAL_NAMESPACE_RE = re.compile(r"^legal(?::|$)")
ADJUDICABLE_FAILURES = frozenset(
    {
        "backtranslation-adequacy-low",
        "language-target-low-confidence",
        "mixed-english",
        "possible-addition",
        "possible-omission",
        "semantic-adequacy-low",
    }
)
ALL_FAILURE_CODES = frozenset(
    {
        "backtranslation-adequacy-low",
        "duplicate-collapse",
        "language-evidence-insufficient",
        "language-target-low-confidence",
        "mixed-english",
        "model-evidence-missing",
        "negation-parity",
        "number-parity",
        "placeholder-parity",
        "possible-addition",
        "possible-omission",
        "protected-literal-parity",
        "semantic-adequacy-low",
        "source-equality",
        "source-span-copy",
        "untranslated-source-token-cluster",
    }
)

# This profile is intentionally exact. A checkpoint session must never mix MPS
# and CPU evidence or inherit a workstation's ambient thread settings. The
# TypeScript runner mirrors and hashes this value before launching Python.
EXECUTION_PROFILE: Mapping[str, Any] = {
    "schemaVersion": 1,
    "kind": "inspir-translation-semantic-execution-profile-v1",
    "pythonImplementation": "CPython",
    "pythonVersion": "3.9.6",
    "pythonExecutableRealPath": "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9",
    "pythonVenvConfigSha256": "b682dbc2a57b67371d3834e1a0c117beef9ede3cb74253b0c34db2cd4eb1caf1",
    "semanticDevice": "mps",
    "torchNumThreads": 1,
    "torchNumInteropThreads": 1,
    "backtranslationDevice": "cpu",
    "backtranslationComputeType": "int8",
    "backtranslationInterThreads": 1,
    "backtranslationIntraThreads": 1,
    "environment": {
        "MKL_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "PYTHONHASHSEED": "0",
        "PYTORCH_ENABLE_MPS_FALLBACK": "0",
        "TOKENIZERS_PARALLELISM": "false",
        "VECLIB_MAXIMUM_THREADS": "1",
    },
}


# This is an exact application contract, not a best-effort locale guess. The
# fastText labels use ISO 639-1 where available; Filipino is labelled `tl` by
# lid.176. Any future application locale must be explicitly added here.
LANGUAGE_BY_LOCALE: Mapping[str, str] = {
    "af": "Afrikaans",
    "am": "Amharic",
    "ar": "Arabic",
    "as": "Assamese",
    "az": "Azerbaijani",
    "bg": "Bulgarian",
    "bn": "Bengali",
    "bs": "Bosnian",
    "ca": "Catalan",
    "cs": "Czech",
    "cy": "Welsh",
    "da": "Danish",
    "de": "German",
    "el": "Greek",
    "es": "Spanish",
    "et": "Estonian",
    "eu": "Basque",
    "fa": "Persian",
    "fi": "Finnish",
    "fil": "Filipino",
    "fr": "French",
    "ga": "Irish",
    "gl": "Galician",
    "gu": "Gujarati",
    "ha": "Hausa",
    "he": "Hebrew",
    "hi": "Hindi",
    "hr": "Croatian",
    "hu": "Hungarian",
    "hy": "Armenian",
    "id": "Indonesian",
    "is": "Icelandic",
    "it": "Italian",
    "ja": "Japanese",
    "ka": "Georgian",
    "kn": "Kannada",
    "ko": "Korean",
    "lt": "Lithuanian",
    "lv": "Latvian",
    "ml": "Malayalam",
    "mr": "Marathi",
    "ms": "Malay",
    "ne": "Nepali",
    "nl": "Dutch",
    "no": "Norwegian",
    "or": "Odia",
    "pa": "Punjabi",
    "pl": "Polish",
    "pt": "Portuguese",
    "ro": "Romanian",
    "ru": "Russian",
    "si": "Sinhala",
    "sk": "Slovak",
    "sl": "Slovenian",
    "so": "Somali",
    "sq": "Albanian",
    "sr": "Serbian",
    "sv": "Swedish",
    "sw": "Swahili",
    "ta": "Tamil",
    "te": "Telugu",
    "th": "Thai",
    "tr": "Turkish",
    "uk": "Ukrainian",
    "ur": "Urdu",
    "vi": "Vietnamese",
    "yo": "Yoruba",
    "zh": "Chinese",
    "zu": "Zulu",
}
FASTTEXT_LABEL_BY_LOCALE: Mapping[str, str] = {
    **{locale: locale for locale in LANGUAGE_BY_LOCALE},
    "fil": "tl",
}


AUDIT_POLICY: Mapping[str, Any] = {
    "version": AUDIT_VERSION,
    "expectedNamespaceCount": EXPECTED_NAMESPACE_COUNT,
    "expectedTargetLocaleCount": EXPECTED_TARGET_LOCALE_COUNT,
    "language": {
        "minimumLetters": 3,
        "shortTextLetters": 12,
        "minimumTargetProbability": 0.55,
        "minimumShortTargetProbability": 0.35,
        "maximumEnglishProbability": 0.30,
        "mixedChunkEnglishProbability": 0.35,
        "mixedChunkMinimumLetters": 8,
        "afrikaansPackContext": {
            "locale": "af",
            "targetLabel": "af",
            "relatedLabel": "nl",
            "normalization": (
                "NFKC-casefold-whitespace-collapse-distinct-lexical-space-join-v1"
            ),
            "minimumDistinctMaskedValues": 20,
            "minimumMaskedLetters": 1_000,
            "minimumPackTargetProbability": 0.55,
            "minimumPackPairProbability": 0.75,
            "minimumFieldPairProbability": 0.70,
            "trackedCuratedRescue": {
                "candidateOriginOnly": True,
                "referenceLocale": "af",
                "referencePackGateRequired": True,
                "conflictPolicy": "exclude-source-hash-with-distinct-exact-values-v1",
                "supportPairIdentity": "locale-source-bytes-source-sha256-value-bytes-value-sha256-v1",
                "requiredFailures": ["language-target-low-confidence"],
            },
        },
    },
    "semantic": {
        "shortMinimum": 0.45,
        "mediumMinimum": 0.55,
        "standardMinimum": 0.62,
        "legalMinimum": 0.70,
        "backtranslationTrigger": 0.72,
        "backtranslationMinimum": 0.70,
        "legalBacktranslationMinimum": 0.76,
        "sentenceAlignmentMinimum": 0.58,
        "legalSentenceAlignmentMinimum": 0.64,
        "minimumBacktranslationLengthRatio": 0.55,
        "maximumBacktranslationLengthRatio": 1.80,
        "legalMinimumBacktranslationLengthRatio": 0.72,
        "legalMaximumBacktranslationLengthRatio": 1.40,
    },
    "sourceCopy": {
        "minimumExactNgramWords": 4,
        "minimumExactNgramCharacters": 18,
        "minimumDistinctEnglishFunctionWords": 3,
    },
    "humanReview": {
        "policy": "exceptional-model-threshold-false-positives-only",
        "adjudicableFailures": sorted(ADJUDICABLE_FAILURES),
        "unlistedFailuresAreNonAdjudicable": True,
    },
    "models": {
        "language": "fastText lid.176",
        "semantic": "sentence-transformers/LaBSE",
        "backtranslation": "MADLAD400 3B CTranslate2 int8",
        "backtranslationBatchSize": 32,
        "backtranslationBeamSize": 1,
        "backtranslationMaximumTokens": 512,
    },
}


class AuditContractError(RuntimeError):
    """The audit cannot establish a complete, trustworthy input contract."""


class AuditModelError(RuntimeError):
    """A required local model or pinned runtime is unavailable or drifted."""


class LanguagePrediction(NamedTuple):
    label: str
    probability: float


class AfrikaansPackContext(NamedTuple):
    text: str
    sha256: str
    distinct_masked_values: int
    masked_letters: int


@dataclasses.dataclass(frozen=True)
class TrackedAfrikaansReferenceCatalog:
    evidence: Mapping[str, Any]
    support_pair_identities: Mapping[tuple[str, str, str, str, str], str]


AFRIKAANS_RESCUE_KINDS = frozenset(
    {"none", "field-pair", "tracked-curated"}
)


class AlignmentEvidence(NamedTuple):
    matrix: tuple[tuple[float, ...], ...]
    minimum_source_alignment: float
    minimum_backtranslation_alignment: float


class LanguageDetector(Protocol):
    def predict_many(self, values: Sequence[str]) -> Sequence[Sequence[LanguagePrediction]]:
        """Return ranked language predictions for every value."""


class SemanticScorer(Protocol):
    def similarities(self, sources: Sequence[str], values: Sequence[str]) -> Sequence[float]:
        """Return aligned cross-lingual cosine similarities."""


class Backtranslator(Protocol):
    def to_english(self, locale: str, values: Sequence[str]) -> Sequence[str]:
        """Backtranslate target-language text to English."""


@dataclasses.dataclass(frozen=True)
class ModelEvidence:
    model_lock_sha256: str
    fasttext_sha256: str
    labse_tree_sha256: str
    madlad_tree_sha256: str
    runtime_versions: Mapping[str, str]


@dataclasses.dataclass(frozen=True)
class AuditModels:
    language: LanguageDetector
    semantic: SemanticScorer
    backtranslator: Backtranslator
    evidence: ModelEvidence


@dataclasses.dataclass(frozen=True)
class AdjudicationReview:
    identity_sha256: str
    review_kind: str
    reviewer: str
    reviewed_at: str
    rationale_sha256: str
    accepted_failure_codes: tuple[str, ...]


@dataclasses.dataclass(frozen=True)
class AdjudicationSet:
    sha256: Optional[str]
    reviews: Mapping[str, AdjudicationReview]


@dataclasses.dataclass(frozen=True)
class TreeSnapshot:
    exists: bool
    sha256: str
    files: int
    bytes: int
    signatures: tuple[tuple[str, int, int, int, int], ...]

    def manifest_value(self) -> Mapping[str, Any]:
        return {
            "exists": self.exists,
            "sha256": self.sha256,
            "files": self.files,
            "bytes": self.bytes,
        }


@dataclasses.dataclass(frozen=True)
class SourceEntry:
    key: str
    source: str
    source_sha256: str
    text_segments: tuple[str, ...]
    literal_segments: tuple[str, ...]


@dataclasses.dataclass(frozen=True)
class SourcePack:
    namespace: str
    source_hash: str
    source_entries_sha256: str
    entries: tuple[SourceEntry, ...]


@dataclasses.dataclass(frozen=True)
class PackEntry:
    source: SourceEntry
    value: str


@dataclasses.dataclass(frozen=True)
class TranslationPack:
    locale: str
    language: str
    source: SourcePack
    origin: str
    path: Path
    file_sha256: str
    entries: tuple[PackEntry, ...]


@dataclasses.dataclass(frozen=True)
class AuditExpectations:
    scope: str
    locales: tuple[str, ...]
    expected_namespaces: int
    expected_packs: int

    @staticmethod
    def production(scope: str) -> "AuditExpectations":
        if scope == "afrikaans-smoke":
            return AuditExpectations(
                scope=scope,
                locales=("af",),
                expected_namespaces=EXPECTED_NAMESPACE_COUNT,
                expected_packs=EXPECTED_AFRIKAANS_PACK_COUNT,
            )
        if scope == "full":
            locales = tuple(sorted(LANGUAGE_BY_LOCALE))
            return AuditExpectations(
                scope=scope,
                locales=locales,
                expected_namespaces=EXPECTED_NAMESPACE_COUNT,
                expected_packs=EXPECTED_FULL_PACK_COUNT,
            )
        raise AuditContractError(f"Unsupported production audit scope: {scope}")


@dataclasses.dataclass(frozen=True)
class AuditInputs:
    root: Path
    master_worklist: Path
    curated_root: Path
    static_main_app_root: Path
    candidate_root: Path
    pack_worklist_root: Path
    output: Path
    adjudications: Optional[Path]


@dataclasses.dataclass(frozen=True)
class TranslationPackUnion:
    inputs: AuditInputs
    expectations: AuditExpectations
    master: Mapping[str, Any]
    sources: Mapping[str, SourcePack]
    jobs: Mapping[tuple[str, str], Mapping[str, Any]]
    curated_files: Mapping[tuple[str, str], tuple[Path, ...]]
    static_main_app_files: Mapping[str, Path]
    candidate_files: Mapping[tuple[str, str], tuple[Path, ...]]

    def load(self, locale: str, namespace: str) -> TranslationPack:
        identity = (locale, namespace)
        source = self.sources.get(namespace)
        if locale not in self.expectations.locales or source is None:
            raise AuditContractError("Pack loader received an unknown identity")
        candidates = self.candidate_files.get(identity, ())
        curated = self.curated_files.get(identity, ())
        if namespace == "main-app":
            if candidates or curated or identity in self.jobs:
                raise AuditContractError(
                    "Main-app release identity must come only from the tracked static pack"
                )
            static_path = self.static_main_app_files.get(locale)
            if static_path is None:
                raise AuditContractError(
                    f"Tracked static main-app pack is missing for {locale}"
                )
            return parse_static_main_app_pack(static_path, locale, source)
        if len(candidates) > 1:
            raise AuditContractError(
                f"Candidate pack is split or duplicate for {locale}/{namespace}"
            )
        if candidates:
            return parse_candidate_pack(
                candidates[0],
                locale,
                source,
                self.master,
                self.jobs.get(identity),
                self.inputs.candidate_root,
                self.inputs.pack_worklist_root,
            )
        if curated:
            return parse_curated_pack(curated, locale, source)
        raise AuditContractError(
            f"Translation union is missing {locale}/{namespace}"
        )

    def iter_canonical(self) -> Iterable[TranslationPack]:
        for locale in self.expectations.locales:
            for namespace in sorted(self.sources):
                yield self.load(locale, namespace)

    def tracked_afrikaans_references(self) -> tuple[TranslationPack, ...]:
        references: list[TranslationPack] = []
        for namespace in sorted(self.sources):
            if ("af", namespace) in self.jobs:
                continue
            pack = self.load("af", namespace)
            if pack.origin != "curated":
                raise AuditContractError(
                    "Tracked Afrikaans reference unexpectedly came from a candidate"
                )
            references.append(pack)
        return tuple(references)


@dataclasses.dataclass(frozen=True)
class PackCheckpointPlan:
    ordinal: int
    pack_input_sha256: str
    locale: str
    language: str
    namespace: str
    source_hash: str
    source_entries_sha256: str
    origin: str
    pack_file_sha256: str
    fields: int
    field_value_root_sha256: str


@dataclasses.dataclass(frozen=True)
class AuditCheckpointSession:
    sha256: str
    material: Mapping[str, Any]
    root: Path
    plans: tuple[PackCheckpointPlan, ...]
    pack_loader: Callable[[PackCheckpointPlan], TranslationPack] = dataclasses.field(
        compare=False, repr=False
    )
    tracked_afrikaans_reference_packs: tuple[TranslationPack, ...] = (
        dataclasses.field(compare=False, repr=False, default=())
    )
    created_at: Optional[str] = None


@dataclasses.dataclass(frozen=True)
class PreparedSemanticAudit:
    inputs: AuditInputs
    expectations: AuditExpectations
    implementation_sha256: str
    audit_policy_sha256: str
    master_worklist_sha256: str
    master_file_sha256: str
    trees: Mapping[str, TreeSnapshot]
    adjudications: AdjudicationSet
    expected_fields: int
    session: AuditCheckpointSession
    execution_profile: Mapping[str, Any]
    generator_execution_profile: Mapping[str, Any]


class ExclusiveAuditRunLock(AbstractContextManager["ExclusiveAuditRunLock"]):
    """A process-scoped advisory lock that cannot be bypassed by stale PID data."""

    def __init__(self, path: Path) -> None:
        self.path = path.absolute()
        self._descriptor: Optional[int] = None

    def __enter__(self) -> "ExclusiveAuditRunLock":
        parent = self.path.parent
        assert_no_symlink_components(parent, "semantic-audit lock parent")
        if not parent.is_dir():
            raise AuditContractError("Semantic-audit lock parent must be a directory")
        flags = os.O_RDWR | os.O_CREAT
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(self.path, flags, 0o600)
        try:
            metadata = os.fstat(descriptor)
            path_metadata = self.path.lstat()
            if (
                not stat.S_ISREG(metadata.st_mode)
                or metadata.st_nlink != 1
                or metadata.st_size != 0
                or metadata.st_uid != os.getuid()
                or stat.S_IMODE(metadata.st_mode) != 0o600
                or metadata.st_dev != path_metadata.st_dev
                or metadata.st_ino != path_metadata.st_ino
            ):
                raise AuditContractError(
                    "Semantic-audit lock must be an empty single-link regular file"
                )
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise AuditContractError(
                    "Another semantic audit is already running in this workspace"
                ) from error
            locked = os.fstat(descriptor)
            locked_path = self.path.lstat()
            if (
                locked.st_dev != metadata.st_dev
                or locked.st_ino != metadata.st_ino
                or locked.st_nlink != 1
                or locked.st_uid != os.getuid()
                or locked_path.st_dev != locked.st_dev
                or locked_path.st_ino != locked.st_ino
                or locked_path.st_nlink != 1
                or locked_path.st_uid != os.getuid()
            ):
                raise AuditContractError("Semantic-audit lock changed after acquisition")
            self._descriptor = descriptor
            return self
        except Exception:
            os.close(descriptor)
            raise

    def __exit__(self, *exc_info: object) -> None:
        del exc_info
        if self._descriptor is not None:
            try:
                fcntl.flock(self._descriptor, fcntl.LOCK_UN)
            finally:
                os.close(self._descriptor)
                self._descriptor = None


def canonical_json(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise AuditContractError("Canonical JSON cannot contain non-finite numbers")
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, Mapping):
        keys = list(value.keys())
        if any(not isinstance(key, str) for key in keys):
            raise AuditContractError("Canonical JSON object keys must be strings")
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False, separators=(",", ":"))
            + ":"
            + canonical_json(value[key])
            for key in sorted(keys)
        ) + "}"
    raise AuditContractError(f"Canonical JSON cannot encode {type(value).__name__}")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_canonical(value: Any) -> str:
    return sha256_text(canonical_json(value))


def derive_protected_source_text(source: str) -> Mapping[str, Any]:
    """Independently derive the generator's exact protected-source contract."""

    spans: list[tuple[int, int, str, int]] = []
    for pattern, priority in PROTECTED_SOURCE_PATTERNS:
        for match in pattern.finditer(source):
            value = match.group(0)
            if value:
                spans.append((match.start(), match.end(), value, priority))
    spans.sort(key=lambda span: (span[0], span[3], -(span[1] - span[0])))
    selected: list[tuple[int, int, str, int]] = []
    claimed_until = 0
    for span in spans:
        if span[0] < claimed_until:
            continue
        selected.append(span)
        claimed_until = span[1]

    segments: list[dict[str, str]] = []
    cursor = 0
    for start, end, value, _priority in selected:
        if start > cursor:
            segments.append({"kind": "text", "value": source[cursor:start]})
        segments.append({"kind": "literal", "value": value})
        cursor = end
    if cursor < len(source):
        segments.append({"kind": "text", "value": source[cursor:]})
    if not segments:
        segments.append({"kind": "text", "value": source})
    invariants = [
        segment["value"]
        for segment in segments
        if segment["kind"] == "literal"
    ]
    return {
        "segments": segments,
        "invariantSha256": sha256_canonical(invariants),
    }


def require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        raise AuditContractError(f"{label} is not a lowercase SHA-256 digest")
    return value


def require_matching_digest(actual: str, expected: Any, label: str) -> None:
    expected_digest = require_sha256(expected, f"expected {label} SHA-256")
    if actual != expected_digest:
        raise AuditModelError(f"Pinned {label} digest drifted")


def require_exact_keys(value: Mapping[str, Any], keys: set[str], label: str) -> None:
    actual = set(value)
    if actual != keys:
        raise AuditContractError(
            f"{label} keys differ from the exact contract: "
            f"missing={sorted(keys - actual)} extra={sorted(actual - keys)}"
        )


def as_mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise AuditContractError(f"{label} must be a JSON object")
    return value


def as_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise AuditContractError(f"{label} must be a JSON array")
    return value


def as_string(value: Any, label: str, maximum: int = 200_000) -> str:
    if not isinstance(value, str) or len(value) > maximum:
        raise AuditContractError(f"{label} must be a bounded string")
    return value


def require_bounded_integer(
    value: Any,
    label: str,
    minimum: int,
    maximum: int,
) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < minimum
        or value > maximum
    ):
        raise AuditContractError(f"{label} must be an exact bounded integer")
    return value


def validate_generator_provenance(value: Any) -> Mapping[str, Any]:
    """Independently enforce the exact current local NLLB release contract."""

    provenance = as_mapping(value, "master provenance")
    require_exact_keys(
        provenance,
        {
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
        },
        "master provenance",
    )
    if provenance.get("pipelineVersion") != GENERATOR_PIPELINE_VERSION:
        raise AuditContractError(
            "Master provenance predates the exact generator v4 contract"
        )

    execution_profile = as_mapping(
        provenance.get("executionProfile"), "generator execution profile"
    )
    require_exact_keys(
        execution_profile,
        {
            "schemaVersion",
            "kind",
            "pipelineVersion",
            "environment",
            "torch",
            "terminalRescue",
            "executionProfileSha256",
        },
        "generator execution profile",
    )
    environment = as_mapping(
        execution_profile.get("environment"),
        "generator execution profile environment",
    )
    require_exact_keys(
        environment,
        {
            "MKL_NUM_THREADS",
            "OMP_NUM_THREADS",
            "PYTORCH_ENABLE_MPS_FALLBACK",
            "VECLIB_MAXIMUM_THREADS",
        },
        "generator execution profile environment",
    )
    torch_threads = as_mapping(
        execution_profile.get("torch"), "generator execution profile torch"
    )
    require_exact_keys(
        torch_threads,
        {"interopThreads", "intraopThreads"},
        "generator execution profile torch",
    )
    terminal_rescue = as_mapping(
        execution_profile.get("terminalRescue"),
        "generator execution profile terminal rescue",
    )
    require_exact_keys(
        terminal_rescue,
        {
            "device",
            "dtype",
            "independentDecodes",
            "deterministicAlgorithms",
        },
        "generator execution profile terminal rescue",
    )
    profile_sha256 = require_sha256(
        execution_profile.get("executionProfileSha256"),
        "generator execution profile SHA-256",
    )
    profile_material = dict(execution_profile)
    del profile_material["executionProfileSha256"]
    if (
        canonical_json(execution_profile)
        != canonical_json(GENERATOR_EXECUTION_PROFILE)
        or profile_sha256 != GENERATOR_EXECUTION_PROFILE_SHA256
        or sha256_canonical(profile_material) != profile_sha256
    ):
        raise AuditContractError(
            "Generator execution profile is stale, mismatched, or tampered"
        )

    for key in (
        "protectorSha256",
        "pipelineImplementationSha256",
        "workerImplementationSha256",
        "modelSha256",
        "seedMemorySha256",
        "generationOverridesSha256",
    ):
        require_sha256(provenance.get(key), f"master provenance {key}")
    if provenance.get("protectorVersion") != "inspir-long-tail-literal-protector-v1":
        raise AuditContractError("Master provenance protector version is unsupported")
    model_label = as_string(provenance.get("modelLabel"), "master model label", 256)
    if not model_label:
        raise AuditContractError("Master model label is empty")
    require_bounded_integer(
        provenance.get("seedMemoryEntries"),
        "master seed-memory entry count",
        0,
        500_000,
    )
    require_bounded_integer(
        provenance.get("seedMemoryConflicts"),
        "master seed-memory conflict count",
        0,
        500_000,
    )
    require_bounded_integer(
        provenance.get("generationOverrideEntries"),
        "master generation override entry count",
        0,
        64,
    )

    validator_policy = as_mapping(
        provenance.get("validatorPolicy"), "master validator policy"
    )
    require_exact_keys(
        validator_policy,
        {"kind", "files", "validatorPolicySha256"},
        "master validator policy",
    )
    if validator_policy.get("kind") != "inspir-long-tail-validator-policy-v1":
        raise AuditContractError("Master validator policy kind is unsupported")
    require_sha256(
        validator_policy.get("validatorPolicySha256"),
        "master validator policy SHA-256",
    )
    validator_files = as_list(
        validator_policy.get("files"), "master validator policy files"
    )
    if len(validator_files) != 7:
        raise AuditContractError("Master validator policy file set is incomplete")
    prior_validator_path = ""
    for index, raw_file in enumerate(validator_files):
        validator_file = as_mapping(
            raw_file, f"master validator policy file[{index}]"
        )
        require_exact_keys(
            validator_file,
            {"relativePath", "bytes", "sha256"},
            f"master validator policy file[{index}]",
        )
        relative_path = as_string(
            validator_file.get("relativePath"),
            f"master validator policy file[{index}] path",
            4_096,
        )
        if (
            not safe_relative_path(relative_path)
            or relative_path <= prior_validator_path
        ):
            raise AuditContractError(
                "Master validator policy file order/path is noncanonical"
            )
        prior_validator_path = relative_path
        require_bounded_integer(
            validator_file.get("bytes"),
            f"master validator policy file[{index}] bytes",
            0,
            MAXIMUM_JSON_BYTES,
        )
        require_sha256(
            validator_file.get("sha256"),
            f"master validator policy file[{index}] SHA-256",
        )

    generation = as_mapping(
        provenance.get("generationConfig"), "master generation configuration"
    )
    require_exact_keys(
        generation,
        {
            "batchSize",
            "numBeams",
            "noRepeatNgramSize",
            "dtype",
            "device",
            "maxSourceTokens",
            "maxNewTokens",
            "maxRetryAttempts",
            "deterministicAlgorithms",
            "manualSeed",
        },
        "master generation configuration",
    )
    for key, minimum, maximum in (
        ("batchSize", 1, 256),
        ("numBeams", 1, 8),
        ("noRepeatNgramSize", 0, 16),
        ("maxSourceTokens", 1, 1_022),
        ("maxNewTokens", 1, 1_022),
        ("maxRetryAttempts", 1, 3),
    ):
        require_bounded_integer(
            generation.get(key),
            f"master generation configuration {key}",
            minimum,
            maximum,
        )
    if generation.get("dtype") not in {"float16", "float32"} or generation.get(
        "device"
    ) not in {"auto", "cpu", "mps"}:
        raise AuditContractError("Master generation configuration is unsupported")
    if (
        generation.get("deterministicAlgorithms") is not True
        or generation.get("manualSeed") != 0
    ):
        raise AuditContractError(
            "Master generation configuration is not hard deterministic"
        )
    return provenance


def is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def assert_no_symlink_components(path: Path, label: str) -> None:
    absolute = path.absolute()
    current = Path(absolute.anchor)
    for component in absolute.parts[1:]:
        current = current / component
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            raise AuditContractError(f"{label} does not exist: {path}") from None
        if stat.S_ISLNK(metadata.st_mode):
            raise AuditContractError(f"{label} contains a symlink component: {path}")


def read_bounded_regular_file(path: Path, maximum_bytes: int, label: str) -> bytes:
    assert_no_symlink_components(path, label)
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise AuditContractError(f"{label} must be a single-link regular file: {path}")
    if metadata.st_size > maximum_bytes:
        raise AuditContractError(f"{label} exceeds its byte bound: {path}")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    if hasattr(os, "O_NONBLOCK"):
        flags |= os.O_NONBLOCK
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_dev != metadata.st_dev
            or opened.st_ino != metadata.st_ino
            or opened.st_size != metadata.st_size
        ):
            raise AuditContractError(f"{label} changed while it was opened: {path}")
        chunks: list[bytes] = []
        remaining = opened.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                raise AuditContractError(f"{label} was truncated while reading: {path}")
            chunks.append(chunk)
            remaining -= len(chunk)
        if os.read(descriptor, 1):
            raise AuditContractError(f"{label} grew while reading: {path}")
        after = os.fstat(descriptor)
        if (
            after.st_size != opened.st_size
            or after.st_mtime_ns != opened.st_mtime_ns
            or after.st_ctime_ns != opened.st_ctime_ns
        ):
            raise AuditContractError(f"{label} changed while reading: {path}")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def inspect_bounded_regular_file_metadata(
    path: Path, maximum_bytes: int, label: str
) -> os.stat_result:
    assert_no_symlink_components(path, label)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise AuditContractError(f"{label} must be a single-link regular file: {path}")
    if before.st_size > maximum_bytes:
        raise AuditContractError(f"{label} exceeds its byte bound: {path}")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    if hasattr(os, "O_NONBLOCK"):
        flags |= os.O_NONBLOCK
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    after = path.lstat()
    if (
        not stat.S_ISREG(opened.st_mode)
        or opened.st_nlink != 1
        or opened.st_dev != before.st_dev
        or opened.st_ino != before.st_ino
        or opened.st_size != before.st_size
        or opened.st_mtime_ns != before.st_mtime_ns
        or opened.st_ctime_ns != before.st_ctime_ns
        or after.st_dev != opened.st_dev
        or after.st_ino != opened.st_ino
        or after.st_size != opened.st_size
        or after.st_mtime_ns != opened.st_mtime_ns
        or after.st_ctime_ns != opened.st_ctime_ns
        or after.st_nlink != 1
    ):
        raise AuditContractError(f"{label} changed while it was inspected: {path}")
    return opened


def read_json(path: Path, maximum_bytes: int, label: str) -> Any:
    raw = read_bounded_regular_file(path, maximum_bytes, label)
    try:
        return strict_json_loads(raw.decode("utf-8"), label)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AuditContractError(f"{label} is not valid UTF-8 JSON: {path}") from error


def strict_json_loads(raw: str, label: str) -> Any:
    def reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> Mapping[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise AuditContractError(f"{label} contains a duplicate JSON key")
            result[key] = value
        return result

    return json.loads(raw, object_pairs_hook=reject_duplicate_pairs)


def is_main_app_workbench_relative_path(relative: str) -> bool:
    parts = relative.split("/")
    return len(parts) == 2 and parts[0] in LANGUAGE_BY_LOCALE and re.fullmatch(
        r"main-app(?:\.part-[A-Za-z0-9][A-Za-z0-9_-]{0,127})?\.json",
        parts[1],
    ) is not None


def snapshot_input_tree(
    root: Path,
    label: str,
    allow_absent: bool = False,
    ignore_main_app_workbench: bool = False,
) -> TreeSnapshot:
    if not root.exists():
        if allow_absent:
            return TreeSnapshot(
                exists=False,
                sha256=sha256_canonical({"exists": False, "files": []}),
                files=0,
                bytes=0,
                signatures=(),
            )
        raise AuditContractError(f"{label} does not exist: {root}")
    assert_no_symlink_components(root, label)
    if not root.is_dir():
        raise AuditContractError(f"{label} must be a directory: {root}")
    rows: list[list[Any]] = []
    signatures: list[tuple[str, int, int, int, int]] = []
    total_bytes = 0
    total_resource_bytes = 0
    total_file_entries = 0
    total_directories = 1
    for directory, directories, files in os.walk(root, followlinks=False):
        directories.sort()
        files.sort()
        directory_path = Path(directory)
        relative_directory = directory_path.relative_to(root)
        if len(relative_directory.parts) > MAXIMUM_TREE_DEPTH:
            raise AuditContractError(f"{label} exceeds its directory depth bound")
        total_directories += len(directories)
        if total_directories > MAXIMUM_TREE_DIRECTORIES:
            raise AuditContractError(f"{label} exceeds its directory resource bound")
        for child in directories:
            child_path = directory_path / child
            if child_path.is_symlink():
                raise AuditContractError(f"{label} contains a symlinked directory")
        for filename in files:
            total_file_entries += 1
            if total_file_entries > MAXIMUM_TREE_FILES:
                raise AuditContractError(f"{label} exceeds its file resource bound")
            file_path = directory_path / filename
            relative = file_path.relative_to(root).as_posix()
            if ignore_main_app_workbench and is_main_app_workbench_relative_path(
                relative
            ):
                ignored = inspect_bounded_regular_file_metadata(
                    file_path, MAXIMUM_JSON_BYTES, label
                )
                total_resource_bytes += ignored.st_size
                if total_resource_bytes > MAXIMUM_TREE_BYTES:
                    raise AuditContractError(f"{label} exceeds its byte resource bound")
                continue
            if file_path.is_symlink():
                raise AuditContractError(f"{label} contains a symlinked file: {relative}")
            if file_path.suffix != ".json":
                raise AuditContractError(f"{label} contains a non-JSON file: {relative}")
            raw = read_bounded_regular_file(file_path, MAXIMUM_JSON_BYTES, label)
            metadata = file_path.lstat()
            total_bytes += len(raw)
            total_resource_bytes += len(raw)
            if total_resource_bytes > MAXIMUM_TREE_BYTES:
                raise AuditContractError(f"{label} exceeds its resource bound")
            digest = sha256_bytes(raw)
            rows.append([relative, len(raw), digest])
            signatures.append(
                (
                    relative,
                    metadata.st_ino,
                    metadata.st_size,
                    metadata.st_mtime_ns,
                    metadata.st_ctime_ns,
                )
            )
    rows.sort(key=lambda row: row[0])
    signatures.sort(key=lambda row: row[0])
    return TreeSnapshot(
        exists=True,
        sha256=sha256_canonical({"exists": True, "files": rows}),
        files=len(rows),
        bytes=total_bytes,
        signatures=tuple(signatures),
    )


def assert_tree_unchanged(
    root: Path,
    prior: TreeSnapshot,
    label: str,
    ignore_main_app_workbench: bool = False,
) -> None:
    current = snapshot_input_tree(
        root,
        label,
        allow_absent=not prior.exists,
        ignore_main_app_workbench=ignore_main_app_workbench,
    )
    if current != prior:
        raise AuditContractError(f"{label} changed during the audit")


def parse_master_worklist(
    value: Any,
    expectations: AuditExpectations,
) -> tuple[Mapping[str, Any], Mapping[str, SourcePack], Mapping[tuple[str, str], Mapping[str, Any]]]:
    master = as_mapping(value, "master worklist")
    require_exact_keys(
        master,
        {
            "schemaVersion",
            "kind",
            "provenance",
            "seedMemory",
            "generationOverrides",
            "sources",
            "jobs",
            "worklistSha256",
        },
        "master worklist",
    )
    if master.get("schemaVersion") != 1 or master.get("kind") != (
        "inspir-long-tail-translation-worklist-v1"
    ):
        raise AuditContractError("Master worklist schema/kind is unsupported")
    worklist_sha256 = require_sha256(master.get("worklistSha256"), "worklistSha256")
    material = dict(master)
    del material["worklistSha256"]
    if sha256_canonical(material) != worklist_sha256:
        raise AuditContractError("Master worklist is stale or tampered")
    validate_generator_provenance(master.get("provenance"))
    provenance = as_mapping(master.get("provenance"), "master provenance")

    seed_memory = as_mapping(master.get("seedMemory"), "master seed memory")
    require_exact_keys(
        seed_memory,
        {
            "schemaVersion",
            "kind",
            "entries",
            "conflicts",
            "seedMemorySha256",
        },
        "master seed memory",
    )
    if (
        seed_memory.get("schemaVersion") != 1
        or seed_memory.get("kind")
        != "inspir-long-tail-translation-seed-memory-v1"
    ):
        raise AuditContractError("Master seed-memory schema/kind is unsupported")
    seed_memory_sha256 = require_sha256(
        seed_memory.get("seedMemorySha256"), "master seed-memory SHA-256"
    )
    seed_material = dict(seed_memory)
    del seed_material["seedMemorySha256"]
    seed_entries = as_list(seed_memory.get("entries"), "master seed entries")
    seed_conflicts = as_list(
        seed_memory.get("conflicts"), "master seed conflicts"
    )
    if (
        sha256_canonical(seed_material) != seed_memory_sha256
        or provenance.get("seedMemorySha256") != seed_memory_sha256
        or provenance.get("seedMemoryEntries") != len(seed_entries)
        or provenance.get("seedMemoryConflicts") != len(seed_conflicts)
    ):
        raise AuditContractError("Master seed memory is stale or unbound")
    seed_by_identity: dict[str, Mapping[str, Any]] = {}
    prior_seed_identity = ""
    for index, raw_seed in enumerate(seed_entries):
        seed = as_mapping(raw_seed, f"master seed entry[{index}]")
        require_exact_keys(
            seed,
            {
                "language",
                "locale",
                "source",
                "sourceSha256",
                "value",
                "valueSha256",
            },
            f"master seed entry[{index}]",
        )
        language = as_string(seed.get("language"), "master seed language", 128)
        locale = as_string(seed.get("locale"), "master seed locale", 32)
        source = as_string(seed.get("source"), "master seed source")
        value_text = as_string(seed.get("value"), "master seed value")
        source_sha256 = require_sha256(
            seed.get("sourceSha256"), "master seed source SHA-256"
        )
        value_sha256 = require_sha256(
            seed.get("valueSha256"), "master seed value SHA-256"
        )
        identity = f"{locale}\0{source_sha256}"
        if (
            not language
            or identity <= prior_seed_identity
            or identity in seed_by_identity
            or sha256_text(source) != source_sha256
            or sha256_text(value_text) != value_sha256
            or value_text != unicodedata.normalize("NFC", value_text)
        ):
            raise AuditContractError(
                "Master seed-memory order, uniqueness, or content drifted"
            )
        seed_by_identity[identity] = seed
        prior_seed_identity = identity
    prior_conflict_identity = ""
    for index, raw_conflict in enumerate(seed_conflicts):
        conflict = as_mapping(raw_conflict, f"master seed conflict[{index}]")
        require_exact_keys(
            conflict,
            {"language", "locale", "sourceSha256"},
            f"master seed conflict[{index}]",
        )
        as_string(conflict.get("language"), "master seed conflict language", 128)
        locale = as_string(
            conflict.get("locale"), "master seed conflict locale", 32
        )
        source_sha256 = require_sha256(
            conflict.get("sourceSha256"), "master seed conflict source SHA-256"
        )
        identity = f"{locale}\0{source_sha256}"
        if identity <= prior_conflict_identity or identity in seed_by_identity:
            raise AuditContractError("Master seed conflict order drifted")
        prior_conflict_identity = identity

    generation_overrides = as_mapping(
        master.get("generationOverrides"), "master generation overrides"
    )
    require_exact_keys(
        generation_overrides,
        {
            "schemaVersion",
            "kind",
            "entries",
            "generationOverridesSha256",
        },
        "master generation overrides",
    )
    if (
        generation_overrides.get("schemaVersion") != 1
        or generation_overrides.get("kind")
        != "inspir-long-tail-generation-overrides-v1"
    ):
        raise AuditContractError(
            "Master generation overrides schema/kind is unsupported"
        )
    generation_overrides_sha256 = require_sha256(
        generation_overrides.get("generationOverridesSha256"),
        "master generation overrides SHA-256",
    )
    generation_overrides_material = dict(generation_overrides)
    del generation_overrides_material["generationOverridesSha256"]
    if sha256_canonical(generation_overrides_material) != generation_overrides_sha256:
        raise AuditContractError("Master generation overrides are stale or tampered")
    generation_override_entries = as_list(
        generation_overrides.get("entries"),
        "master generation override entries",
    )
    if len(generation_override_entries) > 64:
        raise AuditContractError("Master generation override bound is exceeded")
    if (
        provenance.get("generationOverridesSha256")
        != generation_overrides_sha256
        or provenance.get("generationOverrideEntries")
        != len(generation_override_entries)
    ):
        raise AuditContractError(
            "Master generation overrides differ from provenance"
        )
    prior_override_identity = ""
    for index, raw_override in enumerate(generation_override_entries):
        override = as_mapping(
            raw_override, f"master generation override[{index}]"
        )
        require_exact_keys(
            override,
            {
                "language",
                "locale",
                "source",
                "sourceSha256",
                "value",
                "valueSha256",
                "requiredOccurrences",
            },
            f"master generation override[{index}]",
        )
        language = as_string(
            override.get("language"), "generation override language", 128
        )
        locale = as_string(
            override.get("locale"), "generation override locale", 32
        )
        source_text = as_string(
            override.get("source"), "generation override source"
        )
        reviewed_value = as_string(
            override.get("value"), "generation override value"
        )
        source_sha256 = require_sha256(
            override.get("sourceSha256"), "generation override source SHA-256"
        )
        value_sha256 = require_sha256(
            override.get("valueSha256"), "generation override value SHA-256"
        )
        identity = f"{locale}\0{source_sha256}"
        seed = seed_by_identity.get(identity)
        seed_fields = {
            key: override.get(key)
            for key in (
                "language",
                "locale",
                "source",
                "sourceSha256",
                "value",
                "valueSha256",
            )
        }
        if (
            not language
            or identity <= prior_override_identity
            or seed is None
            or canonical_json(seed_fields) != canonical_json(seed)
            or sha256_text(source_text) != source_sha256
            or sha256_text(reviewed_value) != value_sha256
            or reviewed_value != unicodedata.normalize("NFC", reviewed_value)
        ):
            raise AuditContractError(
                "Generation override order, seed binding, or content drifted"
            )
        occurrences = as_list(
            override.get("requiredOccurrences"),
            "generation override occurrences",
        )
        if not 1 <= len(occurrences) <= 100:
            raise AuditContractError(
                "Generation override occurrence bound is invalid"
            )
        prior_occurrence_identity = ""
        for occurrence_index, raw_occurrence in enumerate(occurrences):
            occurrence = as_mapping(
                raw_occurrence,
                f"generation override occurrence[{occurrence_index}]",
            )
            require_exact_keys(
                occurrence,
                {"namespace", "sourceHash", "key"},
                f"generation override occurrence[{occurrence_index}]",
            )
            namespace = as_string(
                occurrence.get("namespace"),
                "generation override occurrence namespace",
                1_024,
            )
            source_hash = require_sha256(
                occurrence.get("sourceHash"),
                "generation override occurrence source hash",
            )
            key = as_string(
                occurrence.get("key"),
                "generation override occurrence key",
                1_024,
            )
            occurrence_identity = f"{namespace}\0{source_hash}\0{key}"
            if occurrence_identity <= prior_occurrence_identity:
                raise AuditContractError(
                    "Generation override occurrence order drifted"
                )
            prior_occurrence_identity = occurrence_identity
        prior_override_identity = identity
    override_binding = [
        {
            "language": override["language"],
            "locale": override["locale"],
            "sourceSha256": override["sourceSha256"],
            "valueSha256": override["valueSha256"],
        }
        for override in generation_override_entries
    ]
    raw_sources_for_override_anchor = as_list(master.get("sources"), "master sources")
    source_by_namespace_for_overrides = {
        raw_source.get("namespace"): raw_source
        for raw_source in raw_sources_for_override_anchor
        if isinstance(raw_source, Mapping)
    }
    required_override_source_sha256s = {
        raw_seed["sourceSha256"]
        for raw_seed in seed_entries
        if isinstance(raw_seed, Mapping)
        and raw_seed.get("locale") == "af"
        and raw_seed.get("sourceSha256")
        in CURRENT_GENERATION_OVERRIDE_SOURCE_SHA256S
    }
    for raw_job in as_list(master.get("jobs"), "master jobs"):
        if not isinstance(raw_job, Mapping) or raw_job.get("language") != "Afrikaans":
            continue
        raw_source = source_by_namespace_for_overrides.get(raw_job.get("namespace"))
        if not isinstance(raw_source, Mapping):
            continue
        for raw_entry in raw_source.get("entries", []):
            if (
                isinstance(raw_entry, Mapping)
                and raw_entry.get("sourceSha256")
                in CURRENT_GENERATION_OVERRIDE_SOURCE_SHA256S
            ):
                required_override_source_sha256s.add(raw_entry["sourceSha256"])
    expected_override_binding = [
        {
            "language": "Afrikaans",
            "locale": "af",
            "sourceSha256": source_sha256,
            "valueSha256": CURRENT_GENERATION_OVERRIDE_VALUE_SHA256_BY_SOURCE[
                source_sha256
            ],
        }
        for source_sha256 in sorted(required_override_source_sha256s)
    ]
    if override_binding != expected_override_binding or (
        len(override_binding) == CURRENT_GENERATION_OVERRIDE_ENTRIES
        and sha256_canonical(override_binding)
        != CURRENT_GENERATION_OVERRIDE_BINDING_SHA256
    ):
        raise AuditContractError(
            "Generation overrides differ from the exact required reviewed set"
        )

    sources_value = as_list(master.get("sources"), "master sources")
    if len(sources_value) != expectations.expected_namespaces:
        raise AuditContractError(
            "Master source namespace count is partial: "
            f"expected={expectations.expected_namespaces} actual={len(sources_value)}"
        )
    sources: dict[str, SourcePack] = {}
    prior_namespace = ""
    for source_index, raw_source in enumerate(sources_value):
        source_value = as_mapping(raw_source, f"source[{source_index}]")
        require_exact_keys(
            source_value,
            {"namespace", "sourceHash", "sourceEntriesSha256", "entries"},
            f"source[{source_index}]",
        )
        namespace = as_string(source_value.get("namespace"), "source namespace", 1_024)
        if not namespace or namespace <= prior_namespace or namespace in sources:
            raise AuditContractError("Master source namespaces are duplicate or noncanonical")
        prior_namespace = namespace
        source_hash = require_sha256(source_value.get("sourceHash"), "sourceHash")
        source_entries_sha256 = require_sha256(
            source_value.get("sourceEntriesSha256"), "sourceEntriesSha256"
        )
        raw_entries = as_list(source_value.get("entries"), f"source {namespace} entries")
        if not raw_entries or len(raw_entries) > 20_000:
            raise AuditContractError(f"Source entry count is invalid for {namespace}")
        if sha256_canonical(raw_entries) != source_entries_sha256:
            raise AuditContractError(f"Source entry hash drifted for {namespace}")
        entries: list[SourceEntry] = []
        prior_key = ""
        for entry_index, raw_entry in enumerate(raw_entries):
            entry = as_mapping(raw_entry, f"source {namespace} entry[{entry_index}]")
            require_exact_keys(
                entry,
                {"key", "source", "sourceSha256", "invariantSha256", "segments"},
                f"source {namespace} entry[{entry_index}]",
            )
            key = as_string(entry.get("key"), "source entry key", 1_024)
            source_text = as_string(entry.get("source"), "source entry text")
            source_sha256 = require_sha256(entry.get("sourceSha256"), "sourceSha256")
            invariant_sha256 = require_sha256(
                entry.get("invariantSha256"), "invariantSha256"
            )
            if not key or key <= prior_key:
                raise AuditContractError(
                    f"Source keys are duplicate or noncanonical for {namespace}"
                )
            prior_key = key
            if sha256_text(source_text) != source_sha256:
                raise AuditContractError(
                    f"Source text hash drifted for {namespace}/{key}"
                )
            segments_value = as_list(entry.get("segments"), "source protected segments")
            if not segments_value:
                raise AuditContractError(
                    f"Source protected segments are empty for {namespace}/{key}"
                )
            reconstructed: list[str] = []
            texts: list[str] = []
            literals: list[str] = []
            for segment_index, raw_segment in enumerate(segments_value):
                segment = as_mapping(raw_segment, "source protected segment")
                require_exact_keys(segment, {"kind", "value"}, "source protected segment")
                kind = segment.get("kind")
                text = as_string(segment.get("value"), "source protected segment value")
                if kind not in {"text", "literal"}:
                    raise AuditContractError(
                        f"Protected segment kind is invalid for {namespace}/{key}/{segment_index}"
                    )
                reconstructed.append(text)
                if kind == "literal" and text:
                    literals.append(text)
                elif kind == "text" and text:
                    texts.append(text)
            if "".join(reconstructed) != source_text:
                raise AuditContractError(
                    f"Protected segments do not reconstruct {namespace}/{key}"
                )
            protected = derive_protected_source_text(source_text)
            if (
                canonical_json(segments_value)
                != canonical_json(protected["segments"])
                or invariant_sha256 != protected["invariantSha256"]
            ):
                raise AuditContractError(
                    "Protected segments/invariant are not canonically derived for "
                    f"{namespace}/{key}"
                )
            entries.append(
                SourceEntry(
                    key=key,
                    source=source_text,
                    source_sha256=source_sha256,
                    text_segments=tuple(texts),
                    literal_segments=tuple(literals),
                )
            )
        sources[namespace] = SourcePack(
            namespace=namespace,
            source_hash=source_hash,
            source_entries_sha256=source_entries_sha256,
            entries=tuple(entries),
        )

    for raw_override in generation_override_entries:
        override = as_mapping(raw_override, "master generation override")
        source_sha256 = as_string(
            override.get("sourceSha256"), "generation override source SHA-256", 64
        )
        source_text = as_string(
            override.get("source"), "generation override source"
        )
        observed = sorted(
            (
                {
                    "namespace": source.namespace,
                    "sourceHash": source.source_hash,
                    "key": entry.key,
                    "source": entry.source,
                }
                for source in sources.values()
                for entry in source.entries
                if entry.source_sha256 == source_sha256
            ),
            key=lambda occurrence: (
                occurrence["namespace"],
                occurrence["sourceHash"],
                occurrence["key"],
            ),
        )
        expected = [
            {**dict(as_mapping(raw, "generation override occurrence")), "source": source_text}
            for raw in as_list(
                override.get("requiredOccurrences"),
                "generation override occurrences",
            )
        ]
        if canonical_json(observed) != canonical_json(expected):
            raise AuditContractError(
                "Generation override occurrence provenance drifted"
            )

    jobs: dict[tuple[str, str], Mapping[str, Any]] = {}
    for job_index, raw_job in enumerate(as_list(master.get("jobs"), "master jobs")):
        job = as_mapping(raw_job, f"job[{job_index}]")
        required = {
            "language",
            "locale",
            "nllbCode",
            "namespace",
            "sourceHash",
            "sourceEntriesSha256",
            "entryCount",
            "worklistRelativePath",
            "candidateRelativePath",
            "targetRelativePath",
            "jobSha256",
        }
        actual_job_keys = set(job)
        if actual_job_keys != required and actual_job_keys != required | {"replacement"}:
            raise AuditContractError(f"Job[{job_index}] keys differ from the exact contract")
        job_sha256 = require_sha256(job.get("jobSha256"), "jobSha256")
        job_material = dict(job)
        del job_material["jobSha256"]
        if sha256_canonical(job_material) != job_sha256:
            raise AuditContractError(f"Job[{job_index}] hash drifted")
        locale = as_string(job.get("locale"), "job locale", 32)
        namespace = as_string(job.get("namespace"), "job namespace", 1_024)
        if namespace == "main-app":
            raise AuditContractError(
                "Master worklist cannot schedule tracked static main-app replacement"
            )
        language = as_string(job.get("language"), "job language", 128)
        source = sources.get(namespace)
        replacement = job.get("replacement")
        if replacement is not None:
            replacement_value = as_mapping(replacement, "job replacement")
            replacement_kind = replacement_value.get("kind")
            if replacement_kind == "inspir-long-tail-source-stale-replacement-v1":
                require_exact_keys(
                    replacement_value,
                    {"kind", "existingFileSha256", "priorSourceHash"},
                    "source-stale replacement",
                )
                require_sha256(
                    replacement_value.get("existingFileSha256"),
                    "source-stale existingFileSha256",
                )
                prior_source_hash = require_sha256(
                    replacement_value.get("priorSourceHash"),
                    "source-stale priorSourceHash",
                )
                if source is not None and prior_source_hash == source.source_hash:
                    raise AuditContractError("Source-stale replacement does not bind source drift")
            elif replacement_kind == "inspir-long-tail-quality-stale-replacement-v1":
                require_exact_keys(
                    replacement_value,
                    {
                        "kind",
                        "existingFileSha256",
                        "sourceHash",
                        "validatorPolicySha256",
                    },
                    "quality-stale replacement",
                )
                require_sha256(
                    replacement_value.get("existingFileSha256"),
                    "quality-stale existingFileSha256",
                )
                provenance = as_mapping(master.get("provenance"), "master provenance")
                validator_policy = as_mapping(
                    provenance.get("validatorPolicy"), "master validator policy"
                )
                if (
                    source is None
                    or replacement_value.get("sourceHash") != source.source_hash
                    or replacement_value.get("sourceHash") != job.get("sourceHash")
                    or replacement_value.get("validatorPolicySha256")
                    != validator_policy.get("validatorPolicySha256")
                ):
                    raise AuditContractError(
                        "Quality-stale replacement source/policy binding drifted"
                    )
            else:
                raise AuditContractError("Job replacement discriminant is unsupported")
        relative_paths = (
            job.get("worklistRelativePath"),
            job.get("candidateRelativePath"),
            job.get("targetRelativePath"),
        )
        if (
            locale not in LANGUAGE_BY_LOCALE
            or LANGUAGE_BY_LOCALE[locale] != language
            or source is None
            or job.get("sourceHash") != source.source_hash
            or job.get("sourceEntriesSha256") != source.source_entries_sha256
            or job.get("entryCount") != len(source.entries)
            or any(not isinstance(path, str) or not safe_relative_path(path) for path in relative_paths)
            or len(set(relative_paths)) != 1
        ):
            raise AuditContractError(f"Job contract is invalid for {locale}/{namespace}")
        identity = (locale, namespace)
        if identity in jobs:
            raise AuditContractError(f"Duplicate master job for {locale}/{namespace}")
        jobs[identity] = job
    return master, sources, jobs


def safe_relative_path(value: str) -> bool:
    if not value or "\x00" in value or "\\" in value:
        return False
    path = Path(value)
    return not path.is_absolute() and all(part not in {"", ".", ".."} for part in path.parts)


def file_safe_namespace(namespace: str) -> str:
    safe = re.sub(r"[^a-z0-9.\-]+", "__", namespace, flags=re.IGNORECASE)
    if safe in {"", ".", ".."}:
        raise AuditContractError("Translation namespace cannot produce a safe filename")
    return safe


def validate_translation_tree_layout(root: Path, label: str) -> None:
    if not root.exists():
        return
    assert_no_symlink_components(root, label)
    for locale_path in root.iterdir():
        if (
            locale_path.is_symlink()
            or not locale_path.is_dir()
            or locale_path.name not in LANGUAGE_BY_LOCALE
        ):
            raise AuditContractError(f"{label} has an unsupported top-level entry")
        for pack_path in locale_path.iterdir():
            if pack_path.is_symlink() or not pack_path.is_file() or pack_path.suffix != ".json":
                raise AuditContractError(f"{label} has a nested or non-JSON pack entry")


def collect_pack_files(
    root: Path,
    locales: set[str],
    label: str,
    allow_parts: bool,
    ignore_main_app_workbench: bool = False,
) -> Mapping[tuple[str, str], tuple[Path, ...]]:
    if not root.exists():
        return {}
    validate_translation_tree_layout(root, label)
    result: dict[tuple[str, str], list[Path]] = {}
    for locale in sorted(locales):
        language_root = root / locale
        if not language_root.exists():
            continue
        assert_no_symlink_components(language_root, label)
        if not language_root.is_dir():
            raise AuditContractError(f"{label} locale is not a directory: {locale}")
        for path in sorted(language_root.iterdir(), key=lambda item: item.name):
            if path.is_symlink() or not path.is_file() or path.suffix != ".json":
                raise AuditContractError(f"{label} has an invalid pack path: {path.name}")
            if ignore_main_app_workbench and re.fullmatch(
                r"main-app(?:\.part-[A-Za-z0-9][A-Za-z0-9_-]{0,127})?\.json",
                path.name,
            ) is not None:
                continue
            payload = as_mapping(read_json(path, MAXIMUM_JSON_BYTES, label), label)
            namespace = as_string(payload.get("namespace"), f"{label} namespace", 1_024)
            payload_locale = as_string(payload.get("locale"), f"{label} locale", 32)
            if payload_locale != locale:
                raise AuditContractError(f"{label} locale/path mismatch for {path.name}")
            safe_namespace = file_safe_namespace(namespace)
            exact_name = f"{safe_namespace}.json"
            part_pattern = re.compile(
                rf"^{re.escape(safe_namespace)}\.part-[1-9][0-9]*\.json$"
            )
            if path.name != exact_name and not (
                allow_parts and part_pattern.fullmatch(path.name) is not None
            ):
                raise AuditContractError(
                    f"{label} filename/namespace mismatch for {locale}/{namespace}"
                )
            result.setdefault((locale, namespace), []).append(path)
    return {identity: tuple(paths) for identity, paths in result.items()}


def collect_static_main_app_files(root: Path) -> Mapping[str, Path]:
    assert_no_symlink_components(root, "tracked static main-app tree")
    if not root.is_dir():
        raise AuditContractError("Tracked static main-app root must be a directory")
    expected_names = {f"{locale}.json" for locale in LANGUAGE_BY_LOCALE}
    entries = sorted(root.iterdir(), key=lambda item: item.name)
    actual_names = {entry.name for entry in entries}
    if (
        len(entries) != EXPECTED_STATIC_MAIN_APP_PACK_COUNT
        or actual_names != expected_names
    ):
        raise AuditContractError(
            "Tracked static main-app tree is not the exact 69-pack corpus"
        )
    result: dict[str, Path] = {}
    for entry in entries:
        if entry.is_symlink() or not entry.is_file() or entry.suffix != ".json":
            raise AuditContractError(
                f"Tracked static main-app path is unsafe: {entry.name}"
            )
        locale = entry.stem
        if locale not in LANGUAGE_BY_LOCALE:
            raise AuditContractError(
                f"Tracked static main-app locale is unsupported: {locale}"
            )
        result[locale] = entry
    return result


def parse_static_main_app_pack(
    path: Path,
    locale: str,
    source: SourcePack,
) -> TranslationPack:
    if source.namespace != "main-app":
        raise AuditContractError("Static main-app parser received another namespace")
    raw = read_bounded_regular_file(
        path, MAXIMUM_JSON_BYTES, "tracked static main-app pack"
    )
    payload = as_mapping(
        strict_json_loads(raw.decode("utf-8"), "tracked static main-app pack"),
        "tracked static main-app pack",
    )
    require_exact_keys(
        payload,
        {
            "schemaVersion",
            "kind",
            "language",
            "locale",
            "sourceHash",
            "keyCount",
            "strings",
        },
        "tracked static main-app pack",
    )
    ordered_entries = tuple(sorted(source.entries, key=lambda entry: entry.key))
    strings = as_list(payload.get("strings"), "tracked static main-app strings")
    if (
        payload.get("schemaVersion") != 1
        or payload.get("kind") != "static-main-app-values"
        or payload.get("language") != LANGUAGE_BY_LOCALE[locale]
        or payload.get("locale") != locale
        or payload.get("sourceHash") != source.source_hash
        or payload.get("keyCount") != len(ordered_entries)
        or len(strings) != len(ordered_entries)
    ):
        raise AuditContractError(
            f"Tracked static main-app binding drifted for {locale}"
        )
    entries: list[PackEntry] = []
    for index, source_entry in enumerate(ordered_entries):
        value = as_string(
            strings[index], f"tracked static main-app value {locale}/{source_entry.key}"
        )
        if not value or unicodedata.normalize("NFC", value) != value:
            raise AuditContractError(
                f"Tracked static main-app value is empty or non-NFC for {locale}/{source_entry.key}"
            )
        entries.append(PackEntry(source=source_entry, value=value))
    return TranslationPack(
        locale=locale,
        language=LANGUAGE_BY_LOCALE[locale],
        source=source,
        origin="curated",
        path=path,
        file_sha256=sha256_bytes(raw),
        entries=tuple(entries),
    )


def parse_curated_pack(
    paths: tuple[Path, ...],
    locale: str,
    source: SourcePack,
) -> TranslationPack:
    values: dict[str, str] = {}
    language = LANGUAGE_BY_LOCALE[locale]
    file_hash_rows: list[list[Any]] = []
    for path in paths:
        raw = read_bounded_regular_file(path, MAXIMUM_JSON_BYTES, "curated pack")
        payload = as_mapping(strict_json_loads(raw.decode("utf-8"), "curated pack"), "curated pack")
        required = {"schemaVersion", "language", "locale", "namespace", "sourceHash"}
        if not required.issubset(payload):
            raise AuditContractError(f"Curated pack header is incomplete for {locale}/{source.namespace}")
        if (
            payload.get("schemaVersion") != 1
            or payload.get("language") != language
            or payload.get("locale") != locale
            or payload.get("namespace") != source.namespace
            or payload.get("sourceHash") != source.source_hash
        ):
            raise AuditContractError(f"Curated pack binding is stale for {locale}/{source.namespace}")
        entries_present = "entries" in payload
        translations_present = "translations" in payload
        if entries_present == translations_present:
            raise AuditContractError(
                f"Curated pack must have exactly one payload shape for {locale}/{source.namespace}"
            )
        if entries_present:
            for raw_entry in as_list(payload.get("entries"), "curated entries"):
                entry = as_mapping(raw_entry, "curated entry")
                if not {"key", "source", "value"}.issubset(entry):
                    raise AuditContractError(
                        f"Curated entry is incomplete for {locale}/{source.namespace}"
                    )
                key = as_string(entry.get("key"), "curated key", 1_024)
                source_entry = next((item for item in source.entries if item.key == key), None)
                if source_entry is None or entry.get("source") != source_entry.source:
                    raise AuditContractError(
                        f"Curated source identity drifted for {locale}/{source.namespace}/{key}"
                    )
                value = as_string(entry.get("value"), "curated value")
                if not value or key in values:
                    raise AuditContractError(
                        f"Curated field is empty or duplicate for {locale}/{source.namespace}/{key}"
                    )
                values[key] = value
        else:
            translations = as_mapping(payload.get("translations"), "curated translations")
            for key, raw_value in translations.items():
                if not isinstance(key, str):
                    raise AuditContractError("Curated translation key is not a string")
                value = as_string(raw_value, "curated translation value")
                if not value or key in values:
                    raise AuditContractError(
                        f"Curated field is empty or duplicate for {locale}/{source.namespace}/{key}"
                    )
                values[key] = value
        file_hash_rows.append([path.name, len(raw), sha256_bytes(raw)])
    expected_keys = [entry.key for entry in source.entries]
    if set(values) != set(expected_keys):
        raise AuditContractError(
            f"Curated pack is partial for {locale}/{source.namespace}: "
            f"expected={len(expected_keys)} actual={len(values)}"
        )
    return TranslationPack(
        locale=locale,
        language=language,
        source=source,
        origin="curated",
        path=paths[0],
        file_sha256=sha256_canonical(file_hash_rows),
        entries=tuple(PackEntry(source=entry, value=values[entry.key]) for entry in source.entries),
    )


def validate_pack_worklist(
    path: Path,
    master: Mapping[str, Any],
    source: SourcePack,
    job: Mapping[str, Any],
) -> str:
    raw = read_bounded_regular_file(path, MAXIMUM_JSON_BYTES, "pack worklist")
    payload = as_mapping(strict_json_loads(raw.decode("utf-8"), "pack worklist"), "pack worklist")
    require_exact_keys(
        payload,
        {
            "schemaVersion",
            "kind",
            "masterWorklistSha256",
            "provenance",
            "job",
            "source",
            "packWorklistSha256",
        },
        "pack worklist",
    )
    pack_hash = require_sha256(payload.get("packWorklistSha256"), "packWorklistSha256")
    material = dict(payload)
    del material["packWorklistSha256"]
    expected_source = next(
        raw_source
        for raw_source in as_list(master.get("sources"), "master sources")
        if isinstance(raw_source, dict) and raw_source.get("namespace") == source.namespace
    )
    if (
        payload.get("schemaVersion") != 1
        or payload.get("kind") != "inspir-long-tail-translation-pack-worklist-v1"
        or payload.get("masterWorklistSha256") != master.get("worklistSha256")
        or payload.get("provenance") != master.get("provenance")
        or payload.get("job") != job
        or payload.get("source") != expected_source
        or sha256_canonical(material) != pack_hash
    ):
        raise AuditContractError(
            f"Pack worklist is stale or tampered for {job.get('locale')}/{source.namespace}"
        )
    return pack_hash


def parse_candidate_pack(
    path: Path,
    locale: str,
    source: SourcePack,
    master: Mapping[str, Any],
    job: Optional[Mapping[str, Any]],
    candidate_root: Path,
    pack_worklist_root: Path,
) -> TranslationPack:
    if job is None:
        raise AuditContractError(f"Candidate is not registered by the master for {locale}/{source.namespace}")
    raw = read_bounded_regular_file(path, MAXIMUM_JSON_BYTES, "candidate pack")
    candidate = as_mapping(strict_json_loads(raw.decode("utf-8"), "candidate pack"), "candidate pack")
    require_exact_keys(
        candidate,
        {
            "schemaVersion",
            "kind",
            "pipelineVersion",
            "executionProfileSha256",
            "masterWorklistSha256",
            "packWorklistSha256",
            "jobSha256",
            "language",
            "locale",
            "namespace",
            "sourceHash",
            "sourceEntriesSha256",
            "modelLabel",
            "modelSha256",
            "workerImplementationSha256",
            "validatorPolicySha256",
            "entries",
        },
        "candidate pack",
    )
    language = LANGUAGE_BY_LOCALE[locale]
    relative_worklist = as_string(job.get("worklistRelativePath"), "pack worklist path", 1_024)
    relative_candidate = as_string(job.get("candidateRelativePath"), "candidate path", 1_024)
    if not safe_relative_path(relative_worklist):
        raise AuditContractError("Candidate pack worklist path is unsafe")
    if (
        not safe_relative_path(relative_candidate)
        or path.relative_to(candidate_root).as_posix() != relative_candidate
    ):
        raise AuditContractError("Candidate pack path drifted from the master job")
    pack_worklist_path = pack_worklist_root / relative_worklist
    pack_worklist_hash = validate_pack_worklist(
        pack_worklist_path, master, source, job
    )
    provenance = as_mapping(master.get("provenance"), "master provenance")
    validator_policy = as_mapping(provenance.get("validatorPolicy"), "validator policy")
    if (
        candidate.get("schemaVersion") != 1
        or candidate.get("kind") != "inspir-long-tail-translation-candidate-v1"
        or candidate.get("pipelineVersion") != GENERATOR_PIPELINE_VERSION
        or candidate.get("pipelineVersion") != provenance.get("pipelineVersion")
        or candidate.get("executionProfileSha256")
        != GENERATOR_EXECUTION_PROFILE_SHA256
        or candidate.get("executionProfileSha256")
        != as_mapping(
            provenance.get("executionProfile"),
            "master generator execution profile",
        ).get("executionProfileSha256")
        or candidate.get("masterWorklistSha256") != master.get("worklistSha256")
        or candidate.get("packWorklistSha256") != pack_worklist_hash
        or candidate.get("jobSha256") != job.get("jobSha256")
        or candidate.get("language") != language
        or candidate.get("locale") != locale
        or candidate.get("namespace") != source.namespace
        or candidate.get("sourceHash") != source.source_hash
        or candidate.get("sourceEntriesSha256") != source.source_entries_sha256
        or candidate.get("modelLabel") != provenance.get("modelLabel")
        or candidate.get("modelSha256") != provenance.get("modelSha256")
        or candidate.get("workerImplementationSha256")
        != provenance.get("workerImplementationSha256")
        or candidate.get("validatorPolicySha256")
        != validator_policy.get("validatorPolicySha256")
    ):
        raise AuditContractError(f"Candidate provenance drifted for {locale}/{source.namespace}")
    raw_entries = as_list(candidate.get("entries"), "candidate entries")
    if len(raw_entries) != len(source.entries):
        raise AuditContractError(f"Candidate is partial for {locale}/{source.namespace}")
    entries: list[PackEntry] = []
    for index, source_entry in enumerate(source.entries):
        candidate_entry = as_mapping(raw_entries[index], "candidate entry")
        require_exact_keys(
            candidate_entry, {"key", "source", "sourceSha256", "value"}, "candidate entry"
        )
        value = as_string(candidate_entry.get("value"), "candidate value")
        if (
            candidate_entry.get("key") != source_entry.key
            or candidate_entry.get("source") != source_entry.source
            or candidate_entry.get("sourceSha256") != source_entry.source_sha256
            or not value
        ):
            raise AuditContractError(
                f"Candidate field identity drifted for {locale}/{source.namespace}/{source_entry.key}"
            )
        entries.append(PackEntry(source=source_entry, value=value))
    return TranslationPack(
        locale=locale,
        language=language,
        source=source,
        origin="candidate",
        path=path,
        file_sha256=sha256_bytes(raw),
        entries=tuple(entries),
    )


def create_translation_pack_union(
    inputs: AuditInputs,
    expectations: AuditExpectations,
    master: Mapping[str, Any],
    sources: Mapping[str, SourcePack],
    jobs: Mapping[tuple[str, str], Mapping[str, Any]],
) -> TranslationPackUnion:
    locale_set = set(expectations.locales)
    curated_files = collect_pack_files(
        inputs.curated_root,
        locale_set,
        "curated tree",
        allow_parts=True,
        ignore_main_app_workbench=True,
    )
    static_main_app_files = collect_static_main_app_files(
        inputs.static_main_app_root
    )
    candidate_files = collect_pack_files(
        inputs.candidate_root, locale_set, "candidate tree", allow_parts=False
    )
    if any(namespace == "main-app" for _, namespace in candidate_files):
        raise AuditContractError(
            "Tracked static main-app packs cannot be replaced by candidates"
        )
    unexpected = (set(curated_files) | set(candidate_files)) - {
        (locale, namespace)
        for locale in expectations.locales
        for namespace in sources
    }
    if unexpected:
        raise AuditContractError(f"Translation union has {len(unexpected)} unexpected pack identities")
    expected_identities = {
        (locale, namespace)
        for locale in expectations.locales
        for namespace in sources
    }
    static_identities = {
        (locale, "main-app") for locale in expectations.locales
    }
    present_identities = set(curated_files) | set(candidate_files) | static_identities
    missing = expected_identities - present_identities
    if missing or len(expected_identities) != expectations.expected_packs:
        raise AuditContractError(
            "Translation union is partial: "
            f"expected={expectations.expected_packs} "
            f"actual={len(expected_identities) - len(missing)} missing={len(missing)}"
        )
    return TranslationPackUnion(
        inputs=inputs,
        expectations=expectations,
        master=master,
        sources=sources,
        jobs=jobs,
        curated_files=curated_files,
        static_main_app_files=static_main_app_files,
        candidate_files=candidate_files,
    )


def load_exact_pack_union(
    inputs: AuditInputs,
    expectations: AuditExpectations,
    master: Mapping[str, Any],
    sources: Mapping[str, SourcePack],
    jobs: Mapping[tuple[str, str], Mapping[str, Any]],
) -> tuple[TranslationPack, ...]:
    union = create_translation_pack_union(
        inputs, expectations, master, sources, jobs
    )
    return tuple(union.iter_canonical())


EXPECTED_RUNTIME_VERSIONS: Mapping[str, str] = {
    "ctranslate2": "4.8.1",
    "fasttext": "0.9.3",
    "numpy": "1.26.4",
    "safetensors": "0.7.0",
    "torch": "2.2.2",
    "transformers": "4.46.3",
}


def validate_execution_profile(
    expected_sha256: str,
    environment: Mapping[str, str] = os.environ,
) -> Mapping[str, Any]:
    require_sha256(expected_sha256, "execution profile SHA-256")
    actual_sha256 = sha256_canonical(EXECUTION_PROFILE)
    if actual_sha256 != expected_sha256:
        raise AuditContractError("Runner/auditor execution profile binding drifted")
    expected_environment = as_mapping(
        EXECUTION_PROFILE["environment"], "execution profile environment"
    )
    for key, expected in expected_environment.items():
        if environment.get(key) != expected:
            raise AuditContractError(
                f"Semantic-audit execution setting {key} is not forced to {expected}"
            )
    if (
        platform.python_implementation()
        != EXECUTION_PROFILE["pythonImplementation"]
        or platform.python_version() != EXECUTION_PROFILE["pythonVersion"]
        or str(Path(sys.executable).resolve(strict=True))
        != EXECUTION_PROFILE["pythonExecutableRealPath"]
    ):
        raise AuditContractError("Pinned semantic-audit Python runtime drifted")
    pyvenv_config = Path(sys.prefix) / "pyvenv.cfg"
    pyvenv_sha256 = sha256_bytes(
        read_bounded_regular_file(
            pyvenv_config, 64 * 1024, "semantic-audit pyvenv.cfg"
        )
    )
    if pyvenv_sha256 != EXECUTION_PROFILE["pythonVenvConfigSha256"]:
        raise AuditContractError("Pinned semantic-audit pyvenv.cfg drifted")
    return EXECUTION_PROFILE


def installed_distribution_version(distribution: str) -> str:
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError as error:
        raise AuditModelError(f"Required offline package is missing: {distribution}") from error


def validate_runtime_versions() -> Mapping[str, str]:
    actual: dict[str, str] = {}
    for distribution, expected in EXPECTED_RUNTIME_VERSIONS.items():
        value = installed_distribution_version(distribution)
        if value != expected:
            raise AuditModelError(
                f"Pinned runtime drifted for {distribution}: expected={expected} actual={value}"
            )
        actual[distribution] = value
    return actual


def require_cached_model_path(path: Path, label: str) -> Path:
    cache_root = (Path.home() / ".cache" / "inspirlearning").resolve()
    resolved = path.expanduser().resolve(strict=True)
    if not is_within(resolved, cache_root):
        raise AuditModelError(f"{label} must resolve within the pinned inspirlearning cache")
    return resolved


def hash_model_file(path: Path, label: str) -> tuple[str, int]:
    expanded = path.expanduser().absolute()
    try:
        assert_no_symlink_components(expanded, label)
        metadata = expanded.lstat()
    except AuditContractError as error:
        raise AuditModelError(str(error)) from error
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise AuditModelError(f"{label} must be a single-link regular file")
    if metadata.st_size < 1 or metadata.st_size > 2 * 1024 * 1024 * 1024:
        raise AuditModelError(f"{label} has an invalid byte size")
    return hash_regular_model_file(
        expanded,
        2 * 1024 * 1024 * 1024,
        label,
        require_single_link=True,
        no_follow=True,
    )


def hash_regular_model_file(
    path: Path,
    maximum_bytes: int,
    label: str,
    *,
    require_single_link: bool,
    no_follow: bool,
) -> tuple[str, int]:
    metadata = path.lstat() if no_follow else path.stat()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_size > maximum_bytes
        or (require_single_link and metadata.st_nlink != 1)
    ):
        raise AuditModelError(f"{label} target is not a bounded regular file")
    flags = os.O_RDONLY
    if no_follow and hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_dev != metadata.st_dev
            or opened.st_ino != metadata.st_ino
            or opened.st_size != metadata.st_size
            or (require_single_link and opened.st_nlink != 1)
        ):
            raise AuditModelError(f"{label} target changed while it was opened")
        digest = hashlib.sha256()
        remaining = opened.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                raise AuditModelError(f"{label} target truncated while hashing")
            digest.update(chunk)
            remaining -= len(chunk)
        if os.read(descriptor, 1):
            raise AuditModelError(f"{label} target grew while hashing")
        after = os.fstat(descriptor)
        path_after = path.lstat() if no_follow else path.stat()
        if (
            opened.st_dev != after.st_dev
            or opened.st_ino != after.st_ino
            or opened.st_size != after.st_size
            or opened.st_mtime_ns != after.st_mtime_ns
            or opened.st_ctime_ns != after.st_ctime_ns
            or path_after.st_dev != opened.st_dev
            or path_after.st_ino != opened.st_ino
            or path_after.st_size != opened.st_size
            or path_after.st_mtime_ns != opened.st_mtime_ns
            or path_after.st_ctime_ns != opened.st_ctime_ns
        ):
            raise AuditModelError(f"{label} target changed while hashing")
        return digest.hexdigest(), opened.st_size
    finally:
        os.close(descriptor)


def hash_model_tree(
    root: Path,
    trust_root: Path,
    required_relative_paths: frozenset[str],
    label: str,
) -> tuple[str, int, int]:
    expanded_root = root.expanduser().absolute()
    expanded_trust = trust_root.expanduser().resolve(strict=True)
    try:
        assert_no_symlink_components(expanded_root, label)
    except AuditContractError as error:
        raise AuditModelError(str(error)) from error
    if not expanded_root.is_dir():
        raise AuditModelError(f"{label} is not a directory")
    rows: list[list[Any]] = []
    total_bytes = 0
    total_directories = 1
    present: set[str] = set()
    for directory, directories, files in os.walk(expanded_root, followlinks=False):
        directories.sort()
        files.sort()
        directory_path = Path(directory)
        relative_directory = directory_path.relative_to(expanded_root)
        if len(relative_directory.parts) > MAXIMUM_TREE_DEPTH:
            raise AuditModelError(f"{label} exceeds its directory depth bound")
        total_directories += len(directories)
        if total_directories > MAXIMUM_TREE_DIRECTORIES:
            raise AuditModelError(f"{label} exceeds its directory resource bound")
        for child in directories:
            if (directory_path / child).is_symlink():
                raise AuditModelError(f"{label} contains a symlinked directory")
        for filename in files:
            path = directory_path / filename
            relative = path.relative_to(expanded_root).as_posix()
            present.add(relative)
            metadata = path.lstat()
            if stat.S_ISLNK(metadata.st_mode):
                link_text = os.readlink(path)
                target = path.resolve(strict=True)
                if not is_within(target, expanded_trust):
                    raise AuditModelError(f"{label} symlink escapes its trust root: {relative}")
                digest, size = hash_regular_model_file(
                    target,
                    8 * 1024 * 1024 * 1024,
                    label,
                    require_single_link=False,
                    no_follow=True,
                )
                rows.append(["symlink", relative, link_text, size, digest])
            elif stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1:
                digest, size = hash_regular_model_file(
                    path,
                    8 * 1024 * 1024 * 1024,
                    label,
                    require_single_link=True,
                    no_follow=True,
                )
                rows.append(["file", relative, size, digest])
            else:
                raise AuditModelError(f"{label} contains an unsupported file: {relative}")
            total_bytes += size
            if len(rows) > 20_000 or total_bytes > 16 * 1024 * 1024 * 1024:
                raise AuditModelError(f"{label} exceeds its resource bound")
    missing = required_relative_paths - present
    if missing:
        raise AuditModelError(f"{label} is incomplete: missing={sorted(missing)}")
    rows.sort(key=lambda row: row[1])
    return sha256_canonical(rows), len(rows), total_bytes


class FastTextLanguageDetector:
    def __init__(self, model_path: Path) -> None:
        try:
            import fasttext  # type: ignore[import-not-found]
        except ImportError as error:
            raise AuditModelError("Pinned fastText runtime could not be imported") from error
        try:
            self._model = fasttext.load_model(str(model_path))
        except Exception as error:
            raise AuditModelError("Pinned fastText lid.176 model could not be loaded") from error

    def predict_many(self, values: Sequence[str]) -> Sequence[Sequence[LanguagePrediction]]:
        results: list[Sequence[LanguagePrediction]] = [() for _ in values]
        nonempty: list[tuple[int, str]] = [
            (index, normalized)
            for index, value in enumerate(values)
            if (normalized := value.replace("\n", " ").strip())
        ]
        for offset in range(0, len(nonempty), 4_096):
            batch = nonempty[offset : offset + 4_096]
            raw_labels, raw_probabilities = self._model.predict(
                [value for _, value in batch], k=5
            )
            if len(raw_labels) != len(batch) or len(raw_probabilities) != len(batch):
                raise AuditModelError("fastText returned a partial language batch")
            for (result_index, _), labels, probabilities in zip(
                batch, raw_labels, raw_probabilities
            ):
                if len(labels) != len(probabilities):
                    raise AuditModelError("fastText returned unaligned label/probability evidence")
                predictions: list[LanguagePrediction] = []
                for raw_label, raw_probability in zip(labels, probabilities):
                    label = str(raw_label)
                    if not label.startswith("__label__"):
                        raise AuditModelError("fastText returned a malformed language label")
                    probability = float(raw_probability)
                    if not math.isfinite(probability) or not 0.0 <= probability <= 1.0001:
                        raise AuditModelError("fastText returned a malformed probability")
                    predictions.append(LanguagePrediction(label[9:], min(1.0, probability)))
                results[result_index] = tuple(predictions)
        return tuple(results)


class LaBSESemanticScorer:
    def __init__(self, model_path: Path, execution_profile: Mapping[str, Any]) -> None:
        try:
            import torch
            from safetensors.torch import load_file
            from transformers import AutoModel, AutoTokenizer
        except ImportError as error:
            raise AuditModelError("Pinned LaBSE runtime could not be imported") from error
        expected_device = execution_profile.get("semanticDevice")
        if expected_device != "mps" or not torch.backends.mps.is_available():
            raise AuditModelError("The pinned semantic execution profile requires MPS")
        torch.set_num_threads(int(execution_profile["torchNumThreads"]))
        torch.set_num_interop_threads(
            int(execution_profile["torchNumInteropThreads"])
        )
        if (
            torch.get_num_threads() != execution_profile["torchNumThreads"]
            or torch.get_num_interop_threads()
            != execution_profile["torchNumInteropThreads"]
        ):
            raise AuditModelError("Pinned torch thread settings were not applied")
        self._torch = torch
        self._tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
        self._model = AutoModel.from_pretrained(model_path, local_files_only=True)
        dense = load_file(str(model_path / "2_Dense" / "model.safetensors"))
        self._device = expected_device
        self._model.to(self._device)
        self._model.eval()
        self._dense_weight = dense["linear.weight"].to(self._device)
        self._dense_bias = dense["linear.bias"].to(self._device)
        self._source_cache: dict[str, Any] = {}

    def _encode(self, values: Sequence[str]) -> Any:
        torch = self._torch
        encoded_batches: list[Any] = []
        for offset in range(0, len(values), 64):
            batch = self._tokenizer(
                list(values[offset : offset + 64]),
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            batch = {key: tensor.to(self._device) for key, tensor in batch.items()}
            with torch.inference_mode():
                cls = self._model(**batch).last_hidden_state[:, 0]
                projected = torch.tanh(
                    torch.nn.functional.linear(
                        cls, self._dense_weight, self._dense_bias
                    )
                )
                normalized = torch.nn.functional.normalize(projected, p=2, dim=1)
            encoded_batches.append(normalized.cpu())
        if not encoded_batches:
            return torch.empty((0, 768))
        return torch.cat(encoded_batches, dim=0)

    def similarities(self, sources: Sequence[str], values: Sequence[str]) -> Sequence[float]:
        if len(sources) != len(values):
            raise AuditModelError("LaBSE received unaligned source/value batches")
        if not sources:
            return ()
        missing_by_digest: dict[str, str] = {}
        for source in sources:
            digest = sha256_text(source)
            if digest not in self._source_cache:
                prior = missing_by_digest.setdefault(digest, source)
                if prior != source:
                    raise AuditModelError("LaBSE source digest collision")
        if missing_by_digest:
            digests = list(missing_by_digest)
            vectors = self._encode([missing_by_digest[digest] for digest in digests])
            for index, digest in enumerate(digests):
                self._source_cache[digest] = vectors[index]
        source_vectors = self._torch.stack(
            [self._source_cache[sha256_text(source)] for source in sources]
        )
        value_vectors = self._encode(values)
        scores = (source_vectors * value_vectors).sum(dim=1).tolist()
        normalized: list[float] = []
        for score in scores:
            value = float(score)
            if not math.isfinite(value) or not -1.0001 <= value <= 1.0001:
                raise AuditModelError("LaBSE returned a malformed similarity")
            normalized.append(max(-1.0, min(1.0, value)))
        return tuple(normalized)


class MadladBacktranslator:
    def __init__(self, model_path: Path, execution_profile: Mapping[str, Any]) -> None:
        try:
            import ctranslate2
            from transformers import AutoTokenizer
        except ImportError as error:
            raise AuditModelError("Pinned MADLAD runtime could not be imported") from error
        try:
            self._translator = ctranslate2.Translator(
                str(model_path),
                device=str(execution_profile["backtranslationDevice"]),
                compute_type=str(execution_profile["backtranslationComputeType"]),
                inter_threads=int(execution_profile["backtranslationInterThreads"]),
                intra_threads=int(execution_profile["backtranslationIntraThreads"]),
            )
            self._tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
        except Exception as error:
            raise AuditModelError("Pinned MADLAD model could not be loaded") from error

    def to_english(self, locale: str, values: Sequence[str]) -> Sequence[str]:
        if locale not in LANGUAGE_BY_LOCALE:
            raise AuditModelError(f"MADLAD received unsupported locale: {locale}")
        outputs: list[str] = []
        for offset in range(0, len(values), 32):
            batch = values[offset : offset + 32]
            token_batches: list[list[str]] = []
            for value in batch:
                token_ids = self._tokenizer.encode(
                    "<2en> " + value,
                    add_special_tokens=True,
                    truncation=True,
                    max_length=512,
                )
                token_batches.append(self._tokenizer.convert_ids_to_tokens(token_ids))
            try:
                translated = self._translator.translate_batch(
                    token_batches,
                    beam_size=1,
                    max_decoding_length=512,
                    repetition_penalty=1.1,
                    return_scores=False,
                )
            except Exception as error:
                raise AuditModelError("MADLAD backtranslation failed") from error
            if len(translated) != len(batch):
                raise AuditModelError("MADLAD returned a partial backtranslation batch")
            for result in translated:
                if not result.hypotheses:
                    raise AuditModelError("MADLAD returned an empty hypothesis set")
                ids = self._tokenizer.convert_tokens_to_ids(result.hypotheses[0])
                output = self._tokenizer.decode(ids, skip_special_tokens=True).strip()
                if not output:
                    raise AuditModelError("MADLAD returned an empty backtranslation")
                outputs.append(output)
        return tuple(outputs)


def load_pinned_models(
    fasttext_model: Path,
    expected_fasttext_sha256: str,
    labse_model: Path,
    expected_labse_tree_sha256: str,
    madlad_model: Path,
    expected_madlad_tree_sha256: str,
    execution_profile: Mapping[str, Any] = EXECUTION_PROFILE,
) -> AuditModels:
    if canonical_json(execution_profile) != canonical_json(EXECUTION_PROFILE):
        raise AuditContractError("Semantic-audit execution profile is not exact")
    runtime_versions = validate_runtime_versions()
    fasttext_resolved = require_cached_model_path(fasttext_model, "fastText model")
    labse_resolved = require_cached_model_path(labse_model, "LaBSE model")
    madlad_resolved = require_cached_model_path(madlad_model, "MADLAD model")
    fasttext_sha256, _ = hash_model_file(fasttext_resolved, "fastText model")
    require_matching_digest(fasttext_sha256, expected_fasttext_sha256, "fastText model")
    labse_trust_root = labse_resolved
    if labse_resolved.parent.name == "snapshots":
        labse_trust_root = labse_resolved.parent.parent
    labse_sha256, _, _ = hash_model_tree(
        labse_resolved,
        labse_trust_root,
        frozenset(
            {
                "config.json",
                "model.safetensors",
                "tokenizer.json",
                "2_Dense/config.json",
                "2_Dense/model.safetensors",
            }
        ),
        "LaBSE model",
    )
    require_matching_digest(labse_sha256, expected_labse_tree_sha256, "LaBSE model tree")
    madlad_sha256, _, _ = hash_model_tree(
        madlad_resolved,
        madlad_resolved,
        frozenset({"config.json", "model.bin", "spiece.model", "tokenizer.json"}),
        "MADLAD model",
    )
    require_matching_digest(madlad_sha256, expected_madlad_tree_sha256, "MADLAD model tree")
    evidence_material = {
        "fasttextSha256": fasttext_sha256,
        "labseTreeSha256": labse_sha256,
        "madladTreeSha256": madlad_sha256,
        "runtimeVersions": dict(runtime_versions),
    }
    evidence = ModelEvidence(
        model_lock_sha256=sha256_canonical(evidence_material),
        fasttext_sha256=fasttext_sha256,
        labse_tree_sha256=labse_sha256,
        madlad_tree_sha256=madlad_sha256,
        runtime_versions=runtime_versions,
    )
    return AuditModels(
        language=FastTextLanguageDetector(fasttext_resolved),
        semantic=LaBSESemanticScorer(labse_resolved, execution_profile),
        backtranslator=MadladBacktranslator(madlad_resolved, execution_profile),
        evidence=evidence,
    )


def normalized_words(value: str) -> list[str]:
    return [unicodedata.normalize("NFKC", word).casefold() for word in WORD_RE.findall(value)]


def count_letters(value: str) -> int:
    return sum(1 for character in value if character.isalpha())


def mask_field_text(value: str, literals: Sequence[str]) -> str:
    masked = value
    for literal in sorted(set(literals), key=lambda item: (-len(item), item)):
        if literal:
            masked = masked.replace(literal, " ")
    masked = URL_OR_OPAQUE_RE.sub(" ", masked)
    return re.sub(r"\s+", " ", masked).strip()


def canonical_afrikaans_pack_context(
    masked_values: Sequence[str],
) -> AfrikaansPackContext:
    normalized_values = tuple(
        sorted(
            {
                normalized
                for value in masked_values
                if (
                    normalized := re.sub(
                        r"\s+",
                        " ",
                        unicodedata.normalize("NFKC", value).casefold(),
                    ).strip()
                )
            }
        )
    )
    context = " ".join(normalized_values)
    return AfrikaansPackContext(
        text=context,
        sha256=sha256_text(context),
        distinct_masked_values=len(normalized_values),
        masked_letters=count_letters(context),
    )


def afrikaans_pack_context_gate(
    context: AfrikaansPackContext,
    predictions: Sequence[LanguagePrediction],
) -> bool:
    policy_language = as_mapping(AUDIT_POLICY["language"], "language policy")
    policy = as_mapping(
        policy_language["afrikaansPackContext"],
        "Afrikaans pack-context policy",
    )
    probabilities = prediction_map(predictions)
    return bool(
        context.distinct_masked_values
        >= int(policy["minimumDistinctMaskedValues"])
        and context.masked_letters >= int(policy["minimumMaskedLetters"])
        and predictions
        and predictions[0].label == policy["targetLabel"]
        and probabilities.get(str(policy["targetLabel"]), 0.0)
        >= float(policy["minimumPackTargetProbability"])
        and (
            probabilities.get(str(policy["targetLabel"]), 0.0)
            + probabilities.get(str(policy["relatedLabel"]), 0.0)
        )
        >= float(policy["minimumPackPairProbability"])
    )


def afrikaans_pack_context_eligible(context: AfrikaansPackContext) -> bool:
    policy = as_mapping(
        as_mapping(AUDIT_POLICY["language"], "language policy")[
            "afrikaansPackContext"
        ],
        "Afrikaans pack-context policy",
    )
    return bool(
        context.distinct_masked_values
        >= int(policy["minimumDistinctMaskedValues"])
        and context.masked_letters >= int(policy["minimumMaskedLetters"])
    )


def build_afrikaans_pack_context_evidence(
    locale: str,
    masked_values: Sequence[str],
    detector: LanguageDetector,
) -> Optional[dict[str, Any]]:
    policy = as_mapping(
        as_mapping(AUDIT_POLICY["language"], "language policy")[
            "afrikaansPackContext"
        ],
        "Afrikaans pack-context policy",
    )
    if locale != policy["locale"]:
        return None
    context = canonical_afrikaans_pack_context(masked_values)
    eligible = afrikaans_pack_context_eligible(context)
    predictions: Sequence[LanguagePrediction] = ()
    if eligible:
        predictions = validate_prediction_batch(
            (context.text,), detector.predict_many((context.text,))
        )[0]
    gate_passed = eligible and afrikaans_pack_context_gate(context, predictions)
    return {
        "contextSha256": context.sha256,
        "distinctMaskedValues": context.distinct_masked_values,
        "maskedLetters": context.masked_letters,
        "eligible": eligible,
        "predictions": [
            [prediction.label, prediction.probability]
            for prediction in predictions
        ],
        "gatePassed": gate_passed,
        "rescuedFields": 0,
        "fieldPairRescuedFields": 0,
        "trackedCuratedRescuedFields": 0,
        "referenceMatchFields": 0,
        "referenceMatchRootSha256": sha256_canonical([]),
        "trackedCuratedRescueRootSha256": sha256_canonical([]),
    }


def should_rescue_afrikaans_field(
    locale: str,
    _origin: str,
    failures: set[str],
    predictions: Sequence[LanguagePrediction],
    pack_gate_passed: bool,
) -> bool:
    policy_language = as_mapping(AUDIT_POLICY["language"], "language policy")
    policy = as_mapping(
        policy_language["afrikaansPackContext"],
        "Afrikaans pack-context policy",
    )
    if (
        locale != policy["locale"]
        or not pack_gate_passed
        or failures != {"language-target-low-confidence"}
        or len(predictions) < 2
        or {predictions[0].label, predictions[1].label}
        != {policy["targetLabel"], policy["relatedLabel"]}
    ):
        return False
    probabilities = prediction_map(predictions)
    return bool(
        probabilities.get(str(policy["targetLabel"]), 0.0)
        + probabilities.get(str(policy["relatedLabel"]), 0.0)
        >= float(policy["minimumFieldPairProbability"])
        and probabilities.get("en", 0.0)
        <= float(policy_language["maximumEnglishProbability"])
    )


def tracked_support_pair_identity_sha256(
    locale: str,
    source: str,
    source_sha256: str,
    value: str,
    value_sha256: str,
) -> str:
    return sha256_canonical(
        [locale, source, source_sha256, value, value_sha256]
    )


def empty_tracked_afrikaans_reference_catalog() -> TrackedAfrikaansReferenceCatalog:
    return TrackedAfrikaansReferenceCatalog(
        evidence={}, support_pair_identities={}
    )


def tracked_afrikaans_reference_summary(
    catalog: TrackedAfrikaansReferenceCatalog,
) -> Mapping[str, Any]:
    evidence = catalog.evidence
    if not evidence:
        empty_root = sha256_canonical([])
        return {
            "referencePacks": 0,
            "referencePackIdentityRootSha256": empty_root,
            "referencePackGateEvidenceRootSha256": empty_root,
            "supportPairCount": 0,
            "supportPairRootSha256": empty_root,
            "supportRecordCount": 0,
            "supportRecordRootSha256": empty_root,
            "conflictSourceCount": 0,
            "conflictSourceRootSha256": empty_root,
        }
    reference_packs = as_list(
        evidence.get("referencePacks"),
        "tracked Afrikaans reference packs",
    )
    return {
        "referencePacks": len(reference_packs),
        "referencePackIdentityRootSha256": require_sha256(
            evidence.get("referencePackIdentityRootSha256"),
            "tracked reference pack identity root",
        ),
        "referencePackGateEvidenceRootSha256": require_sha256(
            evidence.get("referencePackGateEvidenceRootSha256"),
            "tracked reference pack gate root",
        ),
        "supportPairCount": require_bounded_nonnegative_integer(
            evidence.get("supportPairCount"),
            "tracked reference support pair count",
            100_000,
        ),
        "supportPairRootSha256": require_sha256(
            evidence.get("supportPairRootSha256"),
            "tracked reference support pair root",
        ),
        "supportRecordCount": require_bounded_nonnegative_integer(
            evidence.get("supportRecordCount"),
            "tracked reference support record count",
            500_000,
        ),
        "supportRecordRootSha256": require_sha256(
            evidence.get("supportRecordRootSha256"),
            "tracked reference support record root",
        ),
        "conflictSourceCount": require_bounded_nonnegative_integer(
            evidence.get("conflictSourceCount"),
            "tracked reference conflict source count",
            100_000,
        ),
        "conflictSourceRootSha256": require_sha256(
            evidence.get("conflictSourceRootSha256"),
            "tracked reference conflict source root",
        ),
    }


def _tracked_reference_pack_identity_row(pack: TranslationPack) -> list[Any]:
    return [
        pack.locale,
        pack.source.namespace,
        pack.source.source_hash,
        pack.source.source_entries_sha256,
        pack.file_sha256,
        len(pack.entries),
        pack_field_value_root(pack),
    ]


def _parse_tracked_reference_predictions(
    value: Any,
) -> tuple[LanguagePrediction, ...]:
    raw_predictions = as_list(value, "tracked reference predictions")
    if len(raw_predictions) > 5:
        raise AuditContractError("Tracked reference predictions are too broad")
    predictions: list[LanguagePrediction] = []
    for raw_prediction in raw_predictions:
        prediction = as_list(raw_prediction, "tracked reference prediction")
        if len(prediction) != 2:
            raise AuditContractError("Tracked reference prediction shape is invalid")
        predictions.append(
            LanguagePrediction(
                as_string(prediction[0], "tracked reference label", 32),
                float(
                    require_checkpoint_score(
                        prediction[1],
                        "tracked reference probability",
                        0.0,
                        1.0,
                        allow_none=False,
                        require_six_decimals=False,
                    )
                ),
            )
        )
    prediction_map(predictions)
    return tuple(predictions)


def derive_tracked_afrikaans_reference_catalog(
    reference_packs: Sequence[TranslationPack],
    session_sha256: str,
    *,
    detector: Optional[LanguageDetector] = None,
    evidence_value: Any = None,
) -> TrackedAfrikaansReferenceCatalog:
    require_sha256(session_sha256, "tracked reference session SHA-256")
    packs = tuple(
        sorted(reference_packs, key=lambda pack: pack.source.namespace)
    )
    if any(
        pack.locale != "af" or pack.origin != "curated" for pack in packs
    ):
        raise AuditContractError(
            "Tracked Afrikaans references must be curated/static Afrikaans packs"
        )
    if len({pack.source.namespace for pack in packs}) != len(packs):
        raise AuditContractError("Tracked Afrikaans reference packs are duplicate")
    contexts = [
        canonical_afrikaans_pack_context(
            tuple(
                mask_field_text(entry.value, entry.source.literal_segments)
                for entry in pack.entries
            )
        )
        for pack in packs
    ]
    parsed_evidence: Optional[Mapping[str, Any]] = None
    recorded_rows: list[Any] = []
    if evidence_value is not None:
        parsed_evidence = as_mapping(
            evidence_value, "tracked Afrikaans reference evidence"
        )
        require_exact_keys(
            parsed_evidence,
            {
                "schemaVersion",
                "kind",
                "sessionSha256",
                "referencePackIdentityRootSha256",
                "referencePackGateEvidenceRootSha256",
                "referencePacks",
                "supportPairCount",
                "supportPairRootSha256",
                "supportRecordCount",
                "supportRecordRootSha256",
                "conflictSourceCount",
                "conflictSourceRootSha256",
            },
            "tracked Afrikaans reference evidence",
        )
        if (
            parsed_evidence.get("schemaVersion") != 1
            or parsed_evidence.get("kind")
            != "inspir-afrikaans-tracked-curated-reference-evidence-v1"
            or parsed_evidence.get("sessionSha256") != session_sha256
        ):
            raise AuditContractError(
                "Tracked Afrikaans reference evidence belongs to another session"
            )
        recorded_rows = as_list(
            parsed_evidence.get("referencePacks"),
            "tracked Afrikaans reference packs",
        )
        if len(recorded_rows) != len(packs):
            raise AuditContractError(
                "Tracked Afrikaans reference pack evidence is partial"
            )
    elif detector is None:
        raise AuditContractError(
            "Tracked Afrikaans references need detector or recorded evidence"
        )

    eligible_contexts = [
        context.text
        for context in contexts
        if afrikaans_pack_context_eligible(context)
    ]
    generated_predictions: list[Sequence[LanguagePrediction]] = []
    if parsed_evidence is None:
        assert detector is not None
        if eligible_contexts:
            generated_predictions = list(
                validate_prediction_batch(
                    eligible_contexts,
                    detector.predict_many(eligible_contexts),
                )
            )
    generated_index = 0
    pack_rows: list[Mapping[str, Any]] = []
    gate_by_namespace: dict[str, bool] = {}
    identity_rows: list[list[Any]] = []
    for index, (pack, context) in enumerate(zip(packs, contexts)):
        eligible = afrikaans_pack_context_eligible(context)
        if parsed_evidence is None:
            predictions = (
                tuple(generated_predictions[generated_index])
                if eligible
                else ()
            )
            if eligible:
                generated_index += 1
        else:
            row = as_mapping(
                recorded_rows[index], "tracked Afrikaans reference pack"
            )
            require_exact_keys(
                row,
                {
                    "locale",
                    "namespace",
                    "sourceHash",
                    "sourceEntriesSha256",
                    "packFileSha256",
                    "fields",
                    "fieldValueRootSha256",
                    "contextSha256",
                    "distinctMaskedValues",
                    "maskedLetters",
                    "eligible",
                    "predictions",
                    "gatePassed",
                },
                "tracked Afrikaans reference pack",
            )
            predictions = _parse_tracked_reference_predictions(
                row.get("predictions")
            )
        if (eligible and len(predictions) != 5) or (
            not eligible and bool(predictions)
        ):
            raise AuditContractError(
                "Tracked Afrikaans reference prediction eligibility drifted"
            )
        gate_passed = eligible and afrikaans_pack_context_gate(
            context, predictions
        )
        identity_row = _tracked_reference_pack_identity_row(pack)
        identity_rows.append(identity_row)
        expected_row: Mapping[str, Any] = {
            "locale": pack.locale,
            "namespace": pack.source.namespace,
            "sourceHash": pack.source.source_hash,
            "sourceEntriesSha256": pack.source.source_entries_sha256,
            "packFileSha256": pack.file_sha256,
            "fields": len(pack.entries),
            "fieldValueRootSha256": pack_field_value_root(pack),
            "contextSha256": context.sha256,
            "distinctMaskedValues": context.distinct_masked_values,
            "maskedLetters": context.masked_letters,
            "eligible": eligible,
            "predictions": [
                [prediction.label, prediction.probability]
                for prediction in predictions
            ],
            "gatePassed": gate_passed,
        }
        if parsed_evidence is not None and dict(row) != expected_row:
            raise AuditContractError(
                "Tracked Afrikaans reference pack evidence drifted"
            )
        pack_rows.append(expected_row)
        gate_by_namespace[pack.source.namespace] = gate_passed

    occurrences: dict[
        str, list[tuple[TranslationPack, PackEntry, str, str]]
    ] = collections.defaultdict(list)
    source_bytes_by_hash: dict[str, str] = {}
    distinct_values: dict[str, set[tuple[str, str, str]]] = (
        collections.defaultdict(set)
    )
    for pack in packs:
        for entry in pack.entries:
            value_sha256 = sha256_text(entry.value)
            source_sha256 = entry.source.source_sha256
            prior_source = source_bytes_by_hash.get(source_sha256)
            if prior_source is not None and prior_source != entry.source.source:
                raise AuditContractError(
                    "Tracked Afrikaans references contain a source-hash collision"
                )
            source_bytes_by_hash[source_sha256] = entry.source.source
            distinct_values[source_sha256].add(
                (entry.source.source, entry.value, value_sha256)
            )
            occurrences[source_sha256].append(
                (pack, entry, entry.value, value_sha256)
            )
    conflict_rows: list[list[Any]] = []
    support_pair_rows: list[list[Any]] = []
    support_record_rows: list[list[Any]] = []
    support_pairs: dict[tuple[str, str, str, str, str], str] = {}
    for source_sha256 in sorted(distinct_values):
        values = distinct_values[source_sha256]
        if len(values) != 1:
            conflict_rows.append(
                [
                    source_sha256,
                    [list(value) for value in sorted(values)],
                ]
            )
            continue
        source, value, value_sha256 = next(iter(values))
        supporting = [
            occurrence
            for occurrence in occurrences[source_sha256]
            if gate_by_namespace[occurrence[0].source.namespace]
        ]
        if not supporting:
            continue
        pair_key = ("af", source, source_sha256, value, value_sha256)
        pair_identity = tracked_support_pair_identity_sha256(*pair_key)
        support_pairs[pair_key] = pair_identity
        support_pair_rows.append(
            [pair_identity, "af", source, source_sha256, value, value_sha256]
        )
        for pack, entry, _, _ in supporting:
            support_record_rows.append(
                [
                    "af",
                    pack.source.namespace,
                    entry.source.key,
                    pack.file_sha256,
                    source,
                    source_sha256,
                    value,
                    value_sha256,
                    True,
                    pair_identity,
                ]
            )
    support_pair_rows.sort(key=lambda row: (row[3], row[5]))
    support_record_rows.sort(key=lambda row: (row[1], row[2], row[3]))
    reference_evidence: Mapping[str, Any] = {
        "schemaVersion": 1,
        "kind": "inspir-afrikaans-tracked-curated-reference-evidence-v1",
        "sessionSha256": session_sha256,
        "referencePackIdentityRootSha256": sha256_canonical(identity_rows),
        "referencePackGateEvidenceRootSha256": sha256_canonical(pack_rows),
        "referencePacks": pack_rows,
        "supportPairCount": len(support_pair_rows),
        "supportPairRootSha256": sha256_canonical(support_pair_rows),
        "supportRecordCount": len(support_record_rows),
        "supportRecordRootSha256": sha256_canonical(support_record_rows),
        "conflictSourceCount": len(conflict_rows),
        "conflictSourceRootSha256": sha256_canonical(conflict_rows),
    }
    if parsed_evidence is not None and dict(parsed_evidence) != reference_evidence:
        raise AuditContractError(
            "Tracked Afrikaans support/conflict evidence drifted"
        )
    return TrackedAfrikaansReferenceCatalog(
        evidence=reference_evidence,
        support_pair_identities=support_pairs,
    )


def tracked_support_pair_for_field(
    pack: TranslationPack,
    entry: PackEntry,
    catalog: TrackedAfrikaansReferenceCatalog,
) -> Optional[str]:
    if pack.locale != "af" or pack.origin != "candidate":
        return None
    value_sha256 = sha256_text(entry.value)
    return catalog.support_pair_identities.get(
        (
            pack.locale,
            entry.source.source,
            entry.source.source_sha256,
            entry.value,
            value_sha256,
        )
    )


def prediction_map(predictions: Sequence[LanguagePrediction]) -> Mapping[str, float]:
    result: dict[str, float] = {}
    prior = 2.0
    for prediction in predictions:
        if (
            not prediction.label
            or not math.isfinite(prediction.probability)
            or not 0.0 <= prediction.probability <= 1.0
            or prediction.probability > prior
            or prediction.label in result
        ):
            raise AuditModelError("Language detector returned malformed ranked evidence")
        result[prediction.label] = prediction.probability
        prior = prediction.probability
    return result


def parse_exact_checkpoint_predictions(
    value: Any,
    label: str,
    expected: int,
) -> tuple[LanguagePrediction, ...]:
    rows = as_list(value, label)
    if len(rows) != expected:
        raise AuditContractError(
            f"{label} must contain exactly {expected} ranked predictions"
        )
    predictions: list[LanguagePrediction] = []
    for row in rows:
        prediction = as_list(row, f"{label} prediction")
        if len(prediction) != 2:
            raise AuditContractError(f"{label} prediction shape is invalid")
        predictions.append(
            LanguagePrediction(
                as_string(prediction[0], f"{label} language label", 32),
                float(
                    require_checkpoint_score(
                        prediction[1],
                        f"{label} probability",
                        0.0,
                        1.0,
                        allow_none=False,
                        require_six_decimals=False,
                    )
                ),
            )
        )
    try:
        prediction_map(predictions)
    except AuditModelError as error:
        raise AuditContractError(f"{label} is not unique ranked evidence") from error
    return tuple(predictions)


def validate_prediction_batch(
    requested: Sequence[str],
    predictions: Sequence[Sequence[LanguagePrediction]],
) -> tuple[Sequence[LanguagePrediction], ...]:
    if len(requested) != len(predictions):
        raise AuditModelError("Language detector returned a partial batch")
    normalized: list[Sequence[LanguagePrediction]] = []
    for requested_value, item in zip(requested, predictions):
        expected = 5 if requested_value.replace("\n", " ").strip() else 0
        if len(item) != expected:
            raise AuditModelError(
                f"Language detector returned {len(item)} predictions for an "
                f"input requiring exactly {expected}"
            )
        prediction_map(item)
        normalized.append(tuple(item))
    return tuple(normalized)


def validate_similarity_batch(
    requested: Sequence[str],
    scores: Sequence[float],
    label: str,
) -> tuple[float, ...]:
    if len(requested) != len(scores):
        raise AuditModelError(f"{label} returned a partial similarity batch")
    normalized: list[float] = []
    for score in scores:
        value = float(score)
        if not math.isfinite(value) or not -1.0001 <= value <= 1.0001:
            raise AuditModelError(f"{label} returned malformed similarity evidence")
        normalized.append(max(-1.0, min(1.0, value)))
    return tuple(normalized)


def counter_values(pattern: re.Pattern[str], value: str) -> collections.Counter[str]:
    return collections.Counter(pattern.findall(value))


def literal_counter(literals: Sequence[str], value: str) -> collections.Counter[str]:
    result: collections.Counter[str] = collections.Counter()
    for literal in set(literals):
        if literal:
            result[literal] = value.count(literal)
    return result


def has_source_ngram_copy(source: str, value: str) -> bool:
    source_words = [word.casefold() for word in ASCII_WORD_RE.findall(source)]
    value_words = [word.casefold() for word in ASCII_WORD_RE.findall(value)]
    minimum_words = int(AUDIT_POLICY["sourceCopy"]["minimumExactNgramWords"])
    minimum_characters = int(AUDIT_POLICY["sourceCopy"]["minimumExactNgramCharacters"])
    if len(source_words) < minimum_words or len(value_words) < minimum_words:
        return False
    target_ngrams = {
        tuple(value_words[index : index + minimum_words])
        for index in range(len(value_words) - minimum_words + 1)
    }
    for index in range(len(source_words) - minimum_words + 1):
        ngram = tuple(source_words[index : index + minimum_words])
        meaningful = [
            word
            for word in ngram
            if word not in ENGLISH_FUNCTION_WORDS and word not in TECHNICAL_SHARED_TERMS
        ]
        if (
            ngram in target_ngrams
            and len(" ".join(ngram)) >= minimum_characters
            and meaningful
        ):
            return True
    return False


def has_untranslated_source_token_cluster(source: str, value: str) -> bool:
    source_words = {
        word.casefold()
        for word in ASCII_WORD_RE.findall(source)
        if len(word) >= 5
        and word.casefold() not in ENGLISH_FUNCTION_WORDS
        and word.casefold() not in TECHNICAL_SHARED_TERMS
    }
    value_words = {word.casefold() for word in ASCII_WORD_RE.findall(value)}
    return len(source_words & value_words) >= 3


def has_internal_duplicate_collapse(source: str, value: str) -> bool:
    source_words = normalized_words(source)
    value_words = normalized_words(value)
    if len(set(source_words)) <= len(set(value_words)):
        return False
    for index, word in enumerate(value_words):
        if len(word) < 3:
            continue
        if index + 2 < len(value_words) and value_words[index + 2] == word:
            return True
        if index + 1 < len(value_words) and value_words[index + 1] == word:
            return True
    clauses = [
        " ".join(normalized_words(clause))
        for clause in CLAUSE_RE.split(value)
        if normalized_words(clause)
    ]
    return len(clauses) != len(set(clauses))


def semantic_threshold(source: str, legal: bool) -> float:
    policy = AUDIT_POLICY["semantic"]
    if legal:
        return float(policy["legalMinimum"])
    words = len(normalized_words(source))
    if words <= 3:
        return float(policy["shortMinimum"])
    if words <= 7:
        return float(policy["mediumMinimum"])
    return float(policy["standardMinimum"])


def split_sentences(value: str) -> tuple[str, ...]:
    sentences = tuple(part.strip() for part in SENTENCE_RE.split(value) if part.strip())
    if not sentences:
        return (value.strip(),) if value.strip() else ()
    return sentences[:32]


def build_alignment_evidence(
    scores: Sequence[float],
    source_sentence_count: int,
    backtranslation_sentence_count: int,
) -> AlignmentEvidence:
    if source_sentence_count < 1 or backtranslation_sentence_count < 1:
        raise AuditModelError("Sentence alignment dimensions must be positive")
    expected_cells = source_sentence_count * backtranslation_sentence_count
    if len(scores) != expected_cells:
        raise AuditModelError(
            "Sentence alignment score cardinality differs from its matrix dimensions"
        )
    rows: list[tuple[float, ...]] = []
    cursor = 0
    for _ in range(source_sentence_count):
        next_cursor = cursor + backtranslation_sentence_count
        row = tuple(float(score) for score in scores[cursor:next_cursor])
        if len(row) != backtranslation_sentence_count or any(
            not math.isfinite(score) or not -1.0001 <= score <= 1.0001
            for score in row
        ):
            raise AuditModelError("Sentence alignment row is partial or malformed")
        rows.append(row)
        cursor = next_cursor
    if cursor != len(scores) or len(rows) != source_sentence_count:
        raise AuditModelError("Sentence alignment matrix did not consume every score exactly")
    matrix = tuple(rows)
    minimum_source_alignment = min(max(row) for row in matrix)
    minimum_backtranslation_alignment = min(
        max(matrix[source_index][back_index] for source_index in range(len(matrix)))
        for back_index in range(backtranslation_sentence_count)
    )
    return AlignmentEvidence(
        matrix=matrix,
        minimum_source_alignment=minimum_source_alignment,
        minimum_backtranslation_alignment=minimum_backtranslation_alignment,
    )


def rounded_score(value: Optional[float]) -> Optional[float]:
    return None if value is None else round(value, 6)


def is_legal_namespace(namespace: str) -> bool:
    return LEGAL_NAMESPACE_RE.search(namespace) is not None


def field_identity_sha256(pack: TranslationPack, entry: PackEntry) -> str:
    return sha256_canonical(
        [
            pack.locale,
            pack.language,
            pack.source.namespace,
            pack.source.source_hash,
            entry.source.key,
            entry.source.source_sha256,
            sha256_text(entry.value),
            pack.origin,
            pack.file_sha256,
        ]
    )


def expected_adjudication_bindings(
    expectations: AuditExpectations,
    audit_policy_sha256: str,
    implementation_sha256: str,
    model_evidence: ModelEvidence,
    master_worklist_sha256: str,
    master_worklist_file_sha256: str,
    trees: Mapping[str, TreeSnapshot],
) -> Mapping[str, Any]:
    return {
        "scope": expectations.scope,
        "auditPolicySha256": audit_policy_sha256,
        "implementationSha256": implementation_sha256,
        "modelLockSha256": model_evidence.model_lock_sha256,
        "masterWorklistSha256": master_worklist_sha256,
        "masterWorklistFileSha256": master_worklist_file_sha256,
        "curatedTreeSha256": trees["curated"].sha256,
        "staticMainAppTreeSha256": trees["staticMainApp"].sha256,
        "candidateTreeSha256": trees["candidates"].sha256,
        "packWorklistTreeSha256": trees["packWorklists"].sha256,
    }


def parse_adjudications(
    path: Optional[Path],
    expected_bindings: Mapping[str, Any],
) -> AdjudicationSet:
    if path is None:
        return AdjudicationSet(sha256=None, reviews={})
    payload = as_mapping(read_json(path, MAXIMUM_JSON_BYTES, "adjudications"), "adjudications")
    require_exact_keys(
        payload,
        {"schemaVersion", "kind", "bindings", "reviews", "adjudicationSha256"},
        "adjudications",
    )
    if payload.get("schemaVersion") != 1 or payload.get("kind") != ADJUDICATION_KIND:
        raise AuditContractError("Adjudication schema/kind is unsupported")
    if payload.get("bindings") != expected_bindings:
        raise AuditContractError("Adjudications are stale for the current audit inputs/models/policy")
    adjudication_sha256 = require_sha256(
        payload.get("adjudicationSha256"), "adjudicationSha256"
    )
    material = dict(payload)
    del material["adjudicationSha256"]
    if sha256_canonical(material) != adjudication_sha256:
        raise AuditContractError("Adjudication artifact is stale or tampered")
    reviews: dict[str, AdjudicationReview] = {}
    prior_identity = ""
    for raw_review in as_list(payload.get("reviews"), "adjudication reviews"):
        review = as_mapping(raw_review, "adjudication review")
        require_exact_keys(
            review,
            {
                "identitySha256",
                "reviewKind",
                "reviewer",
                "reviewedAt",
                "rationaleSha256",
                "acceptedFailureCodes",
            },
            "adjudication review",
        )
        identity = require_sha256(review.get("identitySha256"), "review identitySha256")
        rationale = require_sha256(review.get("rationaleSha256"), "review rationaleSha256")
        review_kind = as_string(review.get("reviewKind"), "review kind", 128)
        reviewer = as_string(review.get("reviewer"), "reviewer", 256).strip()
        reviewed_at = as_string(review.get("reviewedAt"), "reviewedAt", 64)
        if review_kind not in {
            "independent-translation-review",
            "independent-legal-copy-review",
        } or not reviewer:
            raise AuditContractError("Adjudication review identity/kind is invalid")
        try:
            timestamp = dt.datetime.fromisoformat(reviewed_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise AuditContractError("Adjudication reviewedAt is not ISO-8601") from error
        if timestamp.tzinfo is None:
            raise AuditContractError("Adjudication reviewedAt must include a timezone")
        raw_codes = as_list(review.get("acceptedFailureCodes"), "accepted failure codes")
        codes = tuple(as_string(code, "accepted failure code", 128) for code in raw_codes)
        if (
            identity <= prior_identity
            or identity in reviews
            or not codes
            or tuple(sorted(set(codes))) != codes
            or any(code not in ADJUDICABLE_FAILURES for code in codes)
        ):
            raise AuditContractError("Adjudication review is duplicate, noncanonical, or unsafe")
        prior_identity = identity
        reviews[identity] = AdjudicationReview(
            identity_sha256=identity,
            review_kind=review_kind,
            reviewer=reviewer,
            reviewed_at=reviewed_at,
            rationale_sha256=rationale,
            accepted_failure_codes=codes,
        )
    return AdjudicationSet(sha256=adjudication_sha256, reviews=reviews)


def apply_adjudication(
    identity_sha256: str,
    failure_codes: set[str],
    legal: bool,
    adjudications: AdjudicationSet,
) -> tuple[tuple[str, ...], tuple[str, ...], bool]:
    review = adjudications.reviews.get(identity_sha256)
    if review is None:
        return tuple(sorted(failure_codes)), (), False
    accepted = set(review.accepted_failure_codes)
    if not accepted.issubset(failure_codes):
        raise AuditContractError("Adjudication accepts failure codes absent from current evidence")
    if not accepted.issubset(ADJUDICABLE_FAILURES):
        raise AuditContractError("Adjudication attempts to accept a hard invariant failure")
    if review.review_kind == "independent-legal-copy-review" and not legal:
        raise AuditContractError("A legal-copy review is attached to a non-legal field")
    remaining = failure_codes - accepted
    return tuple(sorted(remaining)), tuple(sorted(accepted)), True


class CanonicalArrayHasher:
    def __init__(self) -> None:
        self._hash = hashlib.sha256()
        self._hash.update(b"[")
        self._first = True
        self.count = 0

    def add(self, value: Any) -> None:
        if not self._first:
            self._hash.update(b",")
        self._hash.update(canonical_json(value).encode("utf-8"))
        self._first = False
        self.count += 1

    def finish(self) -> str:
        copied = self._hash.copy()
        copied.update(b"]")
        return copied.hexdigest()


def audit_translation_packs(
    packs: Sequence[TranslationPack],
    models: AuditModels,
    adjudications: AdjudicationSet,
    progress: bool = False,
    *,
    checkpoint_details: bool = False,
    require_all_adjudications_consumed: bool = True,
    tracked_reference_catalog: Optional[
        TrackedAfrikaansReferenceCatalog
    ] = None,
) -> Mapping[str, Any]:
    reference_catalog = (
        tracked_reference_catalog
        if tracked_reference_catalog is not None
        else empty_tracked_afrikaans_reference_catalog()
    )
    policy_language = as_mapping(AUDIT_POLICY["language"], "language policy")
    policy_semantic = as_mapping(AUDIT_POLICY["semantic"], "semantic policy")
    pack_bindings: list[Mapping[str, Any]] = []
    failure_hasher = CanonicalArrayHasher()
    failure_samples: list[Mapping[str, Any]] = []
    complete_failure_records: list[Mapping[str, Any]] = []
    complete_field_evidence_rows: list[list[Any]] = []
    complete_derivation_evidence_rows: list[list[Any]] = []
    consumed_reviews: set[str] = set()
    counts: collections.Counter[str] = collections.Counter()
    for count_name in (
        "packs",
        "fields",
        "candidatePacks",
        "curatedPacks",
        "legalFields",
        "languageEvidenceFields",
        "backtranslatedFields",
        "unadjudicatedFields",
        "unadjudicatedFailures",
        "adjudicatedFields",
        "adjudicatedFailures",
    ):
        counts[count_name] = 0
    failure_code_counts: collections.Counter[str] = collections.Counter()
    adjudicated_code_counts: collections.Counter[str] = collections.Counter()

    for pack_number, pack in enumerate(packs, start=1):
        field_count = len(pack.entries)
        if not field_count:
            raise AuditContractError(f"Translation pack has no fields: {pack.locale}/{pack.source.namespace}")
        legal = is_legal_namespace(pack.source.namespace)
        semantic_indices = [
            index
            for index, entry in enumerate(pack.entries)
            if any(count_letters(segment) for segment in entry.source.text_segments)
        ]
        semantic_sources = [pack.entries[index].source.source for index in semantic_indices]
        semantic_values = [pack.entries[index].value for index in semantic_indices]
        semantic_scores_raw = models.semantic.similarities(semantic_sources, semantic_values)
        semantic_scores = validate_similarity_batch(
            semantic_values, semantic_scores_raw, "LaBSE"
        )
        semantic_by_index = dict(zip(semantic_indices, semantic_scores))

        lid_texts = [
            mask_field_text(entry.value, entry.source.literal_segments)
            for entry in pack.entries
        ]
        whole_predictions = validate_prediction_batch(
            lid_texts, models.language.predict_many(lid_texts)
        )
        chunk_requests: list[str] = []
        chunk_owners: list[int] = []
        for index, text in enumerate(lid_texts):
            for chunk in CLAUSE_RE.split(text):
                normalized = chunk.strip()
                if count_letters(normalized) >= int(policy_language["mixedChunkMinimumLetters"]):
                    chunk_requests.append(normalized)
                    chunk_owners.append(index)
        chunk_predictions = validate_prediction_batch(
            chunk_requests, models.language.predict_many(chunk_requests)
        )
        chunks_by_index: dict[int, list[Sequence[LanguagePrediction]]] = collections.defaultdict(list)
        for owner, predictions in zip(chunk_owners, chunk_predictions):
            chunks_by_index[owner].append(predictions)
        afrikaans_pack_context = build_afrikaans_pack_context_evidence(
            pack.locale,
            lid_texts,
            models.language,
        )

        duplicate_indices: set[int] = set()
        normalized_value_owners: dict[str, tuple[int, str]] = {}
        for index, entry in enumerate(pack.entries):
            normalized = " ".join(normalized_words(entry.value))
            if len(normalized) < 4:
                continue
            prior = normalized_value_owners.get(normalized)
            if prior is not None and prior[1] != entry.source.source_sha256:
                duplicate_indices.add(prior[0])
                duplicate_indices.add(index)
            else:
                normalized_value_owners[normalized] = (index, entry.source.source_sha256)

        failures_by_index: list[set[str]] = [set() for _ in pack.entries]
        evidence_by_index: list[dict[str, Any]] = [dict() for _ in pack.entries]
        derivation_by_index: list[dict[str, Any]] = [
            {
                "wholePredictions": [
                    [prediction.label, prediction.probability]
                    for prediction in whole_predictions[index]
                ],
                "semanticSimilarityRaw": semantic_by_index.get(index),
                "mixedChunkPredictions": [
                    [[prediction.label, prediction.probability] for prediction in predictions]
                    for predictions in chunks_by_index.get(index, [])
                ],
                "backtranslation": None,
                "backtranslationSimilarityRaw": None,
                "alignment": None,
            }
            for index in range(len(pack.entries))
        ]
        backtranslation_indices: list[int] = []
        expected_label = FASTTEXT_LABEL_BY_LOCALE.get(pack.locale)
        if expected_label is None:
            raise AuditContractError(f"Unsupported target-language evidence mapping: {pack.locale}")

        for index, entry in enumerate(pack.entries):
            failures = failures_by_index[index]
            source = entry.source.source
            value = entry.value
            masked_source = mask_field_text(source, entry.source.literal_segments)
            masked_value = lid_texts[index]
            source_placeholders = counter_values(PLACEHOLDER_RE, source)
            value_placeholders = counter_values(PLACEHOLDER_RE, value)
            if source_placeholders != value_placeholders:
                failures.add("placeholder-parity")
            source_without_placeholders = PLACEHOLDER_RE.sub(" ", source)
            value_without_placeholders = PLACEHOLDER_RE.sub(" ", value)
            if counter_values(NUMBER_RE, source_without_placeholders) != counter_values(
                NUMBER_RE, value_without_placeholders
            ):
                failures.add("number-parity")
            if literal_counter(entry.source.literal_segments, source) != literal_counter(
                entry.source.literal_segments, value
            ):
                failures.add("protected-literal-parity")
            source_normalized = " ".join(normalized_words(masked_source))
            value_normalized = " ".join(normalized_words(masked_value))
            if source_normalized and source_normalized == value_normalized:
                failures.add("source-equality")
            if has_source_ngram_copy(masked_source, masked_value):
                failures.add("source-span-copy")
            if has_untranslated_source_token_cluster(masked_source, masked_value):
                failures.add("untranslated-source-token-cluster")
            if has_internal_duplicate_collapse(masked_source, masked_value) or index in duplicate_indices:
                failures.add("duplicate-collapse")

            predictions = whole_predictions[index]
            probabilities = prediction_map(predictions)
            letters = count_letters(masked_value)
            lid_applicable = bool(source_normalized) and letters >= int(policy_language["minimumLetters"])
            target_probability: Optional[float] = None
            english_probability: Optional[float] = None
            if lid_applicable:
                target_probability = probabilities.get(expected_label, 0.0)
                english_probability = probabilities.get("en", 0.0)
                minimum_probability = (
                    float(policy_language["minimumShortTargetProbability"])
                    if letters < int(policy_language["shortTextLetters"])
                    else float(policy_language["minimumTargetProbability"])
                )
                if target_probability < minimum_probability:
                    failures.add("language-target-low-confidence")
                if english_probability > float(policy_language["maximumEnglishProbability"]):
                    failures.add("mixed-english")
                for chunk_evidence in chunks_by_index.get(index, []):
                    chunk_map = prediction_map(chunk_evidence)
                    if (
                        chunk_map.get("en", 0.0)
                        >= float(policy_language["mixedChunkEnglishProbability"])
                        and chunk_map.get(expected_label, 0.0)
                        < float(policy_language["minimumTargetProbability"])
                    ):
                        failures.add("mixed-english")
                        break
            elif source_normalized:
                failures.add("language-evidence-insufficient")

            semantic_score = semantic_by_index.get(index)
            if source_normalized and semantic_score is None:
                failures.add("model-evidence-missing")
            elif semantic_score is not None and semantic_score < semantic_threshold(source, legal):
                failures.add("semantic-adequacy-low")
            english_function_words = {
                word.casefold()
                for word in ASCII_WORD_RE.findall(masked_value)
                if word.casefold() in ENGLISH_FUNCTION_WORDS
            }
            if len(english_function_words) >= int(
                AUDIT_POLICY["sourceCopy"]["minimumDistinctEnglishFunctionWords"]
            ):
                failures.add("mixed-english")

            high_risk = bool(
                legal
                or HIGH_RISK_SOURCE_RE.search(source)
                or ENGLISH_NEGATION_RE.search(source)
                or source_placeholders
                or counter_values(NUMBER_RE, source_without_placeholders)
            )
            if source_normalized and (
                high_risk
                or semantic_score is None
                or semantic_score < float(policy_semantic["backtranslationTrigger"])
            ):
                backtranslation_indices.append(index)
            evidence_by_index[index] = {
                "targetLanguageProbability": rounded_score(target_probability),
                "englishProbability": rounded_score(english_probability),
                "semanticSimilarity": rounded_score(semantic_score),
                "lidApplicable": lid_applicable,
                "backtranslationRequired": index in backtranslation_indices,
                "afrikaansRescueKind": "none",
                "supportPairIdentity": None,
            }

        backtranslation_values = [pack.entries[index].value for index in backtranslation_indices]
        backtranslations = tuple(models.backtranslator.to_english(pack.locale, backtranslation_values))
        if len(backtranslations) != len(backtranslation_indices) or any(not value.strip() for value in backtranslations):
            raise AuditModelError("MADLAD returned partial or empty backtranslation evidence")
        back_sources = [pack.entries[index].source.source for index in backtranslation_indices]
        back_scores = validate_similarity_batch(
            backtranslations,
            models.semantic.similarities(back_sources, backtranslations),
            "LaBSE backtranslation",
        )
        alignment_sources: list[str] = []
        alignment_values: list[str] = []
        alignment_shapes: list[tuple[tuple[str, ...], tuple[str, ...], int]] = []
        for index, backtranslation in zip(backtranslation_indices, backtranslations):
            source_sentences = split_sentences(pack.entries[index].source.source)
            back_sentences = split_sentences(backtranslation)
            start = len(alignment_sources)
            for source_sentence in source_sentences:
                for back_sentence in back_sentences:
                    alignment_sources.append(source_sentence)
                    alignment_values.append(back_sentence)
            alignment_shapes.append((source_sentences, back_sentences, start))
        all_alignment_scores = validate_similarity_batch(
            alignment_values,
            models.semantic.similarities(alignment_sources, alignment_values),
            "LaBSE sentence alignment",
        )
        if not (
            len(backtranslation_indices)
            == len(backtranslations)
            == len(back_scores)
            == len(alignment_shapes)
        ):
            raise AuditModelError("Backtranslation evidence batches are not cardinality-aligned")
        alignment_cursor = 0
        for source_sentences, back_sentences, alignment_start in alignment_shapes:
            if alignment_start != alignment_cursor:
                raise AuditModelError("Sentence alignment batches overlap or have a gap")
            alignment_cursor += len(source_sentences) * len(back_sentences)
        if alignment_cursor != len(all_alignment_scores):
            raise AuditModelError("Sentence alignment batches did not bind every score")
        for index, backtranslation, back_score, alignment_shape in zip(
            backtranslation_indices, backtranslations, back_scores, alignment_shapes
        ):
            entry = pack.entries[index]
            source = entry.source.source
            failures = failures_by_index[index]
            minimum_back_score = (
                float(policy_semantic["legalBacktranslationMinimum"])
                if legal
                else float(policy_semantic["backtranslationMinimum"])
            )
            if back_score < minimum_back_score:
                failures.add("backtranslation-adequacy-low")
            if bool(ENGLISH_NEGATION_RE.search(source)) != bool(
                ENGLISH_NEGATION_RE.search(backtranslation)
            ):
                failures.add("negation-parity")
            source_word_count = max(1, len(normalized_words(mask_field_text(source, entry.source.literal_segments))))
            back_word_count = len(
                normalized_words(mask_field_text(backtranslation, entry.source.literal_segments))
            )
            length_ratio = back_word_count / source_word_count
            minimum_ratio = float(
                policy_semantic[
                    "legalMinimumBacktranslationLengthRatio"
                    if legal
                    else "minimumBacktranslationLengthRatio"
                ]
            )
            maximum_ratio = float(
                policy_semantic[
                    "legalMaximumBacktranslationLengthRatio"
                    if legal
                    else "maximumBacktranslationLengthRatio"
                ]
            )
            if length_ratio < minimum_ratio:
                failures.add("possible-omission")
            if length_ratio > maximum_ratio:
                failures.add("possible-addition")

            source_sentences, back_sentences, alignment_start = alignment_shape
            alignment_count = len(source_sentences) * len(back_sentences)
            alignment_scores = all_alignment_scores[
                alignment_start : alignment_start + alignment_count
            ]
            alignment_evidence = build_alignment_evidence(
                alignment_scores,
                len(source_sentences),
                len(back_sentences),
            )
            alignment_minimum = float(
                policy_semantic[
                    "legalSentenceAlignmentMinimum"
                    if legal
                    else "sentenceAlignmentMinimum"
                ]
            )
            minimum_source_alignment = alignment_evidence.minimum_source_alignment
            minimum_back_alignment = (
                alignment_evidence.minimum_backtranslation_alignment
            )
            if minimum_source_alignment < alignment_minimum:
                failures.add("possible-omission")
            if minimum_back_alignment < alignment_minimum:
                failures.add("possible-addition")
            evidence_by_index[index].update(
                {
                    "backtranslationSha256": sha256_text(backtranslation),
                    "backtranslationSimilarity": rounded_score(back_score),
                    "backtranslationLengthRatio": round(length_ratio, 6),
                    "minimumSourceSentenceAlignment": rounded_score(minimum_source_alignment),
                    "minimumBacktranslationSentenceAlignment": rounded_score(minimum_back_alignment),
                }
            )
            derivation_by_index[index]["backtranslation"] = backtranslation
            derivation_by_index[index]["backtranslationSimilarityRaw"] = back_score
            derivation_by_index[index]["alignment"] = {
                "sourceSentences": list(source_sentences),
                "backtranslationSentences": list(back_sentences),
                "scores": list(alignment_scores),
            }

        afrikaans_pack_gate_passed = bool(
            afrikaans_pack_context
            and afrikaans_pack_context["gatePassed"]
        )
        rescued_fields = 0
        field_pair_rescued_fields = 0
        tracked_curated_rescued_fields = 0
        reference_match_rows: list[list[str]] = []
        tracked_rescue_rows: list[list[str]] = []
        for index, failures in enumerate(failures_by_index):
            entry = pack.entries[index]
            identity = field_identity_sha256(pack, entry)
            support_pair_identity = tracked_support_pair_for_field(
                pack, entry, reference_catalog
            )
            evidence_by_index[index]["supportPairIdentity"] = (
                support_pair_identity
            )
            if support_pair_identity is not None:
                reference_match_rows.append([identity, support_pair_identity])
            if should_rescue_afrikaans_field(
                pack.locale,
                pack.origin,
                failures,
                whole_predictions[index],
                afrikaans_pack_gate_passed,
            ):
                failures.remove("language-target-low-confidence")
                evidence_by_index[index]["afrikaansRescueKind"] = "field-pair"
                rescued_fields += 1
                field_pair_rescued_fields += 1
            elif (
                pack.locale == "af"
                and pack.origin == "candidate"
                and afrikaans_pack_gate_passed
                and failures == {"language-target-low-confidence"}
                and support_pair_identity is not None
            ):
                failures.remove("language-target-low-confidence")
                evidence_by_index[index]["afrikaansRescueKind"] = (
                    "tracked-curated"
                )
                rescued_fields += 1
                tracked_curated_rescued_fields += 1
                tracked_rescue_rows.append([identity, support_pair_identity])
        if afrikaans_pack_context is not None:
            afrikaans_pack_context.update(
                {
                    "rescuedFields": rescued_fields,
                    "fieldPairRescuedFields": field_pair_rescued_fields,
                    "trackedCuratedRescuedFields": (
                        tracked_curated_rescued_fields
                    ),
                    "referenceMatchFields": len(reference_match_rows),
                    "referenceMatchRootSha256": sha256_canonical(
                        reference_match_rows
                    ),
                    "trackedCuratedRescueRootSha256": sha256_canonical(
                        tracked_rescue_rows
                    ),
                }
            )

        field_binding_hasher = CanonicalArrayHasher()
        field_evidence_hasher = CanonicalArrayHasher()
        pack_unadjudicated = 0
        pack_adjudicated = 0
        for index, entry in enumerate(pack.entries):
            identity = field_identity_sha256(pack, entry)
            failures = failures_by_index[index]
            remaining, accepted, had_review = apply_adjudication(
                identity, failures, legal, adjudications
            )
            if had_review:
                consumed_reviews.add(identity)
            if remaining:
                pack_unadjudicated += 1
                counts["unadjudicatedFields"] += 1
                counts["unadjudicatedFailures"] += len(remaining)
                failure_code_counts.update(remaining)
                failure_record = {
                    "identitySha256": identity,
                    "locale": pack.locale,
                    "namespace": pack.source.namespace,
                    "key": entry.source.key,
                    "sourceSha256": entry.source.source_sha256,
                    "valueSha256": sha256_text(entry.value),
                    "failureCodes": list(remaining),
                }
                failure_hasher.add(failure_record)
                if checkpoint_details:
                    complete_failure_records.append(failure_record)
                if len(failure_samples) < MAXIMUM_FAILURE_SAMPLES:
                    failure_samples.append(failure_record)
            if accepted:
                pack_adjudicated += 1
                counts["adjudicatedFields"] += 1
                counts["adjudicatedFailures"] += len(accepted)
                adjudicated_code_counts.update(accepted)
            counts["fields"] += 1
            if legal:
                counts["legalFields"] += 1
            if evidence_by_index[index].get("lidApplicable"):
                counts["languageEvidenceFields"] += 1
            if evidence_by_index[index].get("backtranslationRequired"):
                counts["backtranslatedFields"] += 1
            binding_row = [
                identity,
                entry.source.key,
                entry.source.source_sha256,
                sha256_text(entry.value),
            ]
            evidence_row = [
                identity,
                evidence_by_index[index],
                sorted(failures),
                list(accepted),
                list(remaining),
            ]
            field_binding_hasher.add(binding_row)
            field_evidence_hasher.add(evidence_row)
            if checkpoint_details:
                complete_field_evidence_rows.append(evidence_row)
                complete_derivation_evidence_rows.append(
                    [identity, derivation_by_index[index]]
                )
        pack_bindings.append(
            {
                "locale": pack.locale,
                "language": pack.language,
                "namespace": pack.source.namespace,
                "sourceHash": pack.source.source_hash,
                "sourceEntriesSha256": pack.source.source_entries_sha256,
                "origin": pack.origin,
                "packFileSha256": pack.file_sha256,
                "fields": field_count,
                "fieldIdentityRootSha256": field_binding_hasher.finish(),
                "fieldEvidenceRootSha256": field_evidence_hasher.finish(),
                "afrikaansPackContext": afrikaans_pack_context,
                "unadjudicatedFields": pack_unadjudicated,
                "adjudicatedFields": pack_adjudicated,
            }
        )
        counts["packs"] += 1
        counts[f"{pack.origin}Packs"] += 1
        if progress and (pack_number % 10 == 0 or pack_number == len(packs)):
            print(
                json.dumps(
                    {
                        "phase": "semantic-audit",
                        "completedPacks": pack_number,
                        "totalPacks": len(packs),
                        "completedFields": counts["fields"],
                        "unadjudicatedFields": counts["unadjudicatedFields"],
                    },
                    separators=(",", ":"),
                ),
                file=sys.stderr,
                flush=True,
            )

    unused_reviews = set(adjudications.reviews) - consumed_reviews
    if unused_reviews and require_all_adjudications_consumed:
        raise AuditContractError(
            f"Adjudications contain {len(unused_reviews)} stale or unknown field reviews"
        )
    pack_identity_root = sha256_canonical(
        [
            [
                pack["locale"],
                pack["namespace"],
                pack["sourceHash"],
                pack["origin"],
                pack["packFileSha256"],
                pack["fieldIdentityRootSha256"],
            ]
            for pack in pack_bindings
        ]
    )
    field_pair_rescued_fields = sum(
        int(pack["afrikaansPackContext"]["fieldPairRescuedFields"])
        for pack in pack_bindings
        if pack["afrikaansPackContext"] is not None
    )
    tracked_curated_rescued_fields = sum(
        int(pack["afrikaansPackContext"]["trackedCuratedRescuedFields"])
        for pack in pack_bindings
        if pack["afrikaansPackContext"] is not None
    )
    tracked_rescue_pack_rows = [
        [
            pack["locale"],
            pack["namespace"],
            pack["afrikaansPackContext"]["trackedCuratedRescuedFields"],
            pack["afrikaansPackContext"]["trackedCuratedRescueRootSha256"],
        ]
        for pack in pack_bindings
        if pack["afrikaansPackContext"] is not None
    ]
    tracked_global_evidence = {
        **tracked_afrikaans_reference_summary(reference_catalog),
        "fieldPairRescuedFields": field_pair_rescued_fields,
        "trackedCuratedRescuedFields": tracked_curated_rescued_fields,
        "trackedCuratedRescueRootSha256": sha256_canonical(
            tracked_rescue_pack_rows
        ),
    }
    pack_evidence_rows = [
            [
                pack["locale"],
                pack["namespace"],
                pack["fieldEvidenceRootSha256"],
                pack["unadjudicatedFields"],
                pack["adjudicatedFields"],
            ]
            for pack in pack_bindings
        ]
    pack_evidence_root = sha256_canonical(
        {
            "packBindings": pack_evidence_rows,
            "afrikaansTrackedCurated": tracked_global_evidence,
        }
    )
    result: dict[str, Any] = {
        "passed": counts["unadjudicatedFields"] == 0,
        "counts": dict(sorted(counts.items())),
        "packIdentityRootSha256": pack_identity_root,
        "packEvidenceRootSha256": pack_evidence_root,
        "packBindings": pack_bindings,
        "afrikaansTrackedCurated": tracked_global_evidence,
        "failureRecords": {
            "count": failure_hasher.count,
            "sha256": failure_hasher.finish(),
            "codeCounts": dict(sorted(failure_code_counts.items())),
            "adjudicatedCodeCounts": dict(sorted(adjudicated_code_counts.items())),
            "samples": failure_samples,
            "omittedSamples": max(0, failure_hasher.count - len(failure_samples)),
        },
    }
    if checkpoint_details:
        result["_checkpointDetails"] = {
            "completeFailureRecords": complete_failure_records,
            "fieldEvidenceRows": complete_field_evidence_rows,
            "derivationEvidenceRows": complete_derivation_evidence_rows,
            "consumedAdjudications": sorted(consumed_reviews),
        }
    return result


def pack_field_value_root(pack: TranslationPack) -> str:
    return sha256_canonical(
        [
            [entry.source.key, entry.source.source_sha256, sha256_text(entry.value)]
            for entry in pack.entries
        ]
    )


def create_checkpoint_session(
    inputs: AuditInputs,
    expectations: AuditExpectations,
    packs: Iterable[TranslationPack],
    pack_loader: Callable[[PackCheckpointPlan], TranslationPack],
    tracked_afrikaans_reference_packs: Sequence[TranslationPack],
    expected_fields: int,
    audit_policy_sha256: str,
    implementation_sha256: str,
    model_evidence: ModelEvidence,
    master_worklist_sha256: str,
    master_file_sha256: str,
    trees: Mapping[str, TreeSnapshot],
    adjudications: AdjudicationSet,
    execution_profile: Mapping[str, Any],
    generator_execution_profile: Mapping[str, Any],
) -> AuditCheckpointSession:
    if expectations.expected_packs > 99_999:
        raise AuditContractError("Checkpoint session pack scope is partial or too broad")
    if canonical_json(execution_profile) != canonical_json(EXECUTION_PROFILE):
        raise AuditContractError("Checkpoint session execution profile drifted")
    if canonical_json(generator_execution_profile) != canonical_json(
        GENERATOR_EXECUTION_PROFILE
    ):
        raise AuditContractError(
            "Checkpoint session generator execution profile drifted"
        )
    tracked_references = tuple(
        sorted(
            tracked_afrikaans_reference_packs,
            key=lambda pack: pack.source.namespace,
        )
    )
    if any(
        pack.locale != "af" or pack.origin != "curated"
        for pack in tracked_references
    ) or len({pack.source.namespace for pack in tracked_references}) != len(
        tracked_references
    ):
        raise AuditContractError(
            "Checkpoint tracked Afrikaans reference inputs are invalid"
        )
    tracked_reference_identity_rows = [
        _tracked_reference_pack_identity_row(pack)
        for pack in tracked_references
    ]
    pack_order: list[list[str]] = []
    pack_descriptors: list[dict[str, Any]] = []
    for ordinal, pack in enumerate(packs, start=1):
        field_value_root_sha256 = pack_field_value_root(pack)
        pack_order.append([pack.locale, pack.source.namespace])
        pack_descriptors.append(
            {
                "ordinal": ordinal,
                "locale": pack.locale,
                "language": pack.language,
                "namespace": pack.source.namespace,
                "sourceHash": pack.source.source_hash,
                "sourceEntriesSha256": pack.source.source_entries_sha256,
                "origin": pack.origin,
                "packFileSha256": pack.file_sha256,
                "fields": len(pack.entries),
                "fieldValueRootSha256": field_value_root_sha256,
            }
        )
    if (
        len(pack_descriptors) != expectations.expected_packs
        or len({tuple(identity) for identity in pack_order}) != len(pack_order)
    ):
        raise AuditContractError("Checkpoint session pack order is partial or duplicate")
    session_binding: dict[str, Any] = {
        "schemaVersion": 1,
        "kind": SESSION_KIND,
        "auditVersion": AUDIT_VERSION,
        "scope": {
            "name": expectations.scope,
            "locales": list(expectations.locales),
            "namespaces": expectations.expected_namespaces,
            "packs": expectations.expected_packs,
            "fields": expected_fields,
            "packOrderSha256": sha256_canonical(pack_order),
        },
        "policy": {
            "sha256": audit_policy_sha256,
            "implementationSha256": implementation_sha256,
        },
        "models": {
            "modelLockSha256": model_evidence.model_lock_sha256,
            "fasttextSha256": model_evidence.fasttext_sha256,
            "labseTreeSha256": model_evidence.labse_tree_sha256,
            "madladTreeSha256": model_evidence.madlad_tree_sha256,
            "runtimeVersions": dict(model_evidence.runtime_versions),
        },
        "inputs": {
            "paths": {
                "masterWorklist": relative_manifest_path(
                    inputs.master_worklist, inputs.root
                ),
                "curatedTree": relative_manifest_path(
                    inputs.curated_root, inputs.root
                ),
                "staticMainAppTree": relative_manifest_path(
                    inputs.static_main_app_root, inputs.root
                ),
                "candidateTree": relative_manifest_path(
                    inputs.candidate_root, inputs.root
                ),
                "packWorklistTree": relative_manifest_path(
                    inputs.pack_worklist_root, inputs.root
                ),
                "output": relative_manifest_path(inputs.output, inputs.root),
                "checkpointRoot": relative_manifest_path(
                    inputs.output.parent / f".{inputs.output.name}.checkpoints",
                    inputs.root,
                ),
            },
            "masterWorklistSha256": master_worklist_sha256,
            "masterWorklistFileSha256": master_file_sha256,
            "generatorExecutionProfile": generator_execution_profile,
            "generatorExecutionProfileSha256": (
                GENERATOR_EXECUTION_PROFILE_SHA256
            ),
            "curatedTree": trees["curated"].manifest_value(),
            "staticMainAppTree": trees["staticMainApp"].manifest_value(),
            "candidateTree": trees["candidates"].manifest_value(),
            "packWorklistTree": trees["packWorklists"].manifest_value(),
            "adjudicationSha256": adjudications.sha256,
            "trackedAfrikaansReferences": {
                "locale": "af",
                "packs": len(tracked_references),
                "packIdentityRootSha256": sha256_canonical(
                    tracked_reference_identity_rows
                ),
            },
        },
        "executionProfile": execution_profile,
        "executionProfileSha256": sha256_canonical(execution_profile),
    }
    session_binding_sha256 = sha256_canonical(session_binding)
    plans: list[PackCheckpointPlan] = []
    pack_input_rows: list[list[Any]] = []
    for descriptor in pack_descriptors:
        pack_input_material = {
            "sessionBindingSha256": session_binding_sha256,
            **descriptor,
        }
        pack_input_sha256 = sha256_canonical(pack_input_material)
        plans.append(
            PackCheckpointPlan(
                ordinal=int(descriptor["ordinal"]),
                pack_input_sha256=pack_input_sha256,
                locale=str(descriptor["locale"]),
                language=str(descriptor["language"]),
                namespace=str(descriptor["namespace"]),
                source_hash=str(descriptor["sourceHash"]),
                source_entries_sha256=str(descriptor["sourceEntriesSha256"]),
                origin=str(descriptor["origin"]),
                pack_file_sha256=str(descriptor["packFileSha256"]),
                fields=int(descriptor["fields"]),
                field_value_root_sha256=str(
                    descriptor["fieldValueRootSha256"]
                ),
            )
        )
        pack_input_rows.append(
            [
                descriptor["ordinal"],
                descriptor["locale"],
                descriptor["namespace"],
                pack_input_sha256,
            ]
        )
    material = {
        **session_binding,
        "packInputRootSha256": sha256_canonical(pack_input_rows),
    }
    session_sha256 = sha256_canonical(material)
    checkpoint_root = inputs.output.parent / f".{inputs.output.name}.checkpoints"
    return AuditCheckpointSession(
        sha256=session_sha256,
        material=material,
        root=checkpoint_root,
        plans=tuple(plans),
        pack_loader=pack_loader,
        tracked_afrikaans_reference_packs=tracked_references,
    )


def require_bounded_nonnegative_integer(value: Any, label: str, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= maximum:
        raise AuditContractError(f"{label} must be a bounded non-negative integer")
    return value


def require_checkpoint_count_map(value: Any, label: str) -> Mapping[str, int]:
    mapping = as_mapping(value, label)
    if len(mapping) > len(ALL_FAILURE_CODES):
        raise AuditContractError(f"{label} exceeds its resource bound")
    result: dict[str, int] = {}
    for code, count in mapping.items():
        if code not in ALL_FAILURE_CODES:
            raise AuditContractError(f"{label} contains an unknown failure code")
        parsed = require_bounded_nonnegative_integer(count, f"{label} count", 20_000)
        if parsed == 0:
            raise AuditContractError(f"{label} contains a zero count")
        result[code] = parsed
    return result


def checkpoint_temporary_basename(plan: PackCheckpointPlan) -> str:
    return f".{plan.ordinal:05d}-{plan.pack_input_sha256}.publishing"


def checkpoint_final_basename(
    plan: PackCheckpointPlan, checkpoint_sha256: str
) -> str:
    require_sha256(checkpoint_sha256, "checkpoint SHA-256")
    return (
        f"{plan.ordinal:05d}-{plan.pack_input_sha256}-{checkpoint_sha256}.json"
    )


def load_checkpoint_plan_pack(
    session: AuditCheckpointSession, plan: PackCheckpointPlan
) -> TranslationPack:
    pack = session.pack_loader(plan)
    if (
        pack.locale != plan.locale
        or pack.language != plan.language
        or pack.source.namespace != plan.namespace
        or pack.source.source_hash != plan.source_hash
        or pack.source.source_entries_sha256 != plan.source_entries_sha256
        or pack.origin != plan.origin
        or pack.file_sha256 != plan.pack_file_sha256
        or len(pack.entries) != plan.fields
        or pack_field_value_root(pack) != plan.field_value_root_sha256
    ):
        raise AuditContractError("Checkpoint pack loader drifted from the session plan")
    return pack


def build_pack_checkpoint(
    session: AuditCheckpointSession,
    plan: PackCheckpointPlan,
    models: AuditModels,
    adjudications: AdjudicationSet,
    previous_checkpoint_sha256: Optional[str],
    tracked_reference_catalog: Optional[
        TrackedAfrikaansReferenceCatalog
    ] = None,
) -> Mapping[str, Any]:
    if plan.ordinal == 1:
        if previous_checkpoint_sha256 is not None:
            raise AuditContractError("First checkpoint cannot have a chain predecessor")
    else:
        require_sha256(
            previous_checkpoint_sha256, "previous checkpoint SHA-256"
        )
    if tracked_reference_catalog is None:
        tracked_reference_catalog = derive_tracked_afrikaans_reference_catalog(
            session.tracked_afrikaans_reference_packs,
            session.sha256,
            detector=models.language,
        )
    pack = load_checkpoint_plan_pack(session, plan)
    result = dict(
        audit_translation_packs(
            (pack,),
            models,
            adjudications,
            checkpoint_details=True,
            require_all_adjudications_consumed=False,
            tracked_reference_catalog=tracked_reference_catalog,
        )
    )
    details = as_mapping(result.pop("_checkpointDetails", None), "checkpoint details")
    bindings = as_list(result.get("packBindings"), "checkpoint pack bindings")
    failure_records = as_mapping(
        result.get("failureRecords"), "checkpoint failure records"
    )
    if len(bindings) != 1:
        raise AuditContractError("Single-pack audit returned a partial pack binding")
    material: dict[str, Any] = {
        "schemaVersion": CHECKPOINT_SCHEMA_VERSION,
        "kind": CHECKPOINT_KIND,
        "sessionSha256": session.sha256,
        "ordinal": plan.ordinal,
        "totalPacks": len(session.plans),
        "packInputSha256": plan.pack_input_sha256,
        "previousCheckpointSha256": previous_checkpoint_sha256,
        "packBinding": bindings[0],
        "trackedAfrikaansReferences": tracked_reference_catalog.evidence,
        "counts": result.get("counts"),
        "fieldEvidenceRows": details.get("fieldEvidenceRows"),
        "derivationEvidenceRows": details.get("derivationEvidenceRows"),
        "failureRecords": {
            "records": details.get("completeFailureRecords"),
            "codeCounts": failure_records.get("codeCounts"),
            "adjudicatedCodeCounts": failure_records.get(
                "adjudicatedCodeCounts"
            ),
        },
        "consumedAdjudications": details.get("consumedAdjudications"),
    }
    checkpoint = {**material, "checkpointSha256": sha256_canonical(material)}
    return validate_pack_checkpoint(
        checkpoint,
        session,
        plan,
        adjudications,
        previous_checkpoint_sha256,
        tracked_reference_catalog,
    )


def require_checkpoint_score(
    value: Any,
    label: str,
    minimum: float,
    maximum: float,
    allow_none: bool = True,
    require_six_decimals: bool = True,
) -> Optional[float]:
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AuditContractError(f"{label} must be a bounded finite score")
    parsed = float(value)
    if (
        not math.isfinite(parsed)
        or parsed < minimum
        or parsed > maximum
        or (require_six_decimals and round(parsed, 6) != parsed)
    ):
        raise AuditContractError(f"{label} must be a bounded finite score")
    return parsed


def validate_checkpoint_field_evidence(value: Any) -> Mapping[str, Any]:
    evidence = as_mapping(value, "checkpoint field evidence")
    base_keys = {
        "targetLanguageProbability",
        "englishProbability",
        "semanticSimilarity",
        "lidApplicable",
        "backtranslationRequired",
        "afrikaansRescueKind",
        "supportPairIdentity",
    }
    backtranslation_keys = {
        "backtranslationSha256",
        "backtranslationSimilarity",
        "backtranslationLengthRatio",
        "minimumSourceSentenceAlignment",
        "minimumBacktranslationSentenceAlignment",
    }
    if (
        not isinstance(evidence.get("lidApplicable"), bool)
        or not isinstance(evidence.get("backtranslationRequired"), bool)
    ):
        raise AuditContractError("Checkpoint field evidence booleans are malformed")
    rescue_kind = evidence.get("afrikaansRescueKind")
    support_pair_identity = evidence.get("supportPairIdentity")
    if rescue_kind not in AFRIKAANS_RESCUE_KINDS or (
        support_pair_identity is not None
        and (
            not isinstance(support_pair_identity, str)
            or not SHA256_RE.fullmatch(support_pair_identity)
        )
    ) or (rescue_kind == "tracked-curated" and support_pair_identity is None):
        raise AuditContractError(
            "Checkpoint Afrikaans rescue evidence is malformed"
        )
    expected_keys = (
        base_keys | backtranslation_keys
        if evidence["backtranslationRequired"]
        else base_keys
    )
    require_exact_keys(evidence, expected_keys, "checkpoint field evidence")
    require_checkpoint_score(
        evidence.get("targetLanguageProbability"),
        "target language probability",
        0.0,
        1.0,
    )
    require_checkpoint_score(
        evidence.get("englishProbability"), "English probability", 0.0, 1.0
    )
    require_checkpoint_score(
        evidence.get("semanticSimilarity"), "semantic similarity", -1.0, 1.0
    )
    if evidence["lidApplicable"]:
        if (
            evidence.get("targetLanguageProbability") is None
            or evidence.get("englishProbability") is None
        ):
            raise AuditContractError("Applicable language evidence is missing scores")
    elif (
        evidence.get("targetLanguageProbability") is not None
        or evidence.get("englishProbability") is not None
    ):
        raise AuditContractError("Inapplicable language evidence contains scores")
    if evidence["backtranslationRequired"]:
        require_sha256(
            evidence.get("backtranslationSha256"), "backtranslationSha256"
        )
        require_checkpoint_score(
            evidence.get("backtranslationSimilarity"),
            "backtranslation similarity",
            -1.0,
            1.0,
            allow_none=False,
        )
        require_checkpoint_score(
            evidence.get("minimumSourceSentenceAlignment"),
            "source sentence alignment",
            -1.0,
            1.0,
            allow_none=False,
        )
        require_checkpoint_score(
            evidence.get("minimumBacktranslationSentenceAlignment"),
            "backtranslation sentence alignment",
            -1.0,
            1.0,
            allow_none=False,
        )
        ratio = evidence.get("backtranslationLengthRatio")
        if (
            isinstance(ratio, bool)
            or not isinstance(ratio, (int, float))
            or not math.isfinite(float(ratio))
            or not 0.0 <= float(ratio) <= 200_000.0
            or round(float(ratio), 6) != float(ratio)
        ):
            raise AuditContractError("Backtranslation length ratio is malformed")
    return evidence


def validate_checkpoint_derivation_evidence(
    value: Any, backtranslation_required: bool
) -> Mapping[str, Any]:
    evidence = as_mapping(value, "checkpoint derivation evidence")
    require_exact_keys(
        evidence,
        {
            "wholePredictions",
            "semanticSimilarityRaw",
            "mixedChunkPredictions",
            "backtranslation",
            "backtranslationSimilarityRaw",
            "alignment",
        },
        "checkpoint derivation evidence",
    )
    prediction_sets = [
        as_list(evidence.get("wholePredictions"), "whole-field predictions"),
        *[
            as_list(predictions, "mixed chunk prediction set")
            for predictions in as_list(
                evidence.get("mixedChunkPredictions"), "mixed chunk predictions"
            )
        ],
    ]
    raw_chunks = as_list(
        evidence.get("mixedChunkPredictions"), "mixed chunk predictions"
    )
    if len(raw_chunks) > 20_000:
        raise AuditContractError("Mixed chunk evidence exceeds its resource bound")
    for predictions in prediction_sets:
        if len(predictions) > 5:
            raise AuditContractError("Mixed chunk prediction set is too broad")
        labels: set[str] = set()
        for raw_prediction in predictions:
            prediction = as_list(raw_prediction, "mixed chunk prediction")
            if len(prediction) != 2:
                raise AuditContractError("Mixed chunk prediction shape is invalid")
            label = as_string(prediction[0], "mixed chunk language label", 32)
            if not label or label in labels:
                raise AuditContractError("Mixed chunk language labels are duplicate")
            labels.add(label)
            require_checkpoint_score(
                prediction[1],
                "mixed chunk language probability",
                0.0,
                1.0,
                allow_none=False,
                require_six_decimals=False,
            )
    require_checkpoint_score(
        evidence.get("semanticSimilarityRaw"),
        "raw semantic similarity",
        -1.0,
        1.0,
        require_six_decimals=False,
    )
    backtranslation = evidence.get("backtranslation")
    if backtranslation_required:
        if not as_string(backtranslation, "checkpoint backtranslation").strip():
            raise AuditContractError("Checkpoint backtranslation is empty")
        require_checkpoint_score(
            evidence.get("backtranslationSimilarityRaw"),
            "raw backtranslation similarity",
            -1.0,
            1.0,
            allow_none=False,
            require_six_decimals=False,
        )
        alignment = as_mapping(evidence.get("alignment"), "checkpoint alignment")
        require_exact_keys(
            alignment,
            {"sourceSentences", "backtranslationSentences", "scores"},
            "checkpoint alignment",
        )
        source_sentences = tuple(
            as_string(sentence, "checkpoint source sentence")
            for sentence in as_list(
                alignment.get("sourceSentences"), "checkpoint source sentences"
            )
        )
        back_sentences = tuple(
            as_string(sentence, "checkpoint backtranslation sentence")
            for sentence in as_list(
                alignment.get("backtranslationSentences"),
                "checkpoint backtranslation sentences",
            )
        )
        if (
            not source_sentences
            or not back_sentences
            or len(source_sentences) > 20_000
            or len(back_sentences) > 20_000
        ):
            raise AuditContractError("Checkpoint alignment shape is invalid")
        raw_scores = as_list(alignment.get("scores"), "checkpoint alignment scores")
        if (
            len(raw_scores) != len(source_sentences) * len(back_sentences)
            or len(raw_scores) > 400_000
        ):
            raise AuditContractError("Checkpoint alignment score cardinality is invalid")
        for score in raw_scores:
            require_checkpoint_score(
                score,
                "checkpoint alignment score",
                -1.0,
                1.0,
                allow_none=False,
                require_six_decimals=False,
            )
    elif (
        backtranslation is not None
        or evidence.get("backtranslationSimilarityRaw") is not None
        or evidence.get("alignment") is not None
    ):
        raise AuditContractError("Checkpoint has unexpected backtranslation evidence")
    return evidence


def validate_checkpoint_afrikaans_pack_context(
    pack: TranslationPack,
    value: Any,
) -> tuple[bool, int]:
    policy = as_mapping(
        as_mapping(AUDIT_POLICY["language"], "language policy")[
            "afrikaansPackContext"
        ],
        "Afrikaans pack-context policy",
    )
    if pack.locale != policy["locale"]:
        if value is not None:
            raise AuditContractError(
                "Non-Afrikaans checkpoint has pack-context calibration evidence"
            )
        return False, 0
    evidence = as_mapping(value, "checkpoint Afrikaans pack context")
    require_exact_keys(
        evidence,
        {
            "contextSha256",
            "distinctMaskedValues",
            "maskedLetters",
            "eligible",
            "predictions",
            "gatePassed",
            "rescuedFields",
            "fieldPairRescuedFields",
            "trackedCuratedRescuedFields",
            "referenceMatchFields",
            "referenceMatchRootSha256",
            "trackedCuratedRescueRootSha256",
        },
        "checkpoint Afrikaans pack context",
    )
    context = canonical_afrikaans_pack_context(
        tuple(
            mask_field_text(entry.value, entry.source.literal_segments)
            for entry in pack.entries
        )
    )
    distinct_values = require_bounded_nonnegative_integer(
        evidence.get("distinctMaskedValues"),
        "checkpoint Afrikaans distinct masked values",
        len(pack.entries),
    )
    masked_letters = require_bounded_nonnegative_integer(
        evidence.get("maskedLetters"),
        "checkpoint Afrikaans masked letters",
        200_000 * len(pack.entries),
    )
    if not isinstance(evidence.get("eligible"), bool) or not isinstance(
        evidence.get("gatePassed"), bool
    ):
        raise AuditContractError(
            "Checkpoint Afrikaans pack-context booleans are malformed"
        )
    raw_predictions = as_list(
        evidence.get("predictions"),
        "checkpoint Afrikaans pack-context predictions",
    )
    if len(raw_predictions) > 5:
        raise AuditContractError(
            "Checkpoint Afrikaans pack-context predictions are too broad"
        )
    predictions: list[LanguagePrediction] = []
    for raw_prediction in raw_predictions:
        prediction = as_list(
            raw_prediction,
            "checkpoint Afrikaans pack-context prediction",
        )
        if len(prediction) != 2:
            raise AuditContractError(
                "Checkpoint Afrikaans pack-context prediction shape is invalid"
            )
        predictions.append(
            LanguagePrediction(
                as_string(
                    prediction[0],
                    "checkpoint Afrikaans pack-context label",
                    32,
                ),
                float(
                    require_checkpoint_score(
                        prediction[1],
                        "checkpoint Afrikaans pack-context probability",
                        0.0,
                        1.0,
                        allow_none=False,
                        require_six_decimals=False,
                    )
                ),
            )
        )
    prediction_map(predictions)
    eligible = afrikaans_pack_context_eligible(context)
    if (
        evidence.get("contextSha256") != context.sha256
        or distinct_values != context.distinct_masked_values
        or masked_letters != context.masked_letters
        or evidence.get("eligible") is not eligible
        or (eligible and len(predictions) != 5)
        or (not eligible and predictions)
    ):
        raise AuditContractError(
            "Checkpoint Afrikaans pack context drifted from masked values"
        )
    gate_passed = eligible and afrikaans_pack_context_gate(
        context, predictions
    )
    if evidence.get("gatePassed") is not gate_passed:
        raise AuditContractError(
            "Checkpoint Afrikaans pack gate drifted from raw predictions"
        )
    rescued_fields = require_bounded_nonnegative_integer(
        evidence.get("rescuedFields"),
        "checkpoint Afrikaans rescued fields",
        len(pack.entries),
    )
    field_pair_rescued_fields = require_bounded_nonnegative_integer(
        evidence.get("fieldPairRescuedFields"),
        "checkpoint Afrikaans field-pair rescued fields",
        len(pack.entries),
    )
    tracked_curated_rescued_fields = require_bounded_nonnegative_integer(
        evidence.get("trackedCuratedRescuedFields"),
        "checkpoint Afrikaans tracked-curated rescued fields",
        len(pack.entries),
    )
    reference_match_fields = require_bounded_nonnegative_integer(
        evidence.get("referenceMatchFields"),
        "checkpoint Afrikaans reference-match fields",
        len(pack.entries),
    )
    require_sha256(
        evidence.get("referenceMatchRootSha256"),
        "checkpoint Afrikaans reference-match root",
    )
    require_sha256(
        evidence.get("trackedCuratedRescueRootSha256"),
        "checkpoint Afrikaans tracked-curated rescue root",
    )
    if (
        rescued_fields
        != field_pair_rescued_fields + tracked_curated_rescued_fields
        or tracked_curated_rescued_fields > reference_match_fields
        or (not gate_passed and rescued_fields != 0)
    ):
        raise AuditContractError(
            "Checkpoint Afrikaans rescue counts are inconsistent"
        )
    return gate_passed, rescued_fields


def duplicate_field_indices(pack: TranslationPack) -> set[int]:
    duplicate_indices: set[int] = set()
    normalized_value_owners: dict[str, tuple[int, str]] = {}
    for index, entry in enumerate(pack.entries):
        normalized = " ".join(normalized_words(entry.value))
        if len(normalized) < 4:
            continue
        prior = normalized_value_owners.get(normalized)
        if prior is not None and prior[1] != entry.source.source_sha256:
            duplicate_indices.add(prior[0])
            duplicate_indices.add(index)
        else:
            normalized_value_owners[normalized] = (
                index,
                entry.source.source_sha256,
            )
    return duplicate_indices


def derive_checkpoint_failure_codes(
    pack: TranslationPack,
    index: int,
    field_evidence: Mapping[str, Any],
    derivation_evidence: Mapping[str, Any],
    duplicate_indices: set[int],
    afrikaans_pack_gate_passed: bool,
    tracked_reference_catalog: TrackedAfrikaansReferenceCatalog,
) -> tuple[str, ...]:
    entry = pack.entries[index]
    source = entry.source.source
    value = entry.value
    legal = is_legal_namespace(pack.source.namespace)
    policy_language = as_mapping(AUDIT_POLICY["language"], "language policy")
    policy_semantic = as_mapping(AUDIT_POLICY["semantic"], "semantic policy")
    failures: set[str] = set()
    whole_prediction_values: tuple[LanguagePrediction, ...] = ()
    masked_source = mask_field_text(source, entry.source.literal_segments)
    masked_value = mask_field_text(value, entry.source.literal_segments)
    source_placeholders = counter_values(PLACEHOLDER_RE, source)
    if source_placeholders != counter_values(PLACEHOLDER_RE, value):
        failures.add("placeholder-parity")
    source_without_placeholders = PLACEHOLDER_RE.sub(" ", source)
    value_without_placeholders = PLACEHOLDER_RE.sub(" ", value)
    if counter_values(NUMBER_RE, source_without_placeholders) != counter_values(
        NUMBER_RE, value_without_placeholders
    ):
        failures.add("number-parity")
    if literal_counter(entry.source.literal_segments, source) != literal_counter(
        entry.source.literal_segments, value
    ):
        failures.add("protected-literal-parity")
    source_normalized = " ".join(normalized_words(masked_source))
    value_normalized = " ".join(normalized_words(masked_value))
    if source_normalized and source_normalized == value_normalized:
        failures.add("source-equality")
    if has_source_ngram_copy(masked_source, masked_value):
        failures.add("source-span-copy")
    if has_untranslated_source_token_cluster(masked_source, masked_value):
        failures.add("untranslated-source-token-cluster")
    if has_internal_duplicate_collapse(masked_source, masked_value) or index in duplicate_indices:
        failures.add("duplicate-collapse")

    letters = count_letters(masked_value)
    lid_applicable = bool(source_normalized) and letters >= int(
        policy_language["minimumLetters"]
    )
    if field_evidence.get("lidApplicable") is not lid_applicable:
        raise AuditContractError("Checkpoint language-applicability evidence drifted")
    expected_label = FASTTEXT_LABEL_BY_LOCALE.get(pack.locale)
    if expected_label is None:
        raise AuditContractError("Checkpoint pack has no target-language mapping")
    if lid_applicable:
        whole_prediction_values = parse_exact_checkpoint_predictions(
            derivation_evidence.get("wholePredictions"),
            "whole-field predictions",
            5,
        )
        whole_predictions = prediction_map(whole_prediction_values)
        target_probability = whole_predictions.get(expected_label, 0.0)
        english_probability = whole_predictions.get("en", 0.0)
        if (
            field_evidence.get("targetLanguageProbability")
            != rounded_score(target_probability)
            or field_evidence.get("englishProbability")
            != rounded_score(english_probability)
        ):
            raise AuditContractError("Checkpoint whole-language evidence drifted")
        minimum_probability = (
            float(policy_language["minimumShortTargetProbability"])
            if letters < int(policy_language["shortTextLetters"])
            else float(policy_language["minimumTargetProbability"])
        )
        if target_probability < minimum_probability:
            failures.add("language-target-low-confidence")
        if english_probability > float(policy_language["maximumEnglishProbability"]):
            failures.add("mixed-english")
        raw_chunk_predictions = as_list(
            derivation_evidence.get("mixedChunkPredictions"),
            "mixed chunk predictions",
        )
        expected_chunk_count = sum(
            1
            for chunk in CLAUSE_RE.split(masked_value)
            if count_letters(chunk.strip())
            >= int(policy_language["mixedChunkMinimumLetters"])
        )
        if len(raw_chunk_predictions) != expected_chunk_count:
            raise AuditContractError("Checkpoint mixed-chunk evidence is partial")
        for raw_predictions in raw_chunk_predictions:
            probabilities = prediction_map(
                parse_exact_checkpoint_predictions(
                    raw_predictions,
                    "mixed chunk predictions",
                    5,
                )
            )
            if (
                probabilities.get("en", 0.0)
                >= float(policy_language["mixedChunkEnglishProbability"])
                and probabilities.get(expected_label, 0.0)
                < float(policy_language["minimumTargetProbability"])
            ):
                failures.add("mixed-english")
                break
    else:
        parse_exact_checkpoint_predictions(
            derivation_evidence.get("wholePredictions"),
            "whole-field predictions",
            5 if masked_value.strip() else 0,
        )
        if as_list(
            derivation_evidence.get("mixedChunkPredictions"),
            "mixed chunk predictions",
        ):
            raise AuditContractError(
                "Inapplicable checkpoint has mixed-chunk predictions"
            )
        if source_normalized:
            failures.add("language-evidence-insufficient")

    semantic_score = derivation_evidence.get("semanticSimilarityRaw")
    if field_evidence.get("semanticSimilarity") != rounded_score(
        None if semantic_score is None else float(semantic_score)
    ):
        raise AuditContractError("Checkpoint semantic score rounding drifted")
    semantic_applicable = any(
        count_letters(segment) for segment in entry.source.text_segments
    )
    if semantic_applicable != (semantic_score is not None):
        if source_normalized and semantic_score is None:
            failures.add("model-evidence-missing")
        else:
            raise AuditContractError("Checkpoint semantic applicability drifted")
    elif semantic_score is not None and float(semantic_score) < semantic_threshold(
        source, legal
    ):
        failures.add("semantic-adequacy-low")
    english_function_words = {
        word.casefold()
        for word in ASCII_WORD_RE.findall(masked_value)
        if word.casefold() in ENGLISH_FUNCTION_WORDS
    }
    if len(english_function_words) >= int(
        AUDIT_POLICY["sourceCopy"]["minimumDistinctEnglishFunctionWords"]
    ):
        failures.add("mixed-english")

    high_risk = bool(
        legal
        or HIGH_RISK_SOURCE_RE.search(source)
        or ENGLISH_NEGATION_RE.search(source)
        or source_placeholders
        or counter_values(NUMBER_RE, source_without_placeholders)
    )
    backtranslation_required = bool(
        source_normalized
        and (
            high_risk
            or semantic_score is None
            or float(semantic_score) < float(policy_semantic["backtranslationTrigger"])
        )
    )
    if field_evidence.get("backtranslationRequired") is not backtranslation_required:
        raise AuditContractError("Checkpoint backtranslation requirement drifted")
    if backtranslation_required:
        backtranslation = as_string(
            derivation_evidence.get("backtranslation"), "checkpoint backtranslation"
        )
        if sha256_text(backtranslation) != field_evidence.get("backtranslationSha256"):
            raise AuditContractError("Checkpoint backtranslation hash drifted")
        back_score = float(derivation_evidence["backtranslationSimilarityRaw"])
        if field_evidence.get("backtranslationSimilarity") != rounded_score(back_score):
            raise AuditContractError("Checkpoint backtranslation score rounding drifted")
        minimum_back_score = float(
            policy_semantic[
                "legalBacktranslationMinimum"
                if legal
                else "backtranslationMinimum"
            ]
        )
        if back_score < minimum_back_score:
            failures.add("backtranslation-adequacy-low")
        if bool(ENGLISH_NEGATION_RE.search(source)) != bool(
            ENGLISH_NEGATION_RE.search(backtranslation)
        ):
            failures.add("negation-parity")
        source_word_count = max(
            1,
            len(
                normalized_words(
                    mask_field_text(source, entry.source.literal_segments)
                )
            ),
        )
        back_word_count = len(
            normalized_words(
                mask_field_text(backtranslation, entry.source.literal_segments)
            )
        )
        raw_length_ratio = back_word_count / source_word_count
        if field_evidence.get("backtranslationLengthRatio") != round(
            raw_length_ratio, 6
        ):
            raise AuditContractError("Checkpoint backtranslation length ratio drifted")
        minimum_ratio = float(
            policy_semantic[
                "legalMinimumBacktranslationLengthRatio"
                if legal
                else "minimumBacktranslationLengthRatio"
            ]
        )
        maximum_ratio = float(
            policy_semantic[
                "legalMaximumBacktranslationLengthRatio"
                if legal
                else "maximumBacktranslationLengthRatio"
            ]
        )
        if raw_length_ratio < minimum_ratio:
            failures.add("possible-omission")
        if raw_length_ratio > maximum_ratio:
            failures.add("possible-addition")
        alignment = as_mapping(
            derivation_evidence.get("alignment"), "checkpoint alignment"
        )
        source_sentences = tuple(
            as_string(sentence, "checkpoint source sentence")
            for sentence in as_list(
                alignment.get("sourceSentences"), "checkpoint source sentences"
            )
        )
        back_sentences = tuple(
            as_string(sentence, "checkpoint backtranslation sentence")
            for sentence in as_list(
                alignment.get("backtranslationSentences"),
                "checkpoint backtranslation sentences",
            )
        )
        if source_sentences != split_sentences(source) or back_sentences != split_sentences(
            backtranslation
        ):
            raise AuditContractError("Checkpoint sentence alignment inputs drifted")
        alignment_scores = tuple(
            float(score)
            for score in as_list(
                alignment.get("scores"), "checkpoint alignment scores"
            )
        )
        alignment_evidence = build_alignment_evidence(
            alignment_scores, len(source_sentences), len(back_sentences)
        )
        minimum_source_alignment = rounded_score(
            alignment_evidence.minimum_source_alignment
        )
        minimum_back_alignment = rounded_score(
            alignment_evidence.minimum_backtranslation_alignment
        )
        if (
            field_evidence.get("minimumSourceSentenceAlignment")
            != minimum_source_alignment
            or field_evidence.get("minimumBacktranslationSentenceAlignment")
            != minimum_back_alignment
        ):
            raise AuditContractError("Checkpoint sentence alignment minima drifted")
        alignment_minimum = float(
            policy_semantic[
                "legalSentenceAlignmentMinimum"
                if legal
                else "sentenceAlignmentMinimum"
            ]
        )
        if alignment_evidence.minimum_source_alignment < alignment_minimum:
            failures.add("possible-omission")
        if alignment_evidence.minimum_backtranslation_alignment < alignment_minimum:
            failures.add("possible-addition")
    support_pair_identity = tracked_support_pair_for_field(
        pack, entry, tracked_reference_catalog
    )
    if field_evidence.get("supportPairIdentity") != support_pair_identity:
        raise AuditContractError(
            "Checkpoint tracked support-pair identity drifted"
        )
    rescue_kind = "none"
    if should_rescue_afrikaans_field(
        pack.locale,
        pack.origin,
        failures,
        whole_prediction_values,
        afrikaans_pack_gate_passed,
    ):
        rescue_kind = "field-pair"
    elif (
        pack.locale == "af"
        and pack.origin == "candidate"
        and afrikaans_pack_gate_passed
        and failures == {"language-target-low-confidence"}
        and support_pair_identity is not None
    ):
        rescue_kind = "tracked-curated"
    if field_evidence.get("afrikaansRescueKind") != rescue_kind:
        raise AuditContractError(
            "Checkpoint Afrikaans field-rescue evidence drifted"
        )
    if rescue_kind != "none":
        failures.remove("language-target-low-confidence")
    return tuple(sorted(failures))


def validate_pack_checkpoint(
    value: Any,
    session: AuditCheckpointSession,
    plan: PackCheckpointPlan,
    adjudications: AdjudicationSet,
    previous_checkpoint_sha256: Optional[str] = None,
    expected_tracked_reference_catalog: Optional[
        TrackedAfrikaansReferenceCatalog
    ] = None,
) -> Mapping[str, Any]:
    checkpoint = as_mapping(value, "pack checkpoint")
    require_exact_keys(
        checkpoint,
        {
            "schemaVersion",
            "kind",
            "sessionSha256",
            "ordinal",
            "totalPacks",
            "packInputSha256",
            "previousCheckpointSha256",
            "packBinding",
            "trackedAfrikaansReferences",
            "counts",
            "fieldEvidenceRows",
            "derivationEvidenceRows",
            "failureRecords",
            "consumedAdjudications",
            "checkpointSha256",
        },
        "pack checkpoint",
    )
    checkpoint_sha256 = require_sha256(
        checkpoint.get("checkpointSha256"), "checkpointSha256"
    )
    material = dict(checkpoint)
    del material["checkpointSha256"]
    if sha256_canonical(material) != checkpoint_sha256:
        raise AuditContractError("Pack checkpoint self-hash is stale or tampered")
    if (
        checkpoint.get("schemaVersion") != CHECKPOINT_SCHEMA_VERSION
        or checkpoint.get("kind") != CHECKPOINT_KIND
        or checkpoint.get("sessionSha256") != session.sha256
        or checkpoint.get("ordinal") != plan.ordinal
        or checkpoint.get("totalPacks") != len(session.plans)
        or checkpoint.get("packInputSha256") != plan.pack_input_sha256
        or checkpoint.get("previousCheckpointSha256")
        != previous_checkpoint_sha256
    ):
        raise AuditContractError("Pack checkpoint belongs to a mixed or stale session")

    tracked_reference_catalog = derive_tracked_afrikaans_reference_catalog(
        session.tracked_afrikaans_reference_packs,
        session.sha256,
        evidence_value=checkpoint.get("trackedAfrikaansReferences"),
    )
    if (
        expected_tracked_reference_catalog is not None
        and canonical_json(expected_tracked_reference_catalog.evidence)
        != canonical_json(tracked_reference_catalog.evidence)
    ):
        raise AuditContractError(
            "Pack checkpoint tracked reference catalog drifted"
        )

    pack = load_checkpoint_plan_pack(session, plan)
    binding = as_mapping(checkpoint.get("packBinding"), "checkpoint pack binding")
    require_exact_keys(
        binding,
        {
            "locale",
            "language",
            "namespace",
            "sourceHash",
            "sourceEntriesSha256",
            "origin",
            "packFileSha256",
            "fields",
            "fieldIdentityRootSha256",
            "fieldEvidenceRootSha256",
            "afrikaansPackContext",
            "unadjudicatedFields",
            "adjudicatedFields",
        },
        "checkpoint pack binding",
    )
    expected_field_identity_root = sha256_canonical(
        [
            [
                field_identity_sha256(pack, entry),
                entry.source.key,
                entry.source.source_sha256,
                sha256_text(entry.value),
            ]
            for entry in pack.entries
        ]
    )
    if (
        binding.get("locale") != pack.locale
        or binding.get("language") != pack.language
        or binding.get("namespace") != pack.source.namespace
        or binding.get("sourceHash") != pack.source.source_hash
        or binding.get("sourceEntriesSha256")
        != pack.source.source_entries_sha256
        or binding.get("origin") != pack.origin
        or binding.get("packFileSha256") != pack.file_sha256
        or binding.get("fields") != len(pack.entries)
        or binding.get("fieldIdentityRootSha256")
        != expected_field_identity_root
    ):
        raise AuditContractError("Pack checkpoint input binding drifted")
    require_sha256(
        binding.get("fieldEvidenceRootSha256"), "fieldEvidenceRootSha256"
    )
    afrikaans_pack_gate_passed, expected_rescued_fields = (
        validate_checkpoint_afrikaans_pack_context(
            pack,
            binding.get("afrikaansPackContext"),
        )
    )

    require_bounded_nonnegative_integer(
        checkpoint.get("schemaVersion"), "checkpoint schemaVersion", 1
    )
    require_bounded_nonnegative_integer(
        checkpoint.get("ordinal"), "checkpoint ordinal", len(session.plans)
    )
    require_bounded_nonnegative_integer(
        checkpoint.get("totalPacks"), "checkpoint totalPacks", len(session.plans)
    )
    binding_fields = require_bounded_nonnegative_integer(
        binding.get("fields"), "checkpoint binding fields", 20_000
    )
    binding_unadjudicated = require_bounded_nonnegative_integer(
        binding.get("unadjudicatedFields"),
        "checkpoint binding unadjudicatedFields",
        binding_fields,
    )
    binding_adjudicated = require_bounded_nonnegative_integer(
        binding.get("adjudicatedFields"),
        "checkpoint binding adjudicatedFields",
        binding_fields,
    )
    evidence_rows = as_list(
        checkpoint.get("fieldEvidenceRows"), "checkpoint field evidence rows"
    )
    derivation_rows = as_list(
        checkpoint.get("derivationEvidenceRows"),
        "checkpoint derivation evidence rows",
    )
    if (
        len(evidence_rows) != len(pack.entries)
        or len(derivation_rows) != len(pack.entries)
    ):
        raise AuditContractError("Checkpoint field evidence is partial")
    expected_failure_records: list[Mapping[str, Any]] = []
    expected_consumed: list[str] = []
    recalculated_codes: collections.Counter[str] = collections.Counter()
    accepted_codes: collections.Counter[str] = collections.Counter()
    recalculated_counts: collections.Counter[str] = collections.Counter(
        {
            "packs": 1,
            "fields": len(pack.entries),
            "candidatePacks": 1 if pack.origin == "candidate" else 0,
            "curatedPacks": 1 if pack.origin == "curated" else 0,
            "legalFields": (
                len(pack.entries)
                if is_legal_namespace(pack.source.namespace)
                else 0
            ),
            "languageEvidenceFields": 0,
            "backtranslatedFields": 0,
            "unadjudicatedFields": 0,
            "unadjudicatedFailures": 0,
            "adjudicatedFields": 0,
            "adjudicatedFailures": 0,
        }
    )
    canonical_evidence_rows: list[list[Any]] = []
    duplicate_indices = duplicate_field_indices(pack)
    recalculated_rescued_fields = 0
    recalculated_field_pair_rescued_fields = 0
    recalculated_tracked_curated_rescued_fields = 0
    recalculated_reference_match_rows: list[list[str]] = []
    recalculated_tracked_rescue_rows: list[list[str]] = []
    for index, raw_row in enumerate(evidence_rows):
        row = as_list(raw_row, "checkpoint field evidence row")
        if len(row) != 5:
            raise AuditContractError("Checkpoint field evidence row shape is invalid")
        entry = pack.entries[index]
        identity = field_identity_sha256(pack, entry)
        if row[0] != identity:
            raise AuditContractError("Checkpoint field evidence order/identity drifted")
        evidence = validate_checkpoint_field_evidence(row[1])
        derivation_row = as_list(
            derivation_rows[index], "checkpoint derivation evidence row"
        )
        if len(derivation_row) != 2 or derivation_row[0] != identity:
            raise AuditContractError(
                "Checkpoint derivation evidence order/identity drifted"
            )
        derivation_evidence = validate_checkpoint_derivation_evidence(
            derivation_row[1], bool(evidence["backtranslationRequired"])
        )
        raw_failures = tuple(
            as_string(code, "checkpoint raw failure code", 128)
            for code in as_list(row[2], "checkpoint raw failures")
        )
        raw_accepted = tuple(
            as_string(code, "checkpoint accepted failure code", 128)
            for code in as_list(row[3], "checkpoint accepted failures")
        )
        raw_remaining = tuple(
            as_string(code, "checkpoint remaining failure code", 128)
            for code in as_list(row[4], "checkpoint remaining failures")
        )
        if (
            tuple(sorted(set(raw_failures))) != raw_failures
            or any(code not in ALL_FAILURE_CODES for code in raw_failures)
        ):
            raise AuditContractError("Checkpoint raw failures are noncanonical")
        if raw_failures != derive_checkpoint_failure_codes(
            pack,
            index,
            evidence,
            derivation_evidence,
            duplicate_indices,
            afrikaans_pack_gate_passed,
            tracked_reference_catalog,
        ):
            raise AuditContractError(
                "Checkpoint failures drifted from policy-derived evidence"
            )
        remaining, accepted, had_review = apply_adjudication(
            identity,
            set(raw_failures),
            is_legal_namespace(pack.source.namespace),
            adjudications,
        )
        if raw_accepted != accepted or raw_remaining != remaining:
            raise AuditContractError("Checkpoint adjudication derivation drifted")
        if had_review:
            expected_consumed.append(identity)
        if evidence["lidApplicable"]:
            recalculated_counts["languageEvidenceFields"] += 1
        if evidence["backtranslationRequired"]:
            recalculated_counts["backtranslatedFields"] += 1
        rescue_kind = evidence["afrikaansRescueKind"]
        support_pair_identity = evidence["supportPairIdentity"]
        if support_pair_identity is not None:
            recalculated_reference_match_rows.append(
                [identity, support_pair_identity]
            )
        if rescue_kind != "none":
            recalculated_rescued_fields += 1
        if rescue_kind == "field-pair":
            recalculated_field_pair_rescued_fields += 1
        elif rescue_kind == "tracked-curated":
            recalculated_tracked_curated_rescued_fields += 1
            recalculated_tracked_rescue_rows.append(
                [identity, support_pair_identity]
            )
        if remaining:
            recalculated_counts["unadjudicatedFields"] += 1
            recalculated_counts["unadjudicatedFailures"] += len(remaining)
            recalculated_codes.update(remaining)
            expected_failure_records.append(
                {
                    "identitySha256": identity,
                    "locale": pack.locale,
                    "namespace": pack.source.namespace,
                    "key": entry.source.key,
                    "sourceSha256": entry.source.source_sha256,
                    "valueSha256": sha256_text(entry.value),
                    "failureCodes": list(remaining),
                }
            )
        if accepted:
            recalculated_counts["adjudicatedFields"] += 1
            recalculated_counts["adjudicatedFailures"] += len(accepted)
            accepted_codes.update(accepted)
        canonical_evidence_rows.append(
            [identity, evidence, list(raw_failures), list(accepted), list(remaining)]
        )
    if (
        binding.get("fieldEvidenceRootSha256")
        != sha256_canonical(canonical_evidence_rows)
    ):
        raise AuditContractError("Checkpoint field evidence root is inconsistent")
    if recalculated_rescued_fields != expected_rescued_fields:
        raise AuditContractError(
            "Checkpoint Afrikaans rescued-field count is inconsistent"
        )
    context_evidence = binding.get("afrikaansPackContext")
    if context_evidence is not None:
        parsed_context = as_mapping(
            context_evidence, "checkpoint Afrikaans pack context"
        )
        if (
            parsed_context.get("fieldPairRescuedFields")
            != recalculated_field_pair_rescued_fields
            or parsed_context.get("trackedCuratedRescuedFields")
            != recalculated_tracked_curated_rescued_fields
            or parsed_context.get("referenceMatchFields")
            != len(recalculated_reference_match_rows)
            or parsed_context.get("referenceMatchRootSha256")
            != sha256_canonical(recalculated_reference_match_rows)
            or parsed_context.get("trackedCuratedRescueRootSha256")
            != sha256_canonical(recalculated_tracked_rescue_rows)
        ):
            raise AuditContractError(
                "Checkpoint Afrikaans split rescue evidence is inconsistent"
            )
    elif (
        recalculated_rescued_fields
        or recalculated_reference_match_rows
        or recalculated_tracked_rescue_rows
    ):
        raise AuditContractError(
            "Non-Afrikaans checkpoint contains tracked rescue evidence"
        )

    expected_count_names = set(recalculated_counts)
    counts = as_mapping(checkpoint.get("counts"), "checkpoint counts")
    require_exact_keys(counts, expected_count_names, "checkpoint counts")
    parsed_counts = {
        key: require_bounded_nonnegative_integer(
            counts.get(key),
            f"checkpoint count {key}",
            (
                len(pack.entries) * len(ALL_FAILURE_CODES)
                if key in {"unadjudicatedFailures", "adjudicatedFailures"}
                else max(20_000, len(pack.entries))
            ),
        )
        for key in expected_count_names
    }
    if parsed_counts != dict(recalculated_counts):
        raise AuditContractError("Pack checkpoint counts drifted from field evidence")

    failure_evidence = as_mapping(
        checkpoint.get("failureRecords"), "checkpoint failure records"
    )
    require_exact_keys(
        failure_evidence,
        {"records", "codeCounts", "adjudicatedCodeCounts"},
        "checkpoint failure records",
    )
    records = as_list(failure_evidence.get("records"), "checkpoint failure records")
    for raw_record in records:
        record = as_mapping(raw_record, "checkpoint failure record")
        require_exact_keys(
            record,
            {
                "identitySha256",
                "locale",
                "namespace",
                "key",
                "sourceSha256",
                "valueSha256",
                "failureCodes",
            },
            "checkpoint failure record",
        )
    if canonical_json(records) != canonical_json(expected_failure_records):
        raise AuditContractError("Checkpoint failure records drifted from field evidence")
    code_counts = require_checkpoint_count_map(
        failure_evidence.get("codeCounts"), "checkpoint failure code counts"
    )
    if dict(sorted(recalculated_codes.items())) != dict(sorted(code_counts.items())):
        raise AuditContractError("Checkpoint failure code counts are inconsistent")

    consumed = tuple(
        require_sha256(identity, "consumed adjudication identity")
        for identity in as_list(
            checkpoint.get("consumedAdjudications"), "consumed adjudications"
        )
    )
    if tuple(sorted(set(consumed))) != consumed:
        raise AuditContractError("Consumed adjudications are duplicate or noncanonical")
    if consumed != tuple(sorted(expected_consumed)):
        raise AuditContractError("Checkpoint consumed adjudications drifted from evidence")
    adjudicated_code_counts = require_checkpoint_count_map(
        failure_evidence.get("adjudicatedCodeCounts"),
        "checkpoint adjudicated code counts",
    )
    if dict(sorted(accepted_codes.items())) != dict(
        sorted(adjudicated_code_counts.items())
    ):
        raise AuditContractError("Checkpoint adjudication counts are inconsistent")
    if (
        binding_unadjudicated != len(expected_failure_records)
        or binding_adjudicated != len(expected_consumed)
    ):
        raise AuditContractError("Checkpoint failure/adjudication totals are inconsistent")
    return checkpoint


def ensure_checkpoint_root(session: AuditCheckpointSession) -> None:
    parent = session.root.parent.absolute()
    assert_no_symlink_components(parent, "checkpoint parent")
    if not parent.is_dir():
        raise AuditContractError("Checkpoint parent must be an existing directory")
    try:
        os.mkdir(session.root, 0o700)
        directory_descriptor = os.open(parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except FileExistsError:
        pass
    assert_no_symlink_components(session.root, "checkpoint root")
    metadata = session.root.lstat()
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != os.getuid()
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        raise AuditContractError("Checkpoint root must be a private mode-0700 directory")


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def stable_checkpoint_bytes(
    path: Path,
    label: str,
    allowed_links: frozenset[int],
    allowed_modes: frozenset[int],
) -> tuple[bytes, os.stat_result]:
    assert_no_symlink_components(path, label)
    before = path.lstat()
    if (
        not stat.S_ISREG(before.st_mode)
        or before.st_nlink not in allowed_links
        or before.st_uid != os.getuid()
        or stat.S_IMODE(before.st_mode) not in allowed_modes
        or before.st_size > MAXIMUM_CHECKPOINT_BYTES
    ):
        raise AuditContractError(f"{label} is not a bounded immutable regular file")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if (
            opened.st_dev != before.st_dev
            or opened.st_ino != before.st_ino
            or opened.st_size != before.st_size
            or opened.st_nlink != before.st_nlink
        ):
            raise AuditContractError(f"{label} changed while it was opened")
        chunks: list[bytes] = []
        remaining = opened.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                raise AuditContractError(f"{label} was truncated while reading")
            chunks.append(chunk)
            remaining -= len(chunk)
        if os.read(descriptor, 1):
            raise AuditContractError(f"{label} grew while reading")
        after = os.fstat(descriptor)
        path_after = path.lstat()
        if (
            after.st_dev != opened.st_dev
            or after.st_ino != opened.st_ino
            or after.st_size != opened.st_size
            or after.st_mode != opened.st_mode
            or after.st_nlink != opened.st_nlink
            or after.st_uid != opened.st_uid
            or after.st_mtime_ns != opened.st_mtime_ns
            or after.st_ctime_ns != opened.st_ctime_ns
            or path_after.st_dev != opened.st_dev
            or path_after.st_ino != opened.st_ino
            or path_after.st_size != opened.st_size
            or path_after.st_mode != opened.st_mode
            or path_after.st_nlink != opened.st_nlink
            or path_after.st_uid != opened.st_uid
            or path_after.st_mtime_ns != opened.st_mtime_ns
            or path_after.st_ctime_ns != opened.st_ctime_ns
        ):
            raise AuditContractError(f"{label} changed while reading")
        return b"".join(chunks), path_after
    finally:
        os.close(descriptor)


def create_session_record(
    session: AuditCheckpointSession, created_at: str
) -> Mapping[str, Any]:
    material = {
        "schemaVersion": 1,
        "kind": SESSION_RECORD_KIND,
        "sessionSha256": session.sha256,
        "session": session.material,
        "createdAt": created_at,
    }
    return {**material, "sessionRecordSha256": sha256_canonical(material)}


def validate_session_record(
    value: Any, session: AuditCheckpointSession
) -> Mapping[str, Any]:
    record = as_mapping(value, "checkpoint session record")
    require_exact_keys(
        record,
        {
            "schemaVersion",
            "kind",
            "sessionSha256",
            "session",
            "createdAt",
            "sessionRecordSha256",
        },
        "checkpoint session record",
    )
    require_bounded_nonnegative_integer(
        record.get("schemaVersion"), "session schemaVersion", 1
    )
    record_sha256 = require_sha256(
        record.get("sessionRecordSha256"), "sessionRecordSha256"
    )
    material = dict(record)
    del material["sessionRecordSha256"]
    if sha256_canonical(material) != record_sha256:
        raise AuditContractError("Checkpoint session record is stale or tampered")
    if (
        record.get("schemaVersion") != 1
        or record.get("kind") != SESSION_RECORD_KIND
        or record.get("sessionSha256") != session.sha256
        or canonical_json(record.get("session"))
        != canonical_json(session.material)
    ):
        raise AuditContractError("Checkpoint root is anchored to a different session")
    created_at = as_string(record.get("createdAt"), "session createdAt", 64)
    if re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", created_at
    ) is None:
        raise AuditContractError("Checkpoint session createdAt is not canonical UTC")
    try:
        parsed = dt.datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise AuditContractError("Checkpoint session createdAt is invalid") from error
    if parsed.tzinfo is None:
        raise AuditContractError("Checkpoint session createdAt lacks a timezone")
    return record


def parse_session_record_bytes(
    raw: bytes, session: AuditCheckpointSession
) -> Mapping[str, Any]:
    try:
        value = strict_json_loads(raw.decode("utf-8"), "checkpoint session record")
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AuditContractError("Checkpoint session record is truncated") from error
    record = validate_session_record(value, session)
    if raw != (canonical_json(record) + "\n").encode("utf-8"):
        raise AuditContractError("Checkpoint session record is not canonical JSON")
    return record


def prepare_checkpoint_session(
    session: AuditCheckpointSession,
    crash_hook: Optional[Callable[[str], None]] = None,
) -> AuditCheckpointSession:
    ensure_checkpoint_root(session)
    final_path = session.root / "session.json"
    temporary_path = session.root / ".session.json.publishing"

    if final_path.exists():
        raw, final_metadata = stable_checkpoint_bytes(
            final_path,
            "checkpoint session record",
            frozenset({1, 2}),
            frozenset({0o400}),
        )
        record = parse_session_record_bytes(raw, session)
        if temporary_path.exists():
            temporary_metadata = temporary_path.lstat()
            if (
                temporary_metadata.st_uid != os.getuid()
                or temporary_metadata.st_nlink != 2
                or final_metadata.st_nlink != 2
                or temporary_metadata.st_dev != final_metadata.st_dev
                or temporary_metadata.st_ino != final_metadata.st_ino
            ):
                raise AuditContractError("Session publication crash tail is unsafe")
            temporary_path.unlink()
            fsync_directory(session.root)
        elif final_metadata.st_nlink != 1:
            raise AuditContractError("Session record has an unexpected hard link")
        stable_checkpoint_bytes(
            final_path,
            "settled checkpoint session record",
            frozenset({1}),
            frozenset({0o400}),
        )
        return dataclasses.replace(
            session, created_at=as_string(record.get("createdAt"), "createdAt", 64)
        )

    if temporary_path.exists():
        tail_raw = b""
        metadata = temporary_path.lstat()
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or metadata.st_nlink != 1
            or stat.S_IMODE(metadata.st_mode) not in {0o400, 0o600}
            or metadata.st_size > MAXIMUM_CHECKPOINT_BYTES
        ):
            raise AuditContractError("Session publication crash tail is unsafe")
        tail_raw, _ = stable_checkpoint_bytes(
            temporary_path,
            "session publication crash tail",
            frozenset({1}),
            frozenset({0o400, 0o600}),
        )
        try:
            record = parse_session_record_bytes(tail_raw, session)
        except AuditContractError as error:
            canonical_complete = False
            if tail_raw:
                try:
                    parsed = strict_json_loads(
                        tail_raw.decode("utf-8"), "session publication crash tail"
                    )
                    canonical_complete = tail_raw == (
                        canonical_json(parsed) + "\n"
                    ).encode("utf-8")
                except (
                    UnicodeDecodeError,
                    json.JSONDecodeError,
                    AuditContractError,
                ):
                    pass
            if canonical_complete:
                raise error
            temporary_path.unlink()
            fsync_directory(session.root)
        else:
            assert_no_symlink_components(
                temporary_path, "session publication crash tail"
            )
            os.chmod(temporary_path, 0o400)
            descriptor = os.open(temporary_path, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            os.link(temporary_path, final_path, follow_symlinks=False)
            fsync_directory(session.root)
            temporary_path.unlink()
            fsync_directory(session.root)
            return dataclasses.replace(
                session,
                created_at=as_string(record.get("createdAt"), "createdAt", 64),
            )

    created_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    record = create_session_record(session, created_at)
    raw = (canonical_json(record) + "\n").encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(temporary_path, flags, 0o600)
    try:
        if crash_hook:
            crash_hook("after-temp-create")
        offset = 0
        while offset < len(raw):
            offset += os.write(descriptor, raw[offset:])
        if crash_hook:
            crash_hook("after-temp-write")
        os.fchmod(descriptor, 0o400)
        os.fsync(descriptor)
        if crash_hook:
            crash_hook("after-temp-fsync")
    finally:
        os.close(descriptor)
    os.link(temporary_path, final_path, follow_symlinks=False)
    if crash_hook:
        crash_hook("after-no-replace-link")
    fsync_directory(session.root)
    if crash_hook:
        crash_hook("after-link-directory-fsync")
    temporary_path.unlink()
    if crash_hook:
        crash_hook("after-temp-unlink")
    fsync_directory(session.root)
    if crash_hook:
        crash_hook("after-final-directory-fsync")
    return dataclasses.replace(session, created_at=created_at)


def parse_checkpoint_bytes(
    raw: bytes,
    session: AuditCheckpointSession,
    plan: PackCheckpointPlan,
    adjudications: AdjudicationSet,
    previous_checkpoint_sha256: Optional[str] = None,
) -> Mapping[str, Any]:
    try:
        text = raw.decode("utf-8")
        value = strict_json_loads(text, "pack checkpoint")
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AuditContractError("Pack checkpoint is truncated or invalid JSON") from error
    checkpoint = validate_pack_checkpoint(
        value,
        session,
        plan,
        adjudications,
        previous_checkpoint_sha256,
    )
    if raw != (canonical_json(checkpoint) + "\n").encode("utf-8"):
        raise AuditContractError("Pack checkpoint bytes are not strict canonical JSON")
    return checkpoint


def publish_pack_checkpoint(
    session: AuditCheckpointSession,
    plan: PackCheckpointPlan,
    checkpoint: Mapping[str, Any],
    crash_hook: Optional[Callable[[str], None]] = None,
) -> Path:
    checkpoint_sha256 = require_sha256(
        checkpoint.get("checkpointSha256"), "checkpointSha256"
    )
    final_path = session.root / checkpoint_final_basename(plan, checkpoint_sha256)
    temporary_path = session.root / checkpoint_temporary_basename(plan)
    if final_path.exists() or temporary_path.exists():
        raise AuditContractError("Checkpoint publication target unexpectedly exists")
    raw = (canonical_json(checkpoint) + "\n").encode("utf-8")
    if len(raw) > MAXIMUM_CHECKPOINT_BYTES:
        raise AuditContractError("Pack checkpoint exceeds its byte bound")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(temporary_path, flags, 0o600)
    try:
        if crash_hook:
            crash_hook("after-temp-create")
        offset = 0
        while offset < len(raw):
            offset += os.write(descriptor, raw[offset:])
        if crash_hook:
            crash_hook("after-temp-write")
        os.fchmod(descriptor, 0o400)
        os.fsync(descriptor)
        if crash_hook:
            crash_hook("after-temp-fsync")
    finally:
        os.close(descriptor)
    os.link(temporary_path, final_path, follow_symlinks=False)
    if crash_hook:
        crash_hook("after-no-replace-link")
    fsync_directory(session.root)
    if crash_hook:
        crash_hook("after-link-directory-fsync")
    temporary_path.unlink()
    if crash_hook:
        crash_hook("after-temp-unlink")
    fsync_directory(session.root)
    if crash_hook:
        crash_hook("after-final-directory-fsync")
    return final_path


def scan_and_recover_checkpoints(
    session: AuditCheckpointSession,
    adjudications: AdjudicationSet,
) -> Mapping[int, Path]:
    if session.created_at is None:
        raise AuditContractError("Checkpoint session was not durably anchored")
    session_path = session.root / "session.json"
    session_raw, _ = stable_checkpoint_bytes(
        session_path,
        "checkpoint session record",
        frozenset({1}),
        frozenset({0o400}),
    )
    parse_session_record_bytes(session_raw, session)
    plans_by_ordinal = {plan.ordinal: plan for plan in session.plans}
    expected_temporary = {
        checkpoint_temporary_basename(plan): plan for plan in session.plans
    }
    final_pattern = re.compile(
        r"^([0-9]{5})-([a-f0-9]{64})-([a-f0-9]{64})\.json$"
    )
    entries = sorted(os.scandir(session.root), key=lambda entry: entry.name)
    if len(entries) > len(session.plans) + 2:
        raise AuditContractError("Checkpoint root exceeds its resource bound")
    total_bytes = 0
    final_paths: dict[int, Path] = {}
    temporaries: dict[int, Path] = {}
    for entry in entries:
        entry_path = Path(entry.path)
        metadata = entry_path.lstat()
        total_bytes += metadata.st_size
        if total_bytes > MAXIMUM_CHECKPOINT_TREE_BYTES:
            raise AuditContractError("Checkpoint root exceeds its byte bound")
        if entry.name == "session.json":
            if entry_path != session_path:
                raise AuditContractError("Checkpoint session path is ambiguous")
            continue
        plan = expected_temporary.get(entry.name)
        if plan is not None:
            if plan.ordinal in temporaries:
                raise AuditContractError("Checkpoint root contains duplicate crash tails")
            temporaries[plan.ordinal] = entry_path
            continue
        match = final_pattern.fullmatch(entry.name)
        if match is None:
            raise AuditContractError("Checkpoint root contains an unknown resource")
        ordinal = int(match.group(1))
        plan = plans_by_ordinal.get(ordinal)
        if plan is None or match.group(2) != plan.pack_input_sha256:
            raise AuditContractError("Checkpoint root contains a mixed-session pack")
        if ordinal in final_paths:
            raise AuditContractError("Checkpoint root contains duplicate pack checkpoints")
        final_paths[ordinal] = entry_path

    final_ordinals = sorted(final_paths)
    if final_ordinals != list(range(1, len(final_ordinals) + 1)):
        raise AuditContractError("Checkpoint sequence has a missing or reordered pack")
    if len(temporaries) > 1:
        raise AuditContractError("Checkpoint root contains multiple crash tails")
    if temporaries:
        temporary_ordinal = next(iter(temporaries))
        if temporary_ordinal not in {len(final_ordinals), len(final_ordinals) + 1}:
            raise AuditContractError("Checkpoint crash tail is outside the chain frontier")

    final_info: dict[int, tuple[Path, os.stat_result, str]] = {}
    previous_checkpoint_sha256: Optional[str] = None
    for ordinal in final_ordinals:
        plan = plans_by_ordinal[ordinal]
        entry_path = final_paths[ordinal]
        raw, metadata = stable_checkpoint_bytes(
            entry_path,
            "pack checkpoint",
            frozenset({1, 2}),
            frozenset({0o400}),
        )
        checkpoint = parse_checkpoint_bytes(
            raw,
            session,
            plan,
            adjudications,
            previous_checkpoint_sha256,
        )
        expected_name = checkpoint_final_basename(
            plan,
            as_string(checkpoint.get("checkpointSha256"), "checkpointSha256", 64),
        )
        if entry_path.name != expected_name:
            raise AuditContractError("Checkpoint filename/self-hash binding drifted")
        previous_checkpoint_sha256 = as_string(
            checkpoint.get("checkpointSha256"), "checkpointSha256", 64
        )
        final_info[ordinal] = (
            entry_path,
            metadata,
            previous_checkpoint_sha256,
        )

    for ordinal, temporary_path in temporaries.items():
        plan = plans_by_ordinal[ordinal]
        final = final_info.get(ordinal)
        if final is not None:
            temporary_metadata = temporary_path.lstat()
            final_metadata = final[1]
            if (
                not stat.S_ISREG(temporary_metadata.st_mode)
                or temporary_metadata.st_nlink != 2
                or final_metadata.st_nlink != 2
                or temporary_metadata.st_dev != final_metadata.st_dev
                or temporary_metadata.st_ino != final_metadata.st_ino
            ):
                raise AuditContractError("Checkpoint crash tail is not the final inode")
            temporary_path.unlink()
            fsync_directory(session.root)
            raw, metadata = stable_checkpoint_bytes(
                final[0],
                "recovered pack checkpoint",
                frozenset({1}),
                frozenset({0o400}),
            )
            predecessor = None if ordinal == 1 else final_info[ordinal - 1][2]
            checkpoint = parse_checkpoint_bytes(
                raw,
                session,
                plan,
                adjudications,
                predecessor,
            )
            final_info[ordinal] = (
                final[0],
                metadata,
                as_string(
                    checkpoint.get("checkpointSha256"), "checkpointSha256", 64
                ),
            )
            continue

        metadata = temporary_path.lstat()
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_nlink != 1
            or stat.S_IMODE(metadata.st_mode) not in {0o400, 0o600}
            or metadata.st_size > MAXIMUM_CHECKPOINT_BYTES
        ):
            raise AuditContractError("Checkpoint crash tail is an unsafe resource")
        raw, _ = stable_checkpoint_bytes(
            temporary_path,
            "checkpoint crash tail",
            frozenset({1}),
            frozenset({0o400, 0o600}),
        )
        try:
            predecessor = None if ordinal == 1 else final_info[ordinal - 1][2]
            checkpoint = parse_checkpoint_bytes(
                raw,
                session,
                plan,
                adjudications,
                predecessor,
            )
        except AuditContractError as error:
            # A non-canonical or incomplete write is a recoverable crash tail. A
            # complete canonical JSON object that violates its session/schema is
            # tampering and must fail closed instead of being silently replaced.
            if metadata.st_size == 0:
                temporary_path.unlink()
                fsync_directory(session.root)
                continue
            try:
                decoded = raw.decode("utf-8")
                parsed = strict_json_loads(decoded, "checkpoint crash tail")
                canonical_complete = (
                    raw == (canonical_json(parsed) + "\n").encode("utf-8")
                )
            except (UnicodeDecodeError, json.JSONDecodeError, AuditContractError):
                canonical_complete = False
            if canonical_complete:
                raise error
            temporary_path.unlink()
            fsync_directory(session.root)
            continue
        assert_no_symlink_components(temporary_path, "checkpoint crash tail")
        os.chmod(temporary_path, 0o400)
        descriptor = os.open(temporary_path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        final_path = session.root / checkpoint_final_basename(
            plan, as_string(checkpoint.get("checkpointSha256"), "checkpointSha256", 64)
        )
        os.link(temporary_path, final_path, follow_symlinks=False)
        fsync_directory(session.root)
        temporary_path.unlink()
        fsync_directory(session.root)
        raw, final_metadata = stable_checkpoint_bytes(
            final_path,
            "recovered pack checkpoint",
            frozenset({1}),
            frozenset({0o400}),
        )
        predecessor = None if ordinal == 1 else final_info[ordinal - 1][2]
        checkpoint = parse_checkpoint_bytes(
            raw,
            session,
            plan,
            adjudications,
            predecessor,
        )
        final_paths[ordinal] = final_path
        final_info[ordinal] = (
            final_path,
            final_metadata,
            as_string(
                checkpoint.get("checkpointSha256"), "checkpointSha256", 64
            ),
        )

    settled_ordinals = sorted(final_paths)
    if settled_ordinals != list(range(1, len(settled_ordinals) + 1)):
        raise AuditContractError("Recovered checkpoint chain is not a canonical prefix")
    previous_checkpoint_sha256 = None
    settled: dict[int, Path] = {}
    for ordinal in settled_ordinals:
        final_path = final_paths[ordinal]
        plan = plans_by_ordinal[ordinal]
        raw, final_metadata = stable_checkpoint_bytes(
            final_path,
            "settled pack checkpoint",
            frozenset({1}),
            frozenset({0o400}),
        )
        checkpoint = parse_checkpoint_bytes(
            raw,
            session,
            plan,
            adjudications,
            previous_checkpoint_sha256,
        )
        del final_metadata
        settled[ordinal] = final_path
        previous_checkpoint_sha256 = as_string(
            checkpoint.get("checkpointSha256"), "checkpointSha256", 64
        )
    return settled


def aggregate_pack_checkpoints(
    session: AuditCheckpointSession,
    checkpoints: Mapping[int, Path],
    adjudications: AdjudicationSet,
) -> Mapping[str, Any]:
    if set(checkpoints) != {plan.ordinal for plan in session.plans}:
        raise AuditContractError("Checkpoint aggregation is missing one or more packs")
    counts: collections.Counter[str] = collections.Counter()
    failure_codes: collections.Counter[str] = collections.Counter()
    adjudicated_codes: collections.Counter[str] = collections.Counter()
    consumed_adjudications: set[str] = set()
    failure_hasher = CanonicalArrayHasher()
    failure_samples: list[Mapping[str, Any]] = []
    pack_bindings: list[Mapping[str, Any]] = []
    checkpoint_chain_rows: list[list[Any]] = []
    pack_rescue_records: list[Mapping[str, Any]] = []
    tracked_reference_evidence: Optional[Mapping[str, Any]] = None
    previous_checkpoint_sha256: Optional[str] = None
    session_record_path = session.root / "session.json"
    session_record_raw, _ = stable_checkpoint_bytes(
        session_record_path,
        "aggregated checkpoint session record",
        frozenset({1}),
        frozenset({0o400}),
    )
    session_record = parse_session_record_bytes(session_record_raw, session)
    for plan in session.plans:
        checkpoint_path = checkpoints[plan.ordinal]
        if checkpoint_path.parent != session.root:
            raise AuditContractError(
                "Checkpoint aggregation escaped the exact checkpoint root"
            )
        raw, _ = stable_checkpoint_bytes(
            checkpoint_path,
            "aggregated pack checkpoint",
            frozenset({1}),
            frozenset({0o400}),
        )
        checkpoint = parse_checkpoint_bytes(
            raw,
            session,
            plan,
            adjudications,
            previous_checkpoint_sha256,
        )
        checkpoint_sha256 = as_string(
            checkpoint.get("checkpointSha256"), "checkpointSha256", 64
        )
        if checkpoint_path.name != checkpoint_final_basename(
            plan, checkpoint_sha256
        ):
            raise AuditContractError(
                "Checkpoint aggregation contains a noncanonical filename"
            )
        checkpoint_chain_rows.append(
            [
                plan.ordinal,
                plan.pack_input_sha256,
                previous_checkpoint_sha256,
                checkpoint_sha256,
                sha256_bytes(raw),
                len(raw),
            ]
        )
        rescue_rows: list[list[Optional[str]]] = []
        for raw_field_row in as_list(
            checkpoint.get("fieldEvidenceRows"),
            "checkpoint field evidence rows",
        ):
            field_row = as_list(
                raw_field_row, "checkpoint field evidence row"
            )
            field_identity = require_sha256(
                field_row[0], "checkpoint rescue field identity"
            )
            field_evidence = as_mapping(
                field_row[1], "checkpoint rescue field evidence"
            )
            rescue_kind = as_string(
                field_evidence.get("afrikaansRescueKind"),
                "checkpoint Afrikaans rescue kind",
                64,
            )
            if rescue_kind == "none":
                continue
            if rescue_kind not in {"field-pair", "tracked-curated"}:
                raise AuditContractError(
                    "Checkpoint contains an unknown Afrikaans rescue kind"
                )
            raw_support_pair_identity = field_evidence.get(
                "supportPairIdentity"
            )
            support_pair_identity = (
                None
                if raw_support_pair_identity is None
                else require_sha256(
                    raw_support_pair_identity,
                    "checkpoint rescue support-pair identity",
                )
            )
            if rescue_kind == "tracked-curated" and support_pair_identity is None:
                raise AuditContractError(
                    "Tracked-curated rescue lacks its exact support pair"
                )
            rescue_rows.append(
                [field_identity, rescue_kind, support_pair_identity]
            )
        rescue_record_root_sha256 = sha256_canonical(rescue_rows)
        pack_rescue_records.append(
            {
                "ordinal": plan.ordinal,
                "locale": plan.locale,
                "namespace": plan.namespace,
                "rescueRecordCount": len(rescue_rows),
                "rescueRecordRootSha256": rescue_record_root_sha256,
                "rescueRecords": rescue_rows,
            }
        )
        checkpoint_reference_evidence = as_mapping(
            checkpoint.get("trackedAfrikaansReferences"),
            "checkpoint tracked Afrikaans references",
        )
        if tracked_reference_evidence is None:
            tracked_reference_evidence = checkpoint_reference_evidence
        elif canonical_json(tracked_reference_evidence) != canonical_json(
            checkpoint_reference_evidence
        ):
            raise AuditContractError(
                "Checkpoint tracked Afrikaans reference evidence is mixed"
            )
        previous_checkpoint_sha256 = checkpoint_sha256
        pack_bindings.append(
            as_mapping(checkpoint.get("packBinding"), "checkpoint pack binding")
        )
        counts.update(as_mapping(checkpoint.get("counts"), "checkpoint counts"))
        failure_evidence = as_mapping(
            checkpoint.get("failureRecords"), "checkpoint failure records"
        )
        records = as_list(failure_evidence.get("records"), "checkpoint failure records")
        for record in records:
            failure_hasher.add(record)
            if len(failure_samples) < MAXIMUM_FAILURE_SAMPLES:
                failure_samples.append(as_mapping(record, "checkpoint failure record"))
        failure_codes.update(
            require_checkpoint_count_map(
                failure_evidence.get("codeCounts"), "checkpoint failure code counts"
            )
        )
        adjudicated_codes.update(
            require_checkpoint_count_map(
                failure_evidence.get("adjudicatedCodeCounts"),
                "checkpoint adjudicated code counts",
            )
        )
        for raw_identity in as_list(
            checkpoint.get("consumedAdjudications"), "consumed adjudications"
        ):
            identity = require_sha256(raw_identity, "consumed adjudication identity")
            if identity in consumed_adjudications:
                raise AuditContractError("An adjudication was consumed by multiple packs")
            consumed_adjudications.add(identity)
    unused_reviews = set(adjudications.reviews) - consumed_adjudications
    if unused_reviews:
        raise AuditContractError(
            f"Adjudications contain {len(unused_reviews)} stale or unknown field reviews"
        )
    pack_identity_root = sha256_canonical(
        [
            [
                pack["locale"],
                pack["namespace"],
                pack["sourceHash"],
                pack["origin"],
                pack["packFileSha256"],
                pack["fieldIdentityRootSha256"],
            ]
            for pack in pack_bindings
        ]
    )
    if tracked_reference_evidence is None:
        raise AuditContractError(
            "Checkpoint aggregation has no tracked Afrikaans reference evidence"
        )
    field_pair_rescued_fields = 0
    tracked_curated_rescued_fields = 0
    tracked_rescue_pack_rows: list[list[Any]] = []
    for pack in pack_bindings:
        context = pack.get("afrikaansPackContext")
        if context is None:
            continue
        parsed_context = as_mapping(context, "Afrikaans pack context")
        field_pair_rescued_fields += int(
            parsed_context["fieldPairRescuedFields"]
        )
        tracked_count = int(parsed_context["trackedCuratedRescuedFields"])
        tracked_curated_rescued_fields += tracked_count
        tracked_rescue_pack_rows.append(
            [
                pack["locale"],
                pack["namespace"],
                tracked_count,
                parsed_context["trackedCuratedRescueRootSha256"],
            ]
        )
    tracked_rescue_root = sha256_canonical(tracked_rescue_pack_rows)
    tracked_global_evidence = {
        **tracked_afrikaans_reference_summary(
            TrackedAfrikaansReferenceCatalog(
                evidence=tracked_reference_evidence,
                support_pair_identities={},
            )
        ),
        "fieldPairRescuedFields": field_pair_rescued_fields,
        "trackedCuratedRescuedFields": tracked_curated_rescued_fields,
        "trackedCuratedRescueRootSha256": tracked_rescue_root,
    }
    pack_evidence_rows = [
            [
                pack["locale"],
                pack["namespace"],
                pack["fieldEvidenceRootSha256"],
                pack["unadjudicatedFields"],
                pack["adjudicatedFields"],
            ]
            for pack in pack_bindings
        ]
    pack_evidence_root = sha256_canonical(
        {
            "packBindings": pack_evidence_rows,
            "afrikaansTrackedCurated": tracked_global_evidence,
        }
    )
    if previous_checkpoint_sha256 is None:
        raise AuditContractError("Checkpoint aggregation has no terminal checkpoint")
    rescue_pack_root_rows = [
        [
            record["ordinal"],
            record["locale"],
            record["namespace"],
            record["rescueRecordCount"],
            record["rescueRecordRootSha256"],
        ]
        for record in pack_rescue_records
    ]
    checkpoint_evidence = {
        "schemaVersion": 1,
        "kind": CHECKPOINT_EVIDENCE_KIND,
        "checkpointRootPath": as_string(
            as_mapping(
                as_mapping(session.material["inputs"], "session inputs")[
                    "paths"
                ],
                "session input paths",
            )["checkpointRoot"],
            "checkpoint root path",
            4_096,
        ),
        "sessionSha256": session.sha256,
        "sessionRecordSha256": require_sha256(
            session_record.get("sessionRecordSha256"),
            "sessionRecordSha256",
        ),
        "sessionFileSha256": sha256_bytes(session_record_raw),
        "checkpointCount": len(checkpoint_chain_rows),
        "terminalCheckpointSha256": previous_checkpoint_sha256,
        "checkpointChainRootSha256": sha256_canonical(
            checkpoint_chain_rows
        ),
        "packRescueRecordCount": len(pack_rescue_records),
        "packRescueRecordRootSha256": sha256_canonical(
            rescue_pack_root_rows
        ),
        "fieldPairRescuedFields": field_pair_rescued_fields,
        "trackedCuratedRescuedFields": tracked_curated_rescued_fields,
        "packRescueRecords": pack_rescue_records,
    }
    return {
        "passed": counts["unadjudicatedFields"] == 0,
        "counts": dict(sorted(counts.items())),
        "packIdentityRootSha256": pack_identity_root,
        "packEvidenceRootSha256": pack_evidence_root,
        "packBindings": pack_bindings,
        "afrikaansTrackedCurated": tracked_global_evidence,
        "checkpointEvidence": checkpoint_evidence,
        "failureRecords": {
            "count": failure_hasher.count,
            "sha256": failure_hasher.finish(),
            "codeCounts": dict(sorted(failure_codes.items())),
            "adjudicatedCodeCounts": dict(sorted(adjudicated_codes.items())),
            "samples": failure_samples,
            "omittedSamples": max(0, failure_hasher.count - len(failure_samples)),
        },
    }


def audit_translation_packs_with_checkpoints(
    session: AuditCheckpointSession,
    models: AuditModels,
    adjudications: AdjudicationSet,
    progress: bool = False,
) -> Mapping[str, Any]:
    completed = dict(scan_and_recover_checkpoints(session, adjudications))
    if completed:
        first_raw, _ = stable_checkpoint_bytes(
            completed[1],
            "tracked reference checkpoint evidence",
            frozenset({1}),
            frozenset({0o400}),
        )
        first_value = as_mapping(
            strict_json_loads(
                first_raw.decode("utf-8"), "tracked reference checkpoint"
            ),
            "tracked reference checkpoint",
        )
        tracked_reference_catalog = derive_tracked_afrikaans_reference_catalog(
            session.tracked_afrikaans_reference_packs,
            session.sha256,
            evidence_value=first_value.get("trackedAfrikaansReferences"),
        )
    else:
        tracked_reference_catalog = derive_tracked_afrikaans_reference_catalog(
            session.tracked_afrikaans_reference_packs,
            session.sha256,
            detector=models.language,
        )
    previous_checkpoint_sha256: Optional[str] = None
    completed_fields = 0
    unadjudicated_fields = 0
    if completed:
        prior: Optional[str] = None
        for ordinal in range(1, len(completed) + 1):
            path = completed[ordinal]
            raw, _ = stable_checkpoint_bytes(
                path,
                "resumed pack checkpoint",
                frozenset({1}),
                frozenset({0o400}),
            )
            checkpoint = parse_checkpoint_bytes(
                raw,
                session,
                session.plans[ordinal - 1],
                adjudications,
                prior,
            )
            counts = as_mapping(checkpoint.get("counts"), "checkpoint counts")
            completed_fields += int(counts["fields"])
            unadjudicated_fields += int(counts["unadjudicatedFields"])
            prior = as_string(
                checkpoint.get("checkpointSha256"), "checkpointSha256", 64
            )
        previous_checkpoint_sha256 = prior
    for plan in session.plans:
        if plan.ordinal in completed:
            continue
        if plan.ordinal != len(completed) + 1:
            raise AuditContractError("Checkpoint resume frontier is noncanonical")
        checkpoint = build_pack_checkpoint(
            session,
            plan,
            models,
            adjudications,
            previous_checkpoint_sha256,
            tracked_reference_catalog,
        )
        final_path = publish_pack_checkpoint(session, plan, checkpoint)
        raw, _ = stable_checkpoint_bytes(
            final_path,
            "published pack checkpoint",
            frozenset({1}),
            frozenset({0o400}),
        )
        settled = parse_checkpoint_bytes(
            raw,
            session,
            plan,
            adjudications,
            previous_checkpoint_sha256,
        )
        completed[plan.ordinal] = final_path
        previous_checkpoint_sha256 = as_string(
            settled.get("checkpointSha256"), "checkpointSha256", 64
        )
        settled_counts = as_mapping(settled.get("counts"), "checkpoint counts")
        completed_fields += int(settled_counts["fields"])
        unadjudicated_fields += int(settled_counts["unadjudicatedFields"])
        if progress and (
            len(completed) % 10 == 0 or len(completed) == len(session.plans)
        ):
            print(
                json.dumps(
                    {
                        "phase": "semantic-audit",
                        "completedPacks": len(completed),
                        "totalPacks": len(session.plans),
                        "completedFields": completed_fields,
                        "unadjudicatedFields": unadjudicated_fields,
                    },
                    separators=(",", ":"),
                ),
                file=sys.stderr,
                flush=True,
            )
    settled_checkpoints = scan_and_recover_checkpoints(session, adjudications)
    return aggregate_pack_checkpoints(
        session, settled_checkpoints, adjudications
    )


def verify_pinned_model_evidence(
    fasttext_model: Path,
    labse_model: Path,
    madlad_model: Path,
    evidence: ModelEvidence,
) -> None:
    runtime_versions = validate_runtime_versions()
    fasttext_resolved = require_cached_model_path(fasttext_model, "fastText model")
    labse_resolved = require_cached_model_path(labse_model, "LaBSE model")
    madlad_resolved = require_cached_model_path(madlad_model, "MADLAD model")
    fasttext_sha256, _ = hash_model_file(fasttext_resolved, "fastText model")
    labse_trust_root = labse_resolved
    if labse_resolved.parent.name == "snapshots":
        labse_trust_root = labse_resolved.parent.parent
    labse_sha256, _, _ = hash_model_tree(
        labse_resolved,
        labse_trust_root,
        frozenset(
            {
                "config.json",
                "model.safetensors",
                "tokenizer.json",
                "2_Dense/config.json",
                "2_Dense/model.safetensors",
            }
        ),
        "LaBSE model",
    )
    madlad_sha256, _, _ = hash_model_tree(
        madlad_resolved,
        madlad_resolved,
        frozenset({"config.json", "model.bin", "spiece.model", "tokenizer.json"}),
        "MADLAD model",
    )
    if (
        fasttext_sha256 != evidence.fasttext_sha256
        or labse_sha256 != evidence.labse_tree_sha256
        or madlad_sha256 != evidence.madlad_tree_sha256
        or runtime_versions != evidence.runtime_versions
    ):
        raise AuditModelError("Pinned model/runtime evidence changed during the audit")


def parse_immutable_manifest_bytes(raw: bytes, label: str) -> Mapping[str, Any]:
    try:
        value = as_mapping(
            strict_json_loads(raw.decode("utf-8"), label), label
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AuditContractError(f"{label} is not valid UTF-8 JSON") from error
    if raw != (canonical_json(value) + "\n").encode("utf-8"):
        raise AuditContractError(f"{label} is not in the immutable report format")
    manifest_sha256 = require_sha256(
        value.get("manifestSha256"), f"{label} manifestSha256"
    )
    material = dict(value)
    del material["manifestSha256"]
    if sha256_canonical(material) != manifest_sha256:
        raise AuditContractError(f"{label} self-hash is stale or tampered")
    return value


def write_immutable_manifest(
    path: Path,
    value: Mapping[str, Any],
    crash_hook: Optional[Callable[[str], None]] = None,
) -> Mapping[str, Any]:
    parent = path.parent.absolute()
    assert_no_symlink_components(parent, "audit output parent")
    if not parent.is_dir():
        raise AuditContractError("Audit output parent must be an existing directory")
    raw = (canonical_json(value) + "\n").encode("utf-8")
    if len(raw) > MAXIMUM_JSON_BYTES:
        raise AuditContractError("Audit output exceeds its byte bound")
    value = parse_immutable_manifest_bytes(raw, "candidate audit output")
    temporary_path = parent / f".{path.name}.publishing"

    if path.exists():
        final_raw, final_metadata = stable_checkpoint_bytes(
            path,
            "audit output",
            frozenset({1, 2}),
            frozenset({0o400}),
        )
        persisted = parse_immutable_manifest_bytes(final_raw, "audit output")
        if temporary_path.exists():
            temporary_metadata = temporary_path.lstat()
            if (
                final_metadata.st_nlink != 2
                or temporary_metadata.st_nlink != 2
                or final_metadata.st_dev != temporary_metadata.st_dev
                or final_metadata.st_ino != temporary_metadata.st_ino
                or final_raw != raw
            ):
                raise AuditContractError("Audit output crash tail is unsafe")
            temporary_path.unlink()
            fsync_directory(parent)
            stable_checkpoint_bytes(
                path,
                "settled audit output",
                frozenset({1}),
                frozenset({0o400}),
            )
        elif final_metadata.st_nlink != 1:
            raise AuditContractError("Audit output has an unexpected hard link")
        if canonical_json(persisted) != canonical_json(value):
            raise AuditContractError("Audit output exists with different evidence")
        return persisted

    if temporary_path.exists():
        tail_raw = b""
        tail_metadata = temporary_path.lstat()
        if (
            not stat.S_ISREG(tail_metadata.st_mode)
            or tail_metadata.st_uid != os.getuid()
            or tail_metadata.st_nlink != 1
            or stat.S_IMODE(tail_metadata.st_mode) not in {0o400, 0o600}
            or tail_metadata.st_size > MAXIMUM_JSON_BYTES
        ):
            raise AuditContractError("Audit output crash tail is unsafe")
        tail_raw, _ = stable_checkpoint_bytes(
            temporary_path,
            "audit output crash tail",
            frozenset({1}),
            frozenset({0o400, 0o600}),
        )
        recoverable_complete = tail_raw == raw
        if not recoverable_complete:
            canonical_complete = False
            parsed: Any = None
            if tail_raw:
                try:
                    parsed = strict_json_loads(
                        tail_raw.decode("utf-8"), "audit output crash tail"
                    )
                    canonical_complete = tail_raw == (
                        json.dumps(parsed, ensure_ascii=False, indent=2) + "\n"
                    ).encode("utf-8")
                except (
                    UnicodeDecodeError,
                    json.JSONDecodeError,
                    AuditContractError,
                ):
                    pass
            if canonical_complete and isinstance(parsed, dict):
                current = dict(value)
                prior = dict(parsed)
                prior_manifest_sha256 = prior.pop("manifestSha256", None)
                current_manifest_sha256 = current.pop("manifestSha256", None)
                prior_created_at = prior.pop("createdAt", None)
                current_created_at = current.pop("createdAt", None)
                recoverable_complete = (
                    require_sha256(
                        prior_manifest_sha256, "crash-tail manifestSha256"
                    )
                    == sha256_canonical(
                        {
                            **prior,
                            "createdAt": prior_created_at,
                        }
                    )
                    and require_sha256(
                        current_manifest_sha256, "current manifestSha256"
                    )
                    == sha256_canonical(
                        {
                            **current,
                            "createdAt": current_created_at,
                        }
                    )
                    and canonical_json(prior) == canonical_json(current)
                    and prior_created_at == current_created_at
                    and isinstance(prior_created_at, str)
                )
            if canonical_complete and not recoverable_complete:
                raise AuditContractError("Audit output crash tail is stale or tampered")
            if not recoverable_complete:
                temporary_path.unlink()
                fsync_directory(parent)
        if recoverable_complete:
            assert_no_symlink_components(temporary_path, "audit output crash tail")
            os.chmod(temporary_path, 0o400)
            descriptor = os.open(temporary_path, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            os.link(temporary_path, path, follow_symlinks=False)
            fsync_directory(parent)
            temporary_path.unlink()
            fsync_directory(parent)
            persisted_raw, _ = stable_checkpoint_bytes(
                path,
                "recovered audit output",
                frozenset({1}),
                frozenset({0o400}),
            )
            persisted = parse_immutable_manifest_bytes(
                persisted_raw, "recovered audit output"
            )
            if canonical_json(persisted) != canonical_json(value):
                raise AuditContractError("Recovered audit output differs from evidence")
            return persisted

    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(temporary_path, flags, 0o600)
    except FileExistsError as error:
        raise AuditContractError("Audit output publication raced another process") from error
    try:
        if crash_hook:
            crash_hook("after-temp-create")
        offset = 0
        while offset < len(raw):
            offset += os.write(descriptor, raw[offset:])
        if crash_hook:
            crash_hook("after-temp-write")
        os.fchmod(descriptor, 0o400)
        os.fsync(descriptor)
        if crash_hook:
            crash_hook("after-temp-fsync")
    finally:
        os.close(descriptor)
    os.link(temporary_path, path, follow_symlinks=False)
    if crash_hook:
        crash_hook("after-no-replace-link")
    fsync_directory(parent)
    if crash_hook:
        crash_hook("after-link-directory-fsync")
    temporary_path.unlink()
    if crash_hook:
        crash_hook("after-temp-unlink")
    fsync_directory(parent)
    if crash_hook:
        crash_hook("after-final-directory-fsync")
    persisted_raw, _ = stable_checkpoint_bytes(
        path,
        "published audit output",
        frozenset({1}),
        frozenset({0o400}),
    )
    persisted = parse_immutable_manifest_bytes(
        persisted_raw, "published audit output"
    )
    if canonical_json(persisted) != canonical_json(value):
        raise AuditContractError("Published audit output differs from evidence")
    return persisted


def resolve_workspace_path(root: Path, value: str, label: str) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    absolute = candidate.absolute()
    if not is_within(absolute, root):
        raise AuditContractError(f"{label} must remain within the workspace root")
    return absolute


def relative_manifest_path(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError as error:
        raise AuditContractError("Manifest input path escaped the workspace root") from error


def prepare_semantic_audit(
    inputs: AuditInputs,
    expectations: AuditExpectations,
    model_evidence: ModelEvidence,
    execution_profile: Mapping[str, Any] = EXECUTION_PROFILE,
    enforce_execution_environment: bool = False,
) -> PreparedSemanticAudit:
    execution_profile_sha256 = sha256_canonical(execution_profile)
    if canonical_json(execution_profile) != canonical_json(EXECUTION_PROFILE):
        raise AuditContractError("Semantic-audit execution profile is not exact")
    if enforce_execution_environment:
        validate_execution_profile(execution_profile_sha256)
    implementation_path = Path(__file__).absolute()
    implementation_raw = read_bounded_regular_file(
        implementation_path, 4 * 1024 * 1024, "audit implementation"
    )
    implementation_sha256 = sha256_bytes(implementation_raw)
    audit_policy_sha256 = sha256_canonical(AUDIT_POLICY)
    master_raw = read_bounded_regular_file(
        inputs.master_worklist, MAXIMUM_MASTER_WORKLIST_BYTES, "master worklist"
    )
    master_file_sha256 = sha256_bytes(master_raw)
    master_value = strict_json_loads(master_raw.decode("utf-8"), "master worklist")
    master, sources, jobs = parse_master_worklist(master_value, expectations)
    master_worklist_sha256 = require_sha256(
        master.get("worklistSha256"), "master worklist SHA-256"
    )
    master_provenance = as_mapping(master.get("provenance"), "master provenance")
    generator_execution_profile = as_mapping(
        master_provenance.get("executionProfile"),
        "master generator execution profile",
    )

    trees = {
        "curated": snapshot_input_tree(
            inputs.curated_root,
            "curated site tree",
            ignore_main_app_workbench=True,
        ),
        "staticMainApp": snapshot_input_tree(
            inputs.static_main_app_root, "tracked static main-app tree"
        ),
        "candidates": snapshot_input_tree(
            inputs.candidate_root, "candidate tree", allow_absent=True
        ),
        "packWorklists": snapshot_input_tree(
            inputs.pack_worklist_root, "pack worklist tree"
        ),
    }
    bindings = expected_adjudication_bindings(
        expectations,
        audit_policy_sha256,
        implementation_sha256,
        model_evidence,
        master_worklist_sha256,
        master_file_sha256,
        trees,
    )
    adjudications = parse_adjudications(inputs.adjudications, bindings)
    pack_union = create_translation_pack_union(
        inputs, expectations, master, sources, jobs
    )
    expected_fields = sum(len(source.entries) for source in sources.values()) * len(
        expectations.locales
    )
    session = create_checkpoint_session(
        inputs,
        expectations,
        pack_union.iter_canonical(),
        lambda plan: pack_union.load(plan.locale, plan.namespace),
        pack_union.tracked_afrikaans_references(),
        expected_fields,
        audit_policy_sha256,
        implementation_sha256,
        model_evidence,
        master_worklist_sha256,
        master_file_sha256,
        trees,
        adjudications,
        execution_profile,
        generator_execution_profile,
    )
    session = prepare_checkpoint_session(session)
    return PreparedSemanticAudit(
        inputs=inputs,
        expectations=expectations,
        implementation_sha256=implementation_sha256,
        audit_policy_sha256=audit_policy_sha256,
        master_worklist_sha256=master_worklist_sha256,
        master_file_sha256=master_file_sha256,
        trees=trees,
        adjudications=adjudications,
        expected_fields=expected_fields,
        session=session,
        execution_profile=execution_profile,
        generator_execution_profile=generator_execution_profile,
    )


def assert_prepared_inputs_unchanged(prepared: PreparedSemanticAudit) -> None:
    inputs = prepared.inputs
    current_master = read_bounded_regular_file(
        inputs.master_worklist, MAXIMUM_MASTER_WORKLIST_BYTES, "master worklist"
    )
    if sha256_bytes(current_master) != prepared.master_file_sha256:
        raise AuditContractError("Master worklist changed during the audit")
    assert_tree_unchanged(
        inputs.curated_root,
        prepared.trees["curated"],
        "curated site tree",
        ignore_main_app_workbench=True,
    )
    assert_tree_unchanged(
        inputs.static_main_app_root,
        prepared.trees["staticMainApp"],
        "tracked static main-app tree",
    )
    assert_tree_unchanged(
        inputs.candidate_root, prepared.trees["candidates"], "candidate tree"
    )
    assert_tree_unchanged(
        inputs.pack_worklist_root,
        prepared.trees["packWorklists"],
        "pack worklist tree",
    )


def construct_semantic_audit_manifest(
    prepared: PreparedSemanticAudit,
    model_evidence: ModelEvidence,
    results: Mapping[str, Any],
) -> Mapping[str, Any]:
    inputs = prepared.inputs
    expectations = prepared.expectations
    result_counts = as_mapping(results.get("counts"), "audit result counts")
    if result_counts.get("fields") != prepared.expected_fields:
        raise AuditContractError(
            f"Semantic audit was partial: expectedFields={prepared.expected_fields} "
            f"actualFields={result_counts.get('fields')}"
        )
    material: dict[str, Any] = {
        "schemaVersion": 3,
        "kind": AUDIT_MANIFEST_KIND,
        "auditVersion": AUDIT_VERSION,
        "createdAt": as_string(
            prepared.session.created_at, "session createdAt", 64
        ),
        "scope": {
            "name": expectations.scope,
            "locales": list(expectations.locales),
            "namespaces": expectations.expected_namespaces,
            "packs": expectations.expected_packs,
            "fields": prepared.expected_fields,
        },
        "policy": {
            "sha256": prepared.audit_policy_sha256,
            "implementationSha256": prepared.implementation_sha256,
            "value": AUDIT_POLICY,
        },
        "models": {
            "modelLockSha256": model_evidence.model_lock_sha256,
            "fasttext": {
                "label": "fastText lid.176",
                "sha256": model_evidence.fasttext_sha256,
            },
            "labse": {
                "label": "sentence-transformers/LaBSE",
                "treeSha256": model_evidence.labse_tree_sha256,
            },
            "madlad": {
                "label": "MADLAD400 3B CTranslate2 int8",
                "treeSha256": model_evidence.madlad_tree_sha256,
            },
            "runtimeVersions": dict(model_evidence.runtime_versions),
        },
        "inputs": {
            "masterWorklist": {
                "path": relative_manifest_path(inputs.master_worklist, inputs.root),
                "fileSha256": prepared.master_file_sha256,
                "worklistSha256": prepared.master_worklist_sha256,
                "generatorExecutionProfile": (
                    prepared.generator_execution_profile
                ),
                "generatorExecutionProfileSha256": (
                    GENERATOR_EXECUTION_PROFILE_SHA256
                ),
            },
            "curatedTree": {
                "path": relative_manifest_path(inputs.curated_root, inputs.root),
                **prepared.trees["curated"].manifest_value(),
            },
            "staticMainAppTree": {
                "path": relative_manifest_path(
                    inputs.static_main_app_root, inputs.root
                ),
                **prepared.trees["staticMainApp"].manifest_value(),
            },
            "candidateTree": {
                "path": relative_manifest_path(inputs.candidate_root, inputs.root),
                **prepared.trees["candidates"].manifest_value(),
            },
            "packWorklistTree": {
                "path": relative_manifest_path(inputs.pack_worklist_root, inputs.root),
                **prepared.trees["packWorklists"].manifest_value(),
            },
            "adjudicationSha256": prepared.adjudications.sha256,
        },
        "results": results,
        "releaseWarnings": [
            "Automated language, semantic, and backtranslation evidence is not legal advice.",
            "Every legal translation receives stricter independent automated review; exceptional threshold overrides must be exact source/value-bound adjudications.",
            "English policy claims and release suitability still require owner approval and, where appropriate, counsel review.",
        ],
    }
    manifest_sha256 = sha256_canonical(material)
    return {**material, "manifestSha256": manifest_sha256}


def run_semantic_audit(
    inputs: AuditInputs,
    expectations: AuditExpectations,
    models: AuditModels,
    fasttext_model: Path,
    labse_model: Path,
    madlad_model: Path,
    execution_profile: Mapping[str, Any] = EXECUTION_PROFILE,
    enforce_execution_environment: bool = False,
    prepared: Optional[PreparedSemanticAudit] = None,
) -> Mapping[str, Any]:
    execution_profile_sha256 = sha256_canonical(execution_profile)
    if prepared is None:
        prepared = prepare_semantic_audit(
            inputs,
            expectations,
            models.evidence,
            execution_profile,
            enforce_execution_environment,
        )
    if (
        prepared.inputs != inputs
        or prepared.expectations != expectations
        or canonical_json(prepared.execution_profile)
        != canonical_json(execution_profile)
        or canonical_json(prepared.generator_execution_profile)
        != canonical_json(GENERATOR_EXECUTION_PROFILE)
        or prepared.session.material["models"]["modelLockSha256"]
        != models.evidence.model_lock_sha256
    ):
        raise AuditContractError("Prepared semantic-audit session binding drifted")
    results = audit_translation_packs_with_checkpoints(
        prepared.session, models, prepared.adjudications, progress=True
    )
    assert_prepared_inputs_unchanged(prepared)
    verify_pinned_model_evidence(
        fasttext_model, labse_model, madlad_model, models.evidence
    )
    if enforce_execution_environment:
        validate_execution_profile(execution_profile_sha256)
    return construct_semantic_audit_manifest(prepared, models.evidence, results)


def parse_cli(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--scope", choices=("afrikaans-smoke", "full"), required=True)
    parser.add_argument("--master-worklist", required=True)
    parser.add_argument("--curated-root", default="translations/curated")
    parser.add_argument(
        "--static-main-app-root", default="translations/static-main-app"
    )
    parser.add_argument("--candidate-root", required=True)
    parser.add_argument("--pack-worklist-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--adjudications")
    parser.add_argument("--fasttext-model", required=True)
    parser.add_argument("--fasttext-sha256", required=True)
    parser.add_argument("--labse-model", required=True)
    parser.add_argument("--labse-tree-sha256", required=True)
    parser.add_argument("--madlad-model", required=True)
    parser.add_argument("--madlad-tree-sha256", required=True)
    parser.add_argument("--execution-profile-sha256", required=True)
    parser.add_argument("--generator-execution-profile-sha256", required=True)
    return parser.parse_args(argv)


def execute_cli_audit(
    arguments: argparse.Namespace,
    root: Path,
    inputs: AuditInputs,
    expectations: AuditExpectations,
    execution_profile: Mapping[str, Any],
) -> int:
    runtime_versions = validate_runtime_versions()
    fasttext_sha256 = require_sha256(
        arguments.fasttext_sha256, "expected fastText SHA-256"
    )
    labse_tree_sha256 = require_sha256(
        arguments.labse_tree_sha256, "expected LaBSE tree SHA-256"
    )
    madlad_tree_sha256 = require_sha256(
        arguments.madlad_tree_sha256, "expected MADLAD tree SHA-256"
    )
    model_lock_material = {
        "fasttextSha256": fasttext_sha256,
        "labseTreeSha256": labse_tree_sha256,
        "madladTreeSha256": madlad_tree_sha256,
        "runtimeVersions": dict(runtime_versions),
    }
    expected_model_evidence = ModelEvidence(
        model_lock_sha256=sha256_canonical(model_lock_material),
        fasttext_sha256=fasttext_sha256,
        labse_tree_sha256=labse_tree_sha256,
        madlad_tree_sha256=madlad_tree_sha256,
        runtime_versions=runtime_versions,
    )
    prepared = prepare_semantic_audit(
        inputs,
        expectations,
        expected_model_evidence,
        execution_profile,
        enforce_execution_environment=True,
    )
    fasttext_model = Path(arguments.fasttext_model)
    labse_model = Path(arguments.labse_model)
    madlad_model = Path(arguments.madlad_model)
    publication_tail = inputs.output.parent / f".{inputs.output.name}.publishing"
    checkpoints = scan_and_recover_checkpoints(
        prepared.session, prepared.adjudications
    )
    checkpoint_chain_complete = len(checkpoints) == len(prepared.session.plans)
    if inputs.output.exists() or publication_tail.exists():
        if not checkpoint_chain_complete:
            raise AuditContractError(
                "Final audit output exists before the checkpoint chain is complete"
            )
    if checkpoint_chain_complete:
        recovered_results = aggregate_pack_checkpoints(
            prepared.session, checkpoints, prepared.adjudications
        )
        assert_prepared_inputs_unchanged(prepared)
        # A completed checkpoint chain needs no model construction. The exact
        # cached model/runtime bytes and execution profile are still reverified
        # before those results can become final release evidence.
        verify_pinned_model_evidence(
            fasttext_model,
            labse_model,
            madlad_model,
            expected_model_evidence,
        )
        validate_execution_profile(sha256_canonical(execution_profile))
        recovered_manifest = construct_semantic_audit_manifest(
            prepared, expected_model_evidence, recovered_results
        )
        persisted = write_immutable_manifest(inputs.output, recovered_manifest)
        return print_cli_audit_outcome(persisted, inputs, root)

    models = load_pinned_models(
        fasttext_model,
        arguments.fasttext_sha256,
        labse_model,
        arguments.labse_tree_sha256,
        madlad_model,
        arguments.madlad_tree_sha256,
        execution_profile,
    )
    if models.evidence != expected_model_evidence:
        raise AuditModelError("Loaded model evidence drifted from the anchored session")
    manifest = run_semantic_audit(
        inputs,
        expectations,
        models,
        fasttext_model,
        labse_model,
        madlad_model,
        execution_profile,
        enforce_execution_environment=True,
        prepared=prepared,
    )
    persisted = write_immutable_manifest(inputs.output, manifest)
    return print_cli_audit_outcome(persisted, inputs, root)


def print_cli_audit_outcome(
    manifest: Mapping[str, Any], inputs: AuditInputs, root: Path
) -> int:
    results = as_mapping(manifest.get("results"), "manifest results")
    counts = as_mapping(results.get("counts"), "manifest result counts")
    print(
        json.dumps(
            {
                "passed": results.get("passed"),
                "packs": counts.get("packs"),
                "fields": counts.get("fields"),
                "unadjudicatedFields": counts.get(
                    "unadjudicatedFields", 0
                ),
                "manifestSha256": manifest.get("manifestSha256"),
                "output": relative_manifest_path(inputs.output, root),
            },
            separators=(",", ":"),
        )
    )
    return 0 if results.get("passed") is True else 3


def main(argv: Optional[Sequence[str]] = None) -> int:
    try:
        arguments = parse_cli(argv)
        root = Path(arguments.root).expanduser().resolve(strict=True)
        if not root.is_dir():
            raise AuditContractError("Workspace root must be a directory")
        inputs = AuditInputs(
            root=root,
            master_worklist=resolve_workspace_path(
                root, arguments.master_worklist, "master worklist"
            ),
            curated_root=resolve_workspace_path(root, arguments.curated_root, "curated root"),
            static_main_app_root=resolve_workspace_path(
                root,
                arguments.static_main_app_root,
                "tracked static main-app root",
            ),
            candidate_root=resolve_workspace_path(
                root, arguments.candidate_root, "candidate root"
            ),
            pack_worklist_root=resolve_workspace_path(
                root, arguments.pack_worklist_root, "pack worklist root"
            ),
            output=resolve_workspace_path(root, arguments.output, "audit output"),
            adjudications=(
                resolve_workspace_path(root, arguments.adjudications, "adjudications")
                if arguments.adjudications
                else None
            ),
        )
        expectations = AuditExpectations.production(arguments.scope)
        if (
            require_sha256(
                arguments.generator_execution_profile_sha256,
                "expected generator execution profile SHA-256",
            )
            != GENERATOR_EXECUTION_PROFILE_SHA256
        ):
            raise AuditContractError(
                "Runner/auditor generator execution profile binding drifted"
            )
        execution_profile = validate_execution_profile(
            arguments.execution_profile_sha256
        )
        lock_parent = root / "tmp"
        assert_no_symlink_components(lock_parent, "semantic-audit lock parent")
        if not lock_parent.is_dir():
            raise AuditContractError("Workspace tmp directory must exist")
        with ExclusiveAuditRunLock(
            lock_parent / ".translation-semantic-audit.lock"
        ):
            return execute_cli_audit(
                arguments,
                root,
                inputs,
                expectations,
                execution_profile,
            )
    except (AuditContractError, AuditModelError) as error:
        print(
            json.dumps(
                {"passed": False, "errorType": type(error).__name__, "message": str(error)},
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
