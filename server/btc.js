
var conf    = require('./conf.js'),
    rpc     = require('node-json-rpc'),
    async   = require('async'),
    msg     = require('../common/msg.js'),
    util    = require('./util.js'),
    bitcoin = require('bitcoinjs-lib');

btc = { };

btc.callRpc = function(args, cb) {
    var tid = setTimeout(function() {
        console.log('timeout: rpc');
        process.exit(1);
    }, 10*1000);

    var opt = {
        port    : conf.bitcoindPort,
        host    : conf.bitcoindHost,
        login   : conf.bitcoindUser,
        hash    : conf.bitcoindPass,
        path    : '/',
        strict  : true,
    };
    var client = new rpc.Client(opt);
    var c = client.call(args, function(e, r) {
        clearTimeout(tid);
        if(e) {
            console.log('error: rpc: ' + e);
            process.exit(1);
        }
        cb(e, r);
    });
};

/**
 * Compute everything that depends on the Bitcoin blockchain. We build some
 * indexes over the entire blockchain, up to the end as reported by bitcoind.
 * We then compute ownership of the colored coins that determine voting
 * power on a marketControl message, and finally determine which marketControl
 * message has the greatest total voting power. That message is stored in the
 * database, and served in response to a getMarketControl RPC from the client.
 */
btc.scanBlockchain = function() {
    btc.colored = { };
    // Start by recording all TXOs already known to be colored, since coloring
    // will proceed from there. That's the genesis TXOs
    conf.genesisTxo.forEach(function(owner) {
        btc.colored[owner[0] + ',' + owner[1]] = true;
    });
    var c = cli.db.collection('btcIndexByColored');
    c.find().toArray(function(e, r) {
        // and all subsequent colored TXOs already indexed.
        r.forEach(function(owner) {
            owner.voutColored.forEach(function(vout) {
                btc.colored[owner.txid + ',' + vout] = true;
            });
        });

        btc.callRpc({ 'method' : 'getblockcount',
                      'params' : [ ] }, function(e, r)
        {
            btc.totalBlocks = r.result;
            btc.blockHashes = [ ];
            btc.blockHeaders = [ ];
            btc.blockTimes = [ ];
            btc.blockNexts = [ ];
            btc.findEndOfValidIndex(btc.totalBlocks);
        });
    });
};

/**
 * Find the oldest block that we've already validly indexed, using btcScanned.
 * After indexing a block, we write its number (height) and hash there; so
 * look back until that record matches bitcoind. The record for new blocks
 * could be missing, if we haven't indexed them yet, or wrong, if the chain
 * reorganized.
 * 
 * Afterward, we start building the index from that block.
 */
btc.findEndOfValidIndex = function(n) {
    btc.callRpc({ 'method' : 'getblockhash',
                  'params' : [ n ] }, function(e, r) {
        btc.blockHashes[n] = r.result;
        var c = cli.db.collection('btcScanned');
        c.find({ 'blockNumber' : n }).toArray(function(e, r) {
            if((r.length == 1 && r[0].blockHash === btc.blockHashes[n]) ||
               (n === conf.block0))
            {
                // we've backed up either to an existing validly-indexed block
                // or to the beginning of time, so far enough
                btc.startIndexingFrom = n + 1;
                btc.startIndexForBlock(n + 1);
            } else {
                btc.findEndOfValidIndex(n - 1);
            }
        });
    });
};

/**
 * Build the indexes. This function will get called repeatedly on successive
 * callbacks until it reaches the end of the blockchain. At that point, we'll
 * compute ownership of the colored coins, and control of the market.
 */
btc.startIndexForBlock = function(n) {
    if(n <= btc.totalBlocks) {
        var bs = cli.db.collection('btcScanned');
        bs.deleteMany({ 'blockNumber' : n }, function(e, r) {
            btc.makeIndexForBlock(n);
        });
    } else {
        console.log('block index up to date');
        btc.computeOwnershipAndControl();
    }
};

/**
 * Return a list of hashes that prove in a "Merkle linked list" that the
 * given txid lies in a block with the given list of txids.
 */
