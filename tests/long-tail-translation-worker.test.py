#!/usr/bin/env python3
"""Bounded tests for the local long-tail translation worker."""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


WORKER_PATH = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "generate-long-tail-translations-worker.py"
)
WORKER_SPEC = importlib.util.spec_from_file_location(
    "generate_long_tail_translations_worker",
    WORKER_PATH,
)
if WORKER_SPEC is None or WORKER_SPEC.loader is None:
    raise RuntimeError("Could not load the long-tail translation worker")
WORKER = importlib.util.module_from_spec(WORKER_SPEC)
WORKER_SPEC.loader.exec_module(WORKER)


def run_translate(
    values: list[str],
    maximum_retries: int,
    batch_offset: int,
    target_code: str = "afr_Latn",
) -> list[str]:
    return WORKER.translate_batch(
        model=object(),
        tokenizer=object(),
        device="mps",
        target_code=target_code,
        values=values,
        num_beams=1,
        no_repeat_ngram_size=4,
        max_source_tokens=512,
        maximum_new_tokens=512,
        logits_processor=object(),
        maximum_empty_retries=maximum_retries,
        batch_offset=batch_offset,
    )


class WorkerJsonResourceBoundTests(unittest.TestCase):
    class FakeJsonPath:
        def __init__(self, size: int) -> None:
            self.size = size

        def lstat(self) -> os.stat_result:
            return os.stat_result((0o100600, 0, 0, 1, 0, 0, self.size, 0, 0, 0))

        def is_symlink(self) -> bool:
            return False

        def open(self, *args: object, **kwargs: object) -> io.StringIO:
            return io.StringIO("{}")

        def __str__(self) -> str:
            return "bounded-fixture.json"

    def test_master_has_a_separate_bounded_ceiling(self) -> None:
        between_bounds = self.FakeJsonPath(WORKER.MAXIMUM_JSON_BYTES + 1)
        with self.assertRaisesRegex(RuntimeError, "byte bound"):
            WORKER.read_json(between_bounds)
        self.assertEqual(
            WORKER.read_json(
                between_bounds,
                WORKER.MAXIMUM_MASTER_WORKLIST_BYTES,
            ),
            {},
        )
        above_master_bound = self.FakeJsonPath(
            WORKER.MAXIMUM_MASTER_WORKLIST_BYTES + 1
        )
        with self.assertRaisesRegex(RuntimeError, "byte bound"):
            WORKER.read_json(
                above_master_bound,
                WORKER.MAXIMUM_MASTER_WORKLIST_BYTES,
            )


class CandidateAtomicWriteTests(unittest.TestCase):
    @staticmethod
    def encoded(payload: dict[str, object]) -> bytes:
        return (
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        ).encode("utf-8")

    @staticmethod
    def resume_fixture() -> tuple[dict[str, object], dict[str, object]]:
        job = {
            "jobSha256": "7" * 64,
            "language": "Spanish",
            "locale": "es",
            "namespace": "route:fixture",
            "sourceHash": "8" * 64,
            "sourceEntriesSha256": "9" * 64,
        }
        source_entry = {
            "key": "title",
            "source": "Learn carefully.",
            "sourceSha256": hashlib.sha256(b"Learn carefully.").hexdigest(),
            "segments": [{"kind": "text", "value": "Learn carefully."}],
        }
        pack = {
            "masterWorklistSha256": "a" * 64,
            "packWorklistSha256": "b" * 64,
            "job": job,
            "provenance": {
                "modelLabel": "fixture-model",
                "modelSha256": "c" * 64,
                "workerImplementationSha256": "d" * 64,
                "validatorPolicy": {"validatorPolicySha256": "e" * 64},
            },
            "source": {"entries": [source_entry]},
        }
        candidate = WORKER.candidate_payload(
            pack,
            {"title": "Aprende con cuidado."},
        )
        return pack, candidate

    def test_new_candidate_is_private_single_link_and_exact_replay_is_safe(
        self,
    ) -> None:
        payload = {"schemaVersion": 1, "values": {"title": "Vertaling"}}
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / "candidate.json"
            WORKER.write_candidate_atomic(target, payload)
            metadata = target.lstat()
            self.assertEqual(metadata.st_mode & 0o777, 0o600)
            self.assertEqual(metadata.st_nlink, 1)
            self.assertEqual(target.read_bytes(), self.encoded(payload))
            WORKER.write_candidate_atomic(target, payload)
            self.assertEqual(target.read_bytes(), self.encoded(payload))

    def test_exact_byte_symlink_and_hardlink_targets_are_rejected(self) -> None:
        payload = {"schemaVersion": 1, "values": {"title": "Vertaling"}}
        encoded = self.encoded(payload)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            external = root / "external.json"
            external.write_bytes(encoded)
            external.chmod(0o600)
            symlink = root / "symlink.json"
            symlink.symlink_to(external)
            with self.assertRaisesRegex(RuntimeError, "non-symlink"):
                WORKER.write_candidate_atomic(symlink, payload)

            hardlink = root / "hardlink.json"
            os.link(external, hardlink)
            with self.assertRaisesRegex(RuntimeError, "single-link"):
                WORKER.write_candidate_atomic(hardlink, payload)

    def test_exact_byte_non_private_target_is_rejected(self) -> None:
        payload = {"schemaVersion": 1, "values": {"title": "Vertaling"}}
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / "candidate.json"
            target.write_bytes(self.encoded(payload))
            target.chmod(0o644)
            with self.assertRaisesRegex(RuntimeError, "mode 0600"):
                WORKER.write_candidate_atomic(target, payload)

    def test_post_link_mode_race_fails_closed_and_removes_own_target(self) -> None:
        payload = {"schemaVersion": 1, "values": {"title": "Vertaling"}}
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / "candidate.json"
            original_link = WORKER.os.link

            def racing_link(*args: object, **kwargs: object) -> None:
                original_link(*args, **kwargs)
                target.chmod(0o644)

            with mock.patch.object(
                WORKER.os,
                "link",
                side_effect=racing_link,
            ), self.assertRaisesRegex(RuntimeError, "mode 0600"):
                WORKER.write_candidate_atomic(target, payload)
            self.assertFalse(target.exists())

    def test_resume_rejects_non_private_linked_and_oversized_candidates(self) -> None:
        pack, candidate = self.resume_fixture()
        encoded = self.encoded(candidate)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            external = root / "external.json"
            external.write_bytes(encoded)
            external.chmod(0o600)

            non_private = root / "non-private.json"
            non_private.write_bytes(encoded)
            non_private.chmod(0o644)
            with self.assertRaisesRegex(RuntimeError, "mode 0600"):
                WORKER.existing_candidate_values(non_private, pack)

            symlink = root / "symlink.json"
            symlink.symlink_to(external)
            with self.assertRaisesRegex(RuntimeError, "non-symlink"):
                WORKER.existing_candidate_values(symlink, pack)

            hardlink = root / "hardlink.json"
            os.link(external, hardlink)
            with self.assertRaisesRegex(RuntimeError, "single-link"):
                WORKER.existing_candidate_values(hardlink, pack)

            oversized = root / "oversized.json"
            with oversized.open("wb") as handle:
                handle.truncate(WORKER.MAXIMUM_JSON_BYTES + 1)
            oversized.chmod(0o600)
            with self.assertRaisesRegex(RuntimeError, "byte bound"):
                WORKER.existing_candidate_values(oversized, pack)

    def test_resume_rejects_candidate_path_replacement_during_read(self) -> None:
        pack, candidate = self.resume_fixture()
        encoded = self.encoded(candidate)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            target = root / "candidate.json"
            replacement = root / "replacement.json"
            target.write_bytes(encoded)
            target.chmod(0o600)
            replacement.write_bytes(encoded)
            replacement.chmod(0o600)
            original_read = WORKER.os.read
            replaced = False

            def racing_read(descriptor: int, byte_count: int) -> bytes:
                nonlocal replaced
                if not replaced:
                    os.replace(replacement, target)
                    replaced = True
                return original_read(descriptor, byte_count)

            with mock.patch.object(
                WORKER.os,
                "read",
                side_effect=racing_read,
            ), self.assertRaisesRegex(RuntimeError, "single-link|changed"):
                WORKER.existing_candidate_values(target, pack)

    def test_resume_fifo_replacement_is_opened_nonblocking_and_rejected(self) -> None:
        pack, candidate = self.resume_fixture()
        encoded = self.encoded(candidate)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            target = root / "candidate.json"
            fifo = root / "candidate.fifo"
            target.write_bytes(encoded)
            target.chmod(0o600)
            os.mkfifo(fifo, 0o600)
            original_open = WORKER.os.open
            replaced = False

            def racing_open(
                open_path: object,
                flags: int,
                *args: object,
                **kwargs: object,
            ) -> int:
                nonlocal replaced
                if Path(open_path) == target and not replaced:
                    self.assertTrue(flags & os.O_NONBLOCK)
                    target.unlink()
                    os.replace(fifo, target)
                    replaced = True
                return original_open(open_path, flags, *args, **kwargs)

            with mock.patch.object(
                WORKER.os,
                "open",
                side_effect=racing_open,
            ), self.assertRaisesRegex(RuntimeError, "regular non-symlink"):
                WORKER.existing_candidate_values(target, pack)

    def test_resume_rejects_duplicate_candidate_json_keys(self) -> None:
        pack, candidate = self.resume_fixture()
        encoded = self.encoded(candidate).replace(
            b'  "schemaVersion": 1,\n',
            b'  "schemaVersion": 1,\n  "schemaVersion": 1,\n',
            1,
        )
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / "candidate.json"
            target.write_bytes(encoded)
            target.chmod(0o600)
            with self.assertRaisesRegex(RuntimeError, "duplicate keys"):
                WORKER.existing_candidate_values(target, pack)


class ExecutionProfileTests(unittest.TestCase):
    @staticmethod
    def fixture_provenance() -> dict[str, object]:
        override_material = {
            "schemaVersion": 1,
            "kind": WORKER.GENERATION_OVERRIDES_KIND,
            "entries": [],
        }
        return {
            "pipelineVersion": WORKER.PIPELINE_VERSION,
            "executionProfile": WORKER.EXECUTION_PROFILE,
            "protectorVersion": "inspir-long-tail-literal-protector-v1",
            "protectorSha256": "1" * 64,
            "pipelineImplementationSha256": "2" * 64,
            "workerImplementationSha256": "3" * 64,
            "validatorPolicy": {
                "kind": WORKER.VALIDATOR_POLICY_KIND,
                "files": [],
                "validatorPolicySha256": "4" * 64,
            },
            "modelLabel": "fixture-model",
            "modelSha256": "5" * 64,
            "seedMemorySha256": "6" * 64,
            "seedMemoryEntries": 0,
            "seedMemoryConflicts": 0,
            "generationOverridesSha256": WORKER.canonical_sha256(
                override_material
            ),
            "generationOverrideEntries": 0,
            "generationConfig": {},
        }

    @classmethod
    def fixture_master(cls) -> dict[str, object]:
        override_material = {
            "schemaVersion": 1,
            "kind": WORKER.GENERATION_OVERRIDES_KIND,
            "entries": [],
        }
        material: dict[str, object] = {
            "schemaVersion": 1,
            "kind": WORKER.MASTER_KIND,
            "provenance": cls.fixture_provenance(),
            "seedMemory": {},
            "generationOverrides": {
                **override_material,
                "generationOverridesSha256": WORKER.canonical_sha256(
                    override_material
                ),
            },
            "sources": [],
            "jobs": [],
        }
        return {**material, "worklistSha256": WORKER.canonical_sha256(material)}

    def test_profile_digest_environment_and_torch_getters_are_exact(self) -> None:
        self.assertEqual(
            WORKER.EXECUTION_PROFILE_SHA256,
            "807a3bc739832f9a199618731b007dae93a8053027b971e0715e4f9ea550db8b",
        )
        self.assertEqual(
            WORKER.EXECUTION_PROFILE["pipelineVersion"],
            WORKER.PIPELINE_VERSION,
        )
        self.assertEqual(
            {
                name: os.environ.get(name)
                for name in WORKER.EXECUTION_PROFILE["environment"]
            },
            WORKER.EXECUTION_PROFILE["environment"],
        )
        self.assertEqual(WORKER.torch.get_num_threads(), 1)
        self.assertEqual(WORKER.torch.get_num_interop_threads(), 1)
        self.assertEqual(os.environ["PYTORCH_ENABLE_MPS_FALLBACK"], "0")
        self.assertEqual(
            WORKER.EXECUTION_PROFILE["terminalRescue"],
            {
                "device": "cpu",
                "dtype": "float32",
                "independentDecodes": 2,
                "deterministicAlgorithms": True,
            },
        )

    def test_parent_thread_and_mps_overrides_are_forced_before_import(self) -> None:
        program = """
import importlib.util
import json
import os
import sys
spec = importlib.util.spec_from_file_location("isolated_worker", sys.argv[1])
if spec is None or spec.loader is None:
    raise RuntimeError("worker import failed")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
print(json.dumps({
    "environment": {
        name: os.environ.get(name)
        for name in worker.EXECUTION_PROFILE["environment"]
    },
    "interopThreads": worker.torch.get_num_interop_threads(),
    "intraopThreads": worker.torch.get_num_threads(),
    "sha256": worker.EXECUTION_PROFILE_SHA256,
}, sort_keys=True))
"""
        environment = dict(os.environ)
        environment.update(
            {
                "MKL_NUM_THREADS": "81",
                "OMP_NUM_THREADS": "82",
                "PYTORCH_ENABLE_MPS_FALLBACK": "1",
                "VECLIB_MAXIMUM_THREADS": "83",
            }
        )
        result = subprocess.run(
            [sys.executable, "-c", program, str(WORKER_PATH)],
            check=True,
            capture_output=True,
            env=environment,
            text=True,
        )
        report = json.loads(result.stdout)
        self.assertEqual(
            report["environment"],
            WORKER.EXECUTION_PROFILE["environment"],
        )
        self.assertEqual(report["interopThreads"], 1)
        self.assertEqual(report["intraopThreads"], 1)
        self.assertEqual(report["sha256"], WORKER.EXECUTION_PROFILE_SHA256)

    def test_missing_drifted_and_duplicate_profile_arguments_fail_closed(self) -> None:
        WORKER.validate_execution_profile(
            WORKER.EXECUTION_PROFILE,
            WORKER.EXECUTION_PROFILE_SHA256,
        )
        for value, digest in (
            (
                {
                    key: item
                    for key, item in WORKER.EXECUTION_PROFILE.items()
                    if key != "executionProfileSha256"
                },
                WORKER.EXECUTION_PROFILE_SHA256,
            ),
            (
                {
                    **WORKER.EXECUTION_PROFILE,
                    "executionProfileSha256": "f" * 64,
                },
                WORKER.EXECUTION_PROFILE_SHA256,
            ),
            (WORKER.EXECUTION_PROFILE, "0" * 64),
        ):
            with self.subTest(value=value, digest=digest), self.assertRaises(
                RuntimeError
            ):
                WORKER.validate_execution_profile(value, digest)
        with self.assertRaisesRegex(RuntimeError, "duplicate keys"):
            WORKER.parse_strict_execution_profile_json(
                '{"schemaVersion":1,"schemaVersion":1}'
            )

    def test_runtime_environment_and_getter_drift_fail_closed(self) -> None:
        with mock.patch.dict(os.environ, {"OMP_NUM_THREADS": "2"}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "profile drifted"):
                WORKER.assert_runtime_execution_profile()

    def test_primary_hard_determinism_is_enabled_and_every_decode_is_reseeded(
        self,
    ) -> None:
        with mock.patch.object(
            WORKER.torch,
            "use_deterministic_algorithms",
        ) as enable, mock.patch.object(
            WORKER.torch,
            "are_deterministic_algorithms_enabled",
            return_value=True,
        ), mock.patch.object(
            WORKER.torch,
            "is_deterministic_algorithms_warn_only_enabled",
            return_value=False,
        ), mock.patch.object(WORKER.torch, "manual_seed") as manual_seed:
            WORKER.enable_primary_deterministic_algorithms()
            WORKER.prepare_deterministic_decode()
        enable.assert_called_once_with(True, warn_only=False)
        manual_seed.assert_called_once_with(0)

    def test_primary_deterministic_disabled_or_warn_only_state_fails_closed(
        self,
    ) -> None:
        for enabled, warn_only in ((False, False), (True, True)):
            with self.subTest(enabled=enabled, warn_only=warn_only), mock.patch.object(
                WORKER.torch,
                "are_deterministic_algorithms_enabled",
                return_value=enabled,
            ), mock.patch.object(
                WORKER.torch,
                "is_deterministic_algorithms_warn_only_enabled",
                return_value=warn_only,
            ), mock.patch.object(WORKER.torch, "manual_seed") as manual_seed:
                with self.assertRaisesRegex(RuntimeError, "deterministic"):
                    WORKER.prepare_deterministic_decode()
                manual_seed.assert_not_called()

    def test_coordinated_v3_master_rehash_cannot_bypass_profile_contract(self) -> None:
        WORKER.validate_master(self.fixture_master())
        master = json.loads(json.dumps(self.fixture_master()))
        provenance = master["provenance"]
        self.assertIsInstance(provenance, dict)
        provenance["pipelineVersion"] = "inspir-long-tail-local-nllb-v3"
        profile = provenance["executionProfile"]
        self.assertIsInstance(profile, dict)
        profile["pipelineVersion"] = "inspir-long-tail-local-nllb-v3"
        profile_material = dict(profile)
        profile_material.pop("executionProfileSha256")
        profile["executionProfileSha256"] = WORKER.canonical_sha256(
            profile_material
        )
        master_material = dict(master)
        master_material.pop("worklistSha256")
        master["worklistSha256"] = WORKER.canonical_sha256(master_material)
        with self.assertRaisesRegex(RuntimeError, "pipeline version is unsupported"):
            WORKER.validate_master(master)

    def test_missing_or_drifted_master_profile_fails_after_self_rehash(self) -> None:
        for mutation in ("missing", "digest"):
            master = json.loads(json.dumps(self.fixture_master()))
            provenance = master["provenance"]
            self.assertIsInstance(provenance, dict)
            if mutation == "missing":
                provenance.pop("executionProfile")
            else:
                profile = provenance["executionProfile"]
                self.assertIsInstance(profile, dict)
                profile["executionProfileSha256"] = "f" * 64
            material = dict(master)
            material.pop("worklistSha256")
            master["worklistSha256"] = WORKER.canonical_sha256(material)
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                WORKER.validate_master(master)

    def test_pack_profile_mismatch_fails_after_pack_self_rehash(self) -> None:
        master = self.fixture_master()
        entries = [
            {
                "key": "title",
                "source": "Learn carefully.",
                "sourceSha256": hashlib.sha256(b"Learn carefully.").hexdigest(),
            }
        ]
        job = {
            "entryCount": 1,
            "sourceEntriesSha256": WORKER.canonical_sha256(entries),
        }
        material = {
            "schemaVersion": 1,
            "kind": WORKER.PACK_KIND,
            "masterWorklistSha256": master["worklistSha256"],
            "provenance": json.loads(json.dumps(master["provenance"])),
            "job": job,
            "source": {"entries": entries},
        }
        pack = {
            **material,
            "packWorklistSha256": WORKER.canonical_sha256(material),
        }
        WORKER.validate_pack(
            pack,
            master,
            job,
            "5" * 64,
            "3" * 64,
        )
        pack_profile = pack["provenance"]["executionProfile"]
        self.assertIsInstance(pack_profile, dict)
        pack_profile["executionProfileSha256"] = "f" * 64
        rebound_material = dict(pack)
        rebound_material.pop("packWorklistSha256")
        pack["packWorklistSha256"] = WORKER.canonical_sha256(rebound_material)
        with self.assertRaisesRegex(RuntimeError, "provenance differs"):
            WORKER.validate_pack(
                pack,
                master,
                job,
                "5" * 64,
                "3" * 64,
            )

    def test_resumed_candidate_requires_exact_profile_digest(self) -> None:
        provenance = self.fixture_provenance()
        job = {
            "jobSha256": "7" * 64,
            "language": "Spanish",
            "locale": "es",
            "namespace": "route:fixture",
            "sourceHash": "8" * 64,
            "sourceEntriesSha256": "9" * 64,
        }
        source_entry = {
            "key": "title",
            "source": "Learn carefully.",
            "sourceSha256": hashlib.sha256(b"Learn carefully.").hexdigest(),
            "segments": [{"kind": "text", "value": "Learn carefully."}],
        }
        pack = {
            "masterWorklistSha256": "a" * 64,
            "packWorklistSha256": "b" * 64,
            "job": job,
            "provenance": provenance,
            "source": {"entries": [source_entry]},
        }
        candidate = WORKER.candidate_payload(
            pack,
            {"title": "Aprende con cuidado."},
        )
        with tempfile.TemporaryDirectory() as directory:
            candidate_path = Path(directory).resolve() / "candidate.json"
            candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
            candidate_path.chmod(0o600)
            self.assertEqual(
                WORKER.existing_candidate_values(candidate_path, pack),
                {"title": "Aprende con cuidado."},
            )
            candidate["executionProfileSha256"] = "0" * 64
            candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "stale provenance"):
                WORKER.existing_candidate_values(candidate_path, pack)
        with mock.patch.object(
            WORKER.torch,
            "get_num_threads",
            return_value=2,
        ):
            with self.assertRaisesRegex(RuntimeError, "profile drifted"):
                WORKER.assert_runtime_execution_profile()


