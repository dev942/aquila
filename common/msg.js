
if((typeof module) === 'object') {
    cutil = require('./cutil.js');
    conf  = require('../server/conf.js');
}

msg = { };

msg.notYetSigned = '000000000000000000000000000000000000000000000000';

// Take an arbitrary object. If it matches the format of a message, then
// return that, with the properties in standardized order. Otherwise,
// return.
msg.fromUntrusted = function(msgIn, howHash) {
    var ck = cutil.checker;

    var formatCheck = {
        'ticker' : {
            'currencies'        : ck.array(ck.stringMaxLen(3)),
            'exchangeRates'     : ck.array(ck.number),
        },
        'marketControl' : {
            'clientVersion'     : ck.array(ck.string),
            'clientUri'         : ck.uri,
            'clientHash'        : ck.hex256b,
            'newBuyerUris'      : ck.array(ck.uri),
            'serverUris'        : ck.array(ck.uri),
            'categories'        : ck.array(ck.string),
            'forums'            : ck.array(ck.string),
            'adminPkh'          : ck.array(ck.btcAddr),
            'adminValidFrom'    : ck.array(ck.integer),
            'adminValidTo'      : ck.array(ck.integer),
            'adminType'         : ck.array(ck.stringEnum( [ 'adminNewBuyer',
                                                            'adminSuper' ])),
            'adminBtc'          : ck.array(ck.btcPubKey),
            'adminContact'      : ck.array(ck.btcAddr),
            'adminTicker'       : ck.array(ck.btcAddr),
        },
        'delegateProxyVote' : {
            'proxy'             : ck.btcAddr,
        },
        'approveNewIdentity' : {
            'allowed'           : ck.bool,
            'maySell'           : ck.bool,
            'pkhId'             : ck.btcAddr,
            'validFrom'         : ck.integer,
            'validTo'           : ck.integer,
            'kbPerDay'          : ck.integer,
            'comment'           : ck.string,
        },
        'keysForIdentity' : {
            'pkCrypt'           : ck.btcPubKey,
            'pkBtc'             : ck.btcPubKey,
        },
        'publicComment' : {
            'subject'           : ck.string,
            'body'              : ck.stringMaxLen(40*1000),
            'ref'               : ck.string,
        },
        'privateComment' : {
            'cipherText'        : ck.cipherText,
            'ref'               : ck.string,
            'state'             : ck.string,
        },
        'image' : {
            'image'             : ck.imageDataUrl,
            'thumb'             : ck.imageDataUrl,
        },
        'listing' : {
            'subject'           : ck.string,
            'body'              : ck.stringMaxLen(30*1000),
            'images'            : ck.array(ck.hex256b),
            'category'          : ck.string,
            'shipFrom'          : ck.array(ck.stringMaxLen(2)),
            'shipTo'            : ck.array(ck.stringMaxLen(2)),
            'currency'          : ck.stringMaxLen(3),
            'itemPrice'         : ck.array(ck.number),
            'itemDesc'          : ck.array(ck.string),
            'itemGroup'         : ck.array(ck.stringEnum([ 'main',
                                                           'shipping' ])),
        },
        'deleteMessage' : {
            'toDelete'          : ck.hex256b,
            'comment'           : ck.string,
        },
        'placeOrder' : {
            'cipherText'        : ck.cipherText,
            'listing'           : ck.hex256b,
            'subject'           : ck.string,
            'qty'               : ck.array(ck.integer),
            'ticker'            : ck.stringMaxLen(1000),
            'pkBuyer'           : ck.btcPubKey,
            'pkSeller'          : ck.btcPubKey,
            'pkAdmin'           : ck.btcPubKey,
        },
        'trust' : {
            'score'             : ck.number,
            'to'                : ck.btcAddr,
            'order'             : ck.hex256b,
            'comment'           : ck.stringMaxLen(100),
        },
        'requestFeePayment' : {
            'feeFrom'           : ck.array(ck.btcAddr),
            'feeTo'             : ck.array(ck.btcAddr),
            'feeAmount'         : ck.array(ck.number),
            'comment'           : ck.string,
        },
        'paidFee' : {
            'cipherText'        : ck.cipherText,
            'pkBtc'             : ck.btcPubKey,
            'request'           : ck.hex256b,
            'feeAmount'         : ck.number,
        },
    };
    for(var type in formatCheck) {
        // This relies on Object properties getting kept in order,
        // nonstandard but reliable in node and Firefox.
        var fco = { }, fci = formatCheck[type];
        fco.type        = ck.string;
        fco.genesisTxid = ck.hex256b;
        fco.genesisVout = ck.integer;
        fco.time        = ck.integer;
        fco.timeHash    = ck.hex256b;
        fco.timeReal    = ck.integer;
        for(var p in fci) {
            fco[p] = fci[p];
            if(p === 'cipherText') {
                fco.cipherTo         = ck.array(ck.btcAddr);
                fco.cipherEphem      = ck.btcPubKey;
                fco.cipherIv         = ck.hex128b;
                fco.cipherPkhCrypt   = ck.array(ck.btcAddr);
                fco.cipherSessionKey = ck.array(ck.hex256b);
            }
        }
        if(type !== 'marketControl') {
            fco.sigFrom = ck.btcAddr;
        }
        formatCheck[type] = fco;
    }

    if(!msgIn) throw 'msg is null';
    if((typeof msgIn) !== 'object') throw 'msg not object';

    // Check that the message has a valid type, and get that type's format
    if((typeof msgIn.type) !== 'string') throw 'msg.type not string';
    var fc = formatCheck[msgIn.type];
    if(!fc) throw 'msg.type not recognized';

    // And check the message against that format
    var msgOut = ck.check(msgIn, fc);
    if(!msgOut) throw 'msg format check failed';

    // Check that message is intended for this market, may be broadened
    // to permit some cross-market routing later (e.g., 'trust').
    if((msgIn.genesisTxid !== conf.genesisTxo[0][0]) ||
       (msgIn.genesisVout !== conf.genesisTxo[0][1]))
    {
        throw 'not for this market, wrong genesis TXO';
    }

    // Check consistency of arrays that should have the same length
    if(fc.cipherText) {
        if(!(msgIn.cipherTo.length === msgIn.cipherPkhCrypt.length) &&
            (msgIn.cipherTo.length === msgIn.cipherSessionKey.length))
        {
            throw 'cipherXXX lengths should match';
        }
        if(!(msgIn.cipherTo.length >= 1 && msgIn.cipherTo.length <= 3)) {
            throw 'cipherXXX length should be 1, 2, or 3';
        }
    }
    switch(msgOut.type) {
        case 'ticker':
            if(!(msgIn.currencies.length === msgIn.exchangeRates.length)) {
                throw 'currencies and exchangeRates lengths should match';
            }
            break;

        case 'marketControl':
            if(!((msgIn.adminPkh.length === msgIn.adminValidFrom.length) &&
                 (msgIn.adminPkh.length === msgIn.adminValidTo.length) &&
                 (msgIn.adminPkh.length === msgIn.adminType.length)))
            {
                throw 'adminXXX lengths should match';
            }
            if(msgIn.adminPkh.length < 1) {
                throw 'adminPkh length must be at least one';
            }
            if(msgIn.adminType[0] != 'adminSuper') {
                throw 'adminType[0] must be adminSuper';
            }
            if(msgIn.adminContact.length < 1) {
                throw 'adminContact length must be at least one';
            }
            if(msgIn.adminBtc.length < 1) {
                throw 'adminBtc length must be at least one';
            }
            if(msgIn.adminTicker.length < 1) {
                throw 'adminTicker length must be at least one';
            }
            break;

        case 'listing':
            if(!((msgIn.itemPrice.length === msgIn.itemDesc.length) &&
                 (msgIn.itemPrice.length === msgIn.itemGroup.length)))
            {
                throw 'itemXXX lengths should match';
            }
            break;

        case 'requestFeePayment':
            if(!((msgIn.feeFrom.length === msgIn.feeTo.length) &&
                 (msgIn.feeFrom.length === msgIn.feeAmount.length)))
            {
                throw 'feeXXX lengths should match';
            }
            break;
    }

    // And now we can compute the hash
    var hashOut = cutil.sha256(JSON.stringify(msgOut)).toString('hex');
    if(howHash === 'compute') {
        msgOut.hash = hashOut;
    } else if(howHash === 'check') {
        if(msgIn.hash === hashOut) {
            msgOut.hash = hashOut;
        } else {
            throw 'msg.hash is incorrect';
        }
    } else {
        throw 'bad howHash, compute or check';
    }

    // And finally check the format of the unhashed signatures
    if(msgOut.type === 'marketControl') {
        if((ck.array(ck.btcAddr))(msgIn.ownerSigFrom) &&
           (ck.array(ck.btcSignature))(msgIn.ownerSig) &&
           (msgIn.ownerSigFrom.length === msgIn.ownerSig.length))
        {
            msgOut.ownerSigFrom = msgIn.ownerSigFrom;
            msgOut.ownerSig     = msgIn.ownerSig;
        } else {
            throw 'ownerSigXXX format wrong';
        }
    } else {
        if(ck.btcSignature(msgIn.sig)) {
            msgOut.sig = msgIn.sig;
        } else {
            throw 'msg.sig format wrong';
        }
    }

    return msgOut;
};