btc.getMerkleProof = function(txids, forTxid) {
    var row = txids, watch = forTxid, proof = [ ];
    while(row.length > 1) {
        if((row.length % 2) != 0) {
            row.push(row.slice(-1)[0]);
        }
        var nextRow = [ ];
        for(var i = 0; i < row.length; i += 2) {
            var hash = cutil.merkleHash(row[i], row[i+1]);
            if(row[i] == watch) {
                watch = hash;
                proof.push([ 0, row[i+1] ]);
            } else if(row[i+1] == watch) {
                watch = hash;
                proof.push([ 1, row[i] ]);
            }
            nextRow.push(hash);
        }
        row = nextRow;
    }

    if(0) {
        // Test code only, should compute same Merkle root as we did from the
        // complete set of transactions. This is how the client would verify
        // that the transaction is included in a block.
        var merkleRoot = row[0];
        console.log('merkle (block) = ' + merkleRoot);
        var hash = forTxid;
        proof.forEach(function(p) {
            if(p[0]) {
                hash = cutil.merkleHash(p[1], hash);
            } else {
                hash = cutil.merkleHash(hash, p[1]);
            }
        });
        console.log('merkle (proof) = ' + hash);
    }

    return proof;
};

btc.getHeaderForBlock = function(block) {
    function uint32ToHex(i) {
        var r = i.toString(16);
        while(r.length < 8) r = '0' + r;
        return r;
    }

    var hdl = [ uint32ToHex(block.version),
                block.previousblockhash,
                block.merkleroot,
                uint32ToHex(block.time),
                block.bits,
                uint32ToHex(block.nonce), ];
    for(var i = 0; i < hdl.length; i++) {
        hdl[i] = cutil.reverseBuffer(new Buffer(hdl[i], 'hex'));
    }
    var hd = Buffer.concat(hdl);
    if(0) {
        // Test code only, should return block hash
        var hash = cutil.reverseBuffer(cutil.sha256Twice(hd)).toString('hex');
        console.log('hash (block) = ' + block.hash);
        console.log('hash (calcd) = ' + hash);
    }
    hd = hd.toString('hex');

    return hd;
};

btc.makeIndexForBlock = function(n) {
    var percent = Math.floor(100*((n - btc.startIndexingFrom) / 
                        (1 + btc.totalBlocks - btc.startIndexingFrom)));
    process.stdout.write('indexing block ' + n + ' (' + percent + '%)');

    btc.callRpc({ 'method' : 'getblock',
                  'params' : [ btc.blockHashes[n] ] }, function(e, r) {
        process.stdout.write(', txns=' + r.result.tx.length + '\n');

        var block = r.result, txids = block.tx, rpc = [ ];
        btc.blockHeaders[n] = btc.getHeaderForBlock(block);
        btc.blockNexts[n] = block.nextblockhash;
        btc.blockTimes[n] = block.time;

        txids.forEach(function(txid) {
            rpc.push({ 'method' : 'getrawtransaction',
                       'params' : [ txid, 1 ] });
        });
        btc.callRpc(rpc, function(e, r) {
            var ix = [ ], ixc = [ ], txNumber = 0;
            r.forEach(function(rr) {
                var tx = rr.result, txIsColored = false;

                tx.vin.forEach(function(txi) {
                    var s = txi.txid + ',' + txi.vout;
                    if(btc.colored[s]) {
                        txIsColored = true;
                    }
                });
                if(txIsColored) {
                    var voutColored = [ ];
                    tx.vout.forEach(function(txo) {
                        var spk = txo.scriptPubKey;
                        if(spk.type === 'pubkeyhash' &&
                           cutil.valueIsColoredBtc(txo.value))
                        {
                            btc.colored[tx.txid + ',' + txo.n] = true;
                            voutColored.push(txo.n);
                        }
                    });
                    console.log('    colored, ' + tx.txid);
                    var proof = btc.getMerkleProof(txids, tx.txid);
                    ixc.push({ 'blockHash'   : tx.blockhash,
                               'blockNumber' : n,
                               'blockHeader' : btc.blockHeaders[n],
                               'txNumber'    : txNumber,
                               'tx'          : tx,
                               'txid'        : tx.txid,
                               'voutColored' : voutColored,
                               'proof'       : proof, });
                }
                tx.vout.forEach(function(txo) {
                    var spk = txo.scriptPubKey;
                    if(spk.type === 'scripthash') {
                        var ixe = ({ 'address'     : spk.addresses[0],
                                     'blockHash'   : tx.blockhash,
                                     'blockNumber' : n,
                                     'txid'        : tx.txid,
                                     'vout'        : txo.n,
                                     'value'       : txo.value });
                        ix.push(ixe);
                    }
                });

                txNumber++;
            });
            var iba = cli.db.collection('btcIndexByAddress'),
                ibc = cli.db.collection('btcIndexByColored'),
                thisBlock = { 'blockHash' : btc.blockHashes[n] },
                fns = [ ];

            fns.push(function(cb) { iba.deleteMany(thisBlock, cb); });
            fns.push(function(cb) { ibc.deleteMany(thisBlock, cb); });
            if(ix.length > 0) {
                fns.push(function(cb) { iba.insertMany(ix, cb); });
            }
            if(ixc.length > 0) {
                fns.push(function(cb) { ibc.insertMany(ixc, cb); });
            }

            async.series(fns, function(e, r) {
                btc.finishIndexForBlock(n);
            });
        });
    });
};