class ReviewedGenerationOverrideTests(unittest.TestCase):
    F29_SOURCE = (
        "Use Case Study Simulator when this is the right mode for the job. "
        "If you want a related path, try Feynman Tutor. You can also browse "
        "the AI learning blog for study methods, Socratic learning, flashcards, "
        "roleplay, and active recall."
    )
    F29_VALUE = (
        "Gebruik Gevallestudiesimulator wanneer dit die regte modus vir die taak "
        "is. As jy ’n verwante leerpad wil volg, probeer Feynman Tutor. Jy kan "
        "ook deur die KI-leerblog blaai vir studiemetodes, Sokratiese leer, "
        "flitskaarte, rolspel en aktiewe herroeping."
    )
    F2DD_SOURCE = (
        "Case Study Simulator AI Learning Mode is a focused way to use AI for "
        "learning instead of passive answer collection. The mode is built around "
        "a specific job: Enter a realistic case, make decisions, see consequences, "
        "and learn the principle behind each choice."
    )
    F2DD_VALUE = (
        "Gevallestudiesimulator se KI-leermodus is ’n doelgerigte manier om KI vir "
        "leer te gebruik eerder as om passief antwoorde in te samel. Die modus is "
        "rondom ’n spesifieke taak gebou: Betree ’n realistiese saak, neem besluite, "
        "sien gevolge en leer die beginsel agter elke keuse."
    )

    @classmethod
    def fixture(cls) -> tuple[dict[str, object], list[dict[str, object]]]:
        source_hash = "a" * 64
        bindings = [
            ("site.d835e997c12945b8ec", cls.F29_SOURCE, cls.F29_VALUE),
            ("site.bc64634fca85b780b9", cls.F2DD_SOURCE, cls.F2DD_VALUE),
        ]
        catalog_entries: list[dict[str, object]] = []
        seed_entries: list[dict[str, object]] = []
        override_entries: list[dict[str, object]] = []
        for key, source, value in bindings:
            source_sha256 = hashlib.sha256(source.encode("utf-8")).hexdigest()
            value_sha256 = hashlib.sha256(value.encode("utf-8")).hexdigest()
            catalog_entries.append(
                {
                    "key": key,
                    "source": source,
                    "sourceSha256": source_sha256,
                    "segments": [{"kind": "text", "value": source}],
                }
            )
            seed = {
                "language": "Afrikaans",
                "locale": "af",
                "source": source,
                "sourceSha256": source_sha256,
                "value": value,
                "valueSha256": value_sha256,
            }
            seed_entries.append(seed)
            override_entries.append(
                {
                    **seed,
                    "requiredOccurrences": [
                        {
                            "namespace": "route:test",
                            "sourceHash": source_hash,
                            "key": key,
                        }
                    ],
                }
            )
        seed_entries.sort(key=lambda entry: entry["sourceSha256"])
        override_entries.sort(key=lambda entry: entry["sourceSha256"])
        override_material = {
            "schemaVersion": 1,
            "kind": WORKER.GENERATION_OVERRIDES_KIND,
            "entries": override_entries,
        }
        master = {
            "provenance": {
                "generationOverridesSha256": WORKER.canonical_sha256(
                    override_material
                ),
                "generationOverrideEntries": len(override_entries),
            },
            "generationOverrides": {
                **override_material,
                "generationOverridesSha256": WORKER.canonical_sha256(
                    override_material
                ),
            },
            "sources": [
                {
                    "namespace": "route:test",
                    "sourceHash": source_hash,
                    "entries": catalog_entries,
                }
            ],
            "jobs": [
                {
                    "language": "Afrikaans",
                    "locale": "af",
                    "namespace": "route:test",
                }
            ],
        }
        return master, seed_entries

    @staticmethod
    def rebind_overrides(
        master: dict[str, object],
        entries: list[dict[str, object]],
    ) -> None:
        material = {
            "schemaVersion": 1,
            "kind": WORKER.GENERATION_OVERRIDES_KIND,
            "entries": entries,
        }
        digest = WORKER.canonical_sha256(material)
        master["generationOverrides"] = {
            **material,
            "generationOverridesSha256": digest,
        }
        provenance = master["provenance"]
        if not isinstance(provenance, dict):
            raise AssertionError("override fixture provenance is malformed")
        provenance["generationOverridesSha256"] = digest
        provenance["generationOverrideEntries"] = len(entries)

    def test_full_reviewed_binding_digest_is_fixed(self) -> None:
        binding = [
            {
                "language": "Afrikaans",
                "locale": "af",
                "sourceSha256": source_sha256,
                "valueSha256": value_sha256,
            }
            for source_sha256, value_sha256 in sorted(
                WORKER.CURRENT_GENERATION_OVERRIDE_VALUE_SHA256_BY_SOURCE.items()
            )
        ]
        self.assertEqual(len(binding), 10)
        self.assertEqual(
            WORKER.canonical_sha256(binding),
            "3f8cfb3438f54bad2676a5869a60948989c7313a9bbd4634e2a6e409dadb55c5",
        )

    def test_exact_partial_binding_accepts_and_all_coordinated_drift_fails(self) -> None:
        master, seed_entries = self.fixture()
        parsed = WORKER.validated_generation_overrides(master, seed_entries)
        self.assertEqual(len(parsed), 2)
        original_entries = json.loads(
            json.dumps(master["generationOverrides"]["entries"])
        )
        mutations = [
            [],
            original_entries[:1],
            [original_entries[0], *original_entries],
            list(reversed(original_entries)),
        ]
        for entries in mutations:
            drifted = json.loads(json.dumps(master))
            self.rebind_overrides(drifted, entries)
            with self.subTest(entries=len(entries)), self.assertRaisesRegex(
                RuntimeError,
                "override|order|reviewed",
            ):
                WORKER.validated_generation_overrides(drifted, seed_entries)

        drifted = json.loads(json.dumps(master))
        drifted_seed_entries = json.loads(json.dumps(seed_entries))
        drifted_entries = json.loads(json.dumps(original_entries))
        tampered = f"{drifted_entries[0]['value']} Tampered"
        tampered_sha256 = hashlib.sha256(tampered.encode("utf-8")).hexdigest()
        drifted_entries[0]["value"] = tampered
        drifted_entries[0]["valueSha256"] = tampered_sha256
        drifted_seed_entries[0]["value"] = tampered
        drifted_seed_entries[0]["valueSha256"] = tampered_sha256
        self.rebind_overrides(drifted, drifted_entries)
        with self.assertRaisesRegex(RuntimeError, "required reviewed set"):
            WORKER.validated_generation_overrides(
                drifted,
                drifted_seed_entries,
            )

    def test_forced_cohort_layout_discards_decode_and_adopts_reviewed_value(self) -> None:
        master, seed_entries = self.fixture()
        overrides = WORKER.validated_generation_overrides(master, seed_entries)
        entry = master["sources"][0]["entries"][0]
        self.assertIsInstance(entry, dict)
        source_key = ("af", entry["sourceSha256"])
        ordinary_batches: list[list[str]] = []
        forced_batches: list[list[str]] = []

        def run_population(
            source_memory: dict[tuple[str, str], str],
            forced_keys: frozenset[tuple[str, str]],
            batches: list[list[str]],
        ) -> tuple[frozenset[tuple[str, str]], dict[tuple[str, str], str]]:
            def translate(*args: object, **kwargs: object) -> list[str]:
                del kwargs
                values = args[4]
                if not isinstance(values, list):
                    raise AssertionError("cohort fixture batch is malformed")
                batches.append(list(values))
                return [f"discarded-model-output-{index}" for index in range(len(values))]

            source_texts: dict[tuple[str, str], str] = {}
            with mock.patch.object(WORKER, "translate_batch", side_effect=translate):
                _, _, retryable = WORKER.populate_language_source_memory(
                    [entry],
                    "af",
                    "afr_Latn",
                    object(),
                    object(),
                    "mps",
                    64,
                    1,
                    4,
                    512,
                    512,
                    2,
                    object(),
                    forced_keys,
                    source_memory,
                    source_texts,
                )
            return retryable, source_memory

        ordinary_retryable, _ = run_population({}, frozenset(), ordinary_batches)
        forced_memory = {source_key: overrides[source_key]["value"]}
        forced_retryable, forced_memory = run_population(
            forced_memory,
            frozenset({source_key}),
            forced_batches,
        )
        self.assertEqual(forced_batches, ordinary_batches)
        self.assertIn(source_key, ordinary_retryable)
        self.assertIn(source_key, forced_retryable)
        self.assertNotEqual(forced_memory[source_key], overrides[source_key]["value"])
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            retryable, adopted = WORKER.adopt_reviewed_generation_overrides(
                [entry],
                "af",
                overrides,
                forced_memory,
                forced_retryable,
            )
        self.assertEqual(adopted, 1)
        self.assertEqual(forced_memory[source_key], overrides[source_key]["value"])
        self.assertNotIn(source_key, retryable)
        self.assertNotIn("discarded-model-output", output.getvalue())

        unrelated_source = "An unrelated ordinary source changes cache state."
        unrelated_sha256 = hashlib.sha256(
            unrelated_source.encode("utf-8")
        ).hexdigest()
        unrelated_entry = {
            "key": "site.unrelated",
            "source": unrelated_source,
            "sourceSha256": unrelated_sha256,
            "segments": [{"kind": "text", "value": unrelated_source}],
        }

        def forced_calls_with_unrelated_cached(cached: bool) -> list[list[str]]:
            calls: list[list[str]] = []
            memory = {source_key: overrides[source_key]["value"]}
            if cached:
                memory[("af", unrelated_sha256)] = "Gewone kaswaarde"

            def translate(*args: object, **kwargs: object) -> list[str]:
                del kwargs
                values = args[4]
                if not isinstance(values, list):
                    raise AssertionError("cache cohort fixture is malformed")
                calls.append(list(values))
                return [f"model-{index}" for index in range(len(values))]

            with mock.patch.object(WORKER, "translate_batch", side_effect=translate):
                WORKER.populate_language_source_memory(
                    [entry, unrelated_entry],
                    "af",
                    "afr_Latn",
                    object(),
                    object(),
                    "mps",
                    64,
                    1,
                    4,
                    512,
                    512,
                    2,
                    object(),
                    frozenset({source_key}),
                    memory,
                    {},
                )
            return calls

        uncached_calls = forced_calls_with_unrelated_cached(False)
        cached_calls = forced_calls_with_unrelated_cached(True)
        self.assertGreater(len(uncached_calls), len(cached_calls))
        self.assertEqual(uncached_calls[0], cached_calls[0])
        self.assertEqual(cached_calls, [forced_batches[0]])

    def test_reviewed_override_adoption_is_atomic_before_dict_update(self) -> None:
        master, seed_entries = self.fixture()
        parsed_overrides = WORKER.validated_generation_overrides(
            master,
            seed_entries,
        )
        overrides = {
            source_key: dict(override)
            for source_key, override in parsed_overrides.items()
        }
        entries = master["sources"][0]["entries"]
        self.assertEqual(len(entries), 2)
        source_keys = sorted(
            ("af", entry["sourceSha256"])
            for entry in entries
        )
        generated_values = {
            source_key: f"generated-before-adoption-{index}"
            for index, source_key in enumerate(source_keys)
        }
        source_memory = dict(generated_values)
        later_source_key = source_keys[1]
        overrides[later_source_key]["source"] = "Drifted reviewed source binding"

        with self.assertRaisesRegex(RuntimeError, "source binding drifted"):
            WORKER.adopt_reviewed_generation_overrides(
                entries,
                "af",
                overrides,
                source_memory,
                frozenset(source_keys),
            )

        self.assertEqual(source_memory, generated_values)

    def test_empty_override_decode_fails_before_adoption(self) -> None:
        master, seed_entries = self.fixture()
        overrides = WORKER.validated_generation_overrides(master, seed_entries)
        entry = master["sources"][0]["entries"][0]
        source_key = ("af", entry["sourceSha256"])
        source_memory: dict[tuple[str, str], str] = {}
        with mock.patch.object(
            WORKER,
            "translate_batch",
            side_effect=WORKER.EmptyOutputGenerationRetryExhausted(
                target_code="afr_Latn",
                batch_offset=0,
                batch_size=1,
                completed_empty_retry_rounds=2,
                case_normalized_recovery_attempted=True,
                attempted_recovery_profiles=("balanced", "coverage", "wide"),
                row_diagnostics=[f"0:{entry['sourceSha256']}"],
                omitted_rows=0,
            ),
        ), self.assertRaises(WORKER.EmptyOutputGenerationRetryExhausted):
            WORKER.populate_language_source_memory(
                [entry],
                "af",
                "afr_Latn",
                object(),
                object(),
                "mps",
                64,
                1,
                4,
                512,
                512,
                2,
                object(),
                frozenset({source_key}),
                source_memory,
                {},
            )
        self.assertNotIn(source_key, source_memory)
        self.assertIn(source_key, overrides)

    def test_resume_candidate_must_equal_reviewed_value_and_stays_withheld(self) -> None:
        master, seed_entries = self.fixture()
        overrides = WORKER.validated_generation_overrides(master, seed_entries)
        entry = master["sources"][0]["entries"][0]
        pack = {
            "job": {"locale": "af"},
            "source": {"entries": [entry]},
        }
        source_memory: dict[tuple[str, str], str] = {}
        source_texts: dict[tuple[str, str], str] = {}
        with self.assertRaisesRegex(RuntimeError, "reviewed generation override"):
            WORKER.remember_existing_candidate_values(
                pack,
                {entry["key"]: "Conflicting resumed value"},
                overrides,
                source_memory,
                source_texts,
            )
        WORKER.remember_existing_candidate_values(
            pack,
            {entry["key"]: overrides[("af", entry["sourceSha256"])]["value"]},
            overrides,
            source_memory,
            source_texts,
        )
        self.assertNotIn(("af", entry["sourceSha256"]), source_memory)


