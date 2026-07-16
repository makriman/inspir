#!/usr/bin/env python3
"""Bounded tests for the offline translation semantic audit."""

from __future__ import annotations

import gc
import importlib.util
import copy
import dataclasses
import json
import os
import sys
import tempfile
import unittest
import weakref
from pathlib import Path
from typing import Mapping, Sequence
from unittest import mock


AUDITOR_PATH = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "audit-translation-semantics.py"
)
AUDITOR_SPEC = importlib.util.spec_from_file_location(
    "audit_translation_semantics", AUDITOR_PATH
)
if AUDITOR_SPEC is None or AUDITOR_SPEC.loader is None:
    raise RuntimeError("Could not load the translation semantic auditor")
AUDITOR = importlib.util.module_from_spec(AUDITOR_SPEC)
sys.modules[AUDITOR_SPEC.name] = AUDITOR
AUDITOR_SPEC.loader.exec_module(AUDITOR)


def complete_language_predictions(
    values: Sequence[tuple[str, float]],
) -> tuple[tuple[str, float], ...]:
    completed = list(values)
    used = {label for label, _ in completed}
    for label in ("fr", "de", "es", "pt", "ca", "it", "sv"):
        if len(completed) == 5:
            break
        if label in used:
            continue
        completed.append((label, 0.0))
        used.add(label)
    if len(completed) != 5:
        raise AssertionError("Could not complete language prediction fixture")
    return tuple(completed)


class FakeLanguageDetector:
    def __init__(self, overrides: Mapping[str, str] | None = None) -> None:
        self.overrides = dict(overrides or {})

    def predict_many(
        self, values: Sequence[str]
    ) -> Sequence[Sequence[AUDITOR.LanguagePrediction]]:
        results: list[Sequence[AUDITOR.LanguagePrediction]] = []
        for value in values:
            label = self.overrides.get(value)
            if label is None:
                if any("\u0600" <= character <= "\u06ff" for character in value):
                    label = "ar"
                elif any("\u0900" <= character <= "\u097f" for character in value):
                    label = "hi"
                elif any("\u3040" <= character <= "\u30ff" for character in value):
                    label = "ja"
                else:
                    label = "af"
            secondary = "en" if label != "en" else "af"
            results.append(
                tuple(
                    AUDITOR.LanguagePrediction(item_label, probability)
                    for item_label, probability in complete_language_predictions(
                        ((label, 0.96), (secondary, 0.02))
                    )
                )
            )
        return tuple(results)


class FakeSemanticScorer:
    def __init__(
        self,
        scores: Mapping[tuple[str, str], float] | None = None,
        default: float = 0.96,
    ) -> None:
        self.scores = dict(scores or {})
        self.default = default

    def similarities(
        self, sources: Sequence[str], values: Sequence[str]
    ) -> Sequence[float]:
        return tuple(
            self.scores.get((source, value), self.default)
            for source, value in zip(sources, values)
        )


class FakeBacktranslator:
    def __init__(self, translations: Mapping[str, str] | None = None) -> None:
        self.translations = dict(translations or {})

    def to_english(self, locale: str, values: Sequence[str]) -> Sequence[str]:
        del locale
        return tuple(self.translations.get(value, value) for value in values)


class ScriptedLanguageDetector:
    def __init__(
        self,
        calls: Sequence[tuple[tuple[str, float], ...]],
    ) -> None:
        self.calls = tuple(calls)
        self.call_count = 0

    def predict_many(
        self, values: Sequence[str]
    ) -> Sequence[Sequence[AUDITOR.LanguagePrediction]]:
        if not values:
            return ()
        if self.call_count >= len(self.calls):
            raise AssertionError("Unexpected language-detector call")
        predictions = tuple(
            AUDITOR.LanguagePrediction(label, probability)
            for label, probability in complete_language_predictions(
                self.calls[self.call_count]
            )
        )
        self.call_count += 1
        return tuple(predictions for _ in values)


class SequencedSemanticScorer:
    def __init__(self, scores: Sequence[float]) -> None:
        self.scores = tuple(scores)
        self.call_count = 0

    def similarities(
        self, sources: Sequence[str], values: Sequence[str]
    ) -> Sequence[float]:
        if len(sources) != len(values):
            raise AssertionError("Mismatched semantic fixture batch")
        if not sources:
            return ()
        if self.call_count >= len(self.scores):
            raise AssertionError("Unexpected semantic-scorer call")
        score = self.scores[self.call_count]
        self.call_count += 1
        return tuple(score for _ in sources)


class RejectingFirstPackModels:
    def __init__(self, forbidden_source: str, forbidden_value: str) -> None:
        self.forbidden_source = forbidden_source
        self.forbidden_value = forbidden_value
        self.semantic_calls = 0
        self.language_calls = 0
        self.backtranslation_calls = 0

    def semantic(self) -> object:
        owner = self

        class Scorer:
            def similarities(
                self, sources: Sequence[str], values: Sequence[str]
            ) -> Sequence[float]:
                if owner.forbidden_source in sources:
                    raise AssertionError("A completed pack was scored again")
                owner.semantic_calls += len(sources)
                return tuple(0.96 for _ in sources)

        return Scorer()

    def language(self) -> object:
        owner = self

        class Detector:
            def predict_many(
                self, values: Sequence[str]
            ) -> Sequence[Sequence[AUDITOR.LanguagePrediction]]:
                if owner.forbidden_value in values:
                    raise AssertionError("A completed pack was language-scored again")
                owner.language_calls += len(values)
                return tuple(
                    tuple(
                        AUDITOR.LanguagePrediction(label, probability)
                        for label, probability in complete_language_predictions(
                            (("af", 0.96), ("en", 0.02))
                        )
                    )
                    for _ in values
                )

        return Detector()

    def backtranslator(self) -> object:
        owner = self

        class Translator:
            def to_english(
                self, locale: str, values: Sequence[str]
            ) -> Sequence[str]:
                del locale
                if owner.forbidden_value in values:
                    raise AssertionError("A completed pack was backtranslated again")
                owner.backtranslation_calls += len(values)
                return tuple(values)

        return Translator()


def fake_models(
    language: FakeLanguageDetector | None = None,
    semantic: FakeSemanticScorer | None = None,
    backtranslator: FakeBacktranslator | None = None,
) -> AUDITOR.AuditModels:
    evidence = AUDITOR.ModelEvidence(
        model_lock_sha256="a" * 64,
        fasttext_sha256="b" * 64,
        labse_tree_sha256="c" * 64,
        madlad_tree_sha256="d" * 64,
        runtime_versions={"fake": "1"},
    )
    return AUDITOR.AuditModels(
        language=language or FakeLanguageDetector(),
        semantic=semantic or FakeSemanticScorer(),
        backtranslator=backtranslator or FakeBacktranslator(),
        evidence=evidence,
    )


def make_pack(
    source: str,
    value: str,
    *,
    locale: str = "af",
    namespace: str = "route:test",
    key: str = "site.test",
    literals: tuple[str, ...] = (),
) -> AUDITOR.TranslationPack:
    source_sha256 = AUDITOR.sha256_text(source)
    entry = AUDITOR.SourceEntry(
        key=key,
        source=source,
        source_sha256=source_sha256,
        text_segments=(source,),
        literal_segments=literals,
    )
    source_pack = AUDITOR.SourcePack(
        namespace=namespace,
        source_hash="e" * 64,
        source_entries_sha256="f" * 64,
        entries=(entry,),
    )
    return AUDITOR.TranslationPack(
        locale=locale,
        language=AUDITOR.LANGUAGE_BY_LOCALE[locale],
        source=source_pack,
        origin="candidate",
        path=Path(f"{locale}/fixture.json"),
        file_sha256="1" * 64,
        entries=(AUDITOR.PackEntry(source=entry, value=value),),
    )


def make_checkpoint_session(
    root: Path,
    packs: Sequence[AUDITOR.TranslationPack],
    *,
    tracked_references: Sequence[AUDITOR.TranslationPack] = (),
    output_name: str = "semantic-audit.json",
    implementation_sha256: str = "8" * 64,
    model_evidence: AUDITOR.ModelEvidence | None = None,
    audit_policy_sha256: str | None = None,
    master_worklist_sha256: str = "5" * 64,
    master_file_sha256: str = "6" * 64,
    trees: Mapping[str, AUDITOR.TreeSnapshot] | None = None,
    execution_profile: Mapping[str, object] | None = None,
) -> AUDITOR.AuditCheckpointSession:
    for directory in ("curated", "static-main-app", "candidates", "worklists"):
        (root / directory).mkdir(exist_ok=True)
    inputs = AUDITOR.AuditInputs(
        root=root,
        master_worklist=root / "master.json",
        curated_root=root / "curated",
        static_main_app_root=root / "static-main-app",
        candidate_root=root / "candidates",
        pack_worklist_root=root / "worklists",
        output=root / output_name,
        adjudications=None,
    )
    identities = {
        (pack.locale, pack.source.namespace): pack for pack in packs
    }
    expectations = AUDITOR.AuditExpectations(
        "fixture",
        tuple(dict.fromkeys(pack.locale for pack in packs)),
        len({pack.source.namespace for pack in packs}),
        len(packs),
    )
    tree_snapshots = trees or {
        name: AUDITOR.TreeSnapshot(True, digest * 64, 0, 0, ())
        for name, digest in (
            ("curated", "2"),
            ("staticMainApp", "9"),
            ("candidates", "3"),
            ("packWorklists", "4"),
        )
    }
    evidence = model_evidence or fake_models().evidence
    return AUDITOR.create_checkpoint_session(
        inputs,
        expectations,
        packs,
        lambda plan: identities[(plan.locale, plan.namespace)],
        tracked_references,
        sum(len(pack.entries) for pack in packs),
        audit_policy_sha256 or AUDITOR.sha256_canonical(AUDITOR.AUDIT_POLICY),
        implementation_sha256,
        evidence,
        master_worklist_sha256,
        master_file_sha256,
        tree_snapshots,
        AUDITOR.AdjudicationSet(None, {}),
        execution_profile or AUDITOR.EXECUTION_PROFILE,
        AUDITOR.GENERATOR_EXECUTION_PROFILE,
    )


def make_prepared_checkpoint_fixture(
    root: Path,
    packs: Sequence[AUDITOR.TranslationPack],
    model_evidence: AUDITOR.ModelEvidence,
) -> tuple[
    AUDITOR.AuditInputs,
    AUDITOR.AuditExpectations,
    AUDITOR.PreparedSemanticAudit,
]:
    session = AUDITOR.prepare_checkpoint_session(
        make_checkpoint_session(
            root,
            packs,
            model_evidence=model_evidence,
        )
    )
    inputs = AUDITOR.AuditInputs(
        root=root,
        master_worklist=root / "master.json",
        curated_root=root / "curated",
        static_main_app_root=root / "static-main-app",
        candidate_root=root / "candidates",
        pack_worklist_root=root / "worklists",
        output=root / "semantic-audit.json",
        adjudications=None,
    )
    expectations = AUDITOR.AuditExpectations(
        "fixture",
        tuple(dict.fromkeys(pack.locale for pack in packs)),
        len({pack.source.namespace for pack in packs}),
        len(packs),
    )
    trees = {
        "curated": AUDITOR.TreeSnapshot(True, "2" * 64, 0, 0, ()),
        "staticMainApp": AUDITOR.TreeSnapshot(True, "9" * 64, 0, 0, ()),
        "candidates": AUDITOR.TreeSnapshot(True, "3" * 64, 0, 0, ()),
        "packWorklists": AUDITOR.TreeSnapshot(True, "4" * 64, 0, 0, ()),
    }
    prepared = AUDITOR.PreparedSemanticAudit(
        inputs=inputs,
        expectations=expectations,
        implementation_sha256="8" * 64,
        audit_policy_sha256=AUDITOR.sha256_canonical(AUDITOR.AUDIT_POLICY),
        master_worklist_sha256="5" * 64,
        master_file_sha256="6" * 64,
        trees=trees,
        adjudications=AUDITOR.AdjudicationSet(None, {}),
        expected_fields=sum(len(pack.entries) for pack in packs),
        session=session,
        execution_profile=AUDITOR.EXECUTION_PROFILE,
        generator_execution_profile=AUDITOR.GENERATOR_EXECUTION_PROFILE,
    )
    return inputs, expectations, prepared


def checkpoint_failure_codes(checkpoint: Mapping[str, object]) -> set[str]:
    rows = checkpoint["fieldEvidenceRows"]
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], list):
        raise AssertionError("Malformed checkpoint field evidence")
    failures = rows[0][2]
    if not isinstance(failures, list):
        raise AssertionError("Malformed checkpoint failure codes")
    return {code for code in failures if isinstance(code, str)}


def make_self_hashed_manifest(*, passed: bool = False) -> dict[str, object]:
    material: dict[str, object] = {
        "schemaVersion": 1,
        "kind": "fixture-audit",
        "createdAt": "2026-07-14T12:00:00Z",
        "passed": passed,
    }
    return {**material, "manifestSha256": AUDITOR.sha256_canonical(material)}


class CrashAt:
    def __init__(self, phase: str) -> None:
        self.phase = phase

    def __call__(self, phase: str) -> None:
        if phase == self.phase:
            raise RuntimeError(f"simulated crash at {phase}")


def failure_codes(result: Mapping[str, object]) -> set[str]:
    failures = result["failureRecords"]
    if not isinstance(failures, dict):
        raise AssertionError("Malformed failure records")
    samples = failures["samples"]
    if not isinstance(samples, list):
        raise AssertionError("Malformed failure samples")
    return {
        code
        for sample in samples
        if isinstance(sample, dict)
        for code in sample.get("failureCodes", [])
        if isinstance(code, str)
    }


