
aq.rpc.sequence = 0;

/**
 * Check that an RPC result has expected type and other format. If it does,
 * then return a copy of that object, either { result : x } or { error : x}.
 * If it doesn't, then return undefined.
 */
aq.rpc.resultFromUntrusted = function(method, rIn) {
    var ck = cutil.checker;

    if(!isObj(rIn)) return;
    if(isStr(rIn.error)) {
        return { 'error' : rIn.error, };
    }

    // These two just get a single string as the response
    if(method === 'sendMsg' || method === 'newBuyerIdentity') {
        if(isStr(rIn.result)) {
            return { 'result' : rIn.result };
        } else {
            throw 'bad sendMsg / newBuyerIdentity response';
        }
    }

    if(!isObj(rIn.result)) return;
    rIn = rIn.result;

    if(method === 'marketControl') {
        var marketControl = msg.fromUntrusted(rIn.marketControl, 'check');
        if(!marketControl) return;

        var delegations = [ ];
        if(!isArray(rIn.delegations)) 'throw delegations not array';
        rIn.delegations.forEach(function(dpv) {
            dpv = msg.fromUntrusted(dpv, 'check');
            if(!dpv) throw 'bad delegateProxyVote';
            if(dpv.type !== 'delegateProxyVote') throw 'not delegateProxyVote';
            delegations.push(dpv);
        });

        var bh, blocks = { };
        if(!isObj(rIn.blocks)) return;
        for(bn in rIn.blocks) {
            var b = rIn.blocks[bn];
            if(isStr(bn) && bn.match(/^[0-9]+$/) && bn > conf.block0 &&
               isStr(b) && b.match(/^[0-9a-f]{160}$/))
            {
                blocks[bn] = b;
            } else {
                return;
            }
        }

        var txid, txs = [ ];
        if(!isArray(rIn.txs)) return;
        for(var i = 0; i < rIn.txs.length; i++) {
            var txIn = rIn.txs[i];
            var txOut = { };

            if(isStr(txIn.txid) && txIn.txid.match(/^[0-9a-f]{64}$/) &&
               isStr(txIn.hex) && txIn.hex.match(/^[0-9a-f]+$/) &&
               isInt(txIn.blockNumber) && 
               isInt(txIn.sharesOut) &&
               isArray(txIn.proof))
            {
                txOut.txid = txIn.txid;
                txOut.hex = txIn.hex;
                txOut.blockNumber = txIn.blockNumber;
                txOut.sharesOut = txIn.sharesOut;
                txOut.proof = [ ];
                for(var j = 0; j < txIn.proof.length; j++) {
                    var ll = txIn.proof[j];
                    if(ll.length === 2 &&
                       (ll[0] === 0 || ll[0] === 1) &&
                       (isStr(ll[1]) && ll[1].match(/^[0-9a-f]{64}$/)))
                    {
                        txOut.proof.push([ ll[0], ll[1] ]);
                    } else {
                        return;
                    }
                }
                txs.push(txOut);
            } else {
                return;
            }
        }
        return { 'result' : { 'marketControl' : marketControl,
                              'delegations'   : delegations,
                              'txs'           : txs,
                              'blocks'        : blocks } };
    } else if(method === 'searchMsg') {
        var out = [ ];
        if(!isInt(rIn.n)) throw 'n is not an integer';
        if(!isInt(rIn.skipped)) throw 'skipped is not an integer';
        var outh = { 'n' : rIn.n, 'skipped' : rIn.skipped };

        if(isArray(rIn.hashes)) {
            rIn.hashes.forEach(function(h) {
                if(!ck.hex256b(h)) throw 'not a valid hex hash';
                out.push(h);
            });
            outh.hashes = out;
            return { 'result' : outh };
        } else if(isArray(rIn.msgs)) {
            rIn.msgs.forEach(function(m) {
                m = msg.fromUntrusted(m, 'check');
                out.push(m);
            });
            outh.msgs = out;
            if(isArray(rIn.chain)) {
                var chout = [ ];
                rIn.chain.forEach(function(m) {
                    m = msg.fromUntrusted(m, 'check');
                    chout.push(m);
                });
                outh.chain = chout;
            }
            return { 'result' : outh };
        } else if(isArray(rIn.thumbs)) {
            rIn.thumbs.forEach(function(m) {
                if(!ck.imageDataUrl(m.thumb)) throw 'not a valid img data url';
                if(!ck.hex256b(m.hash)) throw 'not a valid hash';
                out.push({ 'thumb' : m.thumb, 'hash' : m.hash });
            });
            outh.thumbs = out;
            return { 'result' : outh };
        } else if(isArray(rIn.listings)) {
            rIn.listings.forEach(function(m) {
                if(!ck.hex256b(m.hash)) throw 'not a valid hash';
                if(!ck.string(m.subject)) throw 'not a valid subject';
                if(!ck.integer(m.timeReal)) throw 'not a valid time';
                if(!ck.array(ck.hex256b)(m.images)) throw 'not valid images';
                out.push({
                    'subject'  : m.subject,
                    'hash'     : m.hash,
                    'timeReal' : m.timeReal,
                    'images'   : m.images,
                });
            });
            outh.listings = out;
            return { 'result' : outh };
        }
        throw 'not implemented';
    } else if(method === 'txos') {
        var out = [ ];
        if(!isArray(rIn)) throw 'not array';
        rIn.forEach(function(txo) {
            if(!(ck.hex256b(txo.txid) &&
                 ck.integer(txo.vout) &&
                 ck.number(txo.value) &&
                 ck.btcAddr(txo.addr)))
            {
                throw 'bad txo';
            }
            out.push({
                'txid'  : txo.txid,
                'vout'  : txo.vout,
                'value' : txo.value,
                'addr'  : txo.addr,
            });
        });
        return { 'result' : out };
    } else if(method === 'ticker') {
        var t = msg.fromUntrusted(rIn, 'check');
        if(!t) throw 'bad msg';
        if(t.type !== 'ticker') throw 'not ticker';
        return { 'result' : t };
    } else {
        var formatCheck = {
            'captcha' : {
                'tag'       : ck.stringMaxLen(30),
                'img'       : ck.imageDataUrl,
            },
        };
        if(!(method in formatCheck)) throw 'unknown method';
        var fmt = formatCheck[method];
        var rOut = ck.check(rIn, fmt);

        return { 'result' : rOut };
    }
};

