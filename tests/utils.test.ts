import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, duplicateAwareRows } from "../lib/migration/csv";
import { slugify } from "../lib/utils/slug";

test("slugify creates stable topic slugs", () => {
  assert.equal(slugify("Debate with a personality"), "debate-with-a-personality");
});

test("csv parser keeps quoted commas and newlines intact", () => {
  const rows = parseCsv('"name","body"\n"Topic","one, two\\nthree"\n');
  assert.deepEqual(rows, [{ name: "Topic", body: "one, two\\nthree" }]);
});

test("csv rows are deduplicated exactly", () => {
  const result = duplicateAwareRows(
    [
      { a: "1", b: "2" },
      { a: "1", b: "2" },
    ],
    false,
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.skipped, 1);
});