F29_REVIEWED_SOURCE = (
    "Use Case Study Simulator when this is the right mode for the job. If you "
    "want a related path, try Feynman Tutor. You can also browse the AI learning "
    "blog for study methods, Socratic learning, flashcards, roleplay, and active "
    "recall."
)
F29_REVIEWED_VALUE = (
    "Gebruik Gevallestudiesimulator wanneer dit die regte modus vir die taak is. "
    "As jy ’n verwante leerpad wil volg, probeer Feynman Tutor. Jy kan ook deur "
    "die KI-leerblog blaai vir studiemetodes, Sokratiese leer, flitskaarte, "
    "rolspel en aktiewe herroeping."
)


def make_master_fixture(
    replacement: Mapping[str, object] | None = None,
    reviewed_override: bool = False,
) -> tuple[dict[str, object], dict[str, object]]:
    source_text = "Start learning now."
    protected = AUDITOR.derive_protected_source_text(source_text)
    source_entry = {
        "key": "site.test",
        "source": source_text,
        "sourceSha256": AUDITOR.sha256_text(source_text),
        "invariantSha256": protected["invariantSha256"],
        "segments": protected["segments"],
    }
    source_entries = [source_entry]
    if reviewed_override:
        reviewed_protected = AUDITOR.derive_protected_source_text(
            F29_REVIEWED_SOURCE
        )
        source_entries.append(
            {
                "key": "site.d835e997c12945b8ec",
                "source": F29_REVIEWED_SOURCE,
                "sourceSha256": AUDITOR.sha256_text(F29_REVIEWED_SOURCE),
                "invariantSha256": reviewed_protected["invariantSha256"],
                "segments": reviewed_protected["segments"],
            }
        )
    source_entries.sort(key=lambda entry: entry["key"])
    source = {
        "namespace": "route:test",
        "sourceHash": "e" * 64,
        "sourceEntriesSha256": AUDITOR.sha256_canonical(source_entries),
        "entries": source_entries,
    }
    validator_policy_sha256 = "5" * 64
    job_material: dict[str, object] = {
        "language": "Afrikaans",
        "locale": "af",
        "nllbCode": "afr_Latn",
        "namespace": source["namespace"],
        "sourceHash": source["sourceHash"],
        "sourceEntriesSha256": source["sourceEntriesSha256"],
        "entryCount": len(source_entries),
        "worklistRelativePath": "af/route__test.json",
        "candidateRelativePath": "af/route__test.json",
        "targetRelativePath": "af/route__test.json",
    }
    if replacement is not None:
        job_material["replacement"] = dict(replacement)
    job = {**job_material, "jobSha256": AUDITOR.sha256_canonical(job_material)}
    validator_files = [
        {
            "relativePath": f"lib/validator/{index}.ts",
            "bytes": index + 1,
            "sha256": str(index + 1) * 64,
        }
        for index in range(7)
    ]
    reviewed_seed_entries = []
    reviewed_override_entries = []
    if reviewed_override:
        reviewed_seed = {
            "language": "Afrikaans",
            "locale": "af",
            "source": F29_REVIEWED_SOURCE,
            "sourceSha256": AUDITOR.sha256_text(F29_REVIEWED_SOURCE),
            "value": F29_REVIEWED_VALUE,
            "valueSha256": AUDITOR.sha256_text(F29_REVIEWED_VALUE),
        }
        reviewed_seed_entries.append(reviewed_seed)
        reviewed_override_entries.append(
            {
                **reviewed_seed,
                "requiredOccurrences": [
                    {
                        "namespace": "route:test",
                        "sourceHash": "e" * 64,
                        "key": "site.d835e997c12945b8ec",
                    }
                ],
            }
        )
    generation_override_material = {
        "schemaVersion": 1,
        "kind": "inspir-long-tail-generation-overrides-v1",
        "entries": reviewed_override_entries,
    }
    generation_overrides_sha256 = AUDITOR.sha256_canonical(
        generation_override_material
    )
    seed_memory_material = {
        "schemaVersion": 1,
        "kind": "inspir-long-tail-translation-seed-memory-v1",
        "entries": reviewed_seed_entries,
        "conflicts": [],
    }
    seed_memory_sha256 = AUDITOR.sha256_canonical(seed_memory_material)
    material = {
        "schemaVersion": 1,
        "kind": "inspir-long-tail-translation-worklist-v1",
        "provenance": {
            "pipelineVersion": AUDITOR.GENERATOR_PIPELINE_VERSION,
            "executionProfile": copy.deepcopy(
                AUDITOR.GENERATOR_EXECUTION_PROFILE
            ),
            "protectorVersion": "inspir-long-tail-literal-protector-v1",
            "protectorSha256": "1" * 64,
            "pipelineImplementationSha256": "2" * 64,
            "workerImplementationSha256": "3" * 64,
            "validatorPolicy": {
                "kind": "inspir-long-tail-validator-policy-v1",
                "files": validator_files,
                "validatorPolicySha256": validator_policy_sha256,
            },
            "modelLabel": "fixture-nllb",
            "modelSha256": "6" * 64,
            "seedMemorySha256": seed_memory_sha256,
            "seedMemoryEntries": len(reviewed_seed_entries),
            "seedMemoryConflicts": 0,
            "generationOverridesSha256": generation_overrides_sha256,
            "generationOverrideEntries": len(reviewed_override_entries),
            "generationConfig": {
                "batchSize": 1,
                "numBeams": 1,
                "noRepeatNgramSize": 0,
                "dtype": "float32",
                "device": "cpu",
                "maxSourceTokens": 128,
                "maxNewTokens": 128,
                "maxRetryAttempts": 1,
                "deterministicAlgorithms": True,
                "manualSeed": 0,
            },
        },
        "seedMemory": {
            **seed_memory_material,
            "seedMemorySha256": seed_memory_sha256,
        },
        "generationOverrides": {
            **generation_override_material,
            "generationOverridesSha256": generation_overrides_sha256,
        },
        "sources": [source],
        "jobs": [job],
    }
    master = {**material, "worklistSha256": AUDITOR.sha256_canonical(material)}
    return master, source


class ObservedAfrikaansFailureTests(unittest.TestCase):
    def test_copied_code_tutor_title_and_mixed_english_fail(self) -> None:
        source = (
            "Code Tutor For Learning Programming By Building is a focused way to use AI "
            "for learning instead of passive answer collection."
        )
        value = (
            "Code Tutor For Learning Programming By Building is 'n gefokusde manier om KI "
            "vir leer te gebruik."
        )
        language = FakeLanguageDetector({value: "en"})
        result = AUDITOR.audit_translation_packs(
            (make_pack(source, value),), fake_models(language=language), AUDITOR.AdjudicationSet(None, {})
        )
        codes = failure_codes(result)
        self.assertIn("source-span-copy", codes)
        self.assertIn("mixed-english", codes)
        self.assertFalse(result["passed"])

    def test_hints_checks_omission_fails_semantic_and_backtranslation(self) -> None:
        source = "Use hints and checks to test every important step."
        value = "Gebruik wenke, die."
        backtranslation = "Use hints."
        semantic = FakeSemanticScorer(
            {(source, value): 0.31, (source, backtranslation): 0.42}
        )
        result = AUDITOR.audit_translation_packs(
            (make_pack(source, value),),
            fake_models(
                semantic=semantic,
                backtranslator=FakeBacktranslator({value: backtranslation}),
            ),
            AUDITOR.AdjudicationSet(None, {}),
        )
        codes = failure_codes(result)
        self.assertIn("semantic-adequacy-low", codes)
        self.assertIn("backtranslation-adequacy-low", codes)
        self.assertIn("possible-omission", codes)

    def test_essays_and_drafts_duplicate_collapse_fails(self) -> None:
        result = AUDITOR.audit_translation_packs(
            (make_pack("Essays And Drafts", "Opstelle en opstelle"),),
            fake_models(),
            AUDITOR.AdjudicationSet(None, {}),
        )
        self.assertIn("duplicate-collapse", failure_codes(result))

    def test_acknowledge_mistranslation_fails_legal_gate(self) -> None:
        source = "YOU ACKNOWLEDGE that this service has limits."
        value = "JY BETEKEN dat hierdie diens perke het."
        backtranslation = "YOU MEAN that this service has limits."
        semantic = FakeSemanticScorer(
            {(source, value): 0.55, (source, backtranslation): 0.51}
        )
        result = AUDITOR.audit_translation_packs(
            (make_pack(source, value, namespace="legal:terms"),),
            fake_models(
                semantic=semantic,
                backtranslator=FakeBacktranslator({value: backtranslation}),
            ),
            AUDITOR.AdjudicationSet(None, {}),
        )
        codes = failure_codes(result)
        self.assertIn("semantic-adequacy-low", codes)
        self.assertIn("backtranslation-adequacy-low", codes)

    def test_prior_written_consent_omission_fails(self) -> None:
        source = "You may not reproduce the material without our prior written consent."
        value = "Jy mag nie die materiaal reproduseer nie."
        backtranslation = "You may not reproduce the material."
        semantic = FakeSemanticScorer({(source, backtranslation): 0.68})
        result = AUDITOR.audit_translation_packs(
            (make_pack(source, value, namespace="legal:tnc"),),
            fake_models(
                semantic=semantic,
                backtranslator=FakeBacktranslator({value: backtranslation}),
            ),
            AUDITOR.AdjudicationSet(None, {}),
        )
        self.assertIn("possible-omission", failure_codes(result))


class RepresentativeLanguageAndInvariantTests(unittest.TestCase):
    def test_good_latin_translation_passes(self) -> None:
        result = AUDITOR.audit_translation_packs(
            (make_pack("Start learning now.", "Begin nou leer."),),
            fake_models(),
            AUDITOR.AdjudicationSet(None, {}),
        )
        self.assertTrue(result["passed"])

    def test_good_non_latin_translation_passes(self) -> None:
        result = AUDITOR.audit_translation_packs(
            (make_pack("Start learning now.", "ابدأ التعلم الآن.", locale="ar"),),
            fake_models(),
            AUDITOR.AdjudicationSet(None, {}),
        )
        self.assertTrue(result["passed"])

    def test_negation_loss_fails(self) -> None:
        source = "Do not share personal data."
        value = "Deel persoonlike data."
        result = AUDITOR.audit_translation_packs(
            (make_pack(source, value),),
            fake_models(backtranslator=FakeBacktranslator({value: "Share personal data."})),
            AUDITOR.AdjudicationSet(None, {}),
        )
        self.assertIn("negation-parity", failure_codes(result))

    def test_number_and_placeholder_drift_are_hard_failures(self) -> None:
        source = "Card {current} of {total}: 10 points"
        value = "Kaart {current}: 11 punte"
        result = AUDITOR.audit_translation_packs(
            (make_pack(source, value),),
            fake_models(backtranslator=FakeBacktranslator({value: source})),
            AUDITOR.AdjudicationSet(None, {}),
        )
        codes = failure_codes(result)
        self.assertIn("number-parity", codes)
        self.assertIn("placeholder-parity", codes)

    def test_unsupported_target_mapping_fails_closed(self) -> None:
        pack = make_pack("Start learning.", "Begin leer.")
        drifted = AUDITOR.TranslationPack(
            locale="xx",
            language="Unknown",
            source=pack.source,
            origin=pack.origin,
            path=pack.path,
            file_sha256=pack.file_sha256,
            entries=pack.entries,
        )
        with self.assertRaisesRegex(AUDITOR.AuditContractError, "Unsupported target"):
            AUDITOR.audit_translation_packs(
                (drifted,), fake_models(), AUDITOR.AdjudicationSet(None, {})
            )


class SentenceAlignmentCardinalityTests(unittest.TestCase):
    def test_two_by_two_matrix_consumes_every_cell_and_passes_alignment(self) -> None:
        evidence = AUDITOR.build_alignment_evidence(
            (0.91, 0.10, 0.20, 0.82),
            source_sentence_count=2,
            backtranslation_sentence_count=2,
        )
        self.assertEqual(evidence.matrix, ((0.91, 0.10), (0.20, 0.82)))
        self.assertAlmostEqual(evidence.minimum_source_alignment, 0.82)
        self.assertAlmostEqual(evidence.minimum_backtranslation_alignment, 0.82)
        self.assertGreaterEqual(
            evidence.minimum_source_alignment,
            AUDITOR.AUDIT_POLICY["semantic"]["sentenceAlignmentMinimum"],
        )
        self.assertGreaterEqual(
            evidence.minimum_backtranslation_alignment,
            AUDITOR.AUDIT_POLICY["semantic"]["sentenceAlignmentMinimum"],
        )
        with self.assertRaisesRegex(AUDITOR.AuditModelError, "cardinality"):
            AUDITOR.build_alignment_evidence((0.91, 0.10, 0.20), 2, 2)

    def test_three_by_two_matrix_distinguishes_omission_from_addition(self) -> None:
        omission = AUDITOR.build_alignment_evidence(
            (0.90, 0.10, 0.20, 0.85, 0.30, 0.25),
            source_sentence_count=3,
            backtranslation_sentence_count=2,
        )
        self.assertEqual(omission.matrix[2], (0.30, 0.25))
        self.assertLess(omission.minimum_source_alignment, 0.58)
        self.assertGreaterEqual(omission.minimum_backtranslation_alignment, 0.58)

        addition = AUDITOR.build_alignment_evidence(
            (0.90, 0.20, 0.80, 0.30, 0.75, 0.25),
            source_sentence_count=3,
            backtranslation_sentence_count=2,
        )
        self.assertEqual(addition.matrix[2], (0.75, 0.25))
        self.assertGreaterEqual(addition.minimum_source_alignment, 0.58)
        self.assertLess(addition.minimum_backtranslation_alignment, 0.58)


