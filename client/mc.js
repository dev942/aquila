
/**
 * We received one server's response to marketControl. Verify that the
 * proof of work they've presented is correct, and store their transactions
 * and candidate message to be evaluated once everyone responds.
 */
aq.gotOneMarketControl = function(data, state) {
    if(!data.result) return;

    // Compute the total proof-of-work supplied. The provided block numbers
    // obviously can't be trusted to be accurate, and are provided only to
    // put the blocks in order and indicate gaps in the chain.
    var blocks = { }, b, bn;
    for(bn in data.result.blocks) {
        b = data.result.blocks[bn];
        var buf = new Buffer(b, 'hex');
        var hash = cutil.reverseBuffer(cutil.sha256Twice(buf)).toString('hex');
        blocks[bn] = {
            'prev'   : cutil.reverseBuffer(buf.slice(4, 4+32)).toString('hex'),
            'hash'   : hash,
            'work'   : cutil.workFromHash(hash),
            'merkle' :
                cutil.reverseBuffer(buf.slice(4+32, 4+32+32)).toString('hex'),
        };
    }

    // Compute ownership as we go, and stop processing responses from a host
    // if the transactions don't involve colored coins, to limit DoS
    // opportunity (by providing lots of txs with signatures to check). We'll
    // need to recompute ownership later with all transactions, though, to
    // stop past owners from voting.
    var cap = { };
    conf.genesisTxo.forEach(function(txo) {
        var key = txo[0] + ',' + txo[1];
        cap[key] = txo[2];
    });

    for(var i = 0; i < data.result.txs.length; i++) {
        var tx = data.result.txs[i];
        var b = blocks[tx.blockNumber];
        if(!b) {
            ui.log('block for proof-of-work not provided, ignoring server');
            return;
        }

        // Using the Merkle proof, confirm that the transaction is in the block
        var merkle = tx.txid;
        tx.proof.forEach(function(p) {
            if(p[0]) {
                merkle = cutil.merkleHash(p[1], merkle);
            } else {
                merkle = cutil.merkleHash(merkle, p[1]);
            }
        });
        if(merkle !== b.merkle) {
            ui.log('merkle proof for transaction incorrect, ignoring server');
            return;
        }

        // Confirm that the txid is correct.
        var txid = cutil.sha256Twice(new Buffer(tx.hex, 'hex'));
        txid = cutil.reverseBuffer(txid).toString('hex');
        if(!txid === tx.txid) {
            ui.log('txid is wrong, ignoring server');
            return;
        }

        // Compute the number of shares out, so that we can confirm that
        // later transactions spending outputs of this one really are
        // colored coin transactions.
        var vt = aq.verifyTransaction(tx.hex);
        if(!vt) {
            ui.log('failed to verify transaction, ignoring server');
            return;
        }
        var inShares = 0;
        vt.ins.forEach(function(txi) {
            var key = cutil.txoStringKey(txi);
            if(key in cap) {
                inShares += cap[key];
                delete cap[key];
            }
        });
        var totalValue = 0, outUnrounded = inShares - conf.destroyPerTransfer;
        for(var j = 0; j < vt.outs.length; j++) {
            var value = vt.outs[j].value;
            if(cutil.valueIsColoredSatoshis(value)) {
                totalValue += value;
            }
        }
        if(outUnrounded <= 0 || totalValue <= 0) {
            ui.log('tx has no colored outputs, ignoring server');
            return;
        }
        var totalOut = 0;
        for(var j = 0; j < vt.outs.length; j++) {
            var value = vt.outs[j].value,
                txo = tx.txid + ',' + j;
            if(cutil.valueIsColoredSatoshis(value)) {
                var sharesOut = Math.floor(outUnrounded*(value/totalValue));
                cap[txo] = sharesOut;
                totalOut += sharesOut;
            }
        }
        if(totalOut !== tx.sharesOut) {
            ui.log('wrong number of shares out');
            return;
        }

        // And confirm that sufficient proof-of-work is provided for the
        // number of shares this transfers. We'll confirm that tx.sharesOut
        // is correct later, when we compute ownership.
        var b0 = tx.blockNumber,
            needWork = conf.workPerShare * tx.sharesOut,
            prevHash = null;
        for(var j = b0; ; j++) {
            var bj = blocks[j];
            if((typeof bj) === 'undefined') {
                ui.log('block missing for proof of work, ignoring server');
                return;
            }
            if(!((j === b0) ||
                 (bj.prev === prevHash)))
            {
                ui.log('chain has wrong prev hash, ignoring server');
                return;
            }

            if(bj.work >= needWork) {
                // This block supplies enough proof-of-work for this tx.
                bj.work -= needWork;
                break;
            } else {
                needWork -= bj.work;
                bj.work = 0;
                // This block didn't supply enough proof-of-work for this tx,
                // but the next block might.
                prevHash = bj.hash;
            }
        }
    }

    if(!data.result.delegations.every(function(dpv) {
        if((dpv.sigFrom in state.delegators) &&
           (dpv.timeReal <= state.delegators[dpv.sigFrom].timeReal))
        {
            // It's an earlier delegateProxyVote than what we already have,
            // so we can ignore it.
            return true;
        }
        if(dpv.type !== 'delegateProxyVote') {
            ui.log('msg is not delegateProxyVote, bad');
            return false;
        }
        if(!aq.verifyMsgSignatures(dpv)) {
            ui.log('msg signature fails, bad');
            return false;
        }

        state.delegators[dpv.sigFrom] = dpv;
        return true;
    })) {
        ui.log('bad delegateProxyVote, ignoring server');
        return;
    }

    ui.log('marketControl response looks valid, adding to candidates');
    // We save the proposed marketControl message, indexed by a hash over
    // everything (including the signatures), different from mc.hash.
    var mc = data.result.marketControl;
    var h2 = cutil.sha256(JSON.stringify(mc)).toString('hex');
    state.msgs[h2] = mc;
    // And we add each transaction to the list. We must consider txs from
    // all servers when evaluating marketControl for any one server, since
    // that one server can cheat by not relaying transactions that transfer
    // control away from past owners who voted on its message.
    data.result.txs.forEach(function(tx) {
        if(tx.txid in state.txs) {
            if(tx.sharesOut > state.txs[tx.txid].sharesOut) {
                // If we didn't do this, then a malicious server could provide
                // falsely low sharesOut for valid transactions, causing them
                // to get discarded. This way, we always use whoever provided
                // the most work.
                state.txs[tx.txid].sharesOut = tx.sharesOut;
            }
            (state.txs[tx.txid].timesReceived)++;
        } else {
            // Store the transaction. No block or transaction number is
            // stored, since we'll do the topological sort ourselves,
            // since we can't trust any provided order.
            state.txs[tx.txid] = {
                'hex'           : tx.hex,
                'sharesOut'     : tx.sharesOut,
                'timesReceived' : 1,
            };
        }
    });
};

