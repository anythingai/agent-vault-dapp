# 1inch Fusion+ Cross-Chain Swap Extension to Bitcoin (PRD)

## Problem Statement

Cross-chain interoperability remains a **major challenge** in DeFi, especially for Bitcoin
which is isolated from Ethereum’s ecosystem. Moving assets between Ethereum and
Bitcoin typically relies on centralized bridges or wrapped tokens, exposing users to
**security risks and custodial trust** [1]. Decentralized atomic swap technology offers a
trustless alternative (using hashlocks and timelocks) but historically suffers from **poor UX
and limited adoption** [2]. The 1inch _Fusion+_ protocol was created to address these issues,
enabling intent-based atomic swaps through a network of resolvers and Dutch auctions for
optimal pricing[3][4]. However, Fusion+ currently focuses on EVM-compatible chains.
**Bitcoin is not yet supported** , leaving a gap in truly seamless cross-chain swaps involving
the world’s largest cryptocurrency. This project aims to extend 1inch Fusion+ to **support
trustless swaps between Ethereum and Bitcoin** , preserving the full security of hashed
timelock contracts (HTLCs) on both chains and delivering a smooth user experience.

## Goals & Non-Goals

**Goals:**

- **Bitcoin–Ethereum Atomic Swaps:** Implement **bidirectional** atomic swap functionality
between Ethereum and Bitcoin, using HTLC contracts/scripts so that swaps are trustless
and **either complete fully or are safely refunded** [5][4]. Both directions (ETH→BTC and
BTC→ETH) must be supported with appropriate role reversal.
- **Preserve Hashlock/Timelock Security:** Maintain the same **hashlock and timelock
constraints** on Bitcoin that 1inch Fusion+ uses on Ethereum[6]. The Bitcoin HTLC script
will enforce a secret hash and timeout just like the Ethereum escrow contract, ensuring
funds can only be claimed with the correct secret or returned after expiry.
- **Fusion+ Integration:** Align with the existing Fusion+ architecture. Use 1inch’s intent-
based order flow: a user (maker) signs an off-chain swap order (with a secret hash), and a
network resolver (taker) fulfills it by locking assets on both chains. Reuse or extend the
Fusion contracts on Ethereum (e.g. Limit Order Protocol and Escrow contracts) to handle
the Ethereum side, while designing a counterpart on Bitcoin.
- **Testnet Deployment:** Execute token swaps on test networks (Ethereum Sepolia and
Bitcoin testnet or Signet) for development and demo. On-chain execution of the swaps
**must be demonstrated live** in the final presentation[6].
- **Demo & Usability:** Provide a simple **UI or CLI tool** for users to initiate swaps and monitor
progress (stretch goal). Even though atomic swaps are complex, the user interface should
abstract the complexity – ideally, the user just selects “swap ETH for BTC”, confirms, and
waits for completion[7]. A dashboard will show the status of each swap (in progress,
redeemed, refunded, etc.).

**Non-Goals:**

- **Other Chains:** Support for other non-EVM chains (e.g. Litecoin, Dogecoin, etc.) is out of
scope. This project focuses **exclusively on Bitcoin** integration as a priority chain[8]. The
design, however, should be extensible to similar UTXO chains in the future.
- **Centralized Bridges or Wrapped Assets:** We will not use any centralized bridge or
wrapped BTC token on Ethereum. The goal is a _direct_ on-chain swap; thus using WBTC or
intermediate custodial steps is explicitly not part of this solution.
- **Production Mainnet Launch:** Deploying on Ethereum or Bitcoin mainnet is not planned
within this hackathon timeframe. Mainnet considerations (fees, risk) are noted, but the
initial deliverable is a **prototype on testnets**. Security audits and mainnet liquidity
integration are future work.
- **Lightning Network Integration:** While potentially interesting for faster/cheaper BTC
transfers, integrating Lightning is out of scope. We will rely on on-chain Bitcoin
transactions and HTLC scripts on Bitcoin’s base layer (for simplicity and reliability on
testnet).
- **Independent Order Matching Engine:** We won’t build a fully decentralized order book
beyond the 1inch relayer system. The focus is on extending the existing 1inch off-chain
matching (relayer & resolver model) to include Bitcoin. A custom relayer service will
coordinate swaps, but a robust p2p order network is not a primary goal in this phase.

## Architecture

[9] **Figure 1: Cross-Chain Atomic Swap Timeline** – Key stages of an atomic swap between
a **source chain** (Chain A, e.g. Ethereum) and a **destination chain** (Chain B, e.g. Bitcoin).
The process includes an initial finality wait, exclusive withdraw periods for the executing
resolver, and subsequent public periods where any party can complete or cancel the
swap. Timelocks on each chain (T_A, T_B) are set such that if the
swap fails, funds return to the original owners[10][11]. This design preserves security by
ensuring that either both legs of the swap execute atomically or everyone gets refunded.

### System Components & Roles

- **Maker (User):** The user initiating the swap. They specify the swap details (source
    asset, destination asset, amounts, acceptable rate) and generate a secret random
    value S. The hash H = hash(S) is included in the order. In the Ethereum→Bitcoin
    direction, the user’s assets are on Ethereum; in the reverse direction, the user’s
    assets are BTC on Bitcoin. The user’s client (dApp or CLI) holds the secret S until it’s
    needed[12]. The user does **not** need to be online throughout (except possibly to
    authorize a Bitcoin transaction in the BTC→ETH case, see Workflow below).
- **1inch Relayer Service:** An off-chain service that **broadcasts the user’s order to**
    **resolvers** and coordinates the cross-chain swap. It runs the **Dutch auction** for the
    order – starting from the user’s minimum desired return and decreasing resolver
    fees until a resolver accepts the deal[13]. The relayer monitors both blockchains for
    swap transactions and, once both chain contracts are in place, it **releases the**
    **secret** to the resolvers [or triggers the secret reveal process](12). It also assists in

```text
partial fills and ensures either completion or cancellation in failure cases. (In our
implementation, a custom relayer will be built to handle Bitcoin-specific logic and
event watching).
```

- **Resolver (Taker):** A third-party participant (typically a professional market maker or
    arbitrageur) who **executes the swap** for profit. The resolver listens for orders from
    the relayer and, if profitable, commits to fulfill the swap. The resolver is responsible
    for **locking assets on both chains** : e.g., transferring the user’s tokens into the
    Ethereum escrow contract and locking the corresponding BTC in a Bitcoin HTLC
    script. The resolver ultimately earns the user’s source tokens (plus possibly a fee) if
    the swap succeeds, by redeeming them with the secret. Multiple resolvers may
    compete to fill portions of an order (partial fills), but for a single atomic swap one
    resolver handles the matched portion.
- **Ethereum HTLC Contracts:** We will deploy (or integrate with) Ethereum **Escrow**
    **contracts** that hold tokens during the swap. We plan to reuse the 1inch Fusion
    _EscrowSrc_ and _EscrowDst_ proxy contract model for the Ethereum side[14][15]. For
    each swap, a new **Escrow instance** is created via factory (using create2 with
    deterministic address based on order parameters) to hold the assets. The escrow
    enforces the hashlock (H) and timelock. It will have functions to allow the resolver
    to deposit tokens and later withdraw them (to the user or themselves) when
    provided the correct secret or when timeouts occur[16][17]. The same contract
    code can serve as _EscrowSrc_ (holding maker’s tokens on source chain) or
    _EscrowDst_ (holding resolver’s tokens on destination chain), with logic differences in
    withdrawal (who the recipient is).