class DeterministicTerminalRescueTests(unittest.TestCase):
    @staticmethod
    def fixture() -> tuple[
        list[dict[str, object]],
        dict[tuple[str, str], str],
        dict[tuple[str, str], str],
    ]:
        locale = "af"
        sources = ("Learn carefully.", "Keep the unrelated memory entry.")
        entries: list[dict[str, object]] = []
        source_memory: dict[tuple[str, str], str] = {}
        source_texts: dict[tuple[str, str], str] = {}
        for index, source in enumerate(sources):
            source_sha256 = hashlib.sha256(source.encode("utf-8")).hexdigest()
            entry = {
                "key": f"field-{index}",
                "source": source,
                "sourceSha256": source_sha256,
                "segments": [{"kind": "text", "value": source}],
            }
            entries.append(entry)
            source_key = (locale, source_sha256)
            source_memory[source_key] = f"prior-{index}"
            source_texts[source_key] = source
        return entries, source_memory, source_texts

    @staticmethod
    def run_rescue(
        entries: list[dict[str, object]],
        source_memory: dict[tuple[str, str], str],
        source_texts: dict[tuple[str, str], str],
        *,
        primary_device: str = "mps",
    ) -> WORKER.TerminalRescueResult:
        return WORKER.run_deterministic_terminal_rescue(
            entries,
            "af",
            "afr_Latn",
            primary_device,
            Path("/private/model"),
            object(),
            1,
            4,
            512,
            512,
            1,
            object(),
            source_memory,
            source_texts,
            {},
            object(),
        )

    @staticmethod
    def successful_retry(
        calls: list[list[str]],
    ) -> object:
        def retry(*args: object) -> tuple[int, int, int]:
            entries = args[0]
            locale = args[1]
            device = args[5]
            batch_size = args[6]
            replica_memory = args[14]
            evidence_phase = args[17]
            replica_index = args[18]
            if (
                not isinstance(entries, list)
                or not isinstance(locale, str)
                or device != "cpu"
                or batch_size != 1
                or not isinstance(replica_memory, dict)
                or evidence_phase != "terminal-rescue"
                or replica_index != len(calls)
            ):
                raise AssertionError("terminal rescue call is malformed")
            source_hashes: list[str] = []
            for entry in entries:
                if not isinstance(entry, dict):
                    raise AssertionError("terminal rescue entry is malformed")
                source_sha256 = entry.get("sourceSha256")
                if not isinstance(source_sha256, str):
                    raise AssertionError("terminal rescue source hash is malformed")
                source_hashes.append(source_sha256)
                replica_memory[(locale, source_sha256)] = (
                    f"rescued-{source_sha256}"
                )
            calls.append(source_hashes)
            return len(entries), len(entries) * 2, len(entries)

        return retry

    @staticmethod
    def deterministic_context() -> contextlib.AbstractContextManager[object]:
        stack = contextlib.ExitStack()
        stack.enter_context(
            mock.patch.object(WORKER.torch, "get_num_threads", return_value=1)
        )
        stack.enter_context(
            mock.patch.object(
                WORKER.torch,
                "get_num_interop_threads",
                return_value=1,
            )
        )
        stack.enter_context(
            mock.patch.object(
                WORKER.torch,
                "are_deterministic_algorithms_enabled",
                return_value=True,
            )
        )
        stack.enter_context(
            mock.patch.object(
                WORKER.torch,
                "is_deterministic_algorithms_warn_only_enabled",
                return_value=False,
            )
        )
        stack.enter_context(
            mock.patch.object(WORKER.torch, "use_deterministic_algorithms")
        )
        stack.enter_context(mock.patch.object(WORKER.torch, "manual_seed"))
        stack.enter_context(mock.patch.object(WORKER.gc, "collect"))
        return stack

    def test_two_fresh_cpu_float32_replicas_match_and_scope_is_exact(self) -> None:
        entries, source_memory, source_texts = self.fixture()
        prior_memory = dict(source_memory)
        requested = entries[:1]
        retry_calls: list[list[str]] = []
        model_loads: list[tuple[Path, str, str]] = []

        def load(model_root: Path, device: str, dtype: str) -> object:
            model_loads.append((model_root, device, dtype))
            return object()

        with self.deterministic_context(), mock.patch.object(
            WORKER,
            "load_translation_model",
            side_effect=load,
        ), mock.patch.object(
            WORKER,
            "retry_source_entries",
            side_effect=self.successful_retry(retry_calls),
        ), mock.patch.object(
            WORKER,
            "validate_exact_source_candidate",
            return_value=WORKER.RetryCandidateValidation(
                WORKER.Counter(),
                frozenset(),
            ),
        ):
            result = self.run_rescue(
                requested,
                source_memory,
                source_texts,
            )

        requested_sha256 = requested[0]["sourceSha256"]
        self.assertIsInstance(requested_sha256, str)
        self.assertEqual(source_memory, prior_memory)
        self.assertEqual(
            model_loads,
            [
                (Path("/private/model"), "cpu", "float32"),
                (Path("/private/model"), "cpu", "float32"),
            ],
        )
        self.assertEqual(
            retry_calls,
            [[requested_sha256], [requested_sha256]],
        )
        self.assertEqual(
            set(result.source_values),
            {("af", requested_sha256)},
        )
        self.assertEqual(result.rescued_sources, 1)
        self.assertEqual(result.retried_segments, 4)
        self.assertEqual(result.attempted_replicas, 2)
        self.assertEqual(result.completed_replicas, 2)
        self.assertEqual(
            result.replica_output_map_sha256s,
            (result.output_map_sha256, result.output_map_sha256),
        )

    def test_replica_value_mismatch_fails_closed(self) -> None:
        entries, source_memory, source_texts = self.fixture()
        prior_memory = dict(source_memory)
        replica = 0

        def retry(*args: object) -> tuple[int, int, int]:
            nonlocal replica
            replica += 1
            retry_entries = args[0]
            locale = args[1]
            replica_memory = args[14]
            if (
                not isinstance(retry_entries, list)
                or not isinstance(locale, str)
                or not isinstance(replica_memory, dict)
            ):
                raise AssertionError("terminal rescue call is malformed")
            for entry in retry_entries:
                if not isinstance(entry, dict):
                    raise AssertionError("terminal rescue entry is malformed")
                source_sha256 = entry["sourceSha256"]
                replica_memory[(locale, source_sha256)] = f"replica-{replica}"
            return len(retry_entries), len(retry_entries), len(retry_entries)

        with self.deterministic_context(), mock.patch.object(
            WORKER,
            "load_translation_model",
            return_value=object(),
        ), mock.patch.object(
            WORKER,
            "retry_source_entries",
            side_effect=retry,
        ), mock.patch.object(
            WORKER,
            "validate_exact_source_candidate",
            return_value=WORKER.RetryCandidateValidation(
                WORKER.Counter(),
                frozenset(),
            ),
        ), self.assertRaises(WORKER.TerminalRescueFailed) as raised:
            self.run_rescue(entries[:1], source_memory, source_texts)

        self.assertEqual(raised.exception.reason, "replica-mismatch")
        self.assertEqual(raised.exception.stage, "replica-comparison")
        self.assertEqual(raised.exception.subtype, "output-map-mismatch")
        self.assertEqual(raised.exception.attempted_replicas, 2)
        self.assertEqual(raised.exception.completed_replicas, 2)
        self.assertIsNone(raised.exception.failing_replica_index)
        self.assertEqual(source_memory, prior_memory)

    def test_invalid_first_replica_short_circuits_before_second_model_load(
        self,
    ) -> None:
        entries, source_memory, source_texts = self.fixture()
        prior_memory = dict(source_memory)
        model_loads: list[tuple[Path, str, str]] = []
        retry_calls: list[tuple[str, int]] = []

        def load(model_root: Path, device: str, dtype: str) -> object:
            model_loads.append((model_root, device, dtype))
            return object()

        def retry(*args: object) -> tuple[int, int, int]:
            evidence_phase = args[17]
            replica_index = args[18]
            if not isinstance(evidence_phase, str) or not isinstance(
                replica_index,
                int,
            ):
                raise AssertionError("terminal rescue evidence is malformed")
            retry_calls.append((evidence_phase, replica_index))
            return (1, 2, 0)

        with self.deterministic_context(), mock.patch.object(
            WORKER,
            "load_translation_model",
            side_effect=load,
        ), mock.patch.object(
            WORKER,
            "retry_source_entries",
            side_effect=retry,
        ), mock.patch.object(
            WORKER,
            "validate_exact_source_candidate",
            side_effect=AssertionError(
                "invalid first replica must stop before post-validation"
            ),
        ), self.assertRaises(WORKER.TerminalRescueFailed) as raised:
            self.run_rescue(entries[:1], source_memory, source_texts)

        failure = raised.exception
        self.assertEqual(failure.reason, "replica-invalid")
        self.assertEqual(failure.stage, "replica-generation")
        self.assertEqual(failure.subtype, "no-strict-improvement")
        self.assertEqual(failure.attempted_replicas, 1)
        self.assertEqual(failure.completed_replicas, 0)
        self.assertEqual(failure.failing_replica_index, 0)
        self.assertEqual(
            failure.failure_sha256,
            WORKER.canonical_sha256(failure.evidence_summary()),
        )
        self.assertEqual(
            model_loads,
            [(Path("/private/model"), "cpu", "float32")],
        )
        self.assertEqual(retry_calls, [("terminal-rescue", 0)])
        self.assertEqual(source_memory, prior_memory)

    def test_invalid_second_replica_fails_closed(self) -> None:
        entries, source_memory, source_texts = self.fixture()
        prior_memory = dict(source_memory)
        validations = 0
        retry_calls: list[list[str]] = []

        def validate(*_args: object) -> WORKER.RetryCandidateValidation:
            nonlocal validations
            validations += 1
            failures = WORKER.Counter()
            if validations == 2:
                failures["field-invalid"] += 1
            return WORKER.RetryCandidateValidation(failures, frozenset())

        with self.deterministic_context(), mock.patch.object(
            WORKER,
            "load_translation_model",
            return_value=object(),
        ), mock.patch.object(
            WORKER,
            "retry_source_entries",
            side_effect=self.successful_retry(retry_calls),
        ), mock.patch.object(
            WORKER,
            "validate_exact_source_candidate",
            side_effect=validate,
        ), self.assertRaises(WORKER.TerminalRescueFailed) as raised:
            self.run_rescue(entries[:1], source_memory, source_texts)

        self.assertEqual(raised.exception.reason, "replica-invalid")
        self.assertEqual(raised.exception.stage, "replica-validation")
        self.assertEqual(
            raised.exception.subtype,
            "post-generation-validation-failed",
        )
        self.assertEqual(raised.exception.attempted_replicas, 2)
        self.assertEqual(raised.exception.completed_replicas, 1)
        self.assertEqual(raised.exception.failing_replica_index, 1)
        self.assertEqual(source_memory, prior_memory)

    def test_model_load_and_generation_failures_fail_closed(self) -> None:
        for phase in ("load", "generation"):
            with self.subTest(phase=phase):
                entries, source_memory, source_texts = self.fixture()
                prior_memory = dict(source_memory)
                load_failure = (
                    RuntimeError("bounded load failure")
                    if phase == "load"
                    else None
                )
                retry_failure = (
                    RuntimeError("bounded generation failure")
                    if phase == "generation"
                    else None
                )
                with self.deterministic_context(), mock.patch.object(
                    WORKER,
                    "load_translation_model",
                    return_value=object(),
                    side_effect=load_failure,
                ), mock.patch.object(
                    WORKER,
                    "retry_source_entries",
                    side_effect=retry_failure,
                ), self.assertRaises(WORKER.TerminalRescueFailed) as raised:
                    self.run_rescue(entries[:1], source_memory, source_texts)
                self.assertEqual(
                    raised.exception.reason,
                    "model-load-or-generation-failed",
                )
                self.assertEqual(
                    raised.exception.stage,
                    "replica-model-load" if phase == "load" else "replica-generation",
                )
                self.assertEqual(
                    raised.exception.subtype,
                    "model-load-error" if phase == "load" else "generation-error",
                )
                self.assertEqual(raised.exception.attempted_replicas, 1)
                self.assertEqual(raised.exception.completed_replicas, 0)
                self.assertEqual(raised.exception.failing_replica_index, 0)
                self.assertEqual(source_memory, prior_memory)

    def test_cpu_primary_and_invalid_exact_source_scope_never_load_rescue(
        self,
    ) -> None:
        entries, source_memory, source_texts = self.fixture()
        for primary_device, rescue_entries in (
            ("cpu", entries[:1]),
            (
                "mps",
                [
                    {
                        **entries[0],
                        "sourceSha256": "0" * 64,
                    }
                ],
            ),
        ):
            with self.subTest(primary_device=primary_device), mock.patch.object(
                WORKER,
                "load_translation_model",
            ) as load_model:
                with self.assertRaises(WORKER.TerminalRescueFailed) as raised:
                    self.run_rescue(
                        rescue_entries,
                        source_memory,
                        source_texts,
                        primary_device=primary_device,
                    )
                self.assertEqual(
                    raised.exception.reason,
                    (
                        "configuration-invalid"
                        if primary_device == "cpu"
                        else "exact-source-scope-invalid"
                    ),
                )
                self.assertEqual(
                    (raised.exception.stage, raised.exception.subtype),
                    (
                        ("preflight", "primary-device-not-mps")
                        if primary_device == "cpu"
                        else (
                            "scope-validation",
                            "source-entry-integrity-failed",
                        )
                    ),
                )
                self.assertEqual(raised.exception.attempted_replicas, 0)
                self.assertEqual(raised.exception.completed_replicas, 0)
                self.assertIsNone(raised.exception.failing_replica_index)
                load_model.assert_not_called()


