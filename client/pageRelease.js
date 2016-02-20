
aq.page.release = {

'needKeys' : true,

'init' : function() {
    var keys = aq.getStorage('keys'),
        sk = keys.secretKeys;

    var orderHash = searchParam('order'),
        to = searchParam('to'),
        txHex = searchParam('tx'),
        payFrom, payTo, valueIn, valueOut,
        order, te, tx, txb;

    $('<a/>', {
        'text'  : orderHash,
        'href'  : '?a=order&hash=' + encodeURI(orderHash),
        'class' : 'mono',
    }).appendTo('#release-order');

    try {
        var info = aq.getTransactionInfo(txHex);

        payTo = info.addr;
        valueOut = info.value;
        tx = info.tx;
        txb = info.txb;
    } catch(e) {
        ui.log('*** BAD TRANSACTION');
        ui.showPopup('log');
        return;
    }

    function signAndFinish() {
        try {
            var skBase = keys.secretKeys[keys.primary].skBtc,
                sk = ecMath.getStealthSecretKey(order, te, skBase),
                ecp = bitcoin.ECPair.fromWIF(sk, conf.btcNet),
                pks = ecMath.getStealthPublicKeys(order, te),
                redeemScript = bitcoin.script.multisigOutput(2, pks);

            for(var i = 0; i < txb.inputs.length; i++) {
                txb.sign(i, ecp, redeemScript);
            }

            var hex = txb.build().toHex();

            ui.navTo('compose', {
                'to'             : to,
                'subject'        : 'ORDER: ' + order.subject,
                'order'          : orderHash,
                'tx'             : hex,
                'escrowReleased' : true,
            });
        } catch(e) {
            ui.showPopup('notify', 'failed to sign: ' + e);
        }
    }

    aq.getMsgByHash(orderHash, function(m) {
        order = m;
        te = msg.extractCiphered(order, sk);

        ui.addressDiv(order.cipherTo[0], true).appendTo('#release-seller');
        ui.addressDiv(order.sigFrom, true).appendTo('#release-buyer');
        
        payFrom = ecMath.getMultisigAddress(order, te);
        ui.btcLink(payFrom).appendTo('#release-payFrom');
        ui.btcLink(payTo).appendTo('#release-payTo');
        $('#release-valueOut').text(ui.formatBtc(valueOut));

        var txos = { }, done = false;
        aq.rpc.toServers('txos', { 'address' : payFrom }, function(r) {
            if(done) return;
            if(!(isObj(r) && isArray(r.result))) return;
            r.result.forEach(function(txo) {
                txos[txo.txid + ',' + txo.vout] = txo;
            });

            var total = 0;
            if(!tx.ins.every(function(txi) {
                var rb = cutil.reverseBuffer(txi.hash),
                    p = (rb.toString('hex') + ',' + txi.index);
                if(!(p in txos)) return false;
                total += txos[p].value;
                return true;
            })) return;

            done = true;
            valueIn = total;
            $('#release-valueIn').text(ui.formatBtc(valueIn));
            $('#release-fee').text(ui.formatBtc(valueIn - valueOut));

            $('#release-go').on('click', signAndFinish);
            ui.hidePopup();
        });
    });
},

'viewTx' : function() {
    try {
        var info = aq.getTransactionInfo(searchParam('tx'));
        $('#viewTx-tx')[0].value = info.txHex;
        $('#viewTx-n').text(info.n);
        ui.showPopup('viewTx');
    } catch(e) {
    }
},

};


