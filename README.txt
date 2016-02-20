
***********************
AQUILA MARKET: OVERVIEW
***********************

In this market, we seek to maintain strong user privacy, and to create
an organization that may exist independently of the actions of any one
person or real-life entity.


PROBLEM:   If the server running a centralized market (i.e., a market that
           users access with a normal web browser and nothing else) is
           compromised, then an attacker can steal money or compromise
           privacy. This is true even if multisig is used, and no matter
           what encryption is used on the server, unless you verify the
           payment address independently of the market.

SOLUTION:  Servers are not trusted. All users run a client that verifies
           cryptographic signatures traceable to a root certificate
           embedded in the client, and transmit only encrypted messages.
           Multiple redundant servers are used, protecting against DoS
           or selective refusal to relay messages by a bad server admin.


PROBLEM:   Multisig destroys blockchain privacy if the buyer, seller,
           or market admin ever uses the same key for multiple
           transactions. We can avoid this if each party generates new
           keys for each transaction, but that's inconvenient.

SOLUTION:  "Stealth"-type EC math is used to derive all keys that
           appear in the blockchain, including those for 2/3 multisig.


PROBLEM:   P2P-style systems with encrypted messages flood-routed across
           many peers make it effectively impossible to delete all copies
           of a message once it has been broadcast to the network. If a
           single key is used for many messages, then its disclosure may
           cause great damage.

SOLUTION:  Keys used for encryption are rotated. Private keys are stored
           only by the user locally, and purged when it's no longer
           necessary to retain any messages encrypted with them. Longer-
           lived keys sign the encryption keys and are a user's identity
           to the market.


PROBLEM:   Any person capable of acting alone (e.g., the server admin on
           a centralized market, or the "notary" on some decentralized
           markets) may choose or be coerced to commit fraud, or stop
           providing service. That event will destroy the market forever.

SOLUTION:  Overall control of the market is determined by a vote among
           a closed set of owners, with ownership tracked in the Bitcoin
           blockchain. The colored coins that track ownership can receive
           dividends, and therefore become valuable as would shares in
           a corporation. Owners who no longer wish to participate may
           sell their shares to untrusted strangers, and the market may
           continue to operate under their control.



NETWORK ARCHITECTURE
********************

The market consists of multiple servers operated by its owners and admins,
and a client that connects, always to at least three servers. The servers
may appear as Tor hidden services, with .onion URLs that are initially
hard-coded in the client, and subsequently updated in a marketControl
message sent over the network. The servers peer among themselves to
flood-route messages. Owners have at least two incentives to run servers:

    * If no one runs servers, then the market they own becomes worthless.

    * If all the owners who operate servers agree, then they can
      defraud all the other owners by refusing to relay their votes on
      marketControl messages.

The first incentive has a collective action problem, since an owner can
freeload and still get his benefit. The second doesn't. The owners may
also agree on extra dividend payments to owners who operate servers.

The client is a JavaScript program running in a web browser. A buyer
or seller may run this client directly from a remote server, but this
requires him to trust that server to deliver correct code every time.
The buyer or seller will preferably instead get a hash of the client
program from a trusted source, and install it on local media. When new
versions of the client become available, the download URL and hash for
that new version will be announced in the market itself, in a message
signed by the owners.

In our security model:

    * The client must not allow a malicious server to steal funds, or
      to learn secret information.

    * The client may allow a malicious server to deny or otherwise
      degrade service.

Both Tor and JavaScript cryptography are slow, and the second condition
lets us simplify the protocol in ways that mitigate that. For example,
listings may be shown sorted by the seller's reputation. The client simply
trusts that sort order, and doesn't retrieve and verify the large number
of buyer feedback messages that would be required to confirm that this
sort order is correct (but does allow the user to verify the signatures
if he selects a single particular seller explicitly).

The servers must therefore be operated by people with an incentive
to keep the market running well, like its owners. If a server becomes
malicious, then the owners can sign a new marketControl message removing
it from the list used by clients, and maybe punish its operator (e.g.,
by refusing to pay him dividends).

