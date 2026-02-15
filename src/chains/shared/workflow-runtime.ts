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

export function parseRunModeHint<
	TAllowCompose extends boolean | undefined = false,
>(
	text: string | undefined,
	options?: Partial<WorkflowRunModeOptions> & { allowCompose?: TAllowCompose },
): TAllowCompose extends true
	? WorkflowRunModeWithCompose | undefined
	: WorkflowRunMode | undefined {
	const parsedOptions = {
		...DEFAULT_WORKFLOW_RUN_MODE_OPTIONS,
		...options,
	};
	if (!text?.trim()) {
		return undefined as TAllowCompose extends true
			? WorkflowRunModeWithCompose | undefined
			: WorkflowRunMode | undefined;
	}

	const hasExecute = HAS_EXECUTE_HINT.test(text);
	const hasSimulate = HAS_SIMULATE_HINT.test(text);
	const hasAnalysis = HAS_ANALYSIS_HINT.test(text);
	let mode: WorkflowRunMode | WorkflowRunModeWithCompose | undefined;
	if (parsedOptions.allowCompose && /compose|编排|组装|构建/.test(text)) {
		mode = "compose";
	} else if (hasSimulate && !hasExecute) {
		mode = "simulate";
	} else if (hasAnalysis && !hasExecute && !hasSimulate) {
		mode = "analysis";
	} else if (hasExecute && !hasSimulate && !hasAnalysis) {
		mode = "execute";
	} else if (hasSimulate && hasExecute) {
		if (
			/(先模拟|先仿真|先dry\s*run|先试跑|先试一下|先预演|先演练)/i.test(text)
		) {
			mode = "simulate";
		} else {
			mode = "execute";
		}
	} else if (hasAnalysis && hasExecute) {
		if (/(先分析|先看一下|先检查)/i.test(text)) {
			mode = "analysis";
		} else {
			mode = "execute";
		}
	} else if (hasExecute) {
		mode = "execute";
	} else if (hasSimulate) {
		mode = "simulate";
	} else if (hasAnalysis) {
		mode = "analysis";
	}
	return mode as TAllowCompose extends true
		? WorkflowRunModeWithCompose | undefined
		: WorkflowRunMode | undefined;
}

export function resolveWorkflowRunMode<
	TAllowCompose extends boolean | undefined = false,
>(
	paramsRunMode: string | undefined,
	intentText: string | undefined,
	options?: Partial<WorkflowRunModeOptions> & { allowCompose?: TAllowCompose },
): TAllowCompose extends true ? WorkflowRunModeWithCompose : WorkflowRunMode {
	const resolvedOptions = {
		...DEFAULT_WORKFLOW_RUN_MODE_OPTIONS,
		...options,
	};
	const allowCompose = resolvedOptions.allowCompose;
	const hint = parseRunModeHint<TAllowCompose>(intentText, options);
	const parseMode = (
		value: string | undefined,
	): WorkflowRunMode | WorkflowRunModeWithCompose =>
		allowCompose
			? parseRunModeWithCompose(value, resolvedOptions)
			: parseRunMode(value, resolvedOptions);

	const selectedMode = paramsRunMode != null ? paramsRunMode : hint;
	return (
		selectedMode != null ? parseMode(selectedMode) : "analysis"
	) as TAllowCompose extends true
		? WorkflowRunModeWithCompose
		: WorkflowRunMode;
}
