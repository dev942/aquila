
var confTest = {
    'version'                       : '0.1',
    'network'                       : 'TESTNET',

    // Time begins at the block number, nothing earlier considered.
    'block0'                        : 702000,
    'block0Hash'                    :
            '00000000000088687174912347c38e879d8d559679aef56eac8e053efb77a3e5',

    // The colored TXOs that initially control our entire market. When
    // they're spent, control passes according to certain rules to the outputs
    // of the transaction that spends it.
    'genesisTxo' : [
        // txid, vout, shares
        [ 'da921b15c9fcfddc53cf2810e491239f81a4c7aaf119881a8296fff735836121',
           0,
           1000000 ],
    ],
    // The number of shares destroyed per transfer.
    'destroyPerTransfer'            : 500,
    // The rate at which marketControl message voting strength weakens. So:
    //    after   1 day :      470 shares =  0.05% lost
    //           10 days:    14874 shares =  1.49% 
    //          100 days:   470346 shares = 47.03%
    'voteAgingFactor'               : 0.0007,

    // For a transaction that transfers k shares of the market, the client
    // must see proof-of-work that would require an expected value of
    // k*workPerShare attempts. This should be chosen to make a double-spend
    // unprofitable at current Bitcoin difficulty, block reward, and price,
    // and at current market valuation (i.e., it should be more profitable
    // to spend that work mining BTC than forging a colored coin transfer).
    'workPerShare'                  : 1e9,

    // If our marketControl message is older than this threshold, then
    // we check to see if it's changed.
    'marketControlCheckInterval'    : 2*60*60,

    // If our ticker result is older than this threshold, then we get a new
    // one. This is where exchange rates, a recent block hash for a timestamp,
    // etc. are retrieved.
    'tickerInterval'                : 10*60,

    'serverUris'    : [
        'http://aqla3nr4g3kxr2wm.onion',
        'http://aqla6wqpnyplun5z.onion',
        'http://aqla5tj5a4zjnhun.onion',
    ],
    'serverTimeout'                 : 15*1000,

    'btcExplorer'   : 'https://test-insight.bitpay.com/address/',
    'btcNet'        : bitcoin.networks.testnet,

    // When viewing forum posts, private messages, orders, etc., the number
    // of messages per page to show.
    'msgsPerPage'       : 10,
    'postsPerPage'      : 10,
    'listingsPerPage'   : 25,
    'ordersPerPage'     : 10,
    'trustsPerPage'     : 25,
};
var conf = confTest;

