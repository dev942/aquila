
aq.page.admin = {

'needKeys' : false,

'init' : function() {
    var keys = aq.getStorage('keys');
    if(!isObj(keys)) ui.navTo('keys');
    // But don't check if user is authorized, since a newly-elected admin
    // might need to use this page to authorize himself.
},

'approveNewIdentity' : function() {
    var ani = {
        'type'      : 'approveNewIdentity',
        'allowed'   : !$('#admin-approve-ban')[0].checked,
        'maySell'   : $('#admin-approve-sell')[0].checked,
        'pkhId'     : $('#admin-approve-pkhId')[0].value,
        'validFrom' : timeFromUserInput($('#admin-approve-validFrom')[0].value),
        'validTo'   : timeFromUserInput($('#admin-approve-validTo')[0].value),
        'kbPerDay'  : $('#admin-approve-kbPerDay')[0].value|0,
        'comment'   : $('#admin-approve-comment')[0].value,
    };
    aq.finishAndSendMsg(ani);
},

'delete' : function() {
    var dm = {
        'type'      : 'deleteMessage',
        'toDelete'  : $('#admin-delete-hash')[0].value,
        'comment'   : $('#admin-delete-comment')[0].value,
    };
    aq.finishAndSendMsg(dm);
},

'requestFeePayment' : function() {
    try {
        var rfp = {
            'type'      : 'requestFeePayment',
            'feeFrom'   : [ ],
            'feeTo'     : [ ],
            'feeAmount' : [ ],
            'comment'   : $('#admin-fee-comment')[0].value,
        };
        var t = $('#admin-fee-text')[0].value;
        var lc = 0;
        t.split('\n').forEach(function(line) {
            lc++;
            if(line === '') throw 'empty line';
            var sp = line.split(',');
            if(sp.length !== 3) {
                throw 'bad field count, want=3 have=' + sp.length;
            }
            if(!cutil.checker.btcAddr(sp[0])) throw 'sender address bad';
            if(!cutil.checker.btcAddr(sp[1])) throw 'recipient address bad';
            sp[2] = Number(sp[2]);
            if(sp[2] < 0 || sp[2] > 100) throw 'bad value';
            rfp.feeFrom.push(sp[0]);
            rfp.feeTo.push(sp[1]);
            rfp.feeAmount.push(sp[2]);
        });
    } catch(e) {
        ui.showPopup('notify', 'Bad fee request: ' + e + ': around line ' + lc);
        return;
    }
    aq.finishAndSendMsg(rfp);
},

};