/**
 * Verify that a transaction is well-formed, and that the signatures for
 * all its inputs are correct. Returns a bitcoin.Transaction if it's good,
 * otherwise null.
 */
aq.verifyTransaction = function(txHex) {
    // bitcoinjs may throw exceptions for badly-formed transactions, EC
    // points, etc.
    try {
        var tx = bitcoin.Transaction.fromHex(txHex);
        if(!isObj(tx)) {
            throw 'bitcoin.Transaction return bad';
        }

        if(tx.ins.length > 4) throw 'too many inputs for tx';

        for(var i = 0; i < tx.ins.length; i++) {
            var txin = tx.ins[i];

            if(!bitcoin.script.isPubKeyHashInput(txin.script)) {
                throw 'all inputs should be P2PKH';
            }

            var scriptSig = bitcoin.script.decompile(txin.script);
            if(!(isArray(scriptSig) && scriptSig.length == 2)) {
                throw 'scriptSig should have two chunks';
            }
            // The scriptSig should consist of exactly two chunks, the
            // signature itself and the public key used to sign.
            var sig = scriptSig[0], pubKey = scriptSig[1];
            if(!((sig instanceof Buffer) && (pubKey instanceof Buffer))) {
                throw 'sig and pubKey should be Buffer';
            }

            // We'll need the redeem script to compute the hash to check
            // the signature, which is standard for P2PKH.
            var pubKeyHash = bitcoin.crypto.hash160(pubKey);
            var scriptPubKey = bitcoin.script.compile([
                bitcoin.opcodes.OP_DUP,
                bitcoin.opcodes.OP_HASH160,
                pubKeyHash,
                bitcoin.opcodes.OP_EQUALVERIFY,
                bitcoin.opcodes.OP_CHECKSIG,
            ]);

            // and now we get the hash
            var hfs = tx.hashForSignature(i, scriptPubKey,
                                    bitcoin.Transaction.SIGHASH_ALL);

            // And, finally, we check the signature.
            var ecp = bitcoin.ECPair.fromPublicKeyBuffer(pubKey);
            var ecs = bitcoin.ECSignature.fromDER(sig.slice(0, -1));
            if(!ecMath.verifyEcdsa(hfs, ecs, ecp.Q)) {
                throw 'verify signature failed';
            }
        }

        // If control reached this point, then the transaction looks good.
        return tx;
    } catch(e) {
        ui.log('    DISCARDED: ' + e.toString());
        return null;
    }
};

