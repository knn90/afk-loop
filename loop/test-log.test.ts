import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { failedStepsSummary, failureSummary, gradleFailures, xcodeFailures } from "./test-log.js";

describe("failureSummary", () => {
  test("keeps compiler errors and failing tests, drops build noise", () => {
    const sut = makeSUT();
    const log = [
      "CompileSwift normal arm64 /w/ios/Features/Today/Sources/Today/TodayView.swift",
      "/w/ios/Features/Today/Sources/Today/TodayView.swift:12:5: error: cannot find 'streak' in scope",
      "/w/ios/Features/Today/Sources/Today/TodayView.swift:20:1: warning: unused variable",
      "Test case 'TodayViewModelTests/showsProgress()' failed on 'iPhone 17' (0.002 seconds)",
      "✘ Test showsProgress() recorded an issue at TodayViewModelTests.swift:30:9: Expectation failed: (progress → 0.5) == 1",
      "Test case 'TodayViewModelTests/startsEmpty()' passed on 'iPhone 17' (0.001 seconds)",
      "Failing tests:",
      "\tTodayViewModelTests.showsProgress()",
      "",
      "** TEST FAILED **",
    ].join("\n");

    const summary = sut.failureSummary(log, xcodeFailures);

    assert.deepEqual(summary.split("\n"), [
      "/w/ios/Features/Today/Sources/Today/TodayView.swift:12:5: error: cannot find 'streak' in scope",
      "Test case 'TodayViewModelTests/showsProgress()' failed on 'iPhone 17' (0.002 seconds)",
      "✘ Test showsProgress() recorded an issue at TodayViewModelTests.swift:30:9: Expectation failed: (progress → 0.5) == 1",
      "Failing tests:",
      "\tTodayViewModelTests.showsProgress()",
      "** TEST FAILED **",
    ]);
  });

  test("keeps the commands listed under a failed build", () => {
    const sut = makeSUT();
    const log = ["The following build commands failed:", "\tSwiftCompile normal arm64 /w/A.swift", "(1 failure)"].join("\n");

    const summary = sut.failureSummary(log, xcodeFailures);

    assert.deepEqual(summary.split("\n"), ["The following build commands failed:", "\tSwiftCompile normal arm64 /w/A.swift"]);
  });

  test("drops repeated lines", () => {
    const sut = makeSUT();
    const error = "/w/A.swift:1:1: error: boom";
    const log = [error, "noise", error].join("\n");

    const summary = sut.failureSummary(log, xcodeFailures);

    assert.equal(summary, error);
  });

  test("caps the summary at 200 lines", () => {
    const sut = makeSUT();
    const log = errorLines("A", 300);

    const summary = sut.failureSummary(log, xcodeFailures);

    assert.equal(summary.split("\n").length, 200);
  });

  test("falls back to the log's tail when no failure line matches", () => {
    const sut = makeSUT();
    const log = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");

    const summary = sut.failureSummary(log, xcodeFailures);

    assert.deepEqual(summary.split("\n"), Array.from({ length: 50 }, (_, i) => `line ${i + 30}`));
  });

  test("keeps a Gradle run's compile errors, failing tests, Lint errors and what went wrong", () => {
    const sut = makeSUT();
    const log = [
      "> Task :core:compileDebugKotlin FAILED",
      "e: file:///w/android/core/src/main/kotlin/Streak.kt:12:5 Unresolved reference 'days'.",
      "w: file:///w/android/core/src/main/kotlin/Streak.kt:20:1 Variable 'x' is never used",
      "> Task :features:today:testDebugUnitTest",
      "TodayViewModelTest > shows progress FAILED",
      "    java.lang.AssertionError at TodayViewModelTest.kt:30",
      "TodayViewModelTest > starts empty PASSED",
      "/w/android/app/src/main/kotlin/MainActivity.kt:9: Error: Call requires API level 33 [NewApi]",
      "* What went wrong:",
      "Execution failed for task ':core:compileDebugKotlin'.",
      "> Compilation error. See log for more details",
      "",
      "* Try:",
      "> Run with --stacktrace option to get the stack trace.",
      "BUILD FAILED in 12s",
    ].join("\n");

    const summary = sut.failureSummary(log, gradleFailures);

    assert.deepEqual(summary.split("\n"), [
      "> Task :core:compileDebugKotlin FAILED",
      "e: file:///w/android/core/src/main/kotlin/Streak.kt:12:5 Unresolved reference 'days'.",
      "TodayViewModelTest > shows progress FAILED",
      "    java.lang.AssertionError at TodayViewModelTest.kt:30",
      "/w/android/app/src/main/kotlin/MainActivity.kt:9: Error: Call requires API level 33 [NewApi]",
      "* What went wrong:",
      "Execution failed for task ':core:compileDebugKotlin'.",
      "> Compilation error. See log for more details",
      "BUILD FAILED in 12s",
    ]);
  });
});

describe("failureSummary, Gradle", () => {
  test("keeps javac errors", () => {
    const sut = makeSUT();
    const error = "/w/android/app/src/main/java/Legacy.java:3: error: cannot find symbol";
    const log = ["> Task :app:compileDebugJavaWithJavac", error, "  symbol: class Streak"].join("\n");

    const summary = sut.failureSummary(log, gradleFailures);

    assert.equal(summary, error);
  });

  test("keeps what went wrong for every failed task", () => {
    const sut = makeSUT();
    const wentWrong = (task: string) => ["* What went wrong:", `Execution failed for task '${task}'.`, ""];
    const log = [...wentWrong(":core:testDebugUnitTest"), ...wentWrong(":app:lintDebug")].join("\n");

    const summary = sut.failureSummary(log, gradleFailures);

    assert.deepEqual(summary.split("\n"), wentWrong(":core:testDebugUnitTest").concat(wentWrong(":app:lintDebug")).filter(Boolean));
  });

  test("past the cap, what went wrong outlasts the compile errors", () => {
    const sut = makeSUT();
    const errors = Array.from({ length: 300 }, (_, i) => `e: file:///w/A.kt:${i}:1 Unresolved reference 'x'.`);
    const log = [...errors, "* What went wrong:", "Execution failed for task ':core:compileDebugKotlin'."].join("\n");

    const summary = sut.failureSummary(log, gradleFailures).split("\n");

    assert.equal(summary.length, 200);
    assert.deepEqual(summary.slice(-2), ["* What went wrong:", "Execution failed for task ':core:compileDebugKotlin'."]);
  });
});

describe("failedStepsSummary", () => {
  test("gives each failing step an equal share of the 200 lines, under its name", () => {
    const sut = makeSUT();
    const steps = ["Core", "Today"].map((name) => ({ name, output: errorLines(name, 150), format: xcodeFailures }));

    const summary = sut.failedStepsSummary(steps).split("\n");

    assert.equal(summary.length, 200);
    assert.deepEqual([summary[0], summary[100]], ["## Core", "## Today"]);
  });
});

// MARK: - Helpers

function makeSUT() {
  return { failureSummary, failedStepsSummary };
}

function errorLines(file: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `/w/${file}.swift:${i}:1: error: boom`).join("\n");
}
