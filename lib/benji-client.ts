/**
 * BENJI Institutional API client (Franklin OnChain / FOBXX).
 * Mock Mode: set BENJI_MOCK_MODE=true; no GraphQL calls, deterministic fakes.
 * Live: uses BENJI_GRAPHQL_URL and BENJI_API_KEY.
 */

import { GraphQLClient, gql } from 'graphql-request'

const MOCK = process.env.BENJI_MOCK_MODE === 'true'

// ---------------------------------------------------------------------------
// Types (aligned with docs/benji-api-schema.graphql)
// ---------------------------------------------------------------------------

export type WalletHolding = {
  productId: string
  productName: string
  currentBalance: number
  totalBalance: number
  availableBalance: number
  currentEstAmount: number
  pendingEstAmount: number
  availableEstAmount: number
}

/** Yield listener: fields needed for cron (newYield = currentEstAmount - lastChecked). */
export type WalletYieldResult = {
  currentEstAmount: number
  totalBalance: number
  availableEstAmount: number
}

export type TransferCreateResult = {
  transferId: string
  blockchainStatus: string
}

export type WithdrawalCreateResult = {
  withdrawalId: string
  blockchainStatus: string
}

// ---------------------------------------------------------------------------
// getWalletHolding
// ---------------------------------------------------------------------------

/** Single holding for a wallet; Mock returns deterministic fakes, Live queries BENJI. */
export async function getWalletHolding(walletId: string): Promise<WalletHolding | null> {
  if (MOCK) {
    return {
      productId: 'mock-product',
      productName: 'FOBXX',
      currentBalance: 5_000_000,
      totalBalance: 5_000_000,
      availableBalance: 50_000,
      currentEstAmount: 50_000,
      pendingEstAmount: 0,
      availableEstAmount: 25_000,
    }
  }

  const url = process.env.BENJI_GRAPHQL_URL
  const apiKey = process.env.BENJI_API_KEY
  if (!url || !apiKey) {
    throw new Error('BENJI_GRAPHQL_URL and BENJI_API_KEY are required when BENJI_MOCK_MODE is not true.')
  }

  const client = new GraphQLClient(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  const query = gql`
    query Wallet($walletId: ID!) {
      wallet(walletId: $walletId) {
        walletId
        holdings {
          productId
          productName
          currentBalance
          totalBalance
          availableBalance
          currentEstAmount
          pendingEstAmount
          availableEstAmount
        }
      }
    }
  `

  try {
    const data = (await client.request(query, { walletId })) as {
      wallet?: {
        holdings?: Array<{
          productId: string
          productName: string
          currentBalance: number
          totalBalance: number
          availableBalance: number
          currentEstAmount: number
          pendingEstAmount: number
          availableEstAmount: number
        }>
      }
    }
    const holdings = data?.wallet?.holdings
    if (!holdings?.length) return null
    const h = holdings[0]
    return {
      productId: h.productId,
      productName: h.productName,
      currentBalance: Number(h.currentBalance),
      totalBalance: Number(h.totalBalance),
      availableBalance: Number(h.availableBalance),
      currentEstAmount: Number(h.currentEstAmount),
      pendingEstAmount: Number(h.pendingEstAmount),
      availableEstAmount: Number(h.availableEstAmount),
    }
  } catch (err) {
    console.error('[benji-client] getWalletHolding error:', err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// getWalletYield (for cron: currentEstAmount, totalBalance, availableEstAmount)
// ---------------------------------------------------------------------------

export async function getWalletYield(walletId: string): Promise<WalletYieldResult> {
  const holding = await getWalletHolding(walletId)
  if (!holding) {
    return { currentEstAmount: 0, totalBalance: 0, availableEstAmount: 0 }
  }
  return {
    currentEstAmount: holding.currentEstAmount,
    totalBalance: holding.totalBalance,
    availableEstAmount: holding.availableEstAmount,
  }
}

// ---------------------------------------------------------------------------
// transferCreate (sweep: University → Offbeat Operations)
// ---------------------------------------------------------------------------

export type TransferCreateInput = {
  sourceWalletId: string
  recipientWalletAddress: string
  productId: string
  quantity: number
  userId: string
  buildSigningPackage?: boolean
  instant?: boolean
}

export async function transferCreate(input: TransferCreateInput): Promise<TransferCreateResult> {
  if (MOCK) {
    return {
      transferId: `mock-transfer-${Date.now()}`,
      blockchainStatus: 'COMPLETE',
    }
  }

  const url = process.env.BENJI_GRAPHQL_URL
  const apiKey = process.env.BENJI_API_KEY
  if (!url || !apiKey) {
    throw new Error('BENJI_GRAPHQL_URL and BENJI_API_KEY are required when BENJI_MOCK_MODE is not true.')
  }

  const client = new GraphQLClient(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  const mutation = gql`
    mutation TransferCreate($input: InstitutionTransferCreateInput!) {
      transferCreate(institutionInput: $input) {
        transferId
      }
    }
  `

  const institutionInput = {
    sourceWalletId: input.sourceWalletId,
    productId: input.productId,
    recipientWalletAddress: input.recipientWalletAddress,
    quantity: String(input.quantity),
    buildSigningPackage: input.buildSigningPackage ?? false,
    userId: input.userId,
    instant: input.instant ?? true,
  }

  try {
    const data = (await client.request(mutation, { input: institutionInput })) as {
      transferCreate?: { transferId: string }
    }
    const transferId = data?.transferCreate?.transferId ?? ''
    return {
      transferId,
      blockchainStatus: transferId ? 'PENDING' : 'FAILED',
    }
  } catch (err) {
    console.error('[benji-client] transferCreate error:', err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// withdrawalCreate (refill Venmo buffer: sell BENJI for USD/USDC)
// ---------------------------------------------------------------------------

export type WithdrawalCreateInput = {
  walletId: string
  productId: string
  value: number
  paymentInstructionId: string
  userId: string
  buildSigningPackage?: boolean
}

export async function withdrawalCreate(input: WithdrawalCreateInput): Promise<WithdrawalCreateResult> {
  if (MOCK) {
    return {
      withdrawalId: `mock-withdrawal-${Date.now()}`,
      blockchainStatus: 'COMPLETE',
    }
  }

  const url = process.env.BENJI_GRAPHQL_URL
  const apiKey = process.env.BENJI_API_KEY
  if (!url || !apiKey) {
    throw new Error('BENJI_GRAPHQL_URL and BENJI_API_KEY are required when BENJI_MOCK_MODE is not true.')
  }

  const client = new GraphQLClient(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  const mutation = gql`
    mutation WithdrawalCreate($input: InstitutionWithdrawalCreateInput!) {
      withdrawalCreate(institutionInput: $input) {
        withdrawalId
        blockchainStatus
      }
    }
  `

  const institutionInput = {
    walletId: input.walletId,
    productId: input.productId,
    value: String(input.value),
    paymentInstructionId: input.paymentInstructionId,
    buildSigningPackage: input.buildSigningPackage ?? false,
    userId: input.userId,
  }

  try {
    const data = (await client.request(mutation, { input: institutionInput })) as {
      withdrawalCreate?: { withdrawalId: string; blockchainStatus: string }
    }
    const w = data?.withdrawalCreate
    return {
      withdrawalId: w?.withdrawalId ?? '',
      blockchainStatus: w?.blockchainStatus ?? 'FAILED',
    }
  } catch (err) {
    console.error('[benji-client] withdrawalCreate error:', err)
    throw err
  }
}
