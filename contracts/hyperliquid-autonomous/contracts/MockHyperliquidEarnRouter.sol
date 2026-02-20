// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHyperliquidEarnRouter} from "./IHyperliquidEarnRouter.sol";

contract MockHyperliquidEarnRouter is IHyperliquidEarnRouter {
    bool public shouldSucceed = true;
    bytes32 public nextExecutionId = keccak256("mock-execution");

    event ExecuteEarnCalled(uint256 amountRaw, address tokenIn, address tokenOut, bytes routeData);

    function setResult(bool ok, bytes32 executionId) external {
        shouldSucceed = ok;
        nextExecutionId = executionId;
    }

    function executeEarn(
        uint256 amountRaw,
        address tokenIn,
        address tokenOut,
        bytes calldata routeData
    ) external override returns (bool success, bytes32 routeExecutionId) {
        emit ExecuteEarnCalled(amountRaw, tokenIn, tokenOut, routeData);
        return (shouldSucceed, nextExecutionId);
    }
}