class FailedLanguageIsolationTests(unittest.TestCase):
    class FakeModel:
        def to(self, device: str) -> "FailedLanguageIsolationTests.FakeModel":
            del device
            return self

        def eval(self) -> "FailedLanguageIsolationTests.FakeModel":
            return self

    def run_worker(
        self,
        validator_failure: str,
        *,
        include_partial_checkpoint_packs: bool = False,
        terminal_rescue_outcome: str | None = None,
    ) -> dict[str, object]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            worklist_root = root / "worklists"
            candidate_root = root / "candidates"
            model_root = root / "model"
            worklist_root.mkdir()
            candidate_root.mkdir()
            model_root.mkdir()
            master_path = root / "master.json"
            pipeline_path = root / "pipeline.ts"
            node_path = root / "node"
            master_path.write_text("{}\n", encoding="utf-8")
            pipeline_path.write_text("export {};\n", encoding="utf-8")
            node_path.write_text("#!/bin/sh\n", encoding="utf-8")
            node_path.chmod(0o700)

            model_sha256 = "a" * 64
            worker_sha256 = "b" * 64
            pipeline_sha256 = "c" * 64
            validator_policy_sha256 = "d" * 64
            master_sha256 = "e" * 64
            use_mps = terminal_rescue_outcome is not None
            generation = {
                "batchSize": 2,
                "numBeams": 1,
                "noRepeatNgramSize": 4,
                "dtype": "float16" if use_mps else "float32",
                "device": "mps" if use_mps else "cpu",
                "maxSourceTokens": 512,
                "maxNewTokens": 512,
                "maxRetryAttempts": 1,
                "deterministicAlgorithms": True,
                "manualSeed": 0,
            }
            provenance = {
                "pipelineVersion": WORKER.PIPELINE_VERSION,
                "executionProfile": WORKER.EXECUTION_PROFILE,
                "modelLabel": "bounded-test-model",
                "modelSha256": model_sha256,
                "workerImplementationSha256": worker_sha256,
                "pipelineImplementationSha256": pipeline_sha256,
                "validatorPolicy": {
                    "validatorPolicySha256": validator_policy_sha256,
                },
                "generationConfig": generation,
            }
            job_specs = [
                {
                    "language": "Afrikaans",
                    "locale": "af",
                    "nllbCode": "afr_Latn",
                    "namespace": "common",
                    "candidateRelativePath": "Afrikaans.json",
                    "source": "private source 0",
                },
                {
                    "language": "Zulu",
                    "locale": "zu",
                    "nllbCode": "zul_Latn",
                    "namespace": "common",
                    "candidateRelativePath": "Zulu.json",
                    "source": "private source 1",
                },
            ]
            if include_partial_checkpoint_packs:
                job_specs[1:1] = [
                    {
                        "language": "Afrikaans",
                        "locale": "af",
                        "nllbCode": "afr_Latn",
                        "namespace": "passing-unique",
                        "candidateRelativePath": "Afrikaans-passing.json",
                        "source": "private passing source",
                    },
                    {
                        "language": "Afrikaans",
                        "locale": "af",
                        "nllbCode": "afr_Latn",
                        "namespace": "passing-shared",
                        "candidateRelativePath": "Afrikaans-shared.json",
                        "source": "private source 0",
                    },
                ]
            jobs: list[dict[str, object]] = []
            packs: dict[str, dict[str, object]] = {}
            source_text_by_language: dict[str, str] = {}
            for index, spec in enumerate(job_specs):
                language = spec["language"]
                locale = spec["locale"]
                nllb_code = spec["nllbCode"]
                namespace = spec["namespace"]
                candidate_relative_path = spec["candidateRelativePath"]
                source = spec["source"]
                if not all(
                    isinstance(value, str)
                    for value in (
                        language,
                        locale,
                        nllb_code,
                        namespace,
                        candidate_relative_path,
                        source,
                    )
                ):
                    raise AssertionError("fixture job specification is malformed")
                source_sha256 = hashlib.sha256(source.encode("utf-8")).hexdigest()
                source_text_by_language.setdefault(language, source)
                job = {
                    "language": language,
                    "locale": locale,
                    "nllbCode": nllb_code,
                    "namespace": namespace,
                    "sourceHash": hashlib.sha256(
                        f"namespace-{index}-{namespace}".encode("utf-8")
                    ).hexdigest(),
                    "sourceEntriesSha256": hashlib.sha256(
                        f"entries-{index}".encode("utf-8")
                    ).hexdigest(),
                    "jobSha256": hashlib.sha256(
                        f"job-{index}".encode("utf-8")
                    ).hexdigest(),
                    "entryCount": 1,
                    "worklistRelativePath": candidate_relative_path,
                    "candidateRelativePath": candidate_relative_path,
                }
                entry = {
                    "key": "title",
                    "source": source,
                    "sourceSha256": source_sha256,
                    "segments": [{"kind": "text", "value": source}],
                }
                jobs.append(job)
                packs[candidate_relative_path] = {
                    "masterWorklistSha256": master_sha256,
                    "packWorklistSha256": hashlib.sha256(
                        f"pack-{index}".encode("utf-8")
                    ).hexdigest(),
                    "job": job,
                    "provenance": provenance,
                    "source": {"entries": [entry]},
                }
            master = {
                "jobs": jobs,
                "provenance": provenance,
            }
            args = WORKER.argparse.Namespace(
                master_worklist=str(master_path),
                worklist_root=str(worklist_root),
                candidate_root=str(candidate_root),
                model=str(model_root),
                model_sha256=model_sha256,
                worker_implementation_sha256=worker_sha256,
                pipeline_script=str(pipeline_path),
                pipeline_implementation_sha256=pipeline_sha256,
                validator_policy_sha256=validator_policy_sha256,
                execution_profile_json=WORKER.canonical_json(
                    WORKER.EXECUTION_PROFILE
                ),
                execution_profile_sha256=WORKER.EXECUTION_PROFILE_SHA256,
                node=str(node_path),
                worker_index=0,
                worker_count=1,
                batch_size=2,
                num_beams=1,
                no_repeat_ngram_size=4,
                max_source_tokens=512,
                max_new_tokens=512,
                max_retry_attempts=1,
                dtype="float16" if use_mps else "float32",
                device="mps" if use_mps else "cpu",
            )
            timeline: list[str] = []
            retry_calls: list[str] = []
            model_loads: list[tuple[str, str]] = []
            release_calls: list[str] = []
            terminal_rescue_calls: list[list[str]] = []

            class Validator:
                def __init__(self, *constructor_args: object) -> None:
                    del constructor_args

                def validate(
                    self,
                    pack: dict[str, object],
                    values: dict[str, str],
                ) -> list[dict[str, object]]:
                    job = pack["job"]
                    if not isinstance(job, dict):
                        raise AssertionError("fixture job is malformed")
                    language = job["language"]
                    if not isinstance(language, str):
                        raise AssertionError("fixture language is malformed")
                    timeline.append(f"validate:{language}")
                    if (
                        language != "Afrikaans"
                        or job.get("namespace") != "common"
                    ):
                        return []
                    if validator_failure == "integrity":
                        raise RuntimeError("validator integrity failure")
                    if values.get("title", "").startswith("rescued-"):
                        return []
                    return [
                        {
                            "key": "title",
                            "reasons": ["field-invalid"],
                            "fluencyReason": None,
                        }
                    ]

                def close(self) -> None:
                    timeline.append("validator:closed")
                    print(json.dumps({"event": "test_validator_closed"}))

            def read_fixture(path: Path, maximum_bytes: int = 0) -> object:
                del maximum_bytes
                if path == master_path:
                    return master
                return packs[path.name]

            def populate_memory(
                *populate_args: object,
            ) -> tuple[int, int, frozenset[tuple[str, str]]]:
                entries = populate_args[0]
                locale = populate_args[1]
                source_memory = populate_args[-2]
                source_texts = populate_args[-1]
                if (
                    not isinstance(entries, list)
                    or not isinstance(locale, str)
                    or not isinstance(source_memory, dict)
                    or not isinstance(source_texts, dict)
                ):
                    raise AssertionError("populate fixture arguments are malformed")
                if locale == "af" and validator_failure in (
                    "generation",
                    "generation-integrity",
                ):
                    source = entries[0]
                    if not isinstance(source, dict) or not isinstance(
                        source.get("sourceSha256"), str
                    ):
                        raise AssertionError("generation fixture source is malformed")
                    if validator_failure == "generation-integrity":
                        raise RuntimeError("NLLB output reached its token bound without EOS")
                    raise WORKER.EmptyOutputGenerationRetryExhausted(
                        target_code="afr_Latn",
                        batch_offset=96,
                        batch_size=1,
                        completed_empty_retry_rounds=1,
                        case_normalized_recovery_attempted=True,
                        attempted_recovery_profiles=(
                            "balanced",
                            "coverage",
                            "wide",
                        ),
                        row_diagnostics=[f"0:{source['sourceSha256']}"],
                        omitted_rows=0,
                    )
                retryable: set[tuple[str, str]] = set()
                for entry in entries:
                    if not isinstance(entry, dict):
                        raise AssertionError("populate fixture entry is malformed")
                    source = entry["source"]
                    source_sha256 = entry["sourceSha256"]
                    if not isinstance(source, str) or not isinstance(source_sha256, str):
                        raise AssertionError("populate fixture source is malformed")
                    key = (locale, source_sha256)
                    source_memory[key] = f"translated-{locale}"
                    source_texts[key] = source
                    retryable.add(key)
                return len(retryable), len(retryable), frozenset(retryable)

            def retry_sources(*retry_args: object) -> tuple[int, int, int]:
                entries = retry_args[0]
                if not isinstance(entries, list) or not entries:
                    raise AssertionError("retry fixture entries are malformed")
                source = entries[0]
                if not isinstance(source, dict) or not isinstance(
                    source.get("sourceSha256"), str
                ):
                    raise AssertionError("retry fixture source is malformed")
                retry_calls.append(source["sourceSha256"])
                if validator_failure == "retry-generation":
                    raise WORKER.EmptyOutputGenerationRetryExhausted(
                        target_code="afr_Latn",
                        batch_offset=0,
                        batch_size=1,
                        completed_empty_retry_rounds=1,
                        case_normalized_recovery_attempted=False,
                        attempted_recovery_profiles=(
                            "balanced",
                            "coverage",
                            "wide",
                        ),
                        row_diagnostics=[f"0:{source['sourceSha256']}"],
                        omitted_rows=0,
                    )
                if validator_failure == "profile-generation":
                    raise WORKER.SourceDecodeProfilesRetryExhausted(
                        source["sourceSha256"],
                        1,
                        ("balanced", "wide", "coverage"),
                    )
                return (1, 1, 0)

            def load_model(
                _model_root: Path,
                load_device: str,
                load_dtype: str,
            ) -> FailedLanguageIsolationTests.FakeModel:
                model_loads.append((load_device, load_dtype))
                return self.FakeModel()

            def release_model() -> None:
                release_calls.append("released")

            def terminal_rescue(*rescue_args: object) -> WORKER.TerminalRescueResult:
                entries = rescue_args[0]
                locale = rescue_args[1]
                if not isinstance(entries, list) or not isinstance(locale, str):
                    raise AssertionError("terminal rescue fixture is malformed")
                source_values: dict[tuple[str, str], str] = {}
                source_sha256s: list[str] = []
                for entry in entries:
                    if not isinstance(entry, dict):
                        raise AssertionError("terminal rescue entry is malformed")
                    source_sha256 = entry.get("sourceSha256")
                    if not isinstance(source_sha256, str):
                        raise AssertionError("terminal rescue hash is malformed")
                    source_sha256s.append(source_sha256)
                    source_values[(locale, source_sha256)] = (
                        f"rescued-{source_sha256}"
                    )
                terminal_rescue_calls.append(source_sha256s)
                if terminal_rescue_outcome == "failure":
                    raise WORKER.TerminalRescueFailed(
                        "replica-invalid",
                        stage="replica-generation",
                        subtype="no-strict-improvement",
                        attempted_replicas=1,
                        completed_replicas=0,
                        failing_replica_index=0,
                    )
                if terminal_rescue_outcome != "success":
                    raise AssertionError("CPU-primary worker invoked terminal rescue")
                output_map_sha256 = WORKER.canonical_sha256(
                    [
                        {
                            "locale": source_key[0],
                            "sourceSha256": source_key[1],
                            "value": value,
                        }
                        for source_key, value in sorted(source_values.items())
                    ]
                )
                return WORKER.TerminalRescueResult(
                    source_values=source_values,
                    source_set_sha256=WORKER.canonical_sha256(source_sha256s),
                    output_map_sha256=output_map_sha256,
                    replica_output_map_sha256s=(
                        output_map_sha256,
                        output_map_sha256,
                    ),
                    rescued_sources=len(source_values),
                    retried_segments=len(source_values) * 2,
                    attempted_replicas=2,
                    completed_replicas=2,
                )

            output = io.StringIO()
            result: int | None = None
            raised: Exception | None = None
            worker_patches = {
                "parse_args": mock.Mock(return_value=args),
                "implementation_sha256": mock.Mock(return_value=worker_sha256),
                "read_json": mock.Mock(side_effect=read_fixture),
                "validate_master": mock.Mock(return_value=master),
                "assert_current_validator_policy": mock.Mock(),
                "validated_seed_entries": mock.Mock(return_value=[]),
                "validated_generation_overrides": mock.Mock(return_value={}),
                "validate_pack": mock.Mock(
                    side_effect=lambda value, *_args: value
                ),
                "hash_model": mock.Mock(return_value=model_sha256),
                "numeric_logits_processor": mock.Mock(return_value=object()),
                "load_translation_model": mock.Mock(side_effect=load_model),
                "populate_language_source_memory": mock.Mock(
                    side_effect=populate_memory
                ),
                "retry_source_entries": mock.Mock(side_effect=retry_sources),
                "release_primary_mps_model": mock.Mock(
                    side_effect=release_model
                ),
                "run_deterministic_terminal_rescue": mock.Mock(
                    side_effect=terminal_rescue
                ),
                "TypeScriptCandidateValidator": Validator,
            }
            with mock.patch.multiple(WORKER, **worker_patches), mock.patch.object(
                WORKER.AutoTokenizer,
                "from_pretrained",
                return_value=type(
                    "Tokenizer",
                    (),
                    {
                        "eos_token_id": 2,
                        "unk_token_id": 3,
                        "convert_tokens_to_ids": lambda self, value: 4,
                    },
                )(),
            ), mock.patch.object(
                WORKER.torch.backends.mps,
                "is_available",
                return_value=use_mps,
            ), mock.patch.object(
                WORKER.torch.mps,
                "empty_cache",
            ), contextlib.redirect_stdout(output):
                try:
                    result = WORKER.main()
                except RuntimeError as error:
                    raised = error

            candidates = {
                path.name: json.loads(path.read_text(encoding="utf-8"))
                for path in candidate_root.glob("*.json")
            }
            return {
                "result": result,
                "raised": raised,
                "events": [
                    json.loads(line)
                    for line in output.getvalue().splitlines()
                    if line.strip()
                ],
                "output": output.getvalue(),
                "timeline": timeline,
                "retryCalls": retry_calls,
                "modelLoads": model_loads,
                "releaseCalls": release_calls,
                "terminalRescueCalls": terminal_rescue_calls,
                "candidates": candidates,
                "sources": source_text_by_language,
            }

    def test_retry_exhaustion_isolated_to_one_language_and_exits_after_close(
        self,
    ) -> None:
        result = self.run_worker("validation")
        self.assertIsNone(result["raised"])
        self.assertEqual(result["result"], 1)
        self.assertEqual(
            result["timeline"],
            ["validate:Afrikaans", "validate:Afrikaans", "validate:Zulu", "validator:closed"],
        )
        self.assertEqual(len(result["retryCalls"]), 1)
        candidates = result["candidates"]
        self.assertIsInstance(candidates, dict)
        self.assertNotIn("Afrikaans.json", candidates)
        self.assertIn("Zulu.json", candidates)

        events = result["events"]
        self.assertIsInstance(events, list)
        event_names = [event["event"] for event in events]
        self.assertIn("long_tail_worker_language_failed", event_names)
        self.assertIn("long_tail_worker_language_complete", event_names)
        self.assertLess(
            event_names.index("test_validator_closed"),
            event_names.index("long_tail_worker_failed_languages"),
        )
        aggregate = next(
            event
            for event in events
            if event["event"] == "long_tail_worker_failed_languages"
        )
        self.assertEqual(aggregate["failedLanguageCount"], 1)
        self.assertEqual(
            aggregate["failedLanguages"][0]["languageSha256"],
            hashlib.sha256(b"Afrikaans").hexdigest(),
        )
        self.assertEqual(
            aggregate["failedLanguageReasons"],
            {"field-invalid": 1},
        )
        sources = result["sources"]
        self.assertIsInstance(sources, dict)
        self.assertNotIn(sources["Afrikaans"], result["output"])

    def test_mps_retry_exhaustion_adopts_only_successful_terminal_rescue(
        self,
    ) -> None:
        result = self.run_worker(
            "validation",
            terminal_rescue_outcome="success",
        )
        self.assertIsNone(result["raised"])
        self.assertEqual(result["result"], 0)
        self.assertEqual(result["releaseCalls"], ["released"])
        self.assertEqual(
            result["modelLoads"],
            [("mps", "float16"), ("mps", "float16")],
        )
        terminal_calls = result["terminalRescueCalls"]
        self.assertIsInstance(terminal_calls, list)
        self.assertEqual(len(terminal_calls), 1)
        self.assertEqual(len(terminal_calls[0]), 1)
        candidates = result["candidates"]
        self.assertIsInstance(candidates, dict)
        self.assertIn("Afrikaans.json", candidates)
        self.assertIn("Zulu.json", candidates)

        events = result["events"]
        self.assertIsInstance(events, list)
        event_names = [event["event"] for event in events]
        self.assertIn("long_tail_worker_terminal_rescue_start", event_names)
        self.assertIn("long_tail_worker_terminal_rescue_complete", event_names)
        self.assertNotIn("long_tail_worker_terminal_rescue_failed", event_names)
        self.assertNotIn("long_tail_worker_language_partial_checkpoint", event_names)
        complete = next(
            event
            for event in events
            if event["event"] == "long_tail_worker_terminal_rescue_complete"
        )
        self.assertEqual(complete["device"], "cpu")
        self.assertEqual(complete["dtype"], "float32")
        self.assertEqual(complete["independentDecodes"], 2)
        self.assertEqual(complete["configuredIndependentDecodes"], 2)
        self.assertEqual(complete["attemptedReplicas"], 2)
        self.assertEqual(complete["completedReplicas"], 2)
        self.assertIsNone(complete["failingReplicaIndex"])
        self.assertTrue(complete["deterministicAlgorithms"])
        self.assertEqual(
            complete["replicaOutputMapSha256s"],
            [complete["outputMapSha256"], complete["outputMapSha256"]],
        )

    def test_failed_terminal_rescue_keeps_existing_partial_checkpoint_path(
        self,
    ) -> None:
        result = self.run_worker(
            "validation",
            include_partial_checkpoint_packs=True,
            terminal_rescue_outcome="failure",
        )
        self.assertIsNone(result["raised"])
        self.assertEqual(result["result"], 1)
        self.assertEqual(result["releaseCalls"], ["released"])
        self.assertEqual(
            result["modelLoads"],
            [("mps", "float16"), ("mps", "float16")],
        )
        candidates = result["candidates"]
        self.assertIsInstance(candidates, dict)
        self.assertNotIn("Afrikaans.json", candidates)
        self.assertIn("Afrikaans-passing.json", candidates)
        self.assertNotIn("Afrikaans-shared.json", candidates)
        self.assertIn("Zulu.json", candidates)

        events = result["events"]
        self.assertIsInstance(events, list)
        event_names = [event["event"] for event in events]
        self.assertLess(
            event_names.index("long_tail_worker_terminal_rescue_failed"),
            event_names.index("long_tail_worker_language_partial_checkpoint"),
        )
        failure = next(
            event
            for event in events
            if event["event"] == "long_tail_worker_terminal_rescue_failed"
        )
        self.assertEqual(failure["reason"], "replica-invalid")
        self.assertEqual(failure["stage"], "replica-generation")
        self.assertEqual(failure["subtype"], "no-strict-improvement")
        self.assertEqual(failure["configuredIndependentDecodes"], 2)
        self.assertEqual(failure["attemptedReplicas"], 1)
        self.assertEqual(failure["completedReplicas"], 0)
        self.assertEqual(failure["failingReplicaIndex"], 0)
        self.assertIsNone(failure["causeType"])
        self.assertIsNone(failure["causeMessageSha256"])
        self.assertRegex(failure["failureSha256"], r"^[0-9a-f]{64}$")
        failure_material = {
            key: failure[key]
            for key in (
                "reason",
                "stage",
                "subtype",
                "configuredIndependentDecodes",
                "attemptedReplicas",
                "completedReplicas",
                "failingReplicaIndex",
                "causeType",
                "causeMessageSha256",
            )
        }
        self.assertEqual(
            failure["failureSha256"],
            WORKER.canonical_sha256(failure_material),
        )
        self.assertNotIn("source", failure)
        self.assertNotIn("value", failure)

    def test_retry_exhaustion_checkpoints_only_independent_validated_packs(
        self,
    ) -> None:
        result = self.run_worker(
            "validation",
            include_partial_checkpoint_packs=True,
        )
        self.assertIsNone(result["raised"])
        self.assertEqual(result["result"], 1)
        candidates = result["candidates"]
        self.assertIsInstance(candidates, dict)
        self.assertNotIn("Afrikaans.json", candidates)
        self.assertIn("Afrikaans-passing.json", candidates)
        self.assertNotIn("Afrikaans-shared.json", candidates)
        self.assertIn("Zulu.json", candidates)

        events = result["events"]
        self.assertIsInstance(events, list)
        checkpoint = next(
            event
            for event in events
            if event["event"] == "long_tail_worker_language_partial_checkpoint"
        )
        self.assertEqual(checkpoint["language"], "Afrikaans")
        self.assertEqual(checkpoint["writtenPacks"], 1)
        self.assertEqual(checkpoint["failedPacks"], 1)
        self.assertEqual(checkpoint["sharedSourceBlockedPacks"], 1)
        self.assertEqual(checkpoint["blockedPacks"], 2)
        self.assertEqual(checkpoint["blockedSources"], 1)

    def _assert_retry_generation_exhaustion_checkpoints_independent_validated_packs(
        self,
        failure: str,
    ) -> None:
        result = self.run_worker(
            failure,
            include_partial_checkpoint_packs=True,
        )
        self.assertIsNone(result["raised"])
        self.assertEqual(result["result"], 1)
        candidates = result["candidates"]
        self.assertIsInstance(candidates, dict)
        self.assertNotIn("Afrikaans.json", candidates)
        self.assertIn("Afrikaans-passing.json", candidates)
        self.assertNotIn("Afrikaans-shared.json", candidates)
        self.assertIn("Zulu.json", candidates)

        events = result["events"]
        self.assertIsInstance(events, list)
        checkpoint = next(
            event
            for event in events
            if event["event"] == "long_tail_worker_language_partial_checkpoint"
        )
        self.assertEqual(checkpoint["language"], "Afrikaans")
        self.assertEqual(checkpoint["writtenPacks"], 1)
        self.assertEqual(checkpoint["failedPacks"], 1)
        self.assertEqual(checkpoint["sharedSourceBlockedPacks"], 1)
        self.assertEqual(checkpoint["blockedPacks"], 2)
        self.assertEqual(checkpoint["blockedSources"], 1)
        event_names = [event["event"] for event in events]
        self.assertLess(
            event_names.index("long_tail_worker_language_partial_checkpoint"),
            event_names.index("long_tail_worker_language_failed"),
        )

    def test_retry_generation_exhaustion_checkpoints_independent_validated_packs(
        self,
    ) -> None:
        for failure in ("retry-generation", "profile-generation"):
            with self.subTest(failure=failure):
                self._assert_retry_generation_exhaustion_checkpoints_independent_validated_packs(
                    failure
                )

    def test_integrity_error_is_immediate_fatal_and_is_never_isolated(self) -> None:
        result = self.run_worker("integrity")
        self.assertIsNone(result["result"])
        self.assertIsInstance(result["raised"], RuntimeError)
        self.assertEqual(str(result["raised"]), "validator integrity failure")
        self.assertEqual(
            result["timeline"],
            ["validate:Afrikaans", "validator:closed"],
        )
        self.assertEqual(result["retryCalls"], [])
        self.assertEqual(result["candidates"], {})
        event_names = [event["event"] for event in result["events"]]
        self.assertNotIn("long_tail_worker_language_failed", event_names)
        self.assertNotIn("long_tail_worker_failed_languages", event_names)

    def test_source_generation_exhaustion_isolated_before_validation(self) -> None:
        result = self.run_worker("generation")
        self.assertIsNone(result["raised"])
        self.assertEqual(result["result"], 1)
        self.assertEqual(
            result["timeline"],
            ["validate:Zulu", "validator:closed"],
        )
        candidates = result["candidates"]
        self.assertIsInstance(candidates, dict)
        self.assertNotIn("Afrikaans.json", candidates)
        self.assertIn("Zulu.json", candidates)
        events = result["events"]
        self.assertIsInstance(events, list)
        aggregate = next(
            event
            for event in events
            if event["event"] == "long_tail_worker_failed_languages"
        )
        self.assertEqual(aggregate["failedLanguageReasons"], {"empty-output": 1})
        failure = aggregate["failedLanguages"][0]
        self.assertEqual(failure["failureKind"], "source-generation")
        self.assertEqual(
            failure["generationFailure"]["emptyRowDiagnostics"],
            [
                "0:"
                + hashlib.sha256(result["sources"]["Afrikaans"].encode("utf-8")).hexdigest()
            ],
        )
        self.assertNotIn(result["sources"]["Afrikaans"], result["output"])

    def test_retry_generation_exhaustion_isolated_before_next_language(self) -> None:
        result = self.run_worker("retry-generation")
        self.assertIsNone(result["raised"])
        self.assertEqual(result["result"], 1)
        self.assertEqual(
            result["timeline"],
            ["validate:Afrikaans", "validate:Zulu", "validator:closed"],
        )
        candidates = result["candidates"]
        self.assertIsInstance(candidates, dict)
        self.assertNotIn("Afrikaans.json", candidates)
        self.assertIn("Zulu.json", candidates)

    def test_profile_generation_exhaustion_uses_generic_language_boundary(
        self,
    ) -> None:
        result = self.run_worker("profile-generation")
        self.assertIsNone(result["raised"])
        self.assertEqual(result["result"], 1)
        self.assertEqual(
            result["timeline"],
            ["validate:Afrikaans", "validate:Zulu", "validator:closed"],
        )
        candidates = result["candidates"]
        self.assertIsInstance(candidates, dict)
        self.assertNotIn("Afrikaans.json", candidates)
        self.assertIn("Zulu.json", candidates)
        aggregate = next(
            event
            for event in result["events"]
            if event["event"] == "long_tail_worker_failed_languages"
        )
        self.assertEqual(
            aggregate["failedLanguageReasons"],
            {"decode-profile-exhausted": 1},
        )

    def test_source_generation_integrity_error_remains_immediate_fatal(self) -> None:
        result = self.run_worker("generation-integrity")
        self.assertIsNone(result["result"])
        self.assertIsInstance(result["raised"], RuntimeError)
        self.assertIn("without EOS", str(result["raised"]))
        self.assertEqual(result["timeline"], ["validator:closed"])
        self.assertEqual(result["candidates"], {})
        event_names = [event["event"] for event in result["events"]]
        self.assertNotIn("long_tail_worker_language_failed", event_names)
        self.assertNotIn("long_tail_worker_failed_languages", event_names)


