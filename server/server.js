
var http        = require('http'),
    url         = require('url'),
    bitcoin     = require('bitcoinjs-lib'),
    util        = require('./util.js'),
    conf        = require('./conf.js'),
    cutil       = require('../common/cutil.js'),
    msg         = require('../common/msg.js'),
    querystring = require('querystring');

server = { 'rpc' : { } };

server.writeHead = function(res, statusCode, contentType) {
    res.writeHead(statusCode, { 'Content-Type'                : contentType,
                                'Access-Control-Allow-Origin' : '*' });
};

server.writeRedirect = function(res, uri) {
    res.writeHead(303, { 'Location' : uri });
    res.end();
};

server.sendJson = function(res, obj) {
    server.writeHead(res, 200, 'text/json');
    res.write(JSON.stringify(obj));
    res.end();
};

server.send503 = function(res) {
    server.writeHead(res, 503, 'text/plain');
    res.end("503 server error\n");
};

server.captchaValid = function(f) {
    return function(p, cb) {
        if(conf.allowBypassCaptcha[p.captchaTag] === p.captchaText) {
            f(p, cb);
            return;
        }

        var c = server.db.collection('captchas');
        c.findOne({ 'tag' : p.captchaTag }, function(e, r) {
            if(r && r.text === p.captchaText) {
                // no need to wait for the remove to complete
                c.removeOne({ 'tag' : p.captchaTag }, function(e, r) { });
                f(p, cb);
            } else {
                cb(null, { 'error' : 'bad captcha' });
            }
        });
    };
};

/**
 * JSON-RPC method 'marketControl', return the effective marketControl
 * message and blockchain information to prove that, cached in database.
 */
server.rpc.marketControl = function(p, cb) {
    var c = server.db.collection('marketControl');
    c.findOne({ }, function(e, r) {
        cb(null, { 'result' : { 'marketControl' : r.marketControl,
                                'delegations'   : r.delegations,
                                'txs'           : r.txs,
                                'blocks'        : r.blocks, } });
    });
};

/**
 * For each message that we return, also return the approveNewIdentity
 * and keysForIdentity for its signer.
 */
server.getChainOfTrust = function(obj, cb) {
    var cm = server.db.collection('msgs');
    obj.chain = [ ];
    var started = 0, finished = 0;
    obj.msgs.forEach(function(m) {
        [ [ 'approveNewIdentity', 'pkhId' ],
          [ 'keysForIdentity', 'sigFrom' ] ].forEach(function(p) {
            var query = { 'type' : p[0] };
            query[p[1]] = m.sigFrom;

            started++;
            cm.findOne(query, null, {
                'sort' : { 'timeReal' : -1 },
            }, function(e, r) {
                if(r) obj.chain.push(r);

                finished++;
                if(started === finished) {
                    cb(null, { 'result' : obj });
                }
            });
        });
    });
},

/**
 * JSON-RPC method 'searchMsg', search our messages by various criteria and
 * return a list of hashes, complete messages, or listing summaries.
 */
