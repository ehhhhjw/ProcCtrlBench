import * as fs from 'fs';
import { PROCCTRL_DEFECT_KEYS, ProcCtrlDefectKey } from '../benchmark/ProcCtrlScorecard';

/**
 * Loading and validation of the process-level manual annotation set.
 *
 * Implements the annotation protocol from Appendix B.1 / B.4 of the paper:
 * - Each trajectory is independently annotated for the 11 defect classes by two annotators;
 * - Each judgment takes the value present / absent / exempt (exempt means the pattern
 *   matches but is reasonable in the task context);
 * - When the two annotators disagree, a third reviewer adjudicates, and the adjudicated
 *   result becomes the final label;
 * - Agreement is computed before adjudication (see PaperMetrics.computeAgreementStats).
 *
 * This repository does not contain the annotation data itself; it only defines the
 * interfaces and validation rules.
 */

export const ANNOTATION_SCHEMA_VERSION = 'procctrlbench-annotation-v1';

/** The three possible values of a single defect judgment */
export type AnnotationJudgment = 'present' | 'absent' | 'exempt';

export const ANNOTATION_JUDGMENTS: readonly AnnotationJudgment[] = ['present', 'absent', 'exempt'];

export interface DefectAnnotation {
  /** Judgment from annotator A */
  annotatorA: AnnotationJudgment;
  /** Judgment from annotator B */
  annotatorB: AnnotationJudgment;
  /** Adjudicated result; may be omitted when the two annotators agree */
  adjudicated?: AnnotationJudgment;
  /** Summary of the triggering evidence */
  evidence?: string;
  /** Rationale for the exemption */
  exemptionRationale?: string;
}

export interface AnnotatedCase {
  /** Globally unique case identifier */
  caseId: string;
  /** Task source: android-bench / terminal-bench / swe-bench-verified */
  benchmark: string;
  taskId: string;
  trialId?: string;
  /** Identifier of the agent-model system that produced this trajectory */
  system?: string;
  /** Whether the end-to-end task succeeded; null means the log did not record it */
  success: boolean | null;
  /** Path to the raw trajectory, used to align with detector output */
  rawPath?: string;
  /** Per-defect annotations, keyed by one of the 11 defect classes */
  annotations: Partial<Record<ProcCtrlDefectKey, DefectAnnotation>>;
}

export interface AnnotationSet {
  schemaVersion: string;
  /** Notes about the annotation set, e.g. annotator background or annotation round */
  description?: string;
  cases: AnnotatedCase[];
}

export interface AnnotationValidationIssue {
  caseId: string;
  defect?: ProcCtrlDefectKey | string;
  message: string;
}

export interface LoadedAnnotationSet {
  set: AnnotationSet;
  /** Blocking issues: when present, the set should not be used to produce paper tables */
  errors: AnnotationValidationIssue[];
  /** Non-blocking issues, e.g. a missing evidence note */
  warnings: AnnotationValidationIssue[];
  caseCount: number;
  /** Number of cases actually annotated for each defect class */
  coverageByDefect: Record<ProcCtrlDefectKey, number>;
}

function isJudgment(value: unknown): value is AnnotationJudgment {
  return typeof value === 'string' && (ANNOTATION_JUDGMENTS as readonly string[]).includes(value);
}

/**
 * Resolves the final label.
 *
 * When the two annotators agree, that judgment is used; when they disagree an
 * adjudicated result is required, otherwise the label is treated as undetermined
 * and null is returned.
 */
export function resolveFinalJudgment(annotation: DefectAnnotation): AnnotationJudgment | null {
  if (annotation.adjudicated) {
    return annotation.adjudicated;
  }
  if (annotation.annotatorA === annotation.annotatorB) {
    return annotation.annotatorA;
  }
  return null;
}

/**
 * Converts the final label into the binary ground truth y_j used for detection evaluation.
 *
 * Only present counts as 1; exempt counts as 0 -- the semantics of exempt are "the pattern
 * matches but it is not a defect in the task context", so it is not a positive example.
 * The exemption rate is reported separately in Table 5 and is not mixed into
 * precision / recall.
 */
export function judgmentToLabel(judgment: AnnotationJudgment): boolean {
  return judgment === 'present';
}

/** Whether the two annotators disagree (before adjudication) */
export function hasDisagreement(annotation: DefectAnnotation): boolean {
  return annotation.annotatorA !== annotation.annotatorB;
}