/**
 * Fill the timestamps in a message, with our real time plus a recent
 * Bitcoin bluck number and hash (used to prove a message was created
 * after a given time).
 */
msg.fillTime = function(msg) {
    msg.genesisTxid = conf.genesisTxo[0][0];
    msg.genesisVout = conf.genesisTxo[0][1];

    var ticker = aq.getStorage('ticker');
    msg.time     = ticker.time;
    msg.timeHash = ticker.timeHash;
    msg.timeReal = getUnixTime();
};

/**
 * Fill one signature, using the secret key from local storage.
 */
msg.fillOneSignature = function(pkh, hash) {
    var sk = aq.getStorage('keys').secretKeys;
    if(!(pkh in sk)) throw 'no secret key for ' + pkh;

    var ecpId = bitcoin.ECPair.fromWIF(sk[pkh].skId, conf.btcNet),
        sig = bitcoin.message.sign(ecpId, hash, conf.btcNet);
    return sig.toString('base64');
};

/**
 * Fill the signatures in a message, either sig based on the sigFrom or
 * ownerSig based on the ownerSigFrom.
 */
msg.fillSignatures = function(m) {
    if(m.type === 'marketControl') {
        if(m.ownerSigFrom.length !== m.ownerSig.length) throw 'lengths bad';

        for(var i = 0; i < m.ownerSigFrom.length; i++) {
            // marketControl messages will often come with other people's
            // signatures already present, so just ignore them
            if(m.ownerSig[i] !== msg.notYetSigned) continue;
            m.ownerSig[i] = msg.fillOneSignature(m.ownerSigFrom[i], m.hash);
        }
    } else {
        if(m.sig !== msg.notYetSigned) throw 'missing placeholder';
        m.sig = msg.fillOneSignature(m.sigFrom, m.hash);
    }
};

