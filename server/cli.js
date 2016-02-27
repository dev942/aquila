
var util    = require('./util.js'),
    conf    = require('./conf.js'),
    async   = require('async'),
    captcha = require('node-captcha'),
    shttp   = require('socks5-http-client'),
    shttps  = require('socks5-https-client'),
    btc     = require('./btc.js'),
    bitcoin = require('bitcoinjs-lib');

cli = { };

/**
 * Drop the old database, and create all necessary indexes in the new
 * empty one.
 */
cli.newDatabase = function() {
    var indices = {
        'msgs'        : [ 'hash', 'type', 'time',
                          'cipherTo', 'sigFrom', 'proxy', 'toDelete',
                          'category', 'shipFrom', 'shipTo',
                          'seller', 'buyer', 'subject', 'body',
                          'ref', 'feeFrom', 'feeTo', 'pkhId',
                          'cipherPkhCrypt', 'to', '_timeForum',
                          '_votingPower', '_trust', '_deletedBy',
                          '_hash64' ],
        'msgReceived' : [ 'hash', 'fromPeer', 'time', 'how' ],
        'msgToSend'   : [ 'hash', 'toPeer', 'time', 'state' ],
        'captchas'    : [ ],
        'marketControl'     : [ ],
        'exchangeRates'     : [ ],
        'btcIndexByAddress' : [ 'address', 'txid', 'blockHash', 'blockNumber' ],
        'btcIndexByColored' : [ 'txid', 'txNumber',
                                'blockHash', 'blockNumber' ],
        'btcScanned'        : [ 'blockNumber', 'blockHash', 'blockNext',
                                'blockTime', ],
        'btcToBroadcast'    : [ 'done', 'time', 'tx', ],
    };

    cli.db.dropDatabase(function(res) {
        console.log('dropped old database');
        var scheduled = 0, processed = 0;
        for(var c in indices) {
            indices[c].forEach(function(f) {
                var ix = { };
                ix[f] = 1;
                var opt = { 'unique' : ((c === 'msgs' && f === 'hash')) };
                cli.db.ensureIndex(c, ix, opt, function(err, f) {
                    if(err) throw 'failed to make index';
                    processed++;
                    if(scheduled === processed) {
                        console.log('created ' + processed + ' indices, done');
                        process.exit(0);
                    }
                });
                scheduled++;
            });
        }
    });
};

/**
 * Make a batch of 25 CAPTCHAs in memory, and then insert them all to the
 * database in a single operation.
 */
cli.makeBatchOfCaptchas = function(cb) {
    var f = function(cb) {
        var opts = { 'complexity' : 3,
                     'height'     : 50,
                     'width'      : 120,
                     'text'       : util.randomDigits(5) };
        captcha(opts, function(text, data) {
            cb(null, { 'text' : text,
                       'img'  : data,
                       'tag'  : util.randomChars(20), });
        });
    };
    var fns = [ ];
    for(var i = 0; i < 25; i++) {
        fns.push(f);
    }
    async.series(fns, function(e, r) {
        process.stdout.write('#');
        var c = cli.db.collection('captchas');
        c.insertMany(r, cb);
    });
};

/**
 * Make CAPTCHAs until our cache of those is above threshold.
 */
cli.fillCaptchas = function() {
    var c = cli.db.collection('captchas');
    c.find({}).count(false, { }, function(e, r) {
        var d = 1000 - r;
        if(d > 0) {
            console.log('need more, captchas=' + r);
            console.log('generating, 25 per hash mark');
            d += 500;
            var fns = [ ];
            for(var i = 0; i < Math.floor(d / 25); i++) {
                fns.push(cli.makeBatchOfCaptchas);
            }
            async.series(fns, function(e, r) {
                console.log('\ndone');
                process.exit(0);
            });
        } else {
            console.log('already full, okay, captchas=' + r);
            process.exit(0);
        }
    });
};