- **Bitcoin HTLC Scripts:** On Bitcoin, since we cannot deploy contracts, we use a
    **Hashed Timelock script** (P2WSH) for each swap. The script will lock a specific
    amount of BTC and enforce: (a) **Hashlock:** The spender must provide the secret
    preimage S that hashes to H; (b) **Timelock:** After a certain block height/time (T_B),
    the BTC can be refunded to the resolver if not redeemed. We will define the script to
    allow the _user_ to redeem the BTC with S (before timeout) and allow the _resolver_ to
    refund after timeout. For example, one template script:

IF `<H>` OP_EQUALVERIFY `<user_pubkey>` OP_CHECKSIG
ELSE `<T_B>` OP_CLTV DROP `<resolver_pubkey>` OP_CHECKSIG ENDIF

In words: if the secret’s hash matches H and a signature from the user is provided,
BTC is released to the user’s address; otherwise, after the timelock T_B expires, the
resolver (who initially funded it) can sign to refund the BTC. This ensures mirror
functionality to the Ethereum escrow. (In the ETH→BTC scenario, the user is the
recipient on Bitcoin; in BTC→ETH, the “user” in this context is actually the resolver
because roles swap – see below.)

- **Watcher/Indexer:** A lightweight off-chain component (which may be part of the
    relayer service) that watches both Ethereum and Bitcoin networks for relevant
    events. It will detect when the Ethereum escrow contract is deployed and funded,

```text
and when the Bitcoin HTLC transaction is broadcast and confirmed. It also monitors
for redeem or refund transactions on both chains to update the swap status. This
component ensures the relayer knows when to release the secret or when timeouts
happen.
```

### Swap Workflow (Phases)

We break the cross-chain swap into **four phases** , mirroring the Fusion+ design[18][19] with
adaptations for Bitcoin:

1. **Phase 1 – Order Creation & Auction:** The user (maker) formulates a swap order off-
    chain, indicating source chain, destination chain, amounts, etc. The user’s app
    generates a random secret **S** and computes **H = hash(S)** (e.g., SHA-256). The order
    includes H and a desired expiration time. The user signs this order (using their
    Ethereum key if their source asset is on Ethereum, or simply digitally signs the intent
    off-chain if source is Bitcoin). The **1inch Relayer** receives the signed order and
    broadcasts it to all resolvers[13]. A **Dutch auction** begins for the resolver fee: the
    order starts unattractive and becomes gradually more profitable until a resolver
    accepts it. Once a resolver decides to fill the order, the auction stops and that
    resolver becomes the executor for this swap (at a locked-in price). The relayer now
    coordinates the next steps with that chosen resolver.
2. **Phase 2 – Escrow Deposits on Both Chains:** The resolver now **locks up the assets**
    **on each chain** according to the order[20]:
3. **Ethereum side:** Using the 1inch Limit Order protocol and escrow factory, the
    resolver triggers the creation of an **EscrowSrc** contract on Ethereum (if Ethereum is
    the source chain). This step uses the signed order to move the user’s tokens into the
    escrow contract[15]. (Under the hood, the Limit Order Protocol’s fillOrder
    function transfers the maker’s tokens to the new escrow; the user’s signature
    authorizes this without the user on-chain[21][22].) The escrow holds the tokens,
    locked by hash H and with a timelock T_A (source chain timeout). If Ethereum is the
    _destination_ chain (in a BTC→ETH swap), then this step would involve deploying an
    _EscrowDst_ contract on Ethereum and having the resolver deposit the **ETH (or ERC-**
    **20)** that the user will receive[14][16]. Either way, an Ethereum contract is created
    and funded as one half of the atomic swap.
4. **Bitcoin side:** The resolver creates a **Bitcoin HTLC script transaction** for the other
    half of the swap. If Bitcoin is the destination chain (user receiving BTC), the resolver
    sends the agreed BTC amount into the P2WSH address corresponding to the
    hashlock script (with hash H and timelock T_B). If Bitcoin is the source chain (user is
    swapping BTC for ETH), the roles are reversed: the resolver will wait for the **user** to
    fund a Bitcoin HTLC (with a longer timelock T_A) as the first step, then proceed to
    lock the ETH on Ethereum (with shorter T_B). In either case, by the end of Phase 2
    we have two escrows: one on Ethereum, one on Bitcoin, each holding the respective
    assets. The **timelock values are set such that** T_A > T_B to allow the second actor

```text
to still redeem after the first actor's lock expires (ensuring no loss)[23][24]. For
example, if Ethereum is source: Ethereum escrow might have T_A = 2 hours, Bitcoin
HTLC T_B = 1 hour. If Bitcoin is source: Bitcoin HTLC T_A (user's lock) might be 2
hours, Ethereum escrow T_B = 1 hour.
```

1. **Phase 3 – Secret Reveal & Completion:** Once both escrows are in place and
    **sufficient confirmations/finality** achieved on each chain (e.g., wait for a few
    Bitcoin blocks, and a few Ethereum blocks)[12], the relayer moves to finalize the
    swap. The relayer (or an automated watcher) now **releases the secret S** to the
    resolver(s) – this can be done by either directly communicating S off-chain or by
    triggering an on-chain event that reveals S. In the 1inch design, the relayer discloses
    the secret once it verifies both contracts are set[12]. Armed with S, the **resolver can**
    **now claim the assets** :
2. On the **source chain** , the resolver uses S to unlock the escrow holding the maker's
    tokens. For Ethereum, this means calling the escrow's withdraw function to transfer
    the tokens to themselves (the resolver) by providing the correct preimage S[12]. On
    Bitcoin (if Bitcoin was source), the resolver creates a spend of the Bitcoin HTLC
    using S and their signature (if the user hasn't already done so) to take back their BTC
    - effectively canceling since the swap didn't complete (this scenario only if
    something failed; normally user would redeem, see below).
3. On the **destination chain** , the party entitled to the funds uses S to redeem. If
    Ethereum is the destination, the resolver (or relayer service) calls a withdraw
    function that releases the ETH/tokens _to the user's address_ specified in the escrow
    [anyone can trigger this with S, it doesn't require the user's action](25). If Bitcoin is
    the destination, the **user** will create a transaction spending the BTC HTLC output,
    using S and their Bitcoin key to send the BTC to their own wallet. (This is the reversal
    of the normal atomic swap flow: since the resolver posted BTC, the user must claim
    it with the secret.) We will make this step as user-friendly as possible, potentially
    automating it by preparing a pre-signed Bitcoin transaction that the relayer or UI can
    broadcast once S is known.

As a result of Phase 3, **each party receives the asset they wanted** : the user gets the
output on their destination chain, and the resolver obtains the asset from the source chain
(plus any fee margin). The swap is complete and atomic because the secret S ties the two
legs together – if S is never revealed (e.g. one side fails), neither side will be able to claim
the other’s funds, leading to refunds in Phase 4.

1. **Phase 4 – Refunds & Recovery:** If something goes wrong at any point (e.g. a
    resolver backs out, a transaction fails to confirm, or the secret is never revealed in
    time), the design guarantees funds can be safely returned after the timelocks. Each
    escrow has a **refund path** :
2. On Ethereum, if the resolver never reveals S to withdraw, when the **timelock T_A**
    expires the contract allows a cancellation. The resolver (or any designated
    executor) can call a cancel() function to return the tokens to the maker

```text
(user)[10][11]. Similarly, if the resolver had deposited funds on Ethereum (as dest
chain) and the swap failed, a cancel function returns the resolver's deposit to them
after T_B.
```

1. On Bitcoin, if the user never redeems the BTC using S before timeout, the resolver
    can spend the HTLC output after **T_B** (refund to themselves). If Bitcoin was source
    and the resolver had locked ETH which user never claimed (perhaps user
    disappeared), when T_B passes the resolver can withdraw back their ETH on
    Ethereum. And if the Bitcoin HTLC was funded by the user (BTC→ETH scenario) but
    the resolver never locked ETH or the swap failed, the user reclaims their BTC after
    T_A passes.

