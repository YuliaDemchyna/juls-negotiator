import { logger } from '../utils/logger';

export interface NegotiationRequest {
  user_amounts: number[];
  agent_amounts: number[];
  user_amount: number;
  user_debt: number;
}

export interface NegotiationResponse {
  status: 'HAGGLE' | 'STOP';
  agent_amount: number;
  user_amounts: number[];
  agent_amounts: number[];
}

export class NegotiationService {
  private readonly MAX_ROUNDS = 3;
  private readonly TARGET_MULTIPLIER = 1.3;
  private readonly MIN_ACCEPTABLE_RATIO = 0.5; // Agent won't go below 50% of debt

  /**
   * Implements human-like haggling logic for debt negotiation
   * The AI should converge on a middle amount, aiming for initial_amount * 1.30
   */
  negotiate(request: NegotiationRequest): NegotiationResponse {
    const { user_amounts, agent_amounts, user_amount, user_debt } = request;

    // Calculate current round (1-indexed)
    const currentRound = user_amounts.length + 1;

    logger.info('Negotiation round', {
      round: currentRound,
      userAmount: user_amount,
      userDebt: user_debt,
      history: { user_amounts, agent_amounts },
    });

    // Never propose more than the debt
    const maxAmount = Math.min(user_debt, user_debt);

    // Check if we've reached the maximum rounds
    if (currentRound > this.MAX_ROUNDS) {
      logger.info('Max negotiation rounds reached, stopping');
      return {
        status: 'STOP',
        agent_amount: user_amount,
        user_amounts: [...user_amounts, user_amount],
        agent_amounts: [...agent_amounts, user_amount],
      };
    }

    // Calculate target amount (initial offer * 1.30)
    const initialOffer = user_amounts[0] || user_amount;
    const targetAmount = Math.min(
      initialOffer * this.TARGET_MULTIPLIER,
      maxAmount
    );

    // Check if user's current offer meets our target
    if (user_amount >= targetAmount) {
      logger.info('User offer meets target, accepting', {
        userAmount: user_amount,
        targetAmount,
      });
      return {
        status: 'STOP',
        agent_amount: user_amount,
        user_amounts: [...user_amounts, user_amount],
        agent_amounts: [...agent_amounts, user_amount],
      };
    }

    // Calculate agent's counter-offer using haggling strategy
    let agentAmount: number;

    if (currentRound === 1) {
      // First round: Start high but reasonable
      // Propose between 1.5x and 2x of user's offer, but not more than debt
      agentAmount = Math.min(
        user_amount * 1.8,
        maxAmount,
        user_debt * 0.7 // Don't start with more than 70% of total debt
      );
    } else {
      // Subsequent rounds: Converge towards middle ground
      const lastAgentAmount = agent_amounts[agent_amounts.length - 1];

      // Calculate the gap and reduce it
      const gap = lastAgentAmount - user_amount;
      const reductionFactor = 0.4 + currentRound * 0.1; // Increase concession as rounds progress

      agentAmount = lastAgentAmount - gap * reductionFactor;

      // Ensure we're moving towards the user's offer
      if (agentAmount >= lastAgentAmount) {
        agentAmount = lastAgentAmount * 0.9; // Make a 10% concession
      }

      // But don't go below our minimum acceptable amount
      const minAcceptable = Math.max(
        targetAmount * 0.9, // Try to stay close to target
        user_debt * this.MIN_ACCEPTABLE_RATIO,
        initialOffer // Never go below initial offer
      );

      agentAmount = Math.max(agentAmount, minAcceptable);
    }

    // Round to 2 decimal places
    agentAmount = Math.round(agentAmount * 100) / 100;

    // Check if we're close enough to accept
    const acceptanceThreshold = user_amount * 1.1; // Accept if within 10% of user's offer
    if (
      agentAmount <= acceptanceThreshold ||
      currentRound === this.MAX_ROUNDS
    ) {
      logger.info('Close enough to user offer, accepting', {
        agentAmount,
        userAmount: user_amount,
        threshold: acceptanceThreshold,
      });
      return {
        status: 'STOP',
        agent_amount: user_amount,
        user_amounts: [...user_amounts, user_amount],
        agent_amounts: [...agent_amounts, user_amount],
      };
    }

    logger.info('Continuing negotiation', {
      agentAmount,
      userAmount: user_amount,
      round: currentRound,
    });

    return {
      status: 'HAGGLE',
      agent_amount: agentAmount,
      user_amounts: [...user_amounts, user_amount],
      agent_amounts: [...agent_amounts, agentAmount],
    };
  }

  /**
   * Calculate negotiation success rate
   */
  calculateSuccessRate(initialAmount: number, finalAmount: number): number {
    if (initialAmount === 0) return 0;
    const increase = ((finalAmount - initialAmount) / initialAmount) * 100;
    return Math.round(increase * 100) / 100; // Round to 2 decimal places
  }
}