/**
 * The message m should be signed with an admin key, and mc is the
 * effective marketControl message. This checks whether the key signing
 * m is actually an admin key, and actually has the power to sign that
 * message.
 */
msg.signedWithAuthorizedAdminKey = function(m, mc) {
    var i;
    for(i = 0; i < mc.adminPkh.length; i++) {
        if(mc.adminPkh[i] === m.sigFrom) break;
    }
    if(i >= mc.adminPkh.length) {
        // The key used to sign our message isn't any kind of valid admin
        // key, definitely no authority.
        return false;
    }
    if((m.timeReal < mc.adminValidFrom[i]) ||
       (m.timeReal > mc.adminValidTo[i]))
    {
        // The message lies outside the validity period of the admin key.
        return false;
    }
    if((mc.adminType[i] === 'adminNewBuyer') &&
      !((m.type === 'approveNewIdentity') && (m.maySell === false)))
    {
        // adminNewBuyer is good for new buyers only
        return false;
    }
    switch(m.type) {
        case 'approveNewIdentity':
        case 'keysForIdentity':
        case 'publicComment': // for market info
        case 'trust': // for seeding trust
        case 'deleteMessage':
        case 'requestFeePayment':
            return true;
    }
    return false;
};

/**
 * The voting power of a marketControl message, equal to the number of
 * shares held by owners who signed it minus its age times a constant.
 */
