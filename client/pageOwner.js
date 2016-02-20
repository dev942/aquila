
aq.page.owner = {

// We do need keys, and we'll check for that manually. We don't need the
// keys to be authorized with an approveNewIdentity.
'needKeys' : false,

'init' : function() {
    var keys = aq.getStorage('keys');
    if(!(isObj(keys) && Object.keys(keys).length > 0)) {
        ui.navTo('keys');
        return;
    }
    
    // The default marketControl message is the current one
    var mc = aq.getStorage('marketControl').msg, mcHash = mc.hash;
    var l = [ 'type', 'genesisTxid', 'genesisVout',
              'time', 'timeHash', 'timeReal', 'hash',
              'ownerSig', 'ownerSigFrom'];
    l.forEach(function(p) {
        mc[p] = "(press 'Check' button to fill)";
    });

    mc = JSON.stringify(mc, null, '  ');
    $('#owner-market-control')[0].value = mc;

    // Show the owner's stake, in absolute terms and as a fraction of total.
    var owners = aq.getStorage('owners'), sk = keys.secretKeys, pkh,
        shares = 0, totalShares = 0;
    for(pkh in owners) {
        totalShares += owners[pkh];
        if(pkh in sk) {
            shares += owners[pkh];
        }
    }
    var percent = (100*(shares / totalShares)).toFixed(2);
    $('#owner-stake').text('stake = ' + shares + ' shares, ' + percent + '%');

    // Get a list of marketControl messages, sorted by voting power. So
    // the effective one is on the top, but we can vote on any of them
    // and perhaps reorder the list.

    var now = getUnixTime(),
        owners = aq.getStorage('owners'),
        delegates = aq.getStorage('delegates'),
        have = { };

    function gotMsgs(r) {
        if(!(r && r.result && isArray(r.result.msgs))) return;
        r = r.result.msgs;
        ui.hidePopup();

        r.forEach(function(mc) {
            var vp = msg.marketControlVotingPower(mc, now,
                                    conf.voteAgingFactor, owners, delegates);
            // again, a modified hash that includes the signatures
            var mh = cutil.sha256(JSON.stringify(mc)).toString('hex');
            if(have[mh]) return;

            var tr = $('<tr/>');
            ui.hashTableCell(mc.hash).appendTo(tr);
            var pkh = (mc.adminPkh.length > 0) ? mc.adminPkh[0] : '-';
            $('<td/>', { 'text'  : pkh,
                         'class' : 'mono wrap' }).appendTo(tr);
            $('<td/>', { 'text'  : timeAgo(mc.timeReal), }).appendTo(tr);
            var vpp = (100*(vp.aged / totalShares)).toFixed(2) + '%';
            $('<td/>', { 'text'  : vpp, }).appendTo(tr);
            var td = $('<td/>'),
                rd = $('<input/>', { 'type' : 'radio', 'name' : 'owner-rad' });
            rd.appendTo(td);
            td.appendTo(tr);
            if(mc.hash === mcHash) tr.addClass('hl');

            have[mh] = {
                'marketControl' : mc,
                'radio'         : rd,
            };

            tr.appendTo('#owner-votables');
        });
    }

    $('#owner-vote-button').on('click', function() {
        var mh;
        for(mh in have) {
            if(have[mh].radio[0].checked) {
                aq.page.owner.voteFor(have[mh].marketControl);
                return;
            }
        }
        ui.showPopup('notify', 'No message selected.');
    });

    aq.rpc.toServers('searchMsg', {
        'type'          : 'marketControl',
        'limitResults'  : 30,
        'resultsAs'     : 'msg',
        'sortBy'        : 'votingPower',
    }, gotMsgs, null);
    ui.showPopup('log');

    var radios = { };
    for(pkh in sk) {
        if(!(pkh in owners)) continue;
        var tr = $('<tr/>');
        $('<td/>', { 'class' : 'mono', 'text' : pkh }).appendTo(tr);
        $('<td/>', { 'class' : 'mono', 'text' : owners[pkh] }).appendTo(tr);
        radios[pkh] = $('<input/>', {
            'type' : 'radio',
            'name' : 'owner-pkhs',
        });
        ui.wrapTd(radios[pkh]).appendTo(tr);
        tr.appendTo('#owner-pkhs');
    }
    function delegate(to) {
        try {
            var pkh, from;
            for(pkh in radios) {
                if(radios[pkh][0].checked) from = pkh;
            }
            if(!from) throw 'Must select a key.';
            to = to || from;
            if(!owners[to]) throw 'Delegate must be an owner.';

            var dpv = {
                'type'    : 'delegateProxyVote',
                'proxy'   : to,
                'sigFrom' : from,
                'sig'     : msg.notYetSigned,
            };
            msg.fillTime(dpv);
            dpv = msg.fromUntrusted(dpv, 'compute');
            msg.fillSignatures(dpv);
            dpv = JSON.stringify(dpv);

            aq.sendMsgWithCaptcha([ dpv ]);
        } catch(e) {
            ui.showPopup('notify', 'Failed: ' + e);
        }
    }
    $('#owner-delegate').on('click', function() {
        delegate($('#owner-proxy-addr')[0].value);
    });
    $('#owner-rescind').on('click', function() {
        delegate();
    });
},

'checkMarketControl' : function(silent) {
    var mc;
    try {
        var ta = $('#owner-market-control')[0];
        mc = JSON.parse(ta.value);

        mc.type = 'marketControl';
        msg.fillTime(mc);
        mc.ownerSigFrom = [ ];
        mc.ownerSig = [ ];
        mc = msg.fromUntrusted(mc, 'compute')

        ta.value = JSON.stringify(mc, null, '  ');
    } catch(e) {
        if(!silent) {
            ui.showPopup('notify', 'Message format bad: ' + e.toString());
        }
        return;
    }
    if(!silent) {
        ui.showPopup('notify',
            'Message format okay. The time, hash, and signatures will ' +
            'be filled upon broadcast.');
    }
    return mc;
},

/**
 * Sign a marketControl message with all of our owner identities, leaving
 * any existing signatures unchanged and not double-signing if we've signed
 * already.
 */
'fillOwnerSignatures' : function(mc) {
    var i, have = { };
    for(i = 0; i < mc.ownerSig.length; i++) {
        have[mc.ownerSigFrom[i]] = true;
    }

    var owners = aq.getStorage('owners'),
        keys = aq.getStorage('keys'), pkh;

    for(pkh in keys.secretKeys) {
        if(owners[pkh] && (!have[pkh])) {
            mc.ownerSigFrom.push(pkh);
            mc.ownerSig.push(msg.notYetSigned);
        }
    }
},

'broadcastMarketControl' : function() {
    var mc = aq.page.owner.checkMarketControl(true);
    if(!mc) {
        ui.showPopup('notify', 'Format bad, use check button to debug.');
        return;
    }

    aq.page.owner.fillOwnerSignatures(mc);
    if(mc.ownerSigFrom.length === 0) {
        ui.showPopup('notify', 'Need owner keys to send marketControl.');
        return;
    }

    msg.fillSignatures(mc);
    aq.sendMsgWithCaptcha([ JSON.stringify(mc) ]);
},

'voteFor' : function(mcIn) {
    var mc = JSON.parse(JSON.stringify(mcIn));

    var before = mc.ownerSig.length;
    aq.page.owner.fillOwnerSignatures(mc);
    if(mc.ownerSig.length === before) {
        ui.showPopup('notify', 'Already signed, or no owner keys loaded.');
        return;
    }

    msg.fillSignatures(mc);
    aq.sendMsgWithCaptcha([ JSON.stringify(mc) ]);
},

};