Multiple markets using this protocol may exist, with different sets
of owners. Listings and orders cannot meaningfully be routed across
different markets, since buyers and sellers must choose explicitly which
market admins to trust as the third signature for escrow. Feedback,
private messages (like email), and public forums (like USENET) may be
routed across markets, allowing buyers and sellers to keep identity and
reputation independent of any market owners.



USER IDENTITY
*************

A user may be a buyer, a seller, an owner, or a non-owner admin. A user
may have multiple pseudonymous identities. For example, a buyer may
generate a new identity for each order. In all cases, the identity of
a user is a set of cryptographic keys, represented in Bitcoin's usual
formats. A user publishes:

{
    'pkhId'    : '',    // for signing messages from this user, with ECDSA

    'pkCrypt'  : '',    // for encrypting messages to this user, with ECIES

    'pkBtc'    : '',    // for making payments to this user (or releasing
                        // escrow by this user), using stealth-like EC
                        // math for blockchain privacy
}

These key pairs are generated by the user locally, and kept in browser
local storage. The public keys are submitted to the network, in a
"certificate" signed by the user's pkId. Users may export and import
the secret keys as a JSON file, and should maintain backups in this form.

These keys are stored unencrypted, both in the browser and in the exported
file. This market should be run only from an operating system and browser
that is (a) installed to an encrypted volume, and (b) used for nothing
else. Tails is very suitable, but note that it does not retain browser
storage across reboots. The keys absolutely must therefore be exported
to a JSON file, and stored, for example, in Tails's encrypted persistent
storage. The exported JSON is not encrypted. Encrypting that alone would
not remove the need to run the market from an encrypted volume, since the
keys would still appear in cleartext in browser local storage, swap, etc.

