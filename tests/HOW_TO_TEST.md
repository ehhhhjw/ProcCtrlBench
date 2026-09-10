# How to Verify the Current Implementation

## 1. Build

```bash
npm install
npm run build
```

## 2. Run the Example

```bash
npm run example
```

## 3. Check the Report

Confirm that:

- there is no `totalScore`
- there is no `overallAssessment`
- there is no dimension `score`
- `summary.totalWarnings` and `summary.totalErrors` are present
- `taskOutcome.details` is present

## 4. Check `deadStep`

Prepare a trajectory containing `Write` and confirm that no `deadStep` issue is produced because of `Write`.

## 5. Check the Benchmark Summary

If you have multiple JSON reports:

```bash
npx ts-node src/benchmark/BenchmarkRunner.ts ./output/evaluation-reports ./output/benchmark/summary.md
```

Confirm that the output contains:

- the average number of warnings
- the average number of errors
- the 95% CI

rather than an average score.