/**
 * Get exchange rates from BTC to other currencies from a web service,
 * and store them in the database, for the ticker info.
 */
cli.getExchangeRates = function() {
    var currencies0 = [ 'EUR', 'USD', ],
        currencies = [ 'BTC' ],
        exchangeRates = [ 1 ],
        cbs = cli.db.collection('btcScanned'),
        ct = cli.db.collection('ticker');

    // First, just update the ticker time, keeping the old exchange rates,
    // in case we can't get new ones
    ct.findOne({ }, function(e, oldTicker) {
        if(oldTicker && oldTicker.msg) {
            currencies = oldTicker.msg.currencies;
            exchangeRates = oldTicker.msg.exchangeRates;
        }
        writeUpdatedTicker(function() {
            console.log('updated time for old exchange rates just in case');
            tryNewExchangeRatesFromService();
        });
    });

    // Then try getting new rates from a web service
    function tryNewExchangeRatesFromService() {
        setTimeout(function() {
            console.log('timed out, keeping old exchange rates');
            process.exit(1);
        }, 15*1000);

        // Can't be Tor, since Bitpay will prompt for a CAPTCHA, but use proxy
        // everywhere for consistency
        console.log('getting new exchange rates from bitpay.com');
        var req = shttps.request({
            'socksPort' : conf.socksPortExchange,
            'socksHost' : conf.socksHostExchange,
            'hostname'  : 'bitpay.com',
            'path'      : '/rates',
        }, function(res) {
            res.setEncoding('utf8');

            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end', function() {
                var rates = JSON.parse(body), table = { };
                rates.data.forEach(function(r) {
                    table[r.code] = r.rate;
                });
                console.log('done');

                exchangeRates = [ ];
                currencies = currencies0;
                currencies.forEach(function(code) {
                    var rate = table[code];
                    if(rate < 10 || rate > 10000) throw 'bad rate';
                    exchangeRates.push(rate);
                    console.log('    ' + code + ' ' + rate);
                });
                currencies.unshift('BTC');
                exchangeRates.unshift(1);

                writeUpdatedTicker(function() {
                    console.log('done');
                    process.exit(0);
                });
            });
        });
        req.end();
    }

    function writeUpdatedTicker(cb) {
        cbs.findOne({ }, null, {
            'sort' : { 'blockNumber' : -1 },
            'skip' : 10,
        }, function(e, b) {
            var ecp = bitcoin.ECPair.fromWIF(conf.adminTicker, conf.btcNet);
            var ticker = {
                'type'          : 'ticker',
                'genesisTxid'   : conf.genesisTxo[0][0],
                'genesisVout'   : conf.genesisTxo[0][1],
                'time'          : b.blockNumber,
                'timeHash'      : b.blockHash,
                'timeReal'      : util.getUnixTime(),
                'currencies'    : currencies,
                'exchangeRates' : exchangeRates,
                'sigFrom'       : ecp.getAddress(),
                'sig'           : msg.notYetSigned,
            };
            ticker = msg.fromUntrusted(ticker, 'compute');
            var sig = bitcoin.message.sign(ecp, ticker.hash, conf.btcNet);
            ticker.sig = sig.toString('base64');

            ct.update({ '_id'  : 'singleton' },
                      { '$set' : { 'msg' : ticker } },
                      { 'upsert' : true },
            function(e, r) {
                console.log('stored in database, proceeding');
                cb();
            });
        });
    }
};

cli.parsePeer = function(peer) {
    var parens;
    if((parens = peer.match(/^http:\/\/(.*):([0-9]+)$/))) {
        return { 'host' : parens[1], 'port' : parens[2] };
    } else if((parens = peer.match(/^http:\/\/(.*)$/))) {
        return { 'host' : parens[1], 'port' : 80 };
    } else {
        console.log('peer is not http://host:port');
        process.exit(1);
    }
};

