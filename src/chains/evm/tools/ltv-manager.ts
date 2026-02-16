/**
 * LTV Manager — chain-agnostic decision engine for autonomous borrow/yield agents.
 *
 * Reads current lending position + market rates + agent config, and outputs
 * a deterministic action: hold, repay (reduce risk), or optimize (increase yield).
 *
 * This module has zero on-chain dependencies — it operates on pure data.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentConfig = {
	/** Maximum LTV before auto-repay triggers (0..1). Default 0.75. */
	maxLTV: number;
	/** Target LTV for normal operation (0..1). Default 0.60. */
	targetLTV: number;
	/** Minimum yield spread (APY - APR) required for auto-optimize (0..1). Default 0.02. */
	minYieldSpread: number;
	/** Kill switch — all actions suppressed when true. */
	paused: boolean;
};

export type LtvManagerInput = {
	/** Current collateral value in USD */
	collateralValueUsd: number;
	/** Current borrow value in USD */
	borrowValueUsd: number;
	/** Supply APY (0..100 scale, e.g. 3.5 = 3.5%) */
	supplyAPY: number;
	/** Borrow APR (0..100 scale) */
	borrowAPR: number;
	/** Agent configuration */
	config: AgentConfig;
};

export type LtvHoldAction = {
	action: "hold";
	currentLTV: number;
	yieldSpread: number;
	reason: string;
};

export type LtvRepayAction = {
	action: "repay";
	currentLTV: number;
	yieldSpread: number;
	/** Suggested repay amount in USD to bring LTV back to target. */
	repayAmountUsd: number;
	reason: string;
};

export type LtvOptimizeAction = {
	action: "optimize";
	currentLTV: number;
	yieldSpread: number;
	/** Suggested additional borrow amount in USD. */
	borrowMoreUsd: number;
	reason: string;
};

export type LtvAction = LtvHoldAction | LtvRepayAction | LtvOptimizeAction;

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
	maxLTV: 0.75,
	targetLTV: 0.6,
	minYieldSpread: 0.02,
	paused: false,
};

// ---------------------------------------------------------------------------
// Core decision logic
// ---------------------------------------------------------------------------

/**
 * Compute current LTV from position values.
 * Returns 0 when no collateral.
 */
export function computeLTV(
	collateralValueUsd: number,
	borrowValueUsd: number,
): number {
	if (collateralValueUsd <= 0) return 0;
	return borrowValueUsd / collateralValueUsd;
}

/**
 * Compute yield spread = supplyAPY - borrowAPR (in 0..1 scale).
 * Input is 0..100 scale (percentage), output is 0..1 scale (ratio).
 */
export function computeYieldSpread(
	supplyAPY: number,
	borrowAPR: number,
): number {
	return (supplyAPY - borrowAPR) / 100;
}

/**
 * Calculate how much USD to repay to bring LTV from current to target.
 * Formula: repayAmount = borrowValue - (targetLTV * collateralValue)
 */
export function calculateRepayAmount(
	collateralValueUsd: number,
	borrowValueUsd: number,
	targetLTV: number,
): number {
	const targetBorrow = targetLTV * collateralValueUsd;
	const repay = borrowValueUsd - targetBorrow;
	return Math.max(0, repay);
}

/**
 * Calculate how much more USD can be borrowed to bring LTV up to target.
 * Formula: additionalBorrow = (targetLTV * collateralValue) - borrowValue
 */
export function calculateOptimizeAmount(
	collateralValueUsd: number,
	borrowValueUsd: number,
	targetLTV: number,
): number {
	const targetBorrow = targetLTV * collateralValueUsd;
	const additional = targetBorrow - borrowValueUsd;
	return Math.max(0, additional);
}

function pct(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

/**
 * Main decision function. Pure, deterministic, no side effects.
 */
export function decideLtvAction(input: LtvManagerInput): LtvAction {
	const currentLTV = computeLTV(input.collateralValueUsd, input.borrowValueUsd);
	const yieldSpread = computeYieldSpread(input.supplyAPY, input.borrowAPR);

	// Kill switch
	if (input.config.paused) {
		return {
			action: "hold",
			currentLTV,
			yieldSpread,
			reason: "Agent paused by owner.",
		};
	}

	// No position
	if (input.collateralValueUsd <= 0 && input.borrowValueUsd <= 0) {
		return {
			action: "hold",
			currentLTV,
			yieldSpread,
			reason: "No active position.",
		};
	}

	const { maxLTV, targetLTV, minYieldSpread } = input.config;

	// URGENT REPAY: LTV exceeds 95% of maxLTV
	const safetyThreshold = maxLTV * 0.95;
	if (currentLTV > safetyThreshold) {
		const repayAmountUsd = calculateRepayAmount(
			input.collateralValueUsd,
			input.borrowValueUsd,
			targetLTV,
		);
		return {
			action: "repay",
			currentLTV,
			yieldSpread,
			repayAmountUsd,
			reason: `LTV ${pct(currentLTV)} exceeds safety threshold ${pct(safetyThreshold)}. Repay $${repayAmountUsd.toFixed(2)} to reach target ${pct(targetLTV)}.`,
		};
	}

	// OPTIMIZE: LTV well below target AND yield is profitable
	const optimizeThreshold = targetLTV * 0.8;
	if (currentLTV < optimizeThreshold && yieldSpread > minYieldSpread) {
		const borrowMoreUsd = calculateOptimizeAmount(
			input.collateralValueUsd,
			input.borrowValueUsd,
			targetLTV,
		);
		if (borrowMoreUsd > 0) {
			return {
				action: "optimize",
				currentLTV,
				yieldSpread,
				borrowMoreUsd,
				reason: `LTV ${pct(currentLTV)} below optimize threshold ${pct(optimizeThreshold)}. Yield spread ${pct(yieldSpread)} > min ${pct(minYieldSpread)}. Borrow $${borrowMoreUsd.toFixed(2)} more.`,
			};
		}
	}

	// HOLD: everything is within acceptable range
	return {
		action: "hold",
		currentLTV,
		yieldSpread,
		reason: `LTV ${pct(currentLTV)} in safe range [${pct(optimizeThreshold)}..${pct(safetyThreshold)}]. Yield spread ${pct(yieldSpread)}.`,
	};
}
