// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHyperliquidEarnRouter} from "./IHyperliquidEarnRouter.sol";

contract BscAutonomousStrategy {
    enum CycleState {
        Idle,
        Triggered,
        Executed,
        Halted
    }

    struct CycleRequest {
        bytes32 cycleId;
        uint256 transitionNonce;
        uint256 amountRaw;
        address tokenIn;
        address tokenOut;
        bytes routeData;
        bytes32 routeDataHash;
        bool emergencyOverride;
    }

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    IHyperliquidEarnRouter public immutable hyperliquidRouter;

    mapping(bytes32 => mapping(address => bool)) private roles;

    CycleState public cycleState;
    bytes32 public activeCycleId;
    uint256 public lastTransitionNonce;
    uint256 public lastExecutionAt;
    uint256 public maxAmountRaw;
    uint256 public cooldownSeconds;
    bool public paused;

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event EmergencyPauseSet(bool indexed paused, address indexed actor, string reason);
    event RiskConfigUpdated(uint256 maxAmountRaw, uint256 cooldownSeconds, address indexed actor);

    event CycleStateTransition(
        bytes32 indexed cycleId,
        uint256 indexed transitionNonce,
        CycleState previousState,
        CycleState nextState,
        address actor,
        bool emergencyOverride,
        bytes32 routeDataHash
    );

    event ExecutionDecision(
        bytes32 indexed cycleId,
        uint256 indexed transitionNonce,
        bool executed,
        bool emergencyOverride,
        uint256 amountRaw,
        bytes32 routeExecutionId,
        string reason
    );

    modifier onlyRole(bytes32 role) {
        require(roles[role][msg.sender], "role_required");
        _;
    }

    modifier whenNotPausedOrEmergency(bool emergencyOverride) {
        if (paused) {
            require(emergencyOverride, "paused");
            require(roles[EMERGENCY_ROLE][msg.sender], "emergency_role_required");
        }
        _;
    }

    constructor(
        address router,
        uint256 initialMaxAmountRaw,
        uint256 initialCooldownSeconds,
        address admin,
        address emergencyAdmin
    ) {
        require(router != address(0), "router_required");
        require(admin != address(0), "admin_required");
        require(emergencyAdmin != address(0), "emergency_required");
        hyperliquidRouter = IHyperliquidEarnRouter(router);
        maxAmountRaw = initialMaxAmountRaw;
        cooldownSeconds = initialCooldownSeconds;
        cycleState = CycleState.Idle;
        roles[ADMIN_ROLE][admin] = true;
        roles[EMERGENCY_ROLE][emergencyAdmin] = true;
        emit RoleGranted(ADMIN_ROLE, admin, msg.sender);
        emit RoleGranted(EMERGENCY_ROLE, emergencyAdmin, msg.sender);
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return roles[role][account];
    }

    function grantRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        require(account != address(0), "account_required");
        roles[role][account] = true;
        emit RoleGranted(role, account, msg.sender);
    }

    function setRiskConfig(uint256 newMaxAmountRaw, uint256 newCooldownSeconds) external onlyRole(ADMIN_ROLE) {
        maxAmountRaw = newMaxAmountRaw;
        cooldownSeconds = newCooldownSeconds;
        emit RiskConfigUpdated(newMaxAmountRaw, newCooldownSeconds, msg.sender);
    }

    function setEmergencyPause(bool value, string calldata reason) external onlyRole(EMERGENCY_ROLE) {
        paused = value;
        emit EmergencyPauseSet(value, msg.sender, reason);
    }

    function runDeterministicCycle(CycleRequest calldata req)
        external
        whenNotPausedOrEmergency(req.emergencyOverride)
        returns (bytes32 transitionId, bytes32 routeExecutionId)
    {
        if (req.emergencyOverride) {
            require(roles[EMERGENCY_ROLE][msg.sender], "emergency_role_required");
        } else {
            require(msg.sender == tx.origin, "manual_override_path_rejected");
        }

        require(req.amountRaw > 0, "amount_required");
        require(req.amountRaw <= maxAmountRaw, "amount_above_guard");
        require(req.transitionNonce == lastTransitionNonce + 1, "invalid_transition_nonce");
        require(keccak256(req.routeData) == req.routeDataHash, "route_hash_mismatch");
        require(cycleState == CycleState.Idle, "state_not_idle");
        require(block.timestamp >= lastExecutionAt + cooldownSeconds, "cooldown_active");

        activeCycleId = req.cycleId;
        transitionId = keccak256(
            abi.encodePacked(req.cycleId, req.transitionNonce, req.amountRaw, req.routeDataHash, block.chainid)
        );

        emit CycleStateTransition(
            req.cycleId,
            req.transitionNonce,
            CycleState.Idle,
            CycleState.Triggered,
            msg.sender,
            req.emergencyOverride,
            req.routeDataHash
        );
        cycleState = CycleState.Triggered;

        (bool ok, bytes32 execId) = hyperliquidRouter.executeEarn(req.amountRaw, req.tokenIn, req.tokenOut, req.routeData);
        routeExecutionId = execId;

        if (ok) {
            cycleState = CycleState.Executed;
            emit ExecutionDecision(
                req.cycleId,
                req.transitionNonce,
                true,
                req.emergencyOverride,
                req.amountRaw,
                execId,
                "hyperliquid_earn_executed"
            );
            emit CycleStateTransition(
                req.cycleId,
                req.transitionNonce,
                CycleState.Triggered,
                CycleState.Executed,
                msg.sender,
                req.emergencyOverride,
                req.routeDataHash
            );
            cycleState = CycleState.Idle;
            lastExecutionAt = block.timestamp;
            lastTransitionNonce = req.transitionNonce;
            emit CycleStateTransition(
                req.cycleId,
                req.transitionNonce,
                CycleState.Executed,
                CycleState.Idle,
                msg.sender,
                req.emergencyOverride,
                req.routeDataHash
            );
        } else {
            cycleState = CycleState.Halted;
            lastTransitionNonce = req.transitionNonce;
            emit ExecutionDecision(
                req.cycleId,
                req.transitionNonce,
                false,
                req.emergencyOverride,
                req.amountRaw,
                execId,
                "hyperliquid_earn_failed"
            );
            emit CycleStateTransition(
                req.cycleId,
                req.transitionNonce,
                CycleState.Triggered,
                CycleState.Halted,
                msg.sender,
                req.emergencyOverride,
                req.routeDataHash
            );
        }
    }

    function recoverFromHalt() external onlyRole(EMERGENCY_ROLE) {
        require(cycleState == CycleState.Halted, "not_halted");
        cycleState = CycleState.Idle;
        emit CycleStateTransition(
            activeCycleId,
            lastTransitionNonce,
            CycleState.Halted,
            CycleState.Idle,
            msg.sender,
            true,
            bytes32(0)
        );
    }
}