cli.rpcToPeer = function(peer, method, params, success, failure) {
    peer = cli.parsePeer(peer);
    var req = shttp.request({
        'socksPort' : conf.socksPortPeer,
        'socksHost' : conf.socksHostPeer,
        'hostname'  : peer.host,
        'port'      : peer.port,
        'path'      : '/rpc',
        'method'    : 'POST',
    });
    req.write(JSON.stringify({
        'method' : method,
        'params' : params,
    }));
    req.end();

    var done = false;

    var timeout = setTimeout(function() {
        req.connection.destroy();
        if(!done) failure();
        done = true;
    }, conf.serverTimeout);

    req.on('response', function(res) {
        res.setEncoding('utf8');

        var body = '';
        res.on('data', function(chunk) {
            if(body.length < 5*1000*1000) body += chunk;
        });
        res.on('end', function() {
            clearTimeout(timeout);
            if(!done) success(body);
            done = true;
        });
    });
};

/**
 * Push enqueued messages to a peer. We get the list of hashes to push in
 * memory, split that list into small batches, get the messages, and then
 * push them to the peer.
 */
cli.pushToPeer = function(peer, times) {
    var cmts = cli.db.collection('msgToSend'),
        cmsgs = cli.db.collection('msgs');

    var pass;
    conf.peers.forEach(function(peerAndPass) {
        if(peerAndPass[0] === peer) pass = peerAndPass[1];
    });
    if(!pass) {
        console.log('no CAPTCHA-bypass password for peer ' + peer);
        process.exit(1);
    }
    console.log('pushing to ' + peer);

    function pushBatch(ts, failedCnt) {
        // Finish when either we've pushed all the messages or we've failed
        // more than three times.
        if(ts.length === 0) {
            if(times > 1) {
                console.log('done, sleeping');
                setTimeout(function() {
                    cli.pushToPeer(peer, times - 1);
                }, 2*1000);
            } else {
                console.log('done, exiting');
                process.exit(0);
            }
            return;
        }
        if(failedCnt >= 3) {
            console.log('too many failures');
            process.exit(1);
        }

        // Handle the messages to send in batches of a given max size
        var now = [ ];
        for(;;) {
            if(now.length >= 1) break;
            if(ts.length === 0) break;

            var got = ts.shift();
            now.push(got);
            if((got.type === 'approveNewIdentity') ||
               (got.type === 'marketControl'))
            {
                // Might need these to authorize later messages, so those
                // later messages must go in a later batch.
                break;
            }
        }

        console.log('pushing batch to peer:');
        var hashes = [ ];
        now.forEach(function(mts) {
            console.log('    ' + mts.hash);
            hashes.push(mts.hash);
        });

        cmsgs.find({
            'hash' : { '$in' : hashes, },
        }).toArray(function(e, r) {
            var p = {
                'captchaTag'  : conf.myServerUri,
                'captchaText' : pass,
                'msg'         : [ ],
            };
            r.forEach(function(m) {
                util.removeInternalProperties(m);
                p.msg.push(JSON.stringify(m));
            });

            cli.rpcToPeer(peer, 'sendMsg', p, function(body) {
                if(body === JSON.stringify({ 'result' : 'ok' })) {
                    console.log('    ok');
                } else {
                    console.log('    failed: ' + body.substr(0, 50));
                    // but keep going after errors like this, unlikely to
                    // improve with retries
                }

                // Mark these done in the database
                var ids = [ ];
                now.forEach(function(mts) {
                    ids.push(mts._id);
                });
                cmts.updateMany({ '_id'  : { '$in' : ids } },
                                { '$set' : { 'state' : 'done' } },
                                function(e, r) { });

                batchComplete(now, true, ts, failedCnt);
            }, function() {
                console.log('    timeout');
                batchComplete(now, false, ts, failedCnt);
            });

        });
    }
    function batchComplete(justNow, ok, later, failedCnt) {
        if(ok) {
            console.log('(trying next batch)');
            pushBatch(later, failedCnt);
        } else {
            console.log('(retrying)');
            pushBatch(justNow.concat(later), failedCnt + 1);
        }
    }

    // Mark all enqueued messages older than a threshold as obsolete, avoid
    // backlog that grows forever. Maybe the peer got them somewhere else,
    // or pulled them.
    var dropBefore = util.getUnixTime() - 5*60;
    cmts.updateMany({ 'time' : { '$lte' : dropBefore } },
                    { '$set' : { 'state' : 'timeout' } },
    function(e, r) {
        // Get all the enqueued messages for this peer, and then forward in
        // small batches
        cmts.find({
            'state'  : 'new',
            'toPeer' : peer,
        }, null, { 'sort' : { 'time' : 1 } }).toArray( function(e, r) {
            pushBatch(r, 0);
        });
    });
};

