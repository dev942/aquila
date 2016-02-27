
var MongoClient = require('mongodb').MongoClient,
    crypto      = require('crypto'),
    conf        = require('./conf.js'),
    bitcoin     = require('bitcoinjs-lib'),
    secp256k1   = require('secp256k1');

var util = { };

util.dbConnect = function(db, f) {
    var url = 'mongodb://localhost:27017/' + db;
    MongoClient.connect(url, function(err, db) {
        if(err) throw 'no db connection';
        f(db);
    });
};

util.randomInteger = function(n) {
    var buf = crypto.randomBytes(3);
    var rnd = 0;
    for(var i = 0; i < 3; i++) {
        rnd <<= 8;
        rnd += buf[i];
    }
    rnd = Math.floor(rnd * (n / Math.pow(2, 24)));
    return rnd;
};

function randomFromSet(chars, len) {
    var str = '';
    for(var i = 0; i < len; i++) {
        str = str + chars[util.randomInteger(chars.length)];
    }
    return str;
};
util.randomChars = function(len) {
    return randomFromSet('abcdefghijklmnopqrstuvwxyz' +
                         'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
                         '0123456789', len);
};
util.randomDigits = function(len) {
    return randomFromSet('0123456789', len);
};

util.getUnixTime = function() {
    return Math.floor(Date.now() / 1e3);
};

/**
 * Remove any object properties beginning with an underscore. We use those
 * in the database for sort orders and stuff, not useful to send to the
 * client since it can't trust them anyways.
 */
util.removeInternalProperties = function(m) {
    var p;
    for(p in m) {
        if(p.match(/^_/)) delete m[p];
    }
};

/**
 * Send a message that we've already confirmed is valid. We store it in
 * our own database, and queue it up to be broadcast to all of our peers.
 */
util.storeAndForwardMsg = function(db, m, cb) {
    var cm = db.collection('msgs');

    cb = (cb || util.forwardMsg);

    // Cache timestamps for the children of parent forum postings, so that
    // we can sort by "timestamp of youngest child".
    m._timeForum = m.timeReal;
    if(m.type === 'publicComment') {
        cm.update({ 'hash' : m.ref },
                  { '$set' : { '_timeForum' : m.timeReal } },
                  function(e, r) { });
    }
    // Truncated hash, more compact when collision-resistance matters but
    // security doesn't.
    m._hash64 = m.hash.substr(0, 16);
    // Message size, for rate limits
    m._size = Buffer.byteLength(JSON.stringify(m));

    // Do we already have this message?
    cm.findOne({ 'hash' : m.hash }, function(e, r) {
        if(!r) {
            // This is a new message, easy, insert and we're done
            cm.insertMany([ m ], function(e, r) {
                cb(db, m);
            });
            if(m.type === 'deleteMessage') {
                // Actually delete the target. Our caller should already
                // have checked that the signer is authorized.
                cm.findOne({ 'hash' : m.toDelete }, function(e, r) {
                    if(!r) return;
                    cm.update({ 'hash' : m.toDelete, },
                              { '$set' : { '_deletedBy' : m.hash } },
                    function(e, r) { });
                });
            }
        } else if(r && m.type === 'marketControl') {
            // This is a marketControl message, possibly with a different
            // set of signatures though
            var sigs = { }, i;
            for(i = 0; i < r.ownerSig.length; i++) {
                sigs[r.ownerSigFrom[i]] = r.ownerSig[i];
            }
            var newSig = false;
            for(i = 0; i < m.ownerSig.length; i++) {
                if(!(m.ownerSigFrom[i] in sigs)) {
                    sigs[m.ownerSigFrom[i]] = m.ownerSig[i];
                    newSig = true;
                }
            }
            if(newSig) {
                // The new message has at least one new signature, so
                // update our database with the superset of the signatures
                m.ownerSigFrom = [ ];
                m.ownerSig = [ ];
                var pkh;
                for(pkh in sigs) {
                    m.ownerSigFrom.push(pkh);
                    m.ownerSig.push(sigs[pkh]);
                }
                cm.update({ 'hash' : m.hash },
                          { '$set' : { 'ownerSigFrom' : m.ownerSigFrom,
                                       'ownerSig'     : m.ownerSig } },
                function(e, r) {
                    cb(db, m);
                });
            }
        }
    });
};

/**
 * Enqueue a message to be forwarded to any peers that we haven't already
 * received it from.
 */
util.forwardMsg = function(db, m) {
    // See if we've already received the message from any other peer.
    var cr = db.collection('msgReceived');
    cr.find({ 'hash' : m.hash }).toArray(function(e, r) {
        // If we did, then don't forward it back to them.
        var dontSendTo = { };
        r.forEach(function(mr) {
            dontSendTo[mr.fromPeer] = true;
        });
        dontSendTo[conf.myServerUri] = true;
        // But do enqueue the message to be forwarded to the others, by
        // writing to a collection in the database that another process
        // polls.
        var toSend = [ ];
        conf.peers.forEach(function(peerAndPass) {
            var peer = peerAndPass[0];
            if(!dontSendTo[peer]) {
                toSend.push({ 'time'   : m.timeReal,
                              'hash'   : m.hash,
                              'type'   : m.type,
                              'toPeer' : peer,
                              'state'  : 'new', });
            }
        });
        if(toSend.length > 0) {
            var cs = db.collection('msgToSend');
            cs.insertMany(toSend, function(e, r) { });
        }
    });
};