/** Validates the annotation set structure, returning blocking and non-blocking issues */
export function validateAnnotationSet(set: AnnotationSet): {
  errors: AnnotationValidationIssue[];
  warnings: AnnotationValidationIssue[];
  coverageByDefect: Record<ProcCtrlDefectKey, number>;
} {
  const errors: AnnotationValidationIssue[] = [];
  const warnings: AnnotationValidationIssue[] = [];
  const coverageByDefect = {} as Record<ProcCtrlDefectKey, number>;
  for (const key of PROCCTRL_DEFECT_KEYS) {
    coverageByDefect[key] = 0;
  }

  if (set.schemaVersion !== ANNOTATION_SCHEMA_VERSION) {
    errors.push({
      caseId: '(root)',
      message: `Unexpected schemaVersion "${set.schemaVersion}", expected "${ANNOTATION_SCHEMA_VERSION}"`,
    });
  }

  const seenCaseIds = new Set<string>();
  const knownDefects = new Set<string>(PROCCTRL_DEFECT_KEYS);

  for (const annotatedCase of set.cases) {
    if (!annotatedCase.caseId) {
      errors.push({ caseId: '(missing)', message: 'caseId is required' });
      continue;
    }
    if (seenCaseIds.has(annotatedCase.caseId)) {
      errors.push({ caseId: annotatedCase.caseId, message: 'Duplicate caseId' });
    }
    seenCaseIds.add(annotatedCase.caseId);

    if (!annotatedCase.benchmark) {
      errors.push({ caseId: annotatedCase.caseId, message: 'benchmark is required for stratified splitting' });
    }

    for (const [defect, annotation] of Object.entries(annotatedCase.annotations || {})) {
      if (!knownDefects.has(defect)) {
        errors.push({
          caseId: annotatedCase.caseId,
          defect,
          message: `Unknown defect key "${defect}"; expected one of ${PROCCTRL_DEFECT_KEYS.join(', ')}`,
        });
        continue;
      }
      if (!annotation) {
        continue;
      }

      const defectKey = defect as ProcCtrlDefectKey;
      if (!isJudgment(annotation.annotatorA) || !isJudgment(annotation.annotatorB)) {
        errors.push({
          caseId: annotatedCase.caseId,
          defect: defectKey,
          message: `annotatorA / annotatorB must each be one of ${ANNOTATION_JUDGMENTS.join(' | ')}`,
        });
        continue;
      }
      if (annotation.adjudicated !== undefined && !isJudgment(annotation.adjudicated)) {
        errors.push({
          caseId: annotatedCase.caseId,
          defect: defectKey,
          message: `adjudicated must be one of ${ANNOTATION_JUDGMENTS.join(' | ')} when present`,
        });
        continue;
      }

      if (hasDisagreement(annotation) && !annotation.adjudicated) {
        errors.push({
          caseId: annotatedCase.caseId,
          defect: defectKey,
          message: 'Annotators disagree but no adjudicated label is provided',
        });
        continue;
      }

      const finalJudgment = resolveFinalJudgment(annotation);
      if (finalJudgment === 'exempt' && !annotation.exemptionRationale) {
        warnings.push({
          caseId: annotatedCase.caseId,
          defect: defectKey,
          message: 'Exempt judgment without exemptionRationale',
        });
      }
      if (finalJudgment === 'present' && !annotation.evidence) {
        warnings.push({
          caseId: annotatedCase.caseId,
          defect: defectKey,
          message: 'Present judgment without triggering evidence',
        });
      }

      coverageByDefect[defectKey]++;
    }

    const missing = PROCCTRL_DEFECT_KEYS.filter((key) => !(annotatedCase.annotations || {})[key]);
    if (missing.length > 0) {
      warnings.push({
        caseId: annotatedCase.caseId,
        message: `Missing annotations for: ${missing.join(', ')}`,
      });
    }
  }

  return { errors, warnings, coverageByDefect };
}

/** Loads and validates an annotation set from a JSON file */
export function loadAnnotationSet(filePath: string): LoadedAnnotationSet {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Annotation set not found at ${filePath}. ` +
        'This repository does not ship annotation data; point --annotations at your own annotated set.'
    );
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AnnotationSet;
  if (!parsed || !Array.isArray(parsed.cases)) {
    throw new Error(`Malformed annotation set at ${filePath}: expected an object with a "cases" array`);
  }

  const { errors, warnings, coverageByDefect } = validateAnnotationSet(parsed);

  return {
    set: parsed,
    errors,
    warnings,
    caseCount: parsed.cases.length,
    coverageByDefect,
  };
}

/** Flattened per-(case, defect) label rows, for joining against detector output */
export interface FlatAnnotationRow {
  caseId: string;
  benchmark: string;
  system?: string;
  success: boolean | null;
  rawPath?: string;
  defect: ProcCtrlDefectKey;
  annotatorA: AnnotationJudgment;
  annotatorB: AnnotationJudgment;
  finalJudgment: AnnotationJudgment;
  /** Binary ground truth used for detection evaluation */
  label: boolean;
  exempt: boolean;
  adjudicated: boolean;
}

export function flattenAnnotationSet(set: AnnotationSet): FlatAnnotationRow[] {
  const rows: FlatAnnotationRow[] = [];

  for (const annotatedCase of set.cases) {
    for (const key of PROCCTRL_DEFECT_KEYS) {
      const annotation = (annotatedCase.annotations || {})[key];
      if (!annotation) {
        continue;
      }
      const finalJudgment = resolveFinalJudgment(annotation);
      if (!finalJudgment) {
        // Unadjudicated disagreements are reported as errors by validateAnnotationSet;
        // skip them here so they do not pollute the metrics
        continue;
      }

      rows.push({
        caseId: annotatedCase.caseId,
        benchmark: annotatedCase.benchmark,
        system: annotatedCase.system,
        success: annotatedCase.success ?? null,
        rawPath: annotatedCase.rawPath,
        defect: key,
        annotatorA: annotation.annotatorA,
        annotatorB: annotation.annotatorB,
        finalJudgment,
        label: judgmentToLabel(finalJudgment),
        exempt: finalJudgment === 'exempt',
        adjudicated: Boolean(annotation.adjudicated) && hasDisagreement(annotation),
      });
    }
  }

  return rows;
}