In all cases, each party can retrieve their original asset if the other side fails to perform,
ensuring no loss. We will implement guard logic in the relayer/watcher service to
automatically **trigger cancellations** when deadlines hit. Additionally, our design will
include the Fusion+ **safety deposit** mechanism: the resolver posts a small extra amount of
each chain’s native token as a reward for whoever executes the final withdrawal or
cancellation transactions[26]. This incentivizes resolvers (or even competing resolvers) to
promptly finalize the swap outcome – e.g. if the original resolver fails to act, another
resolver can step in, use the secret or trigger refund, and earn the deposit. This aligns
everyone’s incentives and adds fault tolerance to the system.

**Partial Fill Flows:** In the case of large orders, the system will allow **partial fills by multiple
resolvers** as a stretch feature. This means an order can be split and filled in segments (e.g.
two different resolvers each swap half the amount). We will implement the **Merkle tree of
secrets** approach from Fusion+ to handle these securely[27][28]. The user’s order is
divided into _N_ equal parts, and _N+1_ secret hashes are generated, which form the leaves of
a Merkle tree. Each partial fill uses a different secret so that revealing one secret to one
resolver doesn’t allow others to steal the remaining portions[29][30]. For example, for an
order split into 4 parts (25% each), five secrets are generated. The secret with index 0 is
used for the first 0–25% fill, index 1 for the 25–50% fill, and so on, with index 4 used when
completing 100%[31]. The Merkle root (and an initial hash) is shared in the order. As
resolvers fill successive portions, the relayer will reveal the appropriate secret at each
milestone. Our contracts and scripts will be adapted to accept the current secret hash for
each partial escrow. Partial fills will thus execute as a series of smaller atomic swaps that
cumulatively fulfill the order, while maintaining security (no one gets an unfair advantage
to claim funds for an unfilled portion). This feature greatly improves capital efficiency and
user experience for large trades – enabling **faster order execution and better prices** by
allowing multiple resolvers to compete on portions of the order[32].

## Technical Implementation Plan

### Ethereum Side (Solidity Contracts)

We will leverage 1inch’s existing Fusion contracts as much as possible. Specifically, we
plan to use or extend the **1inch Cross-Chain Swap** Solidity code (open-sourced by

1inch[33][34]). The core components are the _EscrowFactory_ , _EscrowSrc_ , and _EscrowDst_
contracts on Ethereum. Our plan:

- **Integrate Escrow Contracts:** Deploy the _EscrowSrc_ and _EscrowDst_ contract code
    (from 1inch’s repo) on Sepolia. These are minimal proxy contracts (clones) used to
    hold tokens and enforce the hashlock/timelock. We will not modify their
    fundamental logic (ensuring compatibility with 1inch’s protocol), but we’ll verify
    they support our use case. If needed, minor tweaks like adding an event for secret
    reveal or adjusting timelock durations will be made. The contracts already have
    functions for withdrawal and cancellation that align with our requirements[35][36].
- **Factory & Limit Order Integration:** The 1inch _EscrowFactory_ will be used to create
    new escrow instances deterministically. We will integrate with the 1inch Limit Order
    Protocol (Fusion mode) for order filling. That means the user’s signed order can be
    filled by the resolver calling 1inch’s fillOrder (or fillContractOrder) function
    which triggers the escrow creation[37][38]. If this integration proves complex on
    Sepolia, as a fallback we will implement a simpler custom HTLC contract: a single
    contract where the resolver can call initiateSwap(order, H, timelocks, ...) to
    lock tokens, and another party can call redeem(secret) or refund() as
    appropriate. This simpler contract would still satisfy the HTLC logic but might not
    utilize the full 1inch architecture. However, priority is given to using the battle-
    tested 1inch contracts to reduce new code and align with hackathon expectations.
- **Parameterization:** We will ensure the Ethereum contracts get the correct H (32-
    byte hash) from the user’s order and set the timelock values properly. For testnet
    demo, we might use relatively short durations (e.g. T_A = 30 minutes, T_B = 20
    minutes) to observe outcomes quickly, but these will be configurable. The contracts
    will emit events (EscrowCreated, Redeemed(secret), Refunded) that our off-chain
    service can monitor.
- **Safety Deposit Handling:** We will implement the safety deposit feature on
    Ethereum by requiring the resolver to send a small amount of Sepolia ETH into the
    escrow along with the token transfer. This is already in the 1inch design (the escrow
    contract likely has a field for a native token deposit)[26]. We’ll confirm this in the
    code; if not present, we can add a requirement that the resolver include e.g. 0.
    ETH as incentive. The contract’s withdraw and cancel functions will be adjusted so
    that if a _public withdraw_ (by a third party) happens, that third party gets the deposit
    as a reward. This logic will mirror what’s described in Fusion+ documentation and
    will be carefully tested.

**Deliverable:** Solidity source code for the Ethereum contracts (or any wrappers) will be
provided, alongside a deployment script (Hardhat or Foundry) for Sepolia. We will also
include a **script to simulate a swap** on Ethereum alone (for unit testing the contract).

### Bitcoin Side (HTLC Scripts & Transactions)

Implementing the Bitcoin side requires constructing and broadcasting the special HTLC
transactions. Key tasks:

- **Script Template:** We will write the Bitcoin Script template for the HTLC as
    discussed (using OP_HASH160 or OP_SHA256 for the hashlock, and OP_CLTV for
    the timelock). We’ll likely use the hashed secret in a 32-byte form (OP_SHA256 <H>)
    to avoid the need for RIPEMD160 (since we can directly use SHA256 for simplicity
    on testnet). The script will be assembled programmatically using a Bitcoin library
    (such as _bitcoinjs-lib_ or _bitcoinlib_ in Python). We will embed the user’s public key,
    resolver’s public key, and timelock into the script for each swap instance.
- **Address & Funding:** Given the script, we derive a P2WSH address. To fund the
    HTLC: if Bitcoin is the dest chain, the **resolver’s Bitcoin wallet** will create a
    transaction sending the specified BTC amount to this P2WSH address. If Bitcoin is
    the source chain (user provides BTC), the **user** will be prompted (via the UI/CLI) to
    send their BTC to the given address. We will integrate with a Bitcoin testnet node or
    API to watch for this deposit. We’ll likely use Bitcoin testnet **Regtest** or Signet for
    faster iteration. For the final demo, testnet (possibly _Signet_ for reliability) will be
    used, and we’ll ensure both parties have test coins ready.
- **Redeem & Refund Transactions:** We will implement functions to construct the
    redeem transaction (when secret is known) and the refund transaction (when
    timeout passes). For redeem (user claiming BTC): the transaction will include the
    secret S in the witness stack and the user’s signature (we will have the user’s
    Bitcoin private key in the demo environment or have them sign via our app). This tx
    sends BTC to the user’s own address. For refund (resolver reclaiming BTC): the tx is
    simpler, just the resolver’s signature after the CLTV expiry. Our system will use a
    Bitcoin library to build and sign these transactions.
- **Time Parameter Coordination:** We’ll choose an appropriate mapping between
    Ethereum block timestamps and Bitcoin block heights for timelocks. For example, if
    we set Ethereum T_A = 1800 seconds (30 min), we might set Bitcoin T_B to a block
    height ~ equivalent of 20 min in the future (given ~10 min block time, maybe +
    blocks). We’ll err on the side of caution with extra buffer to account for block time
    variability. These parameters will be configurable constants in the code.
