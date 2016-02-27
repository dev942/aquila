var bitcoin = require('bitcoinjs-lib');

module.exports = {
    // A list of our peers. All peering is manually configured. We push new
    // messages to our peers, and periodically poll our peers to ensure that
    // we're not missing anything. Peering should generally be reciprocal,
    // but that must be set up explicitly on both ends.
    //
    // The list of peers includes passwords that we use to bypass the
    // CAPTCHA when pushing messages to the other peer.
    'peers' : [
        [ 'http://', 'pass' ],
    ],

    // Passwords to bypass the CAPTCHA when other servers push to us
    'allowBypassCaptcha' : {
        'http://' : 'pass',
    },

    // The port where we run our http server.
    'listenOn'      : 8080,

    // Name of MongoDB database, generally arbitrary. Server is hard-coded
    // as localhost.
    'db'            : 'aquila',

    // The server URI in the marketControl message that we send before one
    // exists in the database, need something valid there to bootstrap.
    'myServerUri'   : '',

    // A server running bitcoind. This is used to track the colored UTXOs
    // that determine control of the market, and to make and broadcast
    // transactions in normal uncolored Bitcoin on the market.
    'bitcoindHost'  : 'localhost',
    'bitcoindPort'  : 18332,
    'bitcoindUser'  : 'bitcoinrpc',
    'bitcoindPass'  : '',

    // The socks5 proxy used when we get exchange rates (e.g., a local
    // proxy that does nothing, since those are from clearnet).
    'socksPortExchange' : 9051,
    'socksHostExchange' : '127.0.0.1',
    // The socks5 proxy used when we exchange messages with our peers
    // (e.g., Tor).
    'socksPortPeer'     : 9050,
    'socksHostPeer'     : '127.0.0.1',

    // Timeout when communicating with peers
    'serverTimeout'     : 20*1000,

    // All servers can provide a signed exchange rate lock, and other
    // similar frequently-changing information
    'adminTicker' : '',

    // If this server allows users to create new buyer accounts, then this
    // is the adminNewBuyer key for signing the approveNewIdentity message
    // thus created.
    'adminNewBuyer' : '',
    // New accounts become valid slightly in the past, tolerate clock skew
    'adminNewBuyerValidFrom' : (-24*60*60),
    // And are valid for a year
    'adminNewBuyerValidTo'   : (1*365*24*60*60),
    // Initial quota of 100 kB per day to the market maximum
    'adminNewBuyerKbPerDay'  : 100,


    // See client conf.js for comments on common properties. These must
    // agree with the client.

    'block0'       : 702000,
    'block0Hash'   :
'00000000000088687174912347c38e879d8d559679aef56eac8e053efb77a3e5',

    'genesisTxo'   : [
        [ 'da921b15c9fcfddc53cf2810e491239f81a4c7aaf119881a8296fff735836121',
           0,
           1000000 ],
    ],
    'destroyPerTransfer' : 500,
    'voteAgingFactor'    : 0.0007,
    'workPerShare'       : 1e9,

    'btcNet'             : bitcoin.networks.testnet,
};

// For testing, while running multiple instances of the server on one machine
if(process.env.FORCE_DB)
    module.exports.db = process.env.FORCE_DB;
if(process.env.FORCE_LISTEN_ON)
    module.exports.listenOn = process.env.FORCE_LISTEN_ON;
if(process.env.FORCE_MY_SERVER_URI)
    module.exports.myServerUri = process.env.FORCE_MY_SERVER_URI;