btc.finishIndexForBlock = function(n) {
    var cs = cli.db.collection('btcScanned');
    var o = { 'blockNumber' : n,
              'blockHash'   : btc.blockHashes[n],
              'blockHeader' : btc.blockHeaders[n],
              'blockNext'   : btc.blockNexts[n],
              'blockTime'   : btc.blockTimes[n] };
    cs.insertOne(o, function(e, r) {
        btc.startIndexForBlock(n + 1);
    });
};

/**
 * Using the indexes, compute ownership of the colored coins that determine
 * voting power in the market, and then call another function to find the
 * winning marketControl message at this time.
 */
btc.computeOwnershipAndControl = function() {
    var fmtNum = function(x) {
        if(x < 0 || x > 1000000) return '???????';
        x = Math.floor(x).toString();
        while(x.length < 7) x = ' ' + x;
        return x;
    };

    console.log('computing ownership\n');
    // Initial ownership is per the hard-coded genesis cap table.
    var cap = { }, addr = { };
    conf.genesisTxo.forEach(function(txo) {
        var txid = txo[0], vout = txo[1], shares = txo[2];
        cap[txid + ',' + vout] = shares;
    });

    var c = cli.db.collection('btcIndexByColored');
    var f = c.find();
    // This puts the transactions in chronological order, and Bitcoin block
    // ordering rules allow the transactions within a single block to be
    // processed in the given order.
    f.sort({ 'blockNumber' : 1, 'txNumber' : 1 });
    var txs = [ ], blockWork = { };
    f.toArray(function(e, r) {
        r.forEach(function(tx) {
            // Require 10 confirms before considering a transaction. This is
            // both to make sure we don't get fooled, and to make sure we
            // can provide sufficient proof-of-work to the client.
            if(tx.blockNumber > (btc.totalBlocks - 10)) return;

            console.log('for txn ' + tx.txid + '');
            console.log('  inputs');
            var inShares = 0;
            tx.tx.vin.forEach(function(txi) {
                var s = txi.txid + ',' + txi.vout;
                if(s in cap) {
                    console.log('    ' + fmtNum(cap[s]) + ' ' + s);
                    inShares += cap[s];
                    delete cap[s];
                } else {
                    console.log('    ' + '        ' + s);
                }
            });
            var outUnrounded = Math.max(0, inShares - conf.destroyPerTransfer);

            if(outUnrounded > 0) {
                console.log('  outputs');
                var totalValue = 0;
                tx.tx.vout.forEach(function(txo) {
                    if(cutil.valueIsColoredBtc(txo.value)) {
                        totalValue += txo.value;
                    }
                });
                var outShares = 0;
                tx.tx.vout.forEach(function(txo) {
                    var s =  tx.txid + ',' + txo.n;
                    if(cutil.valueIsColoredBtc(txo.value)) {
                        // For consistency, do the weighting in satoshis,
                        // not BTC, otherwise might vary by a share because
                        // of rounding.
                        var txos   = cutil.btcToSatoshis(txo.value),
                            totals = cutil.btcToSatoshis(totalValue);
                        cap[s] = Math.floor(outUnrounded*(txos/totals));

                        addr[s] = txo.scriptPubKey.addresses[0];
                        outShares += cap[s];
                        console.log('    ' + fmtNum(cap[s]) + ' ' + s);
                    } else {
                        console.log('    ' + '        ' + s);
                    }
                });
                console.log('    ' + fmtNum(inShares - outShares) +
                                                              ' destroyed');
            } else {
                console.log('  no outputs, all shares destroyed');
            }
            console.log('');

            // This is the summary that gets stored in marketControl and
            // sent to the client, compact and easy to check signatures on.
            txs.push({ 'txid'           : tx.txid,
                       'hex'            : tx.tx.hex,
                       'proof'          : tx.proof,
                       'blockHash'      : tx.blockHash,
                       'blockNumber'    : tx.blockNumber,
                       'txNumber'       : tx.txNumber,
                       'sharesOut'      : outShares });

            var work = (outShares * conf.workPerShare);
            if(blockWork[tx.blockNumber]) {
                blockWork[tx.blockNumber] += work;
            } else {
                blockWork[tx.blockNumber]  = work;
            }
        });

        console.log('final market ownership by address');
        var utxos = Object.keys(cap);
        var owners = { };
        utxos.sort(function(a, b) { return cap[b] - cap[a] });
        utxos.forEach(function(utxo) {
            console.log('  ' + fmtNum(cap[utxo]) + ' ' + addr[utxo]);
            var parens = utxo.match(/^([0-9a-f]{64}),([0-9]+)$/);

            var ad = addr[utxo];
            if((!(ad in owners)) ||
                ((ad in owners) && owners[ad].shares < cap[utxo]))
            {
                owners[ad] = { 'txid'   : parens[1],
                               'vout'   : parens[2],
                               'shares' : cap[utxo] };
            }
        });

        btc.getWork(owners, txs, blockWork);
    });
};