server.rpc.searchMsg = function(p, cb) {
    var query = [ ];
    if(!p.deletedOk) {
        // Deleted messages remain in the database, but don't return them
        // unless explicitly requested.
        query.push({ '_deletedBy' : { '$exists' : false } });
    }

    // "Easy" properties are ones where the name in the parameters matches
    // the name in the database, and we search for exact equality.
    var easy = [
        'type', 'shipFrom', 'shipTo', 'to', 'ref', 'pkhId', 'feeFrom', 'feeTo',
    ];
    easy.forEach(function(x) {
        if(p[x]) {
            var q = { };
            q[x] = p[x];
            query.push(q);
        }
    });

    // Time is a range, not an exact match
    if(p.maxTime) query.push({ 'timeReal' : { '$lte' : p.maxTime } });
    if(p.minTime) query.push({ 'timeReal' : { '$gte' : p.minTime } });

    // Categories are a string prefix search, so that we also get all the
    // subcategories.
    if(p.category) {
        var parens = p.category.match(/^[-A-Za-z0-9,; ]+$/);
        if(parens) {
            query.push({ 'category' : { '$regex' : '^' + parens[0] } });
        }
    }

    // Signatures may appear in ownerSigFrom (marketControl messages) or in
    // sigFrom (everything else).
    if(p.sigFrom) query.push({ '$or' : [
        { 'sigFrom'      : { '$in' : p.sigFrom } },
        { 'ownerSigFrom' : { '$in' : p.sigFrom } },
    ] });
    // cipherTo searches just the primary recipient, not the cc to admins
    // or sender
    if(p.cipherTo) query.push({ 'cipherTo.0' : { '$in' : p.cipherTo } });
    if(p.cipherToAny) query.push({ 'cipherTo' : { '$in' : p.cipherToAny } });

    if(p.cipherPkhCrypt)
        query.push({ 'cipherPkhCrypt' : { '$in' : p.cipherPkhCrypt } });

    // A list of hashes, like to get specific messages by hash
    if(p.hashInclude) query.push({ 'hash' : { '$in' : p.hashInclude } });
    // A list of hashes to exclude from results, like for for "already read"
    if(p.hashExclude) query.push({ 'hash' : { '$nin' : p.hashExclude } });

    var limit = 50, skip = 0;
    if(p.limitResults) limit = Math.max(0, Math.min(limit, p.limitResults|0));
    if(p.skipResults) skip  = Math.max(0, p.skipResults|0);
    var opts = { 'limit' : limit, 'skip' : skip };

    // Can't pass an empty list to $and, need special case
    query = (query.length > 0) ? { '$and' : query } : { };

    // First count matching documents, so that we can report the unlimited
    // total count.
    var c = server.db.collection('msgs');
    c.count(query, function(e, r) {
        var n = r,
            csr = c.find(query, opts)

        if(p.sortBy === 'votingPower') {
            csr.sort({ '_votingPower' : -1 });
        } else if(p.sortBy === 'trust') {
            csr.sort({ '_trust' : -1 });
        } else if(p.sortBy === 'timeForum') {
            csr.sort({ '_timeForum' : -1 });
        } else if(p.sortBy === 'pull') {
            // When another peer pulls from us, they need the messages
            // oldest to newest
            csr.sort({ 'timeReal' : 1 });
        } else {
            csr.sort({ 'timeReal' : -1 });
        }

        // And then run it for real with the limit.
        csr.toArray(function(e, r) {
            var out = [ ], key;

            if(p.resultsAs === 'msg') {
                key = 'msgs';
            } else if(p.resultsAs === 'thumb') {
                key = 'thumbs';
            } else if(p.resultsAs === 'listing') {
                key = 'listings';
            } else {
                key = 'hashes';
            }

            r.forEach(function(m) {
                if(p.resultsAs === 'msg') {
                    util.removeInternalProperties(m);
                    out.push(m);
                } else if(p.resultsAs === 'thumb') {
                    out.push({
                        'hash'  : m.hash,
                        'thumb' : m.thumb,
                    });
                } else if(p.resultsAs === 'listing') {
                    out.push({
                        'hash'     : m.hash,
                        'subject'  : m.subject,
                        'images'   : m.images,
                        'timeReal' : m.timeReal,
                    });
                } else {
                    out.push(m.hash);
                }
            });

            var obj = { 'n' : n, 'skipped' : skip };
            obj[key] = out;

            // Chain of trust shouldn't ever be used with large numbers of
            // results, slight denial of service risk
            if(p.chainOfTrust && p.resultsAs === 'msg' && out.length < 4) {
                server.getChainOfTrust(obj, cb);
            } else {
                cb(null, { 'result' : obj });
            }
        });
    });
};

/**
 * JSON-RPC method 'sendMsg', broadcast messages on the network. We check
 * that they're well-formed and correctly signed according to their role,
 * and then store and forward.
 */
