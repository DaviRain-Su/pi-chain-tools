const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function asRecord(input) {
	return input && typeof input === "object" ? input : {};
}

function normalizeStateDelta(raw) {
	const data = asRecord(raw);
	const previousState = String(
		data.previousState || data.prevState || "",
	).trim();
	const nextState = String(data.nextState || data.newState || "").trim();
	if (!previousState || !nextState) return null;
	return {
		previousState,
		nextState,
		label: `${previousState}->${nextState}`,
	};
}

export function parseCycleTriggerProof(raw, env = process.env) {
	const source =
		typeof raw === "string" && raw.trim()
			? raw
			: String(env.BSC_AUTONOMOUS_TRIGGER_JSON || "").trim();
	if (!source) {
		return {
			available: false,
			valid: false,
			source: "missing",
			blockers: ["onchain cycle trigger proof missing"],
		};
	}
	try {
		const parsed = JSON.parse(source);
		const txHash = String(
			parsed?.txHash || parsed?.transactionHash || "",
		).trim();
		const cycleId = String(parsed?.cycleId || "").trim();
		const transitionId = String(
			parsed?.transitionId || parsed?.nonce || "",
		).trim();
		const eventName = String(
			parsed?.eventName || parsed?.event || "DeterministicCycleTriggered",
		).trim();
		const emittedEvents = Array.isArray(parsed?.emittedEvents)
			? parsed.emittedEvents
			: [];
		const stateDelta = normalizeStateDelta(
			parsed?.stateDelta || parsed?.state || null,
		);
		const blockers = [];
		if (!TX_HASH_PATTERN.test(txHash))
			blockers.push("invalid txHash in trigger proof");
		if (!cycleId) blockers.push("cycleId missing in trigger proof");
		if (!transitionId) blockers.push("transitionId missing in trigger proof");
		if (!stateDelta) blockers.push("stateDelta missing in trigger proof");
		return {
			available: true,
			valid: blockers.length === 0,
			source: "json",
			txHash: txHash || null,
			cycleId: cycleId || null,
			transitionId: transitionId || null,
			eventName,
			emittedEvents,
			stateDelta,
			blockers,
			raw: parsed,
		};
	} catch (error) {
		return {
			available: true,
			valid: false,
			source: "json_parse_error",
			blockers: [
				`invalid trigger proof JSON: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
}

export function evaluateCycleTransitionEvidence(input) {
	const proof = input?.proof || parseCycleTriggerProof(input?.raw, input?.env);
	const requiredCycleId = String(input?.requiredCycleId || "").trim();
	const blockers = [...(proof.blockers || [])];
	if (requiredCycleId && proof.cycleId && requiredCycleId !== proof.cycleId) {
		blockers.push(
			`cycleId mismatch: expected ${requiredCycleId}, got ${proof.cycleId}`,
		);
	}
	return {
		verifiable: proof.available === true && blockers.length === 0,
		onchainTrigger: proof,
		transition: proof.stateDelta
			? {
					transitionId: proof.transitionId,
					cycleId: proof.cycleId,
					stateDelta: proof.stateDelta,
					triggerTxHash: proof.txHash,
					eventName: proof.eventName,
					emittedEvents: proof.emittedEvents || [],
				}
			: null,
		blockers,
	};
}