/**
 * For each block in which a colored coin transaction appeared, retrieve as
 * many blocks as necessary to prove sufficient work for the shares that
 * the transaction transfers.
 */
btc.getWork = function(owners, txs, work) {
    var blocks = { };

    var c = cli.db.collection('btcScanned');
    var csr = c.find();
    csr.sort({ 'blockNumber' : 1 });
    // Iterate over all the blocks that we've cached.
    csr.each(function(e, r) {
        if(r) {
            if(work[r.blockNumber]) {
                // We need to prove work using this block, so add its header
                // to the list that we'll output.
                var thisWork = cutil.workFromHash(r.blockHash);

                // See how much work we need, and how much work this block
                // proves.
                var have = cutil.workFromHash(r.blockHash),
                    want = work[r.blockNumber];

                // If this block doesn't prove sufficient work, then we'll get
                // the work from the next block in the chain.
                if(want > have) {
                    if(work[r.blockNumber+1]) {
                        work[r.blockNumber+1] += (want - have);
                    } else {
                        work[r.blockNumber+1]  = (want - have);
                    }
                }
                blocks[r.blockNumber] = r.blockHeader;
            }
        } else {
            // all blocks processed
            btc.getProxyVoters(owners, txs, blocks);
        }
    });
};

/**
 * For each owner, get the most recent delegateProxyVote message.
 */
btc.getProxyVoters = function(owners, txs, blocks) {
    var toProcess = Object.keys(owners);
    getOneProxyVote();

    function getOneProxyVote() {
        if(toProcess.length === 0) {
            btc.computeControl(owners, txs, blocks);
            return;
        }

        var pkh = toProcess.pop();
        var cmsgs = cli.db.collection('msgs');
        cmsgs.findOne({
            'type'    : 'delegateProxyVote',
            'sigFrom' : pkh,
        }, null, {
            'sort'    : { 'timeReal' : -1 },
        }, function(e, r) {
            if(r) {
                owners[pkh].proxy = r;
            }
            getOneProxyVote();
        });
    }
}

/**
 * Using the computed ownership of the colored coins, determine which
 * marketControl message is currently effective, and store that and ownership
 * details in the database.
 */