class SelectiveEmptyOutputRetryTests(unittest.TestCase):
    def test_audited_normalization_rejects_acronyms_and_unreviewed_contexts(
        self,
    ) -> None:
        self.assertEqual(
            WORKER.audited_empty_output_source_normalization(
                "als_Latn",
                "STATUTES,",
            ),
            "Statutes,",
        )
        for target_code, source in (
            ("als_Latn", "US"),
            ("als_Latn", "AI"),
            ("als_Latn", "CCPA"),
            ("als_Latn", "PCI-DSS"),
            ("als_Latn", "STATUTES"),
            ("als_Latn", " STATUTES,"),
            ("als_Latn", "STATUTES, "),
            ("als_Latn", "STATUTES,\n"),
            ("afr_Latn", "STATUTES,"),
        ):
            with self.subTest(target_code=target_code, source=source):
                self.assertIsNone(
                    WORKER.audited_empty_output_source_normalization(
                        target_code,
                        source,
                    )
                )
        self.assertTrue(
            WORKER.is_empty_or_audited_source_echo(
                "als_Latn",
                "STATUTES,",
                "STATUTES,",
            )
        )
        self.assertTrue(
            WORKER.is_empty_or_audited_source_echo(
                "als_Latn",
                "STATUTES,",
                " Statutes, ",
            )
        )
        self.assertFalse(
            WORKER.is_empty_or_audited_source_echo(
                "als_Latn",
                "STATUTES,",
                "STATUTET,",
            )
        )
        self.assertFalse(
            WORKER.is_empty_or_audited_source_echo(
                "als_Latn",
                "UNREVIEWED,",
                "UNREVIEWED,",
            )
        )

    def test_retries_only_the_empty_tags_row_and_keeps_siblings(self) -> None:
        values = [
            "job,",
            "map,",
            "open",
            "post",
            "sex,",
            "tag,",
            "tags",
            "use,",
            '"Plan',
            '"Read',
            '"us",',
            '"we",',
            "Avoid",
            "Back:",
            "Dates",
            "Easy.",
        ]
        first_outputs = [f"translation-{index}" for index in range(len(values))]
        first_outputs[6] = ""
        calls: list[tuple[list[str], int]] = []

        def generate(*args: object) -> list[str]:
            retry_values = list(args[4])
            attempt = int(args[10])
            calls.append((retry_values, attempt))
            if attempt == 0:
                return list(first_outputs)
            self.assertEqual(retry_values, ["tags"])
            self.assertEqual(attempt, 1)
            return ["etikette"]

        output = io.StringIO()
        with mock.patch.object(
            WORKER,
            "generate_translation_batch_once",
            side_effect=generate,
        ), contextlib.redirect_stdout(output):
            translated = run_translate(values, maximum_retries=2, batch_offset=48)

        expected = list(first_outputs)
        expected[6] = "etikette"
        self.assertEqual(translated, expected)
        self.assertEqual(calls, [(values, 0), (["tags"], 1)])
        event = json.loads(output.getvalue())
        self.assertEqual(event["event"], "long_tail_worker_empty_output_retry")
        self.assertEqual(event["targetCode"], "afr_Latn")
        self.assertEqual(event["batchOffset"], 48)
        self.assertEqual(event["emptyRows"], 1)
        self.assertEqual(
            event["emptyRowDiagnostics"],
            [f"6:{hashlib.sha256(b'tags').hexdigest()}"],
        )

    def test_case_normalized_recovery_handles_all_caps_legal_segment(self) -> None:
        source = "STATUTES,"
        calls: list[tuple[list[str], int, object]] = []

        def generate(*args: object) -> list[str]:
            retry_values = list(args[4])
            attempt = int(args[10])
            profile = args[11]
            calls.append((retry_values, attempt, profile))
            if retry_values == ["Statutes,"]:
                self.assertEqual(profile, "balanced")
                return ["STATUTET,"]
            if profile == "balanced":
                return ["STATUTES,"]
            if profile == "coverage":
                return ["Statutes,"]
            return [""]

        output = io.StringIO()
        with mock.patch.object(
            WORKER,
            "generate_translation_batch_once",
            side_effect=generate,
        ), contextlib.redirect_stdout(output):
            translated = run_translate(
                [source],
                maximum_retries=3,
                batch_offset=96,
                target_code="als_Latn",
            )

        self.assertEqual(translated, ["STATUTET,"])
        self.assertEqual(
            calls,
            [
                ([source], 0, None),
                ([source], 1, None),
                ([source], 2, None),
                ([source], 3, None),
                ([source], 1, "balanced"),
                ([source], 2, "coverage"),
                ([source], 3, "wide"),
                (["Statutes,"], 1, "balanced"),
            ],
        )
        events = [
            json.loads(line)
            for line in output.getvalue().splitlines()
            if line.strip()
        ]
        case_event = events[-1]
        self.assertEqual(
            case_event["event"],
            "long_tail_worker_empty_output_case_recovery",
        )
        self.assertEqual(
            case_event["caseNormalizedRowDiagnostics"],
            [f"0:{hashlib.sha256(source.encode('utf-8')).hexdigest()}"],
        )
        self.assertNotIn(source, output.getvalue())

    def test_alternate_profile_recovers_nonempty_lowercase_output(self) -> None:
        source = "ordinary source"
        calls: list[tuple[int, object]] = []

        def generate(*args: object) -> list[str]:
            attempt = int(args[10])
            profile = args[11]
            calls.append((attempt, profile))
            return ["përkthim"] if profile == "balanced" else [""]

        with mock.patch.object(
            WORKER,
            "generate_translation_batch_once",
            side_effect=generate,
        ), contextlib.redirect_stdout(io.StringIO()):
            translated = run_translate(
                [source],
                maximum_retries=2,
                batch_offset=0,
            )

        self.assertEqual(translated, ["përkthim"])
        self.assertEqual(calls, [(0, None), (1, None), (2, None), (1, "balanced")])

    def test_exhaustion_fails_closed_with_offset_row_and_digest(self) -> None:
        source = "private-source-must-not-be-copied"
        calls: list[tuple[list[str], int, object]] = []

        def generate(*args: object) -> list[str]:
            retry_values = list(args[4])
            attempt = int(args[10])
            profile = args[11]
            calls.append((retry_values, attempt, profile))
            return [" " if attempt == 1 else ""]

        with mock.patch.object(
            WORKER,
            "generate_translation_batch_once",
            side_effect=generate,
        ), contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(
            WORKER.EmptyOutputGenerationRetryExhausted,
            (
                r"batchOffset=96;rows=0:"
                + hashlib.sha256(source.encode("utf-8")).hexdigest()
            ),
        ) as raised:
            run_translate([source], maximum_retries=2, batch_offset=96)

        self.assertNotIn(source, str(raised.exception))
        self.assertEqual(
            calls,
            [
                ([source], 0, None),
                ([source], 1, None),
                ([source], 2, None),
                ([source], 1, "balanced"),
                ([source], 2, "coverage"),
                ([source], 3, "wide"),
            ],
        )
        self.assertEqual(
            raised.exception.summary()["attemptedRecoveryProfiles"],
            ["balanced", "coverage", "wide"],
        )
        self.assertFalse(
            raised.exception.summary()["caseNormalizedRecoveryAttempted"]
        )

    def test_true_cardinality_mismatch_is_not_retried(self) -> None:
        generate = mock.Mock(return_value=["only-one-row"])
        with mock.patch.object(
            WORKER,
            "generate_translation_batch_once",
            generate,
        ), self.assertRaisesRegex(
            RuntimeError,
            r"translated row cardinality mismatch: expected 2, received 1",
        ):
            run_translate(["first", "second"], maximum_retries=2, batch_offset=0)
        generate.assert_called_once()

    def test_cardinality_mismatch_during_recovery_is_immediate_fatal(self) -> None:
        calls = 0

        def generate(*args: object) -> list[str]:
            nonlocal calls
            calls += 1
            return [""] if calls == 1 else []

        with mock.patch.object(
            WORKER,
            "generate_translation_batch_once",
            side_effect=generate,
        ), contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(
            RuntimeError,
            r"empty-output-recovery-balanced row cardinality mismatch",
        ) as raised:
            run_translate(
                ["ordinary source"],
                maximum_retries=0,
                batch_offset=0,
            )

        self.assertNotIsInstance(
            raised.exception,
            WORKER.SourceGenerationRetryExhausted,
        )
        self.assertEqual(calls, 2)


class PersistentTypeScriptValidatorTests(unittest.TestCase):
    def test_multiple_requests_write_once_and_cannot_bleed_across_packs(self) -> None:
        class Input:
            def __init__(self) -> None:
                self.writes: list[str] = []
                self.flushes = 0

            def write(self, value: str) -> None:
                self.writes.append(value)

            def flush(self) -> None:
                self.flushes += 1

        class Output:
            def __init__(self) -> None:
                self.responses = [
                    json.dumps(
                        {
                            "ok": True,
                            "failures": [
                                {
                                    "key": "first",
                                    "reasons": ["field-fluency"],
                                    "fluencyReason": "unbalanced-delimiters",
                                }
                            ],
                        }
                    )
                    + "\n",
                    json.dumps(
                        {
                            "ok": True,
                            "failures": [
                                {
                                    "key": "second",
                                    "reasons": ["negation-marker-missing"],
                                    "fluencyReason": None,
                                }
                            ],
                        }
                    )
                    + "\n",
                ]

            def readline(self) -> str:
                return self.responses.pop(0)

        class Process:
            def __init__(self) -> None:
                self.stdin = Input()
                self.stdout = Output()

            @staticmethod
            def poll() -> None:
                return None

        validator = object.__new__(WORKER.TypeScriptCandidateValidator)
        process = Process()
        validator.process = process
        first_pack = {"source": {"entries": [{"key": "first"}]}}
        second_pack = {"source": {"entries": [{"key": "second"}]}}
        with mock.patch.object(
            WORKER.select,
            "select",
            return_value=([process.stdout], [], []),
        ):
            first = validator.validate(first_pack, {"first": "eerste"})
            second = validator.validate(second_pack, {"second": "tweede"})

        self.assertEqual(first[0]["key"], "first")
        self.assertEqual(first[0]["fluencyReason"], "unbalanced-delimiters")
        self.assertEqual(second[0]["key"], "second")
        self.assertEqual(len(process.stdin.writes), 2)
        self.assertEqual(process.stdin.flushes, 2)
        requests = [json.loads(value) for value in process.stdin.writes]
        self.assertEqual(
            [request["pack"]["source"]["entries"][0]["key"] for request in requests],
            ["first", "second"],
        )