msg.marketControlVotingPower = function(mc, t, agingFactor,
                                                    owners, delegates)
{
    if(mc.type !== 'marketControl') return -1e10;
    if(mc.adminValidTo[0] < t) return -1e10;

    var votingPower = 0, alreadySignedBy = { };
    for(var i = 0; i < mc.ownerSig.length; i++) {
        var os  = mc.ownerSig[i],
            osf = mc.ownerSigFrom[i];

        var voters = [ osf ];
        if(osf in delegates) {
            voters = voters.concat(delegates[osf]);
        }
        voters.forEach(function(voter) {
            if((!alreadySignedBy[voter]) && (voter in owners)) {
                votingPower += owners[voter];
                alreadySignedBy[voter] = true;
            }
        });
    }

    var dt = t - mc.timeReal;
    if(dt < 0) dt = 0;
    var aging = Math.pow(dt*agingFactor, 1.5);

    return { 'aged'   : Math.floor(votingPower - aging),
             'unaged' : votingPower, };
};

/**
 * Encrypt toEncrypt with the provided public keys, and then write that
 * to the message m in our standard format.
 */
msg.fillCiphered = function(m, toEncrypt, pks) {
    var tes = JSON.stringify(toEncrypt),
        ee = ecMath.encrypt(tes, pks), p;
    for(p in ee) {
        m[p] = ee[p];
    }
};

/**
 * Decrypt the encrypted payload of message m with the provided secret
 * keys, or throw an exception if something's wrong (missing key, bad
 * format).
 */
msg.extractCiphered = function(m, sk) {
    var i;
    for(i = 0; i < m.cipherTo.length; i++) {
        if(m.cipherTo[i] in sk) break;
    }
    if(i >= m.cipherTo.length) throw 'to unknown pkhId';
    sk = sk[m.cipherTo[i]].skCrypt;

    if(!(m.cipherPkhCrypt[i] in sk)) throw 'to unknown pkhCrypt';
    sk = sk[m.cipherPkhCrypt[i]].sk;

    var dc = ecMath.decrypt(m, sk),
        json = dc.text,
        teIn = JSON.parse(json);

    var ck = cutil.checker;
    var fc = {
        'privateComment' : {
            'subject'       : ck.string,
            'body'          : ck.stringMaxLen(40*1000),
            'tx'            : ck.optional(ck.btcTx),
        },
        'placeOrder' : {
            'stealth'       : ck.hex256b,
        },
        'paidFee' : {
            'stealth'       : ck.hex256b,
        },
    };
    if(!(m.type in fc)) throw 'unknown message type';
    var te = ck.check(teIn, fc[m.type]);
    if(!te) throw 'check failed';
    te._aesKey = dc.aesKey;
    return te;
};

/**
 * Decrypt a privateComment, and fill the message with either the result
 * or a human-readable error.
 */
msg.extractCipheredPrivateComment = function(m) {
    var s = '', b = '', tx;
    try {
        var sk = aq.getStorage('keys').secretKeys;
            te = msg.extractCiphered(m, sk);
        s = te.subject;
        b = te.body;
        tx = te.tx;
    } catch(e) {
        s = '<only recipient can decrypt this, not you>';
    }
    m.subject = s;
    m.body = b;
    if(tx) m.tx = tx;
};

if((typeof module) === 'object') module.exports = msg;