class LegalAdjudicationTests(unittest.TestCase):
    def test_exact_review_can_adjudicate_exceptional_legal_model_threshold(self) -> None:
        source = "You may close your account."
        value = "Jy mag jou rekening sluit."
        pack = make_pack(source, value, namespace="legal:terms")
        models = fake_models(
            semantic=FakeSemanticScorer({(source, value): 0.69}),
            backtranslator=FakeBacktranslator({value: source}),
        )
        identity = AUDITOR.field_identity_sha256(pack, pack.entries[0])
        review = AUDITOR.AdjudicationReview(
            identity_sha256=identity,
            review_kind="independent-legal-copy-review",
            reviewer="reviewer-id",
            reviewed_at="2026-07-14T12:00:00Z",
            rationale_sha256="2" * 64,
            accepted_failure_codes=("semantic-adequacy-low",),
        )
        result = AUDITOR.audit_translation_packs(
            (pack,), models, AUDITOR.AdjudicationSet("3" * 64, {identity: review})
        )
        self.assertTrue(result["passed"])
        self.assertEqual(result["counts"]["adjudicatedFields"], 1)

    def test_legal_review_cannot_waive_structural_failure(self) -> None:
        pack = make_pack(
            "Close account {accountId}.",
            "Sluit rekening.",
            namespace="legal:terms",
        )
        identity = AUDITOR.field_identity_sha256(pack, pack.entries[0])
        review = AUDITOR.AdjudicationReview(
            identity_sha256=identity,
            review_kind="independent-legal-copy-review",
            reviewer="reviewer-id",
            reviewed_at="2026-07-14T12:00:00Z",
            rationale_sha256="2" * 64,
            accepted_failure_codes=("placeholder-parity",),
        )
        with self.assertRaisesRegex(AUDITOR.AuditContractError, "hard invariant"):
            AUDITOR.audit_translation_packs(
                (pack,),
                fake_models(
                    backtranslator=FakeBacktranslator(
                        {"Sluit rekening.": "Close account."}
                    )
                ),
                AUDITOR.AdjudicationSet("3" * 64, {identity: review}),
            )