class ContextualLiteralRetryTests(unittest.TestCase):
    @staticmethod
    def entry(source: str, segments: list[dict[str, str]]) -> dict[str, object]:
        return {
            "key": "site.test",
            "source": source,
            "sourceSha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
            "segments": segments,
        }

    def test_literal_marker_keeps_possessive_context_and_restores_exact_bytes(self) -> None:
        source = "inspir's Flashcard Builder is designed for active recall."
        entry = self.entry(
            source,
            [
                {"kind": "literal", "value": "inspir"},
                {
                    "kind": "text",
                    "value": "'s Flashcard Builder is designed for active recall.",
                },
            ],
        )
        parts, markers = WORKER.contextual_source_parts(entry)

        self.assertEqual(len(markers), 1)
        marker = markers[0][0]
        encoded = "".join(value for _, value in parts)
        self.assertIn(f"{marker}'s Flashcard Builder", encoded)
        restored = WORKER.restore_opaque_literals(
            encoded.replace("'s Flashcard Builder", " se Flashcard Builder"),
            markers,
        )
        self.assertEqual(
            restored,
            "inspir se Flashcard Builder is designed for active recall.",
        )
        self.assertNotIn(marker, restored)

    def test_marker_generation_skips_preexisting_placeholder_collision(self) -> None:
        preexisting = "{inspir_literal_a}"
        source = f"Keep {preexisting} beside inspir."
        entry = self.entry(
            source,
            [
                {"kind": "text", "value": "Keep "},
                {"kind": "literal", "value": preexisting},
                {"kind": "text", "value": " beside "},
                {"kind": "literal", "value": "inspir"},
                {"kind": "text", "value": "."},
            ],
        )
        with mock.patch.object(
            WORKER,
            "opaque_marker_prefix",
            side_effect=("inspir_literal", "inspir_literalb"),
        ) as prefix:
            markers = WORKER.opaque_literal_markers(entry)

        self.assertEqual(prefix.call_count, 2)
        self.assertTrue(all(marker not in source for marker, _ in markers))
        self.assertTrue(
            all(marker.startswith("{inspir_literalb_") for marker, _ in markers)
        )

    def test_restoration_rejects_drop_duplicate_reorder_and_unknown_identity(self) -> None:
        source = "inspir and OpenAI"
        entry = self.entry(
            source,
            [
                {"kind": "literal", "value": "inspir"},
                {"kind": "text", "value": " and "},
                {"kind": "literal", "value": "OpenAI"},
            ],
        )
        _, markers = WORKER.contextual_source_parts(entry)
        first, second = markers[0][0], markers[1][0]
        valid = WORKER.restore_opaque_literals(f"{first} en {second}", markers)
        self.assertEqual(valid, "inspir en OpenAI")
        malformed = (
            f"{first}",
            f"{first} en {first} en {second}",
            f"{second} en {first}",
            f"{first} en {second} en {first.rsplit('_', 1)[0]}_z}}",
            f"{first} en {second} en {{inspir_literalb_z}}",
        )
        for value in malformed:
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                WORKER.restore_opaque_literals(value, markers)

    def test_retry_translation_never_batches_unrelated_context_parts(self) -> None:
        calls: list[list[str]] = []

        def translate(*args: object, **kwargs: object) -> list[str]:
            del kwargs
            values = list(args[4])
            calls.append(values)
            return [f"translated:{values[0]}"]

        with mock.patch.object(WORKER, "translate_batch", side_effect=translate):
            value, translated_segments = WORKER.translate_retry_parts(
                [(True, "first sibling"), (False, " "), (True, "second sibling")],
                (),
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                "wide",
            )

        self.assertEqual(calls, [["first sibling"], ["second sibling"]])
        self.assertEqual(translated_segments, 2)
        self.assertEqual(
            value,
            "translated:first sibling translated:second sibling",
        )

    def test_literal_windows_retry_independently_before_clause_assembly(self) -> None:
        first = ("{inspir_literal_a}", "inspir")
        second = ("{inspir_literal_b}", "OpenAI")
        calls: list[tuple[list[str], str, tuple[str, ...]]] = []

        def translate(*args: object, **kwargs: object) -> list[str]:
            values = list(args[4])
            profile = str(kwargs["decode_profile"])
            opaque_markers = tuple(kwargs["opaque_markers"])
            calls.append((values, profile, opaque_markers))
            if first[0] in values[0]:
                if profile == "balanced":
                    return ["merk het verlore gegaan"]
                return [f"{first[0]} plaaslik"]
            if second[0] in values[0]:
                return [f"{second[0]} einde"]
            return ["gewone klousule"]

        with mock.patch.object(WORKER, "translate_batch", side_effect=translate):
            value, translated_segments = WORKER.translate_retry_parts(
                [
                    (True, f"{first[0]} first"),
                    (False, " | "),
                    (True, "ordinary clause"),
                    (False, " | "),
                    (True, f"{second[0]} last"),
                ],
                (first, second),
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                "balanced",
            )

        self.assertEqual(translated_segments, 3)
        self.assertEqual(
            value,
            "inspir plaaslik | gewone klousule | OpenAI einde",
        )
        self.assertNotIn("{inspir_literal", value)
        self.assertEqual(
            calls[:3],
            [
                ([f"{first[0]} first"], "balanced", (first[0],)),
                ([f"{first[0]} first"], "wide", (first[0],)),
                ([f"{second[0]} last"], "balanced", (second[0],)),
            ],
        )

    def test_literal_windows_preserve_multiple_local_markers_in_exact_order(self) -> None:
        markers = (
            ("{inspir_literal_a}", "inspir"),
            ("{inspir_literal_b}", "OpenAI"),
            ("{inspir_literal_c}", "Cloudflare"),
        )
        calls: list[tuple[str, ...]] = []

        def translate(*args: object, **kwargs: object) -> list[str]:
            values = list(args[4])
            local_markers = tuple(kwargs["opaque_markers"])
            calls.append(local_markers)
            if local_markers[0] == markers[0][0]:
                return [f"{local_markers[0]} en "]
            if local_markers[0] == markers[1][0]:
                return [local_markers[0]]
            self.assertIn(markers[2][0], values[0])
            return [f"met {local_markers[0]}"]

        with mock.patch.object(WORKER, "translate_batch", side_effect=translate):
            value, _ = WORKER.translate_retry_parts(
                [
                    (True, f"{markers[0][0]} and {markers[1][0]}"),
                    (False, "; "),
                    (True, f"with {markers[2][0]}"),
                ],
                markers,
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                "coverage",
            )

        self.assertEqual(value, "inspir en OpenAI; met Cloudflare")
        self.assertEqual(
            calls,
            [
                (markers[0][0],),
                (markers[2][0],),
            ],
        )
        self.assertNotIn("{inspir_literal", value)

    def test_multi_literal_clause_windows_reconstruct_encoded_source_exactly(self) -> None:
        markers = (
            ("{inspir_literal_a}", "inspir"),
            ("{inspir_literal_b}", "OpenAI"),
        )
        encoded = (
            "doing business as {inspir_literal_a} "
            "(\"{inspir_literal_b}\","
        )
        parts = WORKER.literal_local_context_parts(
            [(True, encoded), (False, " next")],
            markers,
        )

        self.assertEqual(
            parts,
            [
                (True, "doing business as {inspir_literal_a} (\""),
                (True, "{inspir_literal_b}\","),
                (False, " next"),
            ],
        )
        self.assertEqual("".join(value for _, value in parts), encoded + " next")

    def test_balanced_structural_delimiters_are_never_model_generated(self) -> None:
        source = "Before (inside [nested]) after"
        parts = WORKER.isolate_balanced_structural_delimiters(
            [(True, source)],
        )

        self.assertEqual("".join(value for _, value in parts), source)
        self.assertEqual(
            [value for is_text, value in parts if not is_text],
            ["(", "[", "]", ")"],
        )
        self.assertEqual(
            [value for is_text, value in parts if is_text],
            ["Before ", "inside ", "nested", " after"],
        )

    def test_unbalanced_structural_delimiters_are_left_contextual(self) -> None:
        parts = [(True, "Before (inside")]

        self.assertIs(
            WORKER.isolate_balanced_structural_delimiters(parts),
            parts,
        )

    def test_balanced_delimiter_isolation_is_opt_in_for_passing_legal_fields(self) -> None:
        marker = ("{inspir_literal_a}", "Great Indian Company")
        source_window = f"our community at {marker[0]} (Holding Partnership Firm)"
        calls: list[str] = []

        def translate(*args: object, **kwargs: object) -> list[str]:
            del kwargs
            value = str(list(args[4])[0])
            calls.append(value)
            return [value.replace("our community at", "ons gemeenskap by")]

        with mock.patch.object(
            WORKER,
            "isolate_balanced_structural_delimiters",
            side_effect=AssertionError("default retry must retain passing marker windows"),
        ), mock.patch.object(WORKER, "translate_batch", side_effect=translate):
            value, _ = WORKER.translate_retry_parts(
                [(True, source_window)],
                (marker,),
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                "balanced",
            )

        self.assertEqual(calls, [source_window])
        self.assertEqual(
            value,
            "ons gemeenskap by Great Indian Company (Holding Partnership Firm)",
        )

    def test_literal_only_window_restores_without_model_inference(self) -> None:
        marker = ("{inspir_literal_a}", "OpenAI")
        with mock.patch.object(WORKER, "translate_batch") as translate:
            value = WORKER.translate_literal_context_part(
                f"\"{marker[0]}\",",
                (marker,),
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                "balanced",
                0,
            )

        self.assertEqual(value, '"OpenAI",')
        translate.assert_not_called()

    def test_structured_citation_window_restores_without_model_inference(self) -> None:
        marker = ("{inspir_literal_a}", "512")
        with mock.patch.object(WORKER, "translate_batch") as translate:
            value = WORKER.translate_literal_context_part(
                f"{marker[0]}(c)(",
                (marker,),
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                "balanced",
                0,
            )

        self.assertEqual(value, "512(c)(")
        translate.assert_not_called()

    def test_ordinary_one_letter_prose_is_still_translated(self) -> None:
        marker = ("{inspir_literal_a}", "OpenAI")
        with mock.patch.object(
            WORKER,
            "translate_batch",
            return_value=[f"Ek {marker[0]}"],
        ) as translate:
            value = WORKER.translate_literal_context_part(
                f"I {marker[0]}",
                (marker,),
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                "balanced",
                0,
            )

        self.assertEqual(value, "Ek OpenAI")
        translate.assert_called_once()

    def test_url_literal_recovers_its_source_whitespace_boundary(self) -> None:
        marker = (
            "{inspir_literal_a}",
            "https://web.archive.org/web/example/https://www.inspir.app",
        )
        with mock.patch.object(
            WORKER,
            "translate_batch",
            return_value=[f"DIENS beteken die webwerf {marker[0]}/"],
        ):
            value = WORKER.translate_literal_context_part(
                f"SERVICE means the {marker[0]} website/",
                (marker,),
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                "balanced",
                0,
            )

        self.assertEqual(
            value,
            f"DIENS beteken die webwerf {marker[1]} / ",
        )
        self.assertEqual(
            re.findall(r'https?://[^\s<>"\']+', value),
            [marker[1]],
        )
        self.assertEqual(
            WORKER.restore_opaque_literals_with_source_boundaries(
                f"webwerf {marker[0]}",
                f"SERVICE {marker[0]} website",
                (marker,),
            ),
            f"webwerf {marker[1]} ",
        )

    def test_literal_window_fails_closed_when_every_profile_corrupts_marker(self) -> None:
        marker = ("{inspir_literal_a}", "inspir")
        profiles: list[str] = []

        def translate(*args: object, **kwargs: object) -> list[str]:
            del args
            profiles.append(str(kwargs["decode_profile"]))
            return ["geen merker"]

        with mock.patch.object(
            WORKER,
            "translate_batch",
            side_effect=translate,
        ), self.assertRaisesRegex(
            RuntimeError,
            "No literal-local decode preserved exact marker identity",
        ):
            WORKER.translate_retry_parts(
                [(True, f"{marker[0]} source")],
                (marker,),
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                "balanced",
            )

        self.assertEqual(profiles, ["balanced", "wide", "coverage"])

    def test_contextual_retry_does_not_use_semantic_n_best(self) -> None:
        with mock.patch.object(
            WORKER,
            "generate_translation_variants_once",
        ) as variants, mock.patch.object(
            WORKER,
            "translate_batch",
            return_value=["Moenie romantiseer nie"],
        ):
            value, _ = WORKER.translate_retry_parts(
                [(True, "Do not romanticize")],
                (),
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                "coverage",
            )

        self.assertEqual(value, "Moenie romantiseer nie")
        variants.assert_not_called()

    def test_distinct_quoted_aliases_collapsed_to_one_word_are_detected(self) -> None:
        parts = [
            (True, '"we",'),
            (False, " "),
            (True, '"us",'),
            (False, " "),
            (True, '"our").'),
        ]
        translated = ['"ons",', " ", '"ons",', " ", '"ons").']

        self.assertEqual(
            WORKER.quoted_alias_repetition_groups(parts, translated),
            [(0, 2, 4)],
        )
        arbitrary_source = [
            (True, '"alpha",'),
            (False, " "),
            (True, '"beta",'),
            (False, " "),
            (True, '"gamma").'),
        ]
        self.assertEqual(
            WORKER.quoted_alias_repetition_groups(
                arbitrary_source,
                translated,
            ),
            [],
        )
        reordered_legal_source = [
            (True, '"we",'),
            (False, " "),
            (True, '"our",'),
            (False, " "),
            (True, '"us").'),
        ]
        self.assertEqual(
            WORKER.quoted_alias_repetition_groups(
                reordered_legal_source,
                translated,
            ),
            [(0, 2, 4)],
        )
        repeated_source = [
            (True, '"our",'),
            (False, " "),
            (True, '"our",'),
            (False, " "),
            (True, '"our").'),
        ]
        self.assertEqual(
            WORKER.quoted_alias_repetition_groups(repeated_source, translated),
            [],
        )

    def test_contextual_retry_disambiguates_collapsed_legal_aliases(self) -> None:
        calls: list[list[str]] = []

        def translate(*args: object, **kwargs: object) -> list[str]:
            values = list(args[4])
            calls.append(values)
            opaque_markers = tuple(kwargs["opaque_markers"])
            if not opaque_markers:
                self.assertEqual(values, ['"we",', '"us",', '"our").'])
                return ['"ons",', '"ons",', '"ons").']
            self.assertEqual(len(values), 1)
            self.assertEqual(len(opaque_markers), 1)
            return [f"Ons ({opaque_markers[0]})"]

        with mock.patch.object(WORKER, "translate_batch", side_effect=translate):
            value, translated_segments = WORKER.translate_retry_parts(
                [
                    (True, '"we",'),
                    (False, " "),
                    (True, '"us",'),
                    (False, " "),
                    (True, '"our").'),
                ],
                (),
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                "balanced",
            )

        self.assertEqual(translated_segments, 3)
        self.assertEqual(
            value,
            '"Ons (we)", "Ons (us)", "Ons (our)").',
        )
        self.assertNotIn("{inspir_literal", value)
        self.assertEqual(len(calls), 4)

    def test_quote_isolation_is_exact_bounded_and_ignores_apostrophes(self) -> None:
        cases = (
            '"Do Not Track"',
            "Our Policy on “Do Not Track” Signals:",
            'Use "first" and “second” in order.',
        )
        for source in cases:
            with self.subTest(source=source):
                original = WORKER.split_text_segment(source)
                isolated = WORKER.isolate_quoted_retry_parts(original)
                self.assertEqual("".join(value for _, value in isolated), source)
                self.assertTrue(any(not is_text for is_text, _ in isolated))
        whole = WORKER.isolate_quoted_retry_parts(
            WORKER.split_text_segment('"Do Not Track"')
        )
        self.assertEqual(whole, [(False, '"'), (True, "Do Not Track"), (False, '"')])

        for contextual in (
            "don't split apostrophes",
            'unmatched "quote remains contextual',
            '"outer “nested” quote" remains contextual',
        ):
            original = WORKER.split_text_segment(contextual)
            self.assertEqual(WORKER.isolate_quoted_retry_parts(original), original)

    def test_quoted_protected_marker_restores_exact_literal(self) -> None:
        source = "Say “inspir does not track”."
        entry = self.entry(
            source,
            [
                {"kind": "text", "value": "Say “"},
                {"kind": "literal", "value": "inspir"},
                {"kind": "text", "value": " does not track”."},
            ],
        )
        contextual, markers = WORKER.contextual_source_parts(entry)
        isolated = WORKER.isolate_quoted_retry_parts(contextual)
        marker = markers[0][0]
        self.assertEqual("".join(value for _, value in isolated).count(marker), 1)
        restored = WORKER.restore_opaque_literals(
            f"Sê “{marker} volg nie”.",
            markers,
        )
        self.assertEqual(restored, "Sê “inspir volg nie”.")


