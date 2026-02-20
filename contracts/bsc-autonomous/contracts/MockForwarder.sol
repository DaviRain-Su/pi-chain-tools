// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStrategyForward {
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

    function runDeterministicCycle(CycleRequest calldata req) external returns (bytes32, bytes32);
}

contract MockForwarder {
    function forward(address target, IStrategyForward.CycleRequest calldata req) external {
        IStrategyForward(target).runDeterministicCycle(req);
    }
}