- **Testing Scripts:** We will test the script logic thoroughly on Bitcoin regtest: create a
    fake swap, try redeeming with wrong secret (should fail), with correct secret (should
    succeed), try refund after expiry, etc. This ensures that by the time of integration,
    the Bitcoin script behaves correctly.

**Deliverable:** a set of Python or Node.js scripts for creating the Bitcoin HTLC, redeeming it,
and refunding it. We will also provide the raw Bitcoin script (in hex and assembly form) as
documentation. Example transactions on Bitcoin testnet will be prepared as part of the
demo.

### Relayer & Resolver Services (Off-Chain)

To glue the two chains together and manage off-chain logic, we will develop a small suite
of services:

- **Relayer Service:** This is the core coordinator. Likely implemented in Node.js or
    Python, it will maintain an **order book** of open swap intents. For our hackathon
    prototype, this can be simplified: it might handle one order at a time (the one
    initiated by the user via the UI). The relayer will broadcast the order details (perhaps
    just simulate this step if we don’t have multiple independent resolvers listening).
    We might implement a simple **resolver selection algorithm** : e.g., assume a
    resolver is always available and willing to fulfill at the user’s specified rate (for
    demo), or actually implement a Dutch auction timer that decreases a notional fee
    until a (simulated) resolver “bites”. In a more advanced version, we can spin up
    multiple resolver bots to demonstrate competition.
- Once a resolver is chosen, the relayer instructs that resolver to proceed with
    escrow creation. In practice, if our resolver service is part of the same code, the
    relayer can directly call the functions to initiate escrow on each chain. The relayer
    will supply the resolver with the secret hash H and the agreed parameters.
- The relayer service **monitors the blockchain events** : it will listen to the Ethereum
    network (via Web3 or ethers.js) for the EscrowCreated and funding events. It will
    also listen to Bitcoin (via a lightweight API or running a Bitcoin node’s ZMQ interface)
    for the HTLC funding transaction confirmation. Once it detects both sides are
    locked in, it triggers Phase 3: releasing the secret. We will implement this either by
    having the relayer directly send the secret to the resolver’s service (since in our
    prototype we trust our components) or by calling a function on the Ethereum
    contract that emits the secret (less ideal due to cost, so probably off-chain).
- The relayer also oversees **timeouts**. It will track the expiration deadlines. If it passes
    the Ethereum T_A without completion, the relayer can call the escrow cancel() on
    Ethereum to return funds, and likewise it can alert the resolver to issue a refund on
    Bitcoin. Similarly, if Bitcoin HTLC is about to expire without redemption, it might
    prompt the resolver to take refund or, if the user is lagging, perhaps even allow a
    third-party to step in. All these ensure graceful recovery.
- **Resolver Agent:** We may implement the resolver logic as part of the relayer for
    simplicity (i.e., a unified service that does everything), but to simulate real
    conditions, we could separate them. The **resolver agent** would listen for orders
    (from relayer) and upon acceptance, handle the on-chain actions:
- Use an Ethereum RPC/SDK to call fillOrder and deploy the source escrow (or call
    createEscrowDst if filling as destination).
- Construct and broadcast the Bitcoin transaction for the HTLC on the other chain.
- Wait for secret disclosure; once received, use it to call Ethereum withdraw or
    Bitcoin redeem as appropriate.
- If partial fills are implemented, multiple resolver agents could each handle a
    segment. They would use the Merkle tree index to know which secret to expect. The
    relayer would communicate which secret (index) is active for the next fill.

- The resolver agent also monitors for scenarios to claim the **safety deposit reward** –
    for instance, if another resolver failed to complete a swap, this agent could use the
    secret (from an event) to execute the public withdraw and get the deposit[26]. This
    is advanced behavior and may not be fully realized in the hack prototype but will be
    noted in design.

Both relayer and resolver will require connectivity to Ethereum (via Infura/Alchemy or local
node) and to Bitcoin (likely a bitcoind node in testnet mode). We will likely run a local
Bitcoin node for development and use a public Sepolia RPC for Ethereum.

**Deliverable:** The source code of the off-chain service (likely a Node.js project). It will
contain modules for listening to events, managing orders, and calling chain actions. We
will provide configuration for connecting to the testnets and simple instructions to run the
coordinator and resolver.

### User Interface (UI/CLI)

As a stretch goal, we will implement a basic user interface to demonstrate the end-to-end
flow:

- **Web Dashboard or CLI:** Depending on time, a simple web frontend (React or a
    lightweight HTML/JS page) will allow the user to input swap details. If web, it will
    integrate with MetaMask (for Ethereum signature) and prompt the user for any
    Bitcoin actions (perhaps by showing a QR code or address for deposit).
    Alternatively, a command-line tool could accept parameters or a configuration file.
    We aim for a web UI for better visualization: it will show, for example, “Swap 0.1 ETH
    on Sepolia to BTC on Bitcoin Testnet”. After submission, it will display statuses:
    “Order posted, awaiting resolver...”, “Escrows locked on both chains”, “Secret
    revealed”, “Swap complete! Received X BTC”. In case of partial fills, it might show
    progress like a progress bar of fill %.
- **Integrating Wallets:** For Ethereum, the UI will leverage MetaMask or web3 to let the
    user sign the initial order message (EIP-712 or similar for Limit Order). If the user’s
    asset is ETH or an ERC-20, the UI also ensures they have approved the 1inch
    contract if needed (for example, the Limit Order Protocol might require a permit or
    an approval; we will use permit signatures if possible to avoid extra transactions).