class MonotonicRetryCandidateTests(unittest.TestCase):
    class FixedTokenMask:
        def __init__(self, token_count: int) -> None:
            self.token_count = token_count

        def sum(self, dim: int) -> "MonotonicRetryCandidateTests.FixedTokenMask":
            if dim != 1:
                raise AssertionError("source token count must sum rows")
            return self

        def max(self) -> "MonotonicRetryCandidateTests.FixedTokenMask":
            return self

        def item(self) -> int:
            return self.token_count

    class ExactTokenCountTokenizer:
        def __init__(self, source: str, token_count: int) -> None:
            self.source = source
            self.token_count = token_count
            self.calls = 0

        def __call__(
            self,
            values: list[str],
            **kwargs: object,
        ) -> dict[str, object]:
            if values != [self.source]:
                raise AssertionError("tokenizer received a different exact source")
            if kwargs != {
                "return_tensors": "pt",
                "padding": True,
                "truncation": False,
            }:
                raise AssertionError("tokenizer preflight options drifted")
            self.calls += 1
            return {
                "attention_mask": MonotonicRetryCandidateTests.FixedTokenMask(
                    self.token_count
                )
            }

    def overbound_legal_entry(self) -> tuple[dict[str, object], str]:
        source = (
            "THESE SERVICES ARE PROVIDED BY COMPANY ON AN “AS IS” AND “AS "
            "AVAILABLE” BASIS. "
            "COMPANY MAKES NO REPRESENTATIONS OR WARRANTIES OF ANY KIND, "
            "EXPRESS OR IMPLIED, AS TO THE OPERATION OF THEIR SERVICES, OR THE "
            "INFORMATION, CONTENT OR MATERIALS INCLUDED THEREIN. "
            "YOU EXPRESSLY AGREE THAT YOUR USE OF THESE SERVICES, THEIR CONTENT, "
            "AND ANY SERVICES OR ITEMS OBTAINED FROM US IS AT YOUR SOLE RISK. "
            "NEITHER COMPANY NOR ANY PERSON ASSOCIATED WITH COMPANY MAKES ANY "
            "WARRANTY OR REPRESENTATION WITH RESPECT TO THE COMPLETENESS, "
            "SECURITY, RELIABILITY, QUALITY, ACCURACY, OR AVAILABILITY OF THE "
            "SERVICES. "
            "WITHOUT LIMITING THE FOREGOING, NEITHER COMPANY NOR ANYONE "
            "ASSOCIATED WITH COMPANY REPRESENTS OR WARRANTS THAT THE SERVICES, "
            "THEIR CONTENT, OR ANY SERVICES OR ITEMS OBTAINED THROUGH THE "
            "SERVICES WILL BE ACCURATE, RELIABLE, ERROR-FREE, OR UNINTERRUPTED, "
            "THAT DEFECTS WILL BE CORRECTED, THAT THE SERVICES OR THE SERVER THAT "
            "MAKES IT AVAILABLE ARE FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS "
            "OR THAT THE SERVICES OR ANY SERVICES OR ITEMS OBTAINED THROUGH THE "
            "SERVICES WILL OTHERWISE MEET YOUR NEEDS OR EXPECTATIONS. "
            "COMPANY HEREBY DISCLAIMS ALL WARRANTIES OF ANY KIND, WHETHER EXPRESS "
            "OR IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING BUT NOT LIMITED TO ANY "
            "WARRANTIES OF MERCHANTABILITY, NON-INFRINGEMENT, AND FITNESS FOR "
            "PARTICULAR PURPOSE. "
            "THE FOREGOING DOES NOT AFFECT ANY WARRANTIES WHICH CANNOT BE "
            "EXCLUDED OR LIMITED UNDER APPLICABLE LAW."
        )
        source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
        self.assertEqual(
            source_hash,
            "b308bd74027e9844859f740cb25de2a2505f5733156ca6a0d5109ef9ad3a2c09",
        )
        return (
            {
                "key": "site.ed6a4de76ca0238bc9",
                "source": source,
                "sourceSha256": source_hash,
                "segments": [{"kind": "text", "value": source}],
            },
            source_hash,
        )

    def retry_fixture(
        self,
        prior_value: str = "prior",
        failures: object = None,
        fluency_reasons: frozenset[str] = frozenset(),
    ) -> tuple[
        dict[str, object],
        tuple[str, str],
        dict[tuple[str, str], str],
        dict[tuple[str, str], str],
        object,
    ]:
        source = "Generate pairs, check answers, and explain misses."
        source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
        source_key = ("af", source_hash)
        entry = {
            "key": "site.test",
            "source": source,
            "sourceSha256": source_hash,
            "segments": [{"kind": "text", "value": source}],
        }
        source_memory = {source_key: prior_value}
        source_texts = {source_key: source}
        failure_counts = (
            failures
            if isinstance(failures, WORKER.Counter)
            else WORKER.Counter({"field-invalid": 1})
        )

        def validate(
            key: tuple[str, str],
            value: str,
        ) -> object:
            self.assertEqual(key, source_key)
            del value
            return WORKER.RetryCandidateValidation(
                failure_counts,
                fluency_reasons,
            )

        return entry, source_key, source_memory, source_texts, validate

    def test_balanced_delimiter_retry_requires_exact_ts_fluency_reason(self) -> None:
        exact = WORKER.RetryCandidateValidation(
            WORKER.Counter({"field-fluency": 1}),
            frozenset({"unbalanced-delimiters"}),
        )
        self.assertTrue(WORKER.should_preserve_balanced_delimiters(exact))
        for validation in (
            WORKER.RetryCandidateValidation(
                WORKER.Counter(
                    {"field-fluency": 1, "protected-literal-parity": 1}
                ),
                frozenset({"unbalanced-delimiters"}),
            ),
            WORKER.RetryCandidateValidation(
                WORKER.Counter({"field-fluency": 1}),
                frozenset({"repeated-token-run"}),
            ),
            WORKER.RetryCandidateValidation(
                WORKER.Counter({"field-fluency": 1}),
                frozenset(),
            ),
        ):
            with self.subTest(validation=validation):
                self.assertFalse(
                    WORKER.should_preserve_balanced_delimiters(validation)
                )

    def test_repeated_token_n_best_requires_the_exact_ts_fluency_reason(self) -> None:
        exact = WORKER.RetryCandidateValidation(
            WORKER.Counter({"field-fluency": 6}),
            frozenset({"repeated-token-run"}),
        )
        self.assertTrue(WORKER.should_use_repeated_token_n_best(exact))
        self.assertTrue(
            WORKER.has_consecutive_retry_token_run("rig rig rig debat", 3)
        )
        self.assertFalse(
            WORKER.has_consecutive_retry_token_run("streng debat", 3)
        )
        for validation in (
            WORKER.RetryCandidateValidation(
                WORKER.Counter(
                    {"field-fluency": 1, "protected-literal-parity": 1}
                ),
                frozenset({"repeated-token-run"}),
            ),
            WORKER.RetryCandidateValidation(
                WORKER.Counter({"field-fluency": 1}),
                frozenset({"unbalanced-delimiters"}),
            ),
            WORKER.RetryCandidateValidation(
                WORKER.Counter({"field-fluency": 1}),
                frozenset(
                    {"repeated-token-run", "unbalanced-delimiters"}
                ),
            ),
        ):
            with self.subTest(validation=validation):
                self.assertFalse(
                    WORKER.should_use_repeated_token_n_best(validation)
                )

    def test_repeated_token_n_best_is_bounded_and_keeps_hard_failures_closed(
        self,
    ) -> None:
        source = "Generate pairs, check answers, and explain misses."
        source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
        source_key = ("af", source_hash)
        entry = {
            "key": "site.test",
            "source": source,
            "sourceSha256": source_hash,
            "segments": [{"kind": "text", "value": source}],
        }
        source_memory = {source_key: "mis mis mis"}
        source_texts = {source_key: source}

        def validate(
            key: tuple[str, str],
            value: str,
        ) -> object:
            self.assertEqual(key, source_key)
            if value in ("mis mis mis", "nog nog nog"):
                return WORKER.RetryCandidateValidation(
                    WORKER.Counter({"field-fluency": 1}),
                    frozenset({"repeated-token-run"}),
                )
            if value == "hard regression":
                return WORKER.RetryCandidateValidation(
                    WORKER.Counter({"protected-literal-parity": 1}),
                    frozenset(),
                )
            return WORKER.RetryCandidateValidation(
                WORKER.Counter(),
                frozenset(),
            )

        output = io.StringIO()
        with mock.patch.object(
            WORKER,
            "whole_field_retry_source_fits_token_bound",
            return_value=True,
        ) as preflight, mock.patch.object(
            WORKER,
            "translate_repeated_token_retry_variants",
            return_value=(
                ["nog nog nog", "hard regression", "verduidelik foute"],
                1,
            ),
        ) as n_best, mock.patch.object(
            WORKER,
            "translate_retry_parts",
            side_effect=AssertionError("passing N-best must stop fallback decoding"),
        ), contextlib.redirect_stdout(output):
            result = WORKER.retry_source_entries(
                [entry],
                "af",
                "afr_Latn",
                object(),
                object(),
                "cpu",
                1,
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                source_memory,
                source_texts,
                validate,
                "terminal-rescue",
                1,
            )

        self.assertEqual(result, (1, 1, 1))
        self.assertEqual(source_memory[source_key], "verduidelik foute")
        preflight.assert_called_once_with(source, mock.ANY, 512)
        n_best.assert_called_once()
        evidence = json.loads(output.getvalue())
        self.assertEqual(evidence["phase"], "terminal-rescue")
        self.assertEqual(evidence["device"], "cpu")
        self.assertEqual(evidence["replicaIndex"], 1)
        self.assertNotIn("source", evidence)
        self.assertNotIn("value", evidence)

    def test_repeated_token_model_runtime_error_is_never_profile_rejection(
        self,
    ) -> None:
        entry, _, source_memory, source_texts, validate = self.retry_fixture(
            prior_value="mis mis mis",
            failures=WORKER.Counter({"field-fluency": 1}),
            fluency_reasons=frozenset({"repeated-token-run"}),
        )
        with mock.patch.object(
            WORKER,
            "whole_field_retry_source_fits_token_bound",
            return_value=True,
        ), mock.patch.object(
            WORKER,
            "translate_repeated_token_retry_variants",
            side_effect=RuntimeError("NLLB semantic retry candidate cardinality mismatch"),
        ), mock.patch.object(
            WORKER,
            "translate_retry_parts",
            side_effect=AssertionError("fatal model error must stop all profiles"),
        ), self.assertRaisesRegex(
            RuntimeError,
            "cardinality mismatch",
        ):
            WORKER.retry_source_entries(
                [entry],
                "af",
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                source_memory,
                source_texts,
                validate,
            )

    def test_exact_overbound_legal_source_bypasses_whole_field_n_best(
        self,
    ) -> None:
        entry, source_hash = self.overbound_legal_entry()
        source = entry["source"]
        self.assertIsInstance(source, str)
        if not isinstance(source, str):
            raise AssertionError("exact legal source must be text")
        source_key = ("af", source_hash)
        repeated_prior = "diens diens diens"
        contextual_value = "Vertaalde bepalings met begrensde segmente."
        source_memory = {source_key: repeated_prior}
        source_texts = {source_key: source}
        tokenizer = self.ExactTokenCountTokenizer(source, 641)

        def validate(
            key: tuple[str, str],
            value: str,
        ) -> object:
            self.assertEqual(key, source_key)
            if value == repeated_prior:
                return WORKER.RetryCandidateValidation(
                    WORKER.Counter({"field-fluency": 1}),
                    frozenset({"repeated-token-run"}),
                )
            failures = WORKER.Counter()
            if value != contextual_value:
                failures["field-invalid"] = 1
            return WORKER.RetryCandidateValidation(
                failures,
                frozenset(),
            )

        def translate_contextually(
            parts: list[tuple[bool, str]],
            markers: tuple[tuple[str, str], ...],
            *args: object,
            **kwargs: object,
        ) -> tuple[str, int]:
            del args, kwargs
            self.assertEqual(markers, ())
            self.assertEqual("".join(value for _, value in parts), source)
            return contextual_value, 7

        with mock.patch.object(
            WORKER,
            "translate_repeated_token_retry_variants",
            side_effect=AssertionError(
                "over-bound source must bypass whole-field N-best"
            ),
        ) as whole_field, mock.patch.object(
            WORKER,
            "translate_retry_parts",
            side_effect=translate_contextually,
        ), contextlib.redirect_stdout(io.StringIO()):
            result = WORKER.retry_source_entries(
                [entry],
                "af",
                "afr_Latn",
                object(),
                tokenizer,
                "mps",
                1,
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                source_memory,
                source_texts,
                validate,
            )

        self.assertEqual(result, (1, 7, 1))
        self.assertEqual(source_memory[source_key], contextual_value)
        self.assertEqual(tokenizer.calls, 1)
        whole_field.assert_not_called()

    def test_direct_whole_field_helper_keeps_token_bound_fatal(self) -> None:
        entry, _ = self.overbound_legal_entry()
        source = entry["source"]
        self.assertIsInstance(source, str)
        if not isinstance(source, str):
            raise AssertionError("exact legal source must be text")
        tokenizer = self.ExactTokenCountTokenizer(source, 641)

        with self.assertRaisesRegex(
            RuntimeError,
            "Bounded semantic retry segment unexpectedly uses 641 tokens",
        ):
            WORKER.translate_repeated_token_retry_variants(
                entry,
                "afr_Latn",
                object(),
                tokenizer,
                "mps",
                1,
                4,
                512,
                512,
                object(),
                1,
                "balanced",
            )

        self.assertEqual(tokenizer.calls, 1)

    def test_whole_field_preflight_tokenizer_error_is_fatal(self) -> None:
        entry, _, source_memory, source_texts, validate = self.retry_fixture(
            prior_value="mis mis mis",
            failures=WORKER.Counter({"field-fluency": 1}),
            fluency_reasons=frozenset({"repeated-token-run"}),
        )

        class FailingTokenizer:
            def __call__(self, *args: object, **kwargs: object) -> object:
                del args, kwargs
                raise RuntimeError("tokenizer preflight failed")

        with mock.patch.object(
            WORKER,
            "translate_repeated_token_retry_variants",
        ) as whole_field, mock.patch.object(
            WORKER,
            "translate_retry_parts",
        ) as contextual, self.assertRaisesRegex(
            RuntimeError,
            "tokenizer preflight failed",
        ):
            WORKER.retry_source_entries(
                [entry],
                "af",
                "afr_Latn",
                object(),
                FailingTokenizer(),
                "mps",
                1,
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                source_memory,
                source_texts,
                validate,
            )

        whole_field.assert_not_called()
        contextual.assert_not_called()

    def test_contextual_eos_runtime_error_is_never_profile_rejection(self) -> None:
        entry, _, source_memory, source_texts, validate = self.retry_fixture()
        with mock.patch.object(
            WORKER,
            "translate_retry_parts",
            side_effect=RuntimeError("NLLB output reached its token bound without EOS"),
        ), self.assertRaisesRegex(RuntimeError, "without EOS"):
            WORKER.retry_source_entries(
                [entry],
                "af",
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                source_memory,
                source_texts,
                validate,
            )

    def test_output_profile_rejections_become_typed_source_exhaustion(self) -> None:
        entry, source_key, source_memory, source_texts, validate = (
            self.retry_fixture()
        )
        with mock.patch.object(
            WORKER,
            "translate_retry_parts",
            side_effect=WORKER.DecodeProfileRejected("marker output rejected"),
        ), self.assertRaises(
            WORKER.SourceDecodeProfilesRetryExhausted,
        ) as raised:
            WORKER.retry_source_entries(
                [entry],
                "af",
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                1,
                4,
                512,
                512,
                3,
                object(),
                3,
                source_memory,
                source_texts,
                validate,
            )

        self.assertEqual(raised.exception.summary()["sourceSha256"], source_key[1])

    def test_profile_rejections_use_all_retry_rounds_before_attempt_three_success(
        self,
    ) -> None:
        entry, source_key, source_memory, source_texts, _ = self.retry_fixture()

        def validate(
            key: tuple[str, str],
            value: str,
        ) -> object:
            self.assertEqual(key, source_key)
            return WORKER.RetryCandidateValidation(
                WORKER.Counter() if value == "translated" else WORKER.Counter(
                    {"field-invalid": 1}
                ),
                frozenset(),
            )

        for attempt in (1, 2):
            with mock.patch.object(
                WORKER,
                "translate_retry_parts",
                side_effect=WORKER.DecodeProfileRejected(
                    "bounded profile output rejected"
                ),
            ), contextlib.redirect_stdout(io.StringIO()):
                result = WORKER.retry_source_entries(
                    [entry],
                    "af",
                    "afr_Latn",
                    object(),
                    object(),
                    "mps",
                    1,
                    1,
                    4,
                    512,
                    512,
                    3,
                    object(),
                    attempt,
                    source_memory,
                    source_texts,
                    validate,
                )
            self.assertEqual(result, (1, 0, 0))
            self.assertEqual(source_memory[source_key], "prior")

        with mock.patch.object(
            WORKER,
            "translate_retry_parts",
            return_value=("translated", 1),
        ), contextlib.redirect_stdout(io.StringIO()):
            result = WORKER.retry_source_entries(
                [entry],
                "af",
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                1,
                4,
                512,
                512,
                3,
                object(),
                3,
                source_memory,
                source_texts,
                validate,
            )

        self.assertEqual(result, (1, 1, 1))
        self.assertEqual(source_memory[source_key], "translated")

    def test_repeated_token_whole_field_retry_rejects_protected_literals(
        self,
    ) -> None:
        source = "Keep {value1} and explain mistakes."
        entry = {
            "key": "site.test",
            "source": source,
            "sourceSha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
            "segments": [
                {"kind": "text", "value": "Keep "},
                {"kind": "literal", "value": "{value1}"},
                {"kind": "text", "value": " and explain mistakes."},
            ],
        }
        with mock.patch.object(
            WORKER,
            "generate_translation_variants_once",
        ) as generate:
            with self.assertRaisesRegex(RuntimeError, "protected literals"):
                WORKER.translate_repeated_token_retry_variants(
                    entry,
                    "afr_Latn",
                    object(),
                    object(),
                    "mps",
                    1,
                    4,
                    512,
                    512,
                    object(),
                    1,
                    "balanced",
                )
        generate.assert_not_called()

    def test_exact_v7_protected_legal_retry_bypasses_whole_field_n_best(
        self,
    ) -> None:
        source = (
            "Welcome to Great Indian Company (Holding Partnership Firm, GST: "
            "29AAWFG7015K1ZQ) (“Company”, “we”, “our”, “us”)! These Terms of "
            "Service (“Terms”, “Terms of Service”) govern your use of our website "
            "located at www.inspir.app and applications available on app stores "
            "(together or individually “Service”) operated by Great Indian Company "
            "(Holding Partnership Firm, GST: 29AAWFG7015K1ZQ). Our Privacy Policy "
            "also governs your use of our Service and explains how we collect, "
            "safeguard and disclose information that results from your use of our "
            "web pages. The privacy policy is available at inspir.app/privacy Your "
            "agreement with us includes these Terms and our Privacy Policy "
            "(“Agreements”). You acknowledge that you have read and understood the "
            "Agreements, and agree to be bound by them. If you do not agree with "
            "(or cannot comply with) the Agreements, then you may not use the "
            "Service, but please let us know by emailing support@inspir.app so we "
            "can try to find a solution. These Terms apply to all visitors, users "
            "and others who wish to access or use the Service."
        )
        source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
        self.assertEqual(
            source_hash,
            "94b108543d57bf9c98e18d5f7e46a3dcfd4eef6398a5b8c467711746817bf5f3",
        )
        source_key = ("af", source_hash)
        literals = (
            "Great Indian Company",
            "Holding Partnership Firm",
            "29AAWFG7015K1ZQ",
            "www.inspir.app",
            "Great Indian Company",
            "Holding Partnership Firm",
            "29AAWFG7015K1ZQ",
            "inspir.app",
            "support@inspir.app",
        )
        entry = {
            "key": "site.8db561c2dc80b4a00f",
            "source": source,
            "sourceSha256": source_hash,
            "segments": [
                {"kind": "text", "value": "Welcome to "},
                {"kind": "literal", "value": literals[0]},
                {"kind": "text", "value": " ("},
                {"kind": "literal", "value": literals[1]},
                {"kind": "text", "value": ", GST: "},
                {"kind": "literal", "value": literals[2]},
                {
                    "kind": "text",
                    "value": (
                        ") (“Company”, “we”, “our”, “us”)! These Terms of "
                        "Service (“Terms”, “Terms of Service”) govern your use of "
                        "our website located at "
                    ),
                },
                {"kind": "literal", "value": literals[3]},
                {
                    "kind": "text",
                    "value": (
                        " and applications available on app stores (together or "
                        "individually “Service”) operated by "
                    ),
                },
                {"kind": "literal", "value": literals[4]},
                {"kind": "text", "value": " ("},
                {"kind": "literal", "value": literals[5]},
                {"kind": "text", "value": ", GST: "},
                {"kind": "literal", "value": literals[6]},
                {
                    "kind": "text",
                    "value": (
                        "). Our Privacy Policy also governs your use of our Service "
                        "and explains how we collect, safeguard and disclose "
                        "information that results from your use of our web pages. "
                        "The privacy policy is available at "
                    ),
                },
                {"kind": "literal", "value": literals[7]},
                {
                    "kind": "text",
                    "value": (
                        "/privacy Your agreement with us includes these Terms and "
                        "our Privacy Policy (“Agreements”). You acknowledge that you "
                        "have read and understood the Agreements, and agree to be "
                        "bound by them. If you do not agree with (or cannot comply "
                        "with) the Agreements, then you may not use the Service, but "
                        "please let us know by emailing "
                    ),
                },
                {"kind": "literal", "value": literals[8]},
                {
                    "kind": "text",
                    "value": (
                        " so we can try to find a solution. These Terms apply to all "
                        "visitors, users and others who wish to access or use the "
                        "Service."
                    ),
                },
            ],
        }
        repeated_prior = "voorwaardes voorwaardes voorwaardes"
        contextual_value = source.replace("Welcome to ", "Welkom by ", 1)
        source_memory = {source_key: repeated_prior}
        source_texts = {source_key: source}
        contextual_calls: list[tuple[tuple[str, str], ...]] = []

        def validate(
            key: tuple[str, str],
            value: str,
        ) -> object:
            self.assertEqual(key, source_key)
            if value == repeated_prior:
                return WORKER.RetryCandidateValidation(
                    WORKER.Counter({"field-fluency": 1}),
                    frozenset({"repeated-token-run"}),
                )
            failures = WORKER.Counter()
            if value != contextual_value:
                failures["field-invalid"] = 1
            return WORKER.RetryCandidateValidation(
                failures,
                frozenset(),
            )

        def translate_contextually(
            parts: list[tuple[bool, str]],
            markers: tuple[tuple[str, str], ...],
            *args: object,
            **kwargs: object,
        ) -> tuple[str, int]:
            del args, kwargs
            contextual_calls.append(markers)
            encoded = "".join(value for _, value in parts)
            self.assertEqual(tuple(literal for _, literal in markers), literals)
            self.assertTrue(markers)
            for marker, _ in markers:
                self.assertEqual(encoded.count(marker), 1)
            return contextual_value, 1

        with mock.patch.object(
            WORKER,
            "translate_repeated_token_retry_variants",
            side_effect=AssertionError(
                "protected source must bypass whole-field N-best"
            ),
        ) as whole_field, mock.patch.object(
            WORKER,
            "translate_retry_parts",
            side_effect=translate_contextually,
        ), contextlib.redirect_stdout(io.StringIO()):
            result = WORKER.retry_source_entries(
                [entry],
                "af",
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                source_memory,
                source_texts,
                validate,
            )

        self.assertEqual(result, (1, 1, 1))
        self.assertEqual(source_memory[source_key], contextual_value)
        self.assertEqual(len(contextual_calls), 1)
        whole_field.assert_not_called()

    def test_exact_ts_reason_triggers_one_opt_in_delimiter_decode(self) -> None:
        source = "Alpha (beta)"
        source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
        source_key = ("af", source_hash)
        entry = {
            "key": "site.test",
            "source": source,
            "sourceSha256": source_hash,
            "segments": [{"kind": "text", "value": source}],
        }
        source_memory = {source_key: "prior"}
        source_texts = {source_key: source}
        preserve_flags: list[bool] = []

        def translate(*args: object, **kwargs: object) -> tuple[str, int]:
            del args
            preserve = bool(kwargs.get("preserve_balanced_delimiters", False))
            preserve_flags.append(preserve)
            return ("delimited" if preserve else "plain", 1)

        def validate(
            key: tuple[str, str],
            value: str,
        ) -> object:
            self.assertEqual(key, source_key)
            if value == "delimited":
                return WORKER.RetryCandidateValidation(
                    WORKER.Counter(),
                    frozenset(),
                )
            reason = (
                "unbalanced-delimiters"
                if value == "plain"
                else "repeated-token-run"
            )
            return WORKER.RetryCandidateValidation(
                WORKER.Counter({"field-fluency": 1}),
                frozenset({reason}),
            )

        with mock.patch.object(
            WORKER,
            "translate_retry_parts",
            side_effect=translate,
        ), contextlib.redirect_stdout(io.StringIO()):
            result = WORKER.retry_source_entries(
                [entry],
                "af",
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                1,
                4,
                512,
                512,
                3,
                object(),
                1,
                source_memory,
                source_texts,
                validate,
            )

        self.assertEqual(result, (1, 2, 1))
        self.assertEqual(preserve_flags, [False, True])
        self.assertEqual(source_memory[source_key], "delimited")

    def test_hard_parity_failure_cannot_be_traded_for_fluency(self) -> None:
        selected = WORKER.select_strictly_improved_retry_candidate(
            "prior",
            WORKER.Counter({"field-fluency": 1}),
            [
                (
                    "contextual-wide",
                    "parity-regression",
                    WORKER.Counter({"protected-literal-parity": 1}),
                ),
                (
                    "contextual-balanced",
                    "tie",
                    WORKER.Counter({"field-fluency": 1}),
                ),
            ],
        )
        self.assertEqual(selected[0], "prior")
        self.assertIsNone(selected[2])

    def test_passing_candidate_wins_but_prior_is_preserved_on_ties(self) -> None:
        selected = WORKER.select_strictly_improved_retry_candidate(
            "prior",
            WORKER.Counter({"negation-marker-missing": 1}),
            [
                (
                    "contextual-coverage",
                    "semantic-tie",
                    WORKER.Counter({"negation-marker-missing": 1}),
                ),
                ("contextual-balanced", "pass", WORKER.Counter()),
            ],
        )
        self.assertEqual(selected, ("pass", WORKER.Counter(), "contextual-balanced"))

    def test_source_copy_fallback_is_never_an_improvement(self) -> None:
        selected = WORKER.select_strictly_improved_retry_candidate(
            "prior",
            WORKER.Counter({"field-fluency": 1}),
            [
                (
                    "segmented-wide",
                    "exact source copy",
                    WORKER.Counter({"source-equality": 1}),
                )
            ],
        )
        self.assertEqual(selected[0], "prior")
        self.assertIsNone(selected[2])

    def test_short_word_source_bans_fail_closed_instead_of_poisoning_afrikaans(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "shorter than four"):
            WORKER.forbidden_source_token_sequences(object(), ["is in"], 2)

    def test_retry_rounds_are_decode_diverse_and_include_no_word_ban_profiles(self) -> None:
        variants = [
            WORKER.retry_decode_profile_options("balanced", attempt, 1)
            for attempt in (1, 2, 3)
        ]
        self.assertEqual(len(set(variants)), 3)
        self.assertTrue(all(options[2] is None for options in variants))
        self.assertEqual(
            WORKER.retry_decode_profile_options("wide", 1, 1)[2],
            4,
        )
        self.assertEqual(
            WORKER.forbidden_source_token_sequences(object(), ["shared data"], None),
            [],
        )