/**
 * Check a Bitcoin message signature, using the native code crypto for speed.
 */
util.verifySignature = function(addr, sig, m) {
    try {
        sig = new Buffer(sig, 'base64');
        var parsed = bitcoin.ECSignature.parseCompact(sig),
            hash = bitcoin.message.magicHash(m, conf.btcNet);

        // skip the flag byte with recovery params etc. to get raw signature
        var rk = secp256k1.recover(hash, sig.slice(1),
                                                parsed.i, parsed.compressed);

        var pkh = bitcoin.crypto.hash160(rk);
        var ad2 = bitcoin.address.toBase58Check(pkh, conf.btcNet.pubKeyHash);
        return (ad2 === addr);
    } catch(e) {
        return false;
    }
};

/**
 * Confirm that an incoming message, from its JSON string, is well-formed,
 * and correctly signed. Returns the message if yes, throws an exception if
 * no. This function doesn't check the timestamp, and doesn't check that
 * the signer is authorized, just that its signature is valid.
 */
util.msgFromStringAndCheckSignatures = function(str) {
    var m = JSON.parse(str);
    m = msg.fromUntrusted(m, 'check');

    if(m.type === 'marketControl') {
        for(var i = 0; i < m.ownerSigFrom.length; i++) {
            var sf = m.ownerSigFrom[i],
                s  = m.ownerSig[i];
            if(!util.verifySignature(sf, s, m.hash)) {
                throw 'bad signature';
            }
        }
    } else {
        if(!util.verifySignature(m.sigFrom, m.sig, m.hash)) {
            throw 'bad signature';
        }
    }

    return m;
};

/**
 * Check whether a message's timestamp is valid: block hash correct, and
 * block time consistent with real time.
 */
util.checkMsgTimestamp = function(db, m, mustBeRecent, cb) {
    var c = db.collection('btcScanned');
    c.findOne({ 'blockNumber' : m.time }, function(e, r) {
        if(r && (r.blockHash === m.timeHash) &&
            Math.abs(r.blockTime - m.timeReal) < (12*60*60) &&
            (Math.abs(m.timeReal - util.getUnixTime()) < (12*60*60) ||
                (!mustBeRecent)))
        {
            cb(true);
        } else {
            cb(false);
        }
    });
};

/**
 * Check if a non-owner user is authorized to submit a message to the
 * market, by getting their approveNewIdentity message, and confirming
 * that they're a seller if necessary, their account is currently allowed,
 * and they're within quota.
 */
util.checkValidNormalUser = function(db, m, mc, mustBeSeller, cb) {
    var cmsgs = db.collection('msgs');
    cmsgs.findOne({
        'type'  : 'approveNewIdentity',
        'pkhId' : m.sigFrom,
    }, null, {
        'sort' : { 'timeReal' : -1 },
    }, function(e, ani) {
        if(ani && msg.signedWithAuthorizedAdminKey(ani, mc) &&
            ((!mustBeSeller) || ani.maySell) &&
            ani.allowed &&
            (m.timeReal >= ani.validFrom) &&
            (m.timeReal <= ani.validTo))
        {
            // Looks good. The final check is our rate limit,
            // that the sender is within his quota of kB per
            // day to the market.
            var t = util.getUnixTime() - 24*60*60;
            var csr = cmsgs.find({
                'sigFrom'   : m.sigFrom,
                'timeReal'  : { '$gte' : t }
            });
            var total = 0;
            csr.each(function(e, r) {
                if(r) {
                    total += (r._size | 0);
                    // some constant overhead per message too
                    // seems like a reasonable model for actual
                    // cost of handling user
                    total += 4*1000;
                } else {
                    cb(total < (ani.kbPerDay*1000));
                }
            });
        } else {
            cb(false);
        }
    });
};

/**
 * Check that a placeOrder message is consistent with the listing.
 */
util.checkOrderIsToSeller = function(db, m, mc, cb) {
    var cmsgs = db.collection('msgs');
    cmsgs.findOne({
        'hash' : m.listing,
    }, function(e, listing) {
        if(!(listing &&
             (listing.type === 'listing') &&
             (listing.sigFrom === m.cipherTo[0]) &&
             (listing.itemGroup.length === m.qty.length)))
        {
            cb(false);
            return;
        }
        util.checkValidNormalUser(db, m, mc, false, cb);
    });
};

/**
 * Check that a trust message is consistent with a referenced order, and
 * that no message from and to the same users already exists.
 */
