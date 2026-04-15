// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  MockTokenA
 * @notice Demo ERC-20 for DealRoom hackathon on X Layer Testnet.
 *         Symbol: TKA — 18 decimals.
 *         Constructor mints 1,000,000 TKA to the initial owner.
 *         Owner can mint more at any time (for demo top-ups).
 */
contract MockTokenA is ERC20, Ownable {
    constructor(address initialOwner)
        ERC20("Mock Token A", "TKA")
        Ownable(initialOwner)
    {
        _mint(initialOwner, 1_000_000 * 10 ** decimals());
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