class SemanticNBestRetryTests(unittest.TestCase):
    class FakeScalarTensor:
        def sum(self, dim: int) -> "SemanticNBestRetryTests.FakeScalarTensor":
            del dim
            return self

        def max(self) -> "SemanticNBestRetryTests.FakeScalarTensor":
            return self

        def item(self) -> int:
            return 1

        def to(self, device: str) -> "SemanticNBestRetryTests.FakeScalarTensor":
            del device
            return self

    class FakeBooleanTensor:
        def any(self) -> "SemanticNBestRetryTests.FakeBooleanTensor":
            return self

        def item(self) -> bool:
            return True

    class FakeSequence:
        def __eq__(self, value: object) -> "SemanticNBestRetryTests.FakeBooleanTensor":
            del value
            return SemanticNBestRetryTests.FakeBooleanTensor()

    class FakeGenerated(list[object]):
        def cpu(self) -> "SemanticNBestRetryTests.FakeGenerated":
            return self

    class DecodedCardinalityTokenizer:
        eos_token_id = 2
        unk_token_id = 3

        def __call__(self, *args: object, **kwargs: object) -> dict[str, object]:
            del args, kwargs
            tensor = SemanticNBestRetryTests.FakeScalarTensor()
            return {"attention_mask": tensor, "input_ids": tensor}

        def convert_tokens_to_ids(self, value: str) -> int:
            del value
            return 7

        def batch_decode(self, *args: object, **kwargs: object) -> list[str]:
            del args, kwargs
            return ["only one decoded candidate"]

    class FourCandidateModel:
        def generate(self, **kwargs: object) -> object:
            del kwargs
            return SemanticNBestRetryTests.FakeGenerated(
                [SemanticNBestRetryTests.FakeSequence() for _ in range(4)]
            )

    def test_tokenizer_requires_canonical_integer_eos_id(self) -> None:
        self.assertEqual(
            WORKER.canonical_eos_token_id(type("Tokenizer", (), {"eos_token_id": 2})()),
            2,
        )
        for eos_token_id in (None, True, -1, "2"):
            with self.subTest(eos_token_id=eos_token_id), self.assertRaisesRegex(
                RuntimeError,
                "canonical integer EOS",
            ):
                WORKER.canonical_eos_token_id(
                    type("Tokenizer", (), {"eos_token_id": eos_token_id})()
                )

    def test_target_language_token_must_be_canonical_and_not_unknown(self) -> None:
        class Tokenizer:
            unk_token_id: object = 3
            target_token_id: object = 7

            def convert_tokens_to_ids(self, value: str) -> object:
                del value
                return self.target_token_id

        tokenizer = Tokenizer()
        self.assertEqual(
            WORKER.canonical_target_language_token_id(
                tokenizer,
                "als_Latn",
            ),
            7,
        )
        for target_token_id, unknown_token_id in (
            (True, 3),
            (-1, 3),
            ("7", 3),
            (3, 3),
            (7, None),
        ):
            with self.subTest(
                target_token_id=target_token_id,
                unknown_token_id=unknown_token_id,
            ), self.assertRaisesRegex(RuntimeError, "non-canonical"):
                tokenizer.target_token_id = target_token_id
                tokenizer.unk_token_id = unknown_token_id
                WORKER.canonical_target_language_token_id(
                    tokenizer,
                    "als_Latn",
                )
        with self.assertRaisesRegex(RuntimeError, "code is malformed"):
            WORKER.canonical_target_language_token_id(tokenizer, "invalid")

    def test_semantic_decoded_cardinality_mismatch_is_immediate_fatal(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "decoded candidate cardinality mismatch: expected 4, received 1",
        ) as raised:
            WORKER.generate_translation_variants_once(
                self.FourCandidateModel(),
                self.DecodedCardinalityTokenizer(),
                "cpu",
                "afr_Latn",
                "source",
                1,
                4,
                512,
                512,
                object(),
                1,
                "balanced",
                (),
            )

        self.assertNotIsInstance(
            raised.exception,
            WORKER.SourceGenerationRetryExhausted,
        )

    def test_candidate_count_is_strictly_bounded_by_four_and_beams(self) -> None:
        self.assertEqual(WORKER.bounded_semantic_candidate_count(4, 12), 4)
        self.assertEqual(WORKER.bounded_semantic_candidate_count(4, 2), 2)
        with self.assertRaises(RuntimeError):
            WORKER.bounded_semantic_candidate_count(5, 12)

    def test_semantic_variants_are_deterministic_deduplicated_and_row_mapped(self) -> None:
        with mock.patch.object(
            WORKER,
            "generate_translation_variants_once",
            return_value=[
                "Moenie volg nie",
                "Moenie volg nie",
                "Moet nie volg nie",
                "Moenie spoor nie",
                "unbounded fifth",
            ],
        ), mock.patch.object(
            WORKER,
            "translate_batch",
            return_value=["Seine"],
        ):
            candidates, segments = WORKER.translate_semantic_retry_parts(
                [
                    (False, "“"),
                    (True, "Do Not Track"),
                    (False, "” "),
                    (True, "Signals"),
                ],
                (),
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                object(),
                1,
                "coverage",
            )

        self.assertEqual(segments, 2)
        self.assertEqual(
            candidates,
            [
                "“Moenie volg nie” Seine",
                "“Moet nie volg nie” Seine",
                "“Moenie spoor nie” Seine",
            ],
        )
        self.assertTrue(all("unbounded fifth" not in value for value in candidates))

    def test_each_semantic_variant_must_restore_markers_exactly(self) -> None:
        markers = (("{inspir_literal_a}", "inspir"),)
        with mock.patch.object(
            WORKER,
            "generate_translation_variants_once",
            return_value=[
                "{inspir_literal_a} volg nie",
                "volg nie",
                "{inspir_literal_a} {inspir_literal_a} volg nie",
                "{inspir_literal_a} spoor nie",
            ],
        ):
            candidates, _ = WORKER.translate_semantic_retry_parts(
                [(True, "{inspir_literal_a} does not track")],
                markers,
                "afr_Latn",
                object(),
                object(),
                "mps",
                1,
                4,
                512,
                512,
                object(),
                1,
                "coverage",
            )

        self.assertEqual(candidates, ["inspir volg nie", "inspir spoor nie"])

    def test_exact_source_validation_covers_every_referencing_pack(self) -> None:
        source_key = ("af", "a" * 64)
        packs = []
        for key in ("first", "second"):
            packs.append(
                {
                    "job": {"locale": "af"},
                    "source": {
                        "entries": [
                            {"key": key, "sourceSha256": source_key[1]}
                        ]
                    },
                }
            )
        references = {
            source_key: [(packs[0], ("first",)), (packs[1], ("second",))]
        }
        seen: list[str] = []

        class Validator:
            def validate(
                self,
                pack: dict[str, object],
                values: dict[str, str],
            ) -> list[dict[str, object]]:
                key = next(iter(values))
                seen.append(values[key])
                reason = (
                    "field-fluency"
                    if pack is packs[0]
                    else "negation-marker-missing"
                )
                return [
                    {
                        "key": key,
                        "reasons": [reason],
                        "fluencyReason": (
                            "unbalanced-delimiters"
                            if reason == "field-fluency"
                            else None
                        ),
                    }
                ]

        source_memory = {source_key: "prior"}
        failures = WORKER.validate_exact_source_candidate(
            source_key,
            "candidate",
            references,
            source_memory,
            Validator(),
        )
        self.assertEqual(seen, ["candidate", "candidate"])
        self.assertEqual(
            failures,
            WORKER.RetryCandidateValidation(
                WORKER.Counter(
                    {"field-fluency": 1, "negation-marker-missing": 1}
                ),
                frozenset({"unbalanced-delimiters"}),
            ),
        )
        self.assertEqual(source_memory[source_key], "prior")


class ValidatorPolicyProvenanceTests(unittest.TestCase):
    @staticmethod
    def create_policy_repo(root: Path) -> dict[str, object]:
        for index, relative_path in enumerate(
            WORKER.VALIDATOR_POLICY_RELATIVE_PATHS
        ):
            target = root.joinpath(*relative_path.split("/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(f"policy-file-{index}\n".encode("utf-8"))
        return WORKER.create_validator_policy_provenance(root)

    def test_policy_digest_matches_fixed_cross_language_vector(self) -> None:
        files = [
            {
                "relativePath": "a.ts",
                "bytes": 0,
                "sha256": "0" * 64,
            },
            {
                "relativePath": "b.ts",
                "bytes": 12,
                "sha256": "f" * 64,
            },
        ]

        self.assertEqual(
            WORKER.validator_policy_sha256(files),
            "0508b761c20bc1d51e95bc0b11d558b09ac99e5f40ca85cf4ecbe577255177cf",
        )

    def test_dependency_tamper_is_rejected_against_bound_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            expected = self.create_policy_repo(root)
            requested = str(expected["validatorPolicySha256"])
            WORKER.assert_current_validator_policy(root, expected, requested)

            dependency = root / WORKER.VALIDATOR_POLICY_RELATIVE_PATHS[0]
            dependency.write_bytes(b"tampered dependency\n")
            with self.assertRaisesRegex(
                RuntimeError,
                "dependencies changed after provenance creation",
            ):
                WORKER.assert_current_validator_policy(
                    root,
                    expected,
                    requested,
                )

    def test_malformed_or_reordered_manifest_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            expected = self.create_policy_repo(root)
            malformed = json.loads(json.dumps(expected))
            malformed["files"][0], malformed["files"][1] = (
                malformed["files"][1],
                malformed["files"][0],
            )
            malformed["validatorPolicySha256"] = (
                WORKER.validator_policy_sha256(malformed["files"])
            )
            with self.assertRaisesRegex(
                RuntimeError,
                "file order/bytes are invalid",
            ):
                WORKER.validate_validator_policy_provenance(malformed)

            boolean_bytes = json.loads(json.dumps(expected))
            boolean_bytes["files"][0]["bytes"] = True
            with self.assertRaisesRegex(
                RuntimeError,
                "file order/bytes are invalid",
            ):
                WORKER.validate_validator_policy_provenance(boolean_bytes)

    def test_policy_dependencies_reject_hardlinks_and_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.create_policy_repo(root)
            dependency = root / WORKER.VALIDATOR_POLICY_RELATIVE_PATHS[0]
            hardlink = dependency.with_name("hardlink.ts")
            os.link(dependency, hardlink)
            with self.assertRaisesRegex(RuntimeError, "non-hardlinked"):
                WORKER.create_validator_policy_provenance(root)
            hardlink.unlink()

            target = dependency.with_name("symlink-target.ts")
            target.write_bytes(dependency.read_bytes())
            dependency.unlink()
            dependency.symlink_to(target)
            with self.assertRaisesRegex(RuntimeError, "through a symlink"):
                WORKER.create_validator_policy_provenance(root)

    def test_policy_dependency_path_replacement_race_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.create_policy_repo(root)
            relative_path = WORKER.VALIDATOR_POLICY_RELATIVE_PATHS[0]
            dependency = root / relative_path
            original_read = WORKER.os.read
            replaced = False

            def racing_read(descriptor: int, byte_count: int) -> bytes:
                nonlocal replaced
                if not replaced:
                    replacement = dependency.with_name("replacement.ts")
                    replacement.write_bytes(b"replacement bytes\n")
                    os.replace(replacement, dependency)
                    replaced = True
                return original_read(descriptor, byte_count)

            with mock.patch.object(
                WORKER.os,
                "read",
                side_effect=racing_read,
            ), self.assertRaisesRegex(
                RuntimeError,
                "changed while hashing|non-hardlinked",
            ):
                WORKER.read_validator_policy_dependency(root, relative_path)


if __name__ == "__main__":
    unittest.main()
