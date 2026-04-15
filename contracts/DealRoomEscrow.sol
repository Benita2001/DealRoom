// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title  DealRoomEscrow
 * @notice Trustless OTC escrow for ERC-20 token swaps, verified by an AI arbiter.
 *
 * ── Flow ────────────────────────────────────────────────────────────────────
 *  1. Maker calls createDeal()  → deposits makerToken, deal is MAKER_FUNDED.
 *  2. Taker calls fundDeal()    → deposits takerToken, deal is BOTH_FUNDED.
 *  3a. Arbiter calls approveDeal() → atomic swap, deal is COMPLETED.
 *  3b. Arbiter calls rejectDeal()  → both refunded, deal is REFUNDED.
 *
 * ── Escape hatches ──────────────────────────────────────────────────────────
 *  • claimMakerTimeout()   — maker reclaims deposit if taker never funds by takerDeadline.
 *  • claimArbiterTimeout() — either party reclaims own deposit if arbiter goes silent
 *                            for ARBITER_TIMEOUT (48 h) after BOTH_FUNDED.
 *
 * ── Deploy target ───────────────────────────────────────────────────────────
 *  X Layer (chainIndex 196)
 */
contract DealRoomEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ────────────────────────────────────────────────────
    // Types
    // ────────────────────────────────────────────────────

    enum DealStatus {
        MAKER_FUNDED, // Maker deposited; awaiting taker
        BOTH_FUNDED,  // Both deposited; awaiting arbiter decision
        COMPLETED,    // Atomic swap executed successfully
        REFUNDED      // Both parties returned their original deposits
    }

    struct Deal {
        address maker;
        address taker;         // address(0) = open to any taker until fundDeal() is called
        address makerToken;
        address takerToken;
        uint256 makerAmount;
        uint256 takerAmount;
        DealStatus status;
        uint256 takerDeadline;   // unix timestamp — taker must fund before this
        uint256 arbiterDeadline; // unix timestamp — 0 until BOTH_FUNDED, then now + 48 h
    }

    // ────────────────────────────────────────────────────
    // Constants
    // ────────────────────────────────────────────────────

    /// @dev Upper bound for maker-configurable taker window. Frontend defaults to 24 h.
    uint256 public constant MAX_TAKER_DEADLINE_DURATION = 7 days;

    /// @dev How long the arbiter has to act once both sides are funded.
    uint256 public constant ARBITER_TIMEOUT = 48 hours;

    // ────────────────────────────────────────────────────
    // State
    // ────────────────────────────────────────────────────

    /// @notice Backend-controlled EOA authorised to approve or reject deals.
    address public immutable arbiter;

    /// @notice Monotonically increasing deal counter. First deal is ID 1.
    uint256 public dealCount;

    /// @notice dealId → Deal storage.
    mapping(uint256 => Deal) public deals;

    // ────────────────────────────────────────────────────
    // Events
    // ────────────────────────────────────────────────────

    event DealCreated(
        uint256 indexed dealId,
        address indexed maker,
        address makerToken,
        uint256 makerAmount,
        address takerToken,
        uint256 takerAmount,
        address allowedTaker,  // address(0) = open to anyone
        uint256 takerDeadline
    );

    event DealFunded(
        uint256 indexed dealId,
        address indexed taker,
        uint256 arbiterDeadline
    );

    event DealCompleted(uint256 indexed dealId);
    event DealRefunded(uint256 indexed dealId);

    // ────────────────────────────────────────────────────
    // Custom errors  (cheaper than require strings)
    // ────────────────────────────────────────────────────

    error NotArbiter();
    error NotMaker();
    error NotParty();
    error DealNotFound();
    error WrongStatus(DealStatus current, DealStatus required);
    error TakerDeadlineExpired();
    error TakerDeadlineNotExpired();
    error TakerDeadlineDurationZero();
    error TakerDeadlineDurationTooLong();
    error ArbiterDeadlineNotExpired();
    error UnauthorizedTaker();
    error ZeroAmount();
    error ZeroAddress();
    error IdenticalTokens();
    error TakerCannotBeMaker();

    // ────────────────────────────────────────────────────
    // Constructor
    // ────────────────────────────────────────────────────

    constructor(address _arbiter) {
        if (_arbiter == address(0)) revert ZeroAddress();
        arbiter = _arbiter;
    }

    // ────────────────────────────────────────────────────
    // Maker — step 1
    // ────────────────────────────────────────────────────

    /**
     * @notice Create a new deal and deposit makerToken into escrow in a single transaction.
     *
     * @param makerToken             ERC-20 the maker is offering.
     * @param makerAmount            Amount of makerToken to deposit (must be pre-approved).
     * @param takerToken             ERC-20 the maker wants in return.
     * @param takerAmount            Amount of takerToken expected from the taker.
     * @param allowedTaker           Whitelisted taker address; pass address(0) for open deal.
     * @param takerDeadlineDuration  Seconds from now the taker has to fund (≤ 7 days).
     *
     * @return dealId  Sequential ID of the created deal (used in the shareable link).
     */
    function createDeal(
        address makerToken,
        uint256 makerAmount,
        address takerToken,
        uint256 takerAmount,
        address allowedTaker,
        uint256 takerDeadlineDuration
    ) external nonReentrant returns (uint256 dealId) {
        // Input validation
        if (makerToken == address(0) || takerToken == address(0)) revert ZeroAddress();
        if (makerToken == takerToken)                              revert IdenticalTokens();
        if (makerAmount == 0)                                      revert ZeroAmount();
        if (takerAmount == 0)                                      revert ZeroAmount();
        if (takerDeadlineDuration == 0)                            revert TakerDeadlineDurationZero();
        if (takerDeadlineDuration > MAX_TAKER_DEADLINE_DURATION)   revert TakerDeadlineDurationTooLong();
        if (allowedTaker == msg.sender)                            revert TakerCannotBeMaker();

        // Assign ID — starts at 1, maps cleanly to /deal/1, /deal/2, …
        dealId = ++dealCount;

        uint256 takerDeadline = block.timestamp + takerDeadlineDuration;

        // Write state before any external call (Checks-Effects-Interactions)
        deals[dealId] = Deal({
            maker:          msg.sender,
            taker:          allowedTaker,   // address(0) = open
            makerToken:     makerToken,
            takerToken:     takerToken,
            makerAmount:    makerAmount,
            takerAmount:    takerAmount,
            status:         DealStatus.MAKER_FUNDED,
            takerDeadline:  takerDeadline,
            arbiterDeadline: 0              // set when taker funds
        });

        // Pull maker's tokens into escrow
        IERC20(makerToken).safeTransferFrom(msg.sender, address(this), makerAmount);

        emit DealCreated(
            dealId,
            msg.sender,
            makerToken,
            makerAmount,
            takerToken,
            takerAmount,
            allowedTaker,
            takerDeadline
        );
    }

    // ────────────────────────────────────────────────────
    // Taker — step 2
    // ────────────────────────────────────────────────────

    /**
     * @notice Fund the taker side of a deal.
     *         Locks both deposits in escrow and starts the 48-hour arbiter clock.
     *
     * @param dealId  ID of the deal to fund (from the shareable link).
     */
    function fundDeal(uint256 dealId) external nonReentrant {
        Deal storage deal = _requireDeal(dealId);
        _requireStatus(deal, DealStatus.MAKER_FUNDED);

        if (block.timestamp >= deal.takerDeadline)                        revert TakerDeadlineExpired();
        if (deal.taker != address(0) && deal.taker != msg.sender)         revert UnauthorizedTaker();

        // Effects before external call
        deal.taker          = msg.sender;
        deal.status         = DealStatus.BOTH_FUNDED;
        deal.arbiterDeadline = block.timestamp + ARBITER_TIMEOUT;

        // Pull taker's tokens into escrow
        IERC20(deal.takerToken).safeTransferFrom(msg.sender, address(this), deal.takerAmount);

        emit DealFunded(dealId, msg.sender, deal.arbiterDeadline);
    }

    // ────────────────────────────────────────────────────
    // Arbiter — step 3
    // ────────────────────────────────────────────────────

    /**
     * @notice Approve the deal: atomically deliver tokens to both parties.
     *         Maker receives takerToken; taker receives makerToken.
     *
     * @param dealId  ID of the deal to approve.
     */
    function approveDeal(uint256 dealId) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();

        Deal storage deal = _requireDeal(dealId);
        _requireStatus(deal, DealStatus.BOTH_FUNDED);

        // Effects before transfers
        deal.status = DealStatus.COMPLETED;

        // Atomic swap — two transfers in the same transaction
        IERC20(deal.takerToken).safeTransfer(deal.maker, deal.takerAmount);
        IERC20(deal.makerToken).safeTransfer(deal.taker, deal.makerAmount);

        emit DealCompleted(dealId);
    }

    /**
     * @notice Reject the deal: return both deposits to their original owners.
     *
     * @param dealId  ID of the deal to reject.
     */
    function rejectDeal(uint256 dealId) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();

        Deal storage deal = _requireDeal(dealId);
        _requireStatus(deal, DealStatus.BOTH_FUNDED);

        _refundBoth(dealId, deal);
    }

    // ────────────────────────────────────────────────────
    // Timeout escape hatches
    // ────────────────────────────────────────────────────

    /**
     * @notice Maker reclaims their deposit when the taker window has expired
     *         and no taker has funded the deal.
     *
     * @param dealId  ID of the deal.
     */
    function claimMakerTimeout(uint256 dealId) external nonReentrant {
        Deal storage deal = _requireDeal(dealId);
        _requireStatus(deal, DealStatus.MAKER_FUNDED);

        if (msg.sender != deal.maker)           revert NotMaker();
        if (block.timestamp < deal.takerDeadline) revert TakerDeadlineNotExpired();

        deal.status = DealStatus.REFUNDED;

        IERC20(deal.makerToken).safeTransfer(deal.maker, deal.makerAmount);

        emit DealRefunded(dealId);
    }

    /**
     * @notice Either party reclaims their own deposit when the arbiter has failed
     *         to act within ARBITER_TIMEOUT (48 h) after both sides funded.
     *         Both transfers are executed atomically so neither party needs a
     *         second transaction to claim.
     *
     * @param dealId  ID of the deal.
     */
    function claimArbiterTimeout(uint256 dealId) external nonReentrant {
        Deal storage deal = _requireDeal(dealId);
        _requireStatus(deal, DealStatus.BOTH_FUNDED);

        if (msg.sender != deal.maker && msg.sender != deal.taker) revert NotParty();
        if (block.timestamp < deal.arbiterDeadline)               revert ArbiterDeadlineNotExpired();

        _refundBoth(dealId, deal);
    }

    // ────────────────────────────────────────────────────
    // View helpers
    // ────────────────────────────────────────────────────

    /**
     * @notice Fetch the full Deal struct for a given ID.
     *         Returns a zero-filled struct if the deal does not exist.
     */
    function getDeal(uint256 dealId) external view returns (Deal memory) {
        return deals[dealId];
    }

    // ────────────────────────────────────────────────────
    // Internal helpers
    // ────────────────────────────────────────────────────

    /// @dev Loads a deal from storage and reverts if it does not exist.
    function _requireDeal(uint256 dealId) internal view returns (Deal storage deal) {
        deal = deals[dealId];
        if (deal.maker == address(0)) revert DealNotFound();
    }

    /// @dev Reverts if the deal's current status does not match `required`.
    function _requireStatus(Deal storage deal, DealStatus required) internal view {
        if (deal.status != required) revert WrongStatus(deal.status, required);
    }

    /// @dev Marks deal REFUNDED and returns each party's tokens.
    ///      Caller must have already validated status. Both transfers are
    ///      done atomically so no party is left in limbo.
    function _refundBoth(uint256 dealId, Deal storage deal) internal {
        deal.status = DealStatus.REFUNDED;

        IERC20(deal.makerToken).safeTransfer(deal.maker, deal.makerAmount);
        IERC20(deal.takerToken).safeTransfer(deal.taker, deal.takerAmount);

        emit DealRefunded(dealId);
    }
}