server.rpc.sendMsg = function(p, cb) {
    try {
        var n = p.msg.length;
        if(n !== 1 && n !== 2) throw 'bad msg count';

        var fromPeer = 'anon';
        if(p.captchaTag.match(/^http:\/\//)) fromPeer = p.captchaTag;

        var out = [ ], scheduled = 0, done = 0,
            allGood = true, errorMsg = 'failed';

        p.msg.forEach(function(m) {
            // broadcastBtcTx is a special case
            var mp = JSON.parse(m);
            if(mp.type === 'broadcastBtcTx' && cutil.checker.btcTx(mp.tx)) {
                if(scheduled !== 1) throw 'broadcastBtcTx should go second';

                var c = server.db.collection('btcToBroadcast');
                c.insertMany([ {
                    'tx'   : mp.tx,
                    'time' : util.getUnixTime(),
                    'done' : false,
                } ], function(e, r) { });
                return;
            }

            scheduled++;

            // Parse the message, check hash and signatures. This throws
            // and exception if we fail.
            m = util.msgFromStringAndCheckSignatures(m);
            out.push(m);

            var mustBeRecent = true;
            // Owners may legitimately vote for marketControl messages that
            // are many days old
            if(m.type === 'marketControl') mustBeRecent = false;

            util.checkMsgTimestampAndSignerAuthority(server.db, m, mustBeRecent,
            function(ok, err) {
                if(!ok) {
                    errorMsg = err;
                    allGood = false;
                }

                done++;
                if(scheduled === done) {
                    if(allGood) {
                        // Finally, if all the messages checked out,
                        // then store them in the database and forward.
                        // Record where we got them first, so we don't
                        // forward them back where they came from.
                        var cmr = server.db.collection('msgReceived'),
                            mr = [ ];
                        out.forEach(function(m) {
                            mr.push({
                                'hash'     : m.hash,
                                'type'     : m.type,
                                'fromPeer' : fromPeer,
                                'time'     : util.getUnixTime(),
                                'how'      : 'pushed',
                            });
                        });
                        cmr.insertMany(mr, function(e, r) {
                            // And once the insert completes, we can
                            // store and forward the messages.
                            out.forEach(function(m) {
                                console.log('sendMsg: m.hash = ' + m.hash);
                                console.log('  fromPeer = ' + fromPeer);
                                util.storeAndForwardMsg(server.db, m);
                            });
                            cb(null, { 'result' : 'ok' });
                        });
                    } else {
                        cb(null, { 'error' : errorMsg });
                    }
                }
            });
        });
    } catch(e) {
        cb(null, { 'error' : 'failed' });
    }
};

/**
 * JSON-RPC method 'newBuyerIdentity', confirm that the proposed new
 * identity is signed by valid old ones, and generate and store the
 * approveNewIdentity message.
 */
server.rpc.newBuyerIdentity = function(p, cb) {
    // Too many signatures is a denial of service risk, slow to check
    if((p.sigFrom.length !== p.sig.length) ||
       (p.sigFrom.length > 3) ||
       (!conf.adminNewBuyer))
    {
        cb(null, { 'error' : 'failed' });
        return;
    }
    // Check the signatures
    for(var i = 0; i < p.sigFrom.length; i++) {
        var sf = p.sigFrom[i],
            s = p.sig[i];
        if(!util.verifySignature(sf, s, p.msg)) {
            cb(null, { 'error' : 'failed' });
            return;
        }
    }

    var cmsgs = server.db.collection('msgs'), mc;
    var checked = 0, ok = 0;
    function checkOneOldIdentity() {
        if(checked === p.sigFrom.length) {
            if(ok > 0) {
                // In future, this is where we'd also aggregate reputation
                // from the old identities, and issue a 'trust' message
                // from the admins to the new identity based on that.
                server.approveKeysForIdentity(p.msg, ' newBuyerIdentity',
                function() {
                    var cnbi = server.db.collection('newBuyerIdentity');
                    cnbi.insertMany([ {
                        'params' : p,
                    } ], function(e, r) { });
                    cb(null, { 'result' : 'ok' });
                }, function(err) {
                    cb(null, { 'error' : 'failed' });
                });
            } else {
                cb(null, { 'error' : 'failed' });
            }
            return;
        }

        var pkh = p.sigFrom[checked];
        cmsgs.findOne({
            'type'  : 'approveNewIdentity',
            'pkhId' : pkh,
        }, null, {
            'sort' : { 'timeReal' : -1 },
        }, function(e, ani) {
            if(ani && msg.signedWithAuthorizedAdminKey(ani, mc) &&
                ani.allowed &&
                (util.getUnixTime() >= ani.validFrom) &&
                (util.getUnixTime() <= ani.validTo))
            {
                ok++;
            }
            checked++;
            checkOneOldIdentity();
        });
    }

    // And get marketControl, which we'll need to check existing
    // approveNewIdentity messages, and start iterating over those
    // old messages.
    var cmc = server.db.collection('marketControl');
    cmc.findOne({ }, function(e, r) {
        mc = r.marketControl;
        checkOneOldIdentity();
    });
};

/**
 * JSON-RPC method 'txos', return all transaction outputs sent to a
 * specified address. Sellers need that to make up the message that
 * spends their escrowed funds.
 */
server.rpc.txos = function(p, cb) {
    var c = server.db.collection('btcIndexByAddress');
    var csr = c.find({ 'address' : p.address }, { 'limit' : 10 });
    csr.toArray(function(e, r) {
        var rr = [ ];
        r.forEach(function(txo) {
            rr.push({ 'txid'  : txo.txid,
                      'vout'  : txo.vout,
                      'value' : txo.value,
                      'addr'  : txo.address, });
        });
        cb(null, { 'result' : rr });
    });
};

/**
 * Get a random CAPTCHA from the database. This is used both for the JSON-RPC
 * method getRandomCaptcha and for /approve.
 */
server.getRandomCaptcha = function(cb) {
    var c = server.db.collection('captchas');
    c.count({ }, function(e, r) {
        var consider = r - 10;
        if(consider < 100) {
            cb(null);
        } else {
            var skip = util.randomInteger(consider);
            c.findOne({ }, null, { 'skip' : skip }, function(e, r) {
                cb(r);
            });
        }
    });
};

/**
 * JSON-RPC method 'captcha', return a CAPTCHA image (as a data URI) and
 * tag to identify it.
 */
server.rpc.captcha = function(p, cb) {
    server.getRandomCaptcha(function(r) {
        if(r) {
            var rr = { 'tag' : r.tag, 'img' : r.img };
            cb(null, { 'result' : rr });
        } else {
            cb(null, { 'error' : 'failed' });
        }
    });
};

/**
 * JSON-RPC method 'ticker', just dumping various cached information from
 * the database.
 */
server.rpc.ticker = function(p, cb) {
    var c = server.db.collection('ticker');
    c.findOne({ }, function(e, r) {
        cb(null, { 'result' : r.msg });
    });
};

/**
 * Call the JSON-RPC method m with parameters pIn. We check our inputs,
 * route the method if everything looks okay, and call the callback with
 * our result or error.
 */
server.method = function(m, pIn, cb) {
    var ck = cutil.checker;
    var mf = {
        'searchMsg'         : {
            'type'                  : ck.optional(ck.string),
            'maxTime'               : ck.optional(ck.integer),
            'minTime'               : ck.optional(ck.integer),
            'deletedOk'             : ck.optional(ck.bool),
            'hashInclude'           : ck.optional(ck.array(ck.hex256b)),
            'hashExclude'           : ck.optional(ck.array(ck.hex256b)),
            'sigFrom'               : ck.optional(ck.array(ck.btcAddr)),
            'cipherTo'              : ck.optional(ck.array(ck.btcAddr)),
            'cipherToAny'           : ck.optional(ck.array(ck.btcAddr)),
            'cipherPkhCrypt'        : ck.optional(ck.array(ck.btcAddr)),
            'category'              : ck.optional(ck.stringMaxLen(100)),
            'shipFrom'              : ck.optional(ck.stringMaxLen(2)),
            'shipTo'                : ck.optional(ck.stringMaxLen(2)),
            'to'                    : ck.optional(ck.btcAddr),
            'ref'                   : ck.optional(ck.string),
            'feeFrom'               : ck.optional(ck.btcAddr),
            'feeTo'                 : ck.optional(ck.btcAddr),
            'pkhId'                 : ck.optional(ck.btcAddr),
            'resultsAs'             : ck.stringEnum([ 'hash', 'msg',
                                                      'listing', 'thumb' ]),
            'limitResults'          : ck.optional(ck.integer),
            'skipResults'           : ck.optional(ck.integer),
            'sortBy'                : ck.optional(ck.stringEnum([ 'timeReal',
                                        'votingPower', 'trust',
                                        'timeForum', 'pull' ])),
            'chainOfTrust'          : ck.optional(ck.bool),
        },
        'marketControl'     : {
            'haveHash'              : ck.hex256b,
            'haveVotingPower'       : ck.integer,
            'haveTxids'             : ck.array(ck.hex256b),
            'workPerShare'          : ck.number,
        },
        'sendMsg'           : {
            'captchaTag'            : ck.stringMaxLen(100),
            'captchaText'           : ck.stringMaxLen(100),
            'msg'                   : ck.array(ck.stringMaxLen(200*1000)),
        },
        'newBuyerIdentity'  : {
            'captchaTag'            : ck.stringMaxLen(50),
            'captchaText'           : ck.stringMaxLen(10),
            'msg'                   : ck.stringMaxLen(1000),
            'sigFrom'               : ck.array(ck.btcAddr),
            'sig'                   : ck.array(ck.btcSignature),
        },
        'txos'              : {
            'address'               : ck.btcAddr,
        },
        'ticker'            : { },
        'captcha'           : { },
    };
    var fc, pOut;
    try {
        if((typeof m)   !== 'string') throw 'method should be string';
        if((typeof pIn) !== 'object') throw 'params should be object';
        fc = mf[m];
        if(!fc) throw 'method name should be known';

        pOut = ck.check(pIn, fc);
    } catch(e) {
        cb(null, { 'error' : 'failed' });
        return;
    }

    var mm = {
        'searchMsg'         : server.rpc.searchMsg,
        'marketControl'     : server.rpc.marketControl,
        'sendMsg'           : server.captchaValid(server.rpc.sendMsg),
        'newBuyerIdentity'  : server.captchaValid(server.rpc.newBuyerIdentity),
        'captcha'           : server.rpc.captcha,
        'ticker'            : server.rpc.ticker,
        'txos'              : server.rpc.txos,
    };
    var f = mm[m];
    f(pOut, cb);
};

/**
 * Handles a GET request to /approve, serve the form where we ask the user
 * to complete a CAPTCHA to get the identity approved. The client links to
 * this page.
 */
server.approveGet = function(u, res) {
    var queryData = url.parse(u, true).query;
    var m = '';
    if((typeof queryData.msg) === 'string' &&
       queryData.msg.match(/^[0-9a-zA-Z+\/]+=*$/))
    {
        m = queryData.msg;
    }

    server.getRandomCaptcha(function(rc) {
        if(!rc) {
            server.send503(res);
            return;
        }

        server.writeHead(res, 200, 'text/html');
        res.write(
'<html><head><title>Approve New User</title></head><body>' +
'<h2>Approve New User</h2>' +
'<p>Solve the CAPTCHA, and your account will be approved as a new buyer. To ' +
'sell, first create a buyer account, and then message the admins through ' +
'the market.</p>' +
'<img src="data:' + rc.img + '"><br>\n' +
'<form action=/approve method=post>\n' +
'<input type=text name=captchaText size=7> (reload for new CAPTCHA)<br>' +
'<input type=hidden name=captchaTag value="' + rc.tag + '">\n' +
'<input type=hidden name=msg value="' + m + '">\n' +
'<input type=submit value="Submit">' +
'</form>' +
'</body></html>'
        );
        res.end();
    });
};

/**
 * Take a keysForIdentity message proposed by a new buyer. If it looks good,
 * then generate an approveNewIdentity message for that same pkhId, sign
 * it with our adminNewBuyer key, and store both in the database.
 */
server.approveKeysForIdentity = function(json, str, success, fail) {
    // Is the message correctly formed and signed?
    try {
        var kfi = util.msgFromStringAndCheckSignatures(json);
    } catch(e) {
        fail('keysForIdentity');
        return;
    }

    // Is the timestamp good (Unix time roughly agrees with our clock,
    // block height consistent with Unix time, block hash correct)?
    util.checkMsgTimestamp(server.db, kfi, true, function(ok) {
        if(!ok) {
            fail('keysForIdentity');
            return;
        }

        // Is this really a new identity?
        var c = server.db.collection('msgs');
        c.count({ 'type'   : 'approveNewIdentity',
                  'pkhId'  : kfi.sigFrom },
        function(e, r) {
            if(r > 0) {
                fail('alreadySeen');
                return;
            }

            var ani = {
                'type'      : 'approveNewIdentity',
                'genesisTxid' : conf.genesisTxo[0][0],
                'genesisVout' : conf.genesisTxo[0][1],
                'allowed'   : true,
                'maySell'   : false,
                'pkhId'     : kfi.sigFrom,
                'validFrom' : util.getUnixTime() + conf.adminNewBuyerValidFrom,
                'validTo'   : util.getUnixTime() + conf.adminNewBuyerValidTo,
                'kbPerDay'  : conf.adminNewBuyerKbPerDay,
                'comment'   : 'from ' + conf.myServerUri + str,
            };

            var cbs = server.db.collection('btcScanned');
            cbs.findOne({ }, null, {
                'sort' : { 'blockNumber' : -1 },
                'skip' : 10,
            }, function(e, b) {
                ani.time = b.blockNumber;
                ani.timeHash = b.blockHash;
                // Make sure that with messages sorted in time, the
                // approveNewIdentity comes before the keysForIdentity
                ani.timeReal = kfi.timeReal - 1;

                // Sign the approveNewIdentity message
                var ecp = bitcoin.ECPair.fromWIF(conf.adminNewBuyer,
                                                                conf.btcNet);
                ani.sigFrom = ecp.getAddress();
                ani.sig = msg.notYetSigned;
                ani = msg.fromUntrusted(ani, 'compute');
                var sig = bitcoin.message.sign(ecp, ani.hash, conf.btcNet);
                ani.sig = sig.toString('base64');

                // We back-date the timestamp on our approveNewIdentity
                // message to just before the keysForIdentity. The
                // window is big enough that this should always be
                // okay except with malicious input, but check for that,
                // no obivous attack but don't want bad timestamps in db.
                util.checkMsgTimestamp(server.db, ani, true, function(ok) {
                    if(!ok) {
                        fail('keysForIdentity');
                        return;
                    }

                    console.log('newBuyerIdentity');
                    console.log('  ani.hash = ' + ani.hash);
                    console.log('  kfi.hash = ' + kfi.hash);

                    // Broadcast the two messages
                    util.storeAndForwardMsg(server.db, ani);
                    util.storeAndForwardMsg(server.db, kfi);

                    success();
                });
            });
        });
    });
};

/**
 * Handles a POST request to /approve. If the CAPTCHA is good, and the
 * keysForIdentity message provided is good, then we generate an
 * approveNewIdentity message, and broadcast the keysForIdentity, and
 * redirect to success. Otherwise, redirect to an error message.
 */
server.approvePost = function(qs, res) {
    var fail = function(r) {
        server.writeRedirect(res, '/approve-fail?r=' + r);
    };

    // First, is the CAPTCHA good?
    var c = server.db.collection('captchas');
    c.findOne({ 'tag' : qs.captchaTag }, function(e, r) {
        if((!r) || r.text !== qs.captchaText) {
            fail('captcha');
            return;
        } 
        c.removeOne({ 'tag' : qs.captchaTag }, function(e, r) { });

        // Decode base64 message
        var json;
        try {
            json = (new Buffer(qs.msg, 'base64')).toString();
        } catch(e) {
            fail('keysForIdentity');
            return;
        }

        server.approveKeysForIdentity(json, '/approve', function() {
            // And we're done, indicate success to the user
            server.writeRedirect(res, '/approve-succeed');
        }, fail);
    });
};

/**
 * An error message if new identity approval failed, like because the
 * CAPTCHA was bad, or because the keysForIdentity message was wrong.
 */
server.approveFail = function(u, res) {
    var queryData = url.parse(u, true).query;
    
    var r = 'unknown';
    switch(queryData.r) {
        case 'captcha':         r = 'bad CAPTCHA, go back and retry'; break;
        case 'keysForIdentity': r = 'bad keysForIdentity message'; break;
        case 'alreadySeen':     r = 'identity already known to market'; break;
    }

    server.writeHead(res, 200, 'text/html');
    res.write(
'<html><head><title>Approve New User - Fail</title></head><body>' +
'<h2>Approve New User - Fail</h2>' +
'<p>Failed: ' + r + '.</p>' +
'</body></html>'
    );
    res.end();
};

/**
 * A success message after approving a new user identity.
 */
server.approveSucceed = function(res) {
    server.writeHead(res, 200, 'text/html');
    res.write(
'<html><head><title>Approve New User - Success</title></head><body>' +
'<h2>Approve New User - Success</h2>' +
'<p>This buyer account is approved. You can close this tab, and return ' +
'to the market. Approval may take a few minutes to propagate to all ' +
'servers on the network.</p>' +
'</body></html>'
    );
    res.end();
};

/**
 * This is where all requests to the server get routed.
 */
server.route = function(req, res) {
    var parens;
    if(req.method === 'POST') {
        if(req.url === '/rpc') {
            var data = '';
            req.addListener('data', function(d) {
                if(data.length < 200*1000) {
                    data += d;
                } else {
                    req.connection.destroy();
                }
            });
            req.addListener('end', function() {
                var obj = null;
                try { 
                    obj = JSON.parse(data);
                } catch (e) {
                    obj = null;
                }
                if(obj && ((typeof obj) === 'object')) {
                    server.method(obj.method, obj.params, function(e, r) {
                        server.sendJson(res, r);
                    });
                } else {
                    server.send503(res);
                }
            });
        } else if(req.url === '/approve' && conf.adminNewBuyer) {
            var data = '';
            req.addListener('data', function(d) {
                if(data.length < 1000) {
                    data += d;
                } else {
                    req.connection.destroy();
                }
            });
            req.addListener('end', function() { 
                try {
                    var qs = querystring.parse(data);
                    if(!qs) throw 'failed to parse body';

                    server.approvePost(qs, res);
                } catch(e) {
                    server.send503(res);
                }
            });
        } else {
            server.send503(res);
        }
    } else if(req.method === 'GET' && conf.adminNewBuyer) {
        if(req.url.match(/^\/approve\?/)) {
            server.approveGet(req.url, res);
        } else if(req.url.match(/^\/approve-fail\?/)) {
            server.approveFail(req.url, res);
        } else if(req.url === '/approve-succeed') {
            server.approveSucceed(res);
        } else {
            server.send503(res);
        }
    } else {
        server.send503(res);
    }
};

util.dbConnect(conf.db, function(db) {
    server.db = db;
    http.globalAgent.maxSockets = Infinity;
    console.log('server listening on ' + conf.listenOn);
    http.createServer(server.route).listen(conf.listenOn, '127.0.0.1');
});