- **Bitcoin Interaction:** If the user needs to deposit BTC (BTC→ETH scenario), the UI
    will generate an **address QR code** for the HTLC address and instruct the user to
    send the exact amount to it. It will monitor for this deposit (polling an API or our
    backend). For a user redeeming BTC (ETH→BTC scenario completion), ideally the
    UI can automatically construct the redeem transaction once the secret is known. If
    the user’s Bitcoin private key is accessible (not likely in a web UI for security
    reasons), we could have them input a seed phrase in test mode or use a browser-
    based signer. More realistically, we might provide the raw transaction hex and ask
    the user to broadcast it with their wallet (for demo, we might manage the keys just

```text
for simplicity). Security is not a big concern on testnet, so we have flexibility to
automate with a demo key.
```

- **Swap Monitoring:** The UI will get updates from the relayer service, perhaps via
    WebSocket or polling a REST endpoint. It will update the status and show
    transaction IDs for both chains. This transparency helps build user trust that funds
    are moving as expected. We will also include a _“Refund”_ status if a timeout occurs,
    so the user knows their assets were returned.

If time does not permit a full web UI, we will provide a CLI script that orchestrates a swap
and prints each step to console, which can be recorded for the demo. The CLI could, for
example, call a local function to initiate an order and then report events as they happen
(using the off-chain service’s logs).

**Deliverable:** The source code for the UI (HTML/JS or Python CLI). For a web UI, a live
version may be hosted or we will run it locally during the demo. User instructions will be
provided (e.g., “open index.html and connect MetaMask on Sepolia, ensure you have
Sepolia ETH, etc.”).

### Timelines & Milestones

We propose the following development milestones (assuming ~4-6 weeks total
development time, which can be accelerated for the hackathon):

1. **Milestone 1: Core Swap Contracts & Scripts (Week 1)** – Complete the HTLC
    implementations on each chain in isolation. Write and test the Ethereum contract
    (Escrow logic) on a local dev network or Sepolia fork. Write the Bitcoin script and
    test funding/redeem/refund on Bitcoin regtest. _Deliverables:_ Basic solidity contract
    deployed locally; sample Bitcoin HTLC TX working; documentation of test results.
2. **Milestone 2: Off-Chain Coordination (Week 2)** – Implement the relayer/resolver
    service to coordinate a single swap round-trip. Integrate Ethereum and Bitcoin
    interactions: e.g., script that given a swap order will lock on Ethereum, wait, lock on
    Bitcoin, then manually reveal secret and redeem. This will be tested on **Sepolia +**
    **Bitcoin signet** with real test transactions. _Deliverables:_ A successful **end-to-end**
    **atomic swap** on testnets triggered via a script (no UI yet), demonstrated for both
    directions (if possible). Also, start of partial fill logic (maybe just conceptual or a
    simple two-part fill test).
3. **Milestone 3: Partial Fills & Advanced Features (Week 3)** – Add support for
    splitting orders and multiple secrets. Simulate two resolvers filling one order
    sequentially (e.g., Resolver A does 30%, Resolver B does remaining 70%). Ensure
    the Merkle tree secret logic works and funds are safe (test scenario where Resolver
    A stops after partial fill – Resolver B should still be able to complete with next
    secret). Implement safety deposit incentives in contracts and test scenarios of a
    resolver failing to unlock, and another stepping in. _Deliverables:_ Updated contracts
    if needed for partial fills, logs or tests showing partial fill execution, and confirmed

```text
behavior of safety deposits (like a test where someone else cancels and gets the
reward).
```

1. **Milestone 4: User Interface & Demo Prep (Week 4)** – Build the user-facing UI or
    CLI and integrate it with the relayer service. Perform comprehensive testing of the
    whole system with the UI: have a user swap scenario and verify outcome on both
    chains (check balances, etc.). Refine the UX (e.g., ensure informative messages,
    handle error cases). Prepare **demo scripts and fallback plans** (for example, if
    Bitcoin testnet is slow, have pre-mined transactions or use regtest in a controlled
    environment for the live demo). _Deliverables:_ Polished UI, final deployment of
    contracts on Sepolia, final configuration of relayer (likely running on a server or
    locally), and a documented demo scenario ready to execute.

Given the hackathon context, some of these may be condensed. We anticipate having a
working prototype by the end of Week 2 or 3, and then focusing on polish and extras.

## Component Breakdown

To clarify the system, below is a breakdown of major components and their
responsibilities:

- **Ethereum Smart Contracts:**
- _EscrowSrc / EscrowDst clones:_ Hold tokens during the swap. Enforce hashlock
    (store H) and timelocks [start timestamps, durations](39). Allow only specific
    actions: deposit by resolver, withdraw by correct secret or cancel after timeout.
    Emits events on creation, withdrawal (including the secret reveal event), and
    cancellation.
- _EscrowFactory:_ A factory contract that creates the escrow clones using minimal
    proxies[40][41]. It ensures the clone’s address can be known from parameters
    (which is important for resolvers to send the safety deposit to the right address
    _before_ it’s deployed). We will deploy one factory on Sepolia.
- _Limit Order Protocol (1inch)_ : Used to fill orders and thereby call the factory. The
    protocol’s fillOrder function is effectively the entry point resolvers use to execute
    an order on-chain. It interacts with the user’s tokens and requires the user’s signed
    order and signature. We might use 1inch’s existing deployed LimitOrder contract on
    Sepolia if available (reducing deployment work). If not, we include the necessary
    parts of the protocol in our deployment.
- **Bitcoin Contracts (Scripts):**
- _HTLC Script Template:_ A predefined script that we program with swap-specific
    values (H, user pubkey, resolver pubkey, locktime). It’s not an on-chain “contract”
    until used in a transaction. For each swap, we create one UTXO encumbered by this
    script.

- _Funding TX:_ The Bitcoin transaction that creates the HTLC UTXO. This is crafted by
    the funding party (resolver or user) and broadcast to the network. It has 1 output
    (the HTLC) and likely one input (from the funder’s wallet UTXOs).
- _Redeem TX:_ A transaction spending the HTLC output, providing `<secret>`
    `<user_sig>` as witness to satisfy the script and sending BTC to the user.
- _Refund TX:_ A transaction spending the HTLC output after timeout, providing
    `<resolver_sig>` to satisfy the other branch of the script, sending BTC back to
    resolver.
    These transactions will be constructed and signed by our off-chain software using
    bitcoind or a library.
- **Relayer Backend:**
- _Order Manager:_ Holds the list of open orders, their details (H, amount, chains, etc.),
    and their current status (filled/unfilled, how much filled). It initiates auctions and
    picks resolvers. In a more complex scenario, it would expose APIs for resolvers to
    query orders; in our prototype, it may simply assign the order to an internal resolver
    agent.
- _Chain Listeners:_ Sub-components that subscribe to blockchain events. For
    Ethereum: listens to the factory for new escrow deployments and to escrow events
    (withdraw, cancel). For Bitcoin: monitors mempool and blocks for the presence of
    the HTLC TX and for any spends of it. We may use block explorer APIs for testnet to
    avoid running a full node (e.g., polling an API for a given TXID or address). Reliability
    is key: we’ll have retries and a backup plan (like if an API fails, our own bitcoind as
    fallback).
- _Swap Coordinator:_ Orchestrates the progression of each swap. It sets timers
    relative to timelocks, and triggers actions like calling secret reveal, or instructing
    cancellations. It also coordinates partial fills: updating remaining order amount and
    possibly issuing the next portion to the auction if an order wasn’t fully filled in one
    go.
- _APIs:_ The relayer might expose a simple REST or WebSocket API for the UI to get
    status updates or for resolvers to sign up. For example, an endpoint /orders to list
    active orders, or /orders/{id}/status for progress. This is optional for the hack
    demo (internal integration might suffice), but we design it with modularity in mind.
- **Resolver Agent(s):**
- _Ethereum Client:_ Handles sending transactions to Ethereum (fills and withdrawals).
    It likely uses ethers.js with the resolver’s private key to sign transactions that
    interact with the escrow and Limit Order Protocol.
- _Bitcoin Client:_ Handles creating and signing Bitcoin transactions for funding and
    redeeming. Possibly wraps RPC calls to bitcoind (e.g., using bitcoin-cli or an
    RPC library) or constructs raw transactions manually.

- _Strategy Logic:_ The resolver can include logic to decide on partial fills or whether to
    accept an order based on profitability. For the hack, this can be a fixed behavior
    (e.g., always accept instantly to simplify). But we structure it such that in future it
    could use price feeds or user input to decide.
- _Secret Handling:_ When the secret is revealed by relayer, the resolver agent will
    catch it (maybe via an event or message) and then proceed to withdraw on
    Ethereum. In the scenario where a resolver becomes inactive, others might still
    retrieve the secret from the on-chain event (Ethereum escrow’s event contains or
    the relayer’s broadcast)[42]. We ensure our agent listens for that if we simulate
    multiple agents.
- **User Interface:**
- _Frontend:_ If web-based, consists of pages for creating an order and viewing its
    status. It will use web3 to connect to Ethereum (for signature) and possibly rely on
    an injected provider. It might not directly interface with Bitcoin, except to display
    addresses or TXIDs; Bitcoin actions might be mediated via the backend.
- _Feedback Components:_ Loading spinners, status text, and possibly a visualization
    of the cross-chain process (like a stepper: “Locking funds on Chain A... Locking on
    Chain B... Swapping... Done”). This helps the user understand what’s happening in
    each phase.
- _Error Handling:_ The UI will handle common error cases: e.g., if the user has
    insufficient funds or gas on Ethereum, show a clear message; if the Bitcoin
    transaction is delayed, show “waiting for confirmations”; if something fails and
    refund happens, inform the user that swap failed but funds are safe.

All components will be designed to work together but with clear interfaces. For instance,
one could replace the UI with another front-end, or add more resolvers, without changing
the core.

## Development Timeline & Milestones

_(See “Timelines & Milestones” above for a week-by-week breakdown.)_ In summary, the
development will proceed in stages:

- **Phase 1:** Implement and test the core HTLC logic on both chains (smart contracts
    and scripts).
- **Phase 2:** Develop the off-chain coordination and achieve the first end-to-end swap
    on testnets via scripts.
- **Phase 3:** Add partial fill support, multi-resolver handling, and robustness features
    (safety deposits, timeouts).
- **Phase 4:** Build the user interface and refine the system for demonstration
    readiness.

We expect iterative testing throughout. Smart contracts will be tested with unit tests (using
Foundry or Hardhat) early, Bitcoin scripts tested on regtest, and integration tested on
testnets as soon as possible. This phased approach ensures we tackle the riskiest parts
(cross-chain mechanics) first, and handle polish (UX) last.

## Risk Considerations

Building cross-chain swaps with Bitcoin introduces several risks and challenges:

- **Blockchain Confirmation Times:** Bitcoin’s block time (~10 min) is much slower
    than Ethereum’s (~12 sec on Sepolia). This mismatch means our timelock intervals
    must be chosen carefully to avoid expiration during normal operation. We mitigate
    this by making Bitcoin’s timelock longer and ensuring the relayer waits for sufficient
    confirmations (we might require e.g. 1 confirmation on testnet for demo).
    Nonetheless, a risk is if Bitcoin’s network is unusually slow or transactions get
    delayed, the swap could timeout unnecessarily. We will use conservative timeouts
    in demo to avoid this.
- **Secret Revelation Timing:** Revealing the secret too early or to the wrong party
    could allow theft. In our design, the secret is only released by the relayer **after** both
    sides are locked and ideally after Bitcoin’s finality [confirmations](12). If the relayer
    malfunctioned and revealed S before the resolver locked both sides, a malicious
    resolver could take advantage. To mitigate, our code will strictly wait for
    confirmation of both escrows. We will test the sequence thoroughly. Additionally,
    all secret communications will be encrypted if over a network (though likely our
    components run locally).
- **Partial Fill Complexity:** The Merkle tree of secrets approach is intricate. A risk is
    improper implementation leading to a scenario where a resolver could use a
    revealed secret index to unlock more than they should. We must ensure that once a
    secret for index _i_ is revealed, the remaining order portion cannot be hijacked. This
    means subsequent escrow instances must use the next index’s hash, and the
    previous secret should not unlock them. We will carefully follow the Fusion+ spec
    for this[27][28]. Testing partial fills with adversarial conditions (one resolver drops
    out) will be important.
- **Fallback in BTC→ETH Flow:** In the flow where the user is the one locking Bitcoin
    first, there is a slight **counter-party risk** : the user might lock BTC and no resolver
    comes to fill the order on Ethereum. To protect the user, the order will have an
    expiration and the Bitcoin HTLC will refund to the user after T_A. The user’s funds
    are not lost, but they are inconvenienced (locked until timeout). To mitigate this, the
    relayer should ideally only prompt the user to send BTC **after** a resolver has agreed
    to the order. Our UI will follow that logic (it will show “awaiting resolver” and only
    once a resolver is confirmed, provide the deposit address). This way, the user
    doesn’t send BTC into an HTLC without assurance of the other side.
- **Coordination & Centralization:** The current design uses a centralized relayer to
    coordinate secret reveal and order matching. If the relayer were compromised, it

```text
could disrupt swaps (e.g. not reveal secret, or collude with a resolver). While
decentralizing this is future work, we will secure the relayer for the prototype
(running it ourselves, no external adversaries). We also log all actions transparently,
and the on-chain logic ensures that even if relayer fails, eventually timelocks refund
the funds. The user's trust is mainly that the relayer will progress the swap in a
timely manner, which in our controlled environment is acceptable.
```

- **Smart Contract Risks:** As with any Solidity code, bugs or vulnerabilities are a risk.
    By using 1inch’s audited contracts as a base[43], we reduce this risk. We will not
    introduce complex new logic on Ethereum aside from perhaps small tweaks. We’ll
    also run our own review and tests for re-entrancy, correct access control (ensuring
    only intended functions can be called by intended parties), and that no funds can
    get stuck (the rescueFunds function in the design covers edge cases[44]).
- **Bitcoin Script Risks:** Bitcoin script is unforgiving – a small error can lock funds
    irretrievably. We will test on regtest with known secrets to ensure our script works.
    One risk is using the wrong type of timelock (CLTV vs CSV) or mis-estimating block
    heights. We plan to use CLTV with an absolute block height. If the Bitcoin network
    reorgs beyond that height (very unlikely for a small range on testnet), there’s a slight
    risk, but testnet is low stakes. We’ll also ensure the script’s hashlock uses the
    correct hashing (SHA256 vs RIPEMD160) consistently with how we compute H off-
    chain.
- **UX Risks:** The user might make mistakes, especially on Bitcoin (e.g. not sending the
    exact amount, or sending after the expiration). Our UI will try to guard against this by
    clearly instructing amounts and showing a countdown for any user action needed.
    We will also implement as much automation as possible (like preparing the
    transaction for them). Nonetheless, if a user fails to complete their part, the swap
    will fail safely (no loss of funds, just a refund after timeout). We consider that an
    acceptable failure mode for now.
- **Testing/Infrastructure Risks:** Relying on testnet networks means external
    dependencies – e.g., if Sepolia or the Bitcoin testnet have outages or congestion
    during the demo, it could impact us. We mitigate this by having a **demo mode** on
    regtest: we can simulate the entire flow locally in seconds if needed. We will
    prepare a local Bitcoin regtest and a local Ethereum dev node as a backup to
    demonstrate the mechanism in case live networks misbehave. Of course, we’ll
    prefer the real testnets to prove our solution in a realistic environment.

Overall, the design prioritizes security (fund safety) over liveness – in worst case scenarios,
swaps might timeout but funds return correctly. We will document these scenarios and
ensure the demo explicitly shows that even if something goes wrong, the user and resolver
are protected by the protocol’s guarantees.

## Demo Plan

To showcase the completed project, we will conduct a **live demo** of a cross-chain swap on
testnets:

- **Setup:** We’ll begin by introducing the scenario: for example, _Alice_ (the user) has 0.
    ETH on Sepolia and wants to swap to BTC (testnet) using 1inch Fusion+. We’ll
    ensure Alice’s MetaMask is connected to Sepolia and she has some Sepolia ETH.
    We’ll also have _Bob_ as the resolver with some testnet BTC and willing to acquire
    ETH. Bob’s resolver service will be running in the background. We’ll also show a
    quick architecture diagram (if allowed in presentation) to remind the audience of
    the components.
- **Step 1 – User Initiates Swap:** Using our UI, Alice selects Ethereum → Bitcoin,
    enters 0.1 ETH and sees an expected ~≈0.0003 BTC (for example) based on rate.
    She clicks “Swap”. The UI prompts her to sign the order (we’ll show the signing
    modal). Once signed, the order is sent to the relayer. The UI now indicates “Order
    posted – waiting for resolver...”.
- **Step 2 – Resolver Fills Order:** In the background, Bob’s resolver service receives
    the order. We might display Bob’s console on screen to show that it received the
    intent and decided to fill it. The resolver then calls the Ethereum contract to create
    the escrow. We’ll have Etherscan (Sepolia) ready, or our UI will display the
    Ethereum transaction hash. After a few seconds, we expect an event that escrow is
    funded. The UI can update: “Ethereum escrow created and funded with 0.1 ETH”.
    Next, Bob’s service creates the Bitcoin HTLC transaction. We will show the Bitcoin
    testnet TXID (maybe link to a Block Explorer). Once that transaction is confirmed
    (we might use a testnet faucet to get it mined quickly, or simulate a confirmation),
    the UI updates: “Bitcoin HTLC funded with X BTC”.
- **Step 3 – Secret Reveal:** The relayer now detects both sides locked. We’ll then
    demonstrate the secret reveal – possibly by printing the secret on screen (and/or an
    event log entry). For dramatic effect, we’ll highlight the secret value “S” and its hash
    “H” to show they match. The UI status changes to “Secret revealed – completing
    swap”.
- **Step 4 – Completion:** With the secret, the resolver withdraws on Ethereum and the
    user’s BTC is released. If Ethereum is source (our example), Bob will call the
    Ethereum contract to claim the 0.1 ETH (plus maybe a small premium). We can
    show that transaction on Etherscan and show Bob’s balance increasing. On the
    Bitcoin side, our system will either automatically create the redeem transaction for
    Alice or instruct her to click “Claim BTC”. We’ll demonstrate that the BTC is
    delivered to Alice’s Bitcoin wallet address. For simplicity, we might control Alice’s
    testnet BTC wallet in the demo and show the balance update (e.g., using a block
    explorer or a lightweight wallet). The UI then shows “Swap Complete!” with details
    of amounts exchanged.
- **Partial Fill Demo (if implemented):** We will also demonstrate a partial fill scenario.
    For instance, Alice wants to swap 0.2 ETH, and two resolvers each take 0.1 ETH
    portion. We can simulate this by running two resolver instances. The UI will show
    the order being 50% filled by Resolver A, then completed by Resolver B. We’ll
    highlight that two different secrets were used for each portion, ensuring the process

```text
remained atomic for each part. This part of the demo underscores the advanced
functionality (Merkle secrets enabling multi-resolver fills).
```

- **Failure Scenario (if time permits):** To inspire confidence in the safety, we might
    deliberately cause a scenario where a resolver stops responding after funding one
    side. For example, Bob funds Ethereum escrow but fails to fund Bitcoin. We’ll show
    that after the timelock, Alice’s funds on Ethereum are refunded. Or if Bob funded
    both but then didn’t reveal secret, another agent uses the safety deposit to refund
    Alice. Demonstrating this might be complex in a short demo, so we may opt to just
    explain it verbally or with a short pre-recorded clip.
- **Questions & Answers:** After the live swap, we will clarify any technical points,
    pointing out that no centralized entity held funds at any time and that the swap was
    **trustless** – if either side had cheated, the protocol’s timelocks would have reverted
    the trade[45]. We will also mention future extension possibilities (like other chains,
    UI improvements, etc. from the next section).

We will prepare **demo scripts** to automate as much as possible (especially Bitcoin
aspects, as waiting for testnet confirmations can be slow/unpredictable). If needed, we
might use Bitcoin regtest for the demo with pre-mined blocks to control timing, while
clearly stating it. Alternatively, we could do a live testnet demo but have a regtest backup
recording. Our goal is to show a _convincing and clear_ cross-chain swap in real time.

## Testing Strategy

Testing will be critical given the cross-chain nature. Our approach:

- **Unit Tests (Solidity):** We will write unit tests for the Ethereum contracts using
    Foundry or Hardhat. This includes testing: creating an escrow with a sample secret
    hash, ensuring that withdraw(secret) transfers funds to the intended party only if
    the secret matches, and that cancel() works only after the timeout. We’ll simulate
    both roles (resolver calling withdraw vs. a public third party calling after timeout).
    These tests will run on a local EVM and also with different parameter edge cases
    (very short timelocks, etc.). We’ll also test partial fill contract logic (if any additional
    contract handling needed for multiple secrets).
- **Bitcoin Script Testing:** Using Bitcoin regtest, we will test the HTLC script
    thoroughly. We’ll use a controlled environment to mine blocks so we can test
    timelock expiration quickly. Test cases: correct secret redemption (user can spend
    with S prior to timeout), wrong secret (tx is invalid as expected), refund after timeout
    (resolver can spend after CLTV expiry), and no early refund (resolver cannot spend
    before timelock). We can use Python’s bitcoinlib or RPC calls to broadcast these
    test transactions and assert the expected outcome (spent or not spent). We will
    automate these tests as much as possible.
- **Integration Test (Happy Path):** Once unit tests pass, we’ll perform an end-to-end
    integration test in a **scripted manner**. Possibly write a Python or JS script that does:
    deploy contracts to a local Ethereum testnet (Ganache or Hardhat network), spin

```text
up a regtest Bitcoin node, then go through one complete swap flow automatically.
This script can directly call the functions in our backend (or even mimic them) to
ensure the sequence works. We'll check that at end: user's ETH decreased and BTC
increased, resolver's BTC decreased and ETH increased, and that all intermediate
conditions (like secret correctness) held. This automated test will be invaluable to
catch any cross-chain sequencing issues.
```

- **Integration Test (Edge cases):** We also simulate failure modes in a controlled
    environment. For example: simulate that after Ethereum escrow, Bitcoin funding
    never happens – ensure Ethereum refund goes through after timeout. Or simulate
    secret reveal but resolver not withdrawing on Ethereum – ensure another agent can
    withdraw after the resolver-only period ends (testing the safety deposit incentive).
    These can be semi-automated by controlling our backend to not call certain steps
    and then calling the timeout functions.
- **Testnet Dry-Run:** Before the actual demo, we will conduct multiple **full dry-run**
    **swaps on Sepolia + Bitcoin testnet**. This is to ensure our timing and monitoring
    works on real networks. We’ll look at block times, adjust any parameters, and
    ensure our services can handle network latency (e.g., confirm that if Bitcoin takes
    5+ minutes, our software doesn’t glitch or time out prematurely). We’ll also test our
    UI against the live system, possibly with small amounts, to iron out any last-minute
    issues. If any part fails, we debug and fix then retest. This phase is critical to avoid
    surprises on stage.
- **Security Review:** As a final step, we’ll review the system for any obvious security
    holes. For example, check that secret values are truly random and not reused,
    check that all secrets are kept hidden until intended (not accidentally logged or
    exposed via an API). Ensure the Ethereum contract addresses are correct and we
    aren’t interacting with a wrong contract (could be catastrophic on mainnet, so even
    in test we practice verifying addresses). We’ll double-check the math for timelocks
    (the difference between T_A and T_B) to ensure enough margin.
- **Performance & Load:** Not a big concern for a single swap demo, but we might test
    if our relayer can handle e.g. two concurrent swaps or partial fills quickly in
    succession. The Dutch auction mechanic won’t be heavily tested in terms of
    performance (since it’s mostly off-chain waiting), but we might simulate a price
    drop schedule to see if our resolver picks up at the right time.
- **Testing Documentation:** We will document all tests and their results. This helps in
    the submission to show the robustness. For example, we’ll list: “Test #5: Wrong
    secret on Bitcoin – expected fail, result: fail (pass).” Also, any known limitations
    found during testing will be noted with mitigation (e.g. “On testnet, block times
    varied causing us to extend the timeout by 5 min to be safe.”).

By following this multi-layered testing strategy, we aim to catch both low-level bugs and
high-level coordination issues, delivering a reliable prototype. The ultimate test is the live
demo, but having done it multiple times ourselves in practice will give confidence.

## Future Extensions

While this PRD focuses on supporting Bitcoin, the underlying architecture can be extended
and improved in numerous ways beyond the hackathon:

- **Additional Chains:** With the Bitcoin implementation done, adding other **Bitcoin-**
    **family chains** (Bitcoin Cash, Litecoin, Dogecoin, etc.) would be straightforward.
    They use similar UTXO scripts with minor differences (e.g., LTC has shorter block
    time, adjust timelocks accordingly). The code could be generalized to a module for
    “UTXO-based chains” so 1inch Fusion+ could expand to all high-priority chains
    listed in the bounty[8]. Similarly, non-EVM smart contract chains (like Cosmos or
    Tron) could be integrated by writing their equivalent of HTLC (perhaps via their
    scripting or smart contract capability). Our architecture is modular to allow plugging
    in new chain handlers.
- **Automated Order Matching Network:** Decentralizing or expanding the resolver
    network is a logical next step. We could turn the relayer into a **peer-to-peer**
    **network** where multiple relayers share orders, and many independent resolvers
    compete. This would involve more sophisticated networking and possibly a
    reputation system for resolvers. In the context of Bitcoin swaps, having multiple
    resolvers is especially useful for partial fills (it increases liquidity). Our partial fill
    implementation already lays groundwork for multiple resolvers per order; expanding
    this to a full network would enhance reliability and price competition.
- **Enhanced UX & Wallet Integration:** We would refine the user experience so that
    from the user’s perspective, a cross-chain swap is as easy as a normal swap. This
    could include integrating a Bitcoin light client or wallet in the dApp so the user
    doesn’t have to manually handle BTC at all. For example, using something like **xpub**
    keys or PSBTs: the user could scan a QR with their mobile Bitcoin wallet to sign the
    redeem transaction when needed. Or use a browser-based signing (if standards like
    WebBTC or others evolve). Also, the UI could be integrated into the main 1inch UI
    eventually, meaning a user can swap ETH↦BTC inside 1inch’s interface seamlessly.
- **Mainnet Deployment & Security Audits:** Before production, thorough audits of the
    Solidity contracts and the overall protocol would be required. We’d also likely do a
    **beta on testnet** with external users to see if any unexpected user behaviors break
    the flow. Monitoring and alerting infrastructure would be set up for the relayer
    (especially since it coordinates funds across chains).
- **Lightning Network and Layer2s:** To improve speed and reduce Bitcoin fees, a
    future version could allow the Bitcoin side to occur on the Lightning Network. For
    instance, using a Lightning HTLC invoice as one side of the atomic swap (this is
    complex and would involve an adaptor or watchtower to coordinate with an on-
    chain Ethereum HTLC). Another angle is integrating Layer2 networks on Ethereum
    side (like Arbitrum or zkSync) into cross-chain swaps. Fusion+ already supports
    many EVM L2s; extending to Bitcoin means perhaps we could also connect BTC to

```text
an Ethereum L2 directly. These are more advanced research topics but could make
the swaps faster and cheaper.
```

- **Protocol DAO Governance:** Fusion+ is governed by 1inch DAO for parameters[46].
    As Bitcoin and other chains join, governance might set parameters like maximum
    timeouts, fee tiers for resolvers, etc. We would propose any new parameters (e.g.,
    safety deposit amount on Bitcoin, or max BTC amount per swap initially) to be
    governed. Long-term, the system could allow 1INCH token stakers to have a say in
    cross-chain policy, like which chains to add next.
- **Improving Capital Efficiency:** Right now, the resolver must fully fund both sides
    (they essentially front the user’s output asset). In the future, **cross-chain lending or**
    **credit** could allow resolvers to use less capital – for example, using the user’s
    escrowed asset as collateral to borrow the output asset temporarily. This could
    attract more liquidity. Additionally, partial fills already help by allowing multiple
    resolvers to split the burden. We might also explore using **atomic swaps via**
    **adaptor signatures (scriptless scripts)** to potentially reduce on-chain footprints,
    but that requires both chains to support certain cryptography (Bitcoin and Ethereum
    could via ECDSA adaptor sigs). It’s advanced but would allow secret sharing
    without explicit hashlock contracts.
- **Analytics & Monitoring Tools:** As this system goes live, having tools to monitor
    cross-chain swaps (success rates, average completion time, etc.) would be
    important. We’d likely build a dashboard that tracks swaps across chains, helping
    identify any issues (for example, if many swaps time out on Bitcoin due to low fees,
    we might adjust strategy).
- **User Safeguards:** We could add features like an **auto-refund button** for users: if
    they get impatient and want to abort, they could trigger early cancellation (the
    protocol would then just wait for timelock). Also, perhaps an insurance fund or
    slashing for resolvers who consistently fail could be introduced, to bolster user
    trust.

By implementing Bitcoin support now, 1inch Fusion+ moves closer to being a truly
universal cross-chain DEX. The above extensions would further solidify its position as a
**standard for decentralized, secure cross-chain swaps** , offering users access to Bitcoin
liquidity without ever giving up custody – a powerful realization of the multi-chain DeFi
vision where “which chain won’t matter”[47].

## References

[1]: https://blockworks.co/news/1inch-fixing-cross-chain-swaps "1inch to fix cross-chain swaps with the full release of Fusion+ - Blockworks"
[2]: https://1inch.io/assets/1inch-fusion-plus.pdf?ref=blog.1inch.io "1inch.io"
[4]: https://blockworks.co/news/1inch-fixing-cross-chain-swaps "1inch to fix cross-chain swaps with the full release of Fusion+ - Blockworks"
[6]: https://blog.1inch.io/unite-defi-1inch-ethglobal-hackathon/ "Build with 1inch: Join Unite DeFi hackathon – $525K prizes"
[7]: https://blockworks.co/news/1inch-fixing-cross-chain-swaps "1inch to fix cross-chain swaps with the full release of Fusion+ - Blockworks"
[8]: https://blog.1inch.io/unite-defi-1inch-ethglobal-hackathon/ "Build with 1inch: Join Unite DeFi hackathon – $525K prizes"
[9]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[11]: https://1inch.io/assets/1inch-fusion-plus.pdf?ref=blog.1inch.io "1inch.io"
[12]: https://1inch.io/assets/1inch-fusion-plus.pdf?ref=blog.1inch.io "1inch.io"
[13]: https://1inch.io/assets/1inch-fusion-plus.pdf?ref=blog.1inch.io "1inch.io"
[15]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[16]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[17]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[19]: https://1inch.io/assets/1inch-fusion-plus.pdf?ref=blog.1inch.io "1inch.io"
[20]: https://1inch.io/assets/1inch-fusion-plus.pdf?ref=blog.1inch.io "1inch.io"
[22]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[26]: https://1inch.io/assets/1inch-fusion-plus.pdf?ref=blog.1inch.io "1inch.io"
[28]: https://1inch.io/assets/1inch-fusion-plus.pdf?ref=blog.1inch.io "1inch.io"
[30]: https://1inch.io/assets/1inch-fusion-plus.pdf?ref=blog.1inch.io "1inch.io"
[31]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[32]: https://1inch.io/assets/1inch-fusion-plus.pdf?ref=blog.1inch.io "1inch.io"
[34]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[36]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[38]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[41]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[42]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[43]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[44]: https://github.com/1inch/cross-chain-swap "GitHub - 1inch/cross-chain-swap"
[45]: https://blockworks.co/news/1inch-fixing-cross-chain-swaps "1inch to fix cross-chain swaps with the full release of Fusion+ - Blockworks"
[46]: https://1inch.io/assets/1inch-fusion-plus.pdf?ref=blog.1inch.io "1inch.io"
[47]: https://blog.1inch.io/unite-defi-1inch-ethglobal-hackathon/ "Build with 1inch: Join Unite DeFi hackathon – $525K prizes"