The full set of keys is always stored locally (instead, for example, of
storing a single key and letting the network store encrypted copies of
the user's other information). The latter option would lose the benefit
of key rotation for the keys stored on the network.

All keys are signed traceably to a root owner's key hard-coded in
the client:

    * Any later owner's pkhId is signed by the previous owner in the
      Bitcoin transaction that transfers ownership.

    * An admin's pkhId is signed by a plurality of the owners.

    * A buyer's first pkhId is signed by an admin, based on some
      measure to prevent DoS attacks (CAPTCHA, proof-of-work, small
      payment, etc.).

    * A buyer's subsequent pkhId is signed by an admin. The buyer
      requests this new identity with a message signed by one or more of
      his previous identities. If the admin can be trusted not to keep
      logs, this permits buyers to build reputation without disclosing
      a link between their transactions. Chaum's blind signatures would
      remove the need to trust even the admins, but increase denial of
      service risk.

    * A seller's first pkhId is signed by an admin, with human intervention
      (check reputation elsewhere, require bond, etc.).

These signatures are broadcast in messages described below.



MESSAGE FORMAT
**************

All data structures are represented as JSON. A message has the form:

{
    'type'          : '',   // a string describing the message type

    'genesisTxid'   : '',   // the "genesis TXO" for the market where this
    'genesisVout'   : 0,    // message originated

    'time'          : 0,    // most recent Bitcoin block number minus ~six
    'timeHash'      : '',   // hash of corresponding block
    'timeReal'      : 0,    // actual wall clock time, Unix-style seconds

    // additional type-specific fields

    // optional, only if the message contains encrypted fields
    'cipherTo'          : [ '' ], // hash of recipient's pkId
    'cipherEphem'       : '',     // ephemeral public key for ECIES
    'cipherIv'          : '',     // IV for symmetric cipher
    'cipherPkhCrypt'    : [ '' ], // hash of recipient's pkCrypt
    'cipherSessionKey'  : [ '' ], // encrypted session key as set out below
    'cipherText'        : '',     // JSON string of message's encrypted content

    'sigFrom'   : '',     // hash of sender's pkId
    'hash'      : '',     // of JSON string of object minus hash
    'sig'       : '',     // of hash
}

The Bitcoin block number is the timestamp, and the corresponding block
hash is included as proof that the message wasn't created before the given
time. The wall clock timestamp must be approximately (within a few hours)
consistent with the Bitcoin block number, and greater than any earlier
messages that this message depends on. For example, the timestamp of a
listing must be greater than the timestamp of the message that approves
its creator to sell on the market.

An encrypted message may be readable by 1-3 recipients, for example the
buyer, seller, and escrow admin for a transaction. The sender generates
a random AES session key, a random AES IV, and a random ephemeral EC key
pair. The sender encrypts the session key using a protocol similar to
Bitmessage's ECIES, but modified for multiparty, and without a keyed MAC
(since the overall message is already signed by the sender).



USER STATE
**********

Each user maintains the following long-term state, for its keys and
certain other information:

state = {
    // All private keys are stored here, in WIF.
    'keys' : {
        'secretKeys' : {
            '' : { // key is pkhId
                'skId'      : '',
                'skCrypt'   : {
                    '' : { // key is pkhCrypt
                        'sk'      : '',
                        'created' : 0,
                    },
                },
                'skBtc'     : '',
                'created'   : 0,
            },
        },
        'primary' : '', // pkhId of identity used when sending
    },
    // A measure of how quickly each server that we've tried has responded.
    // The market admins and owners will run a small number (e.g., 10) of
    // servers. Most network operations will query three of those servers,
    // and these metrics are used to choose which three.
    'servers' : {
        '' : { // key is uri
            'goodness'      : 0, // metric used to decide which to use
            'dtAverage'     : 0, // average response time
            'receivedAt'    : 0, // last response from server received at
        },
    },
    // This is the message that determines control of the market, in the
    // form of admin keys that may be used to approve or ban users, and
    // to release escrowed funds. Owners vote for a message by signing it.
    'marketControl' : {
        // We'll try getting a new marketControl message when our current
        // one is older than some threshold, like a few hours.
        'receivedAt'    : 0,
        'votingPower'   : 0,
        'msg'           : { },
    },
    'txs' : {
        '' : '', // key is txid, value is hex transaction
    },
    // On the market, users are identified only by Bitcoin-style addresses
    // (coded hashes of public keys). To help keep track of who's who,
    // the client lets its user locally assign nicknames to addresses.
    // We don't support any global address book, since that opens up some
    // attacks (e.g., rogue admins create an account with the same nickname
    // as a trusted seller but different keys, and now have the 2/3
    // signatures necessary to steal funds from orders to their seller).
    'addressBook' : {
        '' : '', // key is pubkey hash, value is nickname
    },
    // Messages that we've already read. We may truncate this list, to
    // stop it from growing forever. If we do, then omitsBefore is set
    // to the time of the latest omitted hash's message.
    'alreadyRead' : {
        'hashes' : { '' : 0 }, // key is message hash, value is time read
        'omitsBefore' : 0,
    },
}



SERVER PROTOCOL
***************

Requests to the server are made by JSON-RPC, as a POST to /rpc:

{
    'method' : 'marketControl',
    'params': {
        'haveHash'          : '',
        'haveSignedBy'      : [ '' ],
        'haveTxids'         : [ '' ],
        'workPerShare'      : 0,
    },
}
Return the most recent valid marketControl message, along with Bitcoin
transactions sufficient to compute the ownership stakes of the users
voting on it, starting from the genesis transaction, and a Merkle path
and block headers sufficient to prove that each transaction was included
in a block with that many confirms, or that much total work.

The client may supply a hash of his current best marketControl message,
and the public key hashes of all owners who have signed it. If the
server's best marketControl is that message, with equal (or lesser)
voting power, then the server may return only the string 'have'. The
client may supply a list of txids for colored coin transactions that he
already has, and the server may omit them from its response.


{
    'method' : 'searchMsg',
    'params': {
        'type'         : '',
        'maxTime'      : 0,
        'minTime'      : 0,

        // If a message is deleted (with deleteMessage), then don't return
        // it unless deletedOk is set.
        'deletedOk'    : false,

        'hashInclude'  : [ '' ], // return only msgs with hash in list
        'hashExclude'  : [ '' ], // return only msgs with hash not in list

        'sigFrom'      : '',  // pkhId of a signer
        'cipherTo'     : '',  // pkhId of primary recipient of encrypted msg
        'cipherToAny'  : '',  // pkhId of any recipient of encrypted msg

        // for listings
        'category'     : '',
        'shipFrom'     : '',
        'shipTo'       : '',

        // for feedback
        'to'           : '',   // pkId hash

        // for comments
        'ref'          : '',

        // for requestFeePayment
        'feeFrom'      : '',
        'feeTo'        : '',

        // for approveNewIdentity
        'pkhId'        : '',

        'resultsAs'    : '',  // 'hash', 'msg', or 'listing'
        'limitResults' : 0,
        'skipResults'  : 0,
        'sortBy'       : '',  // 'timeReal', 'trust',
                              // 'votingPower', 'pull', or 'timeForum'
        'chainOfTrust' : false,
    },
}
Search for messages matching the criteria. If resultsAs is:
    'msg',      return the complete messages
    'hash',     return hashes of the messages
    'thumb'     return thumbnails for images
    'listing'   return hashes, titles, and image hashes for listings
If chainOfTrust is set, then also return approveNewIdentity and
keysForIdentity messages for all signers of returned messages.


{
    'method' : 'captcha',
    'params' : { },
}
Return a randomly-chosen CAPTCHA, and the tag to be presented with
its text.


{
    'method' : 'sendMsg',
    'params' : {
        'captchaTag'    : '',
        'captchaText'   : '',

        'msg'           : [ '' ],   // the messages to broadcast on market
    },
}
Broadcast the specified message. This is used both by clients submitting
messages and servers peering, in the latter case with captchaTag and
captchaText set to special passwords to bypass the CAPTCHA.

Multiple messages can be submitted in a single method. If a message
with type broadcastBtcTx is submitted, then msg.tx is broadcast to the
Bitcoin network, and the message isn't stored or forwarded further within
the market. Clients may use this to release escrow, with slight loss
of anonymity. (The server operator may then link the client's market
identity to a Bitcoin transaction, which should otherwise be impossible.)


{
    'method' : 'newBuyerIdentity',
    'params' : {
        'captchaTag'    : '',
        'captchaText'   : '',

        'msg'       : '',
        'sigFrom'   : [ '' ],  // other buyer identities
        'sig'       : [ '' ],  // signatures by those identities
    },
}
The buyer presents the keysForIdentity message for a new identity, and
a list of old buyer identities used by that same buyer in the past. The
message is signed by all of those old identities. The market admin
can review the old identities and assign corresponding reputation to
the buyer, and approve the new identity. This creates a new identity
with appropriate reputation and no public link to the buyer's other
transactions.


{
    'method' : 'ticker',
    'params' : { },
}
The server returns miscellaneous info, including a recent Bitcoin block
and its hash (for use in timestamps), and recent exchange rates to all
supported currencies.


{
    'method' : 'txos',
    'params' : {
        'address'   : '',
    },
}
The server returns a list of Bitcoin transaction outputs sent to the
given P2SH address. The client needs that information to make up the
transaction that releases escrow.



CONTROL OF THE MARKET
*********************

The client hard-codes a Bitcoin transaction hash and output index,
uniquely identifying a "colored" P2PKH TXO. Initially, whoever knows the
corresponding private key has total control of the market, defined as
control of a certain number (e.g., 1 000 000) of shares. When colored
UTXOs are spent, we sum the shares controlled by all colored UTXOs in
the inputs to that transaction, and subtract a fixed number (e.g., 100)
of shares. We then color all outputs with even (in satoshis) value, with
shares distributed in proportion to the value of the outputs. Uncolored
inputs to the transaction are ignored, and odd-valued outputs are
ignored. Uncolored value may be used to pay Bitcoin network fees, and
to atomically transfer shares in the market in exchange for payment
to the seller in Bitcoin (in a transaction signed by both the seller,
to spend his colored UTXOs, and the buyer, to spend normal BTC).

For example, the genesis UTXO is spent, in a transaction that pays 3 mBTC
to address A, and 1 mBTC to address B. We distribute x = (1 000 000 - 100)
shares over the outputs, so (3/(1+3))*x = 749 925 shares to address A and
(1/(1+3))*x = 249 975 shares to address B. The remaining 100 shares are
destroyed forever. This imposes a cost on trading to the traders, since
trading imposes a cost on all market users (since all users must track
changes in ownership to verify signatures of owners voting to delegate
control of the market to the managing admin).

Market servers run full Bitcoin nodes, and may therefore confirm the
validity of these transfers with near-perfect confidence. Clients must do
something lighter-weight. SPV with full block headers may be implemented
later, but the bandwidth requirements may still be unacceptable over
Tor. We currently just confirm that the transaction appears in a block
subchain on which a certain amount of work has been performed. The amount
of work is selected to make a double-transfer unprofitable given the price
and difficulty of Bitcoin, and given the valuation of the market. We could
improve that by detecting double-spends and requesting additional work
in that case, since that's expensive for the fake transaction but free
(supplied by the Bitcoin network) for the real one, or using any other
optimization of SPV.

Market owners vote by signing a message with the same public key that
could be used to spend their colored UTXO. Voting power is proportional
to the number of shares controlled. A marketControl message broadcast dt
seconds ago has voting power of

     (# of shares signing message) - (dt * voteAgingFactor)^1.5

So a message signed by more owners always supersedes an earlier one
signed by fewer owners. A message signed by fewer owners may supersede
a message signed by more owners after enough time, to compensate for
attrition if owners lose interest in voting, lose their keys, etc. The
aging factor must be set fast enough to always maintain a quorum. We
choose (k*dt)^1.5 here, but any function of time could be used. For
example, a step function would create a fixed term during which only a
more popular message can supersede the effective one.

All escrow transactions are paid to the seller (or refunded to the buyer)
in their entirety, without commission, for simplicity and best privacy
in the blockchain. Sellers may post listings only with permission of the
owners, so the admins may charge fees and ban sellers who don't pay. For
example, the admins may request payments to themselves or their employees,
and to owners as dividends. A message is provided to request that payment
in a structured way, both for the convenience of the payer and payee,
and to permit the owners to judge whether the admins are behaving unfairly
and should be replaced.



INDIVIDUAL MESSAGES
*******************

The following messages may be sent:


msg = {
    'type'          : 'marketControl',
    // ...

    // clientVersion[0] is the recommended client software version, but
    // the others are still acceptable (and won't cause an upgrade nag
    // screen)
    'clientVersion' : [ '' ],
    'clientUri'     : '',     // URI to download recommended client
    'clientHash'    : '',     // hash of recommended client software

    'newBuyerUris'  : [ '' ],    // URI to request a new account, possibly
                                 // with complicated user interface to solve
                                 // CAPTCHA, make payment, etc.

    'serverUris'    : [ '' ],

    'categories'    : [ '' ],
    'forums'        : [ '' ],

    // This is a list of admin keys used to sign other keys, and their
    // validity periods. An old key that's removed from this list is
    // revoked. This means that old adminSuper and adminNewBuyer keys must
    // be retained in this list indefinitely, or the users they approved
    // will be banned.
    'adminPkh'          : [ '' ],
    'adminValidFrom'    : [ 0 ],
    'adminValidTo'      : [ 0 ],
    'adminType'         : [ '' ], // 'adminSuper', 'adminNewBuyer'

    // These keys are valid only for as long as this marketControl message
    // is valid.
    'adminBtc'          : [ '' ],
    'adminContact'      : [ '' ], // pkhId of user to contact for service
    'adminTicker'       : [ '' ],

    // Signed by the market owners. This signature is unlike that of all
    // other messages. The message hash includes neither ownerSigFrom nor
    // ownerSig, so that owners can add votes without changing the hash.
    'ownerSigFrom'      : [ '' ],
    'ownerSig'          : [ '' ],
}
This message is voted upon by the market owners, most importantly to
authorize keys used by the market's managers, and thus delegate day to
day control of the market.


msg = {
    'type'          : 'delegateProxyVote',
    // ...

    'proxy'         : '',

    // signed by one owner
}
Allow another owner to cast votes for marketControl on the signer's behalf.
Later proxies supersede earlier proxies, so an owner may rescind his
proxy by re-delegating it to himself.


msg = {
    'type'          : 'approveNewIdentity',
    // ...

    'allowed'       : true, // false to ban previously-approved identity
    'maySell'       : true,

    'pkhId'         : '',
    'validFrom'     : 0,
    'validTo'       : 0,

    // a rate limit, for DoS mitigation
    'kbPerDay'      : 0,

    'comment'       : '',

    // signed by adminSuper, or adminNewBuyer for new buyers only
}
This authorizes a new identity to send messages to the market, by signing
the messages with the given keypair. For example:
    * A new user completes a CAPTCHA or makes a small payment, and gets a
      buyer-only account automatically.
    * A new user demonstrates that he has a good reputation on other
      markets, and gets a seller account after human review.
    * An existing buyer uses 'newBuyerIdentity' to create a new pseudonym
      for a future order, breaking any public link between the orders
      placed by the new and old pseudonyms.


msg = {
    'type'          : 'keysForIdentity',
    // ...

    'pkCrypt'       : '',
    'pkBtc'         : '',

    // signed by that identity's pkId
}
A user broadcasts this message to specify the public keys that he wishes
to use for encryption and for payment. Buyers will generally do this just
once, since their identities are used for a single order only. Sellers
should rotate encryption keys and destroy the old ones, to limit the
damage if a key is accidentally disclosed.


msg = {
    'type'          : 'publicComment',
    // ...

    'subject'       : '',
    'body'          : '',
    'ref'           : '',
    // signed by any user
}
A written comment readable by anyone. This includes:
    * User information pages, where a seller, for example, might post
      information about his general policies (with ref equal to
      'userInfo').
    * A market information page, which is the user information page for
      adminSuper[0] of the current marketControl.
    * Forum-style discussion by anyone (with ref equal to the name of
      the forum, or the hash of a comment that it responds to).


msg = {
    'type'          : 'privateComment',
    // ...

    'ref'           : '',   // hash of order message, if associated
    'state'         : '',   // like 'order received', or 'item shipped'
}
toEncrypt = {
    'subject'       : '',
    'body'          : '',
    'tx'            : '',
}
A written comment readable by only specific users. This is used:
    * For general communication, with ref blank.
    * To discuss orders, with ref equal to the order hash.

The body may optionally contain a Bitcoin transaction, either signed
by 1/3 parties to propose escrow release, or signed by 2/3 parties
to accept release.


msg = {
    'type'          : 'image',
    // ...

    'image'         : '',
    'thumb'         : '',

    // signed by a seller
}
An image, for inclusion in a listing to be created later.


msg = {
    'type'          : 'listing',
    // ...

    'subject'       : '',
    'body'          : '',
    'images'        : [ '' ],
    'category'      : '',
    'shipFrom'      : '',
    'shipTo'        : [ '' ],
    'currency'      : '',   // gbp, eur, usd, btc

    'itemPrice'     : [ 0, ],
    'itemDesc'      : [ '', ],
    'itemGroup'     : [ '' ], // 'shipping' or 'main'

    // signed by a seller
}
A description of items available for sale.


msg = {
    'type'          : 'deleteMessage',
    // ...

    'toDelete'      : '', // by its hash
    'comment'       : '',

    // signed by original message's one signer, or adminSuper
}
Delete a message, like when a seller wants to update and supersede a
listing, or when an admin wants to clean up abuse.


msg = {
    'type'          : 'placeOrder',
    // ...

    'listing'       : '',
    'subject'       : '',
    'qty'           : [ 0, ],

    'ticker'        : '',

    'pkBuyer'       : '',
    'pkSeller'      : '',
    'pkAdmin'       : '',

    // signed by buyer
}
toEncrypt = {
    'stealth'       : '',
}
Place an order, with payment in Bitcoin using 2/3 multisig. The buyer
generates a random 256-bit hex string stealth, and takes the quantity
sha256(concat(stealth, msg.hash)) as a 256-bit integer e, iterating if
necessary until 0 < e < secp256k1.n. Each party has an EC keypair Q =
d*G. For each party, we use public key Q + e*G = (d + e)*G in the script.

This is the usual stealth math, except that the secret is sent through the
market, avoiding any need for the recipient to scan the blockchain. By
making the stealth adder e depend on the order message hash, we allow
the seller to reliably assume that each order has a unique address. This
avoids the need to keep records to ensure that a malicious buyer doesn't
place two orders with the same address, and trick the seller into shipping
twice in exchange for one payment.

Exchange rates are locked when the order is placed. The buyer includes
the ticker message that he used to determine that rate, which is
timestamped and signed by a server operator.


msg = {
    'type'              : 'trust',
    'score'             : 0,
    'to'                : '',
    'order'             : '',
    'comment'           : '',

    // signed by user extending trust
}
This is the message used, for example, by a buyer and seller to provide
feedback to each other after a transaction. The signing user indicates
that he trusts the recipient (with pkhId to) by the given score, where
a score of +1 corresponds to a single entirely successful transaction.

The market admins may use this message to compute a trust metric for each
user, which they may use, for example, as the sort order when returning
listings, or as one factor in resolving escrow release disputes. The
exact algorithm used would likely be kept secret and changed frequently,
for the same reasons that search engines frequently change their ranking
algorithms in response to SEO tactics. It would probably use eigenvector
centrality concepts, perhaps with certain sellers seeded manually by
the admins.


msg = {
    'type'              : 'requestFeePayment',
    // ...

    'feeFrom'           : [ '' ],
    'feeTo'             : [ '' ],
    'feeAmount'         : [ 0 ],

    'comment'           : '',

    // signed by adminSuper
}
This requests payment in the specified amounts, like from sellers to the
owners. The amount may be negative, for example to adjust a mistake in
a previous requestFeePayment message. The admins should broadcast large
requestFeePayment messages with payments grouped such that each sender
pays as few recipients as possible, but the result summed over the group
is obviously fair (e.g., every owner is paid in proportion to his stake).


msg = {
    'type'          : 'paidFee',
    // ...

    'pkBtc'         : '',
    'request'       : '', // hash of requestFeePayment
    'feeAmount'     : 0,
}
toEncrypt = {
    'stealth'       : '',
}
Inform a recipient (typically an owner) that you've paid a fee to him,
and tell him the stealth EC adder necessary to recover the payment. If
a user issues this message fraudulently, then the recipient can decrypt
this message for the admins, who can confirm this in the blockchain and
take appropriate action (e.g., get someone else to pay that recipient,
and ban the seller).


msg = {
    'type'          : 'ticker',
    'currencies'    : [ '' ], // EUR, USD, etc.
    'exchangeRates' : [ 0 ],

    // signed by adminTicker
}
This message is broadcast by the market operators to inform its users of
frequently-changing information, like exchange rates. Sellers may post
listings in other currencies, and allow buyers to lock the exchange rate
from Bitcoin to that currency by showing a ticker message with timestamp
within some range (e.g., an hour) of payment time.

This message is also used by anyone sending new messages to the market
to get the wall clock time, Bitcoin blockchain height, and recent block
hash required to fill the timestamp for his new message.