/**
 * Compute ownership of the market, from our genesis cap table and a list
 * of transactions. We topological-sort the transactions (i.e., put them
 * in an order where we don't spend outputs that don't exist yet), and
 * track the colored coins from our genesis TXOs to their final owners.
 */
aq.computeOwnership = function(txs) {
    var colored = { }, txidThatSpends = { }, txFromTxid = { }, addr = { };

    ui.log('\nCOMPUTING CAP TABLE FOR MARKET:\n');

    // First, find all the colored outputs. Only the genesis TXOs and
    // colored outputs are considered in the topo sort, since the
    // transactions might have uncolored inputs too.
    conf.genesisTxo.forEach(function(txo) {
        var key = txo[0] + ',' + txo[1];
        colored[key] = true;
        addr[key] = 'genesis';
    });
    txs.forEach(function(tx) {
        txFromTxid[tx.txid] = tx;

        for(var i = 0; i < tx.tx.outs.length; i++) {
            var txo = tx.tx.outs[i];
            if(cutil.valueIsColoredSatoshis(txo.value)) {
                colored[tx.txid + ',' + i] = true;
            }
        }
    });

    // Next, build an index of where each colored TXO is spent
    txs.forEach(function(tx) {
        tx.tx.ins.forEach(function(txi) {
            var txo = cutil.txoStringKey(txi);

            if(txo in txidThatSpends) {
                // We have a double-spend, so one of these transactions
                // must not actually be part of the Bitcoin blockchain (and
                // the supplied proof-of-work was performed by something
                // other than the BTC network).
                //
                // The right thing to do is to request more work from the
                // servers. For now just be lazy and choose whichever we
                // received from more servers. That's less bad than it sounds,
                // since servers must be authorized by marketControl, so
                // a Sybil attack is hard (i.e., you need to win a legitimate
                // marketControl vote, in which case you already control the
                // market, at least briefly).
                ui.log('    *** DOUBLE-SPEND DETECTED');
                ui.log('    picking the tx we received from more servers');
                var txExisting = txFromTxid[txidThatSpends[txo]];
                if(tx.timesReceived > txExisting.timesReceived) {
                    txidThatSpends[txo] = tx.txid;
                }
            } else {
                txidThatSpends[txo] = tx.txid;
            }
        });
    });

    var cap = { },      // The market's cap table, indexed by TXO
        process = { };  // TXIDs that may have just become spendable

    // We start, as always, from our genesis TXOs. That sets our initial
    // cap table, and any transactions that spend these are candidates for
    // processing.
    conf.genesisTxo.forEach(function(txo) {
        var key = txo[0] + ',' + txo[1]
        // Any transactions that spend this TXO are candidates for processing
        if(key in txidThatSpends) {
            process[txidThatSpends[key]] = true;
        }
        // And initial ownership is per the table
        cap[key] = txo[2];
    });

    function fmtNum(i) {
        var str = i.toString();
        while(str.length < 7) str = ' ' + str;
        return str;
    }

    for(;;) {
        var processNext = { }, pl = Object.keys(process);
        if(pl.length === 0) break;
        // pl now contains a list of transactions that we might be able to
        // apply during this iteration of the outer loop.

        pl.forEach(function(txid) {
            var tx = txFromTxid[txid];

            var canApply = true;
            tx.tx.ins.forEach(function(txi) {
                var key = cutil.txoStringKey(txi);
                if(colored[key] && !(key in cap)) {
                    canApply = false;
                }
            });
            if(!canApply) return; // but we might be able to later

            // So we can apply this transaction now.
            ui.log('for txn ' + tx.txid);
            ui.log('  inputs');

            // First, compute the number of shares from its colored inputs.
            var inShares = 0;
            tx.tx.ins.forEach(function(txi) {
                var key = cutil.txoStringKey(txi);
                if(key in cap) {
                    ui.log('   ' + fmtNum(cap[key]) + ' ' + key);
                    inShares += cap[key];
                    delete cap[key];
                }
            });
            var outUnrounded = inShares - conf.destroyPerTransfer;

            if(outUnrounded > 0) {
                // Then compute the total value of its outputs, which we need
                // to determine how the input shares are distributed.
                var totalValue = 0;
                for(var i = 0; i < tx.tx.outs.length; i++) {
                    var value = tx.tx.outs[i].value;
                    if(cutil.valueIsColoredSatoshis(value)) {
                        totalValue += value;
                    }
                }

                ui.log('  outputs');

                // Finally, compute the number of shares to distribute to each
                // output, and update the cap table.
                for(var i = 0; i < tx.tx.outs.length; i++) {
                    var value = tx.tx.outs[i].value,
                        txo = tx.txid + ',' + i;
                    if(cutil.valueIsColoredSatoshis(value)) {
                        var sharesOut =
                                 Math.floor(outUnrounded*(value/totalValue));
                        cap[txo] = sharesOut;
                        ui.log('   ' + fmtNum(cap[txo]) + ' ' + txo);

                        addr[txo] = bitcoin.address.fromOutputScript(
                                        tx.tx.outs[i].script, conf.btcNet);

                        // And schedule any transactions that spend this for
                        // possible processing next iteration.
                        if(txo in txidThatSpends) {
                            processNext[txidThatSpends[txo]] = true;
                        }
                    }
                }
            } else {
                ui.log('    no outputs, all shares destroyed');
            }

            ui.log('');
        });

        process = processNext;
    }

    var utxos = Object.keys(cap);
    var capByAddr = { };
    utxos.sort(function(a, b) { return cap[b] - cap[a] });
    ui.log('FINAL MARKET OWNERSHIP BY ADDRESS:');
    utxos.forEach(function(utxo) {
        ui.log('  ' + fmtNum(cap[utxo]) + ' ' + addr[utxo]);
        var ad = addr[utxo];
        if((!(ad in capByAddr)) ||
            ((ad in capByAddr) && (capByAddr[ad] < cap[utxo])))
        {
            // Maybe this should be sum instead of max, but try to discourage
            // address re-use for colored UTXOs. It can't be anything less
            // than max, since that would open an attack where owner A sends
            // a tiny stake to owner B and decreases owner B's voting power
            // until owner B disposes of that TXO.
            capByAddr[addr[utxo]] = cap[utxo];
        }
    });
    return capByAddr;
};

