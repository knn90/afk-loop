const maxLines = 200;
const tailLines = 50;

export interface FailureFormat {
  readonly line: RegExp;
  readonly blockHeader: RegExp;
  readonly blockLine: RegExp;
}

export const xcodeFailures: FailureFormat = {
  line: /\berror:|✘|\bfailed\b|\bFAILED\b/,
  blockHeader: /^(Failing tests|The following build commands failed):/,
  blockLine: /^\s+\S/,
};

export const gradleFailures: FailureFormat = {
  line: /^e: |\bFAILED\b|\bfailed\b|: [Ee]rror: |^\s+\S*(Error|Exception)\b/,
  blockHeader: /^\* What went wrong:/,
  blockLine: /\S/,
};

export interface StepOutput {
  readonly name: string;
  readonly output: string;
  readonly format: FailureFormat;
}

export function failureSummary(output: string, format: FailureFormat, lineLimit = maxLines): string {
  const all = output.split("\n");
  const kept: { line: string; inBlock: boolean }[] = [];
  const seen = new Set<string>();
  let inBlock = false;
  for (const line of all) {
    inBlock = format.blockHeader.test(line) || (inBlock && format.blockLine.test(line));
    if (inBlock) kept.push({ line, inBlock });
    else if (format.line.test(line) && !seen.has(line)) kept.push({ line, inBlock });
    seen.add(line);
  }
  if (kept.length === 0) return all.filter(Boolean).slice(-tailLines).join("\n");
  let room = lineLimit - kept.filter((entry) => entry.inBlock).length;
  return kept
    .filter((entry) => entry.inBlock || room-- > 0)
    .slice(0, lineLimit)
    .map((entry) => entry.line)
    .join("\n");
}

export function failedStepsSummary(steps: readonly StepOutput[]): string {
  const share = Math.floor(maxLines / steps.length) - 1;
  return steps.map((step) => `## ${step.name}\n${failureSummary(step.output, step.format, share)}`).join("\n");
}