/**
 * Pull messages from a peer. We search their messages in chronological
 * order, to get lists of hashes. We then review the list of hashes, and
 * get whatever messages we don't already have.
 */
cli.pullFromPeer = function(peer, minTime) {
    if(minTime !== 0) {
        setTimeout(function() {
            console.log('bad, pull from peer timed out');
            process.exit(1);
        }, 2*60*1000);
    }

    var perPage = 30, failedCnt = 0, skip = 0;

    var cmsgs = cli.db.collection('msgs');
    console.log('pulling from ' + peer);

    // Get a batch of message hashes from the peer. Exclude all the msgs
    // that we already have, and then call getMessages() to get the new
    // messages.
    function getHashes() {
        if(failedCnt > 3) {
            console.log('too many failures');
            process.exit(1);
        }

        console.log('query, skip=' + skip + ' minTime=' + minTime);
        var query = {
            'minTime'      : minTime,
            'skipResults'  : skip,
            'limitResults' : perPage,
            'resultsAs'    : 'hash',
            'sortBy'       : 'pull',
            'deletedOk'    : true,
        };
        cli.rpcToPeer(peer, 'searchMsg', query, function(r) {
            try {
                r = JSON.parse(r);
                if(!(r && r.result && r.result.hashes)) throw 'bad result';
                var hashes = r.result.hashes;
                if(!(hashes instanceof Array)) throw 'not array';
                var ck = cutil.checker;
                if(!(ck.array(ck.hex256b))(hashes)) throw 'not hashes';
                if(hashes.length > perPage) throw 'too many hashes';

                if(hashes.length === 0) {
                    console.log('no more messages, done');
                    process.exit(0);
                }

                var need = { };
                hashes.forEach(function(h) { need[h] = true; });

                console.log('    we already have:');
                cmsgs.find({
                    'hash' : { '$in' : hashes }
                }).each(function(e, r) {
                    if(r) {
                        console.log('        ' + r.hash);
                        delete need[r.hash];
                    } else {
                        getMessages(Object.keys(need));
                    }
                });

            } catch(e) {
                console.log('    bad result: ' + e + ', retrying');
                failedCnt++;
                getHashes();
            }
        }, function() {
            console.log('    get hashes timeout, retrying');
            failedCnt++;
            getHashes();
        });
    }

    // Get the messages with the given hashes, and pass them to
    // processMessages() for verification and (if good) storage in the db.
    function getMessages(hashes) {
        if(hashes.length === 0) {
            // No need to hit the network if list to retrieve is blank
            console.log('already had everything in last batch');
            skip += perPage;
            getHashes();
            return;
        }

        console.log('    we need to retrieve');
        hashes.forEach(function(h) {
            console.log('        ' + h);
        });
        var query = {
            'hashInclude' : hashes,
            'resultsAs'   : 'msg',
            'sortBy'      : 'pull',
            'deletedOk'   : true,
        };
        cli.rpcToPeer(peer, 'searchMsg', query, function(r) {
            try {
                var rl = r.length;
                r = JSON.parse(r);
                if(!(r && r.result && r.result.msgs)) throw 'bad result';
                var msgs = r.result.msgs;
                if(!(msgs instanceof Array)) throw 'not array';
                if(msgs.length !== hashes.length) throw 'wrong count';
                
                console.log('    processing downloaded msgs (' + rl +
                                                                    ' bytes):');
                processMessages(msgs);
            } catch(e) {
                console.log('    bad result: ' + e + ', retrying');
                failedCnt++;
                getHashes();
            }
        }, function() {
            console.log('    get msgs timeout, retrying');
            failedCnt++;
            getHashes();
        });
    }

    // Check that the messages we are given look correct, and store them in
    // the database if yes. Then, call getHashes() to get another batch of
    // hashes, and the loop continues. This processes one message per
    // iteration, and calls itself repeatedly from a callback to handle the
    // full list.
    function processMessages(msgs) {
        if(msgs.length === 0) {
            console.log('finished batch');
            skip += perPage;
            getHashes();
            return;
        }

        try {
            var ms = JSON.stringify(msgs[0]),
                m = util.msgFromStringAndCheckSignatures(ms);
            console.log('        ' + m.hash);
            // It would be better if we checked signer authorization here
            // too, but that would require us to recompute effective
            // marketControl along the way, since the messages we're
            // receiving may change the admins, would need more code.
            util.checkMsgTimestamp(cli.db, m, false, function(ok) {
                if(ok) {
                    console.log('            good, storing in db');
                    util.storeAndForwardMsg(cli.db, m, function() {
                        var cmr = cli.db.collection('msgReceived');
                        cmr.insertMany([ {
                            'hash'      : m.hash,
                            'type'      : m.type,
                            'fromPeer'  : peer,
                            'time'      : util.getUnixTime(),
                            'how'       : 'pulled',
                        } ], function(e, r) { });
                        processMessages(msgs.slice(1));
                    });
                } else {
                    console.log('            bad timestamp');
                    processMessages(msgs.slice(1));
                }
            });
        } catch(e) {
            console.log('        bad msg form or sig: ' + e);
            processMessages(msgs.slice(1));
        }
    }

    getHashes();
};

