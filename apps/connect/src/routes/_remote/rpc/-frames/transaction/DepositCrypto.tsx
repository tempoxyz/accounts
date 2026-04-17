import * as Bridge from '#/lib/bridge.js'
import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Row, Rows } from '#/ui/Rows.js'
import { Cuer } from 'cuer'
import React, { useMemo, useState } from 'react'
import AlertTriangle from '~icons/lucide/alert-triangle'
import ChevronDown from '~icons/lucide/chevron-down'
import Copy from '~icons/lucide/copy'
import RefreshCw from '~icons/lucide/refresh-cw'

const defaultChain = Bridge.sourceChains[0]

/** Deposit crypto screen — QR code + deposit address for cross-chain deposits via Relay. */
export function DepositCrypto(props: DepositCrypto.Props) {
  const { address, amount, confirming, onBack, onDone } = props

  // User-selected origin chain and token.
  const [selectedChainId, setSelectedChainId] = useState<number>(defaultChain.id)
  const [selectedTokenAddress, setSelectedTokenAddress] = useState<string>(
    defaultChain.tokens[0].address,
  )

  // Tempo = direct same-chain transfer (no Relay bridge needed).
  const isTempo = useMemo(() => selectedChainId === Bridge.destinationChain.id, [selectedChainId])

  // Resolve the selected chain/token from the static config.
  const tokens = useMemo(() => Bridge.getTokens(selectedChainId), [selectedChainId])
  const selectedToken = useMemo(
    () => tokens.find((t) => t.address === selectedTokenAddress) ?? tokens[0],
    [tokens, selectedTokenAddress],
  )
  const selectedChain = useMemo(
    () =>
      isTempo
        ? Bridge.destinationChain
        : (Bridge.sourceChains.find((c) => c.id === selectedChainId) ?? defaultChain),
    [isTempo, selectedChainId, defaultChain],
  )

  // Fetch a Relay deposit address for cross-chain routes.
  // Disabled when Tempo is selected — we show the user's own address instead.
  const deposit = Bridge.useDepositAddress({
    origin: {
      chainId: selectedChainId,
      token: selectedToken?.address ?? '',
      decimals: selectedToken?.decimals ?? 6,
    },
    enabled: !!selectedToken && !isTempo,
  })

  const isUnsupported =
    deposit.isError && (deposit.error as Error & { code?: string }).code === 'UNSUPPORTED_ROUTE'

  // Tempo → user's own address; cross-chain → Relay deposit address.
  const depositAddress = isTempo ? address : deposit.data?.address

  // EIP-681: ethereum:<address>@<chainId>
  const qrValue = useMemo(() => {
    const namespace = Bridge.getNamespace(selectedChainId)
    if (!depositAddress) return undefined
    if (namespace === 'solana') return `solana:${depositAddress}`
    return `ethereum:${depositAddress}@${selectedChainId}`
  }, [depositAddress, selectedChainId])

  return (
    <Frame>
      <Frame.Header
        subtitle={
          <>
            Deposit <span className="text-foreground">{amount}</span> to continue.
          </>
        }
        title="Deposit crypto"
      />
      <Frame.Body>
        <div className="flex h-[246px] flex-col gap-3 overflow-hidden rounded-body bg-pane px-4 py-3.5">
          <div className="flex items-center justify-between">
            <p className="text-label-13 text-foreground-secondary">Deposit address</p>
            <div className="flex items-center gap-1.5 rounded-full bg-blue-2 px-2 py-0.5 text-label-12 font-medium text-blue-9">
              <span className="size-1.5 rounded-full bg-blue-7" />
              {selectedChain.name}
            </div>
          </div>

          {!isTempo && deposit.isFetching ? (
            <div className="flex animate-pulse justify-center py-2 opacity-10">
              <Cuer.Root size="140px" value="0x0000000000000000000000000000000000000000">
                <SolidFinders />
                <Cuer.Cells />
              </Cuer.Root>
            </div>
          ) : isUnsupported ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-label-13 text-foreground-secondary">
              <p>This route is not supported.</p>
              <p className="text-label-12">Try a different network or token.</p>
            </div>
          ) : !isTempo && deposit.isError ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-center text-label-13 text-foreground-secondary">
                Failed to get deposit address.
              </p>
              <Button onClick={() => deposit.refetch()} size="small" variant="muted">
                <RefreshCw className="size-3.5" />
                Retry
              </Button>
            </div>
          ) : (
            <>
              <div className="flex justify-center py-2">
                {qrValue && <Cuer size="140px" value={qrValue} />}
              </div>
              {depositAddress && (
                <div className="flex items-center justify-center gap-1.5">
                  <p className="font-mono text-label-13 text-foreground-secondary">
                    {depositAddress.slice(0, 6)}…{depositAddress.slice(-10)}
                  </p>
                  <button
                    className="cursor-pointer text-foreground-secondary opacity-60 transition-opacity hover:opacity-100"
                    onClick={() => navigator.clipboard.writeText(depositAddress)}
                    type="button"
                  >
                    <Copy className="size-3" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <Rows>
          <Row label="Network">
            <p className="flex items-center gap-1.5">
              <select
                className="appearance-none bg-transparent text-right text-label-14 text-foreground outline-none"
                onChange={(e) => {
                  const chainId = Number(e.target.value)
                  setSelectedChainId(chainId)
                  const defaultToken = Bridge.getDefaultToken(chainId)
                  if (defaultToken) setSelectedTokenAddress(defaultToken.address)
                }}
                value={selectedChainId}
              >
                <option value={Bridge.destinationChain.id}>{Bridge.destinationChain.name}</option>
                {Bridge.sourceChains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="size-3.5 text-foreground-secondary" />
            </p>
          </Row>
          {!isTempo && (
            <Row label="Token">
              <p className="flex items-center gap-1.5">
                <select
                  className="appearance-none bg-transparent text-right text-label-14 text-foreground outline-none"
                  onChange={(e) => setSelectedTokenAddress(e.target.value)}
                  value={selectedTokenAddress}
                >
                  {tokens.map((token) => (
                    <option key={token.address} value={token.address}>
                      {token.symbol}
                    </option>
                  ))}
                </select>
                <ChevronDown className="size-3.5 text-foreground-secondary" />
              </p>
            </Row>
          )}
        </Rows>

        <div className="flex gap-2 rounded-body border border-amber-4 bg-amber-1 px-3 py-2 text-label-12 text-amber-8">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>
            {isTempo
              ? 'Only send tokens on Tempo. Sending tokens on a different network may result in permanent loss.'
              : <>Only send <span className="text-amber-10">{amount.replace(/^\$/, '')} {selectedToken?.symbol ?? 'the correct token'}</span> on <span className="text-amber-10">{selectedChain.name}</span>. Sending other tokens or using a different network may result in permanent loss.</>}
          </span>
        </div>
      </Frame.Body>
      <Frame.Footer>
        <div className="flex gap-3">
          <Button className="flex-1" onClick={onBack} size="medium" variant="muted">
            Back
          </Button>
          <Button className="flex-1" loading={confirming} onClick={onDone} size="medium" variant="primary">
            {confirming ? 'Confirming…' : 'Done'}
          </Button>
        </div>
      </Frame.Footer>
    </Frame>
  )
}

/** Solid filled squares replacing real finder patterns — makes the QR unscannable. */
function SolidFinders() {
  const { edgeSize, finderSize } = React.useContext(Cuer.Context)
  const size = finderSize * 2
  const r = finderSize * 0.5

  return (
    <>
      <rect fill="currentColor" height={size} rx={r} width={size} x={0} y={0} />
      <rect fill="currentColor" height={size} rx={r} width={size} x={edgeSize - size} y={0} />
      <rect fill="currentColor" height={size} rx={r} width={size} x={0} y={edgeSize - size} />
    </>
  )
}

/** @internal */
export declare namespace DepositCrypto {
  /** Props for the {@link DepositCrypto} component. */
  type Props = {
    /** User's Tempo address — shown directly when Tempo is selected. */
    address: string
    /** Formatted fiat amount needed (e.g. "$50.00"). */
    amount: string
    /** Whether the deposit is being confirmed (waiting for funds to arrive). */
    confirming?: boolean | undefined
    /** Called when user clicks "Back". */
    onBack: () => void
    /** Called when user clicks "Done". */
    onDone: () => void
  }
}