/**
 * JSON-RPC to a single server. Callbacks are provided for success (got
 * data from server) and failure (timed out, refused, etc.).
 */
aq.rpc.toServerUnchecked = function(server, method, params, cbSucceed, cbErr) {
    if(!server.match(/^(http|https):\/\//)) return;

    ui.log('>>> rpc to ' + server + ', ' + method);

    // Let the user watch each operation count down towards timeout
    var countdown = $('<div/>', { 'class' : 'countdown' });
    countdown.appendTo('#popup-log-countdown');
    var t0 = new Date();
    function count() {
        if(!countdown) return;

        var dt = conf.serverTimeout - (new Date() - t0);
        var str = Math.round(dt / 1000) + '';
        if(str.length === 1) str = ' ' + str;
        countdown.text(str);
        dt -= 1000*Math.floor(dt / 1000);
        window.setTimeout(count, dt);
    }
    count();

    var rpc = { 'method' : method,
                'params' : params };
    $.ajax({
        'type'      : 'POST',
        'url'       : server + '/rpc',
        'data'      : JSON.stringify(rpc),
        'success'   : function() {
            countdown.remove();
            countdown = null;
            cbSucceed.apply(this, arguments);
        },
        'dataType'  : 'json',
        'error'     : function() {
            countdown.remove();
            countdown = null;
            cbErr.apply(this, arguments);
        },
        'timeout'   : conf.serverTimeout,
    });
};

/**
 * Update the table where we track server information. We reward fast correct
 * responses, and penalize timeouts and malformed responses. This table is
 * used to decide which servers to use for RPC requests.
 */
aq.rpc.updateGoodness = function(uri, action, dt) {
    var servers = aq.getStorage('servers');
    if(!servers) servers = { };

    var su;
    if(!servers[uri]) {
        servers[uri] = {
            'goodness'   : 0,
            'receivedAt' : getUnixTime(),
            'dtAverage'  : (action === 'data') ? dt : (conf.serverTimeout/1e3),
        };
    }
    su = servers[uri];

    // Compute average response time for other servers seen in the last ten
    // minutes, to compare against this server's performance
    var u, dtAvg = 0, dtN = 0;
    for(u in servers) {
        if((u !== uri) && ((getUnixTime() - servers[u].receivedAt) < 10*60)) {
            dtAvg += servers[u].dtAverage;
            dtN++;
        }
    }
    dtAvg = (dtN === 0) ? (conf.serverTimeout/2) : (dtAvg / dtN);

    switch(action) {
        case 'data':
            var w = 0.1;
            su.dtAverage = ((1 - w) * su.dtAverage) + (w*dt);
            su.receivedAt = getUnixTime();

            if(su.dtAverage < dtAvg) {
                su.goodness += 200;
            } else {
                su.goodness += 100;
            }
            break;

        case 'netFail':
        case 'checkFail':
            su.goodness -= 1000;
            break;
    }
    su.goodness = Math.max(Math.min(su.goodness, 3000), -3000);

    for(u in servers) {
        // Make goodness metric decay towards zero
        servers[u].goodness *= 0.95;
        // And discard servers that we haven't seen in 100 days
        if((getUnixTime() - servers[u].receivedAt) > 100*24*60*60) {
            delete servers[u];
        }
    }

    aq.setStorage('servers', servers);
};

/**
 * Get a list of servers to use for an RPC request.
 */
aq.rpc.getServerList = function(method) {
    var serversForce = aq.getStorage('serversForce');
    if(serversForce) {
        // A list of servers that's set manually always wins for everything.
        return serversForce;
    }

    var sc = { };
    // Always consider the server list from marketControl, if we have one
    var mc = aq.getStorage('marketControl');
    if(isObj(mc) && isObj(mc.msg)) {
        mc.msg.serverUris.forEach(function(u) {
            sc[u] = true;
        });
    }
    var servers = aq.getStorage('servers');
    if(method === 'marketControl') {
        // For marketControl, also consider the bootstrap list,
        // since one effective malicious marketControl otherwise can
        // steal the market forever (by pointing to servers that don't
        // relay later marketControl messages).
        conf.serverUris.forEach(function(u) {
            sc[u] = true;
        });
        // And we try all the servers
        return Object.keys(sc);
    } else {
        if(!isObj(servers)) servers = { };
        var l = Object.keys(sc);

        function goodness(a) {
            return (a in servers) ? servers[a].goodness : 0;
        }
        l.sort(function(a, b) { return goodness(b) - goodness(a); });

        // Return the best two servers by that metric, plus one server
        // chosen at random (or all the servers, if we have <= 3)
        var best = l.slice(0, 2), rest = l.slice(2);
        if(rest.length > 0) {
            var i = Math.floor(rest.length*Math.random());
            best.push(rest[i]);
        }
        return best;
    }
};

/**
 * JSON-RPC to multiple servers. If a list of servers is provided then
 * it's used. We otherwise choose three servers ourselves. cbOne is called
 * after each successful result, and cbAll is called after all requests have
 * succeeded, failed, or timed out.
 */
aq.rpc.toServers = function(method, params, cbOne, cbAll, state) {
    var servers = aq.rpc.getServerList(method);

    var total = servers.length, succeeded = 0;
    $('#servers-count').text('0/' + total);
    $('#servers-dt').text('');

    var seq = ++aq.rpc.sequence;

    var pending = { };
    servers.forEach(function(server) {
        var t0 = new Date();
        var fs = function(data) {
            var dt = ((new Date()) - t0) / 1000;
            ui.log('<<< rpc data from ' + server + ', ' + method +
                                            ' dt=' + dt.toFixed(3) + ' s');
            var r;
            try {
                r = aq.rpc.resultFromUntrusted(method, data);
            } catch(e) {
                ui.log('RPC result format bad (rpc.toServers): ' + e);
            }
            if(r && cbOne) cbOne(r, state);

            succeeded++;
            aq.rpc.updateGoodness(server, r ? 'data' : 'checkFail', dt);

            if(seq === aq.rpc.sequence) {
                // Show the response in our title bar. We use the sequence
                // number so that if multiple interleaved requests are
                // issued, then we just show the result from latest.
                $('#servers-count').text(succeeded + '/' + total);
                if(succeeded <= 3) {
                    var sdt = $('#servers-dt');
                    sdt.text(sdt.text() + ' ' + dt.toFixed(1) + 's');
                }
            }

            delete pending[server];
            if(Object.keys(pending).length === 0 && cbAll) cbAll(state);
        };
        var fe = function(xhr, textStatus) {
            var dt = ((new Date()) - t0) / 1000;
            ui.log('<<< rpc failure from ' + server + ', ' + method +
                                            ' dt=' + dt.toFixed(3) + ' s');

            aq.rpc.updateGoodness(server, 'netFail', dt);

            delete pending[server];
            if(Object.keys(pending).length === 0) {
                if(succeeded === 0) {
                    ui.log('*** ALL REQUESTS FAILED');
                    ui.log('will retry marketControl next time');
                    // If everything failed, then try getting marketControl
                    // again, maybe server list is bad
                    var mc = aq.getStorage('marketControl');
                    if(isObj(mc)) {
                        mc.receivedAt = 0;
                        aq.setStorage('marketControl', mc);
                    }
                }

                if(cbAll) cbAll(state);
            }
        };

        pending[server] = true;
        aq.rpc.toServerUnchecked(server, method, params, fs, fe);
    });
};

/**
 * JSON-RPC to a single server. We choose the best one by our current
 * metrics, and retry a few times upon failure (after updating the metrics,
 * which should penalize the server that just failed and make us switch).
 */
aq.rpc.toOneServer = function(method, params, cb, n) {
    n = (n|0);

    var servers = aq.rpc.getServerList(method),
        server = servers[0];

    function fs(data) {
        try {
            var r = aq.rpc.resultFromUntrusted(method, data);
            cb(r, server);
        } catch(e) {
            ui.log('RPC result format bad (rpc.toOneServer): ' + e);
        }
    }
    function fe() {
        aq.rpc.updateGoodness(server, 'netFail', conf.serverTimeout);
        if(n < 5) {
            ui.log('aq.rpc.toOneServer failed, retrying');
            aq.rpc.toOneServer(method, params, cb, n + 1);
        } else {
            ui.log('*** TRIED FIVE TIMES, GIVING UP');
        }
    }

    aq.rpc.toServerUnchecked(server, method, params, fs, fe);
};

/**
 * JSON-RPC to a single specified server.
 */
aq.rpc.toServer = function(server, method, params, cb) {
    aq.rpc.toServerUnchecked(server, method, params, function(data) {
        try {
            var r = aq.rpc.resultFromUntrusted(method, data);
            cb(r, server);
        } catch(e) {
            ui.log('RPC result format bad (rpc.toServer): ' + e);
        }
    }, function() { ui.log('rpc.toServer: failed'); });
};


