import { BigNumber } from '@ethersproject/bignumber'
import { Trans } from '@lingui/macro'
import { Token } from '@uniswap/sdk-core'
import { CHAIN_INFO } from 'constants/chainInfo'
import useCurrentBlockTimestamp from 'hooks/useCurrentBlockTimestamp'
import { useERC20PermitFromTrade } from 'hooks/useERC20Permit'
import { useUpdateAtom } from 'jotai/utils'
import { useAtomValue } from 'jotai/utils'
import { useSwapInfo } from 'lib/hooks/swap'
import useSwapApproval, {
  ApprovalState,
  useSwapApprovalOptimizedTrade,
  useSwapRouterAddress,
} from 'lib/hooks/swap/useSwapApproval'
import { useSwapCallback } from 'lib/hooks/swap/useSwapCallback'
import { useAddTransaction } from 'lib/hooks/transactions'
import { usePendingApproval } from 'lib/hooks/transactions'
import useActiveWeb3React from 'lib/hooks/useActiveWeb3React'
import { Link, Spinner } from 'lib/icons'
import { transactionTtlAtom } from 'lib/state/settings'
import { displayTxHashAtom, Field } from 'lib/state/swap'
import { TransactionType } from 'lib/state/transactions'
import styled from 'lib/theme'
import { useCallback, useEffect, useMemo, useState } from 'react'

import ActionButton from '../ActionButton'
import Dialog from '../Dialog'
import Row from '../Row'
import { SummaryDialog } from './Summary'

interface SwapButtonProps {
  disabled?: boolean
}

const EtherscanA = styled.a`
  color: currentColor;
  text-decoration: none;
`

function useIsPendingApproval(token?: Token, spender?: string): boolean {
  return Boolean(usePendingApproval(token, spender))
}

export default function SwapButton({ disabled }: SwapButtonProps) {
  const { account, chainId } = useActiveWeb3React()

  const {
    trade,
    allowedSlippage,
    currencies: { [Field.INPUT]: inputCurrency },
    currencyBalances: { [Field.INPUT]: inputCurrencyBalance },
    currencyAmounts: { [Field.INPUT]: inputCurrencyAmount },
  } = useSwapInfo()

  const [activeTrade, setActiveTrade] = useState<typeof trade.trade | undefined>()
  useEffect(() => {
    setActiveTrade((activeTrade) => activeTrade && trade.trade)
  }, [trade])

  // TODO(zzmp): Return an optimized trade directly from useSwapInfo.
  const optimizedTrade =
    // Use trade.trade if there is no swap optimized trade. This occurs if approvals are still pending.
    useSwapApprovalOptimizedTrade(trade.trade, allowedSlippage, useIsPendingApproval) || trade.trade
  const [approval, getApproval] = useSwapApproval(optimizedTrade, allowedSlippage, useIsPendingApproval)
  const approvalHash = usePendingApproval(
    inputCurrency?.isToken ? inputCurrency : undefined,
    useSwapRouterAddress(optimizedTrade)
  )

  const addTransaction = useAddTransaction()
  const addApprovalTransaction = useCallback(() => {
    getApproval().then((transaction) => {
      if (transaction) {
        addTransaction({ type: TransactionType.APPROVAL, ...transaction })
      }
    })
  }, [addTransaction, getApproval])

  const actionProps = useMemo(() => {
    if (disabled) return { disabled: true }

    if (chainId && inputCurrencyAmount && inputCurrencyBalance?.greaterThan(inputCurrencyAmount)) {
      if (approval === ApprovalState.PENDING) {
        return {
          disabled: true,
          update: {
            message: (
              <EtherscanA href={approvalHash && `${CHAIN_INFO[chainId].explorer}tx/${approvalHash}`} target="_blank">
                <Row gap={0.25}>
                  <Trans>
                    Approval pending <Link />
                  </Trans>
                </Row>
              </EtherscanA>
            ),
            action: <Trans>Approve</Trans>,
            icon: Spinner,
          },
        }
      } else if (approval === ApprovalState.NOT_APPROVED) {
        return {
          update: {
            message: <Trans>Approve {inputCurrencyAmount.currency.symbol} first</Trans>,
            action: <Trans>Approve</Trans>,
          },
        }
      }
      return {}
    }

    return { disabled: true }
  }, [approval, approvalHash, chainId, disabled, inputCurrencyAmount, inputCurrencyBalance])

  // @TODO(ianlapham): connect deadline from state instead of passing undefined.
  const { signatureData } = useERC20PermitFromTrade(optimizedTrade, allowedSlippage, undefined)

  const currentBlockTimestamp = useCurrentBlockTimestamp()
  const userDeadline = useAtomValue(transactionTtlAtom)
  const deadline = currentBlockTimestamp?.add(BigNumber.from(userDeadline))

  // the callback to execute the swap
  const { callback: swapCallback } = useSwapCallback(
    optimizedTrade,
    allowedSlippage,
    account ?? null,
    signatureData,
    deadline
  )

  //@TODO(ianlapham): add a loading state, process errors
  const setDisplayTxHash = useUpdateAtom(displayTxHashAtom)
  const onConfirm = useCallback(() => {
    swapCallback?.()
      .then((transactionResponse) => {
        // TODO(ianlapham): Add the swap tx to transactionsAtom
        console.log(transactionResponse)
        setDisplayTxHash(transactionResponse.hash)
      })
      .catch((error) => {
        //@TODO(ianlapham): add error handling
        console.log(error)
      })
  }, [setDisplayTxHash, swapCallback])

  return (
    <>
      <ActionButton
        color="interactive"
        onClick={() => setActiveTrade(trade.trade)}
        onUpdate={addApprovalTransaction}
        {...actionProps}
      >
        <Trans>Review swap</Trans>
      </ActionButton>
      {activeTrade && (
        <Dialog color="dialog" onClose={() => setActiveTrade(undefined)}>
          <SummaryDialog trade={activeTrade} allowedSlippage={allowedSlippage} onConfirm={onConfirm} />
        </Dialog>
      )}
    </>
  )
}
