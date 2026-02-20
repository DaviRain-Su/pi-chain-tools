// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAsterDexEarnRouter {
    function executeEarn(
        uint256 amountRaw,
        address tokenIn,
        address tokenOut,
        bytes calldata routeData
    ) external returns (bool success, bytes32 routeExecutionId);
}
