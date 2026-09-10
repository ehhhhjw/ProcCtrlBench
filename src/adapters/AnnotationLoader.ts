import * as fs from 'fs';
import { PROCCTRL_DEFECT_KEYS, ProcCtrlDefectKey } from '../benchmark/ProcCtrlScorecard';

/**
 * 过程级人工标注集的读取与校验。
 *
 * 对应论文附录 B.1 / B.4 的标注协议：
 * - 每条轨迹由两名标注者独立标注 11 类缺陷；
 * - 每个判断取值 present / absent / exempt（豁免指模式匹配但在任务语境下合理）；
 * - 两人分歧时由第三名评审仲裁，仲裁结果作为最终标签；
 * - 一致性在仲裁前计算（见 PaperMetrics.computeAgreementStats）。
 *
 * 本仓库不包含标注数据本身，只定义接口与校验规则。
 */

export const ANNOTATION_SCHEMA_VERSION = 'procctrlbench-annotation-v1';

/** 单个缺陷判断的三值取值 */
export type AnnotationJudgment = 'present' | 'absent' | 'exempt';

export const ANNOTATION_JUDGMENTS: readonly AnnotationJudgment[] = ['present', 'absent', 'exempt'];

export interface DefectAnnotation {
  /** 标注者 A 的判断 */
  annotatorA: AnnotationJudgment;
  /** 标注者 B 的判断 */
  annotatorB: AnnotationJudgment;
  /** 仲裁结果；两人一致时可省略 */
  adjudicated?: AnnotationJudgment;
  /** 触发证据摘要 */
  evidence?: string;
  /** 豁免理由 */
  exemptionRationale?: string;
}

export interface AnnotatedCase {
  /** 全局唯一的样本标识 */
  caseId: string;
  /** 任务来源：android-bench / terminal-bench / swe-bench-verified */
  benchmark: string;
  taskId: string;
  trialId?: string;
  /** 产生该轨迹的 agent-model 系统标识 */
  system?: string;
  /** 端点任务是否成功；null 表示日志未记录 */
  success: boolean | null;
  /** 原始轨迹路径，用于与检测器输出对齐 */
  rawPath?: string;
  /** 逐缺陷标注，键为 11 类缺陷之一 */
  annotations: Partial<Record<ProcCtrlDefectKey, DefectAnnotation>>;
}

export interface AnnotationSet {
  schemaVersion: string;
  /** 标注集说明，例如标注者背景、标注轮次 */
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
  /** 阻断性问题：存在时不应用于产出论文表格 */
  errors: AnnotationValidationIssue[];
  /** 非阻断性问题，例如缺少证据说明 */
  warnings: AnnotationValidationIssue[];
  caseCount: number;
  /** 每类缺陷实际被标注的样本数 */
  coverageByDefect: Record<ProcCtrlDefectKey, number>;
}

function isJudgment(value: unknown): value is AnnotationJudgment {
  return typeof value === 'string' && (ANNOTATION_JUDGMENTS as readonly string[]).includes(value);
}

/**
 * 解析最终标签。
 *
 * 两人一致时取该判断；不一致时必须有仲裁结果，否则视为未定标签返回 null。
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
 * 最终标签转为检测评估用的二值真值 y_j。
 *
 * 仅 present 记为 1；exempt 记为 0——豁免的语义是"模式匹配但在任务语境下并非缺陷"，
 * 因此它不是正例。豁免率单独在 Table 5 报告，不混入 precision / recall。
 */
export function judgmentToLabel(judgment: AnnotationJudgment): boolean {
  return judgment === 'present';
}

/** 两名标注者是否分歧（仲裁前） */
export function hasDisagreement(annotation: DefectAnnotation): boolean {
  return annotation.annotatorA !== annotation.annotatorB;
}

/** 校验标注集结构，返回阻断性与非阻断性问题 */
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

/** 从 JSON 文件读取并校验标注集 */
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

/** 展平为逐 (case, defect) 的标签行，便于与检测器输出做连接 */
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
  /** 检测评估用的二值真值 */
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
        // 分歧未仲裁的条目由 validateAnnotationSet 报错，这里跳过以免污染指标
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