util.checkTrustOrderValid = function(db, m, mc, cb) {
    var cmsgs = db.collection('msgs');
    cmsgs.findOne({
        'hash' : m.order,
    }, function(e, po) {
        cmsgs.findOne({
            'type'       : 'trust',
            'to'         : m.to,
            'sigFrom'    : m.sigFrom,
            '_deletedBy' : { '$exists' : false },
        }, function(e, existingTrust) {
            if(!(!existingTrust && po &&
                 (po.type === 'placeOrder') &&
                 (((po.sigFrom === m.sigFrom) &&
                   (po.cipherTo[0] === m.to)) ||
                  ((po.sigFrom === m.to) &&
                   (po.cipherTo[0] === m.sigFrom))) &&
                 (m.score <=  1000) &&
                 (m.score >= -1000)))
            {
                cb(false);
                return;
            }
            util.checkValidNormalUser(db, m, mc, false, cb);
        });
    });
};

/**
 * Check that a privateComment message, if it references an order, is
 * consistent with the order.
 */
util.checkPrivateCommentForOrder = function(db, m, mc, cb) {
    if(!m.ref) {
        util.checkValidNormalUser(db, m, mc, false, cb);
        return;
    }
    var cmsgs = db.collection('msgs');
    cmsgs.findOne({
        'hash' : m.ref,
    }, function(e, po) {
        // Allow if order isn't yet submitted, since client submits both
        // in same method call, should fix later
        if(!((!po) || (po &&
             (po.type === 'placeOrder') &&
             ((m.sigFrom === po.sigFrom) ||
              (m.sigFrom === po.cipherTo[0])) &&
             ((m.cipherTo[0] === po.sigFrom) ||
              (m.cipherTo[0] === po.cipherTo[0])) &&
             (m.cipherTo[0] !== m.sigFrom))))
        {
            cb(false);
            return;
        }
        util.checkValidNormalUser(db, m, mc, false, cb);
    });
};

/**
 * Are the identities that signed this message appropriate (e.g., has the
 * signer of a listing appeared in an approveNewIdentity message with
 * maySell === true)? This doesn't check the signatures themselves, just
 * the authority of the purported signers.
 */
util.checkSignerAuthority = function(db, m, cb) {
    // All authority traces back to marketControl or the owners, so get
    // that cached stuff from the database.
    var cmc = db.collection('marketControl');
    cmc.findOne({ }, function(e, r) {
        var mc = r.marketControl, owners = r.owners;

        // deleteMessage is an ugly special case, since who's authorized
        // to send it depends on the message deleted
        if(m.type === 'deleteMessage') {
            var cmsgs = db.collection('msgs');
            cmsgs.findOne({ 'hash' : m.toDelete }, function(e, r) {
                cb(function() {
                    // Not meaningful to delete a nonexistent message
                    if(!r) return false;
                    // Restrict what types of messages can be deleted. Most
                    // wouldn't hurt, but delete e.g. on marketControl would
                    // let existing admins hold on to power forever.
                    switch(r.type) {
                        case 'image':
                        case 'listing':
                        case 'trust':
                            // May be deleted by creator or adminSuper
                            return msg.signedWithAuthorizedAdminKey(m, mc) ||
                                   (m.sigFrom === r.sigFrom);
                        case 'privateComment':
                        case 'publicComment':
                        case 'placeOrder':
                        case 'trust':
                            // By adminSuper only
                            return msg.signedWithAuthorizedAdminKey(m, mc);
                        default:
                            return false;
                    }
                }());
            });
            return;
        }

        // First, see if the message is signed by a key authorized directly
        // in our marketControl message.
        if(msg.signedWithAuthorizedAdminKey(m, mc)) {
            cb(true);
            return;
        }

        // If not, then it might still be authorized indirectly
        var mustBeSeller = false;
        switch(m.type) {
            case 'image':
            case 'listing':
                mustBeSeller = true;
                // fall through
            case 'keysForIdentity':
            case 'publicComment':
            case 'paidFee':
                util.checkValidNormalUser(db, m, mc, mustBeSeller, cb);
                break;

            case 'privateComment':
                // A comment on an order must be sent by the buyer or seller
                util.checkPrivateCommentForOrder(db, m, mc, cb);
                break;

            case 'placeOrder':
                // Order must be sent to corresponding listing's seller
                util.checkOrderIsToSeller(db, m, mc, cb);
                break;

            case 'trust':
                // If an order is referenced, it must be real
                util.checkTrustOrderValid(db, m, mc, cb);
                break;

            case 'marketControl':
                var allOwners = true;
                m.ownerSigFrom.forEach(function(pkh) {
                    if(!(pkh in owners)) allOwners = false;
                });
                cb(allOwners && (m.ownerSigFrom.length > 0));
                break;

            case 'delegateProxyVote':
                cb(m.sigFrom in owners);
                break;

            case 'requestFeePayment':
            case 'approveNewIdentity':
            case 'deleteMessage':
            default:
                cb(false);
                break;
        }
    });
};

util.checkMsgTimestampAndSignerAuthority = function(db, m, mustBeRecent, cb) {
    util.checkMsgTimestamp(db, m, mustBeRecent, function(ok) {
        if(!ok) {
            cb(false, 'bad timestamp');
            return;
        }
        util.checkSignerAuthority(db, m, function(ok) {
            if(!ok) {
                cb(false, 'signer not authorized');
            } else {
                cb(true);
            }
        });
    });
};

module.exports = util;

