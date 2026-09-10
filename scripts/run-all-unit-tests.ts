import { execSync } from 'child_process';

function run(cmd: string) {
  execSync(cmd, { stdio: 'inherit' });
}

// Run all unit tests in one pass (requires a build first)
run("npm run build");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/deadstep-indirect-ref.ts");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/deadstep-write-exempt.ts");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/toolchain-prewarn.ts");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/ghostcontext-code-reference.ts");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/interface-dispersion-prewarn.ts");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/interface-ast-context.ts");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/thrashing-prewarn.ts");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/thrashing-context-reuse.ts");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/ghost-oversized-prewarn.ts");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/longchain-prewarn.ts");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/longchain-structural-subtasks.ts");
run("npx ts-node -O '{\"types\":[\"node\",\"./src/types/externals.d.ts\"],\"skipLibCheck\":true}' scripts/unit/weaktool-ast-opportunity.ts");

console.log('All unit tests passed');
