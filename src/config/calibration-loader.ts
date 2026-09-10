import * as fs from 'fs';
import * as path from 'path';
import {
  DetectorCalibrationProfile,
  EvaluationConfig,
  Severity,
} from '../types/evaluation.types';

export function applyCalibrationProfile(
  config: EvaluationConfig,
  profile?: DetectorCalibrationProfile
): EvaluationConfig {
  if (!profile) {
    return config;
  }

  return {
    ...config,
    riskModel: {
      ...config.riskModel,
      calibrationBucketCount:
        profile.riskModel?.calibrationBucketCount ?? config.riskModel.calibrationBucketCount,
      metricPriors: {
        ...config.riskModel.metricPriors,
        ...(profile.riskModel?.metricPriors || {}),
      },
      evidenceWeights: {
        ...config.riskModel.evidenceWeights,
        ...(profile.riskModel?.evidenceWeights || {}),
      },
      severityAnchors: {
        ...config.riskModel.severityAnchors,
        ...normalizeSeverityAnchors(profile.riskModel?.severityAnchors),
      },
    },
    detectorCalibration: {
      ...config.detectorCalibration,
      profileName: profile.profileName || config.detectorCalibration.profileName,
      calibrationSource: profile.source || config.detectorCalibration.calibrationSource,
      baselineScores: {
        ...config.detectorCalibration.baselineScores,
        ...(profile.detectorCalibration?.baselineScores || {}),
      },
    },
  };
}

export function loadCalibrationProfile(profilePath: string): DetectorCalibrationProfile {
  const resolved = path.resolve(profilePath);
  const raw = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(raw) as DetectorCalibrationProfile;
}

export function applyCalibrationProfileFromFile(
  config: EvaluationConfig,
  profilePath?: string
): EvaluationConfig {
  if (!profilePath) {
    return config;
  }

  return applyCalibrationProfile(config, loadCalibrationProfile(profilePath));
}

function normalizeSeverityAnchors(
  anchors?: Partial<Record<Severity, number>>
): Partial<Record<Severity, number>> {
  if (!anchors) {
    return {};
  }

  const normalized: Partial<Record<Severity, number>> = {};
  for (const key of Object.keys(anchors)) {
    const severity = key as Severity;
    const value = anchors[severity];
    if (typeof value === 'number' && !Number.isNaN(value)) {
      normalized[severity] = value;
    }
  }
  return normalized;
}