btc.computeControl = function(owners, txs, blocks) {
    var dummyHash =
'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    var c = cli.db.collection('msgs');
    var csr = c.find({ 'type' : 'marketControl' });
    csr.sort({ 'time' : -1 });
    var ecp = bitcoin.ECPair.fromWIF(conf.adminTicker, conf.btcNet);
    csr.toArray(function(e, r) {
        // Initial dummy marketControl message, for before any exist.
        var winnerVotes = -1e9, winner = {
            'type'              : 'marketControl',
            'time'              : conf.block0,
            'genesisTxid'       : conf.genesisTxo[0][0],
            'genesisVout'       : conf.genesisTxo[0][1],
            'timeHash'          : conf.block0Hash,
            'timeReal'          : 1453116000,

            'clientVersion'     : [ '0' ],
            'clientUri'         : 'http://example.com/aquila.html',
            'clientHash'        : dummyHash,
            'newBuyerUris'      : [ conf.myServerUri ],
            'serverUris'        : [ conf.myServerUri ],
            'categories'        : [ 'categoryA' ],
            'forums'            : [ 'forumA' ],
            'adminPkh'          : [ '1BitcoinEaterAddressDontSendf59kuE' ],
            'adminValidFrom'    : [ 0 ],
            'adminValidTo'      : [ 10e6 ],
            'adminType'         : [ 'adminSuper' ],
            'adminBtc'          : [ '0300000000000000000000000000000000' ],
            'adminContact'      : [ '1BitcoinEaterAddressDontSendf59kuE' ],
            'adminTicker'       : [ ecp.getAddress() ],
            'ownerSigFrom'      : [ ],
            'ownerSig'          : [ ],
        };
        try {
            winner = msg.fromUntrusted(winner, 'compute');
        } catch(e) {
            throw 'default marketControl format bad???';
        }

        var pkh, cap = { }, delegates = { }, delegations = [ ];
        for(pkh in owners) {
            cap[pkh] = owners[pkh].shares;

            var dpv = owners[pkh].proxy;
            if(dpv) {
                util.removeInternalProperties(dpv);
                delegations.push(dpv);

                if(dpv.proxy in delegates) {
                    delegates[dpv.proxy].push(pkh);
                } else {
                    delegates[dpv.proxy] = [ pkh ];
                }
            }
        }

        var now = util.getUnixTime();
        r.forEach(function(mc) {
            var vp = msg.marketControlVotingPower(mc, now,
                                    conf.voteAgingFactor, cap, delegates);
            if(vp.aged > winnerVotes) {
                winnerVotes = vp.aged;
                winner = mc;
            }

            // Update the voting power cached in the database, which we
            // use for sorting.
            var c = cli.db.collection('msgs');
            c.update({ 'hash' : mc.hash },
                     { '$set' : { '_votingPower' : vp.aged } },
            function(e, r) { });
        });

        console.log('\nwinning marketControl message has');
        console.log('    hash = ' + winner.hash);
        console.log('    voting power = ' + winnerVotes);

        util.removeInternalProperties(winner);
        var c = cli.db.collection('marketControl');
        c.update({ '_id' : 'singleton' },
                 { '$set' : { 'owners'        : owners,
                              'marketControl' : winner,
                              'delegations'   : delegations,
                              'txs'           : txs,
                              'blocks'        : blocks,
                              'time'          : util.getUnixTime(), } },
                 { 'upsert' : true },
         function(e, r) {
            btc.broadcastTxs();
        });
    });
};

/**
 * Broadcast enqueued transactions.
 */
btc.broadcastTxs = function() {
    var c = cli.db.collection('btcToBroadcast');

    console.log('\nbroadcasting enqueued Bitcoin transactions');

    c.find({ 'done' : false }).toArray(function(e, r) {
        var fns = [ ];
        r.forEach(function(tx) {
            fns.push(function(cb) {
                console.log('broadcast tx ' + tx._id);
                btc.callRpc({ 'method' : 'sendrawtransaction',
                              'params' : [ tx.tx ] }, cb);
            });
            fns.push(function(cb) {
                console.log('    mark done');
                c.update({ '_id' : tx._id },
                         { '$set' : { 'done' : true } }, cb);
            });
        });

        async.series(fns, function(e, r) {
            console.log('\ndone');
            process.exit(0);
        });
    });
};

module.exports = btc;