/**
 * Print a help message.
 */
cli.args = function() {
    console.log(
"usage: nodejs cli.js [ wipeDb | btc | captchas | ticker |\n" +
"                       push <peer> <n> | pull <peer> <minutes> | prune ]\n"
+ "\n" +
"    wipeDb   - set up brand new database, dropping all existing data\n" +
"    btc      - scan blockchain, update owners and indices\n" +
"    captchas - fill our reserve of CAPTCHAs to serve\n" +
"    ticker   - cache exchange rates from a web service, update ticker\n" +
"    push     - push queued messages to peer, iterate n times before exit\n" +
"    pull     - pull messages that we don't already have from peer\n" +
"               (time to look back in minutes, or \"all\" for all time)\n" +
"    prune    - delete obsolete messages to save disk\n");

    process.exit(1);
}

cli.main = function() {
    if(process.argv.length < 3) {
        cli.args();
    }

    switch(process.argv[2]) {
        case 'wipeDb':
            cli.newDatabase();
            break;

        case 'btc':
            btc.scanBlockchain();
            break;

        case 'captchas':
            cli.fillCaptchas();
            break;
        
        case 'ticker':
            cli.getExchangeRates();
            break;

        case 'push':
            if(process.argv.length < 5) {
                cli.args();
            }
            cli.pushToPeer(process.argv[3], process.argv[4]);
            break;

        case 'pull':
            if(process.argv.length < 5) {
                cli.args();
            }
            var minTime;
            if(process.argv[4] === 'all') {
                minTime = 0;
            } else {
                minTime = util.getUnixTime() - process.argv[4]*60;
            }
            cli.pullFromPeer(process.argv[3], minTime);
            break;
        
        case 'prune':
            console.log("not yet implemented\n");
            break;

        default:
            cli.args();
            break;
    }
};


util.dbConnect(conf.db, function(db) {
    cli.db = db;
    cli.main();
});

