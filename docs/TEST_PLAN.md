# Test Plan for the 11 Benchmarks (Reproducible)

- Sample set: ≥30 samples per task category; ≥5 trials per task (varying seed / initial prompt / tool visibility).
- Data collection: persist `output/evaluation-reports/*.json` and `output/file-graph.json`; record dependency versions and random seeds.
- Validation items:
  - DeadStep/DuplicateStep: AST symbol references, indirect references from the file graph, effective hit rate and false positive rate.
  - Thrashing: effectiveness of the 75% window threshold prewarn; accuracy of discriminating scenarios a/b.
  - Wrapper/Coupling/Chain: structural metrics (SCC, sequence entropy) and the intervention effect of injected recommendations.
  - Interface/Weak: significance of divergence and dispersion; effect size before and after prompt mutation.
- Statistics: `src/benchmark/BenchmarkRunner.ts` reports mean ±95% CI; paired t-tests and effect-size reporting where necessary.
- Pass criterion: on ≥80% of tasks, the detections / improvement recommendations of a metric are statistically significant (p<0.05, d≥0.5) and are endorsed by engineer review.
