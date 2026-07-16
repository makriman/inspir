import test, { type TestContext } from "node:test";
import {
  FULL_TRANSLATION_COMPLETION_TEST_TITLES,
  fullTranslationCompletionTestsEnabled,
  type FullTranslationCompletionTestTitle,
} from "../../scripts/release-unit-test-contract";

type FullTranslationCompletionTestBody = (
  context: TestContext,
) => void | Promise<void>;

const allowedTitles = new Set<string>(FULL_TRANSLATION_COMPLETION_TEST_TITLES);
const registeredTitles: FullTranslationCompletionTestTitle[] = [];
const completionTestsEnabled = fullTranslationCompletionTestsEnabled();

export function fullTranslationCompletionTest(
  title: FullTranslationCompletionTestTitle,
  body: FullTranslationCompletionTestBody,
) {
  if (!allowedTitles.has(title)) {
    throw new Error(`Unrecognized full translation completion test: ${title}`);
  }
  if (registeredTitles.includes(title)) {
    throw new Error(`Duplicate full translation completion test: ${title}`);
  }
  registeredTitles.push(title);
  if (completionTestsEnabled) test(title, body);
}

export function assertFullTranslationCompletionTestRegistration() {
  const registrationIsExact =
    registeredTitles.length === FULL_TRANSLATION_COMPLETION_TEST_TITLES.length &&
    registeredTitles.every(
      (title, index) => title === FULL_TRANSLATION_COMPLETION_TEST_TITLES[index],
    );
  if (!registrationIsExact) {
    throw new Error(
      `Full translation completion test registration differs from the exact ${FULL_TRANSLATION_COMPLETION_TEST_TITLES.length}-title contract.`,
    );
  }
}