/**
 * Callback after all servers have responded with a marketControl candidate,
 * timed out, or failed. We already checked that each transaction came with
 * sufficient proof-of-work, but now confirm that their ECDSA signatures
 * are correct too. Then, we use those transactions to compute ownership of
 * the market. Finally, we use that ownership to find the marketControl
 * message with greatest voting power, make it active, and then get back
 * to whatever page the user wanted.
 */
aq.gotAllMarketControl = function(state) {
    var txs = [ ];
    ui.log('\nall marketControl requests have returned or failed now');

    ui.log('checking signatures on transactions with txid');
    var txid;
    for(txid in state.txs) {
        var tx = aq.verifyTransaction(state.txs[txid].hex);
        if(tx) {
            ui.log('    ' + txid + ' ok');
            txs.push({ 'txid'          : txid,
                       'hex'           : state.txs[txid].hex,
                       'tx'            : tx,
                       'timesReceived' : state.txs[txid].timesReceived, });
        }
    }
    ui.log('checking signatures on marketControl msgs with hash');
    var h;
    for(h in state.msgs) {
        var mc = state.msgs[h];
        ui.log('    ' + mc.hash + ', sigs=' + mc.ownerSig.length);
        if(!aq.verifyMsgSignatures(mc)) {
            ui.log('        FAIL');
            delete state.msgs[h];
        }
    }
    ui.log('done checking signatures');

    var cap = aq.computeOwnership(txs);

    var delegates = { }, pkh;
    for(pkh in state.delegators) {
        var to = state.delegators[pkh].proxy;
        if(to in delegates) {
            delegates[to].push(pkh);
        } else {
            delegates[to] = [ pkh ];
        }
    }
    ui.log('');
    ui.log('DELEGATED PROXY VOTING:');
    for(pkh in delegates) {
        ui.log('    ' + pkh + ' also votes on behalf of:');
        delegates[pkh].forEach(function(v) {
            ui.log('        ' + v);
        });
    }

    var bestPower = { 'aged' : -1e10 }, bestMsg = null, now = getUnixTime();
    for(h in state.msgs) {
        var power = msg.marketControlVotingPower(state.msgs[h],
                                    now, conf.voteAgingFactor, cap, delegates);
        if(power.aged > bestPower.aged) {
            bestPower = power;
            bestMsg = state.msgs[h];
        }
    }
    if(!bestMsg) {
        ui.log('*** NO marketControl MESSAGE RECEIVED');
        ui.log("Can't proceed without that, reload or check network settings?");
        ui.log('Markets using .onion servers require Tor.');
        ui.showPopup('log');
        return;
    }

    ui.log('\nselected best marketControl message');
    ui.log('    net voting power = ' + bestPower.aged);
    ui.log('    hash = ' + bestMsg.hash);
    aq.setStorage('marketControl', { 'msg'         : bestMsg,
                                     'votingPower' : bestPower.unaged,
                                     'receivedAt'  : getUnixTime(), });
    aq.setStorage('owners', cap);
    aq.setStorage('delegates', delegates);

    ui.log('\ndone, getting ticker');
    window.setTimeout(aq.getTicker, 0.5*1000);
};