class CheckpointResumeAndDurabilityTests(unittest.TestCase):
    publication_phases = (
        "after-temp-create",
        "after-temp-write",
        "after-temp-fsync",
        "after-no-replace-link",
        "after-link-directory-fsync",
        "after-temp-unlink",
        "after-final-directory-fsync",
    )

    def test_resume_scores_only_the_missing_suffix_and_exactly_matches_monolithic(self) -> None:
        packs = tuple(
            make_pack(
                f"Start learning carefully in lesson {word}.",
                f"Begin vandag rustig met les {translation}.",
                namespace=f"route:lesson-{word}",
                key=f"site.lesson.{word}",
            )
            for word, translation in (
                ("one", "een"),
                ("two", "twee"),
                ("three", "drie"),
            )
        )
        adjudications = AUDITOR.AdjudicationSet(None, {})
        baseline = AUDITOR.audit_translation_packs(
            packs, fake_models(), adjudications
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            session = AUDITOR.prepare_checkpoint_session(
                make_checkpoint_session(root, packs)
            )
            first = AUDITOR.build_pack_checkpoint(
                session,
                session.plans[0],
                fake_models(),
                adjudications,
                None,
            )
            AUDITOR.publish_pack_checkpoint(session, session.plans[0], first)

            counter = RejectingFirstPackModels(
                packs[0].entries[0].source.source,
                packs[0].entries[0].value,
            )
            resumed_models = AUDITOR.AuditModels(
                language=counter.language(),
                semantic=counter.semantic(),
                backtranslator=counter.backtranslator(),
                evidence=fake_models().evidence,
            )
            resumed = AUDITOR.audit_translation_packs_with_checkpoints(
                session,
                resumed_models,
                adjudications,
            )
            self.assertEqual(
                {
                    key: value
                    for key, value in resumed.items()
                    if key != "checkpointEvidence"
                },
                baseline,
            )
            checkpoint_evidence = resumed["checkpointEvidence"]
            self.assertEqual(checkpoint_evidence["sessionSha256"], session.sha256)
            self.assertEqual(checkpoint_evidence["checkpointCount"], 3)
            self.assertEqual(checkpoint_evidence["packRescueRecordCount"], 3)
            self.assertEqual(
                len(checkpoint_evidence["packRescueRecords"]), 3
            )
            self.assertEqual(counter.semantic_calls, 2)
            self.assertGreater(counter.language_calls, 0)
            self.assertEqual(counter.backtranslation_calls, 0)
            settled = AUDITOR.scan_and_recover_checkpoints(
                session, adjudications
            )
            self.assertEqual(set(settled), {1, 2, 3})
            self.assertTrue(all(isinstance(path, Path) for path in settled.values()))
            self.assertNotIn("pack", vars(session.plans[0]))

    def test_complete_chain_finalizes_without_constructing_models(self) -> None:
        pack = make_pack("Start learning now.", "Begin nou leer.")
        runtime_versions = {"fake": "1"}
        model_material = {
            "fasttextSha256": "b" * 64,
            "labseTreeSha256": "c" * 64,
            "madladTreeSha256": "d" * 64,
            "runtimeVersions": runtime_versions,
        }
        evidence = AUDITOR.ModelEvidence(
            model_lock_sha256=AUDITOR.sha256_canonical(model_material),
            fasttext_sha256="b" * 64,
            labse_tree_sha256="c" * 64,
            madlad_tree_sha256="d" * 64,
            runtime_versions=runtime_versions,
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            inputs, expectations, prepared = make_prepared_checkpoint_fixture(
                root, (pack,), evidence
            )
            checkpoint = AUDITOR.build_pack_checkpoint(
                prepared.session,
                prepared.session.plans[0],
                fake_models(),
                prepared.adjudications,
                None,
            )
            AUDITOR.publish_pack_checkpoint(
                prepared.session, prepared.session.plans[0], checkpoint
            )
            arguments = AUDITOR.argparse.Namespace(
                fasttext_sha256=evidence.fasttext_sha256,
                labse_tree_sha256=evidence.labse_tree_sha256,
                madlad_tree_sha256=evidence.madlad_tree_sha256,
                fasttext_model=str(root / "fasttext.bin"),
                labse_model=str(root / "labse"),
                madlad_model=str(root / "madlad"),
            )
            with (
                mock.patch.object(
                    AUDITOR,
                    "validate_runtime_versions",
                    return_value=runtime_versions,
                ),
                mock.patch.object(
                    AUDITOR,
                    "prepare_semantic_audit",
                    return_value=prepared,
                ),
                mock.patch.object(
                    AUDITOR, "assert_prepared_inputs_unchanged"
                ) as input_verifier,
                mock.patch.object(
                    AUDITOR, "verify_pinned_model_evidence"
                ) as model_hash_verifier,
                mock.patch.object(
                    AUDITOR, "validate_execution_profile"
                ) as profile_verifier,
                mock.patch.object(
                    AUDITOR,
                    "load_pinned_models",
                    side_effect=AssertionError("models must not be constructed"),
                ) as model_loader,
                mock.patch("builtins.print"),
            ):
                status = AUDITOR.execute_cli_audit(
                    arguments,
                    root,
                    inputs,
                    expectations,
                    AUDITOR.EXECUTION_PROFILE,
                )
            self.assertEqual(status, 0)
            self.assertTrue(inputs.output.exists())
            model_loader.assert_not_called()
            model_hash_verifier.assert_called_once()
            input_verifier.assert_called_once_with(prepared)
            profile_verifier.assert_called_once_with(
                AUDITOR.sha256_canonical(AUDITOR.EXECUTION_PROFILE)
            )

    def test_partial_chain_constructs_models_exactly_once(self) -> None:
        packs = (
            make_pack(
                "Start learning now.",
                "Begin nou leer.",
                namespace="route:first",
            ),
            make_pack(
                "Keep learning now.",
                "Hou nou aan leer.",
                namespace="route:second",
            ),
        )
        runtime_versions = {"fake": "1"}
        model_material = {
            "fasttextSha256": "b" * 64,
            "labseTreeSha256": "c" * 64,
            "madladTreeSha256": "d" * 64,
            "runtimeVersions": runtime_versions,
        }
        evidence = AUDITOR.ModelEvidence(
            model_lock_sha256=AUDITOR.sha256_canonical(model_material),
            fasttext_sha256="b" * 64,
            labse_tree_sha256="c" * 64,
            madlad_tree_sha256="d" * 64,
            runtime_versions=runtime_versions,
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            inputs, expectations, prepared = make_prepared_checkpoint_fixture(
                root, packs, evidence
            )
            first = AUDITOR.build_pack_checkpoint(
                prepared.session,
                prepared.session.plans[0],
                fake_models(),
                prepared.adjudications,
                None,
            )
            AUDITOR.publish_pack_checkpoint(
                prepared.session, prepared.session.plans[0], first
            )
            models = AUDITOR.AuditModels(
                language=FakeLanguageDetector(),
                semantic=FakeSemanticScorer(),
                backtranslator=FakeBacktranslator(),
                evidence=evidence,
            )
            manifest_material = {
                "schemaVersion": 1,
                "kind": "fixture-audit",
                "createdAt": prepared.session.created_at,
                "results": {
                    "passed": True,
                    "counts": {"packs": 2, "fields": 2},
                },
            }
            manifest = {
                **manifest_material,
                "manifestSha256": AUDITOR.sha256_canonical(
                    manifest_material
                ),
            }
            arguments = AUDITOR.argparse.Namespace(
                fasttext_sha256=evidence.fasttext_sha256,
                labse_tree_sha256=evidence.labse_tree_sha256,
                madlad_tree_sha256=evidence.madlad_tree_sha256,
                fasttext_model=str(root / "fasttext.bin"),
                labse_model=str(root / "labse"),
                madlad_model=str(root / "madlad"),
            )
            with (
                mock.patch.object(
                    AUDITOR,
                    "validate_runtime_versions",
                    return_value=runtime_versions,
                ),
                mock.patch.object(
                    AUDITOR,
                    "prepare_semantic_audit",
                    return_value=prepared,
                ),
                mock.patch.object(
                    AUDITOR, "load_pinned_models", return_value=models
                ) as model_loader,
                mock.patch.object(
                    AUDITOR, "run_semantic_audit", return_value=manifest
                ) as runner,
                mock.patch("builtins.print"),
            ):
                status = AUDITOR.execute_cli_audit(
                    arguments,
                    root,
                    inputs,
                    expectations,
                    AUDITOR.EXECUTION_PROFILE,
                )
            self.assertEqual(status, 0)
            model_loader.assert_called_once()
            runner.assert_called_once()

    def test_session_publication_recovers_every_atomic_crash_window(self) -> None:
        pack = make_pack("Start learning now.", "Begin nou leer.")
        for phase in self.publication_phases:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory:
                session = make_checkpoint_session(Path(directory).resolve(), (pack,))
                with self.assertRaisesRegex(RuntimeError, "simulated crash"):
                    AUDITOR.prepare_checkpoint_session(session, CrashAt(phase))
                recovered = AUDITOR.prepare_checkpoint_session(session)
                self.assertIsNotNone(recovered.created_at)
                self.assertEqual(
                    {entry.name for entry in recovered.root.iterdir()},
                    {"session.json"},
                )
                self.assertEqual(
                    (recovered.root / "session.json").stat().st_mode & 0o777,
                    0o400,
                )

    def test_pack_publication_recovers_every_atomic_crash_window(self) -> None:
        pack = make_pack("Start learning now.", "Begin nou leer.")
        adjudications = AUDITOR.AdjudicationSet(None, {})
        baseline = AUDITOR.audit_translation_packs(
            (pack,), fake_models(), adjudications
        )
        for phase in self.publication_phases:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory:
                session = AUDITOR.prepare_checkpoint_session(
                    make_checkpoint_session(Path(directory).resolve(), (pack,))
                )
                checkpoint = AUDITOR.build_pack_checkpoint(
                    session,
                    session.plans[0],
                    fake_models(),
                    adjudications,
                    None,
                )
                with self.assertRaisesRegex(RuntimeError, "simulated crash"):
                    AUDITOR.publish_pack_checkpoint(
                        session,
                        session.plans[0],
                        checkpoint,
                        CrashAt(phase),
                    )
                settled = dict(
                    AUDITOR.scan_and_recover_checkpoints(
                        session, adjudications
                    )
                )
                if not settled:
                    AUDITOR.publish_pack_checkpoint(
                        session, session.plans[0], checkpoint
                    )
                    settled = dict(
                        AUDITOR.scan_and_recover_checkpoints(
                            session, adjudications
                        )
                    )
                aggregated = AUDITOR.aggregate_pack_checkpoints(
                    session, settled, adjudications
                )
                self.assertEqual(
                    {
                        key: value
                        for key, value in aggregated.items()
                        if key != "checkpointEvidence"
                    },
                    baseline,
                )
                self.assertEqual(
                    aggregated["checkpointEvidence"]["checkpointCount"], 1
                )
                self.assertEqual(len(settled), 1)
                self.assertEqual(settled[1].stat().st_nlink, 1)
                self.assertEqual(settled[1].stat().st_mode & 0o777, 0o400)

    def test_final_manifest_publication_recovers_every_atomic_crash_window(self) -> None:
        manifest = make_self_hashed_manifest()
        for phase in self.publication_phases:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve() / "audit.json"
                with self.assertRaisesRegex(RuntimeError, "simulated crash"):
                    AUDITOR.write_immutable_manifest(
                        output, manifest, CrashAt(phase)
                    )
                self.assertEqual(
                    AUDITOR.write_immutable_manifest(output, manifest), manifest
                )
                self.assertEqual(output.stat().st_mode & 0o777, 0o400)
                self.assertEqual(output.stat().st_nlink, 1)
                self.assertFalse(
                    (output.parent / f".{output.name}.publishing").exists()
                )

    def test_coherent_result_forgery_is_rejected_by_policy_rederivation(self) -> None:
        pack = make_pack("Learn with care.", "Learn with care.")
        adjudications = AUDITOR.AdjudicationSet(None, {})
        with tempfile.TemporaryDirectory() as directory:
            session = make_checkpoint_session(Path(directory).resolve(), (pack,))
            checkpoint = AUDITOR.build_pack_checkpoint(
                session,
                session.plans[0],
                fake_models(),
                adjudications,
                None,
            )
            self.assertTrue(checkpoint_failure_codes(checkpoint))
            forged = copy.deepcopy(checkpoint)
            forged["fieldEvidenceRows"][0][2] = []
            forged["fieldEvidenceRows"][0][4] = []
            forged["packBinding"]["fieldEvidenceRootSha256"] = (
                AUDITOR.sha256_canonical(forged["fieldEvidenceRows"])
            )
            forged["packBinding"]["unadjudicatedFields"] = 0
            forged["counts"]["unadjudicatedFields"] = 0
            forged["counts"]["unadjudicatedFailures"] = 0
            forged["failureRecords"] = {
                "records": [],
                "codeCounts": {},
                "adjudicatedCodeCounts": {},
            }
            forged_material = dict(forged)
            del forged_material["checkpointSha256"]
            forged["checkpointSha256"] = AUDITOR.sha256_canonical(
                forged_material
            )
            with self.assertRaisesRegex(
                AUDITOR.AuditContractError,
                "failures drifted from policy-derived evidence",
            ):
                AUDITOR.validate_pack_checkpoint(
                    forged,
                    session,
                    session.plans[0],
                    adjudications,
                    None,
                )

    def test_bool_integer_and_chain_forgery_fail_closed(self) -> None:
        packs = (
            make_pack(
                "Start learning now.",
                "Begin nou leer.",
                namespace="route:first",
            ),
            make_pack(
                "Keep learning now.",
                "Hou nou aan leer.",
                namespace="route:second",
            ),
        )
        adjudications = AUDITOR.AdjudicationSet(None, {})
        with tempfile.TemporaryDirectory() as directory:
            session = make_checkpoint_session(Path(directory).resolve(), packs)
            first = AUDITOR.build_pack_checkpoint(
                session, session.plans[0], fake_models(), adjudications, None
            )
            forged_bool = copy.deepcopy(first)
            forged_bool["ordinal"] = True
            bool_material = dict(forged_bool)
            del bool_material["checkpointSha256"]
            forged_bool["checkpointSha256"] = AUDITOR.sha256_canonical(
                bool_material
            )
            with self.assertRaisesRegex(
                AUDITOR.AuditContractError, "bounded non-negative integer"
            ):
                AUDITOR.validate_pack_checkpoint(
                    forged_bool,
                    session,
                    session.plans[0],
                    adjudications,
                    None,
                )

            first_sha = first["checkpointSha256"]
            second = AUDITOR.build_pack_checkpoint(
                session,
                session.plans[1],
                fake_models(),
                adjudications,
                first_sha,
            )
            forged_chain = copy.deepcopy(second)
            forged_chain["previousCheckpointSha256"] = "0" * 64
            chain_material = dict(forged_chain)
            del chain_material["checkpointSha256"]
            forged_chain["checkpointSha256"] = AUDITOR.sha256_canonical(
                chain_material
            )
            with self.assertRaisesRegex(
                AUDITOR.AuditContractError, "mixed or stale session"
            ):
                AUDITOR.validate_pack_checkpoint(
                    forged_chain,
                    session,
                    session.plans[1],
                    adjudications,
                    first_sha,
                )

    def test_mixed_session_unknown_resource_and_hardlink_fail_closed(self) -> None:
        packs = (
            make_pack(
                "Start learning now.",
                "Begin nou leer.",
                namespace="route:first",
            ),
            make_pack(
                "Keep learning now.",
                "Hou nou aan leer.",
                namespace="route:second",
            ),
        )
        adjudications = AUDITOR.AdjudicationSet(None, {})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            session = AUDITOR.prepare_checkpoint_session(
                make_checkpoint_session(root, packs)
            )
            mixed = make_checkpoint_session(root, tuple(reversed(packs)))
            with self.assertRaisesRegex(
                AUDITOR.AuditContractError, "different session"
            ):
                AUDITOR.prepare_checkpoint_session(mixed)

            checkpoint = AUDITOR.build_pack_checkpoint(
                session,
                session.plans[0],
                fake_models(),
                adjudications,
                None,
            )
            final_path = AUDITOR.publish_pack_checkpoint(
                session, session.plans[0], checkpoint
            )
            unknown = session.root / "unexpected-resource"
            unknown.write_text("x", encoding="utf-8")
            with self.assertRaisesRegex(
                AUDITOR.AuditContractError, "unknown resource"
            ):
                AUDITOR.scan_and_recover_checkpoints(session, adjudications)
            unknown.unlink()

            alias = root / "checkpoint-alias"
            os.link(final_path, alias)
            with self.assertRaisesRegex(
                AUDITOR.AuditContractError, "immutable regular file"
            ):
                AUDITOR.scan_and_recover_checkpoints(session, adjudications)

    def test_session_drift_matrix_rejects_before_models_or_new_checkpoints(self) -> None:
        pack = make_pack("Start learning now.", "Begin nou leer.")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            baseline = AUDITOR.prepare_checkpoint_session(
                make_checkpoint_session(root, (pack,))
            )
            baseline_trees = {
                "curated": AUDITOR.TreeSnapshot(True, "2" * 64, 0, 0, ()),
                "staticMainApp": AUDITOR.TreeSnapshot(True, "9" * 64, 0, 0, ()),
                "candidates": AUDITOR.TreeSnapshot(True, "3" * 64, 0, 0, ()),
                "packWorklists": AUDITOR.TreeSnapshot(True, "4" * 64, 0, 0, ()),
            }
            base_evidence = fake_models().evidence
            model_drift = AUDITOR.dataclasses.replace(
                base_evidence,
                model_lock_sha256="0" * 64,
                fasttext_sha256="9" * 64,
            )
            runtime_drift = AUDITOR.dataclasses.replace(
                base_evidence,
                model_lock_sha256="1" * 64,
                runtime_versions={"fake": "2"},
            )

            def tree_drift(name: str) -> Mapping[str, AUDITOR.TreeSnapshot]:
                result = dict(baseline_trees)
                result[name] = AUDITOR.TreeSnapshot(
                    True, "9" * 64, 1, 1, (("drift.json", 1, 1, 1, 1),)
                )
                return result

            output_drift = make_checkpoint_session(
                root, (pack,), output_name="alternate/semantic-audit.json"
            )
            output_drift = AUDITOR.dataclasses.replace(
                output_drift, root=baseline.root
            )
            variants = {
                "master-worklist": make_checkpoint_session(
                    root, (pack,), master_worklist_sha256="7" * 64
                ),
                "master-bytes": make_checkpoint_session(
                    root, (pack,), master_file_sha256="7" * 64
                ),
                "curated-tree": make_checkpoint_session(
                    root, (pack,), trees=tree_drift("curated")
                ),
                "static-main-app-tree": make_checkpoint_session(
                    root, (pack,), trees=tree_drift("staticMainApp")
                ),
                "candidate-tree": make_checkpoint_session(
                    root, (pack,), trees=tree_drift("candidates")
                ),
                "pack-worklist-tree": make_checkpoint_session(
                    root, (pack,), trees=tree_drift("packWorklists")
                ),
                "pack": make_checkpoint_session(
                    root,
                    (make_pack("Start learning now.", "Leer nou verder."),),
                ),
                "model": make_checkpoint_session(
                    root, (pack,), model_evidence=model_drift
                ),
                "runtime": make_checkpoint_session(
                    root, (pack,), model_evidence=runtime_drift
                ),
                "policy": make_checkpoint_session(
                    root, (pack,), audit_policy_sha256="7" * 64
                ),
                "code": make_checkpoint_session(
                    root, (pack,), implementation_sha256="7" * 64
                ),
                "output-path": output_drift,
            }
            with mock.patch.object(
                AUDITOR,
                "load_pinned_models",
                side_effect=AssertionError("session drift reached model construction"),
            ) as model_loader:
                for label, variant in variants.items():
                    with self.subTest(binding=label):
                        with self.assertRaisesRegex(
                            AUDITOR.AuditContractError, "different session"
                        ):
                            AUDITOR.prepare_checkpoint_session(variant)
                        self.assertEqual(
                            {entry.name for entry in baseline.root.iterdir()},
                            {"session.json"},
                        )
                model_loader.assert_not_called()

            drifted_profile = copy.deepcopy(AUDITOR.EXECUTION_PROFILE)
            drifted_profile["semanticDevice"] = "cpu"
            with self.assertRaisesRegex(
                AUDITOR.AuditContractError, "execution profile drifted"
            ):
                make_checkpoint_session(
                    root,
                    (pack,),
                    execution_profile=drifted_profile,
                )
            self.assertEqual(
                {entry.name for entry in baseline.root.iterdir()},
                {"session.json"},
            )

    def test_real_checkpoint_directory_nonprefix_shapes_fail_closed(self) -> None:
        packs = tuple(
            make_pack(
                "Start learning now.",
                "Begin nou leer.",
                namespace=f"route:prefix-{ordinal}",
                key=f"site.prefix.{ordinal}",
            )
            for ordinal in range(1, 4)
        )
        adjudications = AUDITOR.AdjudicationSet(None, {})

        def complete_chain(
            root: Path,
        ) -> tuple[
            AUDITOR.AuditCheckpointSession,
            list[Mapping[str, object]],
            list[Path],
        ]:
            session = AUDITOR.prepare_checkpoint_session(
                make_checkpoint_session(root, packs)
            )
            checkpoints: list[Mapping[str, object]] = []
            paths: list[Path] = []
            predecessor: str | None = None
            for plan in session.plans:
                checkpoint = AUDITOR.build_pack_checkpoint(
                    session,
                    plan,
                    fake_models(),
                    adjudications,
                    predecessor,
                )
                paths.append(
                    AUDITOR.publish_pack_checkpoint(session, plan, checkpoint)
                )
                checkpoints.append(checkpoint)
                predecessor = str(checkpoint["checkpointSha256"])
            return session, checkpoints, paths

        for scenario in (
            "missing-middle",
            "reordered-identities",
            "duplicate-final",
            "multiple-tails",
        ):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                if scenario == "multiple-tails":
                    session = AUDITOR.prepare_checkpoint_session(
                        make_checkpoint_session(root, packs)
                    )
                    for plan in session.plans[:2]:
                        tail = session.root / AUDITOR.checkpoint_temporary_basename(
                            plan
                        )
                        tail.touch(mode=0o600)
                        tail.chmod(0o600)
                    expected = "multiple crash tails"
                else:
                    session, checkpoints, paths = complete_chain(root)
                    if scenario == "missing-middle":
                        paths[1].unlink()
                        expected = "missing or reordered pack"
                    elif scenario == "reordered-identities":
                        staging = root / "checkpoint-swap-stage"
                        paths[0].rename(staging)
                        paths[1].rename(
                            session.root
                            / AUDITOR.checkpoint_final_basename(
                                session.plans[0],
                                str(checkpoints[1]["checkpointSha256"]),
                            )
                        )
                        staging.rename(
                            session.root
                            / AUDITOR.checkpoint_final_basename(
                                session.plans[1],
                                str(checkpoints[0]["checkpointSha256"]),
                            )
                        )
                        expected = "mixed or stale session"
                    else:
                        duplicate = session.root / AUDITOR.checkpoint_final_basename(
                            session.plans[0], "0" * 64
                        )
                        os.link(paths[0], duplicate)
                        expected = "duplicate pack checkpoints"
                with self.assertRaisesRegex(AUDITOR.AuditContractError, expected):
                    AUDITOR.scan_and_recover_checkpoints(
                        session, adjudications
                    )

    def test_checkpoint_execution_keeps_only_a_bounded_number_of_live_packs(self) -> None:
        total_packs = 48
        live_packs = 0
        maximum_live_packs = 0
        references: list[weakref.ReferenceType[object]] = []

        def track(
            pack: AUDITOR.TranslationPack,
        ) -> AUDITOR.TranslationPack:
            nonlocal live_packs, maximum_live_packs
            live_packs += 1
            maximum_live_packs = max(maximum_live_packs, live_packs)

            def released(_: weakref.ReferenceType[object]) -> None:
                nonlocal live_packs
                live_packs -= 1

            references.append(weakref.ref(pack, released))
            return pack

        def generated_pack(ordinal: int) -> AUDITOR.TranslationPack:
            return make_pack(
                "Explore a useful lesson calmly.",
                "Verken vandag 'n nuttige les rustig.",
                namespace=f"route:stream-{ordinal:03d}",
                key=f"site.stream.{ordinal:03d}",
            )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name in ("curated", "static-main-app", "candidates", "worklists"):
                (root / name).mkdir()
            inputs = AUDITOR.AuditInputs(
                root=root,
                master_worklist=root / "master.json",
                curated_root=root / "curated",
                static_main_app_root=root / "static-main-app",
                candidate_root=root / "candidates",
                pack_worklist_root=root / "worklists",
                output=root / "semantic-audit.json",
                adjudications=None,
            )
            expectations = AUDITOR.AuditExpectations(
                "streaming-fixture", ("af",), total_packs, total_packs
            )
            trees = {
                "curated": AUDITOR.TreeSnapshot(True, "2" * 64, 0, 0, ()),
                "staticMainApp": AUDITOR.TreeSnapshot(True, "9" * 64, 0, 0, ()),
                "candidates": AUDITOR.TreeSnapshot(True, "3" * 64, 0, 0, ()),
                "packWorklists": AUDITOR.TreeSnapshot(True, "4" * 64, 0, 0, ()),
            }
            session = AUDITOR.create_checkpoint_session(
                inputs,
                expectations,
                (
                    track(generated_pack(index))
                    for index in range(1, total_packs + 1)
                ),
                lambda plan: track(generated_pack(plan.ordinal)),
                (),
                total_packs,
                AUDITOR.sha256_canonical(AUDITOR.AUDIT_POLICY),
                "8" * 64,
                fake_models().evidence,
                "5" * 64,
                "6" * 64,
                trees,
                AUDITOR.AdjudicationSet(None, {}),
                AUDITOR.EXECUTION_PROFILE,
                AUDITOR.GENERATOR_EXECUTION_PROFILE,
            )
            gc.collect()
            self.assertEqual(live_packs, 0)
            self.assertLessEqual(maximum_live_packs, 2)

            maximum_live_packs = 0
            session = AUDITOR.prepare_checkpoint_session(session)
            result = AUDITOR.audit_translation_packs_with_checkpoints(
                session,
                fake_models(),
                AUDITOR.AdjudicationSet(None, {}),
            )
            gc.collect()
            self.assertEqual(result["counts"]["fields"], total_packs)
            self.assertEqual(live_packs, 0)
            self.assertLessEqual(maximum_live_packs, 3)
            self.assertTrue(references)

    def test_execution_profile_drift_and_concurrent_lock_fail_closed(self) -> None:
        pack = make_pack("Start learning now.", "Begin nou leer.")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            session = make_checkpoint_session(root, (pack,))
            drifted_profile = copy.deepcopy(AUDITOR.EXECUTION_PROFILE)
            drifted_profile["semanticDevice"] = "cpu"
            with self.assertRaisesRegex(
                AUDITOR.AuditContractError, "execution profile drifted"
            ):
                AUDITOR.create_checkpoint_session(
                    AUDITOR.AuditInputs(
                        root=root,
                        master_worklist=root / "master.json",
                        curated_root=root / "curated",
                        static_main_app_root=root / "static-main-app",
                        candidate_root=root / "candidates",
                        pack_worklist_root=root / "worklists",
                        output=root / "other.json",
                        adjudications=None,
                    ),
                    AUDITOR.AuditExpectations("fixture", ("af",), 1, 1),
                    (pack,),
                    lambda plan: pack,
                    (),
                    1,
                    AUDITOR.sha256_canonical(AUDITOR.AUDIT_POLICY),
                    "8" * 64,
                    fake_models().evidence,
                    "5" * 64,
                    "6" * 64,
                    {
                        "curated": AUDITOR.TreeSnapshot(True, "2" * 64, 0, 0, ()),
                        "candidates": AUDITOR.TreeSnapshot(True, "3" * 64, 0, 0, ()),
                        "packWorklists": AUDITOR.TreeSnapshot(True, "4" * 64, 0, 0, ()),
                    },
                    AUDITOR.AdjudicationSet(None, {}),
                    drifted_profile,
                    AUDITOR.GENERATOR_EXECUTION_PROFILE,
                )

            lock_path = root / "semantic-audit.lock"
            with AUDITOR.ExclusiveAuditRunLock(lock_path):
                with self.assertRaisesRegex(
                    AUDITOR.AuditContractError, "already running"
                ):
                    with AUDITOR.ExclusiveAuditRunLock(lock_path):
                        self.fail("Concurrent lock unexpectedly succeeded")
            with AUDITOR.ExclusiveAuditRunLock(lock_path):
                pass
            self.assertEqual(session.root.parent, root)


class AfrikaansPackContextCalibrationTests(unittest.TestCase):
    @staticmethod
    def predictions(
        *values: tuple[str, float],
    ) -> tuple[AUDITOR.LanguagePrediction, ...]:
        return tuple(AUDITOR.LanguagePrediction(*value) for value in values)

    @staticmethod
    def eligible_pack(
        *,
        hard_failure: bool = False,
        origin: str = "candidate",
        namespace: str = "route:calibration",
    ) -> AUDITOR.TranslationPack:
        source_entries: list[AUDITOR.SourceEntry] = []
        pack_entries: list[AUDITOR.PackEntry] = []
        for index in range(20):
            suffix = f"{chr(97 + index // 26)}{chr(97 + index % 26)}"
            source = (
                "Explore thoughtful lessons through calm creative practice "
                f"for topic {suffix}."
            )
            value = (
                "Ontdek betekenisvolle leerervarings deur rustige kreatiewe "
                "oefening met nuttige idees vir elke interessante onderwerp "
                f"{suffix}."
            )
            if hard_failure and index == 0:
                source = f"Welcome {{name}} to thoughtful topic {suffix}."
            source_entry = AUDITOR.SourceEntry(
                key=f"site.calibration.{suffix}",
                source=source,
                source_sha256=AUDITOR.sha256_text(source),
                text_segments=(source,),
                literal_segments=(),
            )
            source_entries.append(source_entry)
            pack_entries.append(AUDITOR.PackEntry(source_entry, value))
        source_pack = AUDITOR.SourcePack(
            namespace=namespace,
            source_hash="e" * 64,
            source_entries_sha256=AUDITOR.sha256_canonical(
                [
                    [entry.key, entry.source_sha256]
                    for entry in source_entries
                ]
            ),
            entries=tuple(source_entries),
        )
        return AUDITOR.TranslationPack(
            locale="af",
            language="Afrikaans",
            source=source_pack,
            origin=origin,
            path=Path("af/route__calibration.json"),
            file_sha256="1" * 64,
            entries=tuple(pack_entries),
        )

    def build_eligible_checkpoint(
        self,
        *,
        hard_failure: bool = False,
        origin: str = "candidate",
        pack_predictions: tuple[tuple[str, float], ...] = (
            ("af", 0.55),
            ("nl", 0.20),
            ("en", 0.10),
        ),
    ) -> tuple[Mapping[str, object], AUDITOR.AuditCheckpointSession]:
        pack = self.eligible_pack(
            hard_failure=hard_failure,
            origin=origin,
        )
        language = ScriptedLanguageDetector(
            (
                (("af", 0.40), ("nl", 0.30), ("en", 0.20)),
                (("af", 0.80), ("nl", 0.10), ("en", 0.05)),
                pack_predictions,
            )
        )
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        session = make_checkpoint_session(
            Path(temporary.name).resolve(),
            (pack,),
        )
        checkpoint = AUDITOR.build_pack_checkpoint(
            session,
            session.plans[0],
            fake_models(language=language),
            AUDITOR.AdjudicationSet(None, {}),
            None,
        )
        return checkpoint, session

    @staticmethod
    def clone_eligible_pack(
        pack: AUDITOR.TranslationPack,
        *,
        namespace: str,
        origin: str,
        value_suffix: str = "",
    ) -> AUDITOR.TranslationPack:
        source_pack = dataclasses.replace(
            pack.source,
            namespace=namespace,
        )
        entries = tuple(
            AUDITOR.PackEntry(
                source=source_entry,
                value=f"{pack.entries[index].value}{value_suffix}",
            )
            for index, source_entry in enumerate(source_pack.entries)
        )
        return dataclasses.replace(
            pack,
            source=source_pack,
            origin=origin,
            path=Path(f"af/{namespace.replace(':', '__')}.json"),
            file_sha256=AUDITOR.sha256_text(
                f"{namespace}\0{origin}\0{value_suffix}"
            ),
            entries=entries,
        )

    @staticmethod
    def tracked_candidate_models(
        *,
        semantic_score: float = 0.96,
        field_predictions: tuple[tuple[str, float], ...] = (
            ("af", 0.40),
            ("fr", 0.31),
            ("nl", 0.29),
        ),
    ) -> AUDITOR.AuditModels:
        return fake_models(
            language=ScriptedLanguageDetector(
                (
                    field_predictions,
                    (("af", 0.80), ("nl", 0.10), ("en", 0.05)),
                    (("af", 0.55), ("nl", 0.20), ("en", 0.10)),
                )
            ),
            semantic=FakeSemanticScorer(default=semantic_score),
        )

    def test_context_normalization_is_canonical_distinct_and_lexical(self) -> None:
        context = AUDITOR.canonical_afrikaans_pack_context(
            (
                "  Zebra\tWOORD  ",
                "zebra woord",
                "Straße",
                "STRASSE",
                "ＡＢＣ   DEF",
                "",
                "   ",
            )
        )
        self.assertEqual(context.text, "abc def strasse zebra woord")
        self.assertEqual(context.distinct_masked_values, 3)
        self.assertEqual(context.masked_letters, 23)
        self.assertEqual(context.sha256, AUDITOR.sha256_text(context.text))

    def test_pack_gate_uses_raw_inclusive_boundaries_and_rejects_dutch_top1(self) -> None:
        eligible = AUDITOR.AfrikaansPackContext("fixture", "a" * 64, 20, 1_000)
        self.assertTrue(
            AUDITOR.afrikaans_pack_context_gate(
                eligible,
                self.predictions(("af", 0.55), ("nl", 0.20), ("en", 0.10)),
            )
        )
        for context, predictions in (
            (
                eligible,
                self.predictions(
                    ("af", 0.5499999), ("nl", 0.2000001), ("en", 0.10)
                ),
            ),
            (
                eligible,
                self.predictions(
                    ("af", 0.55), ("nl", 0.1999999), ("en", 0.10)
                ),
            ),
            (
                eligible,
                self.predictions(("nl", 0.56), ("af", 0.40), ("en", 0.02)),
            ),
            (
                AUDITOR.AfrikaansPackContext("fixture", "a" * 64, 19, 1_000),
                self.predictions(("af", 0.60), ("nl", 0.20), ("en", 0.10)),
            ),
            (
                AUDITOR.AfrikaansPackContext("fixture", "a" * 64, 20, 999),
                self.predictions(("af", 0.60), ("nl", 0.20), ("en", 0.10)),
            ),
        ):
            with self.subTest(context=context, predictions=predictions):
                self.assertFalse(
                    AUDITOR.afrikaans_pack_context_gate(context, predictions)
                )

    def test_field_rescue_is_raw_af_nl_only_and_failure_isolated(self) -> None:
        boundary = self.predictions(
            ("af", 0.40), ("nl", 0.30), ("en", 0.30)
        )
        self.assertTrue(
            AUDITOR.should_rescue_afrikaans_field(
                "af",
                "candidate",
                {"language-target-low-confidence"},
                boundary,
                True,
            )
        )
        self.assertTrue(
            AUDITOR.should_rescue_afrikaans_field(
                "af",
                "candidate",
                {"language-target-low-confidence"},
                self.predictions(("nl", 0.40), ("af", 0.30), ("en", 0.20)),
                True,
            )
        )
        rejected = (
            (
                "af",
                {"language-target-low-confidence"},
                self.predictions(
                    ("af", 0.3999999), ("nl", 0.30), ("en", 0.30)
                ),
                True,
            ),
            (
                "af",
                {"language-target-low-confidence"},
                self.predictions(
                    ("af", 0.36), ("nl", 0.35), ("en", 0.3000001)
                ),
                True,
            ),
            (
                "af",
                {"language-target-low-confidence"},
                self.predictions(("af", 0.40), ("en", 0.31), ("nl", 0.30)),
                True,
            ),
            ("nl", {"language-target-low-confidence"}, boundary, True),
            ("de", {"language-target-low-confidence"}, boundary, True),
            ("af", {"language-target-low-confidence"}, boundary, False),
            (
                "af",
                {"language-target-low-confidence", "mixed-english"},
                boundary,
                True,
            ),
            (
                "af",
                {"language-target-low-confidence", "semantic-adequacy-low"},
                boundary,
                True,
            ),
            (
                "af",
                {"language-target-low-confidence", "placeholder-parity"},
                boundary,
                True,
            ),
        )
        for locale, failures, predictions, gate in rejected:
            with self.subTest(
                locale=locale,
                failures=failures,
                predictions=predictions,
                gate=gate,
            ):
                self.assertFalse(
                    AUDITOR.should_rescue_afrikaans_field(
                        locale,
                        "candidate",
                        failures,
                        predictions,
                        gate,
                    )
                )

    def test_eligible_checkpoint_rescues_only_isolated_language_failures(self) -> None:
        checkpoint, _ = self.build_eligible_checkpoint()
        binding = checkpoint["packBinding"]
        assert isinstance(binding, Mapping)
        context = binding["afrikaansPackContext"]
        assert isinstance(context, Mapping)
        self.assertEqual(context["distinctMaskedValues"], 20)
        self.assertGreaterEqual(context["maskedLetters"], 1_000)
        self.assertIs(context["eligible"], True)
        self.assertIs(context["gatePassed"], True)
        self.assertEqual(context["rescuedFields"], 20)
        for row in checkpoint["fieldEvidenceRows"]:
            self.assertEqual(row[1]["afrikaansRescueKind"], "field-pair")
            self.assertIsNone(row[1]["supportPairIdentity"])
            self.assertEqual(row[2], [])
            self.assertEqual(row[4], [])

        hard_checkpoint, _ = self.build_eligible_checkpoint(hard_failure=True)
        hard_row = hard_checkpoint["fieldEvidenceRows"][0]
        self.assertEqual(hard_row[1]["afrikaansRescueKind"], "none")
        self.assertIn("language-target-low-confidence", hard_row[2])
        self.assertIn("placeholder-parity", hard_row[2])
        hard_binding = hard_checkpoint["packBinding"]
        assert isinstance(hard_binding, Mapping)
        hard_context = hard_binding["afrikaansPackContext"]
        assert isinstance(hard_context, Mapping)
        self.assertEqual(hard_context["rescuedFields"], 19)

    def test_curated_pack_keeps_field_pair_rescue_but_never_tracked_rescue(
        self,
    ) -> None:
        curated_checkpoint, _ = self.build_eligible_checkpoint(
            origin="curated"
        )
        for row in curated_checkpoint["fieldEvidenceRows"]:
            self.assertEqual(row[1]["afrikaansRescueKind"], "field-pair")
            self.assertIsNone(row[1]["supportPairIdentity"])
            self.assertEqual(row[2], [])

        reference = self.eligible_pack(
            origin="curated",
            namespace="route:tracked-reference",
        )
        catalog = AUDITOR.derive_tracked_afrikaans_reference_catalog(
            (reference,),
            "a" * 64,
            detector=FakeLanguageDetector(),
        )
        curated = self.eligible_pack(origin="curated")
        detector = ScriptedLanguageDetector(
            (
                (("af", 0.40), ("fr", 0.31), ("nl", 0.29)),
                (("af", 0.80), ("nl", 0.10), ("en", 0.05)),
                (("af", 0.55), ("nl", 0.20), ("en", 0.10)),
            )
        )
        result = AUDITOR.audit_translation_packs(
            (curated,),
            fake_models(language=detector),
            AUDITOR.AdjudicationSet(None, {}),
            checkpoint_details=True,
            tracked_reference_catalog=catalog,
        )
        details = result["_checkpointDetails"]
        self.assertIsInstance(details, Mapping)
        rows = details["fieldEvidenceRows"]
        self.assertEqual(len(rows), 20)
        for row in rows:
            self.assertEqual(row[1]["afrikaansRescueKind"], "none")
            self.assertIsNone(row[1]["supportPairIdentity"])
            self.assertEqual(row[2], ["language-target-low-confidence"])

    def test_tracked_curated_exact_candidate_support_and_precedence(self) -> None:
        base = self.eligible_pack()
        reference = self.clone_eligible_pack(
            base,
            namespace="route:tracked-reference",
            origin="curated",
        )
        catalog = AUDITOR.derive_tracked_afrikaans_reference_catalog(
            (reference,),
            "b" * 64,
            detector=FakeLanguageDetector(),
        )
        candidate = self.clone_eligible_pack(
            base,
            namespace="route:tracked-candidate",
            origin="candidate",
        )
        result = AUDITOR.audit_translation_packs(
            (candidate,),
            self.tracked_candidate_models(),
            AUDITOR.AdjudicationSet(None, {}),
            checkpoint_details=True,
            tracked_reference_catalog=catalog,
        )
        details = result["_checkpointDetails"]
        rows = details["fieldEvidenceRows"]
        self.assertEqual(len(rows), 20)
        for row in rows:
            self.assertEqual(row[1]["afrikaansRescueKind"], "tracked-curated")
            self.assertRegex(row[1]["supportPairIdentity"], r"^[a-f0-9]{64}$")
            self.assertEqual(row[2], [])
        binding = result["packBindings"][0]
        context = binding["afrikaansPackContext"]
        self.assertEqual(context["referenceMatchFields"], 20)
        self.assertEqual(context["trackedCuratedRescuedFields"], 20)
        self.assertEqual(context["fieldPairRescuedFields"], 0)
        self.assertEqual(
            result["afrikaansTrackedCurated"]["trackedCuratedRescuedFields"],
            20,
        )

        precedence = AUDITOR.audit_translation_packs(
            (candidate,),
            self.tracked_candidate_models(
                field_predictions=(
                    ("af", 0.40),
                    ("nl", 0.30),
                    ("en", 0.20),
                )
            ),
            AUDITOR.AdjudicationSet(None, {}),
            checkpoint_details=True,
            tracked_reference_catalog=catalog,
        )
        precedence_rows = precedence["_checkpointDetails"][
            "fieldEvidenceRows"
        ]
        self.assertTrue(
            all(
                row[1]["afrikaansRescueKind"] == "field-pair"
                and row[1]["supportPairIdentity"] is not None
                for row in precedence_rows
            )
        )
        precedence_context = precedence["packBindings"][0][
            "afrikaansPackContext"
        ]
        self.assertEqual(precedence_context["fieldPairRescuedFields"], 20)
        self.assertEqual(precedence_context["trackedCuratedRescuedFields"], 0)
        self.assertEqual(precedence_context["referenceMatchFields"], 20)

    def test_tracked_checkpoint_binds_reason_support_catalog_and_roots(
        self,
    ) -> None:
        base = self.eligible_pack()
        reference = self.clone_eligible_pack(
            base,
            namespace="route:checkpoint-reference",
            origin="curated",
        )
        candidate = self.clone_eligible_pack(
            base,
            namespace="route:checkpoint-candidate",
            origin="candidate",
        )
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        session = make_checkpoint_session(
            Path(temporary.name).resolve(),
            (candidate,),
            tracked_references=(reference,),
        )
        catalog = AUDITOR.derive_tracked_afrikaans_reference_catalog(
            (reference,),
            session.sha256,
            detector=FakeLanguageDetector(),
        )
        checkpoint = AUDITOR.build_pack_checkpoint(
            session,
            session.plans[0],
            self.tracked_candidate_models(),
            AUDITOR.AdjudicationSet(None, {}),
            None,
            catalog,
        )
        for row in checkpoint["fieldEvidenceRows"]:
            self.assertEqual(row[1]["afrikaansRescueKind"], "tracked-curated")
            self.assertRegex(row[1]["supportPairIdentity"], r"^[a-f0-9]{64}$")

        def rehash(value: dict[str, object]) -> None:
            material = dict(value)
            material.pop("checkpointSha256")
            value["checkpointSha256"] = AUDITOR.sha256_canonical(material)

        catalog_tamper = copy.deepcopy(checkpoint)
        catalog_tamper["trackedAfrikaansReferences"][
            "supportPairRootSha256"
        ] = "a" * 64
        rehash(catalog_tamper)
        with self.assertRaisesRegex(
            AUDITOR.AuditContractError,
            "support/conflict evidence",
        ):
            AUDITOR.validate_pack_checkpoint(
                catalog_tamper,
                session,
                session.plans[0],
                AUDITOR.AdjudicationSet(None, {}),
                None,
            )

        support_tamper = copy.deepcopy(checkpoint)
        support_tamper["fieldEvidenceRows"][0][1][
            "supportPairIdentity"
        ] = "b" * 64
        support_tamper["packBinding"]["fieldEvidenceRootSha256"] = (
            AUDITOR.sha256_canonical(support_tamper["fieldEvidenceRows"])
        )
        rehash(support_tamper)
        with self.assertRaisesRegex(
            AUDITOR.AuditContractError,
            "support-pair identity",
        ):
            AUDITOR.validate_pack_checkpoint(
                support_tamper,
                session,
                session.plans[0],
                AUDITOR.AdjudicationSet(None, {}),
                None,
            )

        forged_reference = self.clone_eligible_pack(
            reference,
            namespace=reference.source.namespace,
            origin="curated",
            value_suffix=" changed",
        )
        forged_session = dataclasses.replace(
            session,
            tracked_afrikaans_reference_packs=(forged_reference,),
        )
        with self.assertRaisesRegex(
            AUDITOR.AuditContractError,
            "reference pack evidence|support/conflict evidence",
        ):
            AUDITOR.validate_pack_checkpoint(
                checkpoint,
                forged_session,
                forged_session.plans[0],
                AUDITOR.AdjudicationSet(None, {}),
                None,
            )

    def test_tracked_curated_conflicts_gates_and_exact_bytes_fail_closed(
        self,
    ) -> None:
        base = self.eligible_pack()
        references = tuple(
            self.clone_eligible_pack(
                base,
                namespace=f"route:reference-{index:02d}",
                origin="curated",
                value_suffix="" if index % 2 == 0 else " alternatief",
            )
            for index in range(14)
        )
        conflicted = AUDITOR.derive_tracked_afrikaans_reference_catalog(
            references,
            "c" * 64,
            detector=FakeLanguageDetector(),
        )
        self.assertEqual(conflicted.evidence["conflictSourceCount"], 20)
        self.assertEqual(conflicted.evidence["supportPairCount"], 0)
        candidate = self.clone_eligible_pack(
            base,
            namespace="route:candidate",
            origin="candidate",
        )
        self.assertIsNone(
            AUDITOR.tracked_support_pair_for_field(
                candidate,
                candidate.entries[0],
                conflicted,
            )
        )

        no_gate_reference = self.clone_eligible_pack(
            base,
            namespace="route:no-gate",
            origin="curated",
        )
        no_gate = AUDITOR.derive_tracked_afrikaans_reference_catalog(
            (no_gate_reference,),
            "d" * 64,
            detector=ScriptedLanguageDetector(
                ((("nl", 0.60), ("af", 0.20), ("en", 0.10)),)
            ),
        )
        self.assertEqual(no_gate.evidence["supportPairCount"], 0)
        self.assertFalse(no_gate.evidence["referencePacks"][0]["gatePassed"])

        dutch = dataclasses.replace(
            no_gate_reference,
            locale="nl",
            language="Dutch",
        )
        with self.assertRaisesRegex(
            AUDITOR.AuditContractError,
            "Afrikaans references",
        ):
            AUDITOR.derive_tracked_afrikaans_reference_catalog(
                (dutch,),
                "e" * 64,
                detector=FakeLanguageDetector(),
            )

        supported = AUDITOR.derive_tracked_afrikaans_reference_catalog(
            (no_gate_reference,),
            "f" * 64,
            detector=FakeLanguageDetector(),
        )
        original_entry = candidate.entries[0]
        source_mismatch = dataclasses.replace(
            original_entry.source,
            source=f"{original_entry.source.source} changed",
            source_sha256=AUDITOR.sha256_text(
                f"{original_entry.source.source} changed"
            ),
            text_segments=(f"{original_entry.source.source} changed",),
        )
        mismatches = (
            AUDITOR.PackEntry(source_mismatch, original_entry.value),
            AUDITOR.PackEntry(
                dataclasses.replace(
                    original_entry.source,
                    source_sha256="0" * 64,
                ),
                original_entry.value,
            ),
            AUDITOR.PackEntry(
                original_entry.source,
                f"{original_entry.value} changed",
            ),
        )
        for mismatch in mismatches:
            with self.subTest(mismatch=mismatch):
                self.assertIsNone(
                    AUDITOR.tracked_support_pair_for_field(
                        candidate,
                        mismatch,
                        supported,
                    )
                )

        second_reference = self.clone_eligible_pack(
            base,
            namespace="route:collision",
            origin="curated",
        )
        changed_source = dataclasses.replace(
            second_reference.source.entries[0],
            source=f"{second_reference.source.entries[0].source} collision",
            text_segments=(
                f"{second_reference.source.entries[0].source} collision",
            ),
        )
        collision_source_pack = dataclasses.replace(
            second_reference.source,
            entries=(changed_source, *second_reference.source.entries[1:]),
        )
        collision_pack = dataclasses.replace(
            second_reference,
            source=collision_source_pack,
            entries=(
                AUDITOR.PackEntry(
                    changed_source,
                    second_reference.entries[0].value,
                ),
                *second_reference.entries[1:],
            ),
        )
        with self.assertRaisesRegex(
            AUDITOR.AuditContractError,
            "source-hash collision",
        ):
            AUDITOR.derive_tracked_afrikaans_reference_catalog(
                (no_gate_reference, collision_pack),
                "1" * 64,
                detector=FakeLanguageDetector(),
            )

    def test_tracked_curated_does_not_mask_hard_or_semantic_failures(self) -> None:
        hard_base = self.eligible_pack(hard_failure=True)
        reference = self.clone_eligible_pack(
            hard_base,
            namespace="route:hard-reference",
            origin="curated",
        )
        catalog = AUDITOR.derive_tracked_afrikaans_reference_catalog(
            (reference,),
            "2" * 64,
            detector=FakeLanguageDetector(),
        )
        candidate = self.clone_eligible_pack(
            hard_base,
            namespace="route:hard-candidate",
            origin="candidate",
        )
        hard_result = AUDITOR.audit_translation_packs(
            (candidate,),
            self.tracked_candidate_models(),
            AUDITOR.AdjudicationSet(None, {}),
            checkpoint_details=True,
            tracked_reference_catalog=catalog,
        )
        hard_rows = hard_result["_checkpointDetails"]["fieldEvidenceRows"]
        self.assertEqual(hard_rows[0][1]["afrikaansRescueKind"], "none")
        self.assertIn("placeholder-parity", hard_rows[0][2])
        self.assertIn("language-target-low-confidence", hard_rows[0][2])

        semantic_result = AUDITOR.audit_translation_packs(
            (candidate,),
            self.tracked_candidate_models(semantic_score=0.40),
            AUDITOR.AdjudicationSet(None, {}),
            checkpoint_details=True,
            tracked_reference_catalog=catalog,
        )
        for row in semantic_result["_checkpointDetails"][
            "fieldEvidenceRows"
        ]:
            self.assertEqual(row[1]["afrikaansRescueKind"], "none")
            self.assertIn("semantic-adequacy-low", row[2])
            self.assertIn("language-target-low-confidence", row[2])

    def test_checkpoint_rejects_context_gate_and_field_rescue_tampering(self) -> None:
        checkpoint, session = self.build_eligible_checkpoint()
        mutations = (
            ("context hash", lambda value: value["packBinding"][
                "afrikaansPackContext"
            ].__setitem__("contextSha256", "b" * 64)),
            ("pack gate", lambda value: value["packBinding"][
                "afrikaansPackContext"
            ].__setitem__("gatePassed", False)),
            ("rescued count", lambda value: value["packBinding"][
                "afrikaansPackContext"
            ].__setitem__("rescuedFields", 19)),
            ("field rescue", lambda value: value["fieldEvidenceRows"][0][1].__setitem__(
                "afrikaansRescueKind", "none"
            )),
        )
        for label, mutate in mutations:
            with self.subTest(label=label):
                forged = copy.deepcopy(checkpoint)
                mutate(forged)
                material = dict(forged)
                material.pop("checkpointSha256")
                forged["checkpointSha256"] = AUDITOR.sha256_canonical(material)
                with self.assertRaisesRegex(
                    AUDITOR.AuditContractError,
                    "Afrikaans|field evidence root",
                ):
                    AUDITOR.validate_pack_checkpoint(
                        forged,
                        session,
                        session.plans[0],
                        AUDITOR.AdjudicationSet(None, {}),
                        None,
                    )


class CheckpointRawThresholdTests(unittest.TestCase):
    def build_checkpoint(
        self,
        pack: AUDITOR.TranslationPack,
        models: AUDITOR.AuditModels,
    ) -> Mapping[str, object]:
        with tempfile.TemporaryDirectory() as directory:
            session = make_checkpoint_session(Path(directory).resolve(), (pack,))
            return AUDITOR.build_pack_checkpoint(
                session,
                session.plans[0],
                models,
                AUDITOR.AdjudicationSet(None, {}),
                None,
            )

    @staticmethod
    def language_models(
        *,
        target_probability: float = 0.96,
        english_probability: float = 0.02,
        chunk_target_probability: float = 0.96,
        chunk_english_probability: float = 0.02,
        semantic_scores: Sequence[float] = (0.96,),
        backtranslations: Mapping[str, str] | None = None,
    ) -> AUDITOR.AuditModels:
        language = ScriptedLanguageDetector(
            (
                (
                    ("af", target_probability),
                    ("en", english_probability),
                ),
                (
                    ("af", chunk_target_probability),
                    ("en", chunk_english_probability),
                ),
            )
        )
        return fake_models(
            language=language,
            semantic=SequencedSemanticScorer(semantic_scores),
            backtranslator=FakeBacktranslator(backtranslations),
        )

    def test_raw_whole_language_thresholds_are_not_decided_from_rounded_scores(self) -> None:
        pack = make_pack(
            "Start learning carefully now.",
            "Begin vandag rustig leer.",
        )
        target_cases = (
            (0.5499997, True),
            (0.55, False),
            (0.5500003, False),
        )
        for probability, expected_failure in target_cases:
            with self.subTest(target_probability=probability):
                checkpoint = self.build_checkpoint(
                    pack,
                    self.language_models(target_probability=probability),
                )
                self.assertEqual(
                    "language-target-low-confidence"
                    in checkpoint_failure_codes(checkpoint),
                    expected_failure,
                )
                if probability != 0.55:
                    self.assertEqual(
                        checkpoint["fieldEvidenceRows"][0][1][
                            "targetLanguageProbability"
                        ],
                        0.55,
                    )

        english_cases = (
            (0.2999997, False),
            (0.3, False),
            (0.3000003, True),
        )
        for probability, expected_failure in english_cases:
            with self.subTest(english_probability=probability):
                checkpoint = self.build_checkpoint(
                    pack,
                    self.language_models(english_probability=probability),
                )
                self.assertEqual(
                    "mixed-english" in checkpoint_failure_codes(checkpoint),
                    expected_failure,
                )
                if probability != 0.3:
                    self.assertEqual(
                        checkpoint["fieldEvidenceRows"][0][1][
                            "englishProbability"
                        ],
                        0.3,
                    )

    def test_raw_short_text_target_threshold_uses_point_35_without_rounding(self) -> None:
        pack = make_pack("Learn now.", "Leer nou.")
        for probability, expected_failure in (
            (0.3499997, True),
            (0.35, False),
            (0.3500003, False),
        ):
            with self.subTest(target_probability=probability):
                checkpoint = self.build_checkpoint(
                    pack,
                    self.language_models(target_probability=probability),
                )
                self.assertEqual(
                    "language-target-low-confidence"
                    in checkpoint_failure_codes(checkpoint),
                    expected_failure,
                )
                if probability != 0.35:
                    self.assertEqual(
                        checkpoint["fieldEvidenceRows"][0][1][
                            "targetLanguageProbability"
                        ],
                        0.35,
                    )

    def test_raw_mixed_chunk_thresholds_use_exact_two_factor_boundary(self) -> None:
        pack = make_pack(
            "Start learning carefully now.",
            "Begin vandag rustig leer.",
        )
        cases = (
            (0.5499997, 0.3499997, False),
            (0.5499997, 0.35, True),
            (0.55, 0.3500003, False),
        )
        for target, english, expected_failure in cases:
            with self.subTest(target=target, english=english):
                checkpoint = self.build_checkpoint(
                    pack,
                    self.language_models(
                        chunk_target_probability=target,
                        chunk_english_probability=english,
                    ),
                )
                self.assertEqual(
                    "mixed-english" in checkpoint_failure_codes(checkpoint),
                    expected_failure,
                )

    def test_raw_semantic_thresholds_cover_short_medium_standard_and_legal(self) -> None:
        cases = (
            ("Learn with care.", "route:short", 0.45),
            ("Learn every day carefully.", "route:medium", 0.55),
            (
                "Learn every useful lesson with calm and daily practice.",
                "route:standard",
                0.62,
            ),
            ("Review these service terms.", "legal:terms", 0.7),
        )
        value = "Leer vandag elke les baie sorgvuldig."
        for source, namespace, threshold in cases:
            pack = make_pack(source, value, namespace=namespace)
            for score, expected_failure in (
                (threshold - 0.0000003, True),
                (threshold, False),
                (threshold + 0.0000003, False),
            ):
                with self.subTest(namespace=namespace, score=score):
                    checkpoint = self.build_checkpoint(
                        pack,
                        self.language_models(
                            semantic_scores=(score, 0.96, 0.96),
                            backtranslations={value: source},
                        ),
                    )
                    self.assertEqual(
                        "semantic-adequacy-low"
                        in checkpoint_failure_codes(checkpoint),
                        expected_failure,
                    )
                    if score != threshold:
                        self.assertEqual(
                            checkpoint["fieldEvidenceRows"][0][1][
                                "semanticSimilarity"
                            ],
                            threshold,
                        )

    def test_raw_backtranslation_trigger_and_adequacy_boundaries(self) -> None:
        source = "Learn every useful lesson with calm and daily practice."
        value = "Leer vandag elke les baie sorgvuldig."
        pack = make_pack(source, value)
        for score, required in (
            (0.7199997, True),
            (0.72, False),
            (0.7200003, False),
        ):
            with self.subTest(trigger_score=score):
                scores = (score, 0.96, 0.96) if required else (score,)
                checkpoint = self.build_checkpoint(
                    pack,
                    self.language_models(
                        semantic_scores=scores,
                        backtranslations={value: source},
                    ),
                )
                self.assertEqual(
                    checkpoint["fieldEvidenceRows"][0][1][
                        "backtranslationRequired"
                    ],
                    required,
                )

        for namespace, threshold in (
            ("route:test", 0.7),
            ("legal:terms", 0.76),
        ):
            legal_pack = make_pack(source, value, namespace=namespace)
            for score, expected_failure in (
                (threshold - 0.0000003, True),
                (threshold, False),
                (threshold + 0.0000003, False),
            ):
                with self.subTest(namespace=namespace, back_score=score):
                    checkpoint = self.build_checkpoint(
                        legal_pack,
                        self.language_models(
                            semantic_scores=(0.71, score, 0.96),
                            backtranslations={value: source},
                        ),
                    )
                    self.assertEqual(
                        "backtranslation-adequacy-low"
                        in checkpoint_failure_codes(checkpoint),
                        expected_failure,
                    )

    def test_raw_sentence_alignment_boundaries_are_not_rounded_for_policy(self) -> None:
        source = "Learn every useful lesson with calm and daily practice."
        value = "Leer vandag elke les baie sorgvuldig."
        for namespace, threshold in (
            ("route:test", 0.58),
            ("legal:terms", 0.64),
        ):
            pack = make_pack(source, value, namespace=namespace)
            for score, expected_failure in (
                (threshold - 0.0000003, True),
                (threshold, False),
                (threshold + 0.0000003, False),
            ):
                with self.subTest(namespace=namespace, alignment=score):
                    checkpoint = self.build_checkpoint(
                        pack,
                        self.language_models(
                            semantic_scores=(0.71, 0.96, score),
                            backtranslations={value: source},
                        ),
                    )
                    failures = checkpoint_failure_codes(checkpoint)
                    self.assertEqual(
                        "possible-omission" in failures,
                        expected_failure,
                    )
                    self.assertEqual(
                        "possible-addition" in failures,
                        expected_failure,
                    )

    def test_length_ratio_exact_boundaries_cover_regular_and_legal_policy(self) -> None:
        vocabulary = (
            "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu "
            "nu xi omicron pi rho sigma tau upsilon phi chi psi omega amber cedar "
            "forest meadow river valley"
        ).split()
        value = "Leer vandag elke volledige les baie sorgvuldig."

        def sentence(word_count: int) -> str:
            return " ".join(vocabulary[:word_count]) + "."

        cases = (
            ("route:test", 20, 10, "possible-omission", True),
            ("route:test", 20, 11, "possible-omission", False),
            ("route:test", 10, 18, "possible-addition", False),
            ("route:test", 10, 19, "possible-addition", True),
            ("legal:terms", 25, 17, "possible-omission", True),
            ("legal:terms", 25, 18, "possible-omission", False),
            ("legal:terms", 10, 14, "possible-addition", False),
            ("legal:terms", 10, 15, "possible-addition", True),
        )
        for namespace, source_words, back_words, code, expected in cases:
            source = sentence(source_words)
            backtranslation = sentence(back_words)
            pack = make_pack(source, value, namespace=namespace)
            with self.subTest(
                namespace=namespace,
                source_words=source_words,
                back_words=back_words,
                code=code,
            ):
                checkpoint = self.build_checkpoint(
                    pack,
                    self.language_models(
                        semantic_scores=(0.71, 0.96, 0.96),
                        backtranslations={value: backtranslation},
                    ),
                )
                self.assertEqual(
                    code in checkpoint_failure_codes(checkpoint), expected
                )

    def test_length_ratio_policy_uses_raw_fraction_when_display_rounds_to_boundary(self) -> None:
        source = "Alpha beta gamma."
        value = "Leer die les nou."
        backtranslation = "Alpha beta."
        semantic_policy = AUDITOR.AUDIT_POLICY["semantic"]
        with mock.patch.dict(
            semantic_policy,
            {"minimumBacktranslationLengthRatio": 0.6666667},
        ):
            checkpoint = self.build_checkpoint(
                make_pack(source, value),
                self.language_models(
                    semantic_scores=(0.71, 0.96, 0.96),
                    backtranslations={value: backtranslation},
                ),
            )
        evidence = checkpoint["fieldEvidenceRows"][0][1]
        self.assertEqual(evidence["backtranslationLengthRatio"], 0.666667)
        self.assertIn("possible-omission", checkpoint_failure_codes(checkpoint))


class ProvenanceAndFailClosedTests(unittest.TestCase):
    def test_static_main_app_tree_is_exact_and_workbench_files_are_non_identity(self) -> None:
        self.assertTrue(
            AUDITOR.is_main_app_workbench_relative_path("af/main-app.json")
        )
        self.assertTrue(
            AUDITOR.is_main_app_workbench_relative_path(
                "af/main-app.part-001.json"
            )
        )
        self.assertTrue(
            AUDITOR.is_main_app_workbench_relative_path(
                "af/main-app.part-final.json"
            )
        )
        self.assertFalse(
            AUDITOR.is_main_app_workbench_relative_path(
                "nested/af/main-app.part-001.json"
            )
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            curated = root / "curated"
            locale_root = curated / "af"
            locale_root.mkdir(parents=True)
            (locale_root / "route__home.json").write_text(
                '{"site":true}', encoding="utf-8"
            )
            before = AUDITOR.snapshot_input_tree(
                curated,
                "curated site tree",
                ignore_main_app_workbench=True,
            )
            for basename in (
                "main-app.json",
                "main-app.part-001.json",
                "main-app.part-final.json",
            ):
                (locale_root / basename).write_text(
                    '{"ignored":true}', encoding="utf-8"
                )
            after = AUDITOR.snapshot_input_tree(
                curated,
                "curated site tree",
                ignore_main_app_workbench=True,
            )
            self.assertEqual(before, after)

            source = make_pack(
                "Start learning now.",
                "Begin nou leer.",
                namespace="main-app",
            ).source
            static_root = root / "static-main-app"
            static_root.mkdir()
            for locale, language in AUDITOR.LANGUAGE_BY_LOCALE.items():
                (static_root / f"{locale}.json").write_text(
                    json.dumps(
                        {
                            "schemaVersion": 1,
                            "kind": "static-main-app-values",
                            "language": language,
                            "locale": locale,
                            "sourceHash": source.source_hash,
                            "keyCount": 1,
                            "strings": [f"{language} translation"],
                        },
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    encoding="utf-8",
                )
            static_files = AUDITOR.collect_static_main_app_files(static_root)
            self.assertEqual(len(static_files), 69)
            parsed = AUDITOR.parse_static_main_app_pack(
                static_files["af"], "af", source
            )
            self.assertEqual(parsed.origin, "curated")
            (static_root / "af.json").unlink()
            with self.assertRaisesRegex(
                AUDITOR.AuditContractError, "exact 69-pack corpus"
            ):
                AUDITOR.collect_static_main_app_files(static_root)

    class FakeFastTextModel:
        def __init__(self, probability: float) -> None:
            self.probability = probability

        def predict(
            self, values: Sequence[str], k: int
        ) -> tuple[list[list[str]], list[list[float]]]:
            del k
            return (
                [["__label__af"] for _ in values],
                [[self.probability] for _ in values],
            )

    def test_duplicate_json_keys_are_rejected(self) -> None:
        with self.assertRaisesRegex(AUDITOR.AuditContractError, "duplicate JSON key"):
            AUDITOR.strict_json_loads('{"sha":"a","sha":"b"}', "fixture")

    def test_policy_is_canonical_and_has_no_shadowed_key(self) -> None:
        source_copy = AUDITOR.AUDIT_POLICY["sourceCopy"]
        self.assertEqual(
            set(source_copy),
            {
                "minimumExactNgramWords",
                "minimumExactNgramCharacters",
                "minimumDistinctEnglishFunctionWords",
            },
        )
        encoded = AUDITOR.canonical_json(AUDITOR.AUDIT_POLICY)
        reparsed = AUDITOR.strict_json_loads(encoded, "policy")
        self.assertEqual(
            AUDITOR.sha256_canonical(reparsed),
            AUDITOR.sha256_canonical(AUDITOR.AUDIT_POLICY),
        )

    def test_model_digest_drift_fails_closed(self) -> None:
        with self.assertRaisesRegex(AUDITOR.AuditModelError, "drifted"):
            AUDITOR.require_matching_digest("a" * 64, "b" * 64, "fixture model")

    def test_model_tree_empty_directory_count_and_depth_are_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for index in range(3):
                (root / f"empty-{index}").mkdir()
            with (
                mock.patch.object(AUDITOR, "MAXIMUM_TREE_DIRECTORIES", 3),
                self.assertRaisesRegex(
                    AUDITOR.AuditModelError,
                    "directory resource bound",
                ),
            ):
                AUDITOR.hash_model_tree(root, root, frozenset(), "fixture model")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            cursor = root
            for index in range(AUDITOR.MAXIMUM_TREE_DEPTH + 1):
                cursor /= f"nested-{index}"
                cursor.mkdir()
            with self.assertRaisesRegex(
                AUDITOR.AuditModelError,
                "directory depth bound",
            ):
                AUDITOR.hash_model_tree(root, root, frozenset(), "fixture model")

    def test_fasttext_float_roundoff_is_bounded_and_clamped(self) -> None:
        detector = object.__new__(AUDITOR.FastTextLanguageDetector)
        detector._model = self.FakeFastTextModel(1.00005)
        predictions = detector.predict_many(("Afrikaanse teks",))
        self.assertEqual(predictions[0][0].probability, 1.0)

    def test_fasttext_out_of_range_probability_fails_closed(self) -> None:
        detector = object.__new__(AUDITOR.FastTextLanguageDetector)
        detector._model = self.FakeFastTextModel(1.001)
        with self.assertRaisesRegex(AUDITOR.AuditModelError, "malformed probability"):
            detector.predict_many(("Afrikaanse teks",))

    def test_adjudication_model_provenance_drift_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "reviews.json"
            bindings = {"modelLockSha256": "a" * 64}
            material = {
                "schemaVersion": 1,
                "kind": AUDITOR.ADJUDICATION_KIND,
                "bindings": bindings,
                "reviews": [],
            }
            payload = {**material, "adjudicationSha256": AUDITOR.sha256_canonical(material)}
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(AUDITOR.AuditContractError, "stale"):
                AUDITOR.parse_adjudications(
                    path, {"modelLockSha256": "b" * 64}
                )

    def test_symlinked_input_tree_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            target = root / "target.json"
            target.write_text("{}", encoding="utf-8")
            link_root = root / "tree"
            link_root.mkdir()
            os.symlink(target, link_root / "pack.json")
            with self.assertRaisesRegex(AUDITOR.AuditContractError, "symlinked file"):
                AUDITOR.snapshot_input_tree(link_root, "fixture tree")

    def test_input_tree_empty_directory_count_is_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for index in range(3):
                (root / f"empty-{index}").mkdir()
            with (
                mock.patch.object(AUDITOR, "MAXIMUM_TREE_DIRECTORIES", 3),
                self.assertRaisesRegex(
                    AUDITOR.AuditContractError,
                    "directory resource bound",
                ),
            ):
                AUDITOR.snapshot_input_tree(root, "fixture tree")

    def test_immutable_manifest_is_idempotent_but_refuses_different_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve() / "audit.json"
            material = {
                "schemaVersion": 1,
                "kind": "fixture-audit",
                "createdAt": "2026-07-14T12:00:00Z",
                "passed": False,
            }
            manifest = {
                **material,
                "manifestSha256": AUDITOR.sha256_canonical(material),
            }
            self.assertEqual(
                AUDITOR.write_immutable_manifest(output, manifest), manifest
            )
            self.assertEqual(output.stat().st_mode & 0o777, 0o400)
            self.assertEqual(
                AUDITOR.write_immutable_manifest(output, manifest), manifest
            )
            drifted_material = {**material, "passed": True}
            with self.assertRaisesRegex(AUDITOR.AuditContractError, "different evidence"):
                AUDITOR.write_immutable_manifest(
                    output,
                    {
                        **drifted_material,
                        "manifestSha256": AUDITOR.sha256_canonical(
                            drifted_material
                        ),
                    },
                )

    def test_production_scope_counts_are_exact(self) -> None:
        smoke = AUDITOR.AuditExpectations.production("afrikaans-smoke")
        full = AUDITOR.AuditExpectations.production("full")
        self.assertEqual((len(smoke.locales), smoke.expected_packs), (1, 125))
        self.assertEqual((len(full.locales), full.expected_packs), (69, 8_625))

    def test_nonempty_reviewed_override_intersection_is_exact_and_fail_closed(
        self,
    ) -> None:
        expectations = AUDITOR.AuditExpectations("fixture", ("af",), 1, 1)
        master, _ = make_master_fixture(reviewed_override=True)
        AUDITOR.parse_master_worklist(master, expectations)

        removed = copy.deepcopy(master)
        removed_overrides = removed["generationOverrides"]
        removed_overrides["entries"] = []
        override_material = dict(removed_overrides)
        del override_material["generationOverridesSha256"]
        removed_overrides["generationOverridesSha256"] = (
            AUDITOR.sha256_canonical(override_material)
        )
        removed["provenance"]["generationOverridesSha256"] = (
            removed_overrides["generationOverridesSha256"]
        )
        removed["provenance"]["generationOverrideEntries"] = 0
        removed_material = dict(removed)
        del removed_material["worklistSha256"]
        removed["worklistSha256"] = AUDITOR.sha256_canonical(removed_material)
        with self.assertRaisesRegex(
            AUDITOR.AuditContractError,
            "required reviewed set",
        ):
            AUDITOR.parse_master_worklist(removed, expectations)

        tampered = copy.deepcopy(master)
        tampered_value = f"{F29_REVIEWED_VALUE} Tampered"
        tampered_value_sha256 = AUDITOR.sha256_text(tampered_value)
        tampered["seedMemory"]["entries"][0]["value"] = tampered_value
        tampered["seedMemory"]["entries"][0]["valueSha256"] = (
            tampered_value_sha256
        )
        seed_material = dict(tampered["seedMemory"])
        del seed_material["seedMemorySha256"]
        tampered["seedMemory"]["seedMemorySha256"] = AUDITOR.sha256_canonical(
            seed_material
        )
        tampered["provenance"]["seedMemorySha256"] = tampered["seedMemory"][
            "seedMemorySha256"
        ]
        tampered["generationOverrides"]["entries"][0]["value"] = tampered_value
        tampered["generationOverrides"]["entries"][0]["valueSha256"] = (
            tampered_value_sha256
        )
        override_material = dict(tampered["generationOverrides"])
        del override_material["generationOverridesSha256"]
        tampered["generationOverrides"]["generationOverridesSha256"] = (
            AUDITOR.sha256_canonical(override_material)
        )
        tampered["provenance"]["generationOverridesSha256"] = tampered[
            "generationOverrides"
        ]["generationOverridesSha256"]
        tampered_material = dict(tampered)
        del tampered_material["worklistSha256"]
        tampered["worklistSha256"] = AUDITOR.sha256_canonical(tampered_material)
        with self.assertRaisesRegex(
            AUDITOR.AuditContractError,
            "required reviewed set",
        ):
            AUDITOR.parse_master_worklist(tampered, expectations)

    def test_quality_stale_replacement_is_exactly_bound(self) -> None:
        master, source = make_master_fixture(
            {
                "kind": "inspir-long-tail-quality-stale-replacement-v1",
                "existingFileSha256": "6" * 64,
                "sourceHash": "e" * 64,
                "validatorPolicySha256": "5" * 64,
            }
        )
        expectations = AUDITOR.AuditExpectations("fixture", ("af",), 1, 1)
        _, _, jobs = AUDITOR.parse_master_worklist(master, expectations)
        self.assertEqual(len(jobs), 1)
        drifted, _ = make_master_fixture(
            {
                "kind": "inspir-long-tail-quality-stale-replacement-v1",
                "existingFileSha256": "6" * 64,
                "sourceHash": source["sourceHash"],
                "validatorPolicySha256": "7" * 64,
            }
        )
        with self.assertRaisesRegex(AUDITOR.AuditContractError, "policy binding"):
            AUDITOR.parse_master_worklist(drifted, expectations)

    def test_source_stale_replacement_rejects_non_drift(self) -> None:
        master, _ = make_master_fixture(
            {
                "kind": "inspir-long-tail-source-stale-replacement-v1",
                "existingFileSha256": "6" * 64,
                "priorSourceHash": "e" * 64,
            }
        )
        with self.assertRaisesRegex(AUDITOR.AuditContractError, "does not bind source drift"):
            AUDITOR.parse_master_worklist(
                master, AUDITOR.AuditExpectations("fixture", ("af",), 1, 1)
            )

    def test_partial_pack_union_fails_closed(self) -> None:
        master, _ = make_master_fixture()
        expectations = AUDITOR.AuditExpectations("fixture", ("af",), 1, 1)
        parsed, sources, jobs = AUDITOR.parse_master_worklist(master, expectations)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            curated = root / "curated"
            candidates = root / "candidates"
            worklists = root / "worklists"
            curated.mkdir()
            static_main_app = root / "static-main-app"
            static_main_app.mkdir()
            candidates.mkdir()
            worklists.mkdir()
            inputs = AUDITOR.AuditInputs(
                root=root,
                master_worklist=root / "master.json",
                curated_root=curated,
                static_main_app_root=static_main_app,
                candidate_root=candidates,
                pack_worklist_root=worklists,
                output=root / "output.json",
                adjudications=None,
            )
            with self.assertRaisesRegex(
                AUDITOR.AuditContractError,
                "exact 69-pack corpus|partial",
            ):
                AUDITOR.load_exact_pack_union(
                    inputs, expectations, parsed, sources, jobs
                )

    def test_fully_rehashed_whole_source_literal_forgery_is_rejected(self) -> None:
        master, _ = make_master_fixture()
        forged = copy.deepcopy(master)
        source = forged["sources"][0]
        entry = source["entries"][0]
        source_text = entry["source"]
        entry["segments"] = [{"kind": "literal", "value": source_text}]
        entry["invariantSha256"] = AUDITOR.sha256_canonical([source_text])
        source["sourceEntriesSha256"] = AUDITOR.sha256_canonical(
            source["entries"]
        )
        job = forged["jobs"][0]
        job["sourceEntriesSha256"] = source["sourceEntriesSha256"]
        job_material = dict(job)
        del job_material["jobSha256"]
        job["jobSha256"] = AUDITOR.sha256_canonical(job_material)
        master_material = dict(forged)
        del master_material["worklistSha256"]
        forged["worklistSha256"] = AUDITOR.sha256_canonical(master_material)
        with self.assertRaisesRegex(
            AUDITOR.AuditContractError,
            "not canonically derived",
        ):
            AUDITOR.parse_master_worklist(
                forged,
                AUDITOR.AuditExpectations("fixture", ("af",), 1, 1),
            )

    def test_fully_rehashed_generator_v3_master_is_rejected(self) -> None:
        master, _ = make_master_fixture()
        forged = copy.deepcopy(master)
        forged["provenance"]["pipelineVersion"] = (
            "inspir-long-tail-local-nllb-v3"
        )
        forged["provenance"]["executionProfile"]["pipelineVersion"] = (
            "inspir-long-tail-local-nllb-v3"
        )
        profile_material = dict(forged["provenance"]["executionProfile"])
        del profile_material["executionProfileSha256"]
        forged["provenance"]["executionProfile"][
            "executionProfileSha256"
        ] = AUDITOR.sha256_canonical(profile_material)
        master_material = dict(forged)
        del master_material["worklistSha256"]
        forged["worklistSha256"] = AUDITOR.sha256_canonical(master_material)
        with self.assertRaisesRegex(
            AUDITOR.AuditContractError,
            "predates the exact generator v4 contract",
        ):
            AUDITOR.parse_master_worklist(
                forged,
                AUDITOR.AuditExpectations("fixture", ("af",), 1, 1),
            )

    def test_fully_rehashed_generator_profile_drift_is_rejected(self) -> None:
        master, _ = make_master_fixture()
        forged = copy.deepcopy(master)
        profile = forged["provenance"]["executionProfile"]
        profile["environment"]["OMP_NUM_THREADS"] = "2"
        profile_material = dict(profile)
        del profile_material["executionProfileSha256"]
        profile["executionProfileSha256"] = AUDITOR.sha256_canonical(
            profile_material
        )
        master_material = dict(forged)
        del master_material["worklistSha256"]
        forged["worklistSha256"] = AUDITOR.sha256_canonical(master_material)
        with self.assertRaisesRegex(
            AUDITOR.AuditContractError,
            "stale, mismatched, or tampered",
        ):
            AUDITOR.parse_master_worklist(
                forged,
                AUDITOR.AuditExpectations("fixture", ("af",), 1, 1),
            )

    def test_input_tree_mutation_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            path = root / "pack.json"
            path.write_text('{"value":1}', encoding="utf-8")
            prior = AUDITOR.snapshot_input_tree(root, "fixture tree")
            path.write_text('{"value":2}', encoding="utf-8")
            with self.assertRaisesRegex(AUDITOR.AuditContractError, "changed"):
                AUDITOR.assert_tree_unchanged(root, prior, "fixture tree")

    def test_model_hash_streams_multiple_chunks_without_returning_file_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "model.bin"
            payload = (b"0123456789abcdef" * (160 * 1024)) + b"tail"
            path.write_bytes(payload)
            original_read = AUDITOR.os.read
            read_calls = 0

            def counting_read(descriptor: int, size: int) -> bytes:
                nonlocal read_calls
                read_calls += 1
                return original_read(descriptor, size)

            with mock.patch.object(AUDITOR.os, "read", side_effect=counting_read):
                evidence = AUDITOR.hash_regular_model_file(
                    path,
                    4 * 1024 * 1024,
                    "fixture model",
                    require_single_link=True,
                    no_follow=True,
                )
            self.assertIsInstance(evidence, tuple)
            self.assertEqual(evidence, (AUDITOR.sha256_bytes(payload), len(payload)))
            self.assertGreaterEqual(read_calls, 4)

    def test_model_hash_fails_closed_on_midstream_truncation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "model.bin"
            path.write_bytes(b"x" * (3 * 1024 * 1024))
            original_read = AUDITOR.os.read
            mutated = False

            def truncating_read(descriptor: int, size: int) -> bytes:
                nonlocal mutated
                chunk = original_read(descriptor, size)
                if not mutated:
                    mutated = True
                    with path.open("r+b") as handle:
                        handle.truncate(1024)
                return chunk

            with mock.patch.object(AUDITOR.os, "read", side_effect=truncating_read):
                with self.assertRaisesRegex(
                    AUDITOR.AuditModelError, "truncated|changed"
                ):
                    AUDITOR.hash_regular_model_file(
                        path,
                        4 * 1024 * 1024,
                        "fixture model",
                        require_single_link=True,
                        no_follow=True,
                    )


if __name__ == "__main__":
    unittest.main()
