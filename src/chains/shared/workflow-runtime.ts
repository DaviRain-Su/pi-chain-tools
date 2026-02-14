export type WorkflowRunMode = "analysis" | "simulate" | "execute";
export type WorkflowRunModeWithCompose = WorkflowRunMode | "compose";

export type WorkflowRunModeOptions = {
	allowCompose: boolean;
};

const DEFAULT_WORKFLOW_RUN_MODE_OPTIONS: WorkflowRunModeOptions = {
	allowCompose: false,
};

function isAllowed(
	value: string | undefined,
	options: WorkflowRunModeOptions,
): boolean {
	return (
		value === "analysis" ||
		value === "simulate" ||
		value === "execute" ||
		(options.allowCompose && value === "compose")
	);
}

const HAS_EXECUTE_HINT =
	/(确认主网执行|确认执行|继续执行|直接执行|立即执行|现在执行|马上执行|execute|submit|live\s+order|real\s+order|\bnow\b.*\bexecute\b)/i;
const HAS_SIMULATE_HINT =
	/(先模拟|模拟一下|先仿真|先dry\s*run|dry\s*run|simulate|先试跑|先试一下|先预演|先演练)/i;
const HAS_ANALYSIS_HINT =
	/(先分析|分析一下|先评估|先看分析|analysis|analyze|先看一下|先检查)/i;

export function parseRunMode(
	value: string | undefined,
	options?: Partial<WorkflowRunModeOptions>,
): WorkflowRunMode {
	const parsedOptions = {
		...DEFAULT_WORKFLOW_RUN_MODE_OPTIONS,
		...options,
	};
	if (isAllowed(value, parsedOptions)) {
		return value as WorkflowRunMode;
	}
	return "analysis";
}

export function parseRunModeWithCompose(
	value: string | undefined,
	options?: Partial<WorkflowRunModeOptions>,
): WorkflowRunModeWithCompose {
	const parsedOptions = {
		...DEFAULT_WORKFLOW_RUN_MODE_OPTIONS,
		...options,
	};
	if (isAllowed(value, parsedOptions)) {
		return value as WorkflowRunModeWithCompose;
	}
	return "analysis";
}

export function parseRunModeHint(
	text: string | undefined,
	options?: Partial<WorkflowRunModeOptions>,
): WorkflowRunMode | "compose" | undefined {
	const parsedOptions = {
		...DEFAULT_WORKFLOW_RUN_MODE_OPTIONS,
		...options,
	};
	if (!text?.trim()) return undefined;

	const hasExecute = HAS_EXECUTE_HINT.test(text);
	const hasSimulate = HAS_SIMULATE_HINT.test(text);
	const hasAnalysis = HAS_ANALYSIS_HINT.test(text);
	if (parsedOptions.allowCompose && /compose|编排|组装|构建/.test(text)) {
		return "compose";
	}

	if (hasSimulate && !hasExecute) return "simulate";
	if (hasAnalysis && !hasExecute && !hasSimulate) return "analysis";
	if (hasExecute && !hasSimulate && !hasAnalysis) return "execute";
	if (hasSimulate && hasExecute) {
		if (
			/(先模拟|先仿真|先dry\s*run|先试跑|先试一下|先预演|先演练)/i.test(text)
		) {
			return "simulate";
		}
		return "execute";
	}
	if (hasAnalysis && hasExecute) {
		if (/(先分析|先看一下|先检查)/i.test(text)) return "analysis";
		return "execute";
	}
	if (hasExecute) return "execute";
	if (hasSimulate) return "simulate";
	if (hasAnalysis) return "analysis";
	return undefined;
}

export function resolveWorkflowRunMode(
	paramsRunMode: string | undefined,
	intentText: string | undefined,
	options?: Partial<WorkflowRunModeOptions> & {
		allowCompose?: boolean;
	},
): WorkflowRunModeWithCompose {
	const hint = parseRunModeHint(intentText, options);
	return paramsRunMode != null
		? parseRunModeWithCompose(paramsRunMode, options)
		: hint != null
			? parseRunModeWithCompose(hint, options)
			: "analysis";
}