/**
 * Start the process of updating marketControl. We issue marketControl
 * calls to all servers, and set up callbacks for when they return with
 * messages and colored coin transactions. We'll then compute ownership
 * of the market, voting power of the messages, and from that the effective
 * marketControl message.
 */
aq.getMarketControl = function(servers) {
    ui.log('marketControl message is out of date, getting from network');
    var hash, votingPower, servers,
        mc  = aq.getStorage('marketControl');

    if(isObj(mc) && isObj(mc.msg)) {
        ui.log('old msg.hash = ' + mc.msg.hash);
        hash = mc.msg.hash;
        votingPower = mc.votingPower;
    } else {
        ui.log('no existing message, bootstrapping');
        hash = conf.block0Hash; // any dummy;
        votingPower = -1e10;
    }
    ui.log('waiting for ' + conf.serverTimeout/1e3 + 
                                     ' s, or until all servers respond');

    var state = { 'msgs' : { }, 'txs' : { }, 'delegators' : { } };
    aq.rpc.toServers('marketControl',
        { 'haveHash'        : hash,
          'haveVotingPower' : votingPower,
          'haveTxids'       : [ ],
          'workPerShare'    : conf.workPerShare, },
        aq.gotOneMarketControl, aq.gotAllMarketControl, state);
};


